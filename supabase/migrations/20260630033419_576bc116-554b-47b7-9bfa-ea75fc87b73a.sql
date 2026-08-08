DROP POLICY IF EXISTS "Only admins can delete patients" ON public.patients;
CREATE POLICY "Only admins can delete patients"
ON public.patients FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Doctors and admins can delete prescriptions" ON public.prescriptions;
CREATE POLICY "Doctors and admins can delete prescriptions"
ON public.prescriptions FOR DELETE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['doctor', 'admin']::app_role[]));

DROP POLICY IF EXISTS "Clinical staff can delete prescription items" ON public.prescription_items;
CREATE POLICY "Clinical staff can delete prescription items"
ON public.prescription_items FOR DELETE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['doctor', 'pharmacist', 'admin']::app_role[]));

DROP POLICY IF EXISTS "Lab techs and admins can delete lab requests" ON public.lab_requests;
CREATE POLICY "Lab techs and admins can delete lab requests"
ON public.lab_requests FOR DELETE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['lab_tech', 'admin']::app_role[]));
