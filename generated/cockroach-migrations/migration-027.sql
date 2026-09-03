-- Emergency Episode billing must never drive the patient's status or journey.
--
-- An Emergency Episode is urgent care delivered before payment. Its billing
-- draft, invoice, and settlement are a separate billing track: the clinical
-- visit flow (nurse -> billing -> cashier -> pharmacy/lab -> discharged) is
-- driven only by normal orders. This migration makes that separation real at
-- the database level so no RPC, trigger, or frontend check can block a
-- discharge or move a patient because of emergency-episode billing.

-- 1) patient_pending_workflow_station: ignore emergency-episode snaps and
--    emergency-only invoices. This unblocks the discharge guards in
--    advance_journey, check_patient_discharge_eligibility, and
--    check_journey_discharge_eligibility (they all call this function).
CREATE OR REPLACE FUNCTION public.patient_pending_workflow_station(_patient_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.status = 'pending_billing'
        AND so.emergency_episode_id IS NULL
        AND COALESCE(so.intent, '') NOT IN ('emergency_episode', 'emergency_billing_draft', 'emergency_remainder')
    ) THEN 'awaiting_billing'
    WHEN EXISTS (
      SELECT 1
      FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.status = 'awaiting_payment'
        AND so.emergency_episode_id IS NULL
        AND COALESCE(so.intent, '') NOT IN ('emergency_episode', 'emergency_billing_draft', 'emergency_remainder')
    ) THEN 'awaiting_payment'
    WHEN EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.patient_id = _patient_id
        AND i.status IN ('pending', 'partial')
        AND (
          NOT EXISTS (SELECT 1 FROM public.snap_orders so WHERE so.invoice_id = i.id)
          OR EXISTS (
            SELECT 1 FROM public.snap_orders so
            WHERE so.invoice_id = i.id
              AND so.emergency_episode_id IS NULL
              AND COALESCE(so.intent, '') NOT IN ('emergency_episode', 'emergency_billing_draft', 'emergency_remainder')
          )
        )
    ) THEN 'awaiting_payment'
    WHEN EXISTS (
      SELECT 1
      FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.target_station = 'lab'
        AND so.status = 'paid'
        AND so.emergency_episode_id IS NULL
        AND COALESCE(so.intent, '') NOT IN ('emergency_episode', 'emergency_billing_draft', 'emergency_remainder')
    ) THEN 'in_lab'
    WHEN EXISTS (
      SELECT 1
      FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.target_station = 'pharmacy'
        AND so.status = 'paid'
        AND so.emergency_episode_id IS NULL
        AND COALESCE(so.intent, '') NOT IN ('emergency_episode', 'emergency_billing_draft', 'emergency_remainder')
    ) THEN 'at_pharmacy'
    ELSE NULL
  END;
$$;

-- 2) check_patient_discharge_eligibility: exclude emergency-only invoices from
--    the unpaid-invoice discharge check. CockroachDB cannot replace a function
--    while a trigger references it, so detach first, replace, then recreate.
DROP TRIGGER IF EXISTS tr_check_patient_discharge_eligibility ON public.patients;

CREATE OR REPLACE FUNCTION public.check_patient_discharge_eligibility()
RETURNS TRIGGER AS $$
DECLARE
  _pending_station text;
  _open_visit_id uuid;
  _active_adm_id uuid;
  _pending_inv_id uuid;
