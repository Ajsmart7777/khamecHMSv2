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
CREATE INDEX idx_patient_journey_state ON public.patient_journey(current_state);

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 9
CREATE INDEX idx_patient_journey_owner_role ON public.patient_journey(owner_role);

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 10
CREATE INDEX idx_patient_journey_owner_user ON public.patient_journey(owner_user_id);

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

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 15
ALTER TABLE public.patient_journey_history ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 16
CREATE POLICY "Staff can read journey history"
  ON public.patient_journey_history FOR SELECT
  TO authenticated
  USING (public.is_authenticated_staff());

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 17
CREATE POLICY "Staff can append journey history"
  ON public.patient_journey_history FOR INSERT
  TO authenticated
  WITH CHECK (public.is_authenticated_staff());

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 18
CREATE INDEX idx_journey_history_patient ON public.patient_journey_history(patient_id, created_at DESC);

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 19
CREATE INDEX idx_journey_history_journey ON public.patient_journey_history(journey_id, created_at DESC);

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 20
CREATE OR REPLACE FUNCTION public.advance_journey(
  _patient_id uuid,
  _to_state text,
  _owner_role text DEFAULT NULL,
  _owner_user_id uuid DEFAULT NULL,
  _department text DEFAULT NULL,
  _location text DEFAULT NULL,
  _visit_id uuid DEFAULT NULL,
  _reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _existing public.patient_journey%ROWTYPE;
  _journey_id uuid;
  _visit uuid := _visit_id;
  _legacy_status_ok boolean;
BEGIN
  IF NOT public.is_authenticated_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _patient_id IS NULL OR _to_state IS NULL THEN
    RAISE EXCEPTION 'patient_id and to_state are required';
  END IF;

  IF _visit IS NULL THEN
    SELECT id INTO _visit FROM public.visits
     WHERE patient_id = _patient_id AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1;
  END IF;

  SELECT * INTO _existing FROM public.patient_journey
   WHERE patient_id = _patient_id FOR UPDATE;

  IF _existing.id IS NULL THEN
    INSERT INTO public.patient_journey
      (patient_id, visit_id, current_state, owner_role, owner_user_id, department, location)
    VALUES
      (_patient_id, _visit, _to_state, _owner_role, _owner_user_id, _department, _location)
    RETURNING id INTO _journey_id;

    INSERT INTO public.patient_journey_history
      (journey_id, patient_id, visit_id, from_state, to_state,
       from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
       department, location, actor_user_id, reason)
    VALUES
      (_journey_id, _patient_id, _visit, NULL, _to_state,
       NULL, _owner_role, NULL, _owner_user_id,
       _department, _location, _uid, _reason);
  ELSE
    _journey_id := _existing.id;
    UPDATE public.patient_journey SET
      visit_id      = COALESCE(_visit, visit_id),
      current_state = _to_state,
      owner_role    = _owner_role,
      owner_user_id = _owner_user_id,
      department    = _department,
      location      = _location,
      updated_at    = now()
    WHERE id = _journey_id;

    INSERT INTO public.patient_journey_history
      (journey_id, patient_id, visit_id, from_state, to_state,
       from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
       department, location, actor_user_id, reason)
    VALUES
      (_journey_id, _patient_id, COALESCE(_visit, _existing.visit_id),
       _existing.current_state, _to_state,
       _existing.owner_role, _owner_role,
       _existing.owner_user_id, _owner_user_id,
       _department, _location, _uid, _reason);
  END IF;

  -- Backward-compatibility: mirror to legacy patients.status when the value
  -- is a known legacy status. Silently ignore if the value doesn't fit the
  -- existing text column's usage (all statuses today are free-text so this
  -- always succeeds).
  BEGIN
    UPDATE public.patients
       SET status = _to_state, updated_at = now()
     WHERE id = _patient_id;
  EXCEPTION WHEN OTHERS THEN
    -- never let the mirror break the journey write
    NULL;
  END;

  RETURN _journey_id;
END;
$$;

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 21
INSERT INTO public.patient_journey (patient_id, current_state, owner_role, created_at, updated_at)
SELECT
  p.id,
  COALESCE(p.status, 'registered'),
  CASE p.status
    WHEN 'registered'         THEN 'receptionist'
    WHEN 'waiting'            THEN 'receptionist'
    WHEN 'with_nurse'         THEN 'nurse'
    WHEN 'with_doctor'        THEN 'doctor'
    WHEN 'in_lab'             THEN 'lab_tech'
    WHEN 'awaiting_billing'   THEN 'billing'
    WHEN 'awaiting_payment'   THEN 'cashier'
    WHEN 'at_pharmacy'        THEN 'pharmacist'
    WHEN 'admitted'           THEN 'nurse'
    WHEN 'awaiting_room'      THEN 'nurse'
    WHEN 'discharged'         THEN NULL
    ELSE NULL
  END,
  now(), now()
