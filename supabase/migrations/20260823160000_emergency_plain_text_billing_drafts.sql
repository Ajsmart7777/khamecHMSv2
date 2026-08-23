-- Emergency Episode v2: plain-text capture and deferred Billing draft.
-- A finalized episode becomes a locked draft in the existing Billing inbox.

ALTER TABLE public.emergency_episodes
  DROP CONSTRAINT IF EXISTS check_status,
  DROP CONSTRAINT IF EXISTS emergency_episodes_status_check;
ALTER TABLE public.emergency_episodes
  ADD CONSTRAINT emergency_episodes_status_check
  CHECK (status IN ('open','finalized','reconciled','cancelled'));

ALTER TABLE public.emergency_episodes
  ADD COLUMN IF NOT EXISTS billing_draft_snap_id UUID,
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finalized_by UUID;

CREATE INDEX IF NOT EXISTS emergency_episodes_billing_draft_idx
  ON public.emergency_episodes(billing_draft_snap_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS emergency_episodes_one_open_per_patient_idx
  ON public.emergency_episodes(patient_id) WHERE status = 'open';

-- The previous auto-finalization trigger depends on reconciliation and also
-- fires when reconciliation inserts the Billing draft. Drop it while replacing
-- the dependency, then recreate it at the end of this migration.
DROP TRIGGER IF EXISTS snap_orders_auto_finalize_emergency ON public.snap_orders;

-- Emergency Lab completion keeps the financial state unpaid but publishes a
-- normal returned result row so Patient Header -> Lab Results remains the one
-- place staff use to read the full result.
CREATE OR REPLACE FUNCTION public.complete_emergency_lab_request(
  _lab_request_id UUID,
  _results JSONB,
  _result_path TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid UUID := public.hms_current_user_id();
  v_episode UUID;
  v_patient UUID;
  v_visit UUID;
  v_parent_snap UUID;
  v_requester UUID;
  v_result_snap UUID;
  v_status TEXT;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['lab_tech','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only laboratory staff can complete an emergency laboratory request';
  END IF;
  SELECT lr.emergency_episode_id, lr.patient_id, lr.visit_id, lr.status,
         CASE WHEN lr.requested_by ~ '^[0-9a-fA-F-]{36}$' THEN lr.requested_by::uuid ELSE NULL END
    INTO v_episode, v_patient, v_visit, v_status, v_requester
  FROM public.lab_requests lr
  WHERE lr.id = _lab_request_id
  LIMIT 1;
  IF v_episode IS NULL THEN RAISE EXCEPTION 'Emergency laboratory request not found'; END IF;
  IF v_status = 'completed' THEN RAISE EXCEPTION 'Emergency laboratory request is already completed'; END IF;

  SELECT e.source_snap_id INTO v_parent_snap
  FROM public.emergency_episode_items e
  WHERE e.lab_request_id = _lab_request_id
  ORDER BY e.created_at
  LIMIT 1;

  UPDATE public.lab_requests
  SET status='completed', results=_results, completed_at=now(),
      emergency_result_path=_result_path, updated_at=now()
  WHERE id=_lab_request_id;
  UPDATE public.emergency_episode_items
  SET status='completed', updated_at=now()
  WHERE lab_request_id=_lab_request_id;

  INSERT INTO public.snap_orders(
    patient_id, visit_id, order_type, target_station, source_role,
    original_sender_role, parent_snap_id, photo_path, result_text, note,
    status, returned_to, returned_at, created_by, emergency_episode_id, ocr_text
  ) VALUES (
    v_patient, v_visit, 'lab', 'doctor', 'lab', 'doctor', v_parent_snap,
    _result_path, COALESCE(_results->>'value', _results::text),
    COALESCE(_results->>'interpretation', 'Emergency laboratory result'),
    'returned', v_requester, now(), v_uid, v_episode,
    'EMERGENCY_LAB_RESULT:' || _lab_request_id::text
  ) RETURNING id INTO v_result_snap;

  SELECT public.write_audit_log(
    'emergency_lab_completed', 'lab_request', _lab_request_id::text,
    jsonb_build_object('episode_id', v_episode, 'patient_id', v_patient, 'result_snap_id', v_result_snap), 'success'
  );
  RETURN jsonb_build_object('lab_request_id', _lab_request_id, 'episode_id', v_episode, 'patient_id', v_patient, 'status', 'completed', 'result_snap_id', v_result_snap);
END;
$$;

-- Finalize an open episode into one normal-looking Billing draft. No invoice is
-- created here: Billing must match every plain-text line to the Pricelist first.
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

  IF NOT EXISTS (SELECT 1 FROM public.admissions WHERE patient_id = v_patient AND status IN ('active','ready_for_discharge')) THEN
    UPDATE public.patients SET status = 'awaiting_billing', updated_at = now() WHERE id = v_patient;
  END IF;

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

-- Billing officer completes the draft by matching each text line to a real
-- Pricelist item. Only then is one ordinary pending invoice created.
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
  v_expected INT8;
  v_provided INT8;
  v_unique INT8;
  v_invoice UUID;
  v_total NUMERIC := 0;
  v_account_type TEXT;
  v_corporate_id UUID;
  v_role TEXT;
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
  IF v_draft_status <> 'pending_billing' THEN RAISE EXCEPTION 'Emergency Billing draft is no longer waiting for matching'; END IF;

  SELECT count(*) INTO v_expected FROM public.emergency_episode_items WHERE episode_id = v_episode AND status <> 'cancelled';
  SELECT count(*) INTO v_provided FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb)) AS item;
  SELECT count(DISTINCT item->>'emergency_episode_item_id') INTO v_unique FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb)) AS item;
  IF v_provided <> v_expected OR v_unique <> v_expected THEN
    RAISE EXCEPTION 'Every Emergency Episode line must be matched before creating the invoice';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb)) AS item
    WHERE NULLIF(trim(COALESCE(item->>'pricelist_id','')), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Match every Emergency Episode line to the Pricelist first';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb)) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM public.emergency_episode_items e
      WHERE e.id = NULLIF(item->>'emergency_episode_item_id','')::uuid
        AND e.episode_id = v_episode AND e.status <> 'cancelled'
    )
  ) THEN
    RAISE EXCEPTION 'Invalid Emergency Episode line in Billing draft';
  END IF;

  SELECT COALESCE(SUM(
    CASE WHEN COALESCE(item->>'qty','') ~ '^[0-9]+$' THEN greatest((item->>'qty')::int8,1) ELSE 1 END
    * COALESCE(p.price,0)
  ),0)
  INTO v_total
  FROM jsonb_array_elements(_matched_items) AS item
  JOIN public.pricelist p ON p.id = NULLIF(item->>'pricelist_id','')::uuid;

  SELECT account_type, corporate_id INTO v_account_type, v_corporate_id FROM public.patients WHERE id = v_patient;
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;
  INSERT INTO public.invoices(
    patient_id, visit_id, invoice_number, total_amount, original_amount, discount_amount,
    paid_amount, status, payment_method, notes, sponsor_type, corporate_account_id, created_by
  ) VALUES (
    v_patient, v_visit, '', v_total, v_total, 0, 0, 'pending', NULL,
    COALESCE(NULLIF(trim(_billing_note), ''), 'Emergency Episode ' || substr(v_episode::text,1,8) || ' — matched Billing draft'),
    v_account_type, CASE WHEN v_account_type IN ('corporate','retainer') THEN v_corporate_id ELSE NULL END, v_role
  ) RETURNING id INTO v_invoice;

  INSERT INTO public.invoice_items(
    invoice_id, emergency_episode_item_id, description, quantity, unit_price, total,
    category, dispensing_status, dispensing_notes
  )
  SELECT
    v_invoice, e.id,
    p.name || CASE WHEN p.size IS NOT NULL AND p.size <> '' THEN ' ' || p.size ELSE '' END,
    CASE WHEN COALESCE(item->>'qty','') ~ '^[0-9]+$' THEN greatest((item->>'qty')::int8,1) ELSE 1 END,
    p.price,
    (CASE WHEN COALESCE(item->>'qty','') ~ '^[0-9]+$' THEN greatest((item->>'qty')::int8,1) ELSE 1 END) * p.price,
    CASE WHEN e.item_type = 'lab' THEN 'lab' ELSE COALESCE(p.category,'drug') END,
    CASE WHEN e.item_type = 'lab' OR e.administered_now THEN 'dispensed' ELSE 'pending' END,
    CASE WHEN e.item_type = 'lab' THEN 'Emergency laboratory work authorized/performed before payment.' WHEN e.administered_now THEN 'Administered during emergency; do not re-dispense.' ELSE NULL END
  FROM jsonb_array_elements(_matched_items) AS item
  JOIN public.emergency_episode_items e ON e.id = NULLIF(item->>'emergency_episode_item_id','')::uuid
  JOIN public.pricelist p ON p.id = NULLIF(item->>'pricelist_id','')::uuid;

  UPDATE public.emergency_episode_items e
  SET invoice_item_id = i.id, status = 'billed', updated_at = now()
  FROM public.invoice_items i
  WHERE i.invoice_id = v_invoice AND i.emergency_episode_item_id = e.id;

  UPDATE public.snap_orders
  SET status = 'awaiting_payment', invoice_id = v_invoice, matched_items = _matched_items,
      billed_by = v_uid, billed_at = now(), updated_at = now()
  WHERE id = _draft_snap_id;

  -- Normal orders that were auto-merged into the episode become ordinary
  -- cashier/pharmacy/lab work after the combined invoice is created. Emergency
  -- clinical snaps remain acknowledged because they are already handled inside
  -- the episode and must not be re-dispensed.
  UPDATE public.snap_orders so
  SET status = 'awaiting_payment', invoice_id = v_invoice, billed_by = v_uid,
      billed_at = now(),
      matched_items = COALESCE((
        SELECT jsonb_agg(item ORDER BY item->>'emergency_episode_item_id')
        FROM jsonb_array_elements(_matched_items) AS item
        WHERE NULLIF(item->>'source_snap_id','')::uuid = so.id
      ), so.matched_items),
      updated_at = now()
  FROM public.emergency_episode_items e
  WHERE e.episode_id = v_episode AND e.source_snap_id = so.id
    AND so.intent <> 'emergency_episode'
    AND so.status IN ('acknowledged','pending_billing')
    AND so.invoice_id IS NULL;

  UPDATE public.emergency_episodes
  SET status = 'reconciled', invoice_id = v_invoice, reconciled_at = now(),
      reconciled_by = v_uid, updated_at = now()
  WHERE id = v_episode;

  IF NOT EXISTS (SELECT 1 FROM public.admissions WHERE patient_id = v_patient AND status IN ('active','ready_for_discharge')) THEN
    UPDATE public.patients SET status = 'awaiting_payment', updated_at = now() WHERE id = v_patient;
  END IF;

  SELECT public.write_audit_log(
    'emergency_billing_draft_completed', 'invoice', v_invoice::text,
    jsonb_build_object('episode_id', v_episode, 'draft_id', _draft_snap_id, 'total', v_total), 'success'
  );
  RETURN jsonb_build_object('episode_id', v_episode, 'invoice_id', v_invoice, 'total', v_total, 'status', 'pending');
