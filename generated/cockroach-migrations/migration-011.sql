-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 10
DROP TRIGGER IF EXISTS app_settings_touch ON public.app_settings;

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 11
CREATE TRIGGER app_settings_touch
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 12
INSERT INTO public.app_settings (key, value)
VALUES ('ocr', jsonb_build_object('model', 'google/gemini-3.1-pro-preview'))
ON CONFLICT (key) DO NOTHING;

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 14
CREATE INDEX IF NOT EXISTS pricelist_name_trgm ON public.pricelist USING gin (name gin_trgm_ops);

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 15
CREATE INDEX IF NOT EXISTS inventory_items_name_trgm ON public.inventory_items USING gin (name gin_trgm_ops);

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 16
CREATE OR REPLACE FUNCTION public.match_catalogue(_query text, _limit int DEFAULT 3)
RETURNS TABLE (
  source text,
  id uuid,
  name text,
  price numeric,
  score real
)
LANGUAGE sql
STABLE
SECURITY DEFINER

AS $$
  (SELECT 'pricelist'::text AS source, p.id, p.name,
          COALESCE(p.price, 0)::numeric AS price,
          similarity(p.name, _query) AS score
     FROM public.pricelist p
     WHERE p.name % _query
     ORDER BY score DESC
     LIMIT _limit)
  UNION ALL
  (SELECT 'inventory'::text AS source, i.id, i.name,
          COALESCE(i.unit_price, 0)::numeric AS price,
          similarity(i.name, _query) AS score
     FROM public.inventory_items i
     WHERE i.name % _query
     ORDER BY score DESC
     LIMIT _limit)
  ORDER BY score DESC
  LIMIT _limit;
$$;

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 17
REVOKE ALL ON FUNCTION public.match_catalogue(text, int) FROM PUBLIC, anon;

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 18
GRANT EXECUTE ON FUNCTION public.match_catalogue(text, int) TO authenticated, service_role;

-- SOURCE: 20260722194538_ad8616f2-3796-4b28-aba4-c1b6f0217fd8.sql statement 1
CREATE OR REPLACE FUNCTION public.can_add_snap_for_patient(_patient_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER

AS $$
DECLARE
  _status text;
  _is_admitted boolean;
BEGIN
  IF _user_id IS NULL OR _patient_id IS NULL THEN RETURN false; END IF;

  -- Admin always allowed.
  IF public.has_role(_user_id, 'admin'::app_role) THEN RETURN true; END IF;

  SELECT status::text INTO _status FROM public.patients WHERE id = _patient_id;
  IF _status IS NULL THEN RETURN false; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.admissions
     WHERE patient_id = _patient_id AND status = 'active'
  ) INTO _is_admitted;

  -- Admitted patients: nursing/doctor roles retain ownership in the ward.
  IF _is_admitted OR _status = 'admitted' THEN
    RETURN public.has_any_role(_user_id,
      ARRAY['nurse','doctor','doctor1','doctor2']::app_role[]);
  END IF;

  RETURN CASE _status
    WHEN 'with_nurse'   THEN public.has_role(_user_id, 'nurse'::app_role)
    WHEN 'with_doctor'  THEN public.has_any_role(_user_id,
                              ARRAY['doctor','doctor1','doctor2']::app_role[])
    WHEN 'in_lab'       THEN public.has_role(_user_id, 'lab_tech'::app_role)
    WHEN 'at_pharmacy'  THEN public.has_role(_user_id, 'pharmacist'::app_role)
    ELSE false
  END;
END;
$$;

-- SOURCE: 20260722194538_ad8616f2-3796-4b28-aba4-c1b6f0217fd8.sql statement 2
REVOKE EXECUTE ON FUNCTION public.can_add_snap_for_patient(uuid, uuid) FROM PUBLIC, anon;

-- SOURCE: 20260722194538_ad8616f2-3796-4b28-aba4-c1b6f0217fd8.sql statement 3
GRANT EXECUTE ON FUNCTION public.can_add_snap_for_patient(uuid, uuid) TO authenticated;