FROM public.patients p
ON CONFLICT (patient_id) DO NOTHING;

-- SOURCE: 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql statement 22
INSERT INTO public.patient_journey_history
  (journey_id, patient_id, from_state, to_state, to_owner_role, reason, created_at)
SELECT
  j.id, j.patient_id, NULL, j.current_state, j.owner_role, 'backfill', now()
FROM public.patient_journey j
WHERE NOT EXISTS (
  SELECT 1 FROM public.patient_journey_history h WHERE h.journey_id = j.id
);

-- SOURCE: 20260724092532_3156a092-5da1-49f1-868c-bba7f02786f8.sql statement 1
CREATE OR REPLACE VIEW public.v_tasks AS
-- Lab requests
SELECT
  ('lab_requests:' || lr.id::text)          AS task_id,
  'lab_requests'::text                       AS source,
  lr.id                                      AS source_id,
  lr.patient_id                              AS patient_id,
  lr.visit_id                                AS visit_id,
  'lab_tech'::text                           AS assigned_role,
  NULL::uuid                                 AS assigned_user_id,
  lr.status                                  AS status,
  0                                          AS priority,
  lr.created_at                              AS created_at,
  lr.updated_at                              AS updated_at,
  jsonb_build_object(
    'request_number', lr.request_number,
    'tests', lr.tests,
    'diagnosis', lr.diagnosis
  )                                          AS payload
FROM public.lab_requests lr

UNION ALL

-- Prescriptions
SELECT
  ('prescriptions:' || pr.id::text),
  'prescriptions',
  pr.id,
  pr.patient_id,
  pr.visit_id,
  'pharmacist',
  NULL::uuid,
  pr.status,
  0,
  pr.created_at,
  pr.updated_at,
  jsonb_build_object(
    'diagnosis', pr.diagnosis,
    'notes', pr.notes
  )
FROM public.prescriptions pr

UNION ALL

-- Admissions
SELECT
  ('admissions:' || a.id::text),
  'admissions',
  a.id,
  a.patient_id,
  a.visit_id,
  CASE a.status
    WHEN 'waiting_assignment'    THEN 'nurse'
    WHEN 'active'                THEN 'nurse'
    WHEN 'ready_for_discharge'   THEN 'nurse'
    ELSE NULL
  END,
  a.admitting_doctor,
  a.status,
  CASE a.status WHEN 'ready_for_discharge' THEN 10 ELSE 5 END,
  a.created_at,
  a.updated_at,
  jsonb_build_object(
    'reason', a.reason,
    'bed_id', a.bed_id,
    'admitted_at', a.admitted_at,
    'ready_for_discharge_at', a.ready_for_discharge_at
  )
FROM public.admissions a

UNION ALL

-- Snap orders
SELECT
  ('snap_orders:' || s.id::text),
  'snap_orders',
  s.id,
  s.patient_id,
  s.visit_id,
  CASE s.target_station
    WHEN 'pharmacy' THEN 'pharmacist'
    WHEN 'lab'      THEN 'lab_tech'
    WHEN 'nurse'    THEN 'nurse'
    WHEN 'billing'  THEN 'billing'
    ELSE s.target_station
  END,
  s.created_by,
  s.status,
  CASE WHEN s.is_admitted_snap THEN 8 ELSE 3 END,
  s.created_at,
  s.updated_at,
  jsonb_build_object(
    'order_type', s.order_type,
    'target_station', s.target_station,
    'source_role', s.source_role,
    'intent', s.intent,
    'note', s.note
  )
FROM public.snap_orders s

UNION ALL

-- Stock requests
SELECT
  ('stock_requests:' || sr.id::text),
  'stock_requests',
  sr.id,
  NULL::uuid,
  NULL::uuid,
  'store',
  NULL::uuid,
  sr.status,
  1,
  sr.created_at,
  sr.updated_at,
  jsonb_build_object(
    'item_name', sr.item_name,
    'item_id', sr.item_id,
    'quantity', sr.quantity,
    'requested_by', sr.requested_by
  )
FROM public.stock_requests sr;

-- SOURCE: 20260724092532_3156a092-5da1-49f1-868c-bba7f02786f8.sql statement 2
GRANT SELECT ON public.v_tasks TO authenticated;

-- SOURCE: 20260724092532_3156a092-5da1-49f1-868c-bba7f02786f8.sql statement 3
GRANT SELECT ON public.v_tasks TO service_role;

-- SOURCE: 20260724092541_eba2a9cc-863a-43cf-b53e-608466d3bd3a.sql statement 1
ALTER VIEW public.v_tasks SET (security_invoker = true);

-- SOURCE: 20260724092747_a56e4123-210b-4e6c-a46d-d7795ac29f34.sql statement 1
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'cashier';

