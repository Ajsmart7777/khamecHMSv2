
-- 1. Drop manual insert policies so direct inserts are denied
DROP POLICY IF EXISTS "Doctors can insert prescriptions" ON public.prescriptions;
DROP POLICY IF EXISTS "Doctors can insert prescription_items" ON public.prescription_items;
DROP POLICY IF EXISTS "Doctors and lab_tech can insert lab_requests" ON public.lab_requests;

-- 2. Snap -> prescription helper (pharmacist only, snap must be paid pharmacy snap)
CREATE OR REPLACE FUNCTION public.create_prescription_from_snap(
  _snap_id uuid,
  _diagnosis text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _items jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snap public.snap_orders%ROWTYPE;
  v_uid  uuid := auth.uid();
  v_prescription_id uuid;
  v_item jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_any_role(v_uid, ARRAY['pharmacist','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only pharmacists can materialise prescriptions from snaps';
  END IF;

  SELECT * INTO v_snap FROM public.snap_orders WHERE id = _snap_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snap order % not found', _snap_id;
  END IF;
  IF v_snap.target_station <> 'pharmacy' OR v_snap.order_type <> 'prescription' THEN
    RAISE EXCEPTION 'Snap % is not a pharmacy prescription snap', _snap_id;
  END IF;
  IF v_snap.status NOT IN ('paid','fulfilled') THEN
    RAISE EXCEPTION 'Snap % must be paid before creating a prescription (status=%)', _snap_id, v_snap.status;
  END IF;

  INSERT INTO public.prescriptions (patient_id, visit_id, diagnosis, notes, status, created_by)
  VALUES (v_snap.patient_id, v_snap.visit_id, _diagnosis, _notes, 'dispensed', v_uid::text)
  RETURNING id INTO v_prescription_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_items, '[]'::jsonb))
  LOOP
    INSERT INTO public.prescription_items
      (prescription_id, medication, dosage, frequency, duration, quantity, dispensed)
    VALUES (
      v_prescription_id,
      COALESCE(v_item->>'medication', v_item->>'name', 'Unknown'),
      COALESCE(v_item->>'dosage', ''),
      COALESCE(v_item->>'frequency', ''),
      COALESCE(v_item->>'duration', ''),
      COALESCE((v_item->>'quantity')::int, (v_item->>'qty')::int, 1),
      true
    );
  END LOOP;

  RETURN v_prescription_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_prescription_from_snap(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_prescription_from_snap(uuid, text, text, jsonb) TO authenticated;

-- 3. Snap -> lab_request helper (lab_tech only)
CREATE OR REPLACE FUNCTION public.create_lab_request_from_snap(
  _snap_id uuid,
  _tests text[],
  _diagnosis text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snap public.snap_orders%ROWTYPE;
  v_uid  uuid := auth.uid();
  v_lab_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_any_role(v_uid, ARRAY['lab_tech','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only lab technicians can materialise lab requests from snaps';
  END IF;

  SELECT * INTO v_snap FROM public.snap_orders WHERE id = _snap_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snap order % not found', _snap_id;
  END IF;
  IF v_snap.target_station <> 'lab' OR v_snap.order_type NOT IN ('lab','lab_result') THEN
    RAISE EXCEPTION 'Snap % is not a lab snap', _snap_id;
  END IF;
  IF v_snap.status NOT IN ('paid','fulfilled') THEN
    RAISE EXCEPTION 'Snap % must be paid before creating a lab request (status=%)', _snap_id, v_snap.status;
  END IF;
  IF _tests IS NULL OR array_length(_tests, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one test is required';
  END IF;

  INSERT INTO public.lab_requests
    (patient_id, visit_id, tests, diagnosis, status, requested_by, requested_at, printed)
  VALUES (
    v_snap.patient_id, v_snap.visit_id, _tests, _diagnosis,
    'pending', v_uid::text, now(), false
  )
  RETURNING id INTO v_lab_id;

  RETURN v_lab_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_lab_request_from_snap(uuid, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_lab_request_from_snap(uuid, text[], text) TO authenticated;
