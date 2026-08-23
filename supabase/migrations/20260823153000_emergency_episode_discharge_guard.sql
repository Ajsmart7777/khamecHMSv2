-- An open Emergency Episode must be reconciled before discharge. This keeps
-- deferred emergency care attached to the patient's final billing story.
CREATE OR REPLACE FUNCTION public.patient_pending_workflow_station(_patient_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.emergency_episodes e
      WHERE e.patient_id = _patient_id AND e.status = 'open'
    ) THEN 'emergency_episode'
    WHEN EXISTS (
      SELECT 1 FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.target_station = 'lab'
        AND so.status IN ('pending_billing', 'awaiting_payment', 'paid')
    ) THEN 'in_lab'
    WHEN EXISTS (
      SELECT 1 FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.target_station = 'pharmacy'
        AND so.status IN ('pending_billing', 'awaiting_payment', 'paid')
    ) THEN 'at_pharmacy'
    WHEN EXISTS (
      SELECT 1 FROM public.snap_orders so
      WHERE so.patient_id = _patient_id AND so.status = 'pending_billing'
    ) THEN 'awaiting_billing'
    WHEN EXISTS (
      SELECT 1 FROM public.snap_orders so
      WHERE so.patient_id = _patient_id AND so.status = 'awaiting_payment'
    ) THEN 'awaiting_payment'
    WHEN EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.patient_id = _patient_id AND i.status IN ('pending', 'partial')
    ) THEN 'awaiting_payment'
    ELSE NULL
  END;
$$;

GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(UUID) TO service_role;
