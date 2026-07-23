
-- 1. Split the UPDATE policy so pharmacist/lab_tech only see paid rows
DROP POLICY IF EXISTS "Ops update snap orders" ON public.snap_orders;

CREATE POLICY "Billing update snap orders"
  ON public.snap_orders FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['billing','accountant','admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(),
    ARRAY['billing','accountant','admin']::app_role[]));

CREATE POLICY "Fulfillers update only paid snap orders"
  ON public.snap_orders FOR UPDATE TO authenticated
  USING (
    public.has_any_role(auth.uid(),
      ARRAY['pharmacist','lab_tech']::app_role[])
    AND status = 'paid'
  )
  WITH CHECK (
    public.has_any_role(auth.uid(),
      ARRAY['pharmacist','lab_tech']::app_role[])
    AND status IN ('paid','fulfilled','rejected')
  );

-- 2. Defense-in-depth trigger: cannot move to 'fulfilled' unless previously 'paid'
CREATE OR REPLACE FUNCTION public.enforce_snap_paid_before_fulfill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'fulfilled'
     AND COALESCE(OLD.status,'') <> 'fulfilled'
     AND COALESCE(OLD.status,'') <> 'paid' THEN
    RAISE EXCEPTION 'PAYMENT_REQUIRED: snap % must be paid before it can be fulfilled (current status: %)',
      NEW.id, OLD.status;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_snap_paid_before_fulfill() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_snap_paid_before_fulfill ON public.snap_orders;
CREATE TRIGGER trg_snap_paid_before_fulfill
  BEFORE UPDATE ON public.snap_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_snap_paid_before_fulfill();
