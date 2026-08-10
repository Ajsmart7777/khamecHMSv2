
-- Hardening ownership: doctors who have a returned lab result should be allowed 
-- to snap orders for that patient even if the status hasn't moved yet.
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
BEGIN
  IF _user_id IS NULL OR _patient_id IS NULL THEN RETURN false; END IF;

  -- Admin always allowed.
  IF public.has_role(_user_id, 'admin'::app_role) THEN RETURN true; END IF;

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
