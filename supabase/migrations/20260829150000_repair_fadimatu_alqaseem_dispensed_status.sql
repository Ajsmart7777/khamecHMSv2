-- Targeted repair for Fadimatu Alqaseem (patient id 15c010bc-3db5-402d-960e-c0f7d0810801).
-- Evidence: the pharmacy prescription is fulfilled, linked invoices are paid,
-- the emergency episode is reconciled, and the canonical journey is stale at
-- at_pharmacy while the patient row is stale at awaiting_payment.
WITH eligible AS (
  SELECT p.id AS patient_id
  FROM public.patients p
  WHERE p.id = '15c010bc-3db5-402d-960e-c0f7d0810801'
    AND p.status = 'awaiting_payment'
    AND EXISTS (
      SELECT 1
      FROM public.patient_journey j
      WHERE j.patient_id = p.id
        AND j.current_state = 'at_pharmacy'
    )
    AND EXISTS (
      SELECT 1
      FROM public.emergency_episodes e
      WHERE e.patient_id = p.id
        AND e.status = 'reconciled'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.snap_orders so
      WHERE so.patient_id = p.id
        AND (
          so.status IN ('pending_billing', 'awaiting_payment')
          OR (so.target_station = 'lab' AND so.status = 'paid')
          OR (so.target_station = 'pharmacy' AND so.status = 'paid')
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.patient_id = p.id
        AND i.status IN ('pending', 'partial')
    )
), patient_update AS (
  UPDATE public.patients p
     SET status = 'discharged', updated_at = now()
    FROM eligible e
   WHERE p.id = e.patient_id
   RETURNING p.id AS patient_id
), journey_update AS (
  UPDATE public.patient_journey j
     SET current_state = 'discharged', owner_role = NULL, owner_user_id = NULL,
         department = NULL, location = 'discharged', updated_at = now()
    FROM patient_update p
   WHERE j.patient_id = p.patient_id
     AND j.current_state = 'at_pharmacy'
   RETURNING j.id AS journey_id, j.patient_id
)
INSERT INTO public.patient_journey_history
  (journey_id, patient_id, from_state, to_state, to_owner_role, reason, created_at)
SELECT journey_id, patient_id, 'at_pharmacy', 'discharged', NULL,
       'targeted_repair_fadimatu_alqaseem_dispensed_status', now()
FROM journey_update;
