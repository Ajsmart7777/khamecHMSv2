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
BEGIN
  IF _user_id IS NULL OR _patient_id IS NULL THEN RETURN false; END IF;

  -- Admin always allowed.
  IF public.has_role(_user_id, 'admin'::app_role) THEN RETURN true; END IF;

  -- Lab Tech check: if they have a PAID lab request for this patient, they must be allowed to fulfill it.
  IF public.has_role(_user_id, 'lab_tech'::app_role) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.snap_orders
       WHERE patient_id = _patient_id
         AND target_station = 'lab'
         AND status = 'paid'
    ) INTO _has_paid_lab_req;
    IF _has_paid_lab_req THEN RETURN true; END IF;
  END IF;

  -- Pharmacist check: if they have a PAID pharmacy request for this patient, they must be allowed to fulfill it.
  IF public.has_role(_user_id, 'pharmacist'::app_role) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.snap_orders
       WHERE patient_id = _patient_id
         AND target_station = 'pharmacy'
         AND status = 'paid'
    ) INTO _has_paid_rx_req;
    IF _has_paid_rx_req THEN RETURN true; END IF;
  END IF;

  SELECT status::text INTO _status FROM public.patients WHERE id = _patient_id;
  IF _status IS NULL THEN RETURN false; END IF;

  -- Lab result check: if a lab result is ready for THIS user, they are an owner.
  SELECT EXISTS (
    SELECT 1 FROM public.snap_orders
     WHERE patient_id = _patient_id
       AND order_type = 'lab_result'
       AND status = 'returned'
       AND returned_to = _user_id
  ) INTO _has_lab_return;

  IF _has_lab_return THEN RETURN true; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.admissions
     WHERE patient_id = _patient_id AND status = 'active'
  ) INTO _is_admitted;

  -- Admitted patients: nursing/doctor roles retain ownership in the ward.
  IF _is_admitted OR _status = 'admitted' THEN
    RETURN public.has_any_role(_user_id,
      ARRAY['nurse','doctor','doctor1','doctor2']::app_role[]);
  END IF;

  -- Allow nurses to act on 'waiting' status (Queue)
  IF _status = 'waiting' THEN
    RETURN public.has_role(_user_id, 'nurse'::app_role);
  END IF;

  RETURN CASE _status
    WHEN 'with_nurse'   THEN public.has_role(_user_id, 'nurse'::app_role)
    WHEN 'with_doctor'  THEN public.has_any_role(_user_id,
                              ARRAY['doctor','doctor1','doctor2']::app_role[])
    WHEN 'in_lab'       THEN public.has_role(_user_id, 'lab_tech'::app_role)
    WHEN 'at_pharmacy'  THEN public.has_role(_user_id, 'pharmacist'::app_role)
    ELSE false
  END;
END;
$$;