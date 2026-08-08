-- 1. Create referral_letters table
CREATE TABLE IF NOT EXISTS public.referral_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL,
  destination TEXT NOT NULL,
  specialist TEXT,
  reason TEXT,
  clinical_notes TEXT,
  typed_body TEXT,
  input_method TEXT NOT NULL CHECK (input_method IN ('typed', 'snap')),
  snap_id UUID REFERENCES public.snap_orders(id) ON DELETE SET NULL,
  file_path TEXT, -- Internal storage path
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final', 'sent')),
  ref_number TEXT UNIQUE,
  finalized_at TIMESTAMPTZ,
  finalized_by UUID REFERENCES auth.users(id),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.referral_letters ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Staff can view all referrals"
  ON public.referral_letters FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Clinicians can create referrals"
  ON public.referral_letters FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]));

CREATE POLICY "Creators can update draft referrals"
  ON public.referral_letters FOR UPDATE TO authenticated
  USING (status = 'draft' AND (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin')))
  WITH CHECK (status = 'draft' AND (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin')));

-- Grants
GRANT SELECT, INSERT, UPDATE ON public.referral_letters TO authenticated;
GRANT ALL ON public.referral_letters TO service_role;

-- 2. Sequence for referrals
CREATE SEQUENCE IF NOT EXISTS public.referrals_number_seq START 1;
GRANT USAGE ON SEQUENCE public.referrals_number_seq TO authenticated;

-- 3. RPC: Create Prescription from Typed
CREATE OR REPLACE FUNCTION public.create_prescription_from_typed(
  _patient_id uuid,
  _visit_id uuid,
  _diagnosis text,
  _notes text,
  _items jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_prescription_id uuid;
  v_item jsonb;
  v_qty int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.has_any_role(v_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Unauthorized role';
  END IF;

  -- Validate patient/visit
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = _patient_id) THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;
  IF _visit_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.visits WHERE id = _visit_id AND patient_id = _patient_id) THEN
      RAISE EXCEPTION 'Invalid visit for patient';
    END IF;
  END IF;

  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'At least one medication is required';
  END IF;

  INSERT INTO public.prescriptions (patient_id, visit_id, diagnosis, notes, status, created_by)
  VALUES (_patient_id, _visit_id, _diagnosis, _notes, 'pending', v_uid::text)
  RETURNING id INTO v_prescription_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    -- Strict quantity validation
    IF v_item->>'quantity' IS NULL OR v_item->>'quantity' = '' THEN
        RAISE EXCEPTION 'Quantity is required for %', COALESCE(v_item->>'medication', 'item');
    END IF;
    
    -- Check if it's a valid integer (no decimals, no letters)
    IF (v_item->>'quantity') !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'Quantity must be a positive integer for %', COALESCE(v_item->>'medication', 'item');
    END IF;
    
    v_qty := (v_item->>'quantity')::int;
    IF v_qty <= 0 THEN
        RAISE EXCEPTION 'Quantity must be greater than zero for %', COALESCE(v_item->>'medication', 'item');
    END IF;

    IF COALESCE(v_item->>'medication', '') = '' THEN RAISE EXCEPTION 'Medication name is required'; END IF;
    IF COALESCE(v_item->>'dosage', '') = '' THEN RAISE EXCEPTION 'Dosage is required for %', v_item->>'medication'; END IF;
    IF COALESCE(v_item->>'frequency', '') = '' THEN RAISE EXCEPTION 'Frequency is required for %', v_item->>'medication'; END IF;
    IF COALESCE(v_item->>'duration', '') = '' THEN RAISE EXCEPTION 'Duration is required for %', v_item->>'medication'; END IF;

    INSERT INTO public.prescription_items
      (prescription_id, medication, dosage, frequency, duration, quantity, dispensed)
    VALUES (
      v_prescription_id,
      v_item->>'medication',
      v_item->>'dosage',
      v_item->>'frequency',
      v_item->>'duration',
      v_qty,
      false
    );
  END LOOP;

  PERFORM public.write_audit_log('create_typed_prescription', 'prescriptions', v_prescription_id::text, jsonb_build_object('patient_id', _patient_id), 'success');
  RETURN v_prescription_id;
END;
$$;

-- 4. RPC: Create Lab Request from Typed
CREATE OR REPLACE FUNCTION public.create_lab_request_from_typed(
  _patient_id uuid,
  _visit_id uuid,
  _diagnosis text,
  _tests text[]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lab_id uuid;
  v_req_num text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.has_any_role(v_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Unauthorized role';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = _patient_id) THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;
  IF _visit_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.visits WHERE id = _visit_id AND patient_id = _patient_id) THEN
      RAISE EXCEPTION 'Invalid visit for patient';
    END IF;
  END IF;

  IF _tests IS NULL OR array_length(_tests, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one test is required';
  END IF;

  -- Generate request number (matching existing convention if possible, otherwise serial)
  v_req_num := 'LAB-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('public.lab_requests_number_seq')::text, 4, '0');

  INSERT INTO public.lab_requests
    (patient_id, visit_id, tests, diagnosis, status, requested_by, requested_at, printed, request_number)
  VALUES (
    _patient_id, _visit_id, _tests, _diagnosis,
    'pending', v_uid::text, now(), false, v_req_num
  )
  RETURNING id INTO v_lab_id;

  PERFORM public.write_audit_log('create_typed_lab_request', 'lab_requests', v_lab_id::text, jsonb_build_object('patient_id', _patient_id), 'success');
  RETURN v_lab_id;
END;
$$;

-- 5. RPC: Finalize Referral
CREATE OR REPLACE FUNCTION public.finalize_referral(
  _referral_id uuid,
  _file_path text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ref public.referral_letters%ROWTYPE;
  v_ref_num text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_ref FROM public.referral_letters WHERE id = _referral_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Referral not found'; END IF;

  IF v_ref.created_by <> v_uid AND NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Unauthorized to finalize this referral';
  END IF;

  IF v_ref.status <> 'draft' THEN
    RAISE EXCEPTION 'Referral is already finalized or sent';
  END IF;

  IF COALESCE(v_ref.destination, '') = '' THEN
    RAISE EXCEPTION 'Destination is required to finalize referral';
  END IF;

  v_ref_num := 'REF-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('public.referrals_number_seq')::text, 4, '0');

  UPDATE public.referral_letters
  SET 
    status = 'final',
    ref_number = v_ref_num,
    file_path = COALESCE(_file_path, file_path),
    finalized_at = now(),
    finalized_by = v_uid,
    updated_at = now()
  WHERE id = _referral_id;

  -- Create EMR attachment if file_path is provided (avoid duplicates)
  IF _file_path IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.emr_attachments WHERE patient_id = v_ref.patient_id AND file_path = _file_path) THEN
        INSERT INTO public.emr_attachments (patient_id, visit_id, file_path, label, category, created_by)
        VALUES (v_ref.patient_id, v_ref.visit_id, _file_path, 'Referral Letter ' || v_ref_num, 'referral', v_uid);
    END IF;
  END IF;

  PERFORM public.write_audit_log('finalize_referral', 'referral_letters', _referral_id::text, jsonb_build_object('ref_number', v_ref_num), 'success');

  RETURN jsonb_build_object(
    'referral_id', _referral_id,
    'ref_number', v_ref_num
  );
END;
$$;

-- Grants for RPCs
GRANT EXECUTE ON FUNCTION public.create_prescription_from_typed(uuid, uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_lab_request_from_typed(uuid, uuid, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_referral(uuid, text) TO authenticated;

