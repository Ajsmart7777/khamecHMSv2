-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 31
DROP POLICY IF EXISTS "Allow public update access to prescription_items" ON public.prescription_items;

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 32
CREATE POLICY "Authenticated staff can read prescription_items"
ON public.prescription_items
FOR SELECT
TO authenticated
USING (public.is_authenticated_staff());

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 33
CREATE POLICY "Doctors can insert prescription_items"
ON public.prescription_items
FOR INSERT
TO authenticated
WITH CHECK (public.has_any_role(public.hms_current_user_id(), ARRAY['doctor', 'admin']::app_role[]));

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 34
CREATE POLICY "Doctors and pharmacists can update prescription_items"
ON public.prescription_items
FOR UPDATE
TO authenticated
USING (public.has_any_role(public.hms_current_user_id(), ARRAY['doctor', 'pharmacist', 'admin']::app_role[]));

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 35
ALTER TABLE public.patients ADD CONSTRAINT check_balance_non_negative CHECK (balance >= 0);

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 36
ALTER TABLE public.prescription_items ADD CONSTRAINT check_quantity_positive CHECK (quantity > 0);

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 1
CREATE TABLE public.audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.auth_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details JSONB,
  ip_address TEXT,
  user_agent TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 2
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 3
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 4
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_type ON public.audit_logs(resource_type);

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 5
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 6
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 7
CREATE POLICY "Only admins can read audit_logs"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 8
CREATE POLICY "Authenticated users can insert audit_logs"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (public.hms_current_user_id() = user_id OR user_id IS NULL);

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 9
CREATE POLICY "Service role can insert audit_logs"
ON public.audit_logs
FOR INSERT
TO service_role
WITH CHECK (true);

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 10
-- Create error_logs table for server-side error tracking
CREATE TABLE public.error_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.auth_users(id) ON DELETE SET NULL,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  context JSONB,
  url TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 11
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON public.error_logs(created_at DESC);

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 12
CREATE INDEX IF NOT EXISTS idx_error_logs_error_type ON public.error_logs(error_type);

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 13
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 14
CREATE POLICY "Only admins can read error_logs"
ON public.error_logs
FOR SELECT
TO authenticated
USING (has_role(public.hms_current_user_id(), 'admin'::app_role));

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
USING (has_any_role(public.hms_current_user_id(), ARRAY['admin'::app_role, 'billing'::app_role]));

-- SOURCE: 20260103175200_b03d43f4-f4ce-44b8-824b-f80423273788.sql statement 4
CREATE POLICY "Only admin can insert staff"
ON public.staff
FOR INSERT
WITH CHECK (has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260103175200_b03d43f4-f4ce-44b8-824b-f80423273788.sql statement 5
CREATE POLICY "Only admin can update staff"
ON public.staff
FOR UPDATE
USING (has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260103175200_b03d43f4-f4ce-44b8-824b-f80423273788.sql statement 6
CREATE POLICY "Only admin can delete staff"
ON public.staff
FOR DELETE
USING (has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260103175200_b03d43f4-f4ce-44b8-824b-f80423273788.sql statement 7
CREATE TRIGGER update_staff_updated_at
BEFORE UPDATE ON public.staff
FOR EACH ROW
EXECUTE FUNCTION public.update_patients_updated_at();

-- SOURCE: 20260103175200_b03d43f4-f4ce-44b8-824b-f80423273788.sql statement 8
CREATE INDEX IF NOT EXISTS idx_staff_role ON public.staff(role);

-- SOURCE: 20260103175200_b03d43f4-f4ce-44b8-824b-f80423273788.sql statement 9
CREATE INDEX IF NOT EXISTS idx_staff_status ON public.staff(status);

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
WITH CHECK (has_any_role(public.hms_current_user_id(), ARRAY['receptionist'::app_role, 'admin'::app_role]));

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
  WITH CHECK (has_any_role(public.hms_current_user_id(), ARRAY['nurse'::app_role, 'doctor'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308151229_ed56fdd6-c908-468d-bc74-090e3ee465b4.sql statement 5
CREATE POLICY "Nurses and doctors can update vitals"
  ON public.vitals FOR UPDATE
  TO authenticated
  USING (has_any_role(public.hms_current_user_id(), ARRAY['nurse'::app_role, 'doctor'::app_role, 'admin'::app_role]));

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

-- SOURCE: cockroach_compatibility statement invoices
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS is_salary_deduction boolean NOT NULL DEFAULT false;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS staff_sponsor_id uuid;

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

-- SOURCE: cockroach_compatibility statement invoice_items
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS dispensing_status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS dispensing_notes text;
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS dispensing_updated_at timestamptz;
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS dispensing_updated_by uuid;

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
  WITH CHECK (public.has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308161537_ec100165-0160-454a-ba8e-f1b14f7ce9f1.sql statement 7
CREATE POLICY "Billing receptionist and admin can update invoices"
  ON public.invoices FOR UPDATE
  TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role, 'receptionist'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308161537_ec100165-0160-454a-ba8e-f1b14f7ce9f1.sql statement 8
CREATE POLICY "Authenticated staff can read invoice_items"
  ON public.invoice_items FOR SELECT
  TO authenticated
  USING (public.is_authenticated_staff());

-- SOURCE: 20260308161537_ec100165-0160-454a-ba8e-f1b14f7ce9f1.sql statement 9
CREATE POLICY "Billing and admin can insert invoice_items"
  ON public.invoice_items FOR INSERT
  TO authenticated
  WITH CHECK (public.has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260308161537_ec100165-0160-454a-ba8e-f1b14f7ce9f1.sql statement 10
CREATE POLICY "Billing and admin can update invoice_items"
  ON public.invoice_items FOR UPDATE
  TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role, 'admin'::app_role]));

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