-- SOURCE: 20260722194538_ad8616f2-3796-4b28-aba4-c1b6f0217fd8.sql statement 4
DROP POLICY IF EXISTS "Clinicians create snap orders" ON public.snap_orders;

-- SOURCE: 20260722194538_ad8616f2-3796-4b28-aba4-c1b6f0217fd8.sql statement 5
CREATE POLICY "Owner station can create snap orders"
ON public.snap_orders
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_any_role(public.hms_current_user_id(),
    ARRAY['nurse','doctor','doctor1','doctor2','lab_tech','pharmacist','admin']::app_role[])
  AND public.can_add_snap_for_patient(patient_id, public.hms_current_user_id())
);

-- SOURCE: 20260722195524_3fac40c0-504d-42e3-8726-cc9d15c53bdc.sql statement 1
ALTER TABLE public.snap_orders
  ADD COLUMN IF NOT EXISTS ocr_reviewed_lines jsonb,
  ADD COLUMN IF NOT EXISTS ocr_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ocr_reviewed_by uuid;

-- SOURCE: 20260723100418_c1f18793-7e24-465a-a798-5d165562bf18.sql statement 1
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS actor_role text;

-- SOURCE: 20260723100418_c1f18793-7e24-465a-a798-5d165562bf18.sql statement 2
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_role ON public.audit_logs(actor_role);

-- SOURCE: 20260723100418_c1f18793-7e24-465a-a798-5d165562bf18.sql statement 3
CREATE OR REPLACE FUNCTION public.current_actor_role(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER

AS $$
  SELECT string_agg(role::text, ',' ORDER BY role::text)
  FROM public.user_roles
  WHERE user_id = _user_id
$$;

-- SOURCE: 20260723100418_c1f18793-7e24-465a-a798-5d165562bf18.sql statement 4
REVOKE EXECUTE ON FUNCTION public.current_actor_role(uuid) FROM PUBLIC, anon;

-- SOURCE: 20260723100418_c1f18793-7e24-465a-a798-5d165562bf18.sql statement 5
GRANT EXECUTE ON FUNCTION public.current_actor_role(uuid) TO authenticated, service_role;

-- SOURCE: 20260723100418_c1f18793-7e24-465a-a798-5d165562bf18.sql statement 6
CREATE OR REPLACE FUNCTION public.write_audit_log(
  _action text,
  _resource_type text,
  _resource_id text,
  _details jsonb,
  _status text DEFAULT 'success'::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _uid  uuid := public.hms_current_user_id();
  _role text := public.current_actor_role(public.hms_current_user_id());
BEGIN
  INSERT INTO public.audit_logs
    (user_id, action, resource_type, resource_id, details, status, actor_role)
  VALUES
    (_uid, _action, _resource_type, _resource_id,
     COALESCE(_details, '{}'::jsonb) || jsonb_build_object('actor_role', _role),
     _status, _role);
END;
$$;

-- SOURCE: 20260723101414_686957d0-9e4f-4469-b6b8-e6c32402456c.sql statement 1
ALTER TABLE public.patients DROP CONSTRAINT IF EXISTS patients_status_check;

-- SOURCE: 20260723101414_686957d0-9e4f-4469-b6b8-e6c32402456c.sql statement 2
ALTER TABLE public.patients ADD CONSTRAINT patients_status_check CHECK (status = ANY (ARRAY['registered'::text, 'waiting'::text, 'with_nurse'::text, 'with_doctor'::text, 'in_lab'::text, 'awaiting_billing'::text, 'awaiting_payment'::text, 'at_pharmacy'::text, 'admitted'::text, 'discharged'::text, 'awaiting_room'::text]));

-- SOURCE: 20260723102306_7722fdd0-b982-4c1e-88ce-1a32145f2a82.sql statement 1
DROP POLICY IF EXISTS "Ops update snap orders" ON public.snap_orders;

-- SOURCE: 20260723102306_7722fdd0-b982-4c1e-88ce-1a32145f2a82.sql statement 2
CREATE POLICY "Billing update snap orders"
  ON public.snap_orders FOR UPDATE TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(),
    ARRAY['billing','accountant','admin']::app_role[]))
  WITH CHECK (public.has_any_role(public.hms_current_user_id(),
    ARRAY['billing','accountant','admin']::app_role[]));

