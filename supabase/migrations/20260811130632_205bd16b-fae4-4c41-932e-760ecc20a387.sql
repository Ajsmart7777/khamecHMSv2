DROP POLICY IF EXISTS "Billing and admin can update corporate_accounts" ON public.corporate_accounts;
CREATE POLICY "Billing and admin can update corporate_accounts"
ON public.corporate_accounts FOR UPDATE TO authenticated
USING (has_any_role(auth.uid(), ARRAY['billing'::app_role,'admin'::app_role]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['billing'::app_role,'admin'::app_role]));