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

GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) TO service_role;

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