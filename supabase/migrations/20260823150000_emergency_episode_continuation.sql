-- Emergency Episode continuation: keep doctor and admitted-patient actions inside
-- one open episode until the episode is explicitly reconciled.

ALTER TABLE public.prescriptions
  ADD COLUMN IF NOT EXISTS emergency_episode_id UUID;

ALTER TABLE public.snap_orders
  ADD COLUMN IF NOT EXISTS emergency_episode_id UUID;

ALTER TABLE public.emergency_episode_items
  ADD COLUMN IF NOT EXISTS source_snap_id UUID,
  ADD COLUMN IF NOT EXISTS source_prescription_id UUID;

CREATE INDEX IF NOT EXISTS prescriptions_emergency_episode_idx
  ON public.prescriptions(emergency_episode_id, created_at DESC);
CREATE INDEX IF NOT EXISTS snap_orders_emergency_episode_idx
  ON public.snap_orders(emergency_episode_id, created_at DESC);

-- If an emergency episode exists before admission, admission remains part of the
-- same episode. This also covers a doctor creating an admission from the doctor view.
CREATE OR REPLACE FUNCTION public.link_admission_to_emergency_episode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER AS $$
BEGIN
  UPDATE public.emergency_episodes
  SET admission_id = (new).id,
      visit_id = COALESCE((new).visit_id, visit_id),
      updated_at = now()
  WHERE patient_id = (new).patient_id
    AND status = 'open'
    AND admission_id IS NULL;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS admissions_link_emergency_episode ON public.admissions;
CREATE TRIGGER admissions_link_emergency_episode
AFTER INSERT ON public.admissions
FOR EACH ROW EXECUTE FUNCTION public.link_admission_to_emergency_episode();

-- Starting/resuming an open episode also refreshes its visit/admission context.
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
  IF v_episode IS NOT NULL THEN
    UPDATE public.emergency_episodes
    SET visit_id = COALESCE(_visit_id, visit_id),
        admission_id = COALESCE(_admission_id, admission_id),
        notes = COALESCE(NULLIF(trim(COALESCE(_notes,'')), ''), notes),
        updated_at = now()
    WHERE id = v_episode;
    RETURN v_episode;
  END IF;

  INSERT INTO public.emergency_episodes(patient_id, visit_id, admission_id, created_by, notes)
  VALUES (_patient_id, _visit_id, _admission_id, v_uid, NULLIF(trim(COALESCE(_notes,'')), ''))
  RETURNING id INTO v_episode;
  SELECT public.write_audit_log('emergency_episode_started', 'emergency_episode', v_episode::text, jsonb_build_object('patient_id', _patient_id), 'success');
  RETURN v_episode;
END;
$$;

-- Typed doctor continuation. The clinical record is retained, while the episode
-- item keeps the action out of ordinary Billing until reconciliation.
CREATE OR REPLACE FUNCTION public.create_emergency_prescription_from_typed(
  _episode_id UUID,
  _patient_id UUID,
  _visit_id UUID,
  _diagnosis TEXT,
  _notes TEXT,
  _items JSONB
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid UUID := public.hms_current_user_id();
  v_patient UUID;
  v_prescription UUID;
  v_text TEXT;
  v_episode_item UUID;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['nurse','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to create an emergency prescription';
  END IF;
  SELECT patient_id INTO v_patient FROM public.emergency_episodes WHERE id = _episode_id AND status = 'open';
  IF v_patient IS NULL OR v_patient <> _patient_id THEN RAISE EXCEPTION 'Emergency episode not found or patient mismatch'; END IF;
  IF _visit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.visits WHERE id = _visit_id AND patient_id = _patient_id) THEN RAISE EXCEPTION 'Invalid visit for patient'; END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'At least one medication is required'; END IF;

  INSERT INTO public.prescriptions(patient_id, visit_id, diagnosis, notes, status, created_by, emergency_episode_id)
  VALUES (_patient_id, _visit_id, COALESCE(_diagnosis,''), COALESCE(_notes,''), 'pending', v_uid::text, _episode_id)
  RETURNING id INTO v_prescription;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_items) AS item
    WHERE COALESCE(item->>'medication','') = ''
      OR COALESCE(item->>'dosage','') = ''
      OR COALESCE(item->>'frequency','') = ''
      OR COALESCE(item->>'duration','') = ''
      OR NOT (COALESCE(item->>'quantity','') ~ '^[0-9]+$')
      OR CASE WHEN COALESCE(item->>'quantity','') ~ '^[0-9]+$' THEN (item->>'quantity')::int <= 0 ELSE false END
  ) THEN
    RAISE EXCEPTION 'Each emergency prescription item requires medication, dosage, frequency, duration, and a positive integer quantity';
  END IF;

  INSERT INTO public.prescription_items(prescription_id, medication, dosage, frequency, duration, quantity, dispensed)
  SELECT v_prescription, item->>'medication', item->>'dosage', item->>'frequency', item->>'duration', (item->>'quantity')::int, false
  FROM jsonb_array_elements(_items) AS item;

  v_text := COALESCE(NULLIF(trim(_notes), ''), 'Typed emergency prescription');
  INSERT INTO public.emergency_episode_items(
    episode_id, item_type, description, quantity, unit_price, administered_now, status,
    created_by, source_prescription_id, notes
  ) VALUES (
    _episode_id, 'medication', left(v_text, 500), 1, 0, false, 'pending_billing',
    v_uid, v_prescription, 'Typed prescription retained under Emergency Episode; price review during reconciliation.'
  ) RETURNING id INTO v_episode_item;

  SELECT public.write_audit_log('emergency_typed_prescription_created', 'prescription', v_prescription::text, jsonb_build_object('episode_id', _episode_id, 'episode_item_id', v_episode_item), 'success');
  RETURN v_prescription;
