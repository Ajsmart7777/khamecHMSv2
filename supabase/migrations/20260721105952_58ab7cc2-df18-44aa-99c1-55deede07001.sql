
-- staff
DROP POLICY IF EXISTS "Admin and account can read staff" ON public.staff;
DROP POLICY IF EXISTS "Only admin can delete staff" ON public.staff;
DROP POLICY IF EXISTS "Only admin can insert staff" ON public.staff;
DROP POLICY IF EXISTS "Only admin can update staff" ON public.staff;

CREATE POLICY "Admin and account can read staff" ON public.staff
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'billing'::app_role]));
CREATE POLICY "Only admin can delete staff" ON public.staff
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Only admin can insert staff" ON public.staff
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Only admin can update staff" ON public.staff
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- shift_periods
DROP POLICY IF EXISTS "Admin can delete shift_periods" ON public.shift_periods;
DROP POLICY IF EXISTS "Admin can insert shift_periods" ON public.shift_periods;
DROP POLICY IF EXISTS "Admin can update shift_periods" ON public.shift_periods;
DROP POLICY IF EXISTS "Authenticated staff can read shift_periods" ON public.shift_periods;

CREATE POLICY "Admin can delete shift_periods" ON public.shift_periods
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admin can insert shift_periods" ON public.shift_periods
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admin can update shift_periods" ON public.shift_periods
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated staff can read shift_periods" ON public.shift_periods
  FOR SELECT TO authenticated USING (is_authenticated_staff());

-- shift_assignments
DROP POLICY IF EXISTS "Admin can delete shift_assignments" ON public.shift_assignments;
DROP POLICY IF EXISTS "Admin can insert shift_assignments" ON public.shift_assignments;
DROP POLICY IF EXISTS "Admin can update shift_assignments" ON public.shift_assignments;
DROP POLICY IF EXISTS "Staff can read own assignments" ON public.shift_assignments;

CREATE POLICY "Admin can delete shift_assignments" ON public.shift_assignments
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admin can insert shift_assignments" ON public.shift_assignments
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admin can update shift_assignments" ON public.shift_assignments
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Staff can read own assignments" ON public.shift_assignments
  FOR SELECT TO authenticated
  USING ((staff_user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

-- shift_logs
DROP POLICY IF EXISTS "Staff can insert own shift_logs" ON public.shift_logs;
DROP POLICY IF EXISTS "Staff can read own logs and admin can read all" ON public.shift_logs;
DROP POLICY IF EXISTS "Staff can update own shift_logs" ON public.shift_logs;

CREATE POLICY "Staff can insert own shift_logs" ON public.shift_logs
  FOR INSERT TO authenticated WITH CHECK (staff_user_id = auth.uid());
CREATE POLICY "Staff can read own logs and admin can read all" ON public.shift_logs
  FOR SELECT TO authenticated
  USING ((staff_user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Staff can update own shift_logs" ON public.shift_logs
  FOR UPDATE TO authenticated
  USING ((staff_user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));
