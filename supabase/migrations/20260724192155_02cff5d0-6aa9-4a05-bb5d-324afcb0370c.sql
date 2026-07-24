-- 1. Tighten snap_orders fulfiller policy: pharmacist -> pharmacy, lab_tech -> lab
DROP POLICY IF EXISTS "Fulfillers update only paid snap orders" ON public.snap_orders;

CREATE POLICY "Fulfillers update only paid snap orders"
ON public.snap_orders
FOR UPDATE
USING (
  status = 'paid'
  AND (
    (target_station = 'pharmacy' AND has_role(auth.uid(), 'pharmacist'::app_role))
    OR
    (target_station = 'lab' AND has_role(auth.uid(), 'lab_tech'::app_role))
  )
)
WITH CHECK (
  status = ANY (ARRAY['paid'::text, 'fulfilled'::text, 'rejected'::text])
  AND (
    (target_station = 'pharmacy' AND has_role(auth.uid(), 'pharmacist'::app_role))
    OR
    (target_station = 'lab' AND has_role(auth.uid(), 'lab_tech'::app_role))
  )
);

-- 2. Validate staff_family_members linkage via trigger
CREATE OR REPLACE FUNCTION public.validate_staff_family_linkage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _acct text;
  _linked_staff uuid;
BEGIN
  SELECT account_type INTO _acct FROM public.patients WHERE id = NEW.patient_id;
  IF _acct IS NULL THEN
    RAISE EXCEPTION 'Patient % not found', NEW.patient_id;
  END IF;
  IF _acct <> 'staff_family' THEN
    RAISE EXCEPTION 'Patient % is not marked as staff_family (account_type=%)', NEW.patient_id, _acct;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.staff WHERE id = NEW.staff_id) THEN
    RAISE EXCEPTION 'Staff % not found', NEW.staff_id;
  END IF;

  SELECT staff_id INTO _linked_staff
    FROM public.staff_family_members
   WHERE patient_id = NEW.patient_id
     AND (TG_OP = 'INSERT' OR id <> NEW.id)
   LIMIT 1;
  IF _linked_staff IS NOT NULL AND _linked_staff <> NEW.staff_id THEN
    RAISE EXCEPTION 'Patient % is already linked to another staff member', NEW.patient_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_staff_family_linkage ON public.staff_family_members;
CREATE TRIGGER trg_validate_staff_family_linkage
BEFORE INSERT OR UPDATE ON public.staff_family_members
FOR EACH ROW EXECUTE FUNCTION public.validate_staff_family_linkage();