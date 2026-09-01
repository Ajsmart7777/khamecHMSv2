-- Repair two related workflow defects without changing manual payroll behavior:
-- 1) salary-deduction settlement can mark an invoice paid with paid_amount = 0;
-- 2) a paid pharmacy snap can remain active after the prescription is dispensed.

-- Salary deduction represents the full invoice being covered by the staff salary.
UPDATE public.invoices AS i
SET is_salary_deduction = true,
    paid_amount = COALESCE(i.total_amount, i.paid_amount),
    staff_sponsor_id = sfm.staff_id
FROM public.staff_family_members AS sfm
WHERE i.patient_id = sfm.patient_id
  AND (
    i.is_salary_deduction = true
    OR lower(COALESCE(i.payment_method, '')) IN ('salary', 'salary_deduction')
  );

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

    IF COALESCE((NEW).paid_amount, 0) = 0 THEN
      NEW.paid_amount := COALESCE((NEW).total_amount, 0);
    END IF;

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

-- A paid pharmacy snap is complete when the patient has no pending prescription,
-- unpaid invoice, or other pending laboratory/pharmacy work.
UPDATE public.snap_orders AS so
SET status = 'fulfilled',
    fulfilled_at = COALESCE(so.fulfilled_at, now()),
    updated_at = now()
WHERE so.target_station = 'pharmacy'
  AND so.status = 'paid'
  AND NOT EXISTS (
    SELECT 1 FROM public.prescriptions AS pr
    WHERE pr.patient_id = so.patient_id
      AND pr.status = 'pending'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.invoices AS i
    WHERE i.patient_id = so.patient_id
      AND i.status IN ('pending', 'partial')
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.snap_orders AS other_so
    WHERE other_so.patient_id = so.patient_id
      AND other_so.target_station = 'lab'
      AND other_so.status = 'paid'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.lab_requests AS lr
    WHERE lr.patient_id = so.patient_id
      AND lr.status = 'pending'
  );
