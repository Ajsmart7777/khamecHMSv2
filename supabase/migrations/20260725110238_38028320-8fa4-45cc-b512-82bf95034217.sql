
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS photo_path text;

-- Storage policies for patient-photos bucket (staff-only)
CREATE POLICY "patient_photos_select_staff"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'patient-photos' AND public.is_authenticated_staff());

CREATE POLICY "patient_photos_insert_staff"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'patient-photos' AND public.is_authenticated_staff());

CREATE POLICY "patient_photos_update_staff"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'patient-photos' AND public.is_authenticated_staff())
  WITH CHECK (bucket_id = 'patient-photos' AND public.is_authenticated_staff());

CREATE POLICY "patient_photos_delete_staff"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'patient-photos' AND public.is_authenticated_staff());
