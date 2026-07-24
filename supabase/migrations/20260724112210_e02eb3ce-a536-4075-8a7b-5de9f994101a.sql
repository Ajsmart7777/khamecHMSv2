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

REVOKE EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) TO service_role;

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