
CREATE POLICY "Staff can view visit-card photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'visit-cards' AND public.is_authenticated_staff());

CREATE POLICY "Staff can upload visit-card photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'visit-cards'
  AND public.has_any_role(auth.uid(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','lab_tech','pharmacist','billing','accountant','admin']::app_role[])
);

CREATE POLICY "Admin can delete visit-card photos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'visit-cards' AND public.has_role(auth.uid(), 'admin'));
