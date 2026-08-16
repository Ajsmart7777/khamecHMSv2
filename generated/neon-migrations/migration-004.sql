-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 18
CREATE POLICY "Staff can read standing_orders" ON public.standing_orders
  FOR SELECT TO authenticated USING (is_authenticated_staff());

-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 19
CREATE POLICY "Receptionist and admin can insert standing_orders" ON public.standing_orders
  FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['receptionist'::app_role, 'admin'::app_role]));

-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 20
CREATE POLICY "Clinical and admin can update standing_orders" ON public.standing_orders
  FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['receptionist'::app_role, 'doctor'::app_role, 'pharmacist'::app_role, 'admin'::app_role]));

-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 21
CREATE POLICY "Admin can delete standing_orders" ON public.standing_orders
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 22
CREATE TRIGGER update_standing_orders_updated_at
  BEFORE UPDATE ON public.standing_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 23
CREATE INDEX IF NOT EXISTS standing_orders_patient_id_idx ON public.standing_orders(patient_id);

-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 24
CREATE INDEX IF NOT EXISTS standing_orders_status_idx ON public.standing_orders(status);

-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 25
CREATE INDEX IF NOT EXISTS insurance_claims_sponsor_type_idx ON public.insurance_claims(sponsor_type);

-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 26
CREATE INDEX IF NOT EXISTS insurance_claims_corporate_account_id_idx ON public.insurance_claims(corporate_account_id);

-- SOURCE: 20260721082348_f2729204-995d-43df-a6f4-4df0d65b3a63.sql statement 1
ALTER TABLE public.standing_orders ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'prescription' CHECK (order_type IN ('prescription','lab','both'));

-- SOURCE: 20260721083039_a667ea11-7d28-437a-baec-4878cdb7ae20.sql statement 1
REVOKE EXECUTE ON FUNCTION public.audit_invoice_payment() FROM PUBLIC, anon, authenticated;

-- SOURCE: 20260721083039_a667ea11-7d28-437a-baec-4878cdb7ae20.sql statement 2
REVOKE EXECUTE ON FUNCTION public.audit_payroll_processed() FROM PUBLIC, anon, authenticated;

-- SOURCE: 20260721083039_a667ea11-7d28-437a-baec-4878cdb7ae20.sql statement 3
REVOKE EXECUTE ON FUNCTION public.audit_prescription_dispense() FROM PUBLIC, anon, authenticated;

-- SOURCE: 20260721083039_a667ea11-7d28-437a-baec-4878cdb7ae20.sql statement 4
REVOKE EXECUTE ON FUNCTION public.audit_user_roles() FROM PUBLIC, anon, authenticated;

-- SOURCE: 20260721083039_a667ea11-7d28-437a-baec-4878cdb7ae20.sql statement 5
REVOKE EXECUTE ON FUNCTION public.update_patients_updated_at() FROM PUBLIC, anon, authenticated;

-- SOURCE: 20260721083039_a667ea11-7d28-437a-baec-4878cdb7ae20.sql statement 6
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;

-- SOURCE: 20260721083039_a667ea11-7d28-437a-baec-4878cdb7ae20.sql statement 7
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, app_role[]) FROM PUBLIC, anon;

-- SOURCE: 20260721083039_a667ea11-7d28-437a-baec-4878cdb7ae20.sql statement 8
REVOKE EXECUTE ON FUNCTION public.is_authenticated_staff() FROM PUBLIC, anon;

-- SOURCE: 20260721083039_a667ea11-7d28-437a-baec-4878cdb7ae20.sql statement 9
REVOKE EXECUTE ON FUNCTION public.write_audit_log(text, text, text, jsonb, text) FROM PUBLIC, anon;

-- SOURCE: 20260721083101_b2d29fc6-e64d-47a5-893a-7ab467deee35.sql statement 1
REVOKE EXECUTE ON FUNCTION public.write_audit_log(text, text, text, jsonb, text) FROM authenticated;

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 1
CREATE TABLE public.balance_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (request_type IN ('topup','refund')),
  amount NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected','expired','cancelled')),
  payment_method TEXT,
  requested_by UUID REFERENCES neon_auth.user(id),
  confirmed_by UUID REFERENCES neon_auth.user(id),
  notes TEXT,
  rejection_reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 2
