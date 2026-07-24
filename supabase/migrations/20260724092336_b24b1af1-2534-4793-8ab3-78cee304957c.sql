
-- Phase 1: Journey State foundation
-- Additive only. Does not modify existing tables.

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

GRANT SELECT, INSERT, UPDATE ON public.patient_journey TO authenticated;
GRANT ALL ON public.patient_journey TO service_role;

ALTER TABLE public.patient_journey ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read journey"
  ON public.patient_journey FOR SELECT
  TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Staff can insert journey"
  ON public.patient_journey FOR INSERT
  TO authenticated
  WITH CHECK (public.is_authenticated_staff());

CREATE POLICY "Staff can update journey"
  ON public.patient_journey FOR UPDATE
  TO authenticated
  USING (public.is_authenticated_staff())
  WITH CHECK (public.is_authenticated_staff());

CREATE INDEX idx_patient_journey_state ON public.patient_journey(current_state);
CREATE INDEX idx_patient_journey_owner_role ON public.patient_journey(owner_role);
CREATE INDEX idx_patient_journey_owner_user ON public.patient_journey(owner_user_id);

CREATE TRIGGER trg_patient_journey_touch
  BEFORE UPDATE ON public.patient_journey
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. patient_journey_history — append-only audit trail
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

GRANT SELECT, INSERT ON public.patient_journey_history TO authenticated;
GRANT ALL ON public.patient_journey_history TO service_role;

ALTER TABLE public.patient_journey_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read journey history"
  ON public.patient_journey_history FOR SELECT
  TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Staff can append journey history"
  ON public.patient_journey_history FOR INSERT
  TO authenticated
  WITH CHECK (public.is_authenticated_staff());

CREATE INDEX idx_journey_history_patient ON public.patient_journey_history(patient_id, created_at DESC);
CREATE INDEX idx_journey_history_journey ON public.patient_journey_history(journey_id, created_at DESC);

-- 3. advance_journey — the one entry point for workflow moves.
-- Also mirrors patients.status so all existing UI keeps working unchanged.
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

-- 4. Backfill: seed a journey row for every existing patient.
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

-- Seed history with the initial state
INSERT INTO public.patient_journey_history
  (journey_id, patient_id, from_state, to_state, to_owner_role, reason, created_at)
SELECT
  j.id, j.patient_id, NULL, j.current_state, j.owner_role, 'backfill', now()
FROM public.patient_journey j
WHERE NOT EXISTS (
  SELECT 1 FROM public.patient_journey_history h WHERE h.journey_id = j.id
);
