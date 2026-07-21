
CREATE POLICY "Staff read standing-orders photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'standing-orders' AND public.is_authenticated_staff());

CREATE POLICY "Receptionist/admin upload standing-orders photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'standing-orders' AND public.has_any_role(auth.uid(), ARRAY['receptionist'::public.app_role, 'admin'::public.app_role]));

CREATE POLICY "Clinical/admin update standing-orders photos" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'standing-orders' AND public.has_any_role(auth.uid(), ARRAY['receptionist'::public.app_role, 'doctor'::public.app_role, 'pharmacist'::public.app_role, 'admin'::public.app_role]));

CREATE POLICY "Admin delete standing-orders photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'standing-orders' AND public.has_role(auth.uid(), 'admin'::public.app_role));
