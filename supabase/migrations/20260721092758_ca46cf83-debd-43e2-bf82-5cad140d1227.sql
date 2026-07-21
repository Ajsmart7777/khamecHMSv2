
-- 1. Extend app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'doctor1';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'doctor2';

-- 2. Extend staff table
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS is_system_user boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS family_deduction_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS staff_auth_user_id_key
  ON public.staff(auth_user_id) WHERE auth_user_id IS NOT NULL;

-- 3. Patient link to staff (for account_type='staff')
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS staff_link_id uuid REFERENCES public.staff(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS patients_staff_link_id_key
  ON public.patients(staff_link_id) WHERE staff_link_id IS NOT NULL;

-- 4. Payroll deductions queue
CREATE TABLE IF NOT EXISTS public.payroll_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  source_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','cancelled')),
  applied_in_period_id uuid REFERENCES public.payroll_periods(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_deductions TO authenticated;
GRANT ALL ON public.payroll_deductions TO service_role;

ALTER TABLE public.payroll_deductions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins & accountants view deductions"
  ON public.payroll_deductions FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]));

CREATE POLICY "Admins & accountants manage deductions"
  ON public.payroll_deductions FOR ALL
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]));

CREATE TRIGGER trg_payroll_deductions_updated
  BEFORE UPDATE ON public.payroll_deductions
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

-- 5. Trigger: auto-queue deduction for family invoice
CREATE OR REPLACE FUNCTION public.queue_family_deduction_after_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _acct text;
  _staff_id uuid;
  _consent boolean;
  _patient_share numeric(12,2);
BEGIN
  SELECT p.account_type, sfm.staff_id, s.family_deduction_consent
    INTO _acct, _staff_id, _consent
  FROM public.patients p
  LEFT JOIN public.staff_family_members sfm ON sfm.patient_id = p.id
  LEFT JOIN public.staff s ON s.id = sfm.staff_id
  WHERE p.id = NEW.patient_id;

  IF _acct = 'staff_family' AND _staff_id IS NOT NULL AND COALESCE(_consent,false) THEN
    _patient_share := ROUND(COALESCE(NEW.total_amount,0) * 0.5, 2);
    IF _patient_share > 0 THEN
      INSERT INTO public.payroll_deductions
        (staff_id, amount, reason, source_invoice_id, status)
      VALUES
        (_staff_id, _patient_share, 'Family invoice ' || COALESCE(NEW.invoice_number,''), NEW.id, 'pending');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.queue_family_deduction_after_invoice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_queue_family_deduction ON public.invoices;
CREATE TRIGGER trg_queue_family_deduction
  AFTER INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.queue_family_deduction_after_invoice();