GRANT SELECT, INSERT, UPDATE ON public.balance_requests TO authenticated;

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 3
GRANT ALL ON public.balance_requests TO service_role;

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 4
ALTER TABLE public.balance_requests ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 5
CREATE POLICY "Staff can view balance requests" ON public.balance_requests
  FOR SELECT TO authenticated USING (public.is_authenticated_staff());

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 6
CREATE POLICY "Reception/billing/admin can create balance requests" ON public.balance_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['receptionist','billing','admin','accountant']::app_role[])
  );

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 7
CREATE POLICY "Billing/admin can update balance requests" ON public.balance_requests
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['billing','admin']::app_role[]));

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 8
CREATE INDEX idx_balance_requests_patient ON public.balance_requests(patient_id);

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 9
CREATE INDEX idx_balance_requests_status ON public.balance_requests(status);

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 10
CREATE TABLE public.staff_family_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  salary_deduction_consent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (patient_id)
);

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 11
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_family_members TO authenticated;

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 12
GRANT ALL ON public.staff_family_members TO service_role;

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 13
ALTER TABLE public.staff_family_members ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 14
CREATE POLICY "Staff can view family members" ON public.staff_family_members
  FOR SELECT TO authenticated USING (public.is_authenticated_staff());

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 15
CREATE POLICY "Accountant/admin manage family members" ON public.staff_family_members
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]));

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 16
CREATE OR REPLACE FUNCTION public.enforce_family_member_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cnt INT;
BEGIN
  SELECT COUNT(*) INTO cnt FROM public.staff_family_members WHERE staff_id = NEW.staff_id;
  IF cnt >= 4 THEN
    RAISE EXCEPTION 'Staff can only enroll up to 4 family members';
  END IF;
  RETURN NEW;
END;
$$;

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 17
CREATE TRIGGER trg_family_limit BEFORE INSERT ON public.staff_family_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_family_member_limit();

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 18
CREATE TABLE public.balance_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('topup','refund','invoice_deduction','staff_family_coverage','staff_coverage','adjustment')),
  amount NUMERIC(12,2) NOT NULL,
  balance_before NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  payment_method TEXT,
  related_request_id UUID REFERENCES public.balance_requests(id),
  related_invoice_id UUID REFERENCES public.invoices(id),
  performed_by UUID REFERENCES neon_auth.user(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 19
GRANT SELECT ON public.balance_transactions TO authenticated;

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 20
GRANT ALL ON public.balance_transactions TO service_role;

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 21
ALTER TABLE public.balance_transactions ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 22
CREATE POLICY "Staff view balance transactions" ON public.balance_transactions
  FOR SELECT TO authenticated USING (public.is_authenticated_staff());

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 23
CREATE INDEX idx_balance_tx_patient ON public.balance_transactions(patient_id);

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 24
CREATE INDEX idx_balance_tx_created ON public.balance_transactions(created_at DESC);

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 25
CREATE OR REPLACE FUNCTION public.adjust_patient_balance(
  _patient_id UUID,
  _delta NUMERIC,
  _transaction_type TEXT,
  _payment_method TEXT DEFAULT NULL,
  _related_request_id UUID DEFAULT NULL,
  _related_invoice_id UUID DEFAULT NULL,
  _notes TEXT DEFAULT NULL
) RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _before NUMERIC;
  _after NUMERIC;
BEGIN
  SELECT balance INTO _before FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _before IS NULL THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;
  _after := _before + _delta;
  IF _after < 0 THEN
    RAISE EXCEPTION 'Insufficient balance (current: %, requested delta: %)', _before, _delta;
  END IF;
  UPDATE public.patients SET balance = _after, updated_at = now() WHERE id = _patient_id;
  INSERT INTO public.balance_transactions
    (patient_id, transaction_type, amount, balance_before, balance_after, payment_method, related_request_id, related_invoice_id, performed_by, notes)
  VALUES
    (_patient_id, _transaction_type, _delta, _before, _after, _payment_method, _related_request_id, _related_invoice_id, auth.uid(), _notes);
  RETURN _after;
END;
$$;

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 26
REVOKE EXECUTE ON FUNCTION public.adjust_patient_balance(UUID,NUMERIC,TEXT,TEXT,UUID,UUID,TEXT) FROM PUBLIC, anon;

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 27
GRANT EXECUTE ON FUNCTION public.adjust_patient_balance(UUID,NUMERIC,TEXT,TEXT,UUID,UUID,TEXT) TO authenticated;

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 28
CREATE TRIGGER trg_balance_requests_updated_at BEFORE UPDATE ON public.balance_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

-- SOURCE: 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql statement 29
CREATE TRIGGER trg_staff_family_updated_at BEFORE UPDATE ON public.staff_family_members
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

-- SOURCE: 20260721090523_b4a45768-4a74-4935-86d9-a672515e30b0.sql statement 1
REVOKE EXECUTE ON FUNCTION public.enforce_family_member_limit() FROM PUBLIC, anon, authenticated;

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 1
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'doctor1';

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 2
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'doctor2';

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 3
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS is_system_user boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS family_deduction_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES neon_auth.user(id) ON DELETE SET NULL;

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 4
CREATE UNIQUE INDEX IF NOT EXISTS staff_auth_user_id_key
  ON public.staff(auth_user_id) WHERE auth_user_id IS NOT NULL;

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 5
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS staff_link_id uuid REFERENCES public.staff(id) ON DELETE SET NULL;

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 6
CREATE UNIQUE INDEX IF NOT EXISTS patients_staff_link_id_key
  ON public.patients(staff_link_id) WHERE staff_link_id IS NOT NULL;

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 7
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

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 8
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_deductions TO authenticated;

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 9
GRANT ALL ON public.payroll_deductions TO service_role;

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 10
ALTER TABLE public.payroll_deductions ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 11
CREATE POLICY "Admins & accountants view deductions"
  ON public.payroll_deductions FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]));

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 12
CREATE POLICY "Admins & accountants manage deductions"
  ON public.payroll_deductions FOR ALL
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]));

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 13
CREATE TRIGGER trg_payroll_deductions_updated
  BEFORE UPDATE ON public.payroll_deductions
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 14
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

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 15
REVOKE EXECUTE ON FUNCTION public.queue_family_deduction_after_invoice() FROM PUBLIC, anon, authenticated;

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 16
DROP TRIGGER IF EXISTS trg_queue_family_deduction ON public.invoices;

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 17
CREATE TRIGGER trg_queue_family_deduction
  AFTER INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.queue_family_deduction_after_invoice();