BEGIN
  -- Only run check when status is changing to 'discharged'
  IF (NEW).status = 'discharged' AND ((OLD).status IS NULL OR (OLD).status <> 'discharged') THEN

    -- 1. Check for pending workflow stations (Labs, Pharmacy, Billing).
    --    patient_pending_workflow_station now ignores emergency-episode items.
    _pending_station := public.patient_pending_workflow_station((NEW).id);
    IF _pending_station IS NOT NULL THEN
      RAISE EXCEPTION 'CANNOT_DISCHARGE: patient has pending workflow at %', _pending_station;
    END IF;

    -- 2. Check for open visits
    SELECT id INTO _open_visit_id
    FROM public.visits
    WHERE patient_id = (NEW).id AND status = 'open'
    LIMIT 1;
    IF _open_visit_id IS NOT NULL THEN
      RAISE EXCEPTION 'CANNOT_DISCHARGE: patient has an open visit (ID: %)', _open_visit_id;
    END IF;

    -- 3. Check for active admissions
    SELECT id INTO _active_adm_id
    FROM public.admissions
    WHERE patient_id = (NEW).id
      AND status IN ('waiting_assignment', 'active', 'ready_for_discharge')
    LIMIT 1;
    IF _active_adm_id IS NOT NULL THEN
      RAISE EXCEPTION 'CANNOT_DISCHARGE: patient has an active admission (ID: %)', _active_adm_id;
    END IF;

    -- 4. Check for unpaid invoices. Emergency-only invoices (emergency episode
    --    billing) are a separate billing track and never block discharge.
    SELECT id INTO _pending_inv_id
    FROM public.invoices i
    WHERE i.patient_id = (NEW).id AND i.status IN ('pending', 'partial')
      AND (
        NOT EXISTS (SELECT 1 FROM public.snap_orders so WHERE so.invoice_id = i.id)
        OR EXISTS (
          SELECT 1 FROM public.snap_orders so
          WHERE so.invoice_id = i.id
            AND so.emergency_episode_id IS NULL
            AND COALESCE(so.intent, '') NOT IN ('emergency_episode', 'emergency_billing_draft', 'emergency_remainder')
        )
      )
    LIMIT 1;
    IF _pending_inv_id IS NOT NULL THEN
      RAISE EXCEPTION 'CANNOT_DISCHARGE: patient has unpaid or partial invoices';
    END IF;

  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_check_patient_discharge_eligibility
BEFORE UPDATE ON public.patients
FOR EACH ROW
EXECUTE FUNCTION public.check_patient_discharge_eligibility();

-- 3) reconcile_emergency_episode: finalizing an episode creates the Billing
--    draft but must NOT move the patient to awaiting_billing. The normal
--    clinical orders (and only they) drive the patient's journey.
CREATE OR REPLACE FUNCTION public.reconcile_emergency_episode(
  _episode_id UUID,
  _billing_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid UUID := public.hms_current_user_id();
  v_patient UUID;
  v_visit UUID;
  v_admission UUID;
  v_draft UUID;
  v_items JSONB;
  v_item_count INT8;
  v_role TEXT;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['nurse','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to finalize emergency episode';
  END IF;

  SELECT patient_id, visit_id, admission_id
    INTO v_patient, v_visit, v_admission
  FROM public.emergency_episodes
  WHERE id = _episode_id AND status = 'open'
  LIMIT 1;
  IF v_patient IS NULL THEN
    RAISE EXCEPTION 'Emergency episode not found, already finalized, or already closed';
  END IF;

  SELECT count(*) INTO v_item_count
  FROM public.emergency_episode_items
  WHERE episode_id = _episode_id AND status <> 'cancelled';
  IF v_item_count = 0 THEN RAISE EXCEPTION 'Emergency episode has no items'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'emergency_episode_item_id', e.id,
    'name', e.description,
    'description', e.description,
    'size', NULL,
    'category', CASE WHEN e.item_type = 'lab' THEN 'lab' ELSE 'drug' END,
    'qty', e.quantity,
    'unit_price', 0,
    'pricelist_id', '',
    'source_snap_id', e.source_snap_id,
    'needs_pricelist_match', true
  ) ORDER BY e.created_at), '[]'::jsonb)
  INTO v_items
  FROM public.emergency_episode_items e
  WHERE e.episode_id = _episode_id AND e.status <> 'cancelled';

  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;
  INSERT INTO public.snap_orders(
    patient_id, visit_id, order_type, target_station, source_role, photo_path, note,
    matched_items, status, created_by, original_sender_role, intent,
    is_admitted_snap, emergency_episode_id, ocr_text
  ) VALUES (
    v_patient, v_visit, 'treatment', 'billing', COALESCE(v_role, 'nurse'), NULL,
    COALESCE(NULLIF(trim(_billing_note), ''), 'Emergency Episode billing draft'),
    v_items, 'pending_billing', v_uid, COALESCE(v_role, 'nurse'),
    'emergency_billing_draft', v_admission IS NOT NULL, _episode_id,
    'EMERGENCY_EPISODE:' || _episode_id::text
  ) RETURNING id INTO v_draft;

  UPDATE public.emergency_episodes
  SET status = 'finalized', billing_draft_snap_id = v_draft,
      finalized_at = now(), finalized_by = v_uid, updated_at = now()
  WHERE id = _episode_id;

  -- No patient status update here: emergency episode billing is a separate
  -- track and must never move the patient between stations.

  SELECT public.write_audit_log(
    'emergency_episode_finalized_to_billing_draft', 'emergency_episode', _episode_id::text,
    jsonb_build_object('patient_id', v_patient, 'billing_draft_snap_id', v_draft, 'item_count', v_item_count), 'success'
  );
  RETURN jsonb_build_object(
    'episode_id', _episode_id, 'patient_id', v_patient,
    'billing_draft_id', v_draft, 'item_count', v_item_count, 'status', 'finalized'
  );