-- SOURCE: 20260724093939_ef8cb9cb-a8da-4434-a833-d39e90b6a7ef.sql statement 1
CREATE TABLE public.task_claims (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source text NOT NULL,
  source_id uuid NOT NULL,
  claimed_by uuid NOT NULL REFERENCES neon_auth.user(id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- SOURCE: 20260724093939_ef8cb9cb-a8da-4434-a833-d39e90b6a7ef.sql statement 2
CREATE UNIQUE INDEX task_claims_active_uniq
  ON public.task_claims (source, source_id)
  WHERE released_at IS NULL;

-- SOURCE: 20260724093939_ef8cb9cb-a8da-4434-a833-d39e90b6a7ef.sql statement 3
CREATE INDEX task_claims_by_user_active
  ON public.task_claims (claimed_by)
  WHERE released_at IS NULL;

-- SOURCE: 20260724093939_ef8cb9cb-a8da-4434-a833-d39e90b6a7ef.sql statement 4
GRANT SELECT, INSERT, UPDATE ON public.task_claims TO authenticated;

-- SOURCE: 20260724093939_ef8cb9cb-a8da-4434-a833-d39e90b6a7ef.sql statement 5
GRANT ALL ON public.task_claims TO service_role;

-- SOURCE: 20260724093939_ef8cb9cb-a8da-4434-a833-d39e90b6a7ef.sql statement 6
ALTER TABLE public.task_claims ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260724093939_ef8cb9cb-a8da-4434-a833-d39e90b6a7ef.sql statement 7
CREATE POLICY "Staff can view all claims"
  ON public.task_claims FOR SELECT
  TO authenticated
  USING (public.is_authenticated_staff());

-- SOURCE: 20260724093939_ef8cb9cb-a8da-4434-a833-d39e90b6a7ef.sql statement 8
CREATE POLICY "Staff can insert their own claim"
  ON public.task_claims FOR INSERT
  TO authenticated
  WITH CHECK (public.is_authenticated_staff() AND claimed_by = auth.uid());

-- SOURCE: 20260724093939_ef8cb9cb-a8da-4434-a833-d39e90b6a7ef.sql statement 9
CREATE POLICY "Owner or admin can update claim"
  ON public.task_claims FOR UPDATE
  TO authenticated
  USING (claimed_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (claimed_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260724093939_ef8cb9cb-a8da-4434-a833-d39e90b6a7ef.sql statement 10
CREATE TRIGGER task_claims_touch_updated_at
  BEFORE UPDATE ON public.task_claims
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- SOURCE: 20260724093939_ef8cb9cb-a8da-4434-a833-d39e90b6a7ef.sql statement 11
CREATE OR REPLACE FUNCTION public.claim_task(_source text, _source_id uuid, _notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _existing RECORD;
  _new uuid;
BEGIN
  IF NOT public.is_authenticated_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _source IS NULL OR _source_id IS NULL THEN
    RAISE EXCEPTION 'source and source_id are required';
  END IF;

  SELECT * INTO _existing FROM public.task_claims
    WHERE source = _source AND source_id = _source_id AND released_at IS NULL
    FOR UPDATE;

  IF _existing.id IS NOT NULL THEN
    IF _existing.claimed_by = _uid THEN
      RETURN _existing.id; -- idempotent
    END IF;
    RAISE EXCEPTION 'TASK_ALREADY_CLAIMED: task is currently claimed by another user';
  END IF;

  INSERT INTO public.task_claims (source, source_id, claimed_by, notes)
  VALUES (_source, _source_id, _uid, _notes)
  RETURNING id INTO _new;

  PERFORM public.write_audit_log(
    'task_claimed', 'task', _source || ':' || _source_id::text,
    jsonb_build_object('source', _source, 'source_id', _source_id, 'notes', _notes)
  );
  RETURN _new;
END;
$$;

-- SOURCE: 20260724093939_ef8cb9cb-a8da-4434-a833-d39e90b6a7ef.sql statement 12
CREATE OR REPLACE FUNCTION public.release_task(_source text, _source_id uuid, _notes text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _existing RECORD;
BEGIN
  IF NOT public.is_authenticated_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO _existing FROM public.task_claims
    WHERE source = _source AND source_id = _source_id AND released_at IS NULL
    FOR UPDATE;
  IF _existing.id IS NULL THEN RETURN false; END IF;

  IF _existing.claimed_by <> _uid
     AND NOT public.has_role(_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only the claimant or an admin can release this task';
  END IF;

  UPDATE public.task_claims
     SET released_at = now(),
         notes = COALESCE(_notes, notes),
         updated_at = now()
   WHERE id = _existing.id;

  PERFORM public.write_audit_log(
    'task_released', 'task', _source || ':' || _source_id::text,
    jsonb_build_object('source', _source, 'source_id', _source_id, 'notes', _notes)
  );
  RETURN true;
END;
$$;

-- SOURCE: 20260724093939_ef8cb9cb-a8da-4434-a833-d39e90b6a7ef.sql statement 13
DROP VIEW IF EXISTS public.v_tasks;

-- SOURCE: 20260724093939_ef8cb9cb-a8da-4434-a833-d39e90b6a7ef.sql statement 14
CREATE VIEW public.v_tasks
WITH (security_invoker = true)
AS
WITH active_claims AS (
  SELECT source, source_id, claimed_by, claimed_at, id AS claim_id
  FROM public.task_claims
  WHERE released_at IS NULL
)
SELECT
  'lab_requests:'::text || lr.id::text AS task_id,
  'lab_requests'::text AS source,
  lr.id AS source_id,
  lr.patient_id,
  lr.visit_id,
  'lab_tech'::text AS assigned_role,
  ac.claimed_by AS assigned_user_id,
  lr.status,
  0 AS priority,
  lr.created_at,
  lr.updated_at,
  jsonb_build_object(
    'request_number', lr.request_number, 'tests', lr.tests, 'diagnosis', lr.diagnosis,
    'claimed', ac.claim_id IS NOT NULL,
    'claimed_by', ac.claimed_by,
    'claimed_at', ac.claimed_at
  ) AS payload
FROM public.lab_requests lr
LEFT JOIN active_claims ac
  ON ac.source = 'lab_requests' AND ac.source_id = lr.id

UNION ALL
SELECT
  'prescriptions:'::text || pr.id::text,
  'prescriptions', pr.id, pr.patient_id, pr.visit_id,
  'pharmacist', ac.claimed_by,
  pr.status, 0, pr.created_at, pr.updated_at,
  jsonb_build_object(
    'diagnosis', pr.diagnosis, 'notes', pr.notes,
    'claimed', ac.claim_id IS NOT NULL,
    'claimed_by', ac.claimed_by, 'claimed_at', ac.claimed_at
  )
FROM public.prescriptions pr
LEFT JOIN active_claims ac
  ON ac.source = 'prescriptions' AND ac.source_id = pr.id

UNION ALL
SELECT
  'admissions:'::text || a.id::text,
  'admissions', a.id, a.patient_id, a.visit_id,
  CASE a.status
    WHEN 'waiting_assignment' THEN 'nurse'
    WHEN 'active' THEN 'nurse'
    WHEN 'ready_for_discharge' THEN 'nurse'
    ELSE NULL
  END,
  COALESCE(ac.claimed_by, a.admitting_doctor),
  a.status,
  CASE a.status WHEN 'ready_for_discharge' THEN 10 ELSE 5 END,
  a.created_at, a.updated_at,
  jsonb_build_object(
    'reason', a.reason, 'bed_id', a.bed_id,
    'admitted_at', a.admitted_at, 'ready_for_discharge_at', a.ready_for_discharge_at,
    'claimed', ac.claim_id IS NOT NULL,
    'claimed_by', ac.claimed_by, 'claimed_at', ac.claimed_at
  )
FROM public.admissions a
LEFT JOIN active_claims ac
  ON ac.source = 'admissions' AND ac.source_id = a.id

UNION ALL
SELECT
  'snap_orders:'::text || s.id::text,
  'snap_orders', s.id, s.patient_id, s.visit_id,
  CASE s.target_station
    WHEN 'pharmacy' THEN 'pharmacist'
    WHEN 'lab' THEN 'lab_tech'
    WHEN 'nurse' THEN 'nurse'
    WHEN 'billing' THEN 'billing'
    ELSE s.target_station
  END,
  COALESCE(ac.claimed_by, s.created_by),
  s.status,
  CASE WHEN s.is_admitted_snap THEN 8 ELSE 3 END,
  s.created_at, s.updated_at,
  jsonb_build_object(
    'order_type', s.order_type, 'target_station', s.target_station,
    'source_role', s.source_role, 'intent', s.intent, 'note', s.note,
    'claimed', ac.claim_id IS NOT NULL,
    'claimed_by', ac.claimed_by, 'claimed_at', ac.claimed_at
  )
FROM public.snap_orders s
LEFT JOIN active_claims ac
  ON ac.source = 'snap_orders' AND ac.source_id = s.id

UNION ALL
SELECT
  'stock_requests:'::text || sr.id::text,
  'stock_requests', sr.id, NULL::uuid, NULL::uuid,
  'store', ac.claimed_by,
  sr.status, 1, sr.created_at, sr.updated_at,
  jsonb_build_object(
    'item_name', sr.item_name, 'item_id', sr.item_id,
    'quantity', sr.quantity, 'requested_by', sr.requested_by,
    'claimed', ac.claim_id IS NOT NULL,
    'claimed_by', ac.claimed_by, 'claimed_at', ac.claimed_at
  )
FROM public.stock_requests sr
LEFT JOIN active_claims ac
  ON ac.source = 'stock_requests' AND ac.source_id = sr.id;

-- SOURCE: 20260724093939_ef8cb9cb-a8da-4434-a833-d39e90b6a7ef.sql statement 15
GRANT SELECT ON public.v_tasks TO authenticated;

-- SOURCE: 20260724093939_ef8cb9cb-a8da-4434-a833-d39e90b6a7ef.sql statement 16
GRANT ALL ON public.v_tasks TO service_role;

-- SOURCE: 20260724100333_e76f6edd-f935-46d0-aa28-cbb0cf170188.sql statement 1
ALTER TABLE public.patients DROP CONSTRAINT IF EXISTS patients_account_type_check;

-- SOURCE: 20260724100333_e76f6edd-f935-46d0-aa28-cbb0cf170188.sql statement 2
ALTER TABLE public.patients ADD CONSTRAINT patients_account_type_check
CHECK (account_type = ANY (ARRAY['normal','insurance','corporate','nhis','hmo','katchma','retainer','staff','staff_family']::text[]));

-- SOURCE: 20260724112106_19e58793-3c57-47d6-b2e0-6eef421433d6.sql statement 1
CREATE OR REPLACE FUNCTION public.patient_pending_workflow_station(_patient_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.target_station = 'lab'
        AND so.status IN ('pending_billing', 'awaiting_payment', 'paid')
    ) THEN 'in_lab'
    WHEN EXISTS (
      SELECT 1
      FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.target_station = 'pharmacy'
        AND so.status IN ('pending_billing', 'awaiting_payment', 'paid')
    ) THEN 'at_pharmacy'
    WHEN EXISTS (
      SELECT 1
      FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.status = 'pending_billing'
    ) THEN 'awaiting_billing'
    WHEN EXISTS (
      SELECT 1
      FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.status = 'awaiting_payment'
    ) THEN 'awaiting_payment'
    WHEN EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.patient_id = _patient_id
        AND i.status IN ('pending', 'partial')
    ) THEN 'awaiting_payment'
    ELSE NULL
  END;
$$;

-- SOURCE: 20260724112106_19e58793-3c57-47d6-b2e0-6eef421433d6.sql statement 2
GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) TO authenticated;

-- SOURCE: 20260724112106_19e58793-3c57-47d6-b2e0-6eef421433d6.sql statement 3
GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) TO service_role;

-- SOURCE: 20260724112106_19e58793-3c57-47d6-b2e0-6eef421433d6.sql statement 4
CREATE OR REPLACE FUNCTION public.advance_journey(
  _patient_id uuid,
  _to_state text,
  _owner_role text DEFAULT NULL,
  _owner_user_id uuid DEFAULT NULL,
  _department text DEFAULT NULL,
  _location text DEFAULT NULL,
  _visit_id uuid DEFAULT NULL,
  _reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _existing public.patient_journey%ROWTYPE;
  _journey_id uuid;
  _visit uuid := _visit_id;
  _pending_station text;
BEGIN
  IF NOT public.is_authenticated_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _patient_id IS NULL OR _to_state IS NULL THEN
    RAISE EXCEPTION 'patient_id and to_state are required';
  END IF;

  IF _to_state = 'discharged' THEN
    _pending_station := public.patient_pending_workflow_station(_patient_id);
    IF _pending_station IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot discharge patient: pending workflow remains at %', _pending_station;
    END IF;
  END IF;

  IF _visit IS NULL THEN
    SELECT id INTO _visit FROM public.visits
     WHERE patient_id = _patient_id AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1;
  END IF;

  SELECT * INTO _existing FROM public.patient_journey
   WHERE patient_id = _patient_id FOR UPDATE;

  IF _existing.id IS NULL THEN
    INSERT INTO public.patient_journey
      (patient_id, visit_id, current_state, owner_role, owner_user_id, department, location)
    VALUES
      (_patient_id, _visit, _to_state, _owner_role, _owner_user_id, _department, _location)
    RETURNING id INTO _journey_id;

    INSERT INTO public.patient_journey_history
      (journey_id, patient_id, visit_id, from_state, to_state,
       from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
       department, location, actor_user_id, reason)
    VALUES
      (_journey_id, _patient_id, _visit, NULL, _to_state,
       NULL, _owner_role, NULL, _owner_user_id,
       _department, _location, _uid, _reason);
  ELSE
    _journey_id := _existing.id;
    UPDATE public.patient_journey SET
      visit_id      = COALESCE(_visit, visit_id),
      current_state = _to_state,
      owner_role    = _owner_role,
      owner_user_id = _owner_user_id,
      department    = _department,
      location      = _location,
      updated_at    = now()
    WHERE id = _journey_id;

    INSERT INTO public.patient_journey_history
      (journey_id, patient_id, visit_id, from_state, to_state,
       from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
       department, location, actor_user_id, reason)
    VALUES
      (_journey_id, _patient_id, COALESCE(_visit, _existing.visit_id),
       _existing.current_state, _to_state,
       _existing.owner_role, _owner_role,
       _existing.owner_user_id, _owner_user_id,
       _department, _location, _uid, _reason);
  END IF;

  BEGIN
    UPDATE public.patients
       SET status = _to_state, updated_at = now()
     WHERE id = _patient_id;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN _journey_id;
END;
$$;

-- SOURCE: 20260724112118_9e1f0c2e-2c3c-4a3b-a794-1b2aaf04b578.sql statement 1
REVOKE EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) FROM PUBLIC;

-- SOURCE: 20260724112118_9e1f0c2e-2c3c-4a3b-a794-1b2aaf04b578.sql statement 2
REVOKE EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) FROM anon;

-- SOURCE: 20260724112118_9e1f0c2e-2c3c-4a3b-a794-1b2aaf04b578.sql statement 3
GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) TO authenticated;

-- SOURCE: 20260724112118_9e1f0c2e-2c3c-4a3b-a794-1b2aaf04b578.sql statement 4
GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) TO service_role;

-- SOURCE: 20260724112118_9e1f0c2e-2c3c-4a3b-a794-1b2aaf04b578.sql statement 5
REVOKE EXECUTE ON FUNCTION public.advance_journey(uuid, text, text, uuid, text, text, uuid, text) FROM PUBLIC;

-- SOURCE: 20260724112118_9e1f0c2e-2c3c-4a3b-a794-1b2aaf04b578.sql statement 6
REVOKE EXECUTE ON FUNCTION public.advance_journey(uuid, text, text, uuid, text, text, uuid, text) FROM anon;

-- SOURCE: 20260724112118_9e1f0c2e-2c3c-4a3b-a794-1b2aaf04b578.sql statement 7
GRANT EXECUTE ON FUNCTION public.advance_journey(uuid, text, text, uuid, text, text, uuid, text) TO authenticated;

-- SOURCE: 20260724112118_9e1f0c2e-2c3c-4a3b-a794-1b2aaf04b578.sql statement 8
GRANT EXECUTE ON FUNCTION public.advance_journey(uuid, text, text, uuid, text, text, uuid, text) TO service_role;

-- SOURCE: 20260724112210_e02eb3ce-a536-4075-8a7b-5de9f994101a.sql statement 1
CREATE OR REPLACE FUNCTION public.patient_pending_workflow_station(_patient_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.status = 'pending_billing'
    ) THEN 'awaiting_billing'
    WHEN EXISTS (
      SELECT 1
      FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.status = 'awaiting_payment'
    ) THEN 'awaiting_payment'
    WHEN EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.patient_id = _patient_id
        AND i.status IN ('pending', 'partial')
    ) THEN 'awaiting_payment'
    WHEN EXISTS (
      SELECT 1
      FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.target_station = 'lab'
        AND so.status = 'paid'
    ) THEN 'in_lab'
    WHEN EXISTS (
      SELECT 1
      FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.target_station = 'pharmacy'
        AND so.status = 'paid'
    ) THEN 'at_pharmacy'
    ELSE NULL
  END;
