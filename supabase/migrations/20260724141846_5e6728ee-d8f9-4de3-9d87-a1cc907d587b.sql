-- Fix: after splitting 'doctor' into 'doctor1' and 'doctor2', RLS policies still only allow 'doctor'.
-- Update policies on prescriptions, prescription_items, and lab_requests to include doctor1/doctor2.
-- Also allow cashier role to settle visits (close_visit).

-- prescriptions
DROP POLICY IF EXISTS "Doctors can insert prescriptions" ON public.prescriptions;
DROP POLICY IF EXISTS "Doctors and pharmacists can update prescriptions" ON public.prescriptions;
DROP POLICY IF EXISTS "Doctors and admins can delete prescriptions" ON public.prescriptions;

CREATE POLICY "Doctors can insert prescriptions" ON public.prescriptions
  FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','admin']::app_role[]));

CREATE POLICY "Doctors and pharmacists can update prescriptions" ON public.prescriptions
  FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','pharmacist','admin']::app_role[]));

CREATE POLICY "Doctors and admins can delete prescriptions" ON public.prescriptions
  FOR DELETE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','admin']::app_role[]));

-- prescription_items
DROP POLICY IF EXISTS "Doctors can insert prescription_items" ON public.prescription_items;
DROP POLICY IF EXISTS "Doctors and pharmacists can update prescription_items" ON public.prescription_items;
DROP POLICY IF EXISTS "Clinical staff can delete prescription items" ON public.prescription_items;

CREATE POLICY "Doctors can insert prescription_items" ON public.prescription_items
  FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','admin']::app_role[]));

CREATE POLICY "Doctors and pharmacists can update prescription_items" ON public.prescription_items
  FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','pharmacist','admin']::app_role[]));

CREATE POLICY "Clinical staff can delete prescription items" ON public.prescription_items
  FOR DELETE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','pharmacist','admin']::app_role[]));

-- lab_requests
DROP POLICY IF EXISTS "Doctors and lab_tech can insert lab_requests" ON public.lab_requests;
DROP POLICY IF EXISTS "Doctors and lab_tech can update lab_requests" ON public.lab_requests;
DROP POLICY IF EXISTS "Lab techs and admins can delete lab requests" ON public.lab_requests;

CREATE POLICY "Doctors and lab_tech can insert lab_requests" ON public.lab_requests
  FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','lab_tech','admin']::app_role[]));

CREATE POLICY "Doctors and lab_tech can update lab_requests" ON public.lab_requests
  FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','lab_tech','admin']::app_role[]));

CREATE POLICY "Lab techs and admins can delete lab requests" ON public.lab_requests
  FOR DELETE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['lab_tech','admin']::app_role[]));

-- close_visit: allow cashier as well
CREATE OR REPLACE FUNCTION public.close_visit(_visit_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _v RECORD;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['billing','cashier','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only billing/cashier/admin can settle a visit';
  END IF;
  PERFORM public.recalc_visit_totals(_visit_id);
  SELECT * INTO _v FROM public.visits WHERE id = _visit_id;
  IF _v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF _v.status <> 'open' THEN RAISE EXCEPTION 'Visit is already %', _v.status; END IF;

  UPDATE public.visits
    SET status = 'settled', closed_at = now(), closed_by = auth.uid(), updated_at = now()
  WHERE id = _visit_id;

  PERFORM public.write_audit_log(
    'visit_settled', 'visit', _visit_id::text,
    jsonb_build_object(
      'visit_number', _v.visit_number,
      'patient_id', _v.patient_id,
      'sponsor_type', _v.sponsor_type,
      'total_charged', _v.total_charged,
      'total_paid', _v.total_paid
    )
  );
END; $function$;