END;
$$;

-- 4) complete_emergency_billing_draft: completing the emergency draft creates
--    the emergency invoice(s) but must NOT move the patient to
--    awaiting_payment. Only normal orders drive the patient's journey.
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
  v_primary_invoice UUID;
  v_expected INT8;
  v_provided INT8;
  v_unique INT8;
  v_invoice_count INT8;
  v_note_prefix TEXT;
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
       OR COALESCE(NULLIF(trim(item->>'service_category'), ''), '') NOT IN ('medication','lab_test')
  ) THEN
    RAISE EXCEPTION 'Each Emergency Episode line needs a description and an explicit Medication or Lab Test category';
  END IF;

  SELECT account_type, corporate_id INTO v_account_type, v_corporate_id
  FROM public.patients WHERE id = v_patient;
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;
  v_note_prefix := COALESCE(NULLIF(trim(_billing_note), ''), 'Emergency Episode ' || substr(v_episode::text,1,8));

  -- Insert at most one invoice for each of the two supported emergency groups.
  INSERT INTO public.invoices(
    patient_id, visit_id, invoice_number, total_amount, original_amount, discount_amount,
    paid_amount, status, payment_method, notes, sponsor_type, corporate_account_id, created_by
  )
  SELECT v_patient, v_visit, '',
    COALESCE(SUM((CASE WHEN COALESCE(item->>'qty','') ~ '^[0-9]+$' THEN greatest((item->>'qty')::int8,1) ELSE 1 END) * COALESCE(NULLIF(item->>'unit_price','')::numeric, 0)),0),
    COALESCE(SUM((CASE WHEN COALESCE(item->>'qty','') ~ '^[0-9]+$' THEN greatest((item->>'qty')::int8,1) ELSE 1 END) * COALESCE(NULLIF(item->>'unit_price','')::numeric, 0)),0),
    0, 0, 'pending', NULL, v_note_prefix || ' — Medication', v_account_type,
    CASE WHEN v_account_type IN ('corporate','retainer') THEN v_corporate_id ELSE NULL END, v_role
  FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb)) AS item
  WHERE item->>'service_category' = 'medication'
  HAVING count(*) > 0;

  INSERT INTO public.invoices(
    patient_id, visit_id, invoice_number, total_amount, original_amount, discount_amount,
    paid_amount, status, payment_method, notes, sponsor_type, corporate_account_id, created_by
  )
  SELECT v_patient, v_visit, '',
    COALESCE(SUM((CASE WHEN COALESCE(item->>'qty','') ~ '^[0-9]+$' THEN greatest((item->>'qty')::int8,1) ELSE 1 END) * COALESCE(NULLIF(item->>'unit_price','')::numeric, 0)),0),
    COALESCE(SUM((CASE WHEN COALESCE(item->>'qty','') ~ '^[0-9]+$' THEN greatest((item->>'qty')::int8,1) ELSE 1 END) * COALESCE(NULLIF(item->>'unit_price','')::numeric, 0)),0),
    0, 0, 'pending', NULL, v_note_prefix || ' — Lab Test', v_account_type,
    CASE WHEN v_account_type IN ('corporate','retainer') THEN v_corporate_id ELSE NULL END, v_role
  FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb)) AS item
  WHERE item->>'service_category' = 'lab_test'
  HAVING count(*) > 0;

  INSERT INTO public.emergency_episode_invoices(episode_id, invoice_id, service_category)
  SELECT v_episode, i.id, 'medication'
  FROM public.invoices i
  WHERE i.patient_id=v_patient AND i.visit_id IS NOT DISTINCT FROM v_visit
    AND i.notes=v_note_prefix || ' — Medication'
    AND NOT EXISTS (SELECT 1 FROM public.emergency_episode_invoices x WHERE x.episode_id=v_episode AND x.service_category='medication');

  INSERT INTO public.emergency_episode_invoices(episode_id, invoice_id, service_category)
  SELECT v_episode, i.id, 'lab_test'
  FROM public.invoices i
  WHERE i.patient_id=v_patient AND i.visit_id IS NOT DISTINCT FROM v_visit
    AND i.notes=v_note_prefix || ' — Lab Test'
    AND NOT EXISTS (SELECT 1 FROM public.emergency_episode_invoices x WHERE x.episode_id=v_episode AND x.service_category='lab_test');

  SELECT invoice_id INTO v_primary_invoice
  FROM public.emergency_episode_invoices
  WHERE episode_id=v_episode
  ORDER BY CASE WHEN service_category='medication' THEN 0 ELSE 1 END, created_at
  LIMIT 1;
  SELECT count(*) INTO v_invoice_count FROM public.emergency_episode_invoices WHERE episode_id=v_episode;

  INSERT INTO public.invoice_items(
    invoice_id, emergency_episode_item_id, description, quantity, unit_price, total,
    category, dispensing_status, dispensing_notes
  )
  SELECT
    x.invoice_id, e.id,
    COALESCE(NULLIF(trim(item->>'description'), ''), trim(item->>'name')),
    CASE WHEN COALESCE(item->>'qty','') ~ '^[0-9]+$' THEN greatest((item->>'qty')::int8,1) ELSE 1 END,
    COALESCE(NULLIF(item->>'unit_price','')::numeric, 0),
    (CASE WHEN COALESCE(item->>'qty','') ~ '^[0-9]+$' THEN greatest((item->>'qty')::int8,1) ELSE 1 END) * COALESCE(NULLIF(item->>'unit_price','')::numeric, 0),
    item->>'service_category',
    CASE WHEN e.item_type = 'lab' OR e.administered_now THEN 'dispensed' ELSE 'pending' END,
    CASE WHEN e.item_type = 'lab' THEN 'Emergency laboratory work authorized/performed before payment.' WHEN e.administered_now THEN 'Administered during emergency; do not re-dispense.' ELSE NULL END
  FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb)) AS item
  JOIN public.emergency_episode_items e ON e.id = NULLIF(item->>'emergency_episode_item_id','')::uuid
  JOIN public.emergency_episode_invoices x ON x.episode_id=v_episode AND x.service_category=item->>'service_category'
  WHERE NOT EXISTS (SELECT 1 FROM public.invoice_items existing WHERE existing.emergency_episode_item_id=e.id);

  UPDATE public.emergency_episode_items e
  SET invoice_item_id = i.id, status = 'billed', updated_at = now()
  FROM public.invoice_items i
  WHERE i.emergency_episode_item_id=e.id AND i.invoice_id IN (SELECT invoice_id FROM public.emergency_episode_invoices WHERE episode_id=v_episode);

  UPDATE public.snap_orders
  SET status='awaiting_payment', invoice_id=v_primary_invoice, matched_items=COALESCE(_matched_items, '[]'::jsonb),
      billed_by=v_uid, billed_at=now(), updated_at=now()
  WHERE id=_draft_snap_id;

  UPDATE public.emergency_episodes
  SET status='reconciled', invoice_id=v_primary_invoice, reconciled_at=now(), reconciled_by=v_uid, updated_at=now()
  WHERE id=v_episode;

  -- No patient status update here: emergency episode billing is a separate
  -- track and must never move the patient between stations.

  SELECT public.write_audit_log(
    'emergency_billing_draft_completed', 'invoice', v_primary_invoice::text,
    jsonb_build_object('episode_id', v_episode, 'draft_id', _draft_snap_id, 'invoice_count', v_invoice_count, 'category_split', true), 'success'
  );
  RETURN jsonb_build_object('episode_id', v_episode, 'primary_invoice_id', v_primary_invoice, 'invoice_count', v_invoice_count, 'status', 'pending');
END;
$$;

-- Keep execution grants intact after CREATE OR REPLACE.
GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_emergency_episode(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_emergency_billing_draft(UUID, JSONB, TEXT) TO authenticated;