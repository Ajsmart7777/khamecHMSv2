CREATE POLICY "Only admins can delete patients"
ON public.patients FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Doctors and admins can delete prescriptions"
ON public.prescriptions FOR DELETE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['doctor', 'admin']::app_role[]));

CREATE POLICY "Clinical staff can delete prescription items"
ON public.prescription_items FOR DELETE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['doctor', 'pharmacist', 'admin']::app_role[]));

CREATE POLICY "Lab techs and admins can delete lab requests"
ON public.lab_requests FOR DELETE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['lab_tech', 'admin']::app_role[]));