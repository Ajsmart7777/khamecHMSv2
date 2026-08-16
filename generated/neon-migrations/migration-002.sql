-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 15
CREATE POLICY "Service role can insert error_logs"
ON public.error_logs
FOR INSERT
TO service_role
WITH CHECK (true);

-- SOURCE: 20260103175200_b03d43f4-f4ce-44b8-824b-f80423273788.sql statement 1
CREATE TABLE public.staff (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'reception',
    department TEXT NOT NULL DEFAULT 'General',
    salary NUMERIC NOT NULL DEFAULT 0,
    hire_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- SOURCE: 20260103175200_b03d43f4-f4ce-44b8-824b-f80423273788.sql statement 2
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260103175200_b03d43f4-f4ce-44b8-824b-f80423273788.sql statement 3
CREATE POLICY "Admin and account can read staff"
ON public.staff
FOR SELECT
USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'billing'::app_role]));

-- SOURCE: 20260103175200_b03d43f4-f4ce-44b8-824b-f80423273788.sql statement 4
CREATE POLICY "Only admin can insert staff"
ON public.staff
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260103175200_b03d43f4-f4ce-44b8-824b-f80423273788.sql statement 5
CREATE POLICY "Only admin can update staff"
ON public.staff
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260103175200_b03d43f4-f4ce-44b8-824b-f80423273788.sql statement 6
CREATE POLICY "Only admin can delete staff"
ON public.staff
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260103175200_b03d43f4-f4ce-44b8-824b-f80423273788.sql statement 7
CREATE TRIGGER update_staff_updated_at
BEFORE UPDATE ON public.staff
FOR EACH ROW
EXECUTE FUNCTION public.update_patients_updated_at();

-- SOURCE: 20260103175200_b03d43f4-f4ce-44b8-824b-f80423273788.sql statement 8
CREATE INDEX idx_staff_role ON public.staff(role);

-- SOURCE: 20260103175200_b03d43f4-f4ce-44b8-824b-f80423273788.sql statement 9
CREATE INDEX idx_staff_status ON public.staff(status);

-- SOURCE: 20260104090556_93f54f96-7c35-40ef-b374-3c5400e318f8.sql statement 1
DROP POLICY IF EXISTS "Authenticated staff can read patients" ON public.patients;

-- SOURCE: 20260104090556_93f54f96-7c35-40ef-b374-3c5400e318f8.sql statement 2
CREATE POLICY "Authenticated staff can read patients" 
ON public.patients 
FOR SELECT 
TO authenticated
USING (is_authenticated_staff());

-- SOURCE: 20260104090556_93f54f96-7c35-40ef-b374-3c5400e318f8.sql statement 3
DROP POLICY IF EXISTS "Reception and admin can insert patients" ON public.patients;

-- SOURCE: 20260104090556_93f54f96-7c35-40ef-b374-3c5400e318f8.sql statement 4
CREATE POLICY "Reception and admin can insert patients" 
ON public.patients 
FOR INSERT 
TO authenticated
WITH CHECK (has_any_role(auth.uid(), ARRAY['receptionist'::app_role, 'admin'::app_role]));

-- SOURCE: 20260104090556_93f54f96-7c35-40ef-b374-3c5400e318f8.sql statement 5
DROP POLICY IF EXISTS "Staff can update patients" ON public.patients;

-- SOURCE: 20260104090556_93f54f96-7c35-40ef-b374-3c5400e318f8.sql statement 6
CREATE POLICY "Staff can update patients" 
ON public.patients 
FOR UPDATE 
TO authenticated
USING (is_authenticated_staff());

-- SOURCE: 20260308151229_ed56fdd6-c908-468d-bc74-090e3ee465b4.sql statement 1
CREATE TABLE public.vitals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  temperature numeric,
  blood_pressure text,
  pulse integer,
  respiratory_rate integer,
  weight numeric,
  height numeric,
  notes text,
  recorded_by text DEFAULT 'Nurse',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- SOURCE: 20260308151229_ed56fdd6-c908-468d-bc74-090e3ee465b4.sql statement 2