$$;

-- SOURCE: 20260724112210_e02eb3ce-a536-4075-8a7b-5de9f994101a.sql statement 2
REVOKE EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) FROM PUBLIC;

-- SOURCE: 20260724112210_e02eb3ce-a536-4075-8a7b-5de9f994101a.sql statement 3
REVOKE EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) FROM anon;

-- SOURCE: 20260724112210_e02eb3ce-a536-4075-8a7b-5de9f994101a.sql statement 4
GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) TO authenticated;

-- SOURCE: 20260724112210_e02eb3ce-a536-4075-8a7b-5de9f994101a.sql statement 5
GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) TO service_role;

-- SOURCE: 20260724112210_e02eb3ce-a536-4075-8a7b-5de9f994101a.sql statement 6
WITH routed AS (
  SELECT p.id AS patient_id, public.patient_pending_workflow_station(p.id) AS next_state
  FROM public.patients p
  WHERE p.status = 'discharged'
), repair AS (
  SELECT patient_id, next_state,
    CASE next_state
      WHEN 'awaiting_billing' THEN 'billing'
      WHEN 'awaiting_payment' THEN 'cashier'
      WHEN 'in_lab' THEN 'lab_tech'
      WHEN 'at_pharmacy' THEN 'pharmacist'
      ELSE NULL
    END AS owner_role
  FROM routed
  WHERE next_state IS NOT NULL
), patient_updates AS (
  UPDATE public.patients p
     SET status = r.next_state,
         updated_at = now()
    FROM repair r
   WHERE p.id = r.patient_id
   RETURNING p.id AS patient_id, r.next_state, r.owner_role
), journey_updates AS (
  UPDATE public.patient_journey j
     SET current_state = u.next_state,
         owner_role = u.owner_role,
         updated_at = now()
    FROM patient_updates u
   WHERE j.patient_id = u.patient_id
   RETURNING j.id AS journey_id, j.patient_id, u.next_state, u.owner_role
)
INSERT INTO public.patient_journey_history
  (journey_id, patient_id, from_state, to_state, to_owner_role, reason, created_at)
