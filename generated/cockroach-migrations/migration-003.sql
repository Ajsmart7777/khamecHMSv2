-- SOURCE: 20260308162704_a6c01985-a3d7-49e4-bbec-5c358c14f807.sql statement 8
CREATE POLICY "Store and admin can insert inventory"
  ON public.inventory_items FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(public.hms_current_user_id(), ARRAY['store'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308162704_a6c01985-a3d7-49e4-bbec-5c358c14f807.sql statement 9
CREATE POLICY "Store and admin can update inventory"
  ON public.inventory_items FOR UPDATE TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['store'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308162704_a6c01985-a3d7-49e4-bbec-5c358c14f807.sql statement 10
CREATE POLICY "Store and admin can delete inventory"
  ON public.inventory_items FOR DELETE TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['store'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308162704_a6c01985-a3d7-49e4-bbec-5c358c14f807.sql statement 11
CREATE POLICY "Authenticated staff can read stock_requests"
  ON public.stock_requests FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

-- SOURCE: 20260308162704_a6c01985-a3d7-49e4-bbec-5c358c14f807.sql statement 12
CREATE POLICY "Staff can insert stock_requests"
  ON public.stock_requests FOR INSERT TO authenticated
  WITH CHECK (public.is_authenticated_staff());

-- SOURCE: 20260308162704_a6c01985-a3d7-49e4-bbec-5c358c14f807.sql statement 13
CREATE POLICY "Store and admin can update stock_requests"
  ON public.stock_requests FOR UPDATE TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['store'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308162704_a6c01985-a3d7-49e4-bbec-5c358c14f807.sql statement 14
CREATE POLICY "Authenticated staff can read stock_movements"
  ON public.stock_movements FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

-- SOURCE: 20260308162704_a6c01985-a3d7-49e4-bbec-5c358c14f807.sql statement 15
CREATE POLICY "Store and admin can insert stock_movements"
  ON public.stock_movements FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(public.hms_current_user_id(), ARRAY['store'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 1
CREATE TABLE public.shift_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 2
CREATE TABLE public.shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
  shift_period_id uuid NOT NULL REFERENCES public.shift_periods(id) ON DELETE CASCADE,
  shift_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(staff_user_id, shift_date)
);

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 3
CREATE TABLE public.shift_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
  shift_period_id uuid NOT NULL REFERENCES public.shift_periods(id) ON DELETE CASCADE,
  shift_date date NOT NULL,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  handover_notes text,
  status text NOT NULL DEFAULT 'clocked_in',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(staff_user_id, shift_date)
);

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 4
ALTER TABLE public.shift_periods ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 5
ALTER TABLE public.shift_assignments ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 6
ALTER TABLE public.shift_logs ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 7
CREATE POLICY "Authenticated staff can read shift_periods"
  ON public.shift_periods FOR SELECT
  USING (is_authenticated_staff());

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 8
CREATE POLICY "Admin can insert shift_periods"
  ON public.shift_periods FOR INSERT
  WITH CHECK (has_role(public.hms_current_user_id(), 'admin'));

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 9
CREATE POLICY "Admin can update shift_periods"
  ON public.shift_periods FOR UPDATE
  USING (has_role(public.hms_current_user_id(), 'admin'));

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 10
CREATE POLICY "Admin can delete shift_periods"
  ON public.shift_periods FOR DELETE
  USING (has_role(public.hms_current_user_id(), 'admin'));

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 11
CREATE POLICY "Staff can read own assignments"
  ON public.shift_assignments FOR SELECT
  USING (staff_user_id = public.hms_current_user_id() OR has_role(public.hms_current_user_id(), 'admin'));

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 12
CREATE POLICY "Admin can insert shift_assignments"
  ON public.shift_assignments FOR INSERT
  WITH CHECK (has_role(public.hms_current_user_id(), 'admin'));

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 13
CREATE POLICY "Admin can update shift_assignments"
  ON public.shift_assignments FOR UPDATE
  USING (has_role(public.hms_current_user_id(), 'admin'));

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 14
CREATE POLICY "Admin can delete shift_assignments"
  ON public.shift_assignments FOR DELETE
  USING (has_role(public.hms_current_user_id(), 'admin'));

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 15
CREATE POLICY "Staff can read own logs and admin can read all"
  ON public.shift_logs FOR SELECT
  USING (staff_user_id = public.hms_current_user_id() OR has_role(public.hms_current_user_id(), 'admin'));

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 16
CREATE POLICY "Staff can insert own shift_logs"
  ON public.shift_logs FOR INSERT
  WITH CHECK (staff_user_id = public.hms_current_user_id());

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 17
CREATE POLICY "Staff can update own shift_logs"
  ON public.shift_logs FOR UPDATE
  USING (staff_user_id = public.hms_current_user_id() OR has_role(public.hms_current_user_id(), 'admin'));

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 19
INSERT INTO public.shift_periods (name, start_time, end_time) VALUES
  ('Morning', '07:00', '14:00'),
  ('Afternoon', '14:00', '21:00'),
  ('Night', '21:00', '07:00');

-- SOURCE: 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql statement 1
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS account_number text,
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS designation text,
  ADD COLUMN IF NOT EXISTS staff_id_number text;

-- SOURCE: 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql statement 2
CREATE TABLE public.payroll_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month integer NOT NULL,
  year integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(month, year)
);

-- SOURCE: 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql statement 3
ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql statement 4
CREATE POLICY "Billing and admin can read payroll_periods"
  ON public.payroll_periods FOR SELECT TO authenticated
  USING (has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql statement 5
CREATE POLICY "Billing and admin can insert payroll_periods"
  ON public.payroll_periods FOR INSERT TO authenticated
  WITH CHECK (has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql statement 6
CREATE POLICY "Billing and admin can update payroll_periods"
  ON public.payroll_periods FOR UPDATE TO authenticated
  USING (has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql statement 7
CREATE TABLE public.payroll_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_period_id uuid NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  basic_salary numeric NOT NULL DEFAULT 0,
  allowances jsonb NOT NULL DEFAULT '{}',
  gross_pay numeric NOT NULL DEFAULT 0,
  deductions jsonb NOT NULL DEFAULT '{}',
  total_deductions numeric NOT NULL DEFAULT 0,
  net_pay numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  payment_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(payroll_period_id, staff_id)
);

-- SOURCE: 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql statement 8
ALTER TABLE public.payroll_entries ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql statement 9
CREATE POLICY "Billing and admin can read payroll_entries"
  ON public.payroll_entries FOR SELECT TO authenticated
  USING (has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql statement 10
CREATE POLICY "Billing and admin can insert payroll_entries"
  ON public.payroll_entries FOR INSERT TO authenticated
  WITH CHECK (has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql statement 11
CREATE POLICY "Billing and admin can update payroll_entries"
  ON public.payroll_entries FOR UPDATE TO authenticated
  USING (has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql statement 12
CREATE POLICY "Billing and admin can delete payroll_entries"
  ON public.payroll_entries FOR DELETE TO authenticated
  USING (has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql statement 13
CREATE TABLE public.payroll_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_period_id uuid NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
  payroll_entry_id uuid NOT NULL REFERENCES public.payroll_entries(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  paystack_transfer_code text,
  paystack_reference text,
  paystack_recipient_code text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- SOURCE: 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql statement 14
ALTER TABLE public.payroll_payments ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql statement 15
CREATE POLICY "Billing and admin can read payroll_payments"
  ON public.payroll_payments FOR SELECT TO authenticated
  USING (has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql statement 16
CREATE POLICY "Billing and admin can insert payroll_payments"
  ON public.payroll_payments FOR INSERT TO authenticated
  WITH CHECK (has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql statement 17
CREATE POLICY "Billing and admin can update payroll_payments"
  ON public.payroll_payments FOR UPDATE TO authenticated
  USING (has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308201802_58c41d13-82b2-42c2-ad0e-16138833bcaf.sql statement 1
CREATE TABLE public.corporate_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name text NOT NULL,
  contact_person text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  address text DEFAULT '',
  treatment_limit numeric NOT NULL DEFAULT 0,
  balance numeric NOT NULL DEFAULT 0,
  discount_percentage numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- SOURCE: 20260308201802_58c41d13-82b2-42c2-ad0e-16138833bcaf.sql statement 2
ALTER TABLE public.corporate_accounts ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260308201802_58c41d13-82b2-42c2-ad0e-16138833bcaf.sql statement 3
CREATE POLICY "Billing and admin can read corporate_accounts"
  ON public.corporate_accounts FOR SELECT TO authenticated
  USING (has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role, 'admin'::app_role, 'receptionist'::app_role]));

-- SOURCE: 20260308201802_58c41d13-82b2-42c2-ad0e-16138833bcaf.sql statement 4
CREATE POLICY "Billing and admin can insert corporate_accounts"
  ON public.corporate_accounts FOR INSERT TO authenticated
  WITH CHECK (has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308201802_58c41d13-82b2-42c2-ad0e-16138833bcaf.sql statement 5
CREATE POLICY "Billing and admin can update corporate_accounts"
  ON public.corporate_accounts FOR UPDATE TO authenticated
  USING (has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308201802_58c41d13-82b2-42c2-ad0e-16138833bcaf.sql statement 6
CREATE POLICY "Billing and admin can delete corporate_accounts"
  ON public.corporate_accounts FOR DELETE TO authenticated
  USING (has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260309150249_d9c60ce4-d811-40ae-8d14-06e704f995bd.sql statement 1
CREATE TABLE public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.auth_users(id) ON DELETE CASCADE,
  target_role TEXT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  link TEXT,
  resource_id TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- SOURCE: 20260309150249_d9c60ce4-d811-40ae-8d14-06e704f995bd.sql statement 2
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260309150249_d9c60ce4-d811-40ae-8d14-06e704f995bd.sql statement 3
CREATE POLICY "Users can read own notifications"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (
    user_id = public.hms_current_user_id() 
    OR user_id IS NULL
  );

-- SOURCE: 20260309150249_d9c60ce4-d811-40ae-8d14-06e704f995bd.sql statement 4
CREATE POLICY "Staff can insert notifications"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (is_authenticated_staff());

-- SOURCE: 20260309150249_d9c60ce4-d811-40ae-8d14-06e704f995bd.sql statement 5
CREATE POLICY "Users can update own notifications"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (user_id = public.hms_current_user_id() OR user_id IS NULL);

-- SOURCE: 20260309150249_d9c60ce4-d811-40ae-8d14-06e704f995bd.sql statement 7
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);

-- SOURCE: 20260309150249_d9c60ce4-d811-40ae-8d14-06e704f995bd.sql statement 8
CREATE INDEX IF NOT EXISTS idx_notifications_target_role ON public.notifications(target_role);

-- SOURCE: 20260309150249_d9c60ce4-d811-40ae-8d14-06e704f995bd.sql statement 9
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);

-- SOURCE: 20260309152934_3b733c10-e1c0-462e-ab19-75fc65d5cccd.sql statement 1
CREATE TABLE public.insurance_providers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'private', -- 'nhis', 'private', 'hmo'
  code TEXT UNIQUE,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  coverage_percentage NUMERIC NOT NULL DEFAULT 0,
  max_coverage_amount NUMERIC NOT NULL DEFAULT 0,
  plans JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE: 20260309152934_3b733c10-e1c0-462e-ab19-75fc65d5cccd.sql statement 2
CREATE TABLE public.insurance_claims (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_number TEXT NOT NULL UNIQUE,
  patient_id UUID NOT NULL REFERENCES public.patients(id),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id),
  provider_id UUID NOT NULL REFERENCES public.insurance_providers(id),
  total_amount NUMERIC NOT NULL DEFAULT 0,
  covered_amount NUMERIC NOT NULL DEFAULT 0,
  patient_copay NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'submitted', -- submitted, approved, rejected, paid, partial
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  rejection_reason TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE: 20260309152934_3b733c10-e1c0-462e-ab19-75fc65d5cccd.sql statement 3
CREATE TABLE public.staff_leave (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL DEFAULT 'annual', -- annual, sick, maternity, emergency, unpaid
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_count INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected, cancelled
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
