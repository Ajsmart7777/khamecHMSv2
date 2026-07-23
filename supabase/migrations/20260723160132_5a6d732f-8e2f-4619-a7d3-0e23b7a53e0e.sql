
-- ============================================================
-- 1. Seed Wards A–E and rooms A1..E3 (idempotent)
-- ============================================================
DO $$
DECLARE
  _ward_id uuid;
  _room_id uuid;
  _ward_letter text;
  _room_num int;
  _is_vip boolean;
  _daily numeric;
  _room_class text;
BEGIN
  FOREACH _ward_letter IN ARRAY ARRAY['A','B','C','D','E'] LOOP
    _is_vip := (_ward_letter = 'E');
    SELECT id INTO _ward_id FROM public.wards WHERE name = 'Ward ' || _ward_letter LIMIT 1;
    IF _ward_id IS NULL THEN
      INSERT INTO public.wards (name, ward_type, gender, description, active, min_admission_deposit)
      VALUES (
        'Ward ' || _ward_letter,
        CASE WHEN _is_vip THEN 'vip' ELSE 'general' END,
        'any',
        CASE WHEN _is_vip THEN 'VIP ward' ELSE NULL END,
        true,
        0
      )
      RETURNING id INTO _ward_id;
    END IF;

    _daily := CASE WHEN _is_vip THEN 25000 ELSE 5000 END;
    _room_class := CASE WHEN _is_vip THEN 'vip' ELSE 'general' END;

    FOR _room_num IN 1..3 LOOP
      SELECT id INTO _room_id
        FROM public.rooms
        WHERE ward_id = _ward_id AND room_number = _ward_letter || _room_num
        LIMIT 1;
      IF _room_id IS NULL THEN
        INSERT INTO public.rooms (ward_id, room_number, room_class, daily_rate, active)
        VALUES (_ward_id, _ward_letter || _room_num, _room_class, _daily, true)
        RETURNING id INTO _room_id;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM public.beds WHERE room_id = _room_id) THEN
        INSERT INTO public.beds (room_id, bed_label, status, active)
        VALUES (_room_id, 'Bed 1', 'available', true);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ============================================================
-- 2. Extend admissions with admission-snap + ready-for-discharge fields
-- ============================================================
ALTER TABLE public.admissions
  ADD COLUMN IF NOT EXISTS admission_snap_path text,
  ADD COLUMN IF NOT EXISTS admission_note text,
  ADD COLUMN IF NOT EXISTS ready_for_discharge_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_for_discharge_by uuid,
  ADD COLUMN IF NOT EXISTS discharge_order_snap_id uuid;

-- ============================================================
-- 3. Extend snap_orders with a lightweight "intent" tag so admission
--    orders and discharge orders can be recognised without changing
--    the existing order_type contract.
-- ============================================================
ALTER TABLE public.snap_orders
  ADD COLUMN IF NOT EXISTS intent text;

-- ============================================================
-- 4. request_admission: create admission row + require snap image
-- ============================================================
CREATE OR REPLACE FUNCTION public.request_admission(
  _patient_id uuid,
  _reason text,
  _photo_path text,
  _note text DEFAULT NULL,
  _visit_id uuid DEFAULT NULL
) RETURNS uuid
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

  -- Also record the admission order as a snap for the timeline / OCR.
  INSERT INTO public.snap_orders (
    patient_id, visit_id, order_type, target_station, source_role,
    photo_path, note, status, created_by, original_sender_role, intent
  ) VALUES (
    _patient_id, _visit, 'treatment', 'nurse', COALESCE(_role,'nurse'),
    _photo_path, COALESCE(_note, _reason), 'acknowledged', _uid, COALESCE(_role,'nurse'),
    'admission_order'
  ) RETURNING id INTO _snap;

  PERFORM public.write_audit_log(
    'admission_requested', 'admission', _adm::text,
    jsonb_build_object('patient_id', _patient_id, 'snap_id', _snap, 'reason', _reason)
  );
  RETURN _adm;
END $$;

GRANT EXECUTE ON FUNCTION public.request_admission(uuid, text, text, text, uuid) TO authenticated;

-- ============================================================
-- 5. mark_ready_for_discharge: doctor snap discharges the admission logically
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_ready_for_discharge(
  _admission_id uuid,
  _snap_id uuid DEFAULT NULL,
  _note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _adm RECORD;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only doctors can create a discharge order';
  END IF;
  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF _adm.status <> 'active' THEN
    RAISE EXCEPTION 'Admission is not active (%)', _adm.status;
  END IF;

  UPDATE public.admissions
    SET status = 'ready_for_discharge',
        ready_for_discharge_at = now(),
        ready_for_discharge_by = _uid,
        discharge_order_snap_id = _snap_id,
        discharge_notes = COALESCE(_note, discharge_notes),
        updated_at = now()
  WHERE id = _admission_id;

  PERFORM public.write_audit_log(
    'discharge_order_signed', 'admission', _admission_id::text,
    jsonb_build_object('patient_id', _adm.patient_id, 'snap_id', _snap_id, 'note', _note)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.mark_ready_for_discharge(uuid, uuid, text) TO authenticated;

-- ============================================================
-- 6. forward_snap_to_billing: reuse an existing snap image to create a
--    fresh Pharmacy or Lab task that goes through billing (no rewrite).
-- ============================================================
CREATE OR REPLACE FUNCTION public.forward_snap_to_billing(
  _source_snap_id uuid,
  _target_station text,
  _note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _src RECORD;
  _new uuid;
  _role text;
  _order_type text;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _target_station NOT IN ('pharmacy','lab') THEN
    RAISE EXCEPTION 'Target must be pharmacy or lab';
  END IF;

  SELECT * INTO _src FROM public.snap_orders WHERE id = _source_snap_id;
  IF _src IS NULL THEN RAISE EXCEPTION 'Source snap not found'; END IF;

  _order_type := CASE _target_station WHEN 'lab' THEN 'lab' ELSE 'prescription' END;
  SELECT role::text INTO _role FROM public.user_roles WHERE user_id = _uid LIMIT 1;

  INSERT INTO public.snap_orders (
    patient_id, visit_id, order_type, target_station, source_role,
    photo_path, note, status, created_by, original_sender_role,
    parent_snap_id, matched_items, ocr_text, ocr_confidence
  ) VALUES (
    _src.patient_id, _src.visit_id, _order_type, _target_station,
    COALESCE(_role, _src.source_role),
    _src.photo_path,
    COALESCE(_note, 'Forwarded from admitted patient snap'),
    'pending_billing', _uid, COALESCE(_role, _src.source_role),
    _src.id, COALESCE(_src.matched_items, '[]'::jsonb),
    _src.ocr_text, _src.ocr_confidence
  ) RETURNING id INTO _new;

  PERFORM public.write_audit_log(
    'snap_forwarded_to_billing', 'snap_order', _new::text,
    jsonb_build_object(
      'source_snap_id', _src.id,
      'patient_id', _src.patient_id,
      'target_station', _target_station
    )
  );
  RETURN _new;
END $$;

GRANT EXECUTE ON FUNCTION public.forward_snap_to_billing(uuid, text, text) TO authenticated;