-- SOURCE: 20260721094415_2bbafb1d-d46a-48ef-8e0f-9db8b029da89.sql statement 1
ALTER TABLE public.corporate_accounts ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'corporate';

-- SOURCE: 20260721094415_2bbafb1d-d46a-48ef-8e0f-9db8b029da89.sql statement 2
UPDATE public.corporate_accounts SET account_type = 'corporate' WHERE account_type IS NULL;

-- SOURCE: 20260721094415_2bbafb1d-d46a-48ef-8e0f-9db8b029da89.sql statement 3
ALTER TABLE public.corporate_accounts DROP CONSTRAINT IF EXISTS corporate_accounts_account_type_check;

-- SOURCE: 20260721094415_2bbafb1d-d46a-48ef-8e0f-9db8b029da89.sql statement 4
ALTER TABLE public.corporate_accounts ADD CONSTRAINT corporate_accounts_account_type_check CHECK (account_type IN ('corporate','retainer'));

-- SOURCE: 20260721094415_2bbafb1d-d46a-48ef-8e0f-9db8b029da89.sql statement 5
CREATE INDEX IF NOT EXISTS idx_corporate_accounts_account_type ON public.corporate_accounts(account_type);

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 1
CREATE TABLE public.sponsor_statements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  statement_number TEXT NOT NULL UNIQUE,
  sponsor_id UUID NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE RESTRICT,
  sponsor_type TEXT NOT NULL CHECK (sponsor_type IN ('corporate','retainer')),
  period_year INT NOT NULL,
  period_month INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  invoice_count INT NOT NULL DEFAULT 0,
  patient_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized','printed','paid','void')),
  notes TEXT,
  generated_by UUID REFERENCES neon_auth.user(id),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at TIMESTAMPTZ,
  printed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sponsor_id, period_year, period_month)
);

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 2
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sponsor_statements TO authenticated;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 3
GRANT ALL ON public.sponsor_statements TO service_role;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 4
ALTER TABLE public.sponsor_statements ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 5
CREATE POLICY "Accountants & admins can view statements" ON public.sponsor_statements
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]));

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 6
CREATE POLICY "Accountants & admins can manage statements" ON public.sponsor_statements
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]));

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 7
CREATE TABLE public.sponsor_statement_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  statement_id UUID NOT NULL REFERENCES public.sponsor_statements(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  amount NUMERIC(14,2) NOT NULL,
  service_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (statement_id, invoice_id)
);

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 8
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sponsor_statement_items TO authenticated;
