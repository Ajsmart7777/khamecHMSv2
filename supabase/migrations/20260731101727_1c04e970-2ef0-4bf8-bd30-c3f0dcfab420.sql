CREATE OR REPLACE FUNCTION public.request_admission(_patient_id uuid, _reason text DEFAULT NULL, _photo_path text DEFAULT NULL, _note text DEFAULT NULL, _visit_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _adm uuid;
  _visit uuid;
  _snap uuid;
  _role text;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to admit';
  END IF;
  IF _photo_path IS NULL OR length(trim(_photo_path)) = 0 THEN
    RAISE EXCEPTION 'ADMISSION_SNAP_REQUIRED: an admission-order photo is required';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.admissions
     WHERE patient_id = _patient_id
       AND status IN ('waiting_assignment','active','ready_for_discharge')
  ) THEN
    RAISE EXCEPTION 'Patient already has an open admission';
  END IF;

  _visit := _visit_id;
  IF _visit IS NULL THEN
    SELECT id INTO _visit FROM public.visits
     WHERE patient_id = _patient_id AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1;
  END IF;

  INSERT INTO public.admissions (
    patient_id, visit_id, admitting_doctor, reason, status,
    admission_snap_path, admission_note
  ) VALUES (
    _patient_id, _visit, _uid, _reason, 'waiting_assignment',
    _photo_path, _note
  ) RETURNING id INTO _adm;

  SELECT role::text INTO _role FROM public.user_roles WHERE user_id = _uid LIMIT 1;

  INSERT INTO public.snap_orders (
    patient_id, visit_id, order_type, target_station, source_role,
    photo_path, note, status, created_by, original_sender_role, intent
  ) VALUES (
    _patient_id, _visit, 'treatment', 'nurse', COALESCE(_role,'nurse'),
    _photo_path, COALESCE(_note, _reason), 'acknowledged', _uid, COALESCE(_role,'nurse'),
    'admission_order'
  ) RETURNING id INTO _snap;

  -- Move the patient out of the normal station queues into Awaiting Room.
  UPDATE public.patients
     SET status = 'awaiting_room', updated_at = now()
   WHERE id = _patient_id;

  PERFORM public.advance_journey(
    _patient_id, 'awaiting_room', 'nurse', NULL, 'nurse', 'Awaiting Room', _visit,
    'Admission requested'
  );

  PERFORM public.write_audit_log(
    'admission_requested', 'admission', _adm::text,
    jsonb_build_object('patient_id', _patient_id, 'snap_id', _snap, 'reason', _reason)
  );
  RETURN _adm;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_admission_bed(_admission_id uuid, _bed_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _adm RECORD;
  _bed RECORD;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only a nurse or admin can assign a ward/room/bed';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF _adm.status <> 'waiting_assignment' THEN
    RAISE EXCEPTION 'Admission is not waiting for a room (%)', _adm.status;
  END IF;

  SELECT * INTO _bed FROM public.beds WHERE id = _bed_id FOR UPDATE;
  IF _bed IS NULL OR NOT _bed.active THEN RAISE EXCEPTION 'Bed not found or inactive'; END IF;
  IF _bed.status <> 'available' THEN RAISE EXCEPTION 'Bed is not available'; END IF;

  UPDATE public.admissions
     SET bed_id = _bed_id,
         assigned_by_nurse = _uid,
         status = 'active',
         admitted_at = now(),
         updated_at = now()
   WHERE id = _admission_id;

  UPDATE public.patients
     SET status = 'admitted', updated_at = now()
   WHERE id = _adm.patient_id;

  PERFORM public.advance_journey(
    _adm.patient_id, 'admitted', 'nurse', NULL, 'ward', 'Ward', _adm.visit_id,
    'Bed assigned'
  );

  PERFORM public.write_audit_log(
    'admission_bed_assigned', 'admission', _admission_id::text,
    jsonb_build_object('patient_id', _adm.patient_id, 'bed_id', _bed_id)
  );
END;
$$;

-- Backfill: patients with an open admission should not sit in station queues.
UPDATE public.patients p
   SET status = 'awaiting_room', updated_at = now()
  FROM public.admissions a
 WHERE a.patient_id = p.id
   AND a.status = 'waiting_assignment'
   AND p.status IN ('waiting','with_nurse','with_doctor');

UPDATE public.patients p
   SET status = 'admitted', updated_at = now()
  FROM public.admissions a
 WHERE a.patient_id = p.id
   AND a.status IN ('active','ready_for_discharge')
   AND p.status IN ('waiting','with_nurse','with_doctor','awaiting_room');