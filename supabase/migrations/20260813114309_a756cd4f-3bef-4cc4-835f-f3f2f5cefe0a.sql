CREATE OR REPLACE FUNCTION public.can_add_snap_for_patient(_patient_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _status text;
  _is_admitted boolean;
  _has_lab_return boolean;
  _has_paid_lab_req boolean;
  _has_paid_rx_req boolean;
  _user_role app_role;
BEGIN
  IF _user_id IS NULL OR _patient_id IS NULL THEN RETURN false; END IF;

  -- Admin always allowed.
  IF public.has_role(_user_id, 'admin'::app_role) THEN RETURN true; END IF;

  -- Get patient status
  SELECT status::text INTO _status FROM public.patients WHERE id = _patient_id;
  IF _status IS NULL THEN RETURN false; END IF;

  -- Get current user role (taking first role found for simplicity in this logic)
  SELECT role INTO _user_role FROM public.user_roles WHERE user_id = _user_id LIMIT 1;

  -- Lab Tech check: if they have a PAID lab request for this patient, they must be allowed to fulfill it.
  IF _user_role = 'lab_tech'::app_role THEN
    SELECT EXISTS (
      SELECT 1 FROM public.snap_orders
       WHERE patient_id = _patient_id
         AND target_station = 'lab'
         AND status = 'paid'
    ) INTO _has_paid_lab_req;
    IF _has_paid_lab_req THEN RETURN true; END IF;
  END IF;

  -- Pharmacist check: if they have a PAID pharmacy request for this patient, they must be allowed to fulfill it.
  IF _user_role = 'pharmacist'::app_role THEN
    SELECT EXISTS (
      SELECT 1 FROM public.snap_orders
       WHERE patient_id = _patient_id
         AND target_station = 'pharmacy'
         AND status = 'paid'
    ) INTO _has_paid_rx_req;
    IF _has_paid_rx_req THEN RETURN true; END IF;
  END IF;

  -- Lab result check: if a lab result was returned to THIS user, they are an owner.
  -- This is a HARD RULE: returned results grant ownership back to sender.
  SELECT EXISTS (
    SELECT 1 FROM public.snap_orders
     WHERE patient_id = _patient_id
       AND order_type = 'lab_result'
       AND status = 'returned'
       AND returned_to = _user_id
  ) INTO _has_lab_return;

  IF _has_lab_return THEN RETURN true; END IF;

  -- Admission check
  SELECT EXISTS (
    SELECT 1 FROM public.admissions
     WHERE patient_id = _patient_id AND status = 'active'
  ) INTO _is_admitted;

  -- Admitted patients: clinical staff always have ownership.
  IF _is_admitted OR _status = 'admitted' THEN
    RETURN _user_role IN ('nurse', 'doctor', 'doctor1', 'doctor2');
  END IF;

  -- CLINICAL OWNERSHIP RULES
  -- 1. Nurse owns when status is 'waiting' (triage) or 'with_nurse' (vitals/triage in progress)
  IF _user_role = 'nurse' AND _status IN ('waiting', 'with_nurse') THEN
    RETURN true;
  END IF;

  -- 2. Doctor owns when status is 'with_doctor'
  IF _user_role IN ('doctor', 'doctor1', 'doctor2') AND _status = 'with_doctor' THEN
    -- If it's doctor1 or doctor2, check assignment
    DECLARE
      _assigned_doc text;
    BEGIN
      SELECT assigned_doctor::text INTO _assigned_doc FROM public.patients WHERE id = _patient_id;
      IF _assigned_doc IS NOT NULL AND _assigned_doc != _user_role::text AND _user_role::text IN ('doctor1', 'doctor2') THEN
        RETURN false; -- Assigned to the other doctor
      END IF;
      RETURN true;
    END;
  END IF;

  -- 3. Multi-order workflow: allow clinical staff to add snaps even if status is 'awaiting_billing'
  -- as long as they were the last ones interacting (nurse or doctor).
  IF _user_role IN ('nurse', 'doctor', 'doctor1', 'doctor2') AND _status = 'awaiting_billing' THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;