-- Emergency Episode workflow for urgent care before billing.
-- Cockroach-only compatibility migration: no Supabase auth.uid(), SET search_path, or PERFORM.

CREATE TABLE IF NOT EXISTS public.emergency_episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL,
  admission_id UUID REFERENCES public.admissions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reconciled','cancelled')),
  created_by UUID NOT NULL REFERENCES public.auth_users(id) ON DELETE NO ACTION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reconciled_at TIMESTAMPTZ,
  reconciled_by UUID REFERENCES public.auth_users(id) ON DELETE NO ACTION,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS emergency_episodes_patient_status_idx
  ON public.emergency_episodes(patient_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.emergency_episode_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES public.emergency_episodes(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('medication','lab')),
  pricelist_id UUID REFERENCES public.pricelist(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  strength TEXT,
  route TEXT,
  quantity INT8 NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  administered_now BOOL NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'given_now' CHECK (status IN ('given_now','authorized','in_progress','completed','pending_billing','billed','dispensed','cancelled')),
  administered_at TIMESTAMPTZ,
  administered_by UUID REFERENCES public.auth_users(id) ON DELETE NO ACTION,
  lab_request_id UUID REFERENCES public.lab_requests(id) ON DELETE SET NULL,
  invoice_item_id UUID REFERENCES public.invoice_items(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES public.auth_users(id) ON DELETE NO ACTION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS emergency_episode_items_episode_idx
  ON public.emergency_episode_items(episode_id, created_at);
CREATE INDEX IF NOT EXISTS emergency_episode_items_lab_idx
  ON public.emergency_episode_items(lab_request_id);

ALTER TABLE public.emergency_episodes
  ADD COLUMN IF NOT EXISTS invoice_id UUID;

ALTER TABLE public.lab_requests
  ADD COLUMN IF NOT EXISTS emergency_episode_id UUID,
  ADD COLUMN IF NOT EXISTS emergency_authorized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS emergency_authorized_by UUID,
  ADD COLUMN IF NOT EXISTS emergency_result_path TEXT;

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS emergency_episode_item_id UUID;

CREATE INDEX IF NOT EXISTS lab_requests_emergency_episode_idx
  ON public.lab_requests(emergency_episode_id, status, requested_at DESC);

-- The application must never represent unpaid emergency laboratory work as financially paid.
-- This status means the laboratory may perform the work immediately while cashier billing remains pending.

CREATE OR REPLACE FUNCTION public.start_emergency_episode(
  _patient_id UUID,
  _visit_id UUID DEFAULT NULL,
  _admission_id UUID DEFAULT NULL,
  _notes TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid UUID := public.hms_current_user_id();
  v_episode UUID;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['nurse','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to start an emergency episode';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = _patient_id) THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;
  IF _visit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.visits WHERE id = _visit_id AND patient_id = _patient_id) THEN
    RAISE EXCEPTION 'Invalid visit for patient';
  END IF;
  IF _admission_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.admissions WHERE id = _admission_id AND patient_id = _patient_id) THEN
    RAISE EXCEPTION 'Invalid admission for patient';
  END IF;

  SELECT id INTO v_episode
  FROM public.emergency_episodes
  WHERE patient_id = _patient_id AND status = 'open'
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_episode IS NOT NULL THEN RETURN v_episode; END IF;

  INSERT INTO public.emergency_episodes(patient_id, visit_id, admission_id, created_by, notes)
  VALUES (_patient_id, _visit_id, _admission_id, v_uid, NULLIF(trim(COALESCE(_notes,'')), ''))
  RETURNING id INTO v_episode;
  SELECT public.write_audit_log('emergency_episode_started', 'emergency_episode', v_episode::text, jsonb_build_object('patient_id', _patient_id), 'success');
  RETURN v_episode;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_emergency_medication(
  _episode_id UUID,
  _pricelist_id UUID DEFAULT NULL,
  _description TEXT DEFAULT NULL,
  _strength TEXT DEFAULT NULL,
  _route TEXT DEFAULT NULL,
  _quantity INT8 DEFAULT 1,
  _unit_price NUMERIC DEFAULT NULL,
  _administered_now BOOL DEFAULT true,
  _notes TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid UUID := public.hms_current_user_id();
  v_patient UUID;
  v_item UUID;
  v_name TEXT;
  v_price NUMERIC := COALESCE(_unit_price, 0);
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['nurse','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to record emergency medication';
  END IF;
  IF _quantity IS NULL OR _quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
  SELECT patient_id INTO v_patient FROM public.emergency_episodes WHERE id = _episode_id AND status = 'open';
  IF v_patient IS NULL THEN RAISE EXCEPTION 'Emergency episode not found or already closed'; END IF;
  IF _pricelist_id IS NOT NULL THEN
    SELECT name, price / NULLIF(pack_qty, 0) INTO v_name, v_price
    FROM public.pricelist WHERE id = _pricelist_id LIMIT 1;
    IF v_name IS NULL THEN RAISE EXCEPTION 'Pricelist item not found'; END IF;
  END IF;
  v_name := NULLIF(trim(COALESCE(_description, v_name, '')), '');
  IF v_name IS NULL THEN RAISE EXCEPTION 'Medication description is required'; END IF;

  INSERT INTO public.emergency_episode_items(
    episode_id, item_type, pricelist_id, description, strength, route, quantity, unit_price,
    administered_now, status, administered_at, administered_by, created_by, notes
  ) VALUES (
    _episode_id, 'medication', _pricelist_id, v_name, NULLIF(trim(COALESCE(_strength,'')), ''),
    NULLIF(trim(COALESCE(_route,'')), ''), _quantity, COALESCE(v_price,0), _administered_now,
    CASE WHEN _administered_now THEN 'given_now' ELSE 'pending_billing' END,
    CASE WHEN _administered_now THEN now() ELSE NULL END,
    CASE WHEN _administered_now THEN v_uid ELSE NULL END,
    v_uid, NULLIF(trim(COALESCE(_notes,'')), '')
  ) RETURNING id INTO v_item;
  SELECT public.write_audit_log('emergency_medication_recorded', 'emergency_episode_item', v_item::text, jsonb_build_object('episode_id', _episode_id, 'patient_id', v_patient, 'administered_now', _administered_now), 'success');
  RETURN v_item;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_emergency_lab_request(
  _episode_id UUID,
  _tests TEXT[],
  _diagnosis TEXT DEFAULT NULL,
  _total NUMERIC DEFAULT 0,
  _notes TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid UUID := public.hms_current_user_id();
  v_patient UUID;
  v_visit UUID;
  v_lab UUID := gen_random_uuid();
  v_item UUID;
  v_request_number TEXT;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['nurse','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to record emergency laboratory work';
  END IF;
  IF _tests IS NULL OR array_length(_tests, 1) IS NULL THEN RAISE EXCEPTION 'At least one laboratory test is required'; END IF;
  SELECT patient_id, visit_id INTO v_patient, v_visit FROM public.emergency_episodes WHERE id = _episode_id AND status = 'open';
  IF v_patient IS NULL THEN RAISE EXCEPTION 'Emergency episode not found or already closed'; END IF;
  v_request_number := 'EM-LAB-' || substr(replace(v_lab::text, '-', ''), 1, 12);

  INSERT INTO public.lab_requests(
    id, patient_id, visit_id, request_number, tests, diagnosis, status, requested_by, requested_at,
    printed, emergency_episode_id, emergency_authorized_at, emergency_authorized_by
  ) VALUES (
    v_lab, v_patient, v_visit, v_request_number, _tests, NULLIF(trim(COALESCE(_diagnosis,'')), ''),
    'emergency_authorized', v_uid::text, now(), false, _episode_id, now(), v_uid
  );

  INSERT INTO public.emergency_episode_items(
    episode_id, item_type, description, quantity, unit_price, administered_now, status,
    lab_request_id, created_by, notes
  ) VALUES (
    _episode_id, 'lab', array_to_string(_tests, ', '), 1, GREATEST(COALESCE(_total,0),0), false,
    'authorized', v_lab, v_uid, NULLIF(trim(COALESCE(_notes,'')), '')
  ) RETURNING id INTO v_item;
  SELECT public.write_audit_log('emergency_lab_authorized', 'lab_request', v_lab::text, jsonb_build_object('episode_id', _episode_id, 'patient_id', v_patient, 'tests', to_jsonb(_tests)), 'success');
  RETURN v_lab;
END;
$$;

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
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['lab_tech','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only laboratory staff can complete an emergency laboratory request';
  END IF;
  SELECT emergency_episode_id, patient_id INTO v_episode, v_patient FROM public.lab_requests WHERE id = _lab_request_id;
  IF v_episode IS NULL THEN RAISE EXCEPTION 'Emergency laboratory request not found'; END IF;
  UPDATE public.lab_requests SET status='completed', results=_results, completed_at=now(), emergency_result_path=_result_path, updated_at=now() WHERE id=_lab_request_id;
  UPDATE public.emergency_episode_items SET status='completed', updated_at=now() WHERE lab_request_id=_lab_request_id;
  SELECT public.write_audit_log('emergency_lab_completed', 'lab_request', _lab_request_id::text, jsonb_build_object('episode_id', v_episode, 'patient_id', v_patient), 'success');
  RETURN jsonb_build_object('lab_request_id', _lab_request_id, 'episode_id', v_episode, 'patient_id', v_patient, 'status', 'completed');
END;
$$;

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
  v_invoice UUID;
  v_invoice_item UUID;
  v_snap UUID;
  v_total NUMERIC := 0;
  v_original NUMERIC := 0;
  v_description TEXT;
  v_quantity INT8;
  v_unit_price NUMERIC;
  v_item_type TEXT;
  v_administered BOOL;
  v_item_id UUID;
  v_remaining JSONB;
  v_account_type TEXT;
  v_corporate_id UUID;
  v_patient_status TEXT;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['nurse','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to reconcile emergency episode';
  END IF;
  SELECT patient_id, visit_id, admission_id INTO v_patient, v_visit, v_admission FROM public.emergency_episodes WHERE id=_episode_id AND status='open';
  IF v_patient IS NULL THEN RAISE EXCEPTION 'Emergency episode not found or already reconciled'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.emergency_episode_items WHERE episode_id=_episode_id AND status <> 'cancelled') THEN
    RAISE EXCEPTION 'Emergency episode has no items';
  END IF;

  SELECT account_type, corporate_id, status INTO v_account_type, v_corporate_id, v_patient_status FROM public.patients WHERE id=v_patient;
  SELECT COALESCE(SUM(quantity * unit_price),0) INTO v_total FROM public.emergency_episode_items WHERE episode_id=_episode_id AND status <> 'cancelled';
  v_original := v_total;

  INSERT INTO public.invoices(
    patient_id, visit_id, invoice_number, total_amount, original_amount, discount_amount, paid_amount,
    status, payment_method, notes, sponsor_type, corporate_account_id, created_by
  ) VALUES (
    v_patient, v_visit, '', v_total, v_original, 0, 0, 'pending', NULL,
    COALESCE(NULLIF(trim(_billing_note),''), 'Emergency Episode ' || substr(_episode_id::text,1,8) || ' — reconcile urgent care items'),
    v_account_type, CASE WHEN v_account_type IN ('corporate','retainer') THEN v_corporate_id ELSE NULL END, v_uid::text
  ) RETURNING id INTO v_invoice;

  INSERT INTO public.invoice_items(invoice_id, emergency_episode_item_id, description, quantity, unit_price, total, category, dispensing_status, dispensing_notes)
  SELECT
    v_invoice, id, description, quantity, unit_price, quantity*unit_price,
    CASE WHEN item_type='medication' THEN 'drug' ELSE 'lab' END,
    CASE WHEN administered_now OR item_type='lab' THEN 'dispensed' ELSE 'pending' END,
    CASE WHEN administered_now THEN 'Administered during emergency; do not re-dispense.' WHEN item_type='lab' THEN 'Emergency laboratory work performed before payment.' ELSE NULL END
  FROM public.emergency_episode_items
  WHERE episode_id=_episode_id AND status <> 'cancelled';

  UPDATE public.emergency_episode_items e
  SET invoice_item_id = i.id,
      status = CASE WHEN e.administered_now OR e.item_type='lab' THEN 'billed' ELSE 'pending_billing' END,
      updated_at = now()
  FROM public.invoice_items i
  WHERE i.invoice_id = v_invoice AND i.emergency_episode_item_id = e.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', description, 'size', NULL, 'category', 'drug', 'qty', quantity, 'unit_price', unit_price
  ) ORDER BY created_at), '[]'::jsonb)
  INTO v_remaining
  FROM public.emergency_episode_items
  WHERE episode_id=_episode_id AND item_type='medication' AND NOT administered_now AND status <> 'cancelled';

  IF jsonb_array_length(v_remaining) > 0 THEN
    INSERT INTO public.snap_orders(
      patient_id, visit_id, order_type, target_station, source_role, status, created_by,
      original_sender_role, intent, note, ocr_text, matched_items, invoice_id, is_admitted_snap
    ) VALUES (
      v_patient, v_visit, 'prescription', 'pharmacy', 'nurse', 'awaiting_payment', v_uid,
      'nurse', 'emergency_remainder', 'Emergency Episode ' || substr(_episode_id::text,1,8) || ' — remaining items only',
      'EMERGENCY_EPISODE:' || _episode_id::text, v_remaining, v_invoice, false
    ) RETURNING id INTO v_snap;
  END IF;

  IF v_patient_status <> 'admitted' THEN
    UPDATE public.patients SET status='awaiting_payment', updated_at=now() WHERE id=v_patient;
  END IF;

  UPDATE public.emergency_episodes SET status='reconciled', invoice_id=v_invoice, reconciled_at=now(), reconciled_by=v_uid, updated_at=now() WHERE id=_episode_id;
  SELECT public.write_audit_log('emergency_episode_reconciled', 'emergency_episode', _episode_id::text, jsonb_build_object('patient_id', v_patient, 'invoice_id', v_invoice, 'remaining_pharmacy_snap_id', v_snap, 'total', v_total), 'success');
  RETURN jsonb_build_object('episode_id', _episode_id, 'patient_id', v_patient, 'invoice_id', v_invoice, 'remaining_pharmacy_snap_id', v_snap, 'total', v_total, 'status', 'reconciled');
END;
$$;

-- When the combined invoice is paid, unlock only the non-administered remainder for pharmacy.
CREATE OR REPLACE FUNCTION public.release_emergency_pharmacy_snap_after_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (new).status = 'paid' AND (old).status <> 'paid' THEN
    UPDATE public.snap_orders
    SET status='paid', paid_at=COALESCE((new).paid_at, now()), updated_at=now()
    WHERE invoice_id=(new).id AND intent='emergency_remainder' AND status IN ('awaiting_payment','pending_billing');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_release_emergency_pharmacy_snap ON public.invoices;
CREATE TRIGGER invoices_release_emergency_pharmacy_snap
AFTER UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.release_emergency_pharmacy_snap_after_payment();

GRANT EXECUTE ON FUNCTION public.start_emergency_episode(UUID,UUID,UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_emergency_medication(UUID,UUID,TEXT,TEXT,TEXT,INT8,NUMERIC,BOOL,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_emergency_lab_request(UUID,TEXT[],TEXT,NUMERIC,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_emergency_lab_request(UUID,JSONB,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_emergency_episode(UUID,TEXT) TO authenticated;
