-- Fix for typed clinical orders (prescriptions and lab requests) to ensure they follow 
-- the sustainable workflow: they MUST pass through billing before reaching their target station.
-- This aligns their behavior with the "Snap" behavior, as requested.

-- 1. Update public.create_prescription_from_typed to create a snap_order record
-- with status 'pending_billing' instead of going straight to the patient card.
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
  v_snap_id uuid;
  v_item jsonb;
  v_qty int;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  
  -- Check roles
  IF NOT public.has_any_role(v_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Unauthorized role';
  END IF;

  -- Validate patient
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = _patient_id) THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;
  
  -- Validate visit
  IF _visit_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.visits WHERE id = _visit_id AND patient_id = _patient_id) THEN
      RAISE EXCEPTION 'Invalid visit for patient';
    END IF;
  END IF;

  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'At least one medication is required';
  END IF;

  -- 1. Create the prescription record
  INSERT INTO public.prescriptions (patient_id, visit_id, diagnosis, notes, status, created_by)
  VALUES (_patient_id, _visit_id, _diagnosis, _notes, 'pending', v_uid::text)
  RETURNING id INTO v_prescription_id;

  -- 2. Insert items
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    IF v_item->>'quantity' IS NULL OR v_item->>'quantity' = '' THEN
        RAISE EXCEPTION 'Quantity is required for %', COALESCE(v_item->>'medication', 'item');
    END IF;
    
    IF (v_item->>'quantity') !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'Quantity must be a positive integer for %', COALESCE(v_item->>'medication', 'item');
    END IF;
    
    v_qty := (v_item->>'quantity')::int;
    IF v_qty <= 0 THEN
        RAISE EXCEPTION 'Quantity must be greater than zero for %', COALESCE(v_item->>'medication', 'item');
    END IF;

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

  -- 3. SUSTAINABLE WORKFLOW: Create a snap_order pointing to Pharmacy via Billing
  -- This ensures it appears in the Billing queue first, just like snaps.
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;
  
  INSERT INTO public.snap_orders (
    patient_id, 
    visit_id, 
    order_type, 
    target_station, 
    source_role,
    status, 
    created_by, 
    original_sender_role,
    intent,
    note,
    -- We link it to the prescription record for reference
    ocr_text 
  ) VALUES (
    _patient_id, 
    _visit_id, 
    'prescription', 
    'pharmacy', 
    COALESCE(v_role, 'doctor'),
    'pending_billing', 
    v_uid, 
    COALESCE(v_role, 'doctor'),
    'typed_order',
    COALESCE(_notes, 'Typed Prescription'),
    'LINKED_PRESCRIPTION:' || v_prescription_id::text
  );

  -- Update patient status to ensure they appear in billing queues if not already there
  UPDATE public.patients SET status = 'awaiting_billing' WHERE id = _patient_id AND status != 'admitted';

  PERFORM public.write_audit_log('create_typed_prescription', 'prescriptions', v_prescription_id::text, jsonb_build_object('patient_id', _patient_id), 'success');
  
  RETURN v_prescription_id;
END;
$$;

-- 2. Update public.create_lab_request_from_typed to create a snap_order record
-- with status 'pending_billing' instead of going straight to the lab.
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
  v_role text;
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

  -- Generate request number
  v_req_num := 'LAB-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('public.lab_requests_number_seq')::text, 4, '0');

  -- 1. Create the lab request record
  INSERT INTO public.lab_requests
    (patient_id, visit_id, tests, diagnosis, status, requested_by, requested_at, printed, request_number)
  VALUES (
    _patient_id, _visit_id, _tests, _diagnosis,
    'pending', v_uid::text, now(), false, v_req_num
  )
  RETURNING id INTO v_lab_id;

  -- 2. SUSTAINABLE WORKFLOW: Create a snap_order pointing to Lab via Billing
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;

  INSERT INTO public.snap_orders (
    patient_id, 
    visit_id, 
    order_type, 
    target_station, 
    source_role,
    status, 
    created_by, 
    original_sender_role,
    intent,
    note,
    -- Link to lab request
    ocr_text
  ) VALUES (
    _patient_id, 
    _visit_id, 
    'lab', 
    'lab', 
    COALESCE(v_role, 'doctor'),
    'pending_billing', 
    v_uid, 
    COALESCE(v_role, 'doctor'),
    'typed_order',
    'Typed Lab Order: ' || array_to_string(_tests, ', '),
    'LINKED_LAB_REQUEST:' || v_lab_id::text
  );

  -- Update patient status
  UPDATE public.patients SET status = 'awaiting_billing' WHERE id = _patient_id AND status != 'admitted';

  PERFORM public.write_audit_log('create_typed_lab_request', 'lab_requests', v_lab_id::text, jsonb_build_object('patient_id', _patient_id), 'success');
  
  RETURN v_lab_id;
END;
$$;

-- Ensure grants are maintained
GRANT EXECUTE ON FUNCTION public.create_prescription_from_typed(uuid, uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_lab_request_from_typed(uuid, uuid, text, text[]) TO authenticated;
