-- Emergency Episode billing now produces ONE combined invoice per episode,
-- with the Billing officer free to choose the billable lines.
--
-- Previously, completing an emergency draft split the episode into two
-- pending invoices (one for Medication lines, one for Lab Test lines) and
-- forced every episode line to be represented exactly once. That conflicted
-- with how the hospital actually works: the Billing officer reads the
-- recorded emergency details (medicines + laboratory tests), searches the
-- Pricelist himself, and bills the lines he considers billable, tagging each
-- line as Medication or Lab Test as he adds it.
--
-- New behaviour (kept fully on the separate emergency billing track):
--   1) ONE combined pending invoice is created for the whole episode.
--   2) Every invoice line keeps the officer's Medication/Lab Test category
--      (invoice_items.category). Claims and month-end sponsor statements use
--      that column to split medication vs laboratory amounts per patient.
--   3) Lines are the officer's choice. A line may still carry its
--      emergency_episode_item_id when the exact recorded item is billed;
--      free-form lines without a link are allowed.
--   4) Completing this draft NEVER moves the patient between stations —
--      only normal clinical orders drive the patient journey.

-- A single combined invoice can cover both service categories, so the old
-- one-row-per-invoice rule no longer applies. The episode -> invoice ->
-- category mapping stays available for category-level reporting.
ALTER TABLE public.emergency_episode_invoices
  DROP CONSTRAINT IF EXISTS emergency_episode_invoices_invoice_id_key;

CREATE INDEX IF NOT EXISTS emergency_episode_invoices_invoice_idx
  ON public.emergency_episode_invoices(invoice_id);