END;
$$;

-- Typed emergency lab continuation. Lab can start immediately; financial status
-- remains emergency_authorized until the episode is reconciled.
CREATE OR REPLACE FUNCTION public.create_emergency_lab_from_typed(
  _episode_id UUID,
  _patient_id UUID,
  _visit_id UUID,
  _diagnosis TEXT,
  _tests TEXT[]
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid UUID := public.hms_current_user_id();
  v_patient UUID;
  v_lab UUID := gen_random_uuid();
  v_item UUID;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['nurse','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to create an emergency lab request';
  END IF;
  SELECT patient_id INTO v_patient FROM public.emergency_episodes WHERE id = _episode_id AND status = 'open';
  IF v_patient IS NULL OR v_patient <> _patient_id THEN RAISE EXCEPTION 'Emergency episode not found or patient mismatch'; END IF;
  IF _visit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.visits WHERE id = _visit_id AND patient_id = _patient_id) THEN RAISE EXCEPTION 'Invalid visit for patient'; END IF;
  IF _tests IS NULL OR array_length(_tests,1) IS NULL THEN RAISE EXCEPTION 'At least one laboratory test is required'; END IF;

  INSERT INTO public.lab_requests(
    id, patient_id, visit_id, request_number, tests, diagnosis, status, requested_by, requested_at,
    printed, emergency_episode_id, emergency_authorized_at, emergency_authorized_by
  ) VALUES (
    v_lab, _patient_id, _visit_id, 'EM-LAB-' || substr(replace(v_lab::text,'-',''),1,12), _tests,
    NULLIF(trim(COALESCE(_diagnosis,'')), ''), 'emergency_authorized', v_uid::text, now(), false,
    _episode_id, now(), v_uid
  );

  INSERT INTO public.emergency_episode_items(
    episode_id, item_type, description, quantity, unit_price, administered_now, status,
    lab_request_id, created_by, notes
  ) VALUES (
    _episode_id, 'lab', array_to_string(_tests, ', '), 1, 0, false, 'authorized',
    v_lab, v_uid, 'Typed emergency lab request; performed before payment.'
  ) RETURNING id INTO v_item;

  SELECT public.write_audit_log('emergency_typed_lab_created', 'lab_request', v_lab::text, jsonb_build_object('episode_id', _episode_id, 'episode_item_id', v_item), 'success');
  RETURN v_lab;
END;
$$;

-- Snap continuation from the admitted-patient panel. It is acknowledged for the
-- clinical station, never pending_billing, and its clinical lines are episode items.
CREATE OR REPLACE FUNCTION public.record_emergency_admitted_order(
  _episode_id UUID,
  _order_type TEXT,
  _target_station TEXT,
  _photo_path TEXT,
  _note TEXT,
  _items JSONB
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid UUID := public.hms_current_user_id();
  v_patient UUID;
  v_visit UUID;
  v_snap UUID;
  v_lab UUID := gen_random_uuid();
  v_episode_item UUID;
  v_desc TEXT;
  v_total NUMERIC := 0;
  v_tests TEXT[];
  v_is_admitted BOOL := false;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['nurse','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to record emergency admitted order';
  END IF;
  IF _order_type NOT IN ('prescription','lab') THEN RAISE EXCEPTION 'Only prescription or lab emergency orders are supported'; END IF;
  SELECT patient_id, visit_id INTO v_patient, v_visit FROM public.emergency_episodes WHERE id = _episode_id AND status = 'open';
  IF v_patient IS NULL THEN RAISE EXCEPTION 'Emergency episode not found or already closed'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.admissions WHERE patient_id = v_patient AND status = 'active') INTO v_is_admitted;

  INSERT INTO public.snap_orders(
    patient_id, visit_id, order_type, target_station, source_role, photo_path, note,
    matched_items, status, created_by, original_sender_role, intent, is_admitted_snap,
    emergency_episode_id, ocr_text
  ) VALUES (
    v_patient, v_visit, _order_type, _target_station,
    COALESCE((SELECT role::text FROM public.user_roles WHERE user_id = v_uid LIMIT 1), 'doctor'),
    _photo_path, _note, COALESCE(_items,'[]'::jsonb), 'acknowledged', v_uid,
    COALESCE((SELECT role::text FROM public.user_roles WHERE user_id = v_uid LIMIT 1), 'doctor'),
    'emergency_episode', v_is_admitted, _episode_id, 'EMERGENCY_EPISODE:' || _episode_id::text
  ) RETURNING id INTO v_snap;

  IF _order_type = 'prescription' THEN
    IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
      INSERT INTO public.emergency_episode_items(
        episode_id, item_type, description, quantity, unit_price, administered_now, status,
        created_by, source_snap_id, notes
      ) VALUES (
        _episode_id, 'medication', 'Emergency prescription snap — see attached order', 1, 0, false,
        'pending_billing', v_uid, v_snap, 'Price review required during episode reconciliation.'
      );
    ELSE
      INSERT INTO public.emergency_episode_items(
        episode_id, item_type, pricelist_id, description, quantity, unit_price,
        administered_now, status, created_by, source_snap_id, notes
      )
      SELECT
        _episode_id, 'medication', NULLIF(item->>'pricelist_id','')::uuid,
        NULLIF(trim(COALESCE(item->>'name', item->>'description')), ''),
        GREATEST(COALESCE((item->>'qty')::int,1),1), GREATEST(COALESCE((item->>'unit_price')::numeric,0),0),
        false, 'pending_billing', v_uid, v_snap, 'Admitted emergency prescription; dispense only after episode payment.'
      FROM jsonb_array_elements(_items) AS item
      WHERE NULLIF(trim(COALESCE(item->>'name', item->>'description')), '') IS NOT NULL;
    END IF;
  ELSE
    SELECT COALESCE(
      array_agg(COALESCE(NULLIF(trim(value->>'name'), ''), NULLIF(trim(value->>'description'), ''))),
      ARRAY['See attached emergency laboratory order snap']::text[]
    )
    INTO v_tests FROM jsonb_array_elements(COALESCE(_items,'[]'::jsonb)) AS value
    WHERE COALESCE(NULLIF(trim(value->>'name'), ''), NULLIF(trim(value->>'description'), '')) IS NOT NULL;
    IF v_tests IS NULL OR array_length(v_tests,1) IS NULL THEN v_tests := ARRAY['See attached emergency laboratory order snap']::text[]; END IF;
    INSERT INTO public.lab_requests(
      id, patient_id, visit_id, request_number, tests, status, requested_by, requested_at,
      printed, emergency_episode_id, emergency_authorized_at, emergency_authorized_by
    ) VALUES (
      v_lab, v_patient, v_visit, 'EM-LAB-' || substr(replace(v_lab::text,'-',''),1,12), v_tests,
      'emergency_authorized', v_uid::text, now(), false, _episode_id, now(), v_uid
    );
    INSERT INTO public.emergency_episode_items(
      episode_id, item_type, description, quantity, unit_price, administered_now, status,
      lab_request_id, created_by, source_snap_id, notes
    ) VALUES (
      _episode_id, 'lab', array_to_string(v_tests, ', '), 1, 0, false, 'authorized',
      v_lab, v_uid, v_snap, 'Admitted emergency lab snap; may be performed before payment.'
    );
  END IF;

  SELECT public.write_audit_log('emergency_admitted_order_recorded', 'snap_order', v_snap::text, jsonb_build_object('episode_id', _episode_id, 'patient_id', v_patient, 'order_type', _order_type), 'success');
  RETURN v_snap;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_emergency_episode(UUID,UUID,UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_emergency_prescription_from_typed(UUID,UUID,UUID,TEXT,TEXT,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_emergency_lab_from_typed(UUID,UUID,UUID,TEXT,TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_emergency_admitted_order(UUID,TEXT,TEXT,TEXT,TEXT,JSONB) TO authenticated;
