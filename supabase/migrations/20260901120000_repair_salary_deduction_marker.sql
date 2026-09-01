-- The CockroachDB settlement RPC writes payment_method = salary_deduction.
-- Repair invoices created before is_salary_deduction was persisted correctly.

UPDATE public.invoices AS i
SET is_salary_deduction = true,
    staff_sponsor_id = sfm.staff_id
FROM public.staff_family_members AS sfm
WHERE i.patient_id = sfm.patient_id
  AND (
    i.is_salary_deduction = true
    OR lower(COALESCE(i.payment_method, '')) IN ('salary', 'salary_deduction')
  );

-- Ensure the visible flag and sponsor linkage are both written when Cashier
-- settles an invoice through the deployed RPC.
CREATE OR REPLACE FUNCTION public.ensure_salary_deduction_sponsor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_staff_id uuid;
  v_salary_deduction boolean;
BEGIN
  v_salary_deduction := COALESCE((NEW).is_salary_deduction, false)
    OR lower(COALESCE((NEW).payment_method, '')) IN ('salary', 'salary_deduction');

  IF v_salary_deduction THEN
    NEW.is_salary_deduction := true;

    SELECT sfm.staff_id
      INTO v_staff_id
    FROM public.staff_family_members AS sfm
    WHERE sfm.patient_id = (NEW).patient_id
    LIMIT 1;

    IF v_staff_id IS NOT NULL THEN
      NEW.staff_sponsor_id := COALESCE((NEW).staff_sponsor_id, v_staff_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_ensure_salary_deduction_sponsor ON public.invoices;
CREATE TRIGGER invoices_ensure_salary_deduction_sponsor
BEFORE INSERT OR UPDATE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.ensure_salary_deduction_sponsor();
