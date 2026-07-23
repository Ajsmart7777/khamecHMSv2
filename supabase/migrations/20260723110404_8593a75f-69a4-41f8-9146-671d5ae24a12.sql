
-- 1. app_settings: restrict SELECT to admin only
DROP POLICY IF EXISTS "read settings" ON public.app_settings;
CREATE POLICY "Admin reads settings"
  ON public.app_settings
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2. wards / rooms: admin-only management
DROP POLICY IF EXISTS "Admin manages wards" ON public.wards;
CREATE POLICY "Admin manages wards"
  ON public.wards
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admin manages rooms" ON public.rooms;
CREATE POLICY "Admin manages rooms"
  ON public.rooms
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 3. beds: admin + nurse (drop accountant)
DROP POLICY IF EXISTS "Admin & nurses manage bed status" ON public.beds;
CREATE POLICY "Admin & nurses manage bed status"
  ON public.beds
  FOR ALL
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','nurse']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','nurse']::app_role[]));