ALTER TABLE public.vitals ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260308151229_ed56fdd6-c908-468d-bc74-090e3ee465b4.sql statement 3
CREATE POLICY "Authenticated staff can read vitals"
  ON public.vitals FOR SELECT
  TO authenticated
  USING (is_authenticated_staff());

-- SOURCE: 20260308151229_ed56fdd6-c908-468d-bc74-090e3ee465b4.sql statement 4
CREATE POLICY "Nurses and doctors can insert vitals"
  ON public.vitals FOR INSERT
  TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['nurse'::app_role, 'doctor'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308151229_ed56fdd6-c908-468d-bc74-090e3ee465b4.sql statement 5
CREATE POLICY "Nurses and doctors can update vitals"
  ON public.vitals FOR UPDATE
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['nurse'::app_role, 'doctor'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308161537_ec100165-0160-454a-ba8e-f1b14f7ce9f1.sql statement 1
CREATE TABLE public.invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES public.patients(id),
  invoice_number TEXT NOT NULL UNIQUE,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  paid_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_method TEXT,
  notes TEXT,
  created_by TEXT DEFAULT 'Billing',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  paid_at TIMESTAMP WITH TIME ZONE
);

-- SOURCE: 20260308161537_ec100165-0160-454a-ba8e-f1b14f7ce9f1.sql statement 2
CREATE TABLE public.invoice_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  category TEXT DEFAULT 'general',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- SOURCE: 20260308161537_ec100165-0160-454a-ba8e-f1b14f7ce9f1.sql statement 3
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260308161537_ec100165-0160-454a-ba8e-f1b14f7ce9f1.sql statement 4
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260308161537_ec100165-0160-454a-ba8e-f1b14f7ce9f1.sql statement 5
CREATE POLICY "Authenticated staff can read invoices"
  ON public.invoices FOR SELECT
  TO authenticated
  USING (public.is_authenticated_staff());

-- SOURCE: 20260308161537_ec100165-0160-454a-ba8e-f1b14f7ce9f1.sql statement 6
CREATE POLICY "Billing and admin can insert invoices"
  ON public.invoices FOR INSERT
  TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308161537_ec100165-0160-454a-ba8e-f1b14f7ce9f1.sql statement 7
CREATE POLICY "Billing receptionist and admin can update invoices"
  ON public.invoices FOR UPDATE
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['billing'::app_role, 'receptionist'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308161537_ec100165-0160-454a-ba8e-f1b14f7ce9f1.sql statement 8
CREATE POLICY "Authenticated staff can read invoice_items"
  ON public.invoice_items FOR SELECT
  TO authenticated
  USING (public.is_authenticated_staff());

-- SOURCE: 20260308161537_ec100165-0160-454a-ba8e-f1b14f7ce9f1.sql statement 9
CREATE POLICY "Billing and admin can insert invoice_items"
  ON public.invoice_items FOR INSERT
  TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308161537_ec100165-0160-454a-ba8e-f1b14f7ce9f1.sql statement 10
CREATE POLICY "Billing and admin can update invoice_items"
  ON public.invoice_items FOR UPDATE
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308162704_a6c01985-a3d7-49e4-bbec-5c358c14f807.sql statement 1
CREATE TABLE public.inventory_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  quantity INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 10,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  location TEXT NOT NULL DEFAULT 'store',
  expiry_date DATE,
  supplier TEXT,
  last_restocked TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- SOURCE: 20260308162704_a6c01985-a3d7-49e4-bbec-5c358c14f807.sql statement 2
CREATE TABLE public.stock_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  requested_by TEXT NOT NULL DEFAULT 'Pharmacy',
  item_id UUID REFERENCES public.inventory_items(id),
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  fulfilled_at TIMESTAMP WITH TIME ZONE
);

-- SOURCE: 20260308162704_a6c01985-a3d7-49e4-bbec-5c358c14f807.sql statement 3
CREATE TABLE public.stock_movements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id UUID NOT NULL REFERENCES public.inventory_items(id),
  movement_type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  reference TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- SOURCE: 20260308162704_a6c01985-a3d7-49e4-bbec-5c358c14f807.sql statement 4
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260308162704_a6c01985-a3d7-49e4-bbec-5c358c14f807.sql statement 5
ALTER TABLE public.stock_requests ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260308162704_a6c01985-a3d7-49e4-bbec-5c358c14f807.sql statement 6
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260308162704_a6c01985-a3d7-49e4-bbec-5c358c14f807.sql statement 7
CREATE POLICY "Authenticated staff can read inventory"
  ON public.inventory_items FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

-- SOURCE: 20260308162704_a6c01985-a3d7-49e4-bbec-5c358c14f807.sql statement 8
CREATE POLICY "Store and admin can insert inventory"
  ON public.inventory_items FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['store'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308162704_a6c01985-a3d7-49e4-bbec-5c358c14f807.sql statement 9
CREATE POLICY "Store and admin can update inventory"
  ON public.inventory_items FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308162704_a6c01985-a3d7-49e4-bbec-5c358c14f807.sql statement 10
CREATE POLICY "Store and admin can delete inventory"
  ON public.inventory_items FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store'::app_role, 'admin'::app_role]));

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
  USING (public.has_any_role(auth.uid(), ARRAY['store'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308162704_a6c01985-a3d7-49e4-bbec-5c358c14f807.sql statement 14
CREATE POLICY "Authenticated staff can read stock_movements"
  ON public.stock_movements FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

-- SOURCE: 20260308162704_a6c01985-a3d7-49e4-bbec-5c358c14f807.sql statement 15
CREATE POLICY "Store and admin can insert stock_movements"
  ON public.stock_movements FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['store'::app_role, 'admin'::app_role]));

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
  staff_user_id uuid NOT NULL REFERENCES neon_auth.user(id) ON DELETE CASCADE,
  shift_period_id uuid NOT NULL REFERENCES public.shift_periods(id) ON DELETE CASCADE,
  shift_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(staff_user_id, shift_date)
);

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 3
CREATE TABLE public.shift_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES neon_auth.user(id) ON DELETE CASCADE,
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
  WITH CHECK (has_role(auth.uid(), 'admin'));

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 9
CREATE POLICY "Admin can update shift_periods"
  ON public.shift_periods FOR UPDATE
  USING (has_role(auth.uid(), 'admin'));

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 10
CREATE POLICY "Admin can delete shift_periods"
  ON public.shift_periods FOR DELETE
  USING (has_role(auth.uid(), 'admin'));

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 11
CREATE POLICY "Staff can read own assignments"
  ON public.shift_assignments FOR SELECT
  USING (staff_user_id = auth.uid() OR has_role(auth.uid(), 'admin'));

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 12
CREATE POLICY "Admin can insert shift_assignments"
  ON public.shift_assignments FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'));

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 13
CREATE POLICY "Admin can update shift_assignments"
  ON public.shift_assignments FOR UPDATE
  USING (has_role(auth.uid(), 'admin'));

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 14
CREATE POLICY "Admin can delete shift_assignments"
  ON public.shift_assignments FOR DELETE
  USING (has_role(auth.uid(), 'admin'));

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 15
CREATE POLICY "Staff can read own logs and admin can read all"
  ON public.shift_logs FOR SELECT
  USING (staff_user_id = auth.uid() OR has_role(auth.uid(), 'admin'));

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 16
CREATE POLICY "Staff can insert own shift_logs"
  ON public.shift_logs FOR INSERT
  WITH CHECK (staff_user_id = auth.uid());

-- SOURCE: 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql statement 17
CREATE POLICY "Staff can update own shift_logs"
  ON public.shift_logs FOR UPDATE
  USING (staff_user_id = auth.uid() OR has_role(auth.uid(), 'admin'));

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
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql statement 5
CREATE POLICY "Billing and admin can insert payroll_periods"
  ON public.payroll_periods FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql statement 6
CREATE POLICY "Billing and admin can update payroll_periods"
  ON public.payroll_periods FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

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
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql statement 10
CREATE POLICY "Billing and admin can insert payroll_entries"
  ON public.payroll_entries FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql statement 11
CREATE POLICY "Billing and admin can update payroll_entries"
  ON public.payroll_entries FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql statement 12
CREATE POLICY "Billing and admin can delete payroll_entries"
  ON public.payroll_entries FOR DELETE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

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
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql statement 16
CREATE POLICY "Billing and admin can insert payroll_payments"
  ON public.payroll_payments FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));
