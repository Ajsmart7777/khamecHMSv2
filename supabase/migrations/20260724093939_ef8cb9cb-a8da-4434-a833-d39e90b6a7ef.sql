
-- 1. task_claims table
CREATE TABLE public.task_claims (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source text NOT NULL,
  source_id uuid NOT NULL,
  claimed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX task_claims_active_uniq
  ON public.task_claims (source, source_id)
  WHERE released_at IS NULL;

CREATE INDEX task_claims_by_user_active
  ON public.task_claims (claimed_by)
  WHERE released_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON public.task_claims TO authenticated;
GRANT ALL ON public.task_claims TO service_role;

ALTER TABLE public.task_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view all claims"
  ON public.task_claims FOR SELECT
  TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Staff can insert their own claim"
  ON public.task_claims FOR INSERT
  TO authenticated
  WITH CHECK (public.is_authenticated_staff() AND claimed_by = auth.uid());

CREATE POLICY "Owner or admin can update claim"
  ON public.task_claims FOR UPDATE
  TO authenticated
  USING (claimed_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (claimed_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER task_claims_touch_updated_at
  BEFORE UPDATE ON public.task_claims
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. Claim / release RPCs
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

-- 3. Rebuild v_tasks to expose the current claim
DROP VIEW IF EXISTS public.v_tasks;

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

GRANT SELECT ON public.v_tasks TO authenticated;
GRANT ALL ON public.v_tasks TO service_role;