END;
$$;

-- Any ordinary pending-billing order created while an episode is open closes
-- that episode into the same Billing draft and becomes one of its text lines.
-- This is intentionally set-based and inline: CockroachDB rejects a trigger
-- dependency cycle when a trigger function calls a function that inserts into
-- the same table on which the trigger is installed.
CREATE OR REPLACE FUNCTION public.auto_finalize_emergency_for_normal_order()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_episode UUID;
  v_draft UUID;
  v_item UUID;
  v_description TEXT;
  v_type TEXT;
  v_items JSONB;
  v_role TEXT;
  v_patient UUID;
  v_visit UUID;
  v_admission UUID;
  v_count INT8;
BEGIN
  IF (new).status <> 'pending_billing'
     OR COALESCE((new).intent,'') IN ('emergency_episode','emergency_billing_draft','emergency_remainder')
     OR (new).emergency_episode_id IS NOT NULL THEN
    RETURN new;
  END IF;

  SELECT e.id, e.patient_id, e.visit_id, e.admission_id INTO v_episode, v_patient, v_visit, v_admission
  FROM public.emergency_episodes e
  WHERE e.patient_id = (new).patient_id AND e.status = 'open'
  ORDER BY e.created_at DESC
  LIMIT 1;
  IF v_episode IS NULL THEN RETURN new; END IF;

  v_description := NULLIF(trim(COALESCE((new).note,'')), '');
  IF v_description IS NULL THEN v_description := initcap(COALESCE((new).order_type,'clinical')) || ' order — see attached clinical record'; END IF;
  v_type := CASE WHEN (new).order_type = 'lab' THEN 'lab' ELSE 'medication' END;
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = (new).created_by LIMIT 1;

  INSERT INTO public.emergency_episode_items(
    episode_id, item_type, description, quantity, unit_price, administered_now, status,
    created_by, source_snap_id, notes
  ) VALUES (
    v_episode, v_type, left(v_description, 500), 1, 0, false, 'pending_billing',
    (new).created_by, (new).id, 'Normal order created outside Emergency Episode; merged into its Billing draft.'
  ) RETURNING id INTO v_item;

  SELECT count(*) INTO v_count FROM public.emergency_episode_items WHERE episode_id = v_episode AND status <> 'cancelled';
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'emergency_episode_item_id', e.id, 'name', e.description, 'description', e.description,
    'size', NULL, 'category', CASE WHEN e.item_type='lab' THEN 'lab' ELSE 'drug' END,
    'qty', e.quantity, 'unit_price', 0, 'pricelist_id', '',
    'source_snap_id', e.source_snap_id, 'needs_pricelist_match', true
  ) ORDER BY e.created_at), '[]'::jsonb)
  INTO v_items
  FROM public.emergency_episode_items e
  WHERE e.episode_id = v_episode AND e.status <> 'cancelled';

  INSERT INTO public.snap_orders(
    patient_id, visit_id, order_type, target_station, source_role, photo_path, note,
    matched_items, status, created_by, original_sender_role, intent,
    is_admitted_snap, emergency_episode_id, ocr_text
  ) VALUES (
    v_patient, v_visit, 'treatment', 'billing', COALESCE(v_role,'nurse'), NULL,
    'Auto-finalized Emergency Episode with normal ' || COALESCE((new).order_type,'clinical') || ' order',
    v_items, 'pending_billing', (new).created_by, COALESCE(v_role,'nurse'),
    'emergency_billing_draft', v_admission IS NOT NULL, v_episode,
    'EMERGENCY_EPISODE:' || v_episode::text
  ) RETURNING id INTO v_draft;

  UPDATE public.emergency_episodes
  SET status='finalized', billing_draft_snap_id=v_draft, finalized_at=now(),
      finalized_by=(new).created_by, updated_at=now()
  WHERE id = v_episode;

  UPDATE public.snap_orders
  SET status='acknowledged', updated_at=now()
  WHERE id = (new).id AND status='pending_billing';
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS snap_orders_auto_finalize_emergency ON public.snap_orders;
CREATE TRIGGER snap_orders_auto_finalize_emergency
AFTER INSERT ON public.snap_orders
FOR EACH ROW EXECUTE FUNCTION public.auto_finalize_emergency_for_normal_order();