SELECT
  journey_id,
  patient_id,
  'discharged',
  next_state,
  owner_role,
  'repair_pending_workflow_after_payment',
  now()
FROM journey_updates;

-- SOURCE: 20260724114841_8f0499d5-9c01-44c0-9e73-593958e83ae7.sql statement 1
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT i.id, i.invoice_number, i.paid_amount, i.payment_method
    FROM invoices i JOIN patients p ON p.id=i.patient_id
    WHERE i.invoice_number IN ('INV-MRYSJHBG-EQRO','INV-MRYTKMKU-3NL2','INV-MRYTRICH-VO5O','INV-MRYU34VI-KZR1','INV-MRYVAZXF-0NZR')
      AND lower(coalesce(p.account_type,'')) NOT IN ('','normal','cash')
  LOOP
    UPDATE invoices
       SET paid_amount = 0,
           status = 'pending',
           payment_method = 'sponsor_claim',
           paid_at = NULL,
           notes = coalesce(notes,'') || ' | reconciled: sponsor 100% cover, wallet not applicable'
     WHERE id = r.id;

    INSERT INTO audit_logs(action, resource_type, resource_id, details, status, actor_role)
    VALUES ('invoice_reconciled_to_sponsor','invoice', r.id::text,
            jsonb_build_object('invoice_number', r.invoice_number,
                               'previous_paid_amount', r.paid_amount,
                               'previous_payment_method', r.payment_method,
                               'reason','legacy HMO invoice wrongly recorded as patient payment'),
            'success','system');
  END LOOP;