-- SOURCE: 20260723102306_7722fdd0-b982-4c1e-88ce-1a32145f2a82.sql statement 3
CREATE POLICY "Fulfillers update only paid snap orders"
  ON public.snap_orders FOR UPDATE TO authenticated
  USING (
    public.has_any_role(public.hms_current_user_id(),
      ARRAY['pharmacist','lab_tech']::app_role[])
    AND status = 'paid'
  )
  WITH CHECK (
    public.has_any_role(public.hms_current_user_id(),
      ARRAY['pharmacist','lab_tech']::app_role[])
    AND status IN ('paid','fulfilled','rejected')
  );

-- SOURCE: 20260723102306_7722fdd0-b982-4c1e-88ce-1a32145f2a82.sql statement 4
CREATE OR REPLACE FUNCTION public.enforce_snap_paid_before_fulfill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
BEGIN
  IF (NEW).status = 'fulfilled'
     AND COALESCE((OLD).status,'') <> 'fulfilled'
     AND COALESCE((OLD).status,'') <> 'paid' THEN
    RAISE EXCEPTION 'PAYMENT_REQUIRED: snap % must be paid before it can be fulfilled (current status: %)',
      (NEW).id, (OLD).status;
  END IF;
  RETURN NEW;
END;
$$;

-- SOURCE: 20260723102306_7722fdd0-b982-4c1e-88ce-1a32145f2a82.sql statement 5
REVOKE EXECUTE ON FUNCTION public.enforce_snap_paid_before_fulfill() FROM PUBLIC, anon;

-- SOURCE: 20260723102306_7722fdd0-b982-4c1e-88ce-1a32145f2a82.sql statement 6
DROP TRIGGER IF EXISTS trg_snap_paid_before_fulfill ON public.snap_orders;

-- SOURCE: 20260723102306_7722fdd0-b982-4c1e-88ce-1a32145f2a82.sql statement 7
CREATE TRIGGER trg_snap_paid_before_fulfill
  BEFORE UPDATE ON public.snap_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_snap_paid_before_fulfill();

-- SOURCE: 20260723110404_8593a75f-69a4-41f8-9146-671d5ae24a12.sql statement 1
DROP POLICY IF EXISTS "read settings" ON public.app_settings;

