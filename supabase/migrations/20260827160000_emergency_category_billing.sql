-- Preserve the service category selected by Billing for emergency episode lines.
-- One episode may produce one Medication invoice and one Lab Test invoice.

CREATE TABLE IF NOT EXISTS public.emergency_episode_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES public.emergency_episodes(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  service_category TEXT NOT NULL CHECK (service_category IN ('medication','lab_test','delivery','bed','others')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (episode_id, service_category),
  UNIQUE (invoice_id)
);

CREATE INDEX IF NOT EXISTS emergency_episode_invoices_episode_idx
  ON public.emergency_episode_invoices(episode_id, service_category);

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
  v_category TEXT;
  v_invoice UUID;
  v_primary_invoice UUID;
  v_invoice_total NUMERIC;
  v_expected INT8;
  v_provided INT8;
  v_unique INT8;
  v_invoice_count INT8 := 0;
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

  SELECT count(*) INTO v_expected
  FROM public.emergency_episode_items
  WHERE episode_id = v_episode AND status <> 'cancelled' AND invoice_item_id IS NULL;
  SELECT count(*) INTO v_provided FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb));
  SELECT count(DISTINCT NULLIF(item->>'emergency_episode_item_id',''))
    INTO v_unique
  FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb)) AS item;
  IF v_provided <> v_expected OR v_unique <> v_expected THEN
    RAISE EXCEPTION 'Every unbilled Emergency Episode line must be represented exactly once';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb)) AS item
    WHERE NULLIF(trim(COALESCE(item->>'emergency_episode_item_id','')), '') IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.emergency_episode_items e
         WHERE e.id = NULLIF(item->>'emergency_episode_item_id','')::uuid
           AND e.episode_id = v_episode AND e.status <> 'cancelled' AND e.invoice_item_id IS NULL
       )
       OR COALESCE(NULLIF(trim(item->>'name'), ''), '') = ''
       OR COALESCE(NULLIF(trim(item->>'description'), ''), NULLIF(trim(item->>'name'), '')) IS NULL
       OR COALESCE(NULLIF(trim(item->>'service_category'), ''), '') NOT IN ('medication','lab_test','delivery','bed','others')
  ) THEN
    RAISE EXCEPTION 'Each Emergency Episode line needs a description and an explicit service category';
  END IF;

  SELECT account_type, corporate_id INTO v_account_type, v_corporate_id
  FROM public.patients WHERE id = v_patient;
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;

  FOR v_category IN
    SELECT DISTINCT item->>'service_category'
    FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb)) AS item
    ORDER BY item->>'service_category'
  LOOP
    SELECT COALESCE(SUM(
      (CASE WHEN COALESCE(item->>'qty','') ~ '^[0-9]+$' THEN greatest((item->>'qty')::int8,1) ELSE 1 END)
      * COALESCE(NULLIF(item->>'unit_price','')::numeric, 0)
    ),0)
    INTO v_invoice_total
    FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb)) AS item
    WHERE item->>'service_category' = v_category;

    INSERT INTO public.invoices(
      patient_id, visit_id, invoice_number, total_amount, original_amount, discount_amount,
      paid_amount, status, payment_method, notes, sponsor_type, corporate_account_id, created_by
    ) VALUES (
      v_patient, v_visit, '', v_invoice_total, v_invoice_total, 0, 0, 'pending', NULL,
      COALESCE(NULLIF(trim(_billing_note), ''), 'Emergency Episode ' || substr(v_episode::text,1,8)) || ' — ' || initcap(replace(v_category, '_', ' ')),
      v_account_type, CASE WHEN v_account_type IN ('corporate','retainer') THEN v_corporate_id ELSE NULL END, v_role
    ) RETURNING id INTO v_invoice;

    INSERT INTO public.emergency_episode_invoices(episode_id, invoice_id, service_category)
    VALUES (v_episode, v_invoice, v_category);

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
      (CASE WHEN COALESCE(item->>'qty','') ~ '^[0-9]+$' THEN greatest((item->>'qty')::int8,1) ELSE 1 END) * COALESCE(NULLIF(item->>'unit_price','')::numeric, 0),
      v_category,
      CASE WHEN e.item_type = 'lab' OR e.administered_now THEN 'dispensed' ELSE 'pending' END,
      CASE WHEN e.item_type = 'lab' THEN 'Emergency laboratory work authorized/performed before payment.' WHEN e.administered_now THEN 'Administered during emergency; do not re-dispense.' ELSE NULL END
    FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb)) AS item
    JOIN public.emergency_episode_items e ON e.id = NULLIF(item->>'emergency_episode_item_id','')::uuid
    WHERE item->>'service_category' = v_category;

    UPDATE public.emergency_episode_items e
    SET invoice_item_id = i.id, status = 'billed', updated_at = now()
    FROM public.invoice_items i
    WHERE i.invoice_id = v_invoice AND i.emergency_episode_item_id = e.id;

    IF v_primary_invoice IS NULL THEN v_primary_invoice := v_invoice; END IF;
    v_invoice_count := v_invoice_count + 1;
  END LOOP;

  UPDATE public.snap_orders
  SET status='awaiting_payment', invoice_id=v_primary_invoice, matched_items=COALESCE(_matched_items, '[]'::jsonb),
      billed_by=v_uid, billed_at=now(), updated_at=now()
  WHERE id=_draft_snap_id;

  UPDATE public.emergency_episodes
  SET status='reconciled', invoice_id=v_primary_invoice, reconciled_at=now(),
      reconciled_by=v_uid, updated_at=now()
  WHERE id=v_episode;

  IF NOT EXISTS (
    SELECT 1 FROM public.admissions
    WHERE patient_id=v_patient AND status IN ('active','ready_for_discharge')
  ) THEN
    UPDATE public.patients SET status='awaiting_payment', updated_at=now() WHERE id=v_patient;
  END IF;

  SELECT public.write_audit_log(
    'emergency_billing_draft_completed', 'invoice', v_primary_invoice::text,
    jsonb_build_object('episode_id', v_episode, 'draft_id', _draft_snap_id, 'invoice_count', v_invoice_count, 'category_split', true), 'success'
  );
  RETURN jsonb_build_object('episode_id', v_episode, 'primary_invoice_id', v_primary_invoice, 'invoice_count', v_invoice_count, 'status', 'pending');
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_emergency_billing_draft(UUID,JSONB,TEXT) TO authenticated;
