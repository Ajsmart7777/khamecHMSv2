
-- 1. balance_requests
CREATE TABLE public.balance_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (request_type IN ('topup','refund')),
  amount NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected','expired','cancelled')),
  payment_method TEXT,
  requested_by UUID REFERENCES auth.users(id),
  confirmed_by UUID REFERENCES auth.users(id),
  notes TEXT,
  rejection_reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.balance_requests TO authenticated;
GRANT ALL ON public.balance_requests TO service_role;
ALTER TABLE public.balance_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view balance requests" ON public.balance_requests
  FOR SELECT TO authenticated USING (public.is_authenticated_staff());

CREATE POLICY "Reception/billing/admin can create balance requests" ON public.balance_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['receptionist','billing','admin','accountant']::app_role[])
  );

CREATE POLICY "Billing/admin can update balance requests" ON public.balance_requests
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['billing','admin']::app_role[]));

CREATE INDEX idx_balance_requests_patient ON public.balance_requests(patient_id);
CREATE INDEX idx_balance_requests_status ON public.balance_requests(status);

-- 2. staff_family_members
CREATE TABLE public.staff_family_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  salary_deduction_consent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (patient_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_family_members TO authenticated;
GRANT ALL ON public.staff_family_members TO service_role;
ALTER TABLE public.staff_family_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view family members" ON public.staff_family_members
  FOR SELECT TO authenticated USING (public.is_authenticated_staff());

CREATE POLICY "Accountant/admin manage family members" ON public.staff_family_members
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]));

-- enforce max 4 family members per staff
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

CREATE TRIGGER trg_family_limit BEFORE INSERT ON public.staff_family_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_family_member_limit();

-- 3. balance_transactions
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
  performed_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.balance_transactions TO authenticated;
GRANT ALL ON public.balance_transactions TO service_role;
ALTER TABLE public.balance_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view balance transactions" ON public.balance_transactions
  FOR SELECT TO authenticated USING (public.is_authenticated_staff());

CREATE INDEX idx_balance_tx_patient ON public.balance_transactions(patient_id);
CREATE INDEX idx_balance_tx_created ON public.balance_transactions(created_at DESC);

-- 4. atomic balance adjustment function
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

REVOKE EXECUTE ON FUNCTION public.adjust_patient_balance(UUID,NUMERIC,TEXT,TEXT,UUID,UUID,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_patient_balance(UUID,NUMERIC,TEXT,TEXT,UUID,UUID,TEXT) TO authenticated;

-- 5. updated_at triggers
CREATE TRIGGER trg_balance_requests_updated_at BEFORE UPDATE ON public.balance_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();
CREATE TRIGGER trg_staff_family_updated_at BEFORE UPDATE ON public.staff_family_members
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

-- 6. realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.balance_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.balance_transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_family_members;
