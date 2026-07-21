
-- 1) Staff self-select
CREATE POLICY "Staff can read own record"
ON public.staff
FOR SELECT
TO authenticated
USING (auth_user_id = auth.uid());

-- 2) Notifications: restrict broadcast rows by target_role
DROP POLICY IF EXISTS "Users can read own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;

CREATE POLICY "Users can read own or targeted notifications"
ON public.notifications
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR (
    user_id IS NULL
    AND target_role IS NOT NULL
    AND public.has_role(auth.uid(), target_role::public.app_role)
  )
);

CREATE POLICY "Users can update own or targeted notifications"
ON public.notifications
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  OR (
    user_id IS NULL
    AND target_role IS NOT NULL
    AND public.has_role(auth.uid(), target_role::public.app_role)
  )
);

-- 3) corporate_accounts: remove receptionist from SELECT
DROP POLICY IF EXISTS "Billing and admin can read corporate_accounts" ON public.corporate_accounts;

CREATE POLICY "Billing and admin can read corporate_accounts"
ON public.corporate_accounts
FOR SELECT
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role, 'accountant'::app_role]));