-- SOURCE: 20260723110404_8593a75f-69a4-41f8-9146-671d5ae24a12.sql statement 2
CREATE POLICY "Admin reads settings"
  ON public.app_settings
  FOR SELECT
  TO authenticated
  USING (public.has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260723110404_8593a75f-69a4-41f8-9146-671d5ae24a12.sql statement 3
DROP POLICY IF EXISTS "Admin manages wards" ON public.wards;

-- SOURCE: 20260723110404_8593a75f-69a4-41f8-9146-671d5ae24a12.sql statement 4
CREATE POLICY "Admin manages wards"
  ON public.wards
  FOR ALL
  TO authenticated
  USING (public.has_role(public.hms_current_user_id(), 'admin'::app_role))
  WITH CHECK (public.has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260723110404_8593a75f-69a4-41f8-9146-671d5ae24a12.sql statement 5
DROP POLICY IF EXISTS "Admin manages rooms" ON public.rooms;

-- SOURCE: 20260723110404_8593a75f-69a4-41f8-9146-671d5ae24a12.sql statement 6
CREATE POLICY "Admin manages rooms"
  ON public.rooms
  FOR ALL
  TO authenticated
  USING (public.has_role(public.hms_current_user_id(), 'admin'::app_role))
  WITH CHECK (public.has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260723110404_8593a75f-69a4-41f8-9146-671d5ae24a12.sql statement 7
DROP POLICY IF EXISTS "Admin & nurses manage bed status" ON public.beds;

-- SOURCE: 20260723110404_8593a75f-69a4-41f8-9146-671d5ae24a12.sql statement 8
CREATE POLICY "Admin & nurses manage bed status"
  ON public.beds
  FOR ALL
  TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['admin','nurse']::app_role[]))
  WITH CHECK (public.has_any_role(public.hms_current_user_id(), ARRAY['admin','nurse']::app_role[]));

-- SOURCE: 20260723160132_5a6d732f-8e2f-4619-a7d3-0e23b7a53e0e.sql statement 1
INSERT INTO public.wards (name, ward_type, gender, description, active, min_admission_deposit)
VALUES
  ('Ward A', 'general', 'any', NULL, true, 0),
  ('Ward B', 'general', 'any', NULL, true, 0),
  ('Ward C', 'general', 'any', NULL, true, 0),
  ('Ward D', 'general', 'any', NULL, true, 0),
  ('Ward E', 'vip', 'any', 'VIP ward', true, 0)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.rooms (ward_id, room_number, room_class, daily_rate, active)
SELECT w.id, v.letter || n.number::text,
       CASE WHEN v.is_vip THEN 'vip' ELSE 'general' END,
       CASE WHEN v.is_vip THEN 25000 ELSE 5000 END,
       true
FROM public.wards AS w
JOIN (VALUES ('A', false), ('B', false), ('C', false), ('D', false), ('E', true)) AS v(letter, is_vip)
  ON w.name = 'Ward ' || v.letter
CROSS JOIN (VALUES (1), (2), (3)) AS n(number)
WHERE NOT EXISTS (
  SELECT 1 FROM public.rooms AS existing_room
  WHERE existing_room.ward_id = w.id
    AND existing_room.room_number = v.letter || n.number::text
);

INSERT INTO public.beds (room_id, bed_label, status, active)
SELECT r.id, 'Bed 1', 'available', true
FROM public.rooms AS r
WHERE NOT EXISTS (
  SELECT 1 FROM public.beds AS existing_bed
  WHERE existing_bed.room_id = r.id
);

-- SOURCE: 20260723160132_5a6d732f-8e2f-4619-a7d3-0e23b7a53e0e.sql statement 2
ALTER TABLE public.admissions
  ADD COLUMN IF NOT EXISTS admission_snap_path text,
  ADD COLUMN IF NOT EXISTS admission_note text,
  ADD COLUMN IF NOT EXISTS ready_for_discharge_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_for_discharge_by uuid,
  ADD COLUMN IF NOT EXISTS discharge_order_snap_id uuid;

-- SOURCE: 20260723160132_5a6d732f-8e2f-4619-a7d3-0e23b7a53e0e.sql statement 3
ALTER TABLE public.snap_orders
  ADD COLUMN IF NOT EXISTS intent text;

-- SOURCE: 20260723160132_5a6d732f-8e2f-4619-a7d3-0e23b7a53e0e.sql statement 4
CREATE OR REPLACE FUNCTION public.request_admission(
  _patient_id uuid,
  _reason text,
  _photo_path text,
  _note text DEFAULT NULL,
  _visit_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _uid uuid := public.hms_current_user_id();
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

  SELECT public.write_audit_log('admission_requested', 'admission', _adm::text, jsonb_build_object('patient_id', _patient_id, 'snap_id', _snap, 'reason', _reason)
  , 'success');
  RETURN _adm;
END $$;

-- SOURCE: 20260723160132_5a6d732f-8e2f-4619-a7d3-0e23b7a53e0e.sql statement 5
GRANT EXECUTE ON FUNCTION public.request_admission(uuid, text, text, text, uuid) TO authenticated;

-- SOURCE: 20260723160132_5a6d732f-8e2f-4619-a7d3-0e23b7a53e0e.sql statement 6
CREATE OR REPLACE FUNCTION public.mark_ready_for_discharge(
  _admission_id uuid,
  _snap_id uuid DEFAULT NULL,
  _note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _uid uuid := public.hms_current_user_id();
  _adm public.admissions;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only doctors can create a discharge order';
  END IF;
  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF (_adm).status <> 'active' THEN
    RAISE EXCEPTION 'Admission is not active (%)', (_adm).status;
  END IF;

  UPDATE public.admissions
    SET status = 'ready_for_discharge',
        ready_for_discharge_at = now(),
        ready_for_discharge_by = _uid,
        discharge_order_snap_id = _snap_id,
        discharge_notes = COALESCE(_note, discharge_notes),
        updated_at = now()
  WHERE id = _admission_id;

  SELECT public.write_audit_log('discharge_order_signed', 'admission', _admission_id::text, jsonb_build_object('patient_id', (_adm).patient_id, 'snap_id', _snap_id, 'note', _note)
  , 'success');
END $$;

-- SOURCE: 20260723160132_5a6d732f-8e2f-4619-a7d3-0e23b7a53e0e.sql statement 7
GRANT EXECUTE ON FUNCTION public.mark_ready_for_discharge(uuid, uuid, text) TO authenticated;

-- SOURCE: 20260723160132_5a6d732f-8e2f-4619-a7d3-0e23b7a53e0e.sql statement 8
CREATE OR REPLACE FUNCTION public.forward_snap_to_billing(
  _source_snap_id uuid,
  _target_station text,
  _note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _uid uuid := public.hms_current_user_id();
  _src public.snap_orders;
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
    (_src).patient_id, (_src).visit_id, _order_type, _target_station,
    COALESCE(_role, (_src).source_role),
    (_src).photo_path,
    COALESCE(_note, 'Forwarded from admitted patient snap'),
    'pending_billing', _uid, COALESCE(_role, (_src).source_role),
    (_src).id, COALESCE((_src).matched_items, '[]'::jsonb),
    (_src).ocr_text, (_src).ocr_confidence
  ) RETURNING id INTO _new;

  SELECT public.write_audit_log('snap_forwarded_to_billing', 'snap_order', _new::text, jsonb_build_object(
      'source_snap_id', (_src).id,
      'patient_id', (_src).patient_id,
      'target_station', _target_station
    )
  , 'success');
  RETURN _new;
END $$;

-- SOURCE: 20260723160132_5a6d732f-8e2f-4619-a7d3-0e23b7a53e0e.sql statement 9
GRANT EXECUTE ON FUNCTION public.forward_snap_to_billing(uuid, text, text) TO authenticated;

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 1
-- 1. patient_journey — current active journey row per patient
CREATE TABLE public.patient_journey (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  visit_id uuid,
  current_state text NOT NULL,
  owner_role text,
  owner_user_id uuid,
  department text,
  location text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (patient_id)
);

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 2
GRANT SELECT, INSERT, UPDATE ON public.patient_journey TO authenticated;

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 3
GRANT ALL ON public.patient_journey TO service_role;

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 4
ALTER TABLE public.patient_journey ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 5
CREATE POLICY "Staff can read journey"
  ON public.patient_journey FOR SELECT
  TO authenticated
  USING (public.is_authenticated_staff());

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 6
CREATE POLICY "Staff can insert journey"
  ON public.patient_journey FOR INSERT
  TO authenticated
  WITH CHECK (public.is_authenticated_staff());

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 7
CREATE POLICY "Staff can update journey"
  ON public.patient_journey FOR UPDATE
  TO authenticated
  USING (public.is_authenticated_staff())
  WITH CHECK (public.is_authenticated_staff());

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 8
CREATE INDEX IF NOT EXISTS idx_patient_journey_state ON public.patient_journey(current_state);

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 9
CREATE INDEX IF NOT EXISTS idx_patient_journey_owner_role ON public.patient_journey(owner_role);

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 10
CREATE INDEX IF NOT EXISTS idx_patient_journey_owner_user ON public.patient_journey(owner_user_id);

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 11
CREATE TRIGGER trg_patient_journey_touch
  BEFORE UPDATE ON public.patient_journey
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 12
CREATE TABLE public.patient_journey_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid REFERENCES public.patient_journey(id) ON DELETE SET NULL,
  patient_id uuid NOT NULL,
  visit_id uuid,
  from_state text,
  to_state text NOT NULL,
  from_owner_role text,
  to_owner_role text,
  from_owner_user_id uuid,
  to_owner_user_id uuid,
  department text,
  location text,
  actor_user_id uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 13
GRANT SELECT, INSERT ON public.patient_journey_history TO authenticated;

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 14
GRANT ALL ON public.patient_journey_history TO service_role;