END $$;

-- SOURCE: 20260724121856_598bf546-27e9-47a4-99cc-90f532e50b5f.sql statement 1
ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS claim_status text NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS claim_settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_settled_by uuid,
  ADD COLUMN IF NOT EXISTS claim_notes text;

-- SOURCE: 20260724121856_598bf546-27e9-47a4-99cc-90f532e50b5f.sql statement 2
UPDATE public.visits
   SET claim_status = 'pending'
 WHERE status = 'settled'
   AND sponsor_type IN ('nhia','hmo','katchma','staff','staff_family')
   AND claim_status = 'not_applicable';

-- SOURCE: 20260724121856_598bf546-27e9-47a4-99cc-90f532e50b5f.sql statement 3
CREATE INDEX IF NOT EXISTS idx_visits_claim_status ON public.visits(claim_status);

-- SOURCE: 20260724121856_598bf546-27e9-47a4-99cc-90f532e50b5f.sql statement 4
CREATE OR REPLACE FUNCTION public.mark_claim_settled(_visit_id uuid, _notes text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _v RECORD;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['claims_manager','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only claims manager or admin can settle claims';
  END IF;
  SELECT * INTO _v FROM public.visits WHERE id = _visit_id FOR UPDATE;
  IF _v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF _v.claim_status <> 'pending' THEN
    RAISE EXCEPTION 'Claim is not pending (current: %)', _v.claim_status;
  END IF;

  UPDATE public.visits
     SET claim_status = 'settled',
         claim_settled_at = now(),
         claim_settled_by = auth.uid(),
         claim_notes = COALESCE(_notes, claim_notes),
         updated_at = now()
   WHERE id = _visit_id;

  PERFORM public.write_audit_log(
    'claim_settled', 'visit', _visit_id::text,
    jsonb_build_object(
      'visit_number', _v.visit_number,
      'patient_id', _v.patient_id,
      'sponsor_type', _v.sponsor_type,
      'insurance_plan', _v.insurance_plan,
      'total_charged', _v.total_charged,
      'notes', _notes
    )
  );
END;
$$;

-- SOURCE: 20260724121856_598bf546-27e9-47a4-99cc-90f532e50b5f.sql statement 5
CREATE OR REPLACE FUNCTION public.reopen_claim(_visit_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admin can reopen a settled claim';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  UPDATE public.visits
     SET claim_status = 'pending',
         claim_settled_at = NULL,
         claim_settled_by = NULL,
         claim_notes = COALESCE(claim_notes,'') || E'\n[reopened] ' || _reason,
         updated_at = now()
   WHERE id = _visit_id AND claim_status = 'settled';
  PERFORM public.write_audit_log(
    'claim_reopened', 'visit', _visit_id::text,
    jsonb_build_object('reason', _reason)
  );
END;
$$;

-- SOURCE: 20260724122530_16461ee3-c7ab-410f-8244-d41708978487.sql statement 1
ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS claim_reason_code text,
  ADD COLUMN IF NOT EXISTS claim_reason_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS claim_last_action_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_last_action_by uuid;

-- SOURCE: 20260724122530_16461ee3-c7ab-410f-8244-d41708978487.sql statement 2
DO $$
DECLARE _con text;
BEGIN
  SELECT conname INTO _con
    FROM pg_constraint
   WHERE conrelid = 'public.visits'::regclass
     AND contype  = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%claim_status%';
  IF _con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.visits DROP CONSTRAINT %I', _con);
  END IF;
  ALTER TABLE public.visits
    ADD CONSTRAINT visits_claim_status_check
    CHECK (claim_status IN ('not_applicable','pending','settled','rejected','info_requested'));
END $$;

-- SOURCE: 20260724122530_16461ee3-c7ab-410f-8244-d41708978487.sql statement 3
CREATE INDEX IF NOT EXISTS idx_visits_claim_reason_code ON public.visits(claim_reason_code);

-- SOURCE: 20260724122530_16461ee3-c7ab-410f-8244-d41708978487.sql statement 4
CREATE OR REPLACE FUNCTION public.mark_claim_rejected(
  _visit_id uuid,
  _reason_code text,
  _notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _v RECORD;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['claims_manager','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only claims manager or admin can reject claims';
  END IF;
  IF _reason_code IS NULL OR length(trim(_reason_code)) = 0 THEN
    RAISE EXCEPTION 'A reason code is required';
  END IF;
  SELECT * INTO _v FROM public.visits WHERE id = _visit_id FOR UPDATE;
  IF _v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF _v.claim_status NOT IN ('pending','info_requested') THEN
    RAISE EXCEPTION 'Claim cannot be rejected from status: %', _v.claim_status;
  END IF;

  UPDATE public.visits
     SET claim_status = 'rejected',
         claim_reason_code = _reason_code,
         claim_notes = COALESCE(claim_notes,'') ||
                       CASE WHEN claim_notes IS NULL OR claim_notes = '' THEN '' ELSE E'\n' END ||
                       '[rejected:' || _reason_code || '] ' || COALESCE(_notes,''),
         claim_last_action_at = now(),
         claim_last_action_by = auth.uid(),
         updated_at = now()
   WHERE id = _visit_id;

  PERFORM public.write_audit_log(
    'claim_rejected', 'visit', _visit_id::text,
    jsonb_build_object(
      'visit_number', _v.visit_number,
      'patient_id', _v.patient_id,
      'sponsor_type', _v.sponsor_type,
      'insurance_plan', _v.insurance_plan,
      'total_charged', _v.total_charged,
      'reason_code', _reason_code,
      'notes', _notes
    )
  );
END;
$$;

-- SOURCE: 20260724122530_16461ee3-c7ab-410f-8244-d41708978487.sql statement 5
CREATE OR REPLACE FUNCTION public.request_claim_info(
  _visit_id uuid,
  _reason_code text,
  _notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _v RECORD;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['claims_manager','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only claims manager or admin can request more info';
  END IF;
  IF _reason_code IS NULL OR length(trim(_reason_code)) = 0 THEN
    RAISE EXCEPTION 'A reason code is required';
  END IF;
  SELECT * INTO _v FROM public.visits WHERE id = _visit_id FOR UPDATE;
  IF _v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF _v.claim_status NOT IN ('pending','info_requested') THEN
    RAISE EXCEPTION 'Cannot request info from status: %', _v.claim_status;
  END IF;

  UPDATE public.visits
     SET claim_status = 'info_requested',
         claim_reason_code = _reason_code,
         claim_notes = COALESCE(claim_notes,'') ||
                       CASE WHEN claim_notes IS NULL OR claim_notes = '' THEN '' ELSE E'\n' END ||
                       '[info_requested:' || _reason_code || '] ' || COALESCE(_notes,''),
         claim_last_action_at = now(),
         claim_last_action_by = auth.uid(),
         updated_at = now()
   WHERE id = _visit_id;

  PERFORM public.write_audit_log(
    'claim_info_requested', 'visit', _visit_id::text,
    jsonb_build_object(
      'visit_number', _v.visit_number,
      'patient_id', _v.patient_id,
      'sponsor_type', _v.sponsor_type,
      'insurance_plan', _v.insurance_plan,
      'reason_code', _reason_code,
      'notes', _notes
    )
  );
END;
$$;