CREATE OR REPLACE FUNCTION public.complete_emergency_billing_draft(
  _draft_snap_id UUID,
  _matched_items JSONB,
  _billing_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid UUID := public.hms_current_user_id();
  v_episode UUID;
  v_patient UUID;
  v_visit UUID;
  v_draft_status TEXT;
  v_account_type TEXT;
  v_corporate_id UUID;
  v_role TEXT;
  v_invoice UUID;
  v_note_prefix TEXT;
  v_total NUMERIC := 0;
  v_provided INT8;
  v_duplicate_linked INT8;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['billing','accountant','receptionist','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only Billing staff can complete an Emergency Episode draft';
  END IF;

  SELECT emergency_episode_id, patient_id, visit_id, status
    INTO v_episode, v_patient, v_visit, v_draft_status
  FROM public.snap_orders
  WHERE id = _draft_snap_id AND intent = 'emergency_billing_draft'
  LIMIT 1;
  IF v_episode IS NULL THEN RAISE EXCEPTION 'Emergency Billing draft not found'; END IF;
  IF v_draft_status <> 'pending_billing' THEN RAISE EXCEPTION 'Emergency Billing draft is no longer waiting for billing'; END IF;

  SELECT count(*) INTO v_provided FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb));
  IF v_provided = 0 THEN RAISE EXCEPTION 'Add at least one billable line before generating the invoice'; END IF;

  -- Every provided line must have a description and an explicit category.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb)) AS item
    WHERE COALESCE(NULLIF(trim(item->>'name'), ''), NULLIF(trim(item->>'description'), '')) IS NULL
       OR COALESCE(NULLIF(trim(item->>'service_category'), ''), '') NOT IN ('medication','lab_test')
       OR COALESCE(item->>'unit_price', '') ~ '^-'
  ) THEN
    RAISE EXCEPTION 'Every Emergency billing line needs a description and an explicit Medication or Lab Test category';
  END IF;

  -- Optional episode linkage must point at a real, not-yet-billed item of this episode.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb)) AS item
    WHERE NULLIF(trim(item->>'emergency_episode_item_id',''), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.emergency_episode_items e
        WHERE e.id = NULLIF(item->>'emergency_episode_item_id','')::uuid
          AND e.episode_id = v_episode
          AND e.status <> 'cancelled'
          AND e.invoice_item_id IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'A billing line references an Emergency Episode item that is already billed or not part of this episode';
  END IF;

  -- The same episode item cannot be billed on two separate lines.
  SELECT count(*) INTO v_duplicate_linked
  FROM (
    SELECT NULLIF(trim(item->>'emergency_episode_item_id'), '')
    FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb)) AS item
    WHERE NULLIF(trim(item->>'emergency_episode_item_id',''), '') IS NOT NULL
    GROUP BY 1
    HAVING count(*) > 1
  ) AS duplicate_links;
  IF v_duplicate_linked > 0 THEN RAISE EXCEPTION 'The same Emergency Episode item cannot be billed twice'; END IF;

  SELECT account_type, corporate_id INTO v_account_type, v_corporate_id
  FROM public.patients WHERE id = v_patient;
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;
  v_note_prefix := COALESCE(NULLIF(trim(_billing_note), ''), 'Emergency Episode ' || substr(v_episode::text, 1, 8));

  -- ONE combined invoice for the whole episode; per-line Medication/Lab Test
  -- categories are preserved on invoice_items for claims and sponsor reports.
  SELECT COALESCE(SUM(
    (CASE WHEN COALESCE(item->>'qty','') ~ '^[0-9]+$' THEN greatest((item->>'qty')::int8, 1) ELSE 1 END)
    * COALESCE(NULLIF(item->>'unit_price','')::numeric, 0)
  ), 0) INTO v_total
  FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb)) AS item;

  INSERT INTO public.invoices(
    patient_id, visit_id, invoice_number, total_amount, original_amount, discount_amount,
    paid_amount, status, payment_method, notes, sponsor_type, corporate_account_id, created_by
  ) VALUES (
    v_patient, v_visit, '', v_total, v_total, 0, 0, 'pending', NULL, v_note_prefix,
    v_account_type,
    CASE WHEN v_account_type IN ('corporate','retainer') THEN v_corporate_id ELSE NULL END,
    v_role
  ) RETURNING id INTO v_invoice;

  -- Record which service categories this combined invoice covers.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_matched_items,'[]'::jsonb)) AS item
    WHERE item->>'service_category' = 'medication'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.emergency_episode_invoices x
    WHERE x.episode_id = v_episode AND x.service_category = 'medication'
  ) THEN
    INSERT INTO public.emergency_episode_invoices(episode_id, invoice_id, service_category)
    VALUES (v_episode, v_invoice, 'medication');
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_matched_items,'[]'::jsonb)) AS item
    WHERE item->>'service_category' = 'lab_test'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.emergency_episode_invoices x
    WHERE x.episode_id = v_episode AND x.service_category = 'lab_test'
  ) THEN
    INSERT INTO public.emergency_episode_invoices(episode_id, invoice_id, service_category)
    VALUES (v_episode, v_invoice, 'lab_test');
  END IF;

  INSERT INTO public.invoice_items(
    invoice_id, emergency_episode_item_id, description, quantity, unit_price, total,
    category, dispensing_status, dispensing_notes
  )
  SELECT
    v_invoice,
    e.id,
    COALESCE(NULLIF(trim(item->>'description'), ''), trim(item->>'name')),
    CASE WHEN COALESCE(item->>'qty','') ~ '^[0-9]+$' THEN greatest((item->>'qty')::int8,1) ELSE 1 END,
    COALESCE(NULLIF(item->>'unit_price','')::numeric, 0),
    (CASE WHEN COALESCE(item->>'qty','') ~ '^[0-9]+$' THEN greatest((item->>'qty')::int8,1) ELSE 1 END)
      * COALESCE(NULLIF(item->>'unit_price','')::numeric, 0),
    item->>'service_category',
    CASE
      WHEN e.id IS NOT NULL AND (e.item_type = 'lab' OR e.administered_now) THEN 'dispensed'
      WHEN e.id IS NOT NULL THEN 'pending'
      ELSE 'dispensed'
    END,
    CASE
      WHEN e.id IS NOT NULL AND e.item_type = 'lab' THEN 'Emergency laboratory work authorized/performed before payment.'
      WHEN e.id IS NOT NULL AND e.administered_now THEN 'Administered during emergency; do not re-dispense.'
      WHEN e.id IS NOT NULL THEN NULL
      ELSE 'Emergency episode line entered at Billing for urgent care already provided.'
    END
  FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb)) AS item
  LEFT JOIN public.emergency_episode_items e
    ON e.id = NULLIF(item->>'emergency_episode_item_id','')::uuid;

  -- Only the episode items the officer actually billed become 'billed'.
  UPDATE public.emergency_episode_items e
  SET invoice_item_id = i.id, status = 'billed', updated_at = now()
  FROM public.invoice_items i
  WHERE i.emergency_episode_item_id = e.id AND i.invoice_id = v_invoice;

  UPDATE public.snap_orders
  SET status = 'awaiting_payment', invoice_id = v_invoice, matched_items = COALESCE(_matched_items, '[]'::jsonb),
      billed_by = v_uid, billed_at = now(), updated_at = now()
  WHERE id = _draft_snap_id;

  UPDATE public.emergency_episodes
  SET status = 'reconciled', invoice_id = v_invoice, reconciled_at = now(), reconciled_by = v_uid, updated_at = now()
  WHERE id = v_episode;

  -- No patient status update here: Emergency Episode billing is a separate
  -- track and must never move the patient between stations.

  SELECT public.write_audit_log(
    'emergency_billing_draft_completed', 'invoice', v_invoice::text,
    jsonb_build_object('episode_id', v_episode, 'draft_id', _draft_snap_id, 'invoice_count', 1, 'lines', v_provided), 'success'
  );
  RETURN jsonb_build_object('episode_id', v_episode, 'primary_invoice_id', v_invoice, 'invoice_count', 1, 'status', 'pending');
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_emergency_billing_draft(UUID, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_emergency_billing_draft(UUID, JSONB, TEXT) TO service_role;
