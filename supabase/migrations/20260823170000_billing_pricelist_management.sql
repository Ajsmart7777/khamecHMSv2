-- Billing staff manage the same shared Pricelist as Accountant.
DROP POLICY IF EXISTS "Admin/accountant manage pricelist" ON public.pricelist;

CREATE POLICY "Admin accountant billing manage pricelist"
  ON public.pricelist FOR ALL TO authenticated
  USING (public.has_any_role(
    public.hms_current_user_id(),
    ARRAY['admin','accountant','billing']::public.app_role[]
  ))
  WITH CHECK (public.has_any_role(
    public.hms_current_user_id(),
    ARRAY['admin','accountant','billing']::public.app_role[]
  ));
