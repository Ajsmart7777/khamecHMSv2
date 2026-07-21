
DROP POLICY IF EXISTS "Staff can view family members" ON public.staff_family_members;
CREATE POLICY "Staff view own family, admins view all"
  ON public.staff_family_members FOR SELECT
  TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['accountant'::app_role, 'admin'::app_role])
    OR staff_id IN (SELECT id FROM public.staff WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Staff can read own leave" ON public.staff_leave;
CREATE POLICY "Staff read own leave, admins read all"
  ON public.staff_leave FOR SELECT
  TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['accountant'::app_role, 'admin'::app_role, 'billing'::app_role])
    OR staff_id IN (SELECT id FROM public.staff WHERE auth_user_id = auth.uid())
  );
