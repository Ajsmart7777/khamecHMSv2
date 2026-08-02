-- Restrict the database export backup bucket to admins only.
DROP POLICY IF EXISTS "Admins can read database export backups" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload database export backups" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update database export backups" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete database export backups" ON storage.objects;

CREATE POLICY "Admins can read database export backups"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'database_export_26_07_26' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can upload database export backups"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'database_export_26_07_26' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update database export backups"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'database_export_26_07_26' AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (bucket_id = 'database_export_26_07_26' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete database export backups"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'database_export_26_07_26' AND public.has_role(auth.uid(), 'admin'));