CREATE OR REPLACE FUNCTION public.patient_pending_workflow_station(_patient_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.emergency_episodes e
      WHERE e.patient_id = _patient_id
        AND (e.status = 'open' OR (e.status = 'finalized' AND e.invoice_id IS NULL))
    ) THEN 'emergency_episode'
    WHEN EXISTS (
      SELECT 1 FROM public.snap_orders so
      WHERE so.patient_id = _patient_id AND so.target_station = 'lab'
        AND so.status IN ('pending_billing','awaiting_payment','paid')
    ) THEN 'in_lab'
    WHEN EXISTS (
      SELECT 1 FROM public.snap_orders so
      WHERE so.patient_id = _patient_id AND so.target_station = 'pharmacy'
        AND so.status IN ('pending_billing','awaiting_payment','paid')
    ) THEN 'at_pharmacy'
    WHEN EXISTS (
      SELECT 1 FROM public.snap_orders so
      WHERE so.patient_id = _patient_id AND so.status = 'pending_billing'
    ) THEN 'awaiting_billing'
    WHEN EXISTS (
      SELECT 1 FROM public.snap_orders so
      WHERE so.patient_id = _patient_id AND so.status = 'awaiting_payment'
    ) THEN 'awaiting_payment'
    WHEN EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.patient_id = _patient_id AND i.status IN ('pending','partial')
    ) THEN 'awaiting_payment'
    ELSE NULL
  END;
$$;

GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_emergency_lab_request(UUID,JSONB,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_emergency_episode(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_emergency_billing_draft(UUID,JSONB,TEXT) TO authenticated;
