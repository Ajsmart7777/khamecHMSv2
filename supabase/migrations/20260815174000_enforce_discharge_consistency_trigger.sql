-- Enforce strict discharge consistency at the database level.
-- This trigger prevents a patient from being marked as 'discharged' if they
-- have any open visits, active admissions, or pending clinical/financial records.

CREATE OR REPLACE FUNCTION public.check_patient_discharge_eligibility()
RETURNS TRIGGER AS $$
DECLARE
  _pending_station text;
  _open_visit_id uuid;
  _active_adm_id uuid;
  _pending_inv_id uuid;
BEGIN
  -- Only run check when status is changing to 'discharged'
  IF NEW.status = 'discharged' AND (OLD.status IS NULL OR OLD.status <> 'discharged') THEN
    
    -- 1. Check for pending workflow stations (Labs, Pharmacy, Billing)
    -- This uses the hardened function that checks snap_orders, lab_requests, and prescriptions.
    _pending_station := public.patient_pending_workflow_station(NEW.id);
    IF _pending_station IS NOT NULL THEN
      RAISE EXCEPTION 'CANNOT_DISCHARGE: patient has pending workflow at %', _pending_station;
    END IF;

    -- 2. Check for open visits
    SELECT id INTO _open_visit_id
    FROM public.visits
    WHERE patient_id = NEW.id AND status = 'open'
    LIMIT 1;
    IF _open_visit_id IS NOT NULL THEN
      RAISE EXCEPTION 'CANNOT_DISCHARGE: patient has an open visit (ID: %)', _open_visit_id;
    END IF;

    -- 3. Check for active admissions
    SELECT id INTO _active_adm_id
    FROM public.admissions
    WHERE patient_id = NEW.id
      AND status IN ('waiting_assignment', 'active', 'ready_for_discharge')
    LIMIT 1;
    IF _active_adm_id IS NOT NULL THEN
      RAISE EXCEPTION 'CANNOT_DISCHARGE: patient has an active admission (ID: %)', _active_adm_id;
    END IF;

    -- 4. Check for unpaid invoices
    SELECT id INTO _pending_inv_id
    FROM public.invoices
    WHERE patient_id = NEW.id AND status IN ('pending', 'partial')
    LIMIT 1;
    IF _pending_inv_id IS NOT NULL THEN
      RAISE EXCEPTION 'CANNOT_DISCHARGE: patient has unpaid or partial invoices';
    END IF;

  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop if exists to ensure clean application
DROP TRIGGER IF EXISTS tr_check_patient_discharge_eligibility ON public.patients;

CREATE TRIGGER tr_check_patient_discharge_eligibility
BEFORE UPDATE ON public.patients
FOR EACH ROW
EXECUTE FUNCTION public.check_patient_discharge_eligibility();

-- Also apply to the patient_journey table to ensure the journey state stays in sync
CREATE OR REPLACE FUNCTION public.check_journey_discharge_eligibility()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.current_state = 'discharged' AND (OLD.current_state IS NULL OR OLD.current_state <> 'discharged') THEN
    -- We can just call the patient check logic or rely on the fact that 
    -- advance_journey updates both. However, a direct update to patient_journey
    -- should also be guarded.
    IF EXISTS (
      SELECT 1 FROM public.visits WHERE patient_id = NEW.patient_id AND status = 'open'
    ) OR EXISTS (
      SELECT 1 FROM public.admissions WHERE patient_id = NEW.patient_id AND status IN ('waiting_assignment', 'active', 'ready_for_discharge')
    ) OR public.patient_pending_workflow_station(NEW.patient_id) IS NOT NULL THEN
      RAISE EXCEPTION 'CANNOT_DISCHARGE: journey transition blocked by open visit or pending orders';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_check_journey_discharge_eligibility ON public.patient_journey;

CREATE TRIGGER tr_check_journey_discharge_eligibility
BEFORE UPDATE ON public.patient_journey
FOR EACH ROW
EXECUTE FUNCTION public.check_journey_discharge_eligibility();
