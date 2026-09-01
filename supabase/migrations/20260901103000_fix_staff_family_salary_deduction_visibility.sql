-- Staff-family salary deductions are always eligible.
-- Accountants review these invoices and enter payroll deductions manually.

ALTER TABLE public.staff
  ALTER COLUMN family_deduction_consent SET DEFAULT true;

UPDATE public.staff
SET family_deduction_consent = true
WHERE family_deduction_consent IS DISTINCT FROM true;

ALTER TABLE public.staff_family_members
  ALTER COLUMN salary_deduction_consent SET DEFAULT true;

UPDATE public.staff_family_members
SET salary_deduction_consent = true
WHERE salary_deduction_consent IS DISTINCT FROM true;

-- Repair historical salary-deduction invoices whose sponsor ID was not written
-- by the CockroachDB-compatible settlement RPC.
UPDATE public.invoices AS i
SET staff_sponsor_id = sfm.staff_id
FROM public.staff_family_members AS sfm
WHERE i.patient_id = sfm.patient_id
  AND i.is_salary_deduction = true
  AND i.staff_sponsor_id IS NULL;

-- Keep the sponsor linkage correct for every future salary-deduction invoice.
-- This does not create payroll entries or apply deductions to a payroll period.
CREATE OR REPLACE FUNCTION public.ensure_salary_deduction_sponsor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_staff_id uuid;
BEGIN
  IF COALESCE((NEW).is_salary_deduction, false) THEN
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
