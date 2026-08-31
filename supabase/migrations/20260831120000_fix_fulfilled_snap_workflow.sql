-- Fulfilled clinical snaps are historical work and must not keep an outpatient
-- in Lab or Pharmacy. Only pending billing/payment, paid-but-unfulfilled snaps,
-- and pending prescriptions participate in the next-station calculation.
CREATE OR REPLACE FUNCTION public.patient_pending_workflow_station(_patient_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.emergency_episodes e
      WHERE e.patient_id = _patient_id
        AND (e.status = 'open' OR (e.status = 'finalized' AND e.invoice_id IS NULL))
    ) THEN 'emergency_episode'
    WHEN EXISTS (
      SELECT 1 FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.status = 'pending_billing'
    ) THEN 'awaiting_billing'
    WHEN EXISTS (
      SELECT 1 FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.status = 'awaiting_payment'
    ) THEN 'awaiting_payment'
    WHEN EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.patient_id = _patient_id
        AND i.status IN ('pending', 'partial')
    ) THEN 'awaiting_payment'
    WHEN EXISTS (
      SELECT 1 FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.target_station = 'lab'
        AND so.status = 'paid'
    ) THEN 'in_lab'
    WHEN EXISTS (
      SELECT 1 FROM public.lab_requests lr
      WHERE lr.patient_id = _patient_id
        AND lr.status = 'pending'
    ) THEN 'in_lab'
    WHEN EXISTS (
      SELECT 1 FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.target_station = 'pharmacy'
        AND so.status = 'paid'
    ) THEN 'at_pharmacy'
    WHEN EXISTS (
      SELECT 1 FROM public.prescriptions pr
      WHERE pr.patient_id = _patient_id
        AND pr.status = 'pending'
    ) THEN 'at_pharmacy'
    ELSE NULL
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.patient_pending_workflow_station(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(UUID) TO authenticated, service_role;
