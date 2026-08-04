-- Khadija Medical Center HMS — full schema bundle
-- Generated from supabase/migrations (in order). Run once on a brand-new Supabase project.

-- ================================================================
-- 20260102085609_67890656-3806-4bae-a815-5dce5843d236.sql
-- ================================================================
-- Create patients table for real-time tracking
CREATE TABLE public.patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_number TEXT NOT NULL UNIQUE,
  mini_card_number TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('male', 'female')),
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  emergency_contact TEXT NOT NULL,
  blood_group TEXT,
  allergies TEXT[],
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'waiting', 'with_nurse', 'with_doctor', 'in_lab', 'awaiting_billing', 'awaiting_payment', 'at_pharmacy', 'admitted', 'discharged')),
  account_type TEXT NOT NULL DEFAULT 'normal' CHECK (account_type IN ('normal', 'insurance', 'corporate', 'nhis', 'hmo', 'retainer')),
  corporate_id TEXT,
  insurance_provider TEXT,
  insurance_policy_number TEXT,
  balance DECIMAL(12, 2) NOT NULL DEFAULT 0,
  registered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_visit TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for faster status queries
CREATE INDEX idx_patients_status ON public.patients(status);
CREATE INDEX idx_patients_card_number ON public.patients(card_number);

-- Enable Row Level Security
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

-- Create policy for public read access (HMS system - all staff can view patients)
CREATE POLICY "Allow public read access to patients"
ON public.patients
FOR SELECT
TO anon, authenticated
USING (true);

-- Create policy for public insert (reception can register patients)
CREATE POLICY "Allow public insert access to patients"
ON public.patients
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Create policy for public update (all modules can update patient status)
CREATE POLICY "Allow public update access to patients"
ON public.patients
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_patients_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_patients_updated_at
BEFORE UPDATE ON public.patients
FOR EACH ROW
EXECUTE FUNCTION public.update_patients_updated_at();

-- Enable realtime for patients table
ALTER PUBLICATION supabase_realtime ADD TABLE public.patients;

-- ================================================================
-- 20260102085650_3e9ecb01-abbb-4833-b3fd-508d9b268786.sql
-- ================================================================
-- Fix function search path security issue
CREATE OR REPLACE FUNCTION public.update_patients_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;

-- ================================================================
-- 20260102135919_40717372-9559-45fa-afb5-a445bdb89b47.sql
-- ================================================================
-- Create lab_requests table
CREATE TABLE public.lab_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  request_number TEXT NOT NULL UNIQUE,
  tests TEXT[] NOT NULL,
  diagnosis TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT DEFAULT 'Doctor',
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  printed BOOLEAN NOT NULL DEFAULT false,
  results JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.lab_requests ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for public access (no auth yet)
CREATE POLICY "Allow public read access to lab_requests" 
ON public.lab_requests 
FOR SELECT 
USING (true);

CREATE POLICY "Allow public insert access to lab_requests" 
ON public.lab_requests 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Allow public update access to lab_requests" 
ON public.lab_requests 
FOR UPDATE 
USING (true)
WITH CHECK (true);

-- Create trigger for updated_at
CREATE TRIGGER update_lab_requests_updated_at
BEFORE UPDATE ON public.lab_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_patients_updated_at();

-- Enable realtime
ALTER TABLE public.lab_requests REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.lab_requests;

-- Create index for faster queries
CREATE INDEX idx_lab_requests_patient_id ON public.lab_requests(patient_id);
CREATE INDEX idx_lab_requests_status ON public.lab_requests(status);

-- ================================================================
-- 20260102141033_3ce479c8-fc0e-4d41-8a0e-69a70b8538d6.sql
-- ================================================================
-- Create prescriptions table
CREATE TABLE public.prescriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL,
  diagnosis TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by TEXT DEFAULT 'Doctor',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create prescription_items table for individual medications
CREATE TABLE public.prescription_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  prescription_id UUID NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
  medication TEXT NOT NULL,
  dosage TEXT NOT NULL,
  frequency TEXT NOT NULL,
  duration TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  dispensed BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on prescriptions
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;

-- Prescriptions RLS policies
CREATE POLICY "Allow public read access to prescriptions"
ON public.prescriptions FOR SELECT
USING (true);

CREATE POLICY "Allow public insert access to prescriptions"
ON public.prescriptions FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow public update access to prescriptions"
ON public.prescriptions FOR UPDATE
USING (true)
WITH CHECK (true);

-- Enable RLS on prescription_items
ALTER TABLE public.prescription_items ENABLE ROW LEVEL SECURITY;

-- Prescription items RLS policies
CREATE POLICY "Allow public read access to prescription_items"
ON public.prescription_items FOR SELECT
USING (true);

CREATE POLICY "Allow public insert access to prescription_items"
ON public.prescription_items FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow public update access to prescription_items"
ON public.prescription_items FOR UPDATE
USING (true)
WITH CHECK (true);

-- Add updated_at trigger for prescriptions
CREATE TRIGGER update_prescriptions_updated_at
  BEFORE UPDATE ON public.prescriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_patients_updated_at();

-- Enable realtime for prescriptions
ALTER PUBLICATION supabase_realtime ADD TABLE public.prescriptions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.prescription_items;

-- ================================================================
-- 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql
-- ================================================================
-- Create enum for user roles
CREATE TYPE public.app_role AS ENUM ('admin', 'doctor', 'nurse', 'receptionist', 'pharmacist', 'lab_tech', 'billing', 'store');

-- Create user_roles table
CREATE TABLE public.user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Create function to check if user has any of the specified roles
CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles app_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = ANY(_roles)
  )
$$;

-- Create function to check if user is authenticated staff
CREATE OR REPLACE FUNCTION public.is_authenticated_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
  )
$$;

-- RLS policies for user_roles
CREATE POLICY "Users can view their own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Only admins can insert roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can update roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can delete roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Drop existing overly permissive policies on patients
DROP POLICY IF EXISTS "Allow public read access to patients" ON public.patients;
DROP POLICY IF EXISTS "Allow public insert access to patients" ON public.patients;
DROP POLICY IF EXISTS "Allow public update access to patients" ON public.patients;

-- Create role-based policies for patients table
CREATE POLICY "Authenticated staff can read patients"
ON public.patients
FOR SELECT
TO authenticated
USING (public.is_authenticated_staff());

CREATE POLICY "Reception and admin can insert patients"
ON public.patients
FOR INSERT
TO authenticated
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['receptionist', 'admin']::app_role[]));

CREATE POLICY "Staff can update patients"
ON public.patients
FOR UPDATE
TO authenticated
USING (public.is_authenticated_staff());

-- Drop existing overly permissive policies on lab_requests
DROP POLICY IF EXISTS "Allow public read access to lab_requests" ON public.lab_requests;
DROP POLICY IF EXISTS "Allow public insert access to lab_requests" ON public.lab_requests;
DROP POLICY IF EXISTS "Allow public update access to lab_requests" ON public.lab_requests;

-- Create role-based policies for lab_requests table
CREATE POLICY "Authenticated staff can read lab_requests"
ON public.lab_requests
FOR SELECT
TO authenticated
USING (public.is_authenticated_staff());

CREATE POLICY "Doctors and lab_tech can insert lab_requests"
ON public.lab_requests
FOR INSERT
TO authenticated
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['doctor', 'lab_tech', 'admin']::app_role[]));

CREATE POLICY "Doctors and lab_tech can update lab_requests"
ON public.lab_requests
FOR UPDATE
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['doctor', 'lab_tech', 'admin']::app_role[]));

-- Drop existing overly permissive policies on prescriptions
DROP POLICY IF EXISTS "Allow public read access to prescriptions" ON public.prescriptions;
DROP POLICY IF EXISTS "Allow public insert access to prescriptions" ON public.prescriptions;
DROP POLICY IF EXISTS "Allow public update access to prescriptions" ON public.prescriptions;

-- Create role-based policies for prescriptions table
CREATE POLICY "Authenticated staff can read prescriptions"
ON public.prescriptions
FOR SELECT
TO authenticated
USING (public.is_authenticated_staff());

CREATE POLICY "Doctors can insert prescriptions"
ON public.prescriptions
FOR INSERT
TO authenticated
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['doctor', 'admin']::app_role[]));

CREATE POLICY "Doctors and pharmacists can update prescriptions"
ON public.prescriptions
FOR UPDATE
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['doctor', 'pharmacist', 'admin']::app_role[]));

-- Drop existing overly permissive policies on prescription_items
DROP POLICY IF EXISTS "Allow public read access to prescription_items" ON public.prescription_items;
DROP POLICY IF EXISTS "Allow public insert access to prescription_items" ON public.prescription_items;
DROP POLICY IF EXISTS "Allow public update access to prescription_items" ON public.prescription_items;

-- Create role-based policies for prescription_items table
CREATE POLICY "Authenticated staff can read prescription_items"
ON public.prescription_items
FOR SELECT
TO authenticated
USING (public.is_authenticated_staff());

CREATE POLICY "Doctors can insert prescription_items"
ON public.prescription_items
FOR INSERT
TO authenticated
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['doctor', 'admin']::app_role[]));

CREATE POLICY "Doctors and pharmacists can update prescription_items"
ON public.prescription_items
FOR UPDATE
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['doctor', 'pharmacist', 'admin']::app_role[]));

-- Add database constraints for data integrity
ALTER TABLE public.patients ADD CONSTRAINT check_balance_non_negative CHECK (balance >= 0);
ALTER TABLE public.prescription_items ADD CONSTRAINT check_quantity_positive CHECK (quantity > 0);

-- ================================================================
-- 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql
-- ================================================================
-- Create audit_logs table for tracking security events and user actions
CREATE TABLE public.audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
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

-- Create index for efficient querying
CREATE INDEX idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX idx_audit_logs_resource_type ON public.audit_logs(resource_type);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can read audit logs
CREATE POLICY "Only admins can read audit_logs"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Allow authenticated users to insert their own audit logs
CREATE POLICY "Authenticated users can insert audit_logs"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Allow service role to insert audit logs (for edge functions)
CREATE POLICY "Service role can insert audit_logs"
ON public.audit_logs
FOR INSERT
TO service_role
WITH CHECK (true);

-- No one can update or delete audit logs (immutable for security)
-- No UPDATE or DELETE policies intentionally

-- Create error_logs table for server-side error tracking
CREATE TABLE public.error_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  context JSONB,
  url TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for efficient querying
CREATE INDEX idx_error_logs_created_at ON public.error_logs(created_at DESC);
CREATE INDEX idx_error_logs_error_type ON public.error_logs(error_type);

-- Enable Row Level Security
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can read error logs
CREATE POLICY "Only admins can read error_logs"
ON public.error_logs
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Allow service role to insert error logs (for edge functions)
CREATE POLICY "Service role can insert error_logs"
ON public.error_logs
FOR INSERT
TO service_role
WITH CHECK (true);

-- ================================================================
-- 20260103175200_b03d43f4-f4ce-44b8-824b-f80423273788.sql
-- ================================================================
-- Create staff table
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

-- Enable RLS
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;

-- Create RLS policies - only admin and account roles can access staff data
CREATE POLICY "Admin and account can read staff"
ON public.staff
FOR SELECT
USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'billing'::app_role]));

CREATE POLICY "Only admin can insert staff"
ON public.staff
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admin can update staff"
ON public.staff
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admin can delete staff"
ON public.staff
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create trigger for updated_at
CREATE TRIGGER update_staff_updated_at
BEFORE UPDATE ON public.staff
FOR EACH ROW
EXECUTE FUNCTION public.update_patients_updated_at();

-- Create index for common queries
CREATE INDEX idx_staff_role ON public.staff(role);
CREATE INDEX idx_staff_status ON public.staff(status);

-- ================================================================
-- 20260104090556_93f54f96-7c35-40ef-b374-3c5400e318f8.sql
-- ================================================================
-- Drop existing SELECT policy on patients
DROP POLICY IF EXISTS "Authenticated staff can read patients" ON public.patients;

-- Create new SELECT policy that explicitly requires authentication AND staff role
-- This ensures anonymous/unauthenticated users cannot access patient data
CREATE POLICY "Authenticated staff can read patients" 
ON public.patients 
FOR SELECT 
TO authenticated
USING (is_authenticated_staff());

-- Also update the INSERT policy to be explicit about requiring authentication
DROP POLICY IF EXISTS "Reception and admin can insert patients" ON public.patients;
CREATE POLICY "Reception and admin can insert patients" 
ON public.patients 
FOR INSERT 
TO authenticated
WITH CHECK (has_any_role(auth.uid(), ARRAY['receptionist'::app_role, 'admin'::app_role]));

-- Also update the UPDATE policy to be explicit about requiring authentication
DROP POLICY IF EXISTS "Staff can update patients" ON public.patients;
CREATE POLICY "Staff can update patients" 
ON public.patients 
FOR UPDATE 
TO authenticated
USING (is_authenticated_staff());

-- ================================================================
-- 20260308151229_ed56fdd6-c908-468d-bc74-090e3ee465b4.sql
-- ================================================================

-- Create vitals table to persist nurse recordings
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

-- Enable RLS
ALTER TABLE public.vitals ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated staff can read vitals"
  ON public.vitals FOR SELECT
  TO authenticated
  USING (is_authenticated_staff());

CREATE POLICY "Nurses and doctors can insert vitals"
  ON public.vitals FOR INSERT
  TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['nurse'::app_role, 'doctor'::app_role, 'admin'::app_role]));

CREATE POLICY "Nurses and doctors can update vitals"
  ON public.vitals FOR UPDATE
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['nurse'::app_role, 'doctor'::app_role, 'admin'::app_role]));

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.vitals;


-- ================================================================
-- 20260308161537_ec100165-0160-454a-ba8e-f1b14f7ce9f1.sql
-- ================================================================

-- Create invoices table
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

-- Create invoice_items table
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

-- Enable RLS
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

-- RLS policies for invoices
CREATE POLICY "Authenticated staff can read invoices"
  ON public.invoices FOR SELECT
  TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Billing and admin can insert invoices"
  ON public.invoices FOR INSERT
  TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing receptionist and admin can update invoices"
  ON public.invoices FOR UPDATE
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['billing'::app_role, 'receptionist'::app_role, 'admin'::app_role]));

-- RLS policies for invoice_items
CREATE POLICY "Authenticated staff can read invoice_items"
  ON public.invoice_items FOR SELECT
  TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Billing and admin can insert invoice_items"
  ON public.invoice_items FOR INSERT
  TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing and admin can update invoice_items"
  ON public.invoice_items FOR UPDATE
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- Enable realtime for invoices
ALTER PUBLICATION supabase_realtime ADD TABLE public.invoices;


-- ================================================================
-- 20260308162704_a6c01985-a3d7-49e4-bbec-5c358c14f807.sql
-- ================================================================

-- Create inventory_items table
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

-- Create stock_requests table
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

-- Create stock_movements table for audit trail
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

-- Enable RLS
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

-- RLS for inventory_items
CREATE POLICY "Authenticated staff can read inventory"
  ON public.inventory_items FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Store and admin can insert inventory"
  ON public.inventory_items FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['store'::app_role, 'admin'::app_role]));

CREATE POLICY "Store and admin can update inventory"
  ON public.inventory_items FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store'::app_role, 'admin'::app_role]));

CREATE POLICY "Store and admin can delete inventory"
  ON public.inventory_items FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store'::app_role, 'admin'::app_role]));

-- RLS for stock_requests
CREATE POLICY "Authenticated staff can read stock_requests"
  ON public.stock_requests FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Staff can insert stock_requests"
  ON public.stock_requests FOR INSERT TO authenticated
  WITH CHECK (public.is_authenticated_staff());

CREATE POLICY "Store and admin can update stock_requests"
  ON public.stock_requests FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store'::app_role, 'admin'::app_role]));

-- RLS for stock_movements
CREATE POLICY "Authenticated staff can read stock_movements"
  ON public.stock_movements FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Store and admin can insert stock_movements"
  ON public.stock_movements FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['store'::app_role, 'admin'::app_role]));

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_requests;


-- ================================================================
-- 20260308170716_f30ea59a-7ae3-458d-9825-4c2aad34ec1d.sql
-- ================================================================

-- Create shift_periods table
CREATE TABLE public.shift_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create shift_assignments table
CREATE TABLE public.shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shift_period_id uuid NOT NULL REFERENCES public.shift_periods(id) ON DELETE CASCADE,
  shift_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(staff_user_id, shift_date)
);

-- Create shift_logs table
CREATE TABLE public.shift_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shift_period_id uuid NOT NULL REFERENCES public.shift_periods(id) ON DELETE CASCADE,
  shift_date date NOT NULL,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  handover_notes text,
  status text NOT NULL DEFAULT 'clocked_in',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(staff_user_id, shift_date)
);

-- Enable RLS
ALTER TABLE public.shift_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_logs ENABLE ROW LEVEL SECURITY;

-- shift_periods policies
CREATE POLICY "Authenticated staff can read shift_periods"
  ON public.shift_periods FOR SELECT
  USING (is_authenticated_staff());

CREATE POLICY "Admin can insert shift_periods"
  ON public.shift_periods FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can update shift_periods"
  ON public.shift_periods FOR UPDATE
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can delete shift_periods"
  ON public.shift_periods FOR DELETE
  USING (has_role(auth.uid(), 'admin'));

-- shift_assignments policies
CREATE POLICY "Staff can read own assignments"
  ON public.shift_assignments FOR SELECT
  USING (staff_user_id = auth.uid() OR has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can insert shift_assignments"
  ON public.shift_assignments FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can update shift_assignments"
  ON public.shift_assignments FOR UPDATE
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can delete shift_assignments"
  ON public.shift_assignments FOR DELETE
  USING (has_role(auth.uid(), 'admin'));

-- shift_logs policies
CREATE POLICY "Staff can read own logs and admin can read all"
  ON public.shift_logs FOR SELECT
  USING (staff_user_id = auth.uid() OR has_role(auth.uid(), 'admin'));

CREATE POLICY "Staff can insert own shift_logs"
  ON public.shift_logs FOR INSERT
  WITH CHECK (staff_user_id = auth.uid());

CREATE POLICY "Staff can update own shift_logs"
  ON public.shift_logs FOR UPDATE
  USING (staff_user_id = auth.uid() OR has_role(auth.uid(), 'admin'));

-- Enable realtime on shift_logs
ALTER PUBLICATION supabase_realtime ADD TABLE public.shift_logs;

-- Seed default shift periods
INSERT INTO public.shift_periods (name, start_time, end_time) VALUES
  ('Morning', '07:00', '14:00'),
  ('Afternoon', '14:00', '21:00'),
  ('Night', '21:00', '07:00');


-- ================================================================
-- 20260308195406_e390af93-d087-4e3c-a96e-890c45d58f52.sql
-- ================================================================
-- Add bank details and payroll columns to staff table
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS account_number text,
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS designation text,
  ADD COLUMN IF NOT EXISTS staff_id_number text;

-- Create payroll_periods table
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

ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Billing and admin can read payroll_periods"
  ON public.payroll_periods FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing and admin can insert payroll_periods"
  ON public.payroll_periods FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing and admin can update payroll_periods"
  ON public.payroll_periods FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- Create payroll_entries table
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

ALTER TABLE public.payroll_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Billing and admin can read payroll_entries"
  ON public.payroll_entries FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing and admin can insert payroll_entries"
  ON public.payroll_entries FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing and admin can update payroll_entries"
  ON public.payroll_entries FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing and admin can delete payroll_entries"
  ON public.payroll_entries FOR DELETE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- Create payroll_payments table
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

ALTER TABLE public.payroll_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Billing and admin can read payroll_payments"
  ON public.payroll_payments FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing and admin can insert payroll_payments"
  ON public.payroll_payments FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing and admin can update payroll_payments"
  ON public.payroll_payments FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- ================================================================
-- 20260308201802_58c41d13-82b2-42c2-ad0e-16138833bcaf.sql
-- ================================================================

-- Create corporate_accounts table
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

-- Enable RLS
ALTER TABLE public.corporate_accounts ENABLE ROW LEVEL SECURITY;

-- RLS policies: billing and admin can manage corporate accounts
CREATE POLICY "Billing and admin can read corporate_accounts"
  ON public.corporate_accounts FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role, 'receptionist'::app_role]));

CREATE POLICY "Billing and admin can insert corporate_accounts"
  ON public.corporate_accounts FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing and admin can update corporate_accounts"
  ON public.corporate_accounts FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing and admin can delete corporate_accounts"
  ON public.corporate_accounts FOR DELETE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));


-- ================================================================
-- 20260309150249_d9c60ce4-d811-40ae-8d14-06e704f995bd.sql
-- ================================================================

-- Create notifications table
CREATE TABLE public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  target_role TEXT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  link TEXT,
  resource_id TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users can read their own notifications or notifications targeted to their role
CREATE POLICY "Users can read own notifications"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid() 
    OR user_id IS NULL
  );

-- Any authenticated staff can insert notifications
CREATE POLICY "Staff can insert notifications"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (is_authenticated_staff());

-- Users can update (mark as read) their own notifications
CREATE POLICY "Users can update own notifications"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Index for fast lookups
CREATE INDEX idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX idx_notifications_target_role ON public.notifications(target_role);
CREATE INDEX idx_notifications_created_at ON public.notifications(created_at DESC);


-- ================================================================
-- 20260309152934_3b733c10-e1c0-462e-ab19-75fc65d5cccd.sql
-- ================================================================

-- Insurance providers table
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

-- Insurance claims tracking
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

-- Staff leave management
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

-- Staff attendance (linked to shift logs but standalone tracking)
CREATE TABLE public.staff_attendance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  clock_in TIMESTAMPTZ,
  clock_out TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'present', -- present, absent, late, half_day, leave
  notes TEXT,
  shift_log_id UUID REFERENCES public.shift_logs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.insurance_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_leave ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;

-- Insurance providers: billing/admin/receptionist can read, admin can write
CREATE POLICY "Staff can read insurance_providers" ON public.insurance_providers
  FOR SELECT TO authenticated USING (is_authenticated_staff());

CREATE POLICY "Admin can insert insurance_providers" ON public.insurance_providers
  FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'billing'::app_role]));

CREATE POLICY "Admin can update insurance_providers" ON public.insurance_providers
  FOR UPDATE TO authenticated USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'billing'::app_role]));

CREATE POLICY "Admin can delete insurance_providers" ON public.insurance_providers
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- Insurance claims: billing/admin can manage
CREATE POLICY "Staff can read insurance_claims" ON public.insurance_claims
  FOR SELECT TO authenticated USING (is_authenticated_staff());

CREATE POLICY "Billing can insert insurance_claims" ON public.insurance_claims
  FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing can update insurance_claims" ON public.insurance_claims
  FOR UPDATE TO authenticated USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- Staff leave: admin manages, staff can read own
CREATE POLICY "Staff can read own leave" ON public.staff_leave
  FOR SELECT TO authenticated USING (is_authenticated_staff());

CREATE POLICY "Admin can insert staff_leave" ON public.staff_leave
  FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'billing'::app_role]));

CREATE POLICY "Admin can update staff_leave" ON public.staff_leave
  FOR UPDATE TO authenticated USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'billing'::app_role]));

CREATE POLICY "Admin can delete staff_leave" ON public.staff_leave
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- Staff attendance: admin can manage
CREATE POLICY "Staff can read attendance" ON public.staff_attendance
  FOR SELECT TO authenticated USING (is_authenticated_staff());

CREATE POLICY "Admin can insert attendance" ON public.staff_attendance
  FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'billing'::app_role]));

CREATE POLICY "Admin can update attendance" ON public.staff_attendance
  FOR UPDATE TO authenticated USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'billing'::app_role]));

-- Enable realtime for claims
ALTER PUBLICATION supabase_realtime ADD TABLE public.insurance_claims;
ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_attendance;


-- ================================================================
-- 20260309163559_5f04b897-fb50-4050-ade9-78182dc30a18.sql
-- ================================================================

ALTER TABLE public.payroll_payments RENAME COLUMN paystack_transfer_code TO provider_transfer_code;
ALTER TABLE public.payroll_payments RENAME COLUMN paystack_reference TO provider_reference;
ALTER TABLE public.payroll_payments RENAME COLUMN paystack_recipient_code TO provider_recipient_code;


-- ================================================================
-- 20260309183641_3533cbba-239d-480f-a427-5070b5572fc8.sql
-- ================================================================
ALTER TABLE public.payroll_payments ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'flutterwave';

-- ================================================================
-- 20260630033419_576bc116-554b-47b7-9bfa-ea75fc87b73a.sql
-- ================================================================
CREATE POLICY "Only admins can delete patients"
ON public.patients FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Doctors and admins can delete prescriptions"
ON public.prescriptions FOR DELETE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['doctor', 'admin']::app_role[]));

CREATE POLICY "Clinical staff can delete prescription items"
ON public.prescription_items FOR DELETE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['doctor', 'pharmacist', 'admin']::app_role[]));

CREATE POLICY "Lab techs and admins can delete lab requests"
ON public.lab_requests FOR DELETE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['lab_tech', 'admin']::app_role[]));

-- ================================================================
-- 20260701001126_c8c5baee-6d67-4b32-8af3-ec3c4bb95f41.sql
-- ================================================================

-- Generic audit insert helper (SECURITY DEFINER so triggers can write regardless of caller RLS)
CREATE OR REPLACE FUNCTION public.write_audit_log(
  _action text,
  _resource_type text,
  _resource_id text,
  _details jsonb,
  _status text DEFAULT 'success'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, details, status)
  VALUES (auth.uid(), _action, _resource_type, _resource_id, _details, _status);
END;
$$;

-- 1) user_roles: role_assigned / role_removed
CREATE OR REPLACE FUNCTION public.audit_user_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.write_audit_log(
      'role_assigned', 'user_role', NEW.id::text,
      jsonb_build_object('target_user_id', NEW.user_id, 'role', NEW.role)
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.write_audit_log(
      'role_removed', 'user_role', OLD.id::text,
      jsonb_build_object('target_user_id', OLD.user_id, 'role', OLD.role)
    );
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND (NEW.role IS DISTINCT FROM OLD.role OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    PERFORM public.write_audit_log(
      'role_assigned', 'user_role', NEW.id::text,
      jsonb_build_object('target_user_id', NEW.user_id, 'old_role', OLD.role, 'new_role', NEW.role)
    );
    RETURN NEW;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_user_roles ON public.user_roles;
CREATE TRIGGER trg_audit_user_roles
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.audit_user_roles();

-- 2) invoices: payment_received when paid_amount increases
CREATE OR REPLACE FUNCTION public.audit_invoice_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.paid_amount > COALESCE(OLD.paid_amount, 0) THEN
    PERFORM public.write_audit_log(
      'payment_received', 'invoice', NEW.id::text,
      jsonb_build_object(
        'invoice_number', NEW.invoice_number,
        'patient_id', NEW.patient_id,
        'amount', NEW.paid_amount - COALESCE(OLD.paid_amount, 0),
        'new_paid_total', NEW.paid_amount,
        'total_amount', NEW.total_amount,
        'payment_method', NEW.payment_method,
        'status', NEW.status
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_invoice_payment ON public.invoices;
CREATE TRIGGER trg_audit_invoice_payment
AFTER UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.audit_invoice_payment();

-- 3) prescriptions: prescription_dispensed when status becomes 'dispensed'
CREATE OR REPLACE FUNCTION public.audit_prescription_dispense()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'dispensed'
     AND COALESCE(OLD.status, '') <> 'dispensed' THEN
    PERFORM public.write_audit_log(
      'prescription_dispensed', 'prescription', NEW.id::text,
      jsonb_build_object('patient_id', NEW.patient_id, 'diagnosis', NEW.diagnosis)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_prescription_dispense ON public.prescriptions;
CREATE TRIGGER trg_audit_prescription_dispense
AFTER UPDATE ON public.prescriptions
FOR EACH ROW EXECUTE FUNCTION public.audit_prescription_dispense();

-- 4) payroll_entries: salary_processed when status becomes 'paid'
CREATE OR REPLACE FUNCTION public.audit_payroll_processed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'paid'
     AND COALESCE(OLD.status, '') <> 'paid' THEN
    PERFORM public.write_audit_log(
      'salary_processed', 'payroll_entry', NEW.id::text,
      jsonb_build_object(
        'staff_id', NEW.staff_id,
        'payroll_period_id', NEW.payroll_period_id,
        'net_pay', NEW.net_pay,
        'payment_reference', NEW.payment_reference
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_payroll_processed ON public.payroll_entries;
CREATE TRIGGER trg_audit_payroll_processed
AFTER UPDATE ON public.payroll_entries
FOR EACH ROW EXECUTE FUNCTION public.audit_payroll_processed();

-- Extend AuditAction check (if constrained) — no-op if not constrained.
-- Add new resource_type / action values via inserts only; no schema change needed.


-- ================================================================
-- 20260721064937_ec064f2e-b1dd-4dac-92a9-1a0a864de02f.sql
-- ================================================================
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'accountant';

-- ================================================================
-- 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql
-- ================================================================

-- 1. Corporate accounts: sponsor_type (corporate vs retainer)
ALTER TABLE public.corporate_accounts
  ADD COLUMN IF NOT EXISTS sponsor_type text NOT NULL DEFAULT 'corporate';

-- 2. Insurance claims: sponsor_type discriminator (insurance | corporate | retainer)
ALTER TABLE public.insurance_claims
  ADD COLUMN IF NOT EXISTS sponsor_type text NOT NULL DEFAULT 'insurance',
  ADD COLUMN IF NOT EXISTS corporate_account_id uuid REFERENCES public.corporate_accounts(id);

-- provider_id needs to be nullable for corporate/retainer claims
ALTER TABLE public.insurance_claims ALTER COLUMN provider_id DROP NOT NULL;

-- 3. Invoices: discount tracking
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS original_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sponsor_type text,
  ADD COLUMN IF NOT EXISTS corporate_account_id uuid REFERENCES public.corporate_accounts(id);

-- 4. External doctors
CREATE TABLE IF NOT EXISTS public.external_doctors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  specialty text,
  schedule_notes text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.external_doctors TO authenticated;
GRANT ALL ON public.external_doctors TO service_role;

ALTER TABLE public.external_doctors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read external_doctors" ON public.external_doctors
  FOR SELECT TO authenticated USING (is_authenticated_staff());

CREATE POLICY "Receptionist and admin can insert external_doctors" ON public.external_doctors
  FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['receptionist'::app_role, 'admin'::app_role]));

CREATE POLICY "Receptionist and admin can update external_doctors" ON public.external_doctors
  FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['receptionist'::app_role, 'admin'::app_role]));

CREATE POLICY "Admin can delete external_doctors" ON public.external_doctors
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_external_doctors_updated_at
  BEFORE UPDATE ON public.external_doctors
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

-- 5. Standing orders (prescriptions from external doctors, captured by receptionist)
CREATE TABLE IF NOT EXISTS public.standing_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  external_doctor_id uuid REFERENCES public.external_doctors(id),
  external_doctor_name text,
  photo_url text NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'pending_fulfillment',
  expiry_date date,
  transcribed_prescription_id uuid REFERENCES public.prescriptions(id),
  captured_by uuid REFERENCES auth.users(id),
  fulfilled_by uuid REFERENCES auth.users(id),
  fulfilled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.standing_orders TO authenticated;
GRANT ALL ON public.standing_orders TO service_role;

ALTER TABLE public.standing_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read standing_orders" ON public.standing_orders
  FOR SELECT TO authenticated USING (is_authenticated_staff());

CREATE POLICY "Receptionist and admin can insert standing_orders" ON public.standing_orders
  FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['receptionist'::app_role, 'admin'::app_role]));

CREATE POLICY "Clinical and admin can update standing_orders" ON public.standing_orders
  FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['receptionist'::app_role, 'doctor'::app_role, 'pharmacist'::app_role, 'admin'::app_role]));

CREATE POLICY "Admin can delete standing_orders" ON public.standing_orders
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_standing_orders_updated_at
  BEFORE UPDATE ON public.standing_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

CREATE INDEX IF NOT EXISTS standing_orders_patient_id_idx ON public.standing_orders(patient_id);
CREATE INDEX IF NOT EXISTS standing_orders_status_idx ON public.standing_orders(status);
CREATE INDEX IF NOT EXISTS insurance_claims_sponsor_type_idx ON public.insurance_claims(sponsor_type);
CREATE INDEX IF NOT EXISTS insurance_claims_corporate_account_id_idx ON public.insurance_claims(corporate_account_id);


-- ================================================================
-- 20260721065836_76b70521-8c71-42ab-98c4-c2d1d2858b44.sql
-- ================================================================

CREATE POLICY "Staff read standing-orders photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'standing-orders' AND public.is_authenticated_staff());

CREATE POLICY "Receptionist/admin upload standing-orders photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'standing-orders' AND public.has_any_role(auth.uid(), ARRAY['receptionist'::public.app_role, 'admin'::public.app_role]));

CREATE POLICY "Clinical/admin update standing-orders photos" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'standing-orders' AND public.has_any_role(auth.uid(), ARRAY['receptionist'::public.app_role, 'doctor'::public.app_role, 'pharmacist'::public.app_role, 'admin'::public.app_role]));

CREATE POLICY "Admin delete standing-orders photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'standing-orders' AND public.has_role(auth.uid(), 'admin'::public.app_role));


-- ================================================================
-- 20260721082348_f2729204-995d-43df-a6f4-4df0d65b3a63.sql
-- ================================================================
ALTER TABLE public.standing_orders ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'prescription' CHECK (order_type IN ('prescription','lab','both'));

-- ================================================================
-- 20260721083039_a667ea11-7d28-437a-baec-4878cdb7ae20.sql
-- ================================================================

REVOKE EXECUTE ON FUNCTION public.audit_invoice_payment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_payroll_processed() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_prescription_dispense() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_user_roles() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_patients_updated_at() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, app_role[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_authenticated_staff() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.write_audit_log(text, text, text, jsonb, text) FROM PUBLIC, anon;


-- ================================================================
-- 20260721083101_b2d29fc6-e64d-47a5-893a-7ab467deee35.sql
-- ================================================================
REVOKE EXECUTE ON FUNCTION public.write_audit_log(text, text, text, jsonb, text) FROM authenticated;

-- ================================================================
-- 20260721090507_14537b00-953b-4343-899d-68aa21fa925e.sql
-- ================================================================

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


-- ================================================================
-- 20260721090523_b4a45768-4a74-4935-86d9-a672515e30b0.sql
-- ================================================================
REVOKE EXECUTE ON FUNCTION public.enforce_family_member_limit() FROM PUBLIC, anon, authenticated;

-- ================================================================
-- 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql
-- ================================================================

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


-- ================================================================
-- 20260721094415_2bbafb1d-d46a-48ef-8e0f-9db8b029da89.sql
-- ================================================================
ALTER TABLE public.corporate_accounts ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'corporate';
UPDATE public.corporate_accounts SET account_type = 'corporate' WHERE account_type IS NULL;
ALTER TABLE public.corporate_accounts DROP CONSTRAINT IF EXISTS corporate_accounts_account_type_check;
ALTER TABLE public.corporate_accounts ADD CONSTRAINT corporate_accounts_account_type_check CHECK (account_type IN ('corporate','retainer'));
CREATE INDEX IF NOT EXISTS idx_corporate_accounts_account_type ON public.corporate_accounts(account_type);

-- ================================================================
-- 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql
-- ================================================================

-- Sponsor statements: consolidated monthly bills for corporate & retainer accounts
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
  generated_by UUID REFERENCES auth.users(id),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at TIMESTAMPTZ,
  printed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sponsor_id, period_year, period_month)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sponsor_statements TO authenticated;
GRANT ALL ON public.sponsor_statements TO service_role;
ALTER TABLE public.sponsor_statements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Accountants & admins can view statements" ON public.sponsor_statements
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]));
CREATE POLICY "Accountants & admins can manage statements" ON public.sponsor_statements
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]));

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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sponsor_statement_items TO authenticated;
GRANT ALL ON public.sponsor_statement_items TO service_role;
ALTER TABLE public.sponsor_statement_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Accountants & admins can view items" ON public.sponsor_statement_items
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]));
CREATE POLICY "Accountants & admins can manage items" ON public.sponsor_statement_items
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]));

CREATE INDEX idx_sponsor_statement_items_statement ON public.sponsor_statement_items(statement_id);
CREATE INDEX idx_sponsor_statements_period ON public.sponsor_statements(period_year, period_month);
CREATE INDEX idx_sponsor_statements_sponsor ON public.sponsor_statements(sponsor_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_sponsor_statement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
REVOKE EXECUTE ON FUNCTION public.touch_sponsor_statement() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_touch_sponsor_statement BEFORE UPDATE ON public.sponsor_statements
  FOR EACH ROW EXECUTE FUNCTION public.touch_sponsor_statement();

-- Statement number generator: STM-YYYYMM-XXXX
CREATE OR REPLACE FUNCTION public.next_statement_number(_year INT, _month INT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _seq INT; BEGIN
  SELECT COUNT(*) + 1 INTO _seq FROM public.sponsor_statements
    WHERE period_year = _year AND period_month = _month;
  RETURN 'STM-' || _year::TEXT || LPAD(_month::TEXT, 2, '0') || '-' || LPAD(_seq::TEXT, 4, '0');
END; $$;
REVOKE EXECUTE ON FUNCTION public.next_statement_number(INT, INT) FROM PUBLIC, anon, authenticated;

-- Generate a single sponsor statement (idempotent for draft; will not touch finalized/paid)
CREATE OR REPLACE FUNCTION public.generate_sponsor_statement(
  _sponsor_id UUID, _year INT, _month INT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _sponsor RECORD;
  _start DATE;
  _end DATE;
  _statement_id UUID;
  _existing_status TEXT;
  _total NUMERIC(14,2) := 0;
  _inv_count INT := 0;
  _pat_count INT := 0;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT id, account_type, company_name INTO _sponsor
    FROM public.corporate_accounts WHERE id = _sponsor_id;
  IF _sponsor.id IS NULL THEN RAISE EXCEPTION 'Sponsor not found'; END IF;
  IF _sponsor.account_type NOT IN ('corporate','retainer') THEN
    RAISE EXCEPTION 'Sponsor is not a corporate or retainer account';
  END IF;

  _start := make_date(_year, _month, 1);
  _end   := (_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  SELECT id, status INTO _statement_id, _existing_status
    FROM public.sponsor_statements
    WHERE sponsor_id = _sponsor_id AND period_year = _year AND period_month = _month;

  IF _statement_id IS NOT NULL THEN
    IF _existing_status IN ('finalized','printed','paid') THEN
      RAISE EXCEPTION 'Statement for % (%-%) is % and cannot be regenerated. Void it first.',
        _sponsor.company_name, _year, _month, _existing_status;
    END IF;
    DELETE FROM public.sponsor_statement_items WHERE statement_id = _statement_id;
  ELSE
    _statement_id := gen_random_uuid();
    INSERT INTO public.sponsor_statements
      (id, statement_number, sponsor_id, sponsor_type, period_year, period_month,
       period_start, period_end, generated_by)
    VALUES
      (_statement_id, public.next_statement_number(_year, _month), _sponsor_id,
       _sponsor.account_type, _year, _month, _start, _end, auth.uid());
  END IF;

  -- Insert every invoice in the period for patients linked to this sponsor
  INSERT INTO public.sponsor_statement_items
    (statement_id, invoice_id, patient_id, amount, service_date)
  SELECT
    _statement_id, i.id, i.patient_id, i.total_amount, i.created_at::date
  FROM public.invoices i
  JOIN public.patients p ON p.id = i.patient_id
  WHERE p.corporate_id = _sponsor_id
    AND p.account_type = _sponsor.account_type
    AND i.created_at >= _start
    AND i.created_at <  (_end + INTERVAL '1 day');

  SELECT COALESCE(SUM(amount),0), COUNT(*), COUNT(DISTINCT patient_id)
    INTO _total, _inv_count, _pat_count
  FROM public.sponsor_statement_items WHERE statement_id = _statement_id;

  UPDATE public.sponsor_statements
    SET total_amount = _total,
        invoice_count = _inv_count,
        patient_count = _pat_count,
        generated_at = now(),
        generated_by = COALESCE(auth.uid(), generated_by),
        status = 'draft'
    WHERE id = _statement_id;

  RETURN _statement_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.generate_sponsor_statement(UUID, INT, INT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.generate_sponsor_statement(UUID, INT, INT) TO authenticated;

-- Generate for every active sponsor in the given month
CREATE OR REPLACE FUNCTION public.generate_all_sponsor_statements(_year INT, _month INT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _rec RECORD; _count INT := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  FOR _rec IN
    SELECT id FROM public.corporate_accounts
    WHERE status = 'active' AND account_type IN ('corporate','retainer')
  LOOP
    BEGIN
      PERFORM public.generate_sponsor_statement(_rec.id, _year, _month);
      _count := _count + 1;
    EXCEPTION WHEN OTHERS THEN
      -- skip finalized/existing; keep going
      NULL;
    END;
  END LOOP;
  RETURN _count;
END; $$;
REVOKE EXECUTE ON FUNCTION public.generate_all_sponsor_statements(INT, INT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.generate_all_sponsor_statements(INT, INT) TO authenticated, service_role;


-- ================================================================
-- 20260721095653_853e35b1-abcc-49d9-a43a-6a25fef61f7a.sql
-- ================================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ================================================================
-- 20260721102532_c96243d9-01c9-4ec5-891d-4cf859b0f11f.sql
-- ================================================================
-- Add insurance_plan and katchma/claims_manager support
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS insurance_plan TEXT;

DO $$ BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'claims_manager';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ================================================================
-- 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql
-- ================================================================

CREATE TABLE public.consultation_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL,
  visit_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  subjective TEXT,
  objective TEXT,
  assessment TEXT,
  plan TEXT,
  icd10_code TEXT,
  follow_up_date DATE,
  prescription_id UUID REFERENCES public.prescriptions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultation_notes TO authenticated;
GRANT ALL ON public.consultation_notes TO service_role;

ALTER TABLE public.consultation_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clinical roles read consultation notes"
  ON public.consultation_notes FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','nurse','lab_tech','pharmacist','admin']::app_role[])
  );

CREATE POLICY "Doctors insert consultation notes"
  ON public.consultation_notes FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','admin']::app_role[])
    AND doctor_id = auth.uid()
  );

CREATE POLICY "Doctors update own consultation notes"
  ON public.consultation_notes FOR UPDATE TO authenticated
  USING (
    doctor_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE TRIGGER update_consultation_notes_updated_at
  BEFORE UPDATE ON public.consultation_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

CREATE INDEX idx_consultation_notes_patient ON public.consultation_notes(patient_id, visit_date DESC);


CREATE TABLE public.emr_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  category TEXT NOT NULL DEFAULT 'other',
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.emr_attachments TO authenticated;
GRANT ALL ON public.emr_attachments TO service_role;

ALTER TABLE public.emr_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clinical roles read EMR attachments"
  ON public.emr_attachments FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','nurse','lab_tech','pharmacist','admin']::app_role[])
  );

CREATE POLICY "Doctors and nurses upload EMR attachments"
  ON public.emr_attachments FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','nurse','admin']::app_role[])
    AND uploaded_by = auth.uid()
  );

CREATE POLICY "Uploader or admin delete EMR attachments"
  ON public.emr_attachments FOR DELETE TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE INDEX idx_emr_attachments_patient ON public.emr_attachments(patient_id, created_at DESC);


CREATE POLICY "Clinical roles read EMR files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'emr-attachments'
    AND public.has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','nurse','lab_tech','pharmacist','admin']::app_role[])
  );

CREATE POLICY "Doctors and nurses upload EMR files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'emr-attachments'
    AND public.has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','nurse','admin']::app_role[])
  );

CREATE POLICY "Admin delete EMR files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'emr-attachments'
    AND public.has_role(auth.uid(), 'admin')
  );


-- ================================================================
-- 20260721105403_38bdcd76-3e93-4cdc-b8bc-a565a920c4be.sql
-- ================================================================
ALTER TABLE public.consultation_notes
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','finalized')),
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_consultation_notes_status
  ON public.consultation_notes(patient_id, status);

-- Restrict edits to the author AND only while still draft
DROP POLICY IF EXISTS "Doctors update own consultation notes" ON public.consultation_notes;
DROP POLICY IF EXISTS "Doctor updates own consultation" ON public.consultation_notes;

CREATE POLICY "Author edits own draft"
  ON public.consultation_notes FOR UPDATE TO authenticated
  USING (doctor_id = auth.uid() AND status = 'draft')
  WITH CHECK (doctor_id = auth.uid());

-- ================================================================
-- 20260721105554_690fca6a-052a-495f-a060-18e384419eff.sql
-- ================================================================
DROP TABLE IF EXISTS public.consultation_notes CASCADE;

-- ================================================================
-- 20260721105809_452b631b-1f1f-43ae-8f63-fc11b01ff5ac.sql
-- ================================================================

-- 1) Staff self-select
CREATE POLICY "Staff can read own record"
ON public.staff
FOR SELECT
TO authenticated
USING (auth_user_id = auth.uid());

-- 2) Notifications: restrict broadcast rows by target_role
DROP POLICY IF EXISTS "Users can read own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;

CREATE POLICY "Users can read own or targeted notifications"
ON public.notifications
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR (
    user_id IS NULL
    AND target_role IS NOT NULL
    AND public.has_role(auth.uid(), target_role::public.app_role)
  )
);

CREATE POLICY "Users can update own or targeted notifications"
ON public.notifications
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  OR (
    user_id IS NULL
    AND target_role IS NOT NULL
    AND public.has_role(auth.uid(), target_role::public.app_role)
  )
);

-- 3) corporate_accounts: remove receptionist from SELECT
DROP POLICY IF EXISTS "Billing and admin can read corporate_accounts" ON public.corporate_accounts;

CREATE POLICY "Billing and admin can read corporate_accounts"
ON public.corporate_accounts
FOR SELECT
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role, 'accountant'::app_role]));


-- ================================================================
-- 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql
-- ================================================================

-- staff
DROP POLICY IF EXISTS "Admin and account can read staff" ON public.staff;
DROP POLICY IF EXISTS "Only admin can delete staff" ON public.staff;
DROP POLICY IF EXISTS "Only admin can insert staff" ON public.staff;
DROP POLICY IF EXISTS "Only admin can update staff" ON public.staff;

CREATE POLICY "Admin and account can read staff" ON public.staff
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'billing'::app_role]));
CREATE POLICY "Only admin can delete staff" ON public.staff
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Only admin can insert staff" ON public.staff
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Only admin can update staff" ON public.staff
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- shift_periods
DROP POLICY IF EXISTS "Admin can delete shift_periods" ON public.shift_periods;
DROP POLICY IF EXISTS "Admin can insert shift_periods" ON public.shift_periods;
DROP POLICY IF EXISTS "Admin can update shift_periods" ON public.shift_periods;
DROP POLICY IF EXISTS "Authenticated staff can read shift_periods" ON public.shift_periods;

CREATE POLICY "Admin can delete shift_periods" ON public.shift_periods
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admin can insert shift_periods" ON public.shift_periods
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admin can update shift_periods" ON public.shift_periods
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated staff can read shift_periods" ON public.shift_periods
  FOR SELECT TO authenticated USING (is_authenticated_staff());

-- shift_assignments
DROP POLICY IF EXISTS "Admin can delete shift_assignments" ON public.shift_assignments;
DROP POLICY IF EXISTS "Admin can insert shift_assignments" ON public.shift_assignments;
DROP POLICY IF EXISTS "Admin can update shift_assignments" ON public.shift_assignments;
DROP POLICY IF EXISTS "Staff can read own assignments" ON public.shift_assignments;

CREATE POLICY "Admin can delete shift_assignments" ON public.shift_assignments
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admin can insert shift_assignments" ON public.shift_assignments
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admin can update shift_assignments" ON public.shift_assignments
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Staff can read own assignments" ON public.shift_assignments
  FOR SELECT TO authenticated
  USING ((staff_user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

-- shift_logs
DROP POLICY IF EXISTS "Staff can insert own shift_logs" ON public.shift_logs;
DROP POLICY IF EXISTS "Staff can read own logs and admin can read all" ON public.shift_logs;
DROP POLICY IF EXISTS "Staff can update own shift_logs" ON public.shift_logs;

CREATE POLICY "Staff can insert own shift_logs" ON public.shift_logs
  FOR INSERT TO authenticated WITH CHECK (staff_user_id = auth.uid());
CREATE POLICY "Staff can read own logs and admin can read all" ON public.shift_logs
  FOR SELECT TO authenticated
  USING ((staff_user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Staff can update own shift_logs" ON public.shift_logs
  FOR UPDATE TO authenticated
  USING ((staff_user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));


-- ================================================================
-- 20260721110306_5b560637-2e05-496d-92f5-a1799d237c10.sql
-- ================================================================

ALTER TABLE public.staff_attendance DROP COLUMN IF EXISTS shift_log_id;
DROP TABLE IF EXISTS public.shift_logs CASCADE;
DROP TABLE IF EXISTS public.shift_assignments CASCADE;
DROP TABLE IF EXISTS public.shift_periods CASCADE;


-- ================================================================
-- 20260721111446_d530ae64-9e97-441f-8ca4-bbd4e2672541.sql
-- ================================================================
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS assigned_doctor TEXT CHECK (assigned_doctor IN ('doctor1','doctor2'));

-- ================================================================
-- 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql
-- ================================================================
-- ============================================================================
-- VISIT CARD SYSTEM
-- ============================================================================

-- Enum: which station captured/attached something
DO $$ BEGIN
  CREATE TYPE public.visit_station AS ENUM (
    'reception','nurse','doctor','lab','pharmacy','billing','cashier','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.visit_status AS ENUM ('open','settled','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- visits: one envelope per patient visit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_number TEXT NOT NULL UNIQUE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  status public.visit_status NOT NULL DEFAULT 'open',
  presenting_complaint TEXT,
  -- snapshot at check-in so mid-visit changes don't corrupt claims
  sponsor_type TEXT,
  corporate_id UUID REFERENCES public.corporate_accounts(id) ON DELETE SET NULL,
  insurance_plan TEXT,
  -- running totals kept in sync by triggers
  total_charged NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_by UUID REFERENCES auth.users(id),
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES auth.users(id),
  cancel_reason TEXT,
  force_new_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visits_patient_status_idx ON public.visits (patient_id, status);
CREATE INDEX IF NOT EXISTS visits_status_opened_idx ON public.visits (status, opened_at DESC);
CREATE INDEX IF NOT EXISTS visits_sponsor_idx ON public.visits (sponsor_type, corporate_id);

GRANT SELECT, INSERT, UPDATE ON public.visits TO authenticated;
GRANT ALL ON public.visits TO service_role;

ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated staff can view visits"
  ON public.visits FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Clinical/reception/billing can open visits"
  ON public.visits FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','billing','admin']::app_role[]));

CREATE POLICY "Staff can update visits"
  ON public.visits FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','lab_tech','pharmacist','billing','accountant','admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','lab_tech','pharmacist','billing','accountant','admin']::app_role[]));

CREATE TRIGGER visits_touch_updated_at
  BEFORE UPDATE ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

-- ---------------------------------------------------------------------------
-- visit_attachments: photos captured at each station
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.visit_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  label TEXT,
  station public.visit_station NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  captured_by UUID REFERENCES auth.users(id),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visit_attachments_visit_idx ON public.visit_attachments (visit_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS visit_attachments_patient_idx ON public.visit_attachments (patient_id, captured_at DESC);

GRANT SELECT, INSERT, DELETE ON public.visit_attachments TO authenticated;
GRANT ALL ON public.visit_attachments TO service_role;

ALTER TABLE public.visit_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated staff can view attachments"
  ON public.visit_attachments FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Staff can add attachments"
  ON public.visit_attachments FOR INSERT TO authenticated
  WITH CHECK (
    captured_by = auth.uid()
    AND public.has_any_role(auth.uid(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','lab_tech','pharmacist','billing','accountant','admin']::app_role[])
  );

CREATE POLICY "Admin can delete attachments"
  ON public.visit_attachments FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- Backfill FK columns on existing tables (nullable — legacy rows stay valid)
-- ---------------------------------------------------------------------------
ALTER TABLE public.invoices        ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL;
ALTER TABLE public.prescriptions   ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL;
ALTER TABLE public.lab_requests    ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL;
ALTER TABLE public.vitals          ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL;
ALTER TABLE public.standing_orders ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS invoices_visit_idx        ON public.invoices(visit_id);
CREATE INDEX IF NOT EXISTS prescriptions_visit_idx   ON public.prescriptions(visit_id);
CREATE INDEX IF NOT EXISTS lab_requests_visit_idx    ON public.lab_requests(visit_id);
CREATE INDEX IF NOT EXISTS vitals_visit_idx          ON public.vitals(visit_id);
CREATE INDEX IF NOT EXISTS standing_orders_visit_idx ON public.standing_orders(visit_id);

-- ---------------------------------------------------------------------------
-- Helper: generate next visit number VST-YYMMDD-XXXX
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_visit_number()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _prefix TEXT := 'VST-' || to_char(now(),'YYMMDD') || '-';
  _seq INT;
BEGIN
  SELECT COUNT(*)+1 INTO _seq FROM public.visits WHERE visit_number LIKE _prefix || '%';
  RETURN _prefix || LPAD(_seq::TEXT, 4, '0');
END; $$;

-- ---------------------------------------------------------------------------
-- Helper: open (or resume) a visit for a patient
--   _force_new = true always opens a fresh visit even if one is open
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.open_visit_for_patient(
  _patient_id UUID,
  _presenting_complaint TEXT DEFAULT NULL,
  _force_new BOOLEAN DEFAULT FALSE,
  _force_new_reason TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _existing UUID;
  _new_id UUID;
  _p RECORD;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
       ARRAY['receptionist','nurse','doctor','doctor1','doctor2','billing','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to open a visit';
  END IF;

  IF NOT _force_new THEN
    SELECT id INTO _existing FROM public.visits
      WHERE patient_id = _patient_id AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1;
    IF _existing IS NOT NULL THEN
      RETURN _existing;
    END IF;
  END IF;

  SELECT account_type, corporate_id, insurance_plan
    INTO _p FROM public.patients WHERE id = _patient_id;
  IF _p IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  INSERT INTO public.visits (
    visit_number, patient_id, presenting_complaint,
    sponsor_type, corporate_id, insurance_plan,
    opened_by, force_new_reason
  ) VALUES (
    public.next_visit_number(), _patient_id, _presenting_complaint,
    _p.account_type, _p.corporate_id, _p.insurance_plan,
    auth.uid(), CASE WHEN _force_new THEN _force_new_reason END
  ) RETURNING id INTO _new_id;

  RETURN _new_id;
END; $$;

-- ---------------------------------------------------------------------------
-- Auto-attach new invoices/prescriptions/lab/vitals/standing orders to the
-- patient's currently open visit (only when visit_id was not set explicitly)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.autofill_visit_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _vid UUID;
BEGIN
  IF NEW.visit_id IS NULL AND NEW.patient_id IS NOT NULL THEN
    SELECT id INTO _vid FROM public.visits
      WHERE patient_id = NEW.patient_id AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1;
    IF _vid IS NOT NULL THEN NEW.visit_id := _vid; END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS invoices_autofill_visit ON public.invoices;
CREATE TRIGGER invoices_autofill_visit BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.autofill_visit_id();

DROP TRIGGER IF EXISTS prescriptions_autofill_visit ON public.prescriptions;
CREATE TRIGGER prescriptions_autofill_visit BEFORE INSERT ON public.prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.autofill_visit_id();

DROP TRIGGER IF EXISTS lab_requests_autofill_visit ON public.lab_requests;
CREATE TRIGGER lab_requests_autofill_visit BEFORE INSERT ON public.lab_requests
  FOR EACH ROW EXECUTE FUNCTION public.autofill_visit_id();

DROP TRIGGER IF EXISTS vitals_autofill_visit ON public.vitals;
CREATE TRIGGER vitals_autofill_visit BEFORE INSERT ON public.vitals
  FOR EACH ROW EXECUTE FUNCTION public.autofill_visit_id();

DROP TRIGGER IF EXISTS standing_orders_autofill_visit ON public.standing_orders;
CREATE TRIGGER standing_orders_autofill_visit BEFORE INSERT ON public.standing_orders
  FOR EACH ROW EXECUTE FUNCTION public.autofill_visit_id();

-- ---------------------------------------------------------------------------
-- Keep visit totals in sync from invoices
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalc_visit_totals(_visit_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _visit_id IS NULL THEN RETURN; END IF;
  UPDATE public.visits v SET
    total_charged = COALESCE((SELECT SUM(total_amount) FROM public.invoices WHERE visit_id = _visit_id), 0),
    total_paid    = COALESCE((SELECT SUM(paid_amount)  FROM public.invoices WHERE visit_id = _visit_id), 0),
    updated_at = now()
  WHERE v.id = _visit_id;
END; $$;

CREATE OR REPLACE FUNCTION public.invoices_touch_visit_totals()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_visit_totals(OLD.visit_id);
    RETURN OLD;
  ELSE
    PERFORM public.recalc_visit_totals(NEW.visit_id);
    IF TG_OP = 'UPDATE' AND OLD.visit_id IS DISTINCT FROM NEW.visit_id THEN
      PERFORM public.recalc_visit_totals(OLD.visit_id);
    END IF;
    RETURN NEW;
  END IF;
END; $$;

DROP TRIGGER IF EXISTS invoices_visit_totals ON public.invoices;
CREATE TRIGGER invoices_visit_totals
  AFTER INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.invoices_touch_visit_totals();

-- ---------------------------------------------------------------------------
-- Close (settle) a visit
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_visit(_visit_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _v RECORD;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only billing/cashier/admin can settle a visit';
  END IF;
  PERFORM public.recalc_visit_totals(_visit_id);
  SELECT * INTO _v FROM public.visits WHERE id = _visit_id;
  IF _v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF _v.status <> 'open' THEN RAISE EXCEPTION 'Visit is already %', _v.status; END IF;

  UPDATE public.visits
    SET status = 'settled', closed_at = now(), closed_by = auth.uid(), updated_at = now()
  WHERE id = _visit_id;

  PERFORM public.write_audit_log(
    'visit_settled', 'visit', _visit_id::text,
    jsonb_build_object(
      'visit_number', _v.visit_number,
      'patient_id', _v.patient_id,
      'sponsor_type', _v.sponsor_type,
      'total_charged', _v.total_charged,
      'total_paid', _v.total_paid
    )
  );
END; $$;


-- ================================================================
-- 20260721114733_2ce722a0-8c50-4395-97d1-0dab40896f2a.sql
-- ================================================================

CREATE POLICY "Staff can view visit-card photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'visit-cards' AND public.is_authenticated_staff());

CREATE POLICY "Staff can upload visit-card photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'visit-cards'
  AND public.has_any_role(auth.uid(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','lab_tech','pharmacist','billing','accountant','admin']::app_role[])
);

CREATE POLICY "Admin can delete visit-card photos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'visit-cards' AND public.has_role(auth.uid(), 'admin'));


-- ================================================================
-- 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql
-- ================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.pricelist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  size TEXT,
  pack_qty INT NOT NULL DEFAULT 1,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  category TEXT NOT NULL CHECK (category IN (
    'drug_liquid','drug_tablet','drug_capsule','drug_injection',
    'drug_topical','consumable','lab','imaging','bed','procedure','other'
  )),
  search_text TEXT GENERATED ALWAYS AS (
    lower(coalesce(name,'') || ' ' || coalesce(size,''))
  ) STORED,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pricelist_search_idx ON public.pricelist USING gin (search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS pricelist_category_idx ON public.pricelist(category);
CREATE UNIQUE INDEX IF NOT EXISTS pricelist_unique_name_size ON public.pricelist(lower(name), lower(coalesce(size,'')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pricelist TO authenticated;
GRANT ALL ON public.pricelist TO service_role;
ALTER TABLE public.pricelist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Any staff can view pricelist"
  ON public.pricelist FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Admin/accountant manage pricelist"
  ON public.pricelist FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]));

CREATE TRIGGER trg_pricelist_updated
  BEFORE UPDATE ON public.pricelist
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

-- snap_orders
CREATE TABLE IF NOT EXISTS public.snap_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  visit_id   UUID REFERENCES public.visits(id) ON DELETE SET NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('prescription','lab','treatment')),
  target_station TEXT NOT NULL CHECK (target_station IN ('pharmacy','lab')),
  source_role TEXT NOT NULL,
  photo_path TEXT NOT NULL,
  note TEXT,
  ocr_text TEXT,
  ocr_confidence NUMERIC(4,3),
  matched_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending_billing' CHECK (status IN (
    'pending_billing','awaiting_payment','paid','fulfilled','rejected','cancelled'
  )),
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES auth.users(id),
  billed_by   UUID REFERENCES auth.users(id),
  billed_at   TIMESTAMPTZ,
  paid_at     TIMESTAMPTZ,
  fulfilled_by UUID REFERENCES auth.users(id),
  fulfilled_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS snap_orders_patient_idx ON public.snap_orders(patient_id);
CREATE INDEX IF NOT EXISTS snap_orders_status_idx  ON public.snap_orders(status);
CREATE INDEX IF NOT EXISTS snap_orders_target_idx  ON public.snap_orders(target_station, status);
CREATE INDEX IF NOT EXISTS snap_orders_visit_idx   ON public.snap_orders(visit_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.snap_orders TO authenticated;
GRANT ALL ON public.snap_orders TO service_role;
ALTER TABLE public.snap_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view snap orders"
  ON public.snap_orders FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Clinicians create snap orders"
  ON public.snap_orders FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(),
    ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]));

CREATE POLICY "Ops update snap orders"
  ON public.snap_orders FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['billing','accountant','pharmacist','lab_tech','admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(),
    ARRAY['billing','accountant','pharmacist','lab_tech','admin']::app_role[]));

CREATE POLICY "Admin delete snap orders"
  ON public.snap_orders FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_snap_orders_updated
  BEFORE UPDATE ON public.snap_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

CREATE TRIGGER trg_snap_orders_autofill_visit
  BEFORE INSERT ON public.snap_orders
  FOR EACH ROW EXECUTE FUNCTION public.autofill_visit_id();

-- Auto-mark snap as paid when its invoice is fully paid
CREATE OR REPLACE FUNCTION public.snap_orders_sync_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.paid_amount >= NEW.total_amount AND NEW.total_amount > 0
     AND (TG_OP = 'INSERT' OR OLD.paid_amount < OLD.total_amount) THEN
    UPDATE public.snap_orders
      SET status = 'paid', paid_at = now(), updated_at = now()
    WHERE invoice_id = NEW.id
      AND status = 'awaiting_payment';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snap_paid_sync ON public.invoices;
CREATE TRIGGER trg_snap_paid_sync
  AFTER INSERT OR UPDATE OF paid_amount, total_amount ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.snap_orders_sync_paid();


-- ================================================================
-- 20260721123502_729740f3-a268-4344-91d7-1ec5e2002965.sql
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_visit_audit_trail(_visit_id uuid)
RETURNS TABLE (
  id uuid,
  action text,
  resource_type text,
  resource_id text,
  details jsonb,
  status text,
  user_id uuid,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(),
       ARRAY['claims_manager','accountant','billing','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT a.id, a.action, a.resource_type, a.resource_id, a.details, a.status, a.user_id, a.created_at
  FROM public.audit_logs a
  WHERE (a.resource_type = 'visit' AND a.resource_id = _visit_id::text)
     OR (a.resource_type IN ('invoice','prescription')
         AND a.resource_id IN (
           SELECT i.id::text FROM public.invoices i WHERE i.visit_id = _visit_id
           UNION
           SELECT p.id::text FROM public.prescriptions p WHERE p.visit_id = _visit_id
         ))
  ORDER BY a.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_visit_audit_trail(uuid) TO authenticated;


-- ================================================================
-- 20260721130022_07e39dec-ed92-44df-b456-fc18e90c8848.sql
-- ================================================================

-- Revoke EXECUTE from anon/public on SECURITY DEFINER functions; grant only where needed
REVOKE EXECUTE ON FUNCTION public.autofill_visit_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.invoices_touch_visit_totals() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.snap_orders_sync_paid() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.next_visit_number() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recalc_visit_totals(uuid) FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.close_visit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_visit(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_visit_audit_trail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_visit_audit_trail(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.open_visit_for_patient(uuid, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_visit_for_patient(uuid, text, boolean, text) TO authenticated;


-- ================================================================
-- 20260721130157_785610bf-4fa0-4eff-9b04-7c3862d0cd87.sql
-- ================================================================

DROP POLICY IF EXISTS "Staff can view family members" ON public.staff_family_members;
CREATE POLICY "Staff view own family, admins view all"
  ON public.staff_family_members FOR SELECT
  TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['accountant'::app_role, 'admin'::app_role])
    OR staff_id IN (SELECT id FROM public.staff WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Staff can read own leave" ON public.staff_leave;
CREATE POLICY "Staff read own leave, admins read all"
  ON public.staff_leave FOR SELECT
  TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['accountant'::app_role, 'admin'::app_role, 'billing'::app_role])
    OR staff_id IN (SELECT id FROM public.staff WHERE auth_user_id = auth.uid())
  );


-- ================================================================
-- 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql
-- ================================================================

-- =========================================================
-- WARDS / ROOMS / BEDS
-- =========================================================
CREATE TABLE public.wards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  ward_type TEXT NOT NULL DEFAULT 'general',
  gender TEXT NOT NULL DEFAULT 'any' CHECK (gender IN ('male','female','any')),
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wards TO authenticated;
GRANT ALL ON public.wards TO service_role;
ALTER TABLE public.wards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view wards" ON public.wards
  FOR SELECT TO authenticated USING (public.is_authenticated_staff());
CREATE POLICY "Admin manages wards" ON public.wards
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]));

CREATE TABLE public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ward_id UUID NOT NULL REFERENCES public.wards(id) ON DELETE CASCADE,
  room_number TEXT NOT NULL,
  room_class TEXT NOT NULL DEFAULT 'general' CHECK (room_class IN ('private','semi_private','general','icu','vip')),
  daily_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ward_id, room_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rooms TO authenticated;
GRANT ALL ON public.rooms TO service_role;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view rooms" ON public.rooms
  FOR SELECT TO authenticated USING (public.is_authenticated_staff());
CREATE POLICY "Admin manages rooms" ON public.rooms
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]));

CREATE TABLE public.beds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  bed_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','occupied','maintenance')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, bed_label)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.beds TO authenticated;
GRANT ALL ON public.beds TO service_role;
ALTER TABLE public.beds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view beds" ON public.beds
  FOR SELECT TO authenticated USING (public.is_authenticated_staff());
CREATE POLICY "Admin & nurses manage bed status" ON public.beds
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','accountant','nurse']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','accountant','nurse']::app_role[]));

-- =========================================================
-- ADMISSIONS
-- =========================================================
CREATE TABLE public.admissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL,
  bed_id UUID REFERENCES public.beds(id) ON DELETE SET NULL,
  admitting_doctor UUID REFERENCES auth.users(id),
  assigned_by_nurse UUID REFERENCES auth.users(id),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'waiting_assignment'
    CHECK (status IN ('waiting_assignment','active','discharged','cancelled')),
  admitted_at TIMESTAMPTZ,
  discharged_at TIMESTAMPTZ,
  discharge_notes TEXT,
  discharged_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admissions TO authenticated;
GRANT ALL ON public.admissions TO service_role;
ALTER TABLE public.admissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clinical & billing staff read admissions" ON public.admissions
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['doctor','doctor1','doctor2','nurse','billing','accountant','admin','claims_manager','receptionist']::app_role[]));

CREATE POLICY "Doctors create admissions" ON public.admissions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(),
    ARRAY['doctor','doctor1','doctor2','admin']::app_role[]));

CREATE POLICY "Nurses & admin update admissions" ON public.admissions
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(),
    ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','admin']::app_role[]));

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER wards_touch BEFORE UPDATE ON public.wards
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER rooms_touch BEFORE UPDATE ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER beds_touch BEFORE UPDATE ON public.beds
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER admissions_touch BEFORE UPDATE ON public.admissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Auto-sync bed occupancy on admission changes
CREATE OR REPLACE FUNCTION public.sync_bed_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Free old bed if changed or discharged
  IF TG_OP = 'UPDATE' THEN
    IF OLD.bed_id IS NOT NULL
       AND (OLD.bed_id IS DISTINCT FROM NEW.bed_id OR NEW.status IN ('discharged','cancelled')) THEN
      UPDATE public.beds SET status='available', updated_at=now() WHERE id = OLD.bed_id;
    END IF;
  END IF;
  -- Occupy new bed if active
  IF NEW.bed_id IS NOT NULL AND NEW.status = 'active' THEN
    UPDATE public.beds SET status='occupied', updated_at=now() WHERE id = NEW.bed_id;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER admissions_sync_bed
AFTER INSERT OR UPDATE OF bed_id, status ON public.admissions
FOR EACH ROW EXECUTE FUNCTION public.sync_bed_status();

-- =========================================================
-- SNAP ORDERS: extend for lab-result return routing
-- =========================================================
ALTER TABLE public.snap_orders
  ADD COLUMN IF NOT EXISTS original_sender_role TEXT,
  ADD COLUMN IF NOT EXISTS parent_snap_id UUID REFERENCES public.snap_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS returned_to UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ack_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ack_by UUID REFERENCES auth.users(id);

-- Drop old status check if present, widen order_type and target_station values
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snap_orders_order_type_check') THEN
    ALTER TABLE public.snap_orders DROP CONSTRAINT snap_orders_order_type_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snap_orders_target_station_check') THEN
    ALTER TABLE public.snap_orders DROP CONSTRAINT snap_orders_target_station_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snap_orders_status_check') THEN
    ALTER TABLE public.snap_orders DROP CONSTRAINT snap_orders_status_check;
  END IF;
END $$;

ALTER TABLE public.snap_orders
  ADD CONSTRAINT snap_orders_order_type_check
    CHECK (order_type IN ('prescription','lab','treatment','lab_result')),
  ADD CONSTRAINT snap_orders_target_station_check
    CHECK (target_station IN ('pharmacy','lab','doctor','nurse','billing')),
  ADD CONSTRAINT snap_orders_status_check
    CHECK (status IN ('pending_billing','awaiting_payment','paid','fulfilled','rejected','cancelled','returned','acknowledged'));

CREATE INDEX IF NOT EXISTS snap_orders_returned_idx
  ON public.snap_orders(returned_to, status) WHERE order_type = 'lab_result';


-- ================================================================
-- 20260721141413_9d5f818d-0cc3-41b1-90de-7f88920f5ee4.sql
-- ================================================================

REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_bed_status() FROM PUBLIC, anon, authenticated;


-- ================================================================
-- 20260721144302_74e7be2d-3222-4d57-932f-fa039bcb1744.sql
-- ================================================================

-- Normalize legacy 'all' broadcast rows to NULL target_role
UPDATE public.notifications SET target_role = NULL WHERE target_role = 'all';

-- Replace read policy to also allow full broadcasts (both user_id and target_role NULL)
DROP POLICY IF EXISTS "Users can read own or targeted notifications" ON public.notifications;
CREATE POLICY "Users can read own or targeted notifications"
ON public.notifications FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR (user_id IS NULL AND target_role IS NULL)
  OR (user_id IS NULL AND target_role IS NOT NULL AND has_role(auth.uid(), target_role::app_role))
);

DROP POLICY IF EXISTS "Users can update own or targeted notifications" ON public.notifications;
CREATE POLICY "Users can update own or targeted notifications"
ON public.notifications FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  OR (user_id IS NULL AND target_role IS NULL)
  OR (user_id IS NULL AND target_role IS NOT NULL AND has_role(auth.uid(), target_role::app_role))
);


-- ================================================================
-- 20260721144745_48caadb1-e16a-45d5-bdfb-17b5bd5be27e.sql
-- ================================================================

-- Blank any patients.corporate_id values that are not valid UUIDs so the type change succeeds
UPDATE public.patients
   SET corporate_id = NULL
 WHERE corporate_id IS NOT NULL
   AND corporate_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

ALTER TABLE public.patients
  ALTER COLUMN corporate_id TYPE uuid USING corporate_id::uuid;

-- Ensure referential integrity (skip if already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patients_corporate_id_fkey'
  ) THEN
    ALTER TABLE public.patients
      ADD CONSTRAINT patients_corporate_id_fkey
      FOREIGN KEY (corporate_id) REFERENCES public.corporate_accounts(id) ON DELETE SET NULL;
  END IF;
END $$;


-- ================================================================
-- 20260721152317_3c33f06b-af5b-4525-b0dd-7c003190ca22.sql
-- ================================================================
CREATE OR REPLACE FUNCTION public.adjust_patient_balance(_patient_id uuid, _delta numeric, _transaction_type text, _payment_method text DEFAULT NULL::text, _related_request_id uuid DEFAULT NULL::uuid, _related_invoice_id uuid DEFAULT NULL::uuid, _notes text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _before NUMERIC;
  _after NUMERIC;
BEGIN
  SELECT balance INTO _before FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _before IS NULL THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;
  _after := _before + _delta;
  -- Only 'debt_incurred' transactions may push balance negative (short payments)
  IF _after < 0 AND _transaction_type <> 'debt_incurred' THEN
    RAISE EXCEPTION 'Insufficient balance (current: %, requested delta: %)', _before, _delta;
  END IF;
  UPDATE public.patients SET balance = _after, updated_at = now() WHERE id = _patient_id;
  INSERT INTO public.balance_transactions
    (patient_id, transaction_type, amount, balance_before, balance_after, payment_method, related_request_id, related_invoice_id, performed_by, notes)
  VALUES
    (_patient_id, _transaction_type, _delta, _before, _after, _payment_method, _related_request_id, _related_invoice_id, auth.uid(), _notes);
  RETURN _after;
END;
$function$;

-- ================================================================
-- 20260721153822_af0e5b21-6328-4aae-9dd1-e091a237ae61.sql
-- ================================================================
ALTER TABLE public.balance_transactions DROP CONSTRAINT balance_transactions_transaction_type_check;
ALTER TABLE public.balance_transactions ADD CONSTRAINT balance_transactions_transaction_type_check CHECK (transaction_type = ANY (ARRAY['topup'::text, 'refund'::text, 'invoice_deduction'::text, 'staff_family_coverage'::text, 'staff_coverage'::text, 'adjustment'::text, 'debt_incurred'::text, 'debt_cleared'::text]));

-- ================================================================
-- 20260722123051_c364e708-035b-406b-b4e5-91bdfba1fe31.sql
-- ================================================================

-- allow negative balances (already permitted at ledger level; drop table CHECK)
ALTER TABLE public.patients DROP CONSTRAINT IF EXISTS check_balance_non_negative;

-- ward-level minimum admission deposit
ALTER TABLE public.wards ADD COLUMN IF NOT EXISTS min_admission_deposit NUMERIC(12,2) NOT NULL DEFAULT 0;

-- snap_orders: fields for admitted in-ward flow
ALTER TABLE public.snap_orders
  ADD COLUMN IF NOT EXISTS is_admitted_snap BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS debt_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS debt_reason TEXT;

-- widen status check to include 'held_no_balance'
ALTER TABLE public.snap_orders DROP CONSTRAINT IF EXISTS snap_orders_status_check;
ALTER TABLE public.snap_orders ADD CONSTRAINT snap_orders_status_check
  CHECK (status = ANY (ARRAY[
    'pending_billing','awaiting_payment','paid','fulfilled','rejected','cancelled',
    'returned','acknowledged','held_no_balance'
  ]));

-- widen transaction_type to include admitted_deduction
ALTER TABLE public.balance_transactions DROP CONSTRAINT IF EXISTS balance_transactions_transaction_type_check;
ALTER TABLE public.balance_transactions ADD CONSTRAINT balance_transactions_transaction_type_check
  CHECK (transaction_type = ANY (ARRAY[
    'topup','refund','invoice_deduction','staff_family_coverage','staff_coverage',
    'adjustment','debt_incurred','debt_cleared','admitted_deduction'
  ]));

-- RPC: create in-ward snap for admitted patient, deducting from balance
CREATE OR REPLACE FUNCTION public.create_admitted_snap(
  _patient_id UUID,
  _order_type TEXT,
  _target_station TEXT,
  _photo_path TEXT,
  _note TEXT,
  _items JSONB,
  _total NUMERIC,
  _allow_debt BOOLEAN DEFAULT false,
  _debt_reason TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _visit UUID;
  _admission UUID;
  _bal NUMERIC;
  _snap_id UUID;
  _new_bal NUMERIC;
  _debt NUMERIC := 0;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT id INTO _admission FROM public.admissions
   WHERE patient_id = _patient_id AND status = 'active' LIMIT 1;
  IF _admission IS NULL THEN
    RAISE EXCEPTION 'Patient is not currently admitted';
  END IF;

  SELECT id INTO _visit FROM public.visits
   WHERE patient_id = _patient_id AND status = 'open'
   ORDER BY opened_at DESC LIMIT 1;

  SELECT balance INTO _bal FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _bal IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  IF _bal < _total THEN
    IF NOT _allow_debt THEN
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE: balance % < required %', _bal, _total;
    END IF;
    IF _debt_reason IS NULL OR length(trim(_debt_reason)) < 3 THEN
      RAISE EXCEPTION 'Debt override requires a reason';
    END IF;
    _debt := _total - _bal;
  END IF;

  -- Deduct (allowed to go negative when overriding)
  _new_bal := _bal - _total;
  UPDATE public.patients SET balance = _new_bal, updated_at = now() WHERE id = _patient_id;
  INSERT INTO public.balance_transactions
    (patient_id, transaction_type, amount, balance_before, balance_after, performed_by, notes)
  VALUES
    (_patient_id, CASE WHEN _debt > 0 THEN 'debt_incurred' ELSE 'admitted_deduction' END,
     -_total, _bal, _new_bal, _uid,
     CASE WHEN _debt > 0
          THEN 'Admitted in-ward ' || _order_type || ' (debt ₦' || _debt || '): ' || COALESCE(_debt_reason,'')
          ELSE 'Admitted in-ward ' || _order_type END);

  INSERT INTO public.snap_orders (
    patient_id, visit_id, order_type, target_station, source_role,
    photo_path, note, matched_items, status, created_by,
    is_admitted_snap, debt_amount, debt_reason,
    billed_by, billed_at, paid_at, original_sender_role
  ) VALUES (
    _patient_id, _visit, _order_type, _target_station,
    (SELECT role::text FROM public.user_roles WHERE user_id = _uid LIMIT 1),
    _photo_path, _note, COALESCE(_items, '[]'::jsonb),
    'paid', _uid, true, _debt, _debt_reason,
    _uid, now(), now(),
    (SELECT role::text FROM public.user_roles WHERE user_id = _uid LIMIT 1)
  ) RETURNING id INTO _snap_id;

  PERFORM public.write_audit_log(
    CASE WHEN _debt > 0 THEN 'admitted_snap_debt' ELSE 'admitted_snap_created' END,
    'snap_order', _snap_id::text,
    jsonb_build_object(
      'patient_id', _patient_id, 'total', _total, 'debt', _debt,
      'balance_after', _new_bal, 'reason', _debt_reason,
      'target_station', _target_station, 'order_type', _order_type
    )
  );

  RETURN _snap_id;
END; $$;

REVOKE ALL ON FUNCTION public.create_admitted_snap(UUID,TEXT,TEXT,TEXT,TEXT,JSONB,NUMERIC,BOOLEAN,TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_admitted_snap(UUID,TEXT,TEXT,TEXT,TEXT,JSONB,NUMERIC,BOOLEAN,TEXT) TO authenticated;


-- ================================================================
-- 20260722123425_8ad87bf1-0b64-4709-b1c0-469452ad5b0f.sql
-- ================================================================

CREATE OR REPLACE FUNCTION public.discharge_admission(
  _admission_id uuid,
  _notes text DEFAULT NULL,
  _settlement_method text DEFAULT NULL,  -- 'cash','pos','transfer','waive','carry' or NULL when balance>=0
  _settlement_amount numeric DEFAULT 0,
  _settlement_notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _adm RECORD;
  _bal numeric;
  _debt numeric;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
       ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to discharge';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF _adm.status <> 'active' THEN RAISE EXCEPTION 'Admission is not active (%)', _adm.status; END IF;

  SELECT balance INTO _bal FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
  _debt := GREATEST(0, -COALESCE(_bal,0));

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % — pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash','pos','transfer') THEN
      IF COALESCE(_settlement_amount,0) < _debt THEN
        RAISE EXCEPTION 'Settlement amount % is less than debt %', _settlement_amount, _debt;
      END IF;
      -- Credit the patient balance to clear debt (and keep any excess)
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, _settlement_amount, 'debt_cleared', _settlement_method,
        NULL, NULL,
        COALESCE(_settlement_notes, 'Discharge settlement')
      );
    ELSIF _settlement_method = 'waive' THEN
      IF NOT public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]) THEN
        RAISE EXCEPTION 'Only accountant/admin can waive debt';
      END IF;
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, _debt, 'debt_cleared', 'waive',
        NULL, NULL,
        COALESCE(_settlement_notes, 'Discharge — debt waived')
      );
    ELSIF _settlement_method = 'carry' THEN
      -- Debt stays on patient balance; log only
      PERFORM public.write_audit_log(
        'debt_carried_on_discharge', 'admission', _admission_id::text,
        jsonb_build_object('patient_id', _adm.patient_id, 'debt', _debt, 'notes', _settlement_notes)
      );
    ELSE
      RAISE EXCEPTION 'Unknown settlement method: %', _settlement_method;
    END IF;
  END IF;

  UPDATE public.admissions
    SET status = 'discharged',
        discharged_at = now(),
        discharged_by = auth.uid(),
        discharge_notes = _notes,
        updated_at = now()
    WHERE id = _admission_id;

  PERFORM public.write_audit_log(
    'patient_discharged', 'admission', _admission_id::text,
    jsonb_build_object(
      'patient_id', _adm.patient_id,
      'bed_id', _adm.bed_id,
      'debt_at_discharge', _debt,
      'settlement_method', _settlement_method,
      'settlement_amount', _settlement_amount
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) TO authenticated;


-- ================================================================
-- 20260722143444_deca52c0-7937-4435-ad5d-30023417c58f.sql
-- ================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['visits','vitals','visit_attachments','snap_orders','invoices','invoice_items','admissions','patients'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
  END LOOP;
END $$;

-- ================================================================
-- 20260722145620_a5f6b050-69e9-4627-8c4f-0fe2a77da966.sql
-- ================================================================
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS occupation TEXT;

ALTER TABLE public.patients
  ALTER COLUMN last_name DROP NOT NULL,
  ALTER COLUMN emergency_contact DROP NOT NULL;

-- ================================================================
-- 20260722161443_6cbd436f-4745-4e96-9540-6aeef8950bc0.sql
-- ================================================================
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'anc';

-- ================================================================
-- 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql
-- ================================================================

CREATE TABLE public.anc_programs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  anc_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','archived')),
  registration_date DATE NOT NULL DEFAULT CURRENT_DATE,
  lmp DATE, edd DATE,
  gravida INTEGER, para INTEGER,
  height NUMERIC, weight NUMERIC,
  religion TEXT, tribe TEXT,
  occupation TEXT, husband_occupation TEXT,
  previous_pregnancies JSONB DEFAULT '[]'::jsonb,
  remarks TEXT, pelvic_assessment TEXT, special_considerations TEXT,
  high_risk BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  closed_at TIMESTAMPTZ,
  delivery_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_anc_programs_patient ON public.anc_programs(patient_id);
CREATE INDEX idx_anc_programs_status ON public.anc_programs(status);
CREATE UNIQUE INDEX uniq_active_anc_per_patient ON public.anc_programs(patient_id) WHERE status='active';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.anc_programs TO authenticated;
GRANT ALL ON public.anc_programs TO service_role;
ALTER TABLE public.anc_programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anc_programs_view" ON public.anc_programs FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'anc') OR public.has_role(auth.uid(),'nurse') OR
  public.has_role(auth.uid(),'doctor') OR public.has_role(auth.uid(),'doctor1') OR public.has_role(auth.uid(),'doctor2') OR
  public.has_role(auth.uid(),'lab_tech') OR public.has_role(auth.uid(),'pharmacist') OR
  public.has_role(auth.uid(),'receptionist') OR public.has_role(auth.uid(),'billing') OR
  public.has_role(auth.uid(),'admin')
);
CREATE POLICY "anc_programs_insert" ON public.anc_programs FOR INSERT TO authenticated WITH CHECK (
  public.has_role(auth.uid(),'anc') OR public.has_role(auth.uid(),'nurse') OR public.has_role(auth.uid(),'admin')
);
CREATE POLICY "anc_programs_update" ON public.anc_programs FOR UPDATE TO authenticated USING (
  public.has_role(auth.uid(),'anc') OR public.has_role(auth.uid(),'nurse') OR
  public.has_role(auth.uid(),'doctor1') OR public.has_role(auth.uid(),'doctor2') OR public.has_role(auth.uid(),'admin')
);
CREATE POLICY "anc_programs_delete" ON public.anc_programs FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.anc_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER trg_anc_programs_updated BEFORE UPDATE ON public.anc_programs
FOR EACH ROW EXECUTE FUNCTION public.anc_touch_updated_at();

CREATE TABLE public.anc_visits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  anc_program_id UUID NOT NULL REFERENCES public.anc_programs(id) ON DELETE CASCADE,
  visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  week_of_pregnancy INTEGER,
  weight NUMERIC, blood_pressure TEXT, urine TEXT, hb TEXT, oedema TEXT,
  fundal_height TEXT, presentation TEXT, fetal_heart_rate TEXT,
  comment TEXT, next_visit DATE,
  staff_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_anc_visits_program ON public.anc_visits(anc_program_id);
CREATE INDEX idx_anc_visits_date ON public.anc_visits(visit_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.anc_visits TO authenticated;
GRANT ALL ON public.anc_visits TO service_role;
ALTER TABLE public.anc_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anc_visits_view" ON public.anc_visits FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'anc') OR public.has_role(auth.uid(),'nurse') OR
  public.has_role(auth.uid(),'doctor') OR public.has_role(auth.uid(),'doctor1') OR public.has_role(auth.uid(),'doctor2') OR
  public.has_role(auth.uid(),'lab_tech') OR public.has_role(auth.uid(),'pharmacist') OR
  public.has_role(auth.uid(),'billing') OR public.has_role(auth.uid(),'admin')
);
CREATE POLICY "anc_visits_insert" ON public.anc_visits FOR INSERT TO authenticated WITH CHECK (
  public.has_role(auth.uid(),'anc') OR public.has_role(auth.uid(),'nurse') OR
  public.has_role(auth.uid(),'doctor1') OR public.has_role(auth.uid(),'doctor2') OR public.has_role(auth.uid(),'admin')
);
CREATE POLICY "anc_visits_update" ON public.anc_visits FOR UPDATE TO authenticated USING (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'anc')
);
CREATE POLICY "anc_visits_delete" ON public.anc_visits FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

ALTER PUBLICATION supabase_realtime ADD TABLE public.anc_programs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.anc_visits;

CREATE OR REPLACE FUNCTION public.generate_anc_number()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE yr TEXT := to_char(CURRENT_DATE,'YYYY'); seq INTEGER;
BEGIN
  SELECT COUNT(*)+1 INTO seq FROM public.anc_programs WHERE anc_number LIKE 'ANC-'||yr||'-%';
  RETURN 'ANC-'||yr||'-'||lpad(seq::text,5,'0');
END; $$;


-- ================================================================
-- 20260722190607_916ae97b-63d7-45e0-848b-b60ba03f8a47.sql
-- ================================================================
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS enrollee_id TEXT;

-- ================================================================
-- 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql
-- ================================================================

-- Phase 1: OCR fields on snap_orders + app_settings + trigram indexes
ALTER TABLE public.snap_orders
  ADD COLUMN IF NOT EXISTS ocr_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS ocr_text text,
  ADD COLUMN IF NOT EXISTS ocr_confidence numeric,
  ADD COLUMN IF NOT EXISTS ocr_model text,
  ADD COLUMN IF NOT EXISTS ocr_matches jsonb,
  ADD COLUMN IF NOT EXISTS ocr_error text,
  ADD COLUMN IF NOT EXISTS ocr_corrected_text text,
  ADD COLUMN IF NOT EXISTS ocr_corrected_by uuid,
  ADD COLUMN IF NOT EXISTS ocr_corrected_at timestamptz;

CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read settings" ON public.app_settings;
CREATE POLICY "read settings" ON public.app_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admin writes settings" ON public.app_settings;
CREATE POLICY "admin writes settings" ON public.app_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS app_settings_touch ON public.app_settings;
CREATE TRIGGER app_settings_touch
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed default OCR model
INSERT INTO public.app_settings (key, value)
VALUES ('ocr', jsonb_build_object('model', 'google/gemini-3.1-pro-preview'))
ON CONFLICT (key) DO NOTHING;

-- Trigram indexes for fuzzy matching against catalogues
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS pricelist_name_trgm ON public.pricelist USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS inventory_items_name_trgm ON public.inventory_items USING gin (name gin_trgm_ops);

-- Fuzzy-match helper used by the snap-ocr edge function
CREATE OR REPLACE FUNCTION public.match_catalogue(_query text, _limit int DEFAULT 3)
RETURNS TABLE (
  source text,
  id uuid,
  name text,
  price numeric,
  score real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  (SELECT 'pricelist'::text AS source, p.id, p.name,
          COALESCE(p.price, 0)::numeric AS price,
          similarity(p.name, _query) AS score
     FROM public.pricelist p
     WHERE p.name % _query
     ORDER BY score DESC
     LIMIT _limit)
  UNION ALL
  (SELECT 'inventory'::text AS source, i.id, i.name,
          COALESCE(i.unit_price, 0)::numeric AS price,
          similarity(i.name, _query) AS score
     FROM public.inventory_items i
     WHERE i.name % _query
     ORDER BY score DESC
     LIMIT _limit)
  ORDER BY score DESC
  LIMIT _limit;
$$;

REVOKE ALL ON FUNCTION public.match_catalogue(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_catalogue(text, int) TO authenticated, service_role;


-- ================================================================
-- 20260722194538_ad8616f2-3796-4b28-aba4-c1b6f0217fd8.sql
-- ================================================================

-- Ownership check: only the station currently holding the patient can add snaps.
CREATE OR REPLACE FUNCTION public.can_add_snap_for_patient(_patient_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _status text;
  _is_admitted boolean;
BEGIN
  IF _user_id IS NULL OR _patient_id IS NULL THEN RETURN false; END IF;

  -- Admin always allowed.
  IF public.has_role(_user_id, 'admin'::app_role) THEN RETURN true; END IF;

  SELECT status::text INTO _status FROM public.patients WHERE id = _patient_id;
  IF _status IS NULL THEN RETURN false; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.admissions
     WHERE patient_id = _patient_id AND status = 'active'
  ) INTO _is_admitted;

  -- Admitted patients: nursing/doctor roles retain ownership in the ward.
  IF _is_admitted OR _status = 'admitted' THEN
    RETURN public.has_any_role(_user_id,
      ARRAY['nurse','doctor','doctor1','doctor2']::app_role[]);
  END IF;

  RETURN CASE _status
    WHEN 'with_nurse'   THEN public.has_role(_user_id, 'nurse'::app_role)
    WHEN 'with_doctor'  THEN public.has_any_role(_user_id,
                              ARRAY['doctor','doctor1','doctor2']::app_role[])
    WHEN 'in_lab'       THEN public.has_role(_user_id, 'lab_tech'::app_role)
    WHEN 'at_pharmacy'  THEN public.has_role(_user_id, 'pharmacist'::app_role)
    ELSE false
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.can_add_snap_for_patient(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_add_snap_for_patient(uuid, uuid) TO authenticated;

-- Replace INSERT policy to enforce ownership on top of role.
DROP POLICY IF EXISTS "Clinicians create snap orders" ON public.snap_orders;

CREATE POLICY "Owner station can create snap orders"
ON public.snap_orders
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_any_role(auth.uid(),
    ARRAY['nurse','doctor','doctor1','doctor2','lab_tech','pharmacist','admin']::app_role[])
  AND public.can_add_snap_for_patient(patient_id, auth.uid())
);


-- ================================================================
-- 20260722195524_3fac40c0-504d-42e3-8726-cc9d15c53bdc.sql
-- ================================================================
ALTER TABLE public.snap_orders
  ADD COLUMN IF NOT EXISTS ocr_reviewed_lines jsonb,
  ADD COLUMN IF NOT EXISTS ocr_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ocr_reviewed_by uuid;

-- ================================================================
-- 20260723100418_c1f18793-7e24-465a-a798-5d165562bf18.sql
-- ================================================================

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS actor_role text;

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_role ON public.audit_logs(actor_role);

-- Helper: resolve the primary (or joined) role label(s) for a user.
CREATE OR REPLACE FUNCTION public.current_actor_role(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT string_agg(role::text, ',' ORDER BY role::text)
  FROM public.user_roles
  WHERE user_id = _user_id
$$;

REVOKE EXECUTE ON FUNCTION public.current_actor_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_actor_role(uuid) TO authenticated, service_role;

-- Update write_audit_log to capture the actor's role automatically.
CREATE OR REPLACE FUNCTION public.write_audit_log(
  _action text,
  _resource_type text,
  _resource_id text,
  _details jsonb,
  _status text DEFAULT 'success'::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid  uuid := auth.uid();
  _role text := public.current_actor_role(auth.uid());
BEGIN
  INSERT INTO public.audit_logs
    (user_id, action, resource_type, resource_id, details, status, actor_role)
  VALUES
    (_uid, _action, _resource_type, _resource_id,
     COALESCE(_details, '{}'::jsonb) || jsonb_build_object('actor_role', _role),
     _status, _role);
END;
$$;


-- ================================================================
-- 20260723101414_686957d0-9e4f-4469-b6b8-e6c32402456c.sql
-- ================================================================
ALTER TABLE public.patients DROP CONSTRAINT patients_status_check;
ALTER TABLE public.patients ADD CONSTRAINT patients_status_check CHECK (status = ANY (ARRAY['registered'::text, 'waiting'::text, 'with_nurse'::text, 'with_doctor'::text, 'in_lab'::text, 'awaiting_billing'::text, 'awaiting_payment'::text, 'at_pharmacy'::text, 'admitted'::text, 'discharged'::text, 'awaiting_room'::text]));

-- ================================================================
-- 20260723102306_7722fdd0-b982-4c1e-88ce-1a32145f2a82.sql
-- ================================================================

-- 1. Split the UPDATE policy so pharmacist/lab_tech only see paid rows
DROP POLICY IF EXISTS "Ops update snap orders" ON public.snap_orders;

CREATE POLICY "Billing update snap orders"
  ON public.snap_orders FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['billing','accountant','admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(),
    ARRAY['billing','accountant','admin']::app_role[]));

CREATE POLICY "Fulfillers update only paid snap orders"
  ON public.snap_orders FOR UPDATE TO authenticated
  USING (
    public.has_any_role(auth.uid(),
      ARRAY['pharmacist','lab_tech']::app_role[])
    AND status = 'paid'
  )
  WITH CHECK (
    public.has_any_role(auth.uid(),
      ARRAY['pharmacist','lab_tech']::app_role[])
    AND status IN ('paid','fulfilled','rejected')
  );

-- 2. Defense-in-depth trigger: cannot move to 'fulfilled' unless previously 'paid'
CREATE OR REPLACE FUNCTION public.enforce_snap_paid_before_fulfill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'fulfilled'
     AND COALESCE(OLD.status,'') <> 'fulfilled'
     AND COALESCE(OLD.status,'') <> 'paid' THEN
    RAISE EXCEPTION 'PAYMENT_REQUIRED: snap % must be paid before it can be fulfilled (current status: %)',
      NEW.id, OLD.status;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_snap_paid_before_fulfill() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_snap_paid_before_fulfill ON public.snap_orders;
CREATE TRIGGER trg_snap_paid_before_fulfill
  BEFORE UPDATE ON public.snap_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_snap_paid_before_fulfill();


-- ================================================================
-- 20260723110404_8593a75f-69a4-41f8-9146-671d5ae24a12.sql
-- ================================================================

-- 1. app_settings: restrict SELECT to admin only
DROP POLICY IF EXISTS "read settings" ON public.app_settings;
CREATE POLICY "Admin reads settings"
  ON public.app_settings
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2. wards / rooms: admin-only management
DROP POLICY IF EXISTS "Admin manages wards" ON public.wards;
CREATE POLICY "Admin manages wards"
  ON public.wards
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admin manages rooms" ON public.rooms;
CREATE POLICY "Admin manages rooms"
  ON public.rooms
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 3. beds: admin + nurse (drop accountant)
DROP POLICY IF EXISTS "Admin & nurses manage bed status" ON public.beds;
CREATE POLICY "Admin & nurses manage bed status"
  ON public.beds
  FOR ALL
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','nurse']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','nurse']::app_role[]));


-- ================================================================
-- 20260723160132_5a6d732f-8e2f-4619-a7d3-0e23b7a53e0e.sql
-- ================================================================

-- ============================================================
-- 1. Seed Wards A–E and rooms A1..E3 (idempotent)
-- ============================================================
DO $$
DECLARE
  _ward_id uuid;
  _room_id uuid;
  _ward_letter text;
  _room_num int;
  _is_vip boolean;
  _daily numeric;
  _room_class text;
BEGIN
  FOREACH _ward_letter IN ARRAY ARRAY['A','B','C','D','E'] LOOP
    _is_vip := (_ward_letter = 'E');
    SELECT id INTO _ward_id FROM public.wards WHERE name = 'Ward ' || _ward_letter LIMIT 1;
    IF _ward_id IS NULL THEN
      INSERT INTO public.wards (name, ward_type, gender, description, active, min_admission_deposit)
      VALUES (
        'Ward ' || _ward_letter,
        CASE WHEN _is_vip THEN 'vip' ELSE 'general' END,
        'any',
        CASE WHEN _is_vip THEN 'VIP ward' ELSE NULL END,
        true,
        0
      )
      RETURNING id INTO _ward_id;
    END IF;

    _daily := CASE WHEN _is_vip THEN 25000 ELSE 5000 END;
    _room_class := CASE WHEN _is_vip THEN 'vip' ELSE 'general' END;

    FOR _room_num IN 1..3 LOOP
      SELECT id INTO _room_id
        FROM public.rooms
        WHERE ward_id = _ward_id AND room_number = _ward_letter || _room_num
        LIMIT 1;
      IF _room_id IS NULL THEN
        INSERT INTO public.rooms (ward_id, room_number, room_class, daily_rate, active)
        VALUES (_ward_id, _ward_letter || _room_num, _room_class, _daily, true)
        RETURNING id INTO _room_id;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM public.beds WHERE room_id = _room_id) THEN
        INSERT INTO public.beds (room_id, bed_label, status, active)
        VALUES (_room_id, 'Bed 1', 'available', true);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ============================================================
-- 2. Extend admissions with admission-snap + ready-for-discharge fields
-- ============================================================
ALTER TABLE public.admissions
  ADD COLUMN IF NOT EXISTS admission_snap_path text,
  ADD COLUMN IF NOT EXISTS admission_note text,
  ADD COLUMN IF NOT EXISTS ready_for_discharge_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_for_discharge_by uuid,
  ADD COLUMN IF NOT EXISTS discharge_order_snap_id uuid;

-- ============================================================
-- 3. Extend snap_orders with a lightweight "intent" tag so admission
--    orders and discharge orders can be recognised without changing
--    the existing order_type contract.
-- ============================================================
ALTER TABLE public.snap_orders
  ADD COLUMN IF NOT EXISTS intent text;

-- ============================================================
-- 4. request_admission: create admission row + require snap image
-- ============================================================
CREATE OR REPLACE FUNCTION public.request_admission(
  _patient_id uuid,
  _reason text,
  _photo_path text,
  _note text DEFAULT NULL,
  _visit_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _adm uuid;
  _visit uuid;
  _snap uuid;
  _role text;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to admit';
  END IF;
  IF _photo_path IS NULL OR length(trim(_photo_path)) = 0 THEN
    RAISE EXCEPTION 'ADMISSION_SNAP_REQUIRED: an admission-order photo is required';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.admissions
     WHERE patient_id = _patient_id
       AND status IN ('waiting_assignment','active','ready_for_discharge')
  ) THEN
    RAISE EXCEPTION 'Patient already has an open admission';
  END IF;

  _visit := _visit_id;
  IF _visit IS NULL THEN
    SELECT id INTO _visit FROM public.visits
     WHERE patient_id = _patient_id AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1;
  END IF;

  INSERT INTO public.admissions (
    patient_id, visit_id, admitting_doctor, reason, status,
    admission_snap_path, admission_note
  ) VALUES (
    _patient_id, _visit, _uid, _reason, 'waiting_assignment',
    _photo_path, _note
  ) RETURNING id INTO _adm;

  SELECT role::text INTO _role FROM public.user_roles WHERE user_id = _uid LIMIT 1;

  -- Also record the admission order as a snap for the timeline / OCR.
  INSERT INTO public.snap_orders (
    patient_id, visit_id, order_type, target_station, source_role,
    photo_path, note, status, created_by, original_sender_role, intent
  ) VALUES (
    _patient_id, _visit, 'treatment', 'nurse', COALESCE(_role,'nurse'),
    _photo_path, COALESCE(_note, _reason), 'acknowledged', _uid, COALESCE(_role,'nurse'),
    'admission_order'
  ) RETURNING id INTO _snap;

  PERFORM public.write_audit_log(
    'admission_requested', 'admission', _adm::text,
    jsonb_build_object('patient_id', _patient_id, 'snap_id', _snap, 'reason', _reason)
  );
  RETURN _adm;
END $$;

GRANT EXECUTE ON FUNCTION public.request_admission(uuid, text, text, text, uuid) TO authenticated;

-- ============================================================
-- 5. mark_ready_for_discharge: doctor snap discharges the admission logically
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_ready_for_discharge(
  _admission_id uuid,
  _snap_id uuid DEFAULT NULL,
  _note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _adm RECORD;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only doctors can create a discharge order';
  END IF;
  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF _adm.status <> 'active' THEN
    RAISE EXCEPTION 'Admission is not active (%)', _adm.status;
  END IF;

  UPDATE public.admissions
    SET status = 'ready_for_discharge',
        ready_for_discharge_at = now(),
        ready_for_discharge_by = _uid,
        discharge_order_snap_id = _snap_id,
        discharge_notes = COALESCE(_note, discharge_notes),
        updated_at = now()
  WHERE id = _admission_id;

  PERFORM public.write_audit_log(
    'discharge_order_signed', 'admission', _admission_id::text,
    jsonb_build_object('patient_id', _adm.patient_id, 'snap_id', _snap_id, 'note', _note)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.mark_ready_for_discharge(uuid, uuid, text) TO authenticated;

-- ============================================================
-- 6. forward_snap_to_billing: reuse an existing snap image to create a
--    fresh Pharmacy or Lab task that goes through billing (no rewrite).
-- ============================================================
CREATE OR REPLACE FUNCTION public.forward_snap_to_billing(
  _source_snap_id uuid,
  _target_station text,
  _note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _src RECORD;
  _new uuid;
  _role text;
  _order_type text;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _target_station NOT IN ('pharmacy','lab') THEN
    RAISE EXCEPTION 'Target must be pharmacy or lab';
  END IF;

  SELECT * INTO _src FROM public.snap_orders WHERE id = _source_snap_id;
  IF _src IS NULL THEN RAISE EXCEPTION 'Source snap not found'; END IF;

  _order_type := CASE _target_station WHEN 'lab' THEN 'lab' ELSE 'prescription' END;
  SELECT role::text INTO _role FROM public.user_roles WHERE user_id = _uid LIMIT 1;

  INSERT INTO public.snap_orders (
    patient_id, visit_id, order_type, target_station, source_role,
    photo_path, note, status, created_by, original_sender_role,
    parent_snap_id, matched_items, ocr_text, ocr_confidence
  ) VALUES (
    _src.patient_id, _src.visit_id, _order_type, _target_station,
    COALESCE(_role, _src.source_role),
    _src.photo_path,
    COALESCE(_note, 'Forwarded from admitted patient snap'),
    'pending_billing', _uid, COALESCE(_role, _src.source_role),
    _src.id, COALESCE(_src.matched_items, '[]'::jsonb),
    _src.ocr_text, _src.ocr_confidence
  ) RETURNING id INTO _new;

  PERFORM public.write_audit_log(
    'snap_forwarded_to_billing', 'snap_order', _new::text,
    jsonb_build_object(
      'source_snap_id', _src.id,
      'patient_id', _src.patient_id,
      'target_station', _target_station
    )
  );
  RETURN _new;
END $$;

GRANT EXECUTE ON FUNCTION public.forward_snap_to_billing(uuid, text, text) TO authenticated;


-- ================================================================
-- 20260724092336_b24b1af1-2534-4793-8ab3-78cee304957c.sql
-- ================================================================

-- Phase 1: Journey State foundation
-- Additive only. Does not modify existing tables.

-- 1. patient_journey — current active journey row per patient
CREATE TABLE public.patient_journey (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  visit_id uuid,
  current_state text NOT NULL,
  owner_role text,
  owner_user_id uuid,
  department text,
  location text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (patient_id)
);

GRANT SELECT, INSERT, UPDATE ON public.patient_journey TO authenticated;
GRANT ALL ON public.patient_journey TO service_role;

ALTER TABLE public.patient_journey ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read journey"
  ON public.patient_journey FOR SELECT
  TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Staff can insert journey"
  ON public.patient_journey FOR INSERT
  TO authenticated
  WITH CHECK (public.is_authenticated_staff());

CREATE POLICY "Staff can update journey"
  ON public.patient_journey FOR UPDATE
  TO authenticated
  USING (public.is_authenticated_staff())
  WITH CHECK (public.is_authenticated_staff());

CREATE INDEX idx_patient_journey_state ON public.patient_journey(current_state);
CREATE INDEX idx_patient_journey_owner_role ON public.patient_journey(owner_role);
CREATE INDEX idx_patient_journey_owner_user ON public.patient_journey(owner_user_id);

CREATE TRIGGER trg_patient_journey_touch
  BEFORE UPDATE ON public.patient_journey
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. patient_journey_history — append-only audit trail
CREATE TABLE public.patient_journey_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid REFERENCES public.patient_journey(id) ON DELETE SET NULL,
  patient_id uuid NOT NULL,
  visit_id uuid,
  from_state text,
  to_state text NOT NULL,
  from_owner_role text,
  to_owner_role text,
  from_owner_user_id uuid,
  to_owner_user_id uuid,
  department text,
  location text,
  actor_user_id uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.patient_journey_history TO authenticated;
GRANT ALL ON public.patient_journey_history TO service_role;

ALTER TABLE public.patient_journey_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read journey history"
  ON public.patient_journey_history FOR SELECT
  TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Staff can append journey history"
  ON public.patient_journey_history FOR INSERT
  TO authenticated
  WITH CHECK (public.is_authenticated_staff());

CREATE INDEX idx_journey_history_patient ON public.patient_journey_history(patient_id, created_at DESC);
CREATE INDEX idx_journey_history_journey ON public.patient_journey_history(journey_id, created_at DESC);

-- 3. advance_journey — the one entry point for workflow moves.
-- Also mirrors patients.status so all existing UI keeps working unchanged.
CREATE OR REPLACE FUNCTION public.advance_journey(
  _patient_id uuid,
  _to_state text,
  _owner_role text DEFAULT NULL,
  _owner_user_id uuid DEFAULT NULL,
  _department text DEFAULT NULL,
  _location text DEFAULT NULL,
  _visit_id uuid DEFAULT NULL,
  _reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _existing public.patient_journey%ROWTYPE;
  _journey_id uuid;
  _visit uuid := _visit_id;
  _legacy_status_ok boolean;
BEGIN
  IF NOT public.is_authenticated_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _patient_id IS NULL OR _to_state IS NULL THEN
    RAISE EXCEPTION 'patient_id and to_state are required';
  END IF;

  IF _visit IS NULL THEN
    SELECT id INTO _visit FROM public.visits
     WHERE patient_id = _patient_id AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1;
  END IF;

  SELECT * INTO _existing FROM public.patient_journey
   WHERE patient_id = _patient_id FOR UPDATE;

  IF _existing.id IS NULL THEN
    INSERT INTO public.patient_journey
      (patient_id, visit_id, current_state, owner_role, owner_user_id, department, location)
    VALUES
      (_patient_id, _visit, _to_state, _owner_role, _owner_user_id, _department, _location)
    RETURNING id INTO _journey_id;

    INSERT INTO public.patient_journey_history
      (journey_id, patient_id, visit_id, from_state, to_state,
       from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
       department, location, actor_user_id, reason)
    VALUES
      (_journey_id, _patient_id, _visit, NULL, _to_state,
       NULL, _owner_role, NULL, _owner_user_id,
       _department, _location, _uid, _reason);
  ELSE
    _journey_id := _existing.id;
    UPDATE public.patient_journey SET
      visit_id      = COALESCE(_visit, visit_id),
      current_state = _to_state,
      owner_role    = _owner_role,
      owner_user_id = _owner_user_id,
      department    = _department,
      location      = _location,
      updated_at    = now()
    WHERE id = _journey_id;

    INSERT INTO public.patient_journey_history
      (journey_id, patient_id, visit_id, from_state, to_state,
       from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
       department, location, actor_user_id, reason)
    VALUES
      (_journey_id, _patient_id, COALESCE(_visit, _existing.visit_id),
       _existing.current_state, _to_state,
       _existing.owner_role, _owner_role,
       _existing.owner_user_id, _owner_user_id,
       _department, _location, _uid, _reason);
  END IF;

  -- Backward-compatibility: mirror to legacy patients.status when the value
  -- is a known legacy status. Silently ignore if the value doesn't fit the
  -- existing text column's usage (all statuses today are free-text so this
  -- always succeeds).
  BEGIN
    UPDATE public.patients
       SET status = _to_state, updated_at = now()
     WHERE id = _patient_id;
  EXCEPTION WHEN OTHERS THEN
    -- never let the mirror break the journey write
    NULL;
  END;

  RETURN _journey_id;
END;
$$;

-- 4. Backfill: seed a journey row for every existing patient.
INSERT INTO public.patient_journey (patient_id, current_state, owner_role, created_at, updated_at)
SELECT
  p.id,
  COALESCE(p.status, 'registered'),
  CASE p.status
    WHEN 'registered'         THEN 'receptionist'
    WHEN 'waiting'            THEN 'receptionist'
    WHEN 'with_nurse'         THEN 'nurse'
    WHEN 'with_doctor'        THEN 'doctor'
    WHEN 'in_lab'             THEN 'lab_tech'
    WHEN 'awaiting_billing'   THEN 'billing'
    WHEN 'awaiting_payment'   THEN 'cashier'
    WHEN 'at_pharmacy'        THEN 'pharmacist'
    WHEN 'admitted'           THEN 'nurse'
    WHEN 'awaiting_room'      THEN 'nurse'
    WHEN 'discharged'         THEN NULL
    ELSE NULL
  END,
  now(), now()
FROM public.patients p
ON CONFLICT (patient_id) DO NOTHING;

-- Seed history with the initial state
INSERT INTO public.patient_journey_history
  (journey_id, patient_id, from_state, to_state, to_owner_role, reason, created_at)
SELECT
  j.id, j.patient_id, NULL, j.current_state, j.owner_role, 'backfill', now()
FROM public.patient_journey j
WHERE NOT EXISTS (
  SELECT 1 FROM public.patient_journey_history h WHERE h.journey_id = j.id
);


-- ================================================================
-- 20260724092532_3156a092-5da1-49f1-868c-bba7f02786f8.sql
-- ================================================================

-- Phase 2: Unified Task Layer (view only, no table changes)
-- RLS on underlying tables is preserved because the view inherits it.

CREATE OR REPLACE VIEW public.v_tasks AS
-- Lab requests
SELECT
  ('lab_requests:' || lr.id::text)          AS task_id,
  'lab_requests'::text                       AS source,
  lr.id                                      AS source_id,
  lr.patient_id                              AS patient_id,
  lr.visit_id                                AS visit_id,
  'lab_tech'::text                           AS assigned_role,
  NULL::uuid                                 AS assigned_user_id,
  lr.status                                  AS status,
  0                                          AS priority,
  lr.created_at                              AS created_at,
  lr.updated_at                              AS updated_at,
  jsonb_build_object(
    'request_number', lr.request_number,
    'tests', lr.tests,
    'diagnosis', lr.diagnosis
  )                                          AS payload
FROM public.lab_requests lr

UNION ALL

-- Prescriptions
SELECT
  ('prescriptions:' || pr.id::text),
  'prescriptions',
  pr.id,
  pr.patient_id,
  pr.visit_id,
  'pharmacist',
  NULL::uuid,
  pr.status,
  0,
  pr.created_at,
  pr.updated_at,
  jsonb_build_object(
    'diagnosis', pr.diagnosis,
    'notes', pr.notes
  )
FROM public.prescriptions pr

UNION ALL

-- Admissions
SELECT
  ('admissions:' || a.id::text),
  'admissions',
  a.id,
  a.patient_id,
  a.visit_id,
  CASE a.status
    WHEN 'waiting_assignment'    THEN 'nurse'
    WHEN 'active'                THEN 'nurse'
    WHEN 'ready_for_discharge'   THEN 'nurse'
    ELSE NULL
  END,
  a.admitting_doctor,
  a.status,
  CASE a.status WHEN 'ready_for_discharge' THEN 10 ELSE 5 END,
  a.created_at,
  a.updated_at,
  jsonb_build_object(
    'reason', a.reason,
    'bed_id', a.bed_id,
    'admitted_at', a.admitted_at,
    'ready_for_discharge_at', a.ready_for_discharge_at
  )
FROM public.admissions a

UNION ALL

-- Snap orders
SELECT
  ('snap_orders:' || s.id::text),
  'snap_orders',
  s.id,
  s.patient_id,
  s.visit_id,
  CASE s.target_station
    WHEN 'pharmacy' THEN 'pharmacist'
    WHEN 'lab'      THEN 'lab_tech'
    WHEN 'nurse'    THEN 'nurse'
    WHEN 'billing'  THEN 'billing'
    ELSE s.target_station
  END,
  s.created_by,
  s.status,
  CASE WHEN s.is_admitted_snap THEN 8 ELSE 3 END,
  s.created_at,
  s.updated_at,
  jsonb_build_object(
    'order_type', s.order_type,
    'target_station', s.target_station,
    'source_role', s.source_role,
    'intent', s.intent,
    'note', s.note
  )
FROM public.snap_orders s

UNION ALL

-- Stock requests
SELECT
  ('stock_requests:' || sr.id::text),
  'stock_requests',
  sr.id,
  NULL::uuid,
  NULL::uuid,
  'store',
  NULL::uuid,
  sr.status,
  1,
  sr.created_at,
  sr.updated_at,
  jsonb_build_object(
    'item_name', sr.item_name,
    'item_id', sr.item_id,
    'quantity', sr.quantity,
    'requested_by', sr.requested_by
  )
FROM public.stock_requests sr;

GRANT SELECT ON public.v_tasks TO authenticated;
GRANT SELECT ON public.v_tasks TO service_role;


-- ================================================================
-- 20260724092541_eba2a9cc-863a-43cf-b53e-608466d3bd3a.sql
-- ================================================================
ALTER VIEW public.v_tasks SET (security_invoker = true);

-- ================================================================
-- 20260724092747_a56e4123-210b-4e6c-a46d-d7795ac29f34.sql
-- ================================================================
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'cashier';

-- ================================================================
-- 20260724093939_ef8cb9cb-a8da-4434-a833-d39e90b6a7ef.sql
-- ================================================================

-- 1. task_claims table
CREATE TABLE public.task_claims (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source text NOT NULL,
  source_id uuid NOT NULL,
  claimed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX task_claims_active_uniq
  ON public.task_claims (source, source_id)
  WHERE released_at IS NULL;

CREATE INDEX task_claims_by_user_active
  ON public.task_claims (claimed_by)
  WHERE released_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON public.task_claims TO authenticated;
GRANT ALL ON public.task_claims TO service_role;

ALTER TABLE public.task_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view all claims"
  ON public.task_claims FOR SELECT
  TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Staff can insert their own claim"
  ON public.task_claims FOR INSERT
  TO authenticated
  WITH CHECK (public.is_authenticated_staff() AND claimed_by = auth.uid());

CREATE POLICY "Owner or admin can update claim"
  ON public.task_claims FOR UPDATE
  TO authenticated
  USING (claimed_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (claimed_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER task_claims_touch_updated_at
  BEFORE UPDATE ON public.task_claims
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. Claim / release RPCs
CREATE OR REPLACE FUNCTION public.claim_task(_source text, _source_id uuid, _notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _existing RECORD;
  _new uuid;
BEGIN
  IF NOT public.is_authenticated_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _source IS NULL OR _source_id IS NULL THEN
    RAISE EXCEPTION 'source and source_id are required';
  END IF;

  SELECT * INTO _existing FROM public.task_claims
    WHERE source = _source AND source_id = _source_id AND released_at IS NULL
    FOR UPDATE;

  IF _existing.id IS NOT NULL THEN
    IF _existing.claimed_by = _uid THEN
      RETURN _existing.id; -- idempotent
    END IF;
    RAISE EXCEPTION 'TASK_ALREADY_CLAIMED: task is currently claimed by another user';
  END IF;

  INSERT INTO public.task_claims (source, source_id, claimed_by, notes)
  VALUES (_source, _source_id, _uid, _notes)
  RETURNING id INTO _new;

  PERFORM public.write_audit_log(
    'task_claimed', 'task', _source || ':' || _source_id::text,
    jsonb_build_object('source', _source, 'source_id', _source_id, 'notes', _notes)
  );
  RETURN _new;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_task(_source text, _source_id uuid, _notes text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _existing RECORD;
BEGIN
  IF NOT public.is_authenticated_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO _existing FROM public.task_claims
    WHERE source = _source AND source_id = _source_id AND released_at IS NULL
    FOR UPDATE;
  IF _existing.id IS NULL THEN RETURN false; END IF;

  IF _existing.claimed_by <> _uid
     AND NOT public.has_role(_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only the claimant or an admin can release this task';
  END IF;

  UPDATE public.task_claims
     SET released_at = now(),
         notes = COALESCE(_notes, notes),
         updated_at = now()
   WHERE id = _existing.id;

  PERFORM public.write_audit_log(
    'task_released', 'task', _source || ':' || _source_id::text,
    jsonb_build_object('source', _source, 'source_id', _source_id, 'notes', _notes)
  );
  RETURN true;
END;
$$;

-- 3. Rebuild v_tasks to expose the current claim
DROP VIEW IF EXISTS public.v_tasks;

CREATE VIEW public.v_tasks
WITH (security_invoker = true)
AS
WITH active_claims AS (
  SELECT source, source_id, claimed_by, claimed_at, id AS claim_id
  FROM public.task_claims
  WHERE released_at IS NULL
)
SELECT
  'lab_requests:'::text || lr.id::text AS task_id,
  'lab_requests'::text AS source,
  lr.id AS source_id,
  lr.patient_id,
  lr.visit_id,
  'lab_tech'::text AS assigned_role,
  ac.claimed_by AS assigned_user_id,
  lr.status,
  0 AS priority,
  lr.created_at,
  lr.updated_at,
  jsonb_build_object(
    'request_number', lr.request_number, 'tests', lr.tests, 'diagnosis', lr.diagnosis,
    'claimed', ac.claim_id IS NOT NULL,
    'claimed_by', ac.claimed_by,
    'claimed_at', ac.claimed_at
  ) AS payload
FROM public.lab_requests lr
LEFT JOIN active_claims ac
  ON ac.source = 'lab_requests' AND ac.source_id = lr.id

UNION ALL
SELECT
  'prescriptions:'::text || pr.id::text,
  'prescriptions', pr.id, pr.patient_id, pr.visit_id,
  'pharmacist', ac.claimed_by,
  pr.status, 0, pr.created_at, pr.updated_at,
  jsonb_build_object(
    'diagnosis', pr.diagnosis, 'notes', pr.notes,
    'claimed', ac.claim_id IS NOT NULL,
    'claimed_by', ac.claimed_by, 'claimed_at', ac.claimed_at
  )
FROM public.prescriptions pr
LEFT JOIN active_claims ac
  ON ac.source = 'prescriptions' AND ac.source_id = pr.id

UNION ALL
SELECT
  'admissions:'::text || a.id::text,
  'admissions', a.id, a.patient_id, a.visit_id,
  CASE a.status
    WHEN 'waiting_assignment' THEN 'nurse'
    WHEN 'active' THEN 'nurse'
    WHEN 'ready_for_discharge' THEN 'nurse'
    ELSE NULL
  END,
  COALESCE(ac.claimed_by, a.admitting_doctor),
  a.status,
  CASE a.status WHEN 'ready_for_discharge' THEN 10 ELSE 5 END,
  a.created_at, a.updated_at,
  jsonb_build_object(
    'reason', a.reason, 'bed_id', a.bed_id,
    'admitted_at', a.admitted_at, 'ready_for_discharge_at', a.ready_for_discharge_at,
    'claimed', ac.claim_id IS NOT NULL,
    'claimed_by', ac.claimed_by, 'claimed_at', ac.claimed_at
  )
FROM public.admissions a
LEFT JOIN active_claims ac
  ON ac.source = 'admissions' AND ac.source_id = a.id

UNION ALL
SELECT
  'snap_orders:'::text || s.id::text,
  'snap_orders', s.id, s.patient_id, s.visit_id,
  CASE s.target_station
    WHEN 'pharmacy' THEN 'pharmacist'
    WHEN 'lab' THEN 'lab_tech'
    WHEN 'nurse' THEN 'nurse'
    WHEN 'billing' THEN 'billing'
    ELSE s.target_station
  END,
  COALESCE(ac.claimed_by, s.created_by),
  s.status,
  CASE WHEN s.is_admitted_snap THEN 8 ELSE 3 END,
  s.created_at, s.updated_at,
  jsonb_build_object(
    'order_type', s.order_type, 'target_station', s.target_station,
    'source_role', s.source_role, 'intent', s.intent, 'note', s.note,
    'claimed', ac.claim_id IS NOT NULL,
    'claimed_by', ac.claimed_by, 'claimed_at', ac.claimed_at
  )
FROM public.snap_orders s
LEFT JOIN active_claims ac
  ON ac.source = 'snap_orders' AND ac.source_id = s.id

UNION ALL
SELECT
  'stock_requests:'::text || sr.id::text,
  'stock_requests', sr.id, NULL::uuid, NULL::uuid,
  'store', ac.claimed_by,
  sr.status, 1, sr.created_at, sr.updated_at,
  jsonb_build_object(
    'item_name', sr.item_name, 'item_id', sr.item_id,
    'quantity', sr.quantity, 'requested_by', sr.requested_by,
    'claimed', ac.claim_id IS NOT NULL,
    'claimed_by', ac.claimed_by, 'claimed_at', ac.claimed_at
  )
FROM public.stock_requests sr
LEFT JOIN active_claims ac
  ON ac.source = 'stock_requests' AND ac.source_id = sr.id;

GRANT SELECT ON public.v_tasks TO authenticated;
GRANT ALL ON public.v_tasks TO service_role;


-- ================================================================
-- 20260724100333_e76f6edd-f935-46d0-aa28-cbb0cf170188.sql
-- ================================================================
ALTER TABLE public.patients DROP CONSTRAINT IF EXISTS patients_account_type_check;
ALTER TABLE public.patients ADD CONSTRAINT patients_account_type_check
CHECK (account_type = ANY (ARRAY['normal','insurance','corporate','nhis','hmo','katchma','retainer','staff','staff_family']::text[]));

-- ================================================================
-- 20260724112106_19e58793-3c57-47d6-b2e0-6eef421433d6.sql
-- ================================================================
CREATE OR REPLACE FUNCTION public.patient_pending_workflow_station(_patient_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.target_station = 'lab'
        AND so.status IN ('pending_billing', 'awaiting_payment', 'paid')
    ) THEN 'in_lab'
    WHEN EXISTS (
      SELECT 1
      FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.target_station = 'pharmacy'
        AND so.status IN ('pending_billing', 'awaiting_payment', 'paid')
    ) THEN 'at_pharmacy'
    WHEN EXISTS (
      SELECT 1
      FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.status = 'pending_billing'
    ) THEN 'awaiting_billing'
    WHEN EXISTS (
      SELECT 1
      FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.status = 'awaiting_payment'
    ) THEN 'awaiting_payment'
    WHEN EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.patient_id = _patient_id
        AND i.status IN ('pending', 'partial')
    ) THEN 'awaiting_payment'
    ELSE NULL
  END;
$$;

GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.advance_journey(
  _patient_id uuid,
  _to_state text,
  _owner_role text DEFAULT NULL,
  _owner_user_id uuid DEFAULT NULL,
  _department text DEFAULT NULL,
  _location text DEFAULT NULL,
  _visit_id uuid DEFAULT NULL,
  _reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _existing public.patient_journey%ROWTYPE;
  _journey_id uuid;
  _visit uuid := _visit_id;
  _pending_station text;
BEGIN
  IF NOT public.is_authenticated_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _patient_id IS NULL OR _to_state IS NULL THEN
    RAISE EXCEPTION 'patient_id and to_state are required';
  END IF;

  IF _to_state = 'discharged' THEN
    _pending_station := public.patient_pending_workflow_station(_patient_id);
    IF _pending_station IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot discharge patient: pending workflow remains at %', _pending_station;
    END IF;
  END IF;

  IF _visit IS NULL THEN
    SELECT id INTO _visit FROM public.visits
     WHERE patient_id = _patient_id AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1;
  END IF;

  SELECT * INTO _existing FROM public.patient_journey
   WHERE patient_id = _patient_id FOR UPDATE;

  IF _existing.id IS NULL THEN
    INSERT INTO public.patient_journey
      (patient_id, visit_id, current_state, owner_role, owner_user_id, department, location)
    VALUES
      (_patient_id, _visit, _to_state, _owner_role, _owner_user_id, _department, _location)
    RETURNING id INTO _journey_id;

    INSERT INTO public.patient_journey_history
      (journey_id, patient_id, visit_id, from_state, to_state,
       from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
       department, location, actor_user_id, reason)
    VALUES
      (_journey_id, _patient_id, _visit, NULL, _to_state,
       NULL, _owner_role, NULL, _owner_user_id,
       _department, _location, _uid, _reason);
  ELSE
    _journey_id := _existing.id;
    UPDATE public.patient_journey SET
      visit_id      = COALESCE(_visit, visit_id),
      current_state = _to_state,
      owner_role    = _owner_role,
      owner_user_id = _owner_user_id,
      department    = _department,
      location      = _location,
      updated_at    = now()
    WHERE id = _journey_id;

    INSERT INTO public.patient_journey_history
      (journey_id, patient_id, visit_id, from_state, to_state,
       from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
       department, location, actor_user_id, reason)
    VALUES
      (_journey_id, _patient_id, COALESCE(_visit, _existing.visit_id),
       _existing.current_state, _to_state,
       _existing.owner_role, _owner_role,
       _existing.owner_user_id, _owner_user_id,
       _department, _location, _uid, _reason);
  END IF;

  BEGIN
    UPDATE public.patients
       SET status = _to_state, updated_at = now()
     WHERE id = _patient_id;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN _journey_id;
END;
$$;

-- ================================================================
-- 20260724112118_9e1f0c2e-2c3c-4a3b-a794-1b2aaf04b578.sql
-- ================================================================
REVOKE EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.advance_journey(uuid, text, text, uuid, text, text, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.advance_journey(uuid, text, text, uuid, text, text, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.advance_journey(uuid, text, text, uuid, text, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_journey(uuid, text, text, uuid, text, text, uuid, text) TO service_role;

-- ================================================================
-- 20260724112210_e02eb3ce-a536-4075-8a7b-5de9f994101a.sql
-- ================================================================
CREATE OR REPLACE FUNCTION public.patient_pending_workflow_station(_patient_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.status = 'pending_billing'
    ) THEN 'awaiting_billing'
    WHEN EXISTS (
      SELECT 1
      FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.status = 'awaiting_payment'
    ) THEN 'awaiting_payment'
    WHEN EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.patient_id = _patient_id
        AND i.status IN ('pending', 'partial')
    ) THEN 'awaiting_payment'
    WHEN EXISTS (
      SELECT 1
      FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.target_station = 'lab'
        AND so.status = 'paid'
    ) THEN 'in_lab'
    WHEN EXISTS (
      SELECT 1
      FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.target_station = 'pharmacy'
        AND so.status = 'paid'
    ) THEN 'at_pharmacy'
    ELSE NULL
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) TO service_role;

WITH routed AS (
  SELECT p.id AS patient_id, public.patient_pending_workflow_station(p.id) AS next_state
  FROM public.patients p
  WHERE p.status = 'discharged'
), repair AS (
  SELECT patient_id, next_state,
    CASE next_state
      WHEN 'awaiting_billing' THEN 'billing'
      WHEN 'awaiting_payment' THEN 'cashier'
      WHEN 'in_lab' THEN 'lab_tech'
      WHEN 'at_pharmacy' THEN 'pharmacist'
      ELSE NULL
    END AS owner_role
  FROM routed
  WHERE next_state IS NOT NULL
), patient_updates AS (
  UPDATE public.patients p
     SET status = r.next_state,
         updated_at = now()
    FROM repair r
   WHERE p.id = r.patient_id
   RETURNING p.id AS patient_id, r.next_state, r.owner_role
), journey_updates AS (
  UPDATE public.patient_journey j
     SET current_state = u.next_state,
         owner_role = u.owner_role,
         updated_at = now()
    FROM patient_updates u
   WHERE j.patient_id = u.patient_id
   RETURNING j.id AS journey_id, j.patient_id, u.next_state, u.owner_role
)
INSERT INTO public.patient_journey_history
  (journey_id, patient_id, from_state, to_state, to_owner_role, reason, created_at)
SELECT
  journey_id,
  patient_id,
  'discharged',
  next_state,
  owner_role,
  'repair_pending_workflow_after_payment',
  now()
FROM journey_updates;

-- ================================================================
-- 20260724114841_8f0499d5-9c01-44c0-9e73-593958e83ae7.sql
-- ================================================================

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT i.id, i.invoice_number, i.paid_amount, i.payment_method
    FROM invoices i JOIN patients p ON p.id=i.patient_id
    WHERE i.invoice_number IN ('INV-MRYSJHBG-EQRO','INV-MRYTKMKU-3NL2','INV-MRYTRICH-VO5O','INV-MRYU34VI-KZR1','INV-MRYVAZXF-0NZR')
      AND lower(coalesce(p.account_type,'')) NOT IN ('','normal','cash')
  LOOP
    UPDATE invoices
       SET paid_amount = 0,
           status = 'pending',
           payment_method = 'sponsor_claim',
           paid_at = NULL,
           notes = coalesce(notes,'') || ' | reconciled: sponsor 100% cover, wallet not applicable'
     WHERE id = r.id;

    INSERT INTO audit_logs(action, resource_type, resource_id, details, status, actor_role)
    VALUES ('invoice_reconciled_to_sponsor','invoice', r.id::text,
            jsonb_build_object('invoice_number', r.invoice_number,
                               'previous_paid_amount', r.paid_amount,
                               'previous_payment_method', r.payment_method,
                               'reason','legacy HMO invoice wrongly recorded as patient payment'),
            'success','system');
  END LOOP;
END $$;


-- ================================================================
-- 20260724121856_598bf546-27e9-47a4-99cc-90f532e50b5f.sql
-- ================================================================

ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS claim_status text NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS claim_settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_settled_by uuid,
  ADD COLUMN IF NOT EXISTS claim_notes text;

-- Backfill: insured sponsored visits that are already settled become "pending claim"
UPDATE public.visits
   SET claim_status = 'pending'
 WHERE status = 'settled'
   AND sponsor_type IN ('nhia','hmo','katchma','staff','staff_family')
   AND claim_status = 'not_applicable';

-- Corporate/retainer are handled by the accountant module — leave 'not_applicable'.

CREATE INDEX IF NOT EXISTS idx_visits_claim_status ON public.visits(claim_status);

-- Only claims_manager / admin can set claim_status
CREATE OR REPLACE FUNCTION public.mark_claim_settled(_visit_id uuid, _notes text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _v RECORD;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['claims_manager','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only claims manager or admin can settle claims';
  END IF;
  SELECT * INTO _v FROM public.visits WHERE id = _visit_id FOR UPDATE;
  IF _v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF _v.claim_status <> 'pending' THEN
    RAISE EXCEPTION 'Claim is not pending (current: %)', _v.claim_status;
  END IF;

  UPDATE public.visits
     SET claim_status = 'settled',
         claim_settled_at = now(),
         claim_settled_by = auth.uid(),
         claim_notes = COALESCE(_notes, claim_notes),
         updated_at = now()
   WHERE id = _visit_id;

  PERFORM public.write_audit_log(
    'claim_settled', 'visit', _visit_id::text,
    jsonb_build_object(
      'visit_number', _v.visit_number,
      'patient_id', _v.patient_id,
      'sponsor_type', _v.sponsor_type,
      'insurance_plan', _v.insurance_plan,
      'total_charged', _v.total_charged,
      'notes', _notes
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_claim(_visit_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admin can reopen a settled claim';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  UPDATE public.visits
     SET claim_status = 'pending',
         claim_settled_at = NULL,
         claim_settled_by = NULL,
         claim_notes = COALESCE(claim_notes,'') || E'\n[reopened] ' || _reason,
         updated_at = now()
   WHERE id = _visit_id AND claim_status = 'settled';
  PERFORM public.write_audit_log(
    'claim_reopened', 'visit', _visit_id::text,
    jsonb_build_object('reason', _reason)
  );
END;
$$;


-- ================================================================
-- 20260724122530_16461ee3-c7ab-410f-8244-d41708978487.sql
-- ================================================================
-- Extend claim workflow with rejected + info_requested states
ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS claim_reason_code text,
  ADD COLUMN IF NOT EXISTS claim_reason_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS claim_last_action_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_last_action_by uuid;

-- Widen the claim_status check constraint if one exists; otherwise add one.
DO $$
DECLARE _con text;
BEGIN
  SELECT conname INTO _con
    FROM pg_constraint
   WHERE conrelid = 'public.visits'::regclass
     AND contype  = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%claim_status%';
  IF _con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.visits DROP CONSTRAINT %I', _con);
  END IF;
  ALTER TABLE public.visits
    ADD CONSTRAINT visits_claim_status_check
    CHECK (claim_status IN ('not_applicable','pending','settled','rejected','info_requested'));
END $$;

CREATE INDEX IF NOT EXISTS idx_visits_claim_reason_code ON public.visits(claim_reason_code);

-- Mark a claim as rejected
CREATE OR REPLACE FUNCTION public.mark_claim_rejected(
  _visit_id uuid,
  _reason_code text,
  _notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _v RECORD;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['claims_manager','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only claims manager or admin can reject claims';
  END IF;
  IF _reason_code IS NULL OR length(trim(_reason_code)) = 0 THEN
    RAISE EXCEPTION 'A reason code is required';
  END IF;
  SELECT * INTO _v FROM public.visits WHERE id = _visit_id FOR UPDATE;
  IF _v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF _v.claim_status NOT IN ('pending','info_requested') THEN
    RAISE EXCEPTION 'Claim cannot be rejected from status: %', _v.claim_status;
  END IF;

  UPDATE public.visits
     SET claim_status = 'rejected',
         claim_reason_code = _reason_code,
         claim_notes = COALESCE(claim_notes,'') ||
                       CASE WHEN claim_notes IS NULL OR claim_notes = '' THEN '' ELSE E'\n' END ||
                       '[rejected:' || _reason_code || '] ' || COALESCE(_notes,''),
         claim_last_action_at = now(),
         claim_last_action_by = auth.uid(),
         updated_at = now()
   WHERE id = _visit_id;

  PERFORM public.write_audit_log(
    'claim_rejected', 'visit', _visit_id::text,
    jsonb_build_object(
      'visit_number', _v.visit_number,
      'patient_id', _v.patient_id,
      'sponsor_type', _v.sponsor_type,
      'insurance_plan', _v.insurance_plan,
      'total_charged', _v.total_charged,
      'reason_code', _reason_code,
      'notes', _notes
    )
  );
END;
$$;

-- Request more information from the patient/scheme for a claim
CREATE OR REPLACE FUNCTION public.request_claim_info(
  _visit_id uuid,
  _reason_code text,
  _notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _v RECORD;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['claims_manager','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only claims manager or admin can request more info';
  END IF;
  IF _reason_code IS NULL OR length(trim(_reason_code)) = 0 THEN
    RAISE EXCEPTION 'A reason code is required';
  END IF;
  SELECT * INTO _v FROM public.visits WHERE id = _visit_id FOR UPDATE;
  IF _v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF _v.claim_status NOT IN ('pending','info_requested') THEN
    RAISE EXCEPTION 'Cannot request info from status: %', _v.claim_status;
  END IF;

  UPDATE public.visits
     SET claim_status = 'info_requested',
         claim_reason_code = _reason_code,
         claim_notes = COALESCE(claim_notes,'') ||
                       CASE WHEN claim_notes IS NULL OR claim_notes = '' THEN '' ELSE E'\n' END ||
                       '[info_requested:' || _reason_code || '] ' || COALESCE(_notes,''),
         claim_last_action_at = now(),
         claim_last_action_by = auth.uid(),
         updated_at = now()
   WHERE id = _visit_id;

  PERFORM public.write_audit_log(
    'claim_info_requested', 'visit', _visit_id::text,
    jsonb_build_object(
      'visit_number', _v.visit_number,
      'patient_id', _v.patient_id,
      'sponsor_type', _v.sponsor_type,
      'insurance_plan', _v.insurance_plan,
      'reason_code', _reason_code,
      'notes', _notes
    )
  );
END;
$$;

-- Allow reopening from rejected / info_requested too
CREATE OR REPLACE FUNCTION public.reopen_claim(_visit_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _v RECORD;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['claims_manager','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only claims manager or admin can reopen a claim';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  SELECT * INTO _v FROM public.visits WHERE id = _visit_id FOR UPDATE;
  IF _v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF _v.claim_status NOT IN ('settled','rejected','info_requested') THEN
    RAISE EXCEPTION 'Claim is not in a reopenable state (current: %)', _v.claim_status;
  END IF;

  UPDATE public.visits
     SET claim_status = 'pending',
         claim_settled_at = NULL,
         claim_settled_by = NULL,
         claim_reason_code = NULL,
         claim_notes = COALESCE(claim_notes,'') || E'\n[reopened] ' || _reason,
         claim_last_action_at = now(),
         claim_last_action_by = auth.uid(),
         updated_at = now()
   WHERE id = _visit_id;

  PERFORM public.write_audit_log(
    'claim_reopened', 'visit', _visit_id::text,
    jsonb_build_object('reason', _reason, 'from_status', _v.claim_status)
  );
END;
$$;

-- ================================================================
-- 20260724141846_5e6728ee-d8f9-4de3-9d87-a1cc907d587b.sql
-- ================================================================
-- Fix: after splitting 'doctor' into 'doctor1' and 'doctor2', RLS policies still only allow 'doctor'.
-- Update policies on prescriptions, prescription_items, and lab_requests to include doctor1/doctor2.
-- Also allow cashier role to settle visits (close_visit).

-- prescriptions
DROP POLICY IF EXISTS "Doctors can insert prescriptions" ON public.prescriptions;
DROP POLICY IF EXISTS "Doctors and pharmacists can update prescriptions" ON public.prescriptions;
DROP POLICY IF EXISTS "Doctors and admins can delete prescriptions" ON public.prescriptions;

CREATE POLICY "Doctors can insert prescriptions" ON public.prescriptions
  FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','admin']::app_role[]));

CREATE POLICY "Doctors and pharmacists can update prescriptions" ON public.prescriptions
  FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','pharmacist','admin']::app_role[]));

CREATE POLICY "Doctors and admins can delete prescriptions" ON public.prescriptions
  FOR DELETE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','admin']::app_role[]));

-- prescription_items
DROP POLICY IF EXISTS "Doctors can insert prescription_items" ON public.prescription_items;
DROP POLICY IF EXISTS "Doctors and pharmacists can update prescription_items" ON public.prescription_items;
DROP POLICY IF EXISTS "Clinical staff can delete prescription items" ON public.prescription_items;

CREATE POLICY "Doctors can insert prescription_items" ON public.prescription_items
  FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','admin']::app_role[]));

CREATE POLICY "Doctors and pharmacists can update prescription_items" ON public.prescription_items
  FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','pharmacist','admin']::app_role[]));

CREATE POLICY "Clinical staff can delete prescription items" ON public.prescription_items
  FOR DELETE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','pharmacist','admin']::app_role[]));

-- lab_requests
DROP POLICY IF EXISTS "Doctors and lab_tech can insert lab_requests" ON public.lab_requests;
DROP POLICY IF EXISTS "Doctors and lab_tech can update lab_requests" ON public.lab_requests;
DROP POLICY IF EXISTS "Lab techs and admins can delete lab requests" ON public.lab_requests;

CREATE POLICY "Doctors and lab_tech can insert lab_requests" ON public.lab_requests
  FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','lab_tech','admin']::app_role[]));

CREATE POLICY "Doctors and lab_tech can update lab_requests" ON public.lab_requests
  FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','lab_tech','admin']::app_role[]));

CREATE POLICY "Lab techs and admins can delete lab requests" ON public.lab_requests
  FOR DELETE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['lab_tech','admin']::app_role[]));

-- close_visit: allow cashier as well
CREATE OR REPLACE FUNCTION public.close_visit(_visit_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _v RECORD;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['billing','cashier','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only billing/cashier/admin can settle a visit';
  END IF;
  PERFORM public.recalc_visit_totals(_visit_id);
  SELECT * INTO _v FROM public.visits WHERE id = _visit_id;
  IF _v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF _v.status <> 'open' THEN RAISE EXCEPTION 'Visit is already %', _v.status; END IF;

  UPDATE public.visits
    SET status = 'settled', closed_at = now(), closed_by = auth.uid(), updated_at = now()
  WHERE id = _visit_id;

  PERFORM public.write_audit_log(
    'visit_settled', 'visit', _visit_id::text,
    jsonb_build_object(
      'visit_number', _v.visit_number,
      'patient_id', _v.patient_id,
      'sponsor_type', _v.sponsor_type,
      'total_charged', _v.total_charged,
      'total_paid', _v.total_paid
    )
  );
END; $function$;

-- ================================================================
-- 20260724141946_d04999dd-b8b9-4428-9b37-c5115603b007.sql
-- ================================================================
CREATE OR REPLACE FUNCTION public.close_visit(_visit_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _v RECORD; _new_claim text;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['billing','cashier','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only billing/cashier/admin can settle a visit';
  END IF;
  PERFORM public.recalc_visit_totals(_visit_id);
  SELECT * INTO _v FROM public.visits WHERE id = _visit_id;
  IF _v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF _v.status <> 'open' THEN RAISE EXCEPTION 'Visit is already %', _v.status; END IF;

  -- Auto-flip claim_status to 'pending' for sponsored/insured visits with charges.
  _new_claim := _v.claim_status;
  IF _v.claim_status = 'not_applicable'
     AND COALESCE(_v.total_charged, 0) > 0
     AND _v.sponsor_type IS NOT NULL
     AND lower(_v.sponsor_type) IN ('katchma','nhis','nhia','hmo','corporate','retainer','staff')
  THEN
    _new_claim := 'pending';
  END IF;

  UPDATE public.visits
    SET status = 'settled',
        closed_at = now(),
        closed_by = auth.uid(),
        claim_status = _new_claim,
        claim_last_action_at = CASE WHEN _new_claim <> _v.claim_status THEN now() ELSE claim_last_action_at END,
        claim_last_action_by = CASE WHEN _new_claim <> _v.claim_status THEN auth.uid() ELSE claim_last_action_by END,
        updated_at = now()
  WHERE id = _visit_id;

  PERFORM public.write_audit_log(
    'visit_settled', 'visit', _visit_id::text,
    jsonb_build_object(
      'visit_number', _v.visit_number,
      'patient_id', _v.patient_id,
      'sponsor_type', _v.sponsor_type,
      'total_charged', _v.total_charged,
      'total_paid', _v.total_paid,
      'claim_status', _new_claim
    )
  );
END; $function$;

-- ================================================================
-- 20260724150157_15f9a144-77ae-4962-b3d4-145176d58549.sql
-- ================================================================

-- 1) Cascade visit cancellation to unpaid invoices
CREATE OR REPLACE FUNCTION public.cancel_visit_invoices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'cancelled'::visit_status AND OLD.status IS DISTINCT FROM 'cancelled'::visit_status THEN
    UPDATE public.invoices
       SET status = 'cancelled',
           notes  = COALESCE(notes,'') ||
                    CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\n' END ||
                    '[auto] visit ' || NEW.visit_number || ' was cancelled',
           updated_at = now()
     WHERE visit_id = NEW.id
       AND status IN ('pending','partial');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_visit_invoices ON public.visits;
CREATE TRIGGER trg_cancel_visit_invoices
AFTER UPDATE OF status ON public.visits
FOR EACH ROW EXECUTE FUNCTION public.cancel_visit_invoices();

-- Retroactively cancel unpaid invoices attached to already-cancelled visits
UPDATE public.invoices i
   SET status = 'cancelled',
       updated_at = now(),
       notes = COALESCE(i.notes,'') ||
               CASE WHEN COALESCE(i.notes,'') = '' THEN '' ELSE E'\n' END ||
               '[auto backfill] visit ' || v.visit_number || ' cancelled'
  FROM public.visits v
 WHERE i.visit_id = v.id
   AND v.status = 'cancelled'
   AND i.status IN ('pending','partial');

-- 2) Backfill sponsor tags on existing invoices from the patient record
UPDATE public.invoices i
   SET sponsor_type = CASE
         WHEN lower(coalesce(p.account_type,'')) = 'corporate' THEN 'corporate'
         WHEN lower(coalesce(p.account_type,'')) = 'retainer'  THEN 'retainer'
         WHEN lower(coalesce(p.account_type,'')) = 'insurance' THEN 'insurance'
         WHEN lower(coalesce(p.account_type,'')) IN ('hmo','katchma','nhia','nhis','staff')
              THEN lower(p.account_type)
         ELSE NULL
       END,
       corporate_account_id = CASE
         WHEN lower(coalesce(p.account_type,'')) IN ('corporate','retainer')
              THEN p.corporate_id
         ELSE i.corporate_account_id
       END,
       updated_at = now()
  FROM public.patients p
 WHERE i.patient_id = p.id
   AND i.sponsor_type IS NULL;

-- 3) Fix Umar Sanusi's stuck visit + journey
DO $$
DECLARE
  v_visit uuid;
  v_pid   uuid := '86d012e8-a2a6-43c3-ac12-095027db6d1f';
BEGIN
  SELECT id INTO v_visit
    FROM public.visits
   WHERE patient_id = v_pid AND status = 'open'
   ORDER BY opened_at DESC LIMIT 1;

  IF v_visit IS NOT NULL THEN
    UPDATE public.visits
       SET status = 'settled',
           closed_at = now(),
           claim_status = CASE
             WHEN COALESCE(total_charged,0) > 0 AND sponsor_type IS NOT NULL
                  AND lower(sponsor_type) IN ('katchma','nhis','nhia','hmo','corporate','retainer','staff','insurance')
               THEN 'pending'
             ELSE claim_status
           END,
           claim_last_action_at = now(),
           updated_at = now()
     WHERE id = v_visit;
  END IF;

  UPDATE public.patient_journey
     SET current_state = 'discharged',
         owner_role    = NULL,
         owner_user_id = NULL,
         department    = NULL,
         location      = NULL,
         updated_at    = now()
   WHERE patient_id = v_pid;

  INSERT INTO public.patient_journey_history
    (journey_id, patient_id, visit_id, from_state, to_state,
     from_owner_role, to_owner_role, reason)
  SELECT id, patient_id, visit_id, 'at_pharmacy', 'discharged',
         'pharmacist', NULL, 'manual fix: pharmacy snap fulfilled, invoice paid'
    FROM public.patient_journey WHERE patient_id = v_pid;

  UPDATE public.patients SET status = 'discharged', updated_at = now() WHERE id = v_pid;
END $$;


-- ================================================================
-- 20260724163918_6bbdbea5-5e8f-46b8-bd47-16db19619de3.sql
-- ================================================================
ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS sponsor_auth jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sponsor_auth_captured_at timestamptz;

ALTER TABLE public.insurance_providers
  ADD COLUMN IF NOT EXISTS hmo_code text;

CREATE INDEX IF NOT EXISTS idx_insurance_providers_hmo_code
  ON public.insurance_providers (hmo_code) WHERE hmo_code IS NOT NULL;

-- ================================================================
-- 20260724175033_def68729-97a2-4e4b-915f-3f123d225d20.sql
-- ================================================================
CREATE TABLE public.eligibility_verifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  sponsor_type text NOT NULL CHECK (sponsor_type IN ('nhis','hmo','katchma','corporate','retainer')),
  provider_id uuid REFERENCES public.insurance_providers(id) ON DELETE SET NULL,
  provider_name text,
  enrollee_id text,
  plan text,
  encounter_code text,
  encounter_code_captured_at timestamp with time zone,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  rejection_reason text,
  notes text,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_eligibility_status ON public.eligibility_verifications(status, created_at DESC);
CREATE INDEX idx_eligibility_patient ON public.eligibility_verifications(patient_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.eligibility_verifications TO authenticated;
GRANT ALL ON public.eligibility_verifications TO service_role;

ALTER TABLE public.eligibility_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_view_eligibility"
  ON public.eligibility_verifications FOR SELECT
  TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "staff_create_eligibility"
  ON public.eligibility_verifications FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['receptionist','claims_manager','admin']::app_role[])
  );

CREATE POLICY "claims_manager_update_eligibility"
  ON public.eligibility_verifications FOR UPDATE
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['claims_manager','admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['claims_manager','admin']::app_role[]));

CREATE TRIGGER eligibility_touch_updated_at
  BEFORE UPDATE ON public.eligibility_verifications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ================================================================
-- 20260724192155_02cff5d0-6aa9-4a05-bb5d-324afcb0370c.sql
-- ================================================================
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

-- ================================================================
-- 20260724192306_83a01201-7e0f-45df-9f5a-f91dae2e2324.sql
-- ================================================================
CREATE POLICY "Uploader or admin update EMR attachments"
ON public.emr_attachments
FOR UPDATE
USING ((uploaded_by = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))
WITH CHECK ((uploaded_by = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admin delete insurance_claims"
ON public.insurance_claims
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- ================================================================
-- 20260724192855_8a4c51b1-58b2-4f08-a9f8-9ab6027bba9c.sql
-- ================================================================
CREATE OR REPLACE FUNCTION public.close_visit(_visit_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _v RECORD; _new_claim text;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['billing','cashier','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only billing/cashier/admin can settle a visit';
  END IF;
  PERFORM public.recalc_visit_totals(_visit_id);
  SELECT * INTO _v FROM public.visits WHERE id = _visit_id;
  IF _v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF _v.status <> 'open' THEN RAISE EXCEPTION 'Visit is already %', _v.status; END IF;

  -- Auto-flip claim_status to 'pending' only for external insurance schemes
  -- (NHIA, HMO, Katchma) and corporate/retainer sponsors that need reconciliation.
  -- Staff (fully free) and staff_family (50% payroll deduction) are NOT claims.
  _new_claim := _v.claim_status;
  IF _v.claim_status = 'not_applicable'
     AND COALESCE(_v.total_charged, 0) > 0
     AND _v.sponsor_type IS NOT NULL
     AND lower(_v.sponsor_type) IN ('katchma','nhis','nhia','hmo','corporate','retainer')
  THEN
    _new_claim := 'pending';
  END IF;

  UPDATE public.visits
    SET status = 'settled',
        closed_at = now(),
        closed_by = auth.uid(),
        claim_status = _new_claim,
        claim_last_action_at = CASE WHEN _new_claim <> _v.claim_status THEN now() ELSE claim_last_action_at END,
        claim_last_action_by = CASE WHEN _new_claim <> _v.claim_status THEN auth.uid() ELSE claim_last_action_by END,
        updated_at = now()
  WHERE id = _visit_id;

  PERFORM public.write_audit_log(
    'visit_settled', 'visit', _visit_id::text,
    jsonb_build_object(
      'visit_number', _v.visit_number,
      'patient_id', _v.patient_id,
      'sponsor_type', _v.sponsor_type,
      'total_charged', _v.total_charged,
      'total_paid', _v.total_paid,
      'claim_status', _new_claim
    )
  );
END; $function$;

-- ================================================================
-- 20260725081309_ca59b024-ed7b-47b4-955e-67eed5b89b9f.sql
-- ================================================================
DROP TRIGGER IF EXISTS trg_queue_family_deduction ON public.invoices;
DROP FUNCTION IF EXISTS public.queue_family_deduction_after_invoice() CASCADE;

-- ================================================================
-- 20260725092837_b24f9fd5-2d0e-46e6-b692-67a762e2a8bc.sql
-- ================================================================

ALTER TABLE public.eligibility_verifications
  ALTER COLUMN patient_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS prospective_patient_name text,
  ADD COLUMN IF NOT EXISTS prospective_patient_phone text,
  ADD COLUMN IF NOT EXISTS insurance_details text,
  ADD COLUMN IF NOT EXISTS reception_snap_path text,
  ADD COLUMN IF NOT EXISTS verification_snap_path text,
  ADD COLUMN IF NOT EXISTS verified_enrollee_id text,
  ADD COLUMN IF NOT EXISTS verified_plan text,
  ADD COLUMN IF NOT EXISTS verified_provider_name text,
  ADD COLUMN IF NOT EXISTS consumed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS consumed_patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL;

-- Ensure at least a patient_id OR a prospective name is present
ALTER TABLE public.eligibility_verifications
  DROP CONSTRAINT IF EXISTS eligibility_has_subject;
ALTER TABLE public.eligibility_verifications
  ADD CONSTRAINT eligibility_has_subject
  CHECK (patient_id IS NOT NULL OR (prospective_patient_name IS NOT NULL AND length(trim(prospective_patient_name)) > 0));


-- ================================================================
-- 20260725093622_eabcdd6c-d383-43f7-a3b7-fe0b706bbd79.sql
-- ================================================================

ALTER TABLE public.insurance_providers
  ADD COLUMN IF NOT EXISTS member_id_fields JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS member_id_data JSONB;

ALTER TABLE public.eligibility_verifications
  ADD COLUMN IF NOT EXISTS member_id_data JSONB;

-- Seed common templates only for existing providers with empty templates
UPDATE public.insurance_providers
   SET member_id_fields = '[
     {"key":"enrollee_id","label":"NHIA Enrollee Number","required":true,"pattern":"","placeholder":"e.g. NHIA/2024/12345","primary":true},
     {"key":"dependant_id","label":"Dependant ID","required":false,"placeholder":"If dependant"},
     {"key":"plan_tier","label":"Plan Tier","required":false,"placeholder":"e.g. Formal Sector"}
   ]'::jsonb
 WHERE (member_id_fields IS NULL OR member_id_fields = '[]'::jsonb)
   AND (lower(name) LIKE '%nhia%' OR lower(name) LIKE '%nhis%');

UPDATE public.insurance_providers
   SET member_id_fields = '[
     {"key":"call_up_number","label":"Call-up Number","required":true,"placeholder":"e.g. NYSC/2024/1234","primary":true},
     {"key":"state_code","label":"State Code","required":true,"placeholder":"e.g. LA/23A/1234"},
     {"key":"batch","label":"Batch","required":false,"placeholder":"e.g. 2024 Batch A"}
   ]'::jsonb
 WHERE (member_id_fields IS NULL OR member_id_fields = '[]'::jsonb)
   AND lower(name) LIKE '%nysc%';

UPDATE public.insurance_providers
   SET member_id_fields = '[
     {"key":"enrollee_id","label":"Hygeia Enrollee ID","required":true,"primary":true},
     {"key":"pre_auth_token","label":"Pre-Auth / Token Number","required":false,"placeholder":"e.g. HYG-PA-778821"},
     {"key":"plan","label":"Plan","required":false}
   ]'::jsonb
 WHERE (member_id_fields IS NULL OR member_id_fields = '[]'::jsonb)
   AND lower(name) LIKE '%hygeia%';

UPDATE public.insurance_providers
   SET member_id_fields = '[
     {"key":"enrollee_id","label":"AXA Enrollee ID","required":true,"primary":true},
     {"key":"encounter_code","label":"Encounter Code / OTP","required":true,"placeholder":"e.g. AXA-OTP-8493021"},
     {"key":"plan","label":"Plan","required":false}
   ]'::jsonb
 WHERE (member_id_fields IS NULL OR member_id_fields = '[]'::jsonb)
   AND (lower(name) LIKE '%axa%' OR lower(name) LIKE '%mansard%');

UPDATE public.insurance_providers
   SET member_id_fields = '[
     {"key":"katchma_id","label":"KATCHMA ID","required":true,"primary":true},
     {"key":"plan","label":"Plan","required":false}
   ]'::jsonb
 WHERE (member_id_fields IS NULL OR member_id_fields = '[]'::jsonb)
   AND lower(name) LIKE '%katchma%';


-- ================================================================
-- 20260725110238_38028320-8fa4-45cc-b512-82bf95034217.sql
-- ================================================================

ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS photo_path text;

-- Storage policies for patient-photos bucket (staff-only)
CREATE POLICY "patient_photos_select_staff"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'patient-photos' AND public.is_authenticated_staff());

CREATE POLICY "patient_photos_insert_staff"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'patient-photos' AND public.is_authenticated_staff());

CREATE POLICY "patient_photos_update_staff"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'patient-photos' AND public.is_authenticated_staff())
  WITH CHECK (bucket_id = 'patient-photos' AND public.is_authenticated_staff());

CREATE POLICY "patient_photos_delete_staff"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'patient-photos' AND public.is_authenticated_staff());


-- ================================================================
-- 20260725113335_3fbf08c6-945a-4e5a-97a5-832d72b94af5.sql
-- ================================================================
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.patients; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.balance_requests; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.balance_transactions; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.vitals; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
ALTER TABLE public.patients REPLICA IDENTITY FULL;
ALTER TABLE public.balance_requests REPLICA IDENTITY FULL;

-- ================================================================
-- 20260725114843_e8b13480-40d9-41a1-84b6-e95f9802c58b.sql
-- ================================================================
CREATE OR REPLACE FUNCTION public.advance_journey(_patient_id uuid, _to_state text, _owner_role text DEFAULT NULL::text, _owner_user_id uuid DEFAULT NULL::uuid, _department text DEFAULT NULL::text, _location text DEFAULT NULL::text, _visit_id uuid DEFAULT NULL::uuid, _reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _existing public.patient_journey%ROWTYPE;
  _journey_id uuid;
  _visit uuid := _visit_id;
  _pending_station text;
  _open_visit RECORD;
BEGIN
  IF NOT public.is_authenticated_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _patient_id IS NULL OR _to_state IS NULL THEN
    RAISE EXCEPTION 'patient_id and to_state are required';
  END IF;

  IF _to_state = 'discharged' THEN
    _pending_station := public.patient_pending_workflow_station(_patient_id);
    IF _pending_station IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot discharge patient: pending workflow remains at %', _pending_station;
    END IF;

    -- NEW: refuse discharge while an open visit exists. The visit MUST be
    -- closed via Billing → Settle & Discharge (close_visit) so that insured
    -- visits auto-flip claim_status=pending and land in the Claims queue.
    SELECT id, visit_number, total_charged, total_paid
      INTO _open_visit
      FROM public.visits
     WHERE patient_id = _patient_id
       AND status = 'open'
     ORDER BY opened_at DESC
     LIMIT 1;
    IF _open_visit.id IS NOT NULL THEN
      RAISE EXCEPTION 'OPEN_VISIT: cannot discharge — visit % is still open. Settle it via Billing → Settle & Discharge first.', _open_visit.visit_number;
    END IF;
  END IF;

  IF _visit IS NULL THEN
    SELECT id INTO _visit FROM public.visits
     WHERE patient_id = _patient_id AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1;
  END IF;

  SELECT * INTO _existing FROM public.patient_journey
   WHERE patient_id = _patient_id FOR UPDATE;

  IF _existing.id IS NULL THEN
    INSERT INTO public.patient_journey
      (patient_id, visit_id, current_state, owner_role, owner_user_id, department, location)
    VALUES
      (_patient_id, _visit, _to_state, _owner_role, _owner_user_id, _department, _location)
    RETURNING id INTO _journey_id;

    INSERT INTO public.patient_journey_history
      (journey_id, patient_id, visit_id, from_state, to_state,
       from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
       department, location, actor_user_id, reason)
    VALUES
      (_journey_id, _patient_id, _visit, NULL, _to_state,
       NULL, _owner_role, NULL, _owner_user_id,
       _department, _location, _uid, _reason);
  ELSE
    _journey_id := _existing.id;
    UPDATE public.patient_journey SET
      visit_id      = COALESCE(_visit, visit_id),
      current_state = _to_state,
      owner_role    = _owner_role,
      owner_user_id = _owner_user_id,
      department    = _department,
      location      = _location,
      updated_at    = now()
    WHERE id = _journey_id;

    INSERT INTO public.patient_journey_history
      (journey_id, patient_id, visit_id, from_state, to_state,
       from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
       department, location, actor_user_id, reason)
    VALUES
      (_journey_id, _patient_id, COALESCE(_visit, _existing.visit_id),
       _existing.current_state, _to_state,
       _existing.owner_role, _owner_role,
       _existing.owner_user_id, _owner_user_id,
       _department, _location, _uid, _reason);
  END IF;

  BEGIN
    UPDATE public.patients
       SET status = _to_state, updated_at = now()
     WHERE id = _patient_id;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN _journey_id;
END;
$function$;

-- ================================================================
-- 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql
-- ================================================================
-- Sequences (start at 1; tables are currently empty)
CREATE SEQUENCE IF NOT EXISTS public.patients_card_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.visits_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.invoices_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.lab_requests_number_seq START 1;

-- Helper: PREFIX-### with growth beyond 999
CREATE OR REPLACE FUNCTION public.simple_id(_prefix text, _n bigint)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$ SELECT _prefix || '-' || lpad(_n::text, 3, '0'); $$;

-- Rewrite next_visit_number to simple format
CREATE OR REPLACE FUNCTION public.next_visit_number()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT public.simple_id('V', nextval('public.visits_number_seq')); $$;

-- Patients: fill card_number + mini_card_number if blank
CREATE OR REPLACE FUNCTION public.autofill_patient_card_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _n bigint; _num text;
BEGIN
  IF NEW.card_number IS NULL OR length(trim(NEW.card_number)) = 0 THEN
    _n := nextval('public.patients_card_seq');
    NEW.card_number := public.simple_id('P', _n);
    IF NEW.mini_card_number IS NULL OR length(trim(NEW.mini_card_number)) = 0 THEN
      NEW.mini_card_number := lpad(_n::text, 3, '0');
    END IF;
  ELSIF NEW.mini_card_number IS NULL OR length(trim(NEW.mini_card_number)) = 0 THEN
    NEW.mini_card_number := split_part(NEW.card_number, '-', 2);
    IF NEW.mini_card_number IS NULL OR length(NEW.mini_card_number) = 0 THEN
      NEW.mini_card_number := NEW.card_number;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS patients_autofill_card_number ON public.patients;
CREATE TRIGGER patients_autofill_card_number
BEFORE INSERT ON public.patients
FOR EACH ROW EXECUTE FUNCTION public.autofill_patient_card_number();

-- Invoices: fill invoice_number if blank
CREATE OR REPLACE FUNCTION public.autofill_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.invoice_number IS NULL OR length(trim(NEW.invoice_number)) = 0 THEN
    NEW.invoice_number := public.simple_id('INV', nextval('public.invoices_number_seq'));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS invoices_autofill_number ON public.invoices;
CREATE TRIGGER invoices_autofill_number
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.autofill_invoice_number();

-- Lab requests: fill request_number if blank
CREATE OR REPLACE FUNCTION public.autofill_lab_request_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.request_number IS NULL OR length(trim(NEW.request_number)) = 0 THEN
    NEW.request_number := public.simple_id('LAB', nextval('public.lab_requests_number_seq'));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS lab_requests_autofill_number ON public.lab_requests;
CREATE TRIGGER lab_requests_autofill_number
BEFORE INSERT ON public.lab_requests
FOR EACH ROW EXECUTE FUNCTION public.autofill_lab_request_number();

-- ================================================================
-- 20260725174145_83d0fef0-77af-4387-b998-b96cea14b4e5.sql
-- ================================================================

-- Make contact_person and email optional (retainers only need name/phone/address)
ALTER TABLE public.corporate_accounts ALTER COLUMN contact_person DROP NOT NULL;
ALTER TABLE public.corporate_accounts ALTER COLUMN email DROP NOT NULL;

-- 1. Transactions table for corporate/retainer deposits, deductions, refunds
CREATE TABLE public.corporate_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id UUID NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('deposit','monthly_deduction','refund','adjustment','debt_incurred')),
  amount NUMERIC(14,2) NOT NULL,
  balance_before NUMERIC(14,2) NOT NULL,
  balance_after NUMERIC(14,2) NOT NULL,
  related_statement_id UUID REFERENCES public.sponsor_statements(id) ON DELETE SET NULL,
  notes TEXT,
  performed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.corporate_transactions TO authenticated;
GRANT ALL ON public.corporate_transactions TO service_role;

ALTER TABLE public.corporate_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Accountants & admins can view corporate transactions"
  ON public.corporate_transactions FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin','billing']::app_role[]));

CREATE POLICY "Accountants & admins can insert corporate transactions"
  ON public.corporate_transactions FOR INSERT
  TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]));

CREATE INDEX idx_corporate_transactions_sponsor ON public.corporate_transactions(sponsor_id, created_at DESC);

-- 2. close_retainer_month RPC
CREATE OR REPLACE FUNCTION public.close_retainer_month(
  _sponsor_id UUID,
  _year INT,
  _month INT,
  _notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _sponsor RECORD;
  _stmt_id UUID;
  _stmt RECORD;
  _bal_before NUMERIC(14,2);
  _deduct NUMERIC(14,2) := 0;
  _outstanding NUMERIC(14,2) := 0;
  _new_bal NUMERIC(14,2);
  _final_status TEXT;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _sponsor FROM public.corporate_accounts WHERE id = _sponsor_id FOR UPDATE;
  IF _sponsor.id IS NULL THEN RAISE EXCEPTION 'Sponsor not found'; END IF;
  IF _sponsor.account_type <> 'retainer' THEN
    RAISE EXCEPTION 'close_retainer_month only applies to retainer sponsors';
  END IF;

  -- Ensure a statement exists (generate if missing / regenerate if draft)
  SELECT id, status INTO _stmt_id, _final_status
    FROM public.sponsor_statements
    WHERE sponsor_id = _sponsor_id AND period_year = _year AND period_month = _month;

  IF _stmt_id IS NULL OR _final_status = 'draft' THEN
    _stmt_id := public.generate_sponsor_statement(_sponsor_id, _year, _month);
  END IF;

  SELECT * INTO _stmt FROM public.sponsor_statements WHERE id = _stmt_id FOR UPDATE;
  IF _stmt.status IN ('paid','void') THEN
    RAISE EXCEPTION 'Statement is already % — nothing to close', _stmt.status;
  END IF;

  _bal_before := _sponsor.balance;

  IF _bal_before >= _stmt.total_amount THEN
    _deduct := _stmt.total_amount;
    _outstanding := 0;
    _final_status := 'paid';
  ELSIF _bal_before > 0 THEN
    _deduct := _bal_before;
    _outstanding := _stmt.total_amount - _bal_before;
    _final_status := 'finalized';
  ELSE
    _deduct := 0;
    _outstanding := _stmt.total_amount;
    _final_status := 'finalized';
  END IF;

  _new_bal := _bal_before - _deduct;

  IF _deduct > 0 THEN
    UPDATE public.corporate_accounts
       SET balance = _new_bal, updated_at = now()
     WHERE id = _sponsor_id;

    INSERT INTO public.corporate_transactions
      (sponsor_id, transaction_type, amount, balance_before, balance_after,
       related_statement_id, notes, performed_by)
    VALUES
      (_sponsor_id, 'monthly_deduction', -_deduct, _bal_before, _new_bal,
       _stmt_id,
       COALESCE(_notes, 'Monthly deduction for ' || _year || '-' || lpad(_month::text,2,'0')),
       _uid);
  END IF;

  IF _outstanding > 0 THEN
    INSERT INTO public.corporate_transactions
      (sponsor_id, transaction_type, amount, balance_before, balance_after,
       related_statement_id, notes, performed_by)
    VALUES
      (_sponsor_id, 'debt_incurred', -_outstanding, _new_bal, _new_bal,
       _stmt_id,
       'Outstanding balance for ' || _year || '-' || lpad(_month::text,2,'0'),
       _uid);
  END IF;

  UPDATE public.sponsor_statements
     SET status = _final_status,
         finalized_at = COALESCE(finalized_at, now()),
         paid_at = CASE WHEN _final_status = 'paid' THEN now() ELSE paid_at END,
         notes = COALESCE(NULLIF(_notes,''), notes),
         updated_at = now()
   WHERE id = _stmt_id;

  PERFORM public.write_audit_log(
    'retainer_month_closed', 'sponsor_statement', _stmt_id::text,
    jsonb_build_object(
      'sponsor_id', _sponsor_id,
      'sponsor_name', _sponsor.company_name,
      'year', _year, 'month', _month,
      'total_amount', _stmt.total_amount,
      'deducted', _deduct,
      'outstanding', _outstanding,
      'final_status', _final_status
    )
  );

  RETURN jsonb_build_object(
    'statement_id', _stmt_id,
    'total_amount', _stmt.total_amount,
    'deducted', _deduct,
    'outstanding', _outstanding,
    'balance_after', _new_bal,
    'final_status', _final_status
  );
END;
$$;

-- 3. Deposit helper (audited)
CREATE OR REPLACE FUNCTION public.retainer_deposit(
  _sponsor_id UUID,
  _amount NUMERIC,
  _notes TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _sponsor RECORD;
  _new_bal NUMERIC(14,2);
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  SELECT * INTO _sponsor FROM public.corporate_accounts WHERE id = _sponsor_id FOR UPDATE;
  IF _sponsor.id IS NULL THEN RAISE EXCEPTION 'Sponsor not found'; END IF;

  _new_bal := _sponsor.balance + _amount;

  UPDATE public.corporate_accounts
     SET balance = _new_bal, updated_at = now()
   WHERE id = _sponsor_id;

  INSERT INTO public.corporate_transactions
    (sponsor_id, transaction_type, amount, balance_before, balance_after, notes, performed_by)
  VALUES
    (_sponsor_id, 'deposit', _amount, _sponsor.balance, _new_bal, _notes, _uid);

  PERFORM public.write_audit_log(
    'sponsor_deposit', 'corporate_account', _sponsor_id::text,
    jsonb_build_object('amount', _amount, 'new_balance', _new_bal, 'notes', _notes)
  );

  RETURN _new_bal;
END;
$$;


-- ================================================================
-- 20260726101151_e2ee403a-be45-4bf1-b8f4-0be36af388b1.sql
-- ================================================================

DO $$
DECLARE
  retainer_id uuid;
  corp_id uuid;
  ins_id uuid;
  pid uuid;
  vid uuid;
  invid uuid;
  first_names text[] := ARRAY['Aisha','Musa','Fatima','Ibrahim','Zainab','Umar','Halima','Sani','Amina','Yusuf'];
  last_names text[] := ARRAY['Bello','Abubakar','Sule','Danjuma','Garba','Idris','Kabir','Lawal','Salihu','Tanko'];
  i int;
  amt numeric;
  when_ts timestamptz;
BEGIN
  SELECT id INTO retainer_id FROM corporate_accounts WHERE account_type='retainer' LIMIT 1;

  SELECT id INTO corp_id FROM corporate_accounts WHERE company_name='Dangote Group' LIMIT 1;
  IF corp_id IS NULL THEN
    INSERT INTO corporate_accounts (company_name, phone, address, account_type, sponsor_type, status)
    VALUES ('Dangote Group', '08012340000', 'Dangote HQ, Kano', 'corporate', 'corporate', 'active')
    RETURNING id INTO corp_id;
  END IF;

  SELECT id INTO ins_id FROM insurance_providers WHERE name='NHIA' LIMIT 1;
  IF ins_id IS NULL THEN
    INSERT INTO insurance_providers (name, type, code, coverage_percentage, status)
    VALUES ('NHIA', 'nhia', 'NHIA-001', 90, 'active')
    RETURNING id INTO ins_id;
  END IF;

  FOR i IN 1..10 LOOP
    -- Retainer patient
    INSERT INTO patients (first_name, last_name, gender, phone, address, date_of_birth, account_type, corporate_id, card_number, mini_card_number, status)
    VALUES (first_names[i], last_names[i], CASE WHEN i%2=0 THEN 'male' ELSE 'female' END,
            '0803000' || lpad(i::text,4,'0'), 'Kano', '1990-01-01', 'retainer', retainer_id, '', '', 'discharged')
    RETURNING id INTO pid;
    when_ts := date_trunc('month', now()) + ((i-1) || ' days')::interval + interval '10 hours';
    INSERT INTO visits (patient_id, visit_number, status, sponsor_type, corporate_id, opened_at, presenting_complaint, claim_status)
    VALUES (pid, next_visit_number(), 'settled', 'retainer', retainer_id, when_ts, 'Routine consultation', 'pending')
    RETURNING id INTO vid;
    amt := 5000 + (i*500);
    INSERT INTO invoices (patient_id, visit_id, invoice_number, total_amount, original_amount, sponsor_type, corporate_account_id, status, created_at, updated_at)
    VALUES (pid, vid, '', amt, amt, 'retainer', retainer_id, 'pending', when_ts, when_ts)
    RETURNING id INTO invid;
    INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total, category) VALUES
      (invid, 'Consultation', 1, 2000, 2000, 'consultation'),
      (invid, 'Malaria RDT', 1, 1500, 1500, 'lab'),
      (invid, 'Drugs', 1, amt-3500, amt-3500, 'pharmacy');

    -- Corporate patient
    INSERT INTO patients (first_name, last_name, gender, phone, address, date_of_birth, account_type, corporate_id, card_number, mini_card_number, status)
    VALUES (first_names[i], last_names[((i+3)%10)+1], CASE WHEN i%2=0 THEN 'female' ELSE 'male' END,
            '0804000' || lpad(i::text,4,'0'), 'Kano', '1988-05-15', 'corporate', corp_id, '', '', 'discharged')
    RETURNING id INTO pid;
    when_ts := date_trunc('month', now()) + ((i-1) || ' days')::interval + interval '11 hours';
    INSERT INTO visits (patient_id, visit_number, status, sponsor_type, corporate_id, opened_at, presenting_complaint, claim_status)
    VALUES (pid, next_visit_number(), 'settled', 'corporate', corp_id, when_ts, 'Company medical', 'pending')
    RETURNING id INTO vid;
    amt := 7500 + (i*750);
    INSERT INTO invoices (patient_id, visit_id, invoice_number, total_amount, original_amount, sponsor_type, corporate_account_id, status, created_at, updated_at)
    VALUES (pid, vid, '', amt, amt, 'corporate', corp_id, 'pending', when_ts, when_ts)
    RETURNING id INTO invid;
    INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total, category) VALUES
      (invid, 'Consultation', 1, 3000, 3000, 'consultation'),
      (invid, 'Chest X-Ray', 1, 4500, 4500, 'lab'),
      (invid, 'Drugs', 1, amt-7500, amt-7500, 'pharmacy');

    -- Insurance patient
    INSERT INTO patients (first_name, last_name, gender, phone, address, date_of_birth, account_type, insurance_provider, insurance_policy_number, card_number, mini_card_number, status)
    VALUES (first_names[((i+5)%10)+1], last_names[i], CASE WHEN i%2=0 THEN 'male' ELSE 'female' END,
            '0805000' || lpad(i::text,4,'0'), 'Kano', '1985-08-20', 'insurance', 'NHIA', 'NHIA-POL-' || lpad(i::text,4,'0'), '', '', 'discharged')
    RETURNING id INTO pid;
    when_ts := date_trunc('month', now()) + ((i-1) || ' days')::interval + interval '12 hours';
    INSERT INTO visits (patient_id, visit_number, status, sponsor_type, opened_at, presenting_complaint, claim_status)
    VALUES (pid, next_visit_number(), 'settled', 'insurance', when_ts, 'Insurance visit', 'pending')
    RETURNING id INTO vid;
    amt := 6000 + (i*600);
    INSERT INTO invoices (patient_id, visit_id, invoice_number, total_amount, original_amount, sponsor_type, status, created_at, updated_at)
    VALUES (pid, vid, '', amt, amt, 'insurance', 'pending', when_ts, when_ts)
    RETURNING id INTO invid;
    INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total, category) VALUES
      (invid, 'Consultation', 1, 2500, 2500, 'consultation'),
      (invid, 'Blood test', 1, 2000, 2000, 'lab'),
      (invid, 'Drugs', 1, amt-4500, amt-4500, 'pharmacy');
  END LOOP;
END $$;


-- ================================================================
-- 20260727075202_a46f35f7-1c22-4377-999d-a3b1a3bb577e.sql
-- ================================================================
UPDATE public.patients SET account_type = 'nhis' WHERE account_type = 'insurance';

-- ================================================================
-- 20260727081705_fd9b41c5-2d30-4a60-82c7-9e9ee72a6009.sql
-- ================================================================
CREATE OR REPLACE FUNCTION public.reset_patient_history()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset patient history';
  END IF;

  DELETE FROM public.invoice_items;
  DELETE FROM public.sponsor_statement_items;
  DELETE FROM public.sponsor_statements;
  DELETE FROM public.insurance_claims;
  DELETE FROM public.corporate_transactions;
  DELETE FROM public.balance_transactions;
  DELETE FROM public.balance_requests;
  DELETE FROM public.invoices;
  DELETE FROM public.prescription_items;
  DELETE FROM public.prescriptions;
  DELETE FROM public.lab_requests;
  DELETE FROM public.vitals;
  DELETE FROM public.snap_orders;
  DELETE FROM public.standing_orders;
  DELETE FROM public.visit_attachments;
  DELETE FROM public.emr_attachments;
  DELETE FROM public.eligibility_verifications;
  DELETE FROM public.patient_journey_history;
  DELETE FROM public.patient_journey;
  DELETE FROM public.admissions;
  DELETE FROM public.anc_visits;
  DELETE FROM public.anc_programs;
  DELETE FROM public.visits;

  UPDATE public.patients
     SET status = 'registered',
         last_visit = NULL,
         balance = 0;

  UPDATE public.corporate_accounts SET balance = 0;

  PERFORM public.write_audit_log('reset_patient_history', 'patients', NULL, NULL, 'success');
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_patient_history() TO authenticated;

-- ================================================================
-- 20260727093011_870cb265-c493-4dc6-a874-e047abb75553.sql
-- ================================================================

CREATE OR REPLACE FUNCTION public.discharge_patient(_patient_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _v RECORD;
  _outstanding numeric;
  _is_sponsored boolean := false;
  _new_claim text;
  _closed_visit_id uuid := NULL;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin','billing','cashier','accountant']::app_role[]) THEN
    RAISE EXCEPTION 'Not permitted to discharge patients';
  END IF;

  -- Find the patient's open visit (if any)
  SELECT * INTO _v FROM public.visits
   WHERE patient_id = _patient_id AND status = 'open'
   ORDER BY opened_at DESC LIMIT 1;

  IF _v.id IS NOT NULL THEN
    PERFORM public.recalc_visit_totals(_v.id);
    SELECT * INTO _v FROM public.visits WHERE id = _v.id;

    _is_sponsored := _v.sponsor_type IS NOT NULL
                     AND lower(_v.sponsor_type) IN ('katchma','nhis','nhia','hmo','corporate','retainer','staff','staff_family');
    _outstanding := COALESCE(_v.total_charged,0) - COALESCE(_v.total_paid,0);

    IF NOT _is_sponsored AND _outstanding > 0 THEN
      RAISE EXCEPTION 'Cash patient still owes ₦% — collect payment at Cashier before discharge', _outstanding;
    END IF;

    _new_claim := _v.claim_status;
    IF _v.claim_status = 'not_applicable'
       AND COALESCE(_v.total_charged,0) > 0
       AND _is_sponsored
       AND lower(_v.sponsor_type) IN ('katchma','nhis','nhia','hmo','corporate','retainer')
    THEN
      _new_claim := 'pending';
    END IF;

    UPDATE public.visits
       SET status = 'settled',
           closed_at = now(),
           closed_by = _uid,
           claim_status = _new_claim,
           claim_last_action_at = CASE WHEN _new_claim <> _v.claim_status THEN now() ELSE claim_last_action_at END,
           claim_last_action_by = CASE WHEN _new_claim <> _v.claim_status THEN _uid ELSE claim_last_action_by END,
           updated_at = now()
     WHERE id = _v.id;

    _closed_visit_id := _v.id;

    PERFORM public.write_audit_log(
      'visit_settled_on_discharge', 'visit', _v.id::text,
      jsonb_build_object(
        'visit_number', _v.visit_number,
        'patient_id', _v.patient_id,
        'sponsor_type', _v.sponsor_type,
        'total_charged', _v.total_charged,
        'total_paid', _v.total_paid,
        'outstanding', _outstanding,
        'claim_status', _new_claim,
        'reason', _reason
      ), 'success'
    );
  END IF;

  UPDATE public.patients
     SET status = 'discharged', updated_at = now()
   WHERE id = _patient_id;

  PERFORM public.advance_journey(
    _patient_id, 'discharged', NULL, _uid, NULL, NULL, _closed_visit_id, _reason
  );

  PERFORM public.write_audit_log(
    'patient_discharged', 'patient', _patient_id::text,
    jsonb_build_object('visit_id', _closed_visit_id, 'reason', _reason), 'success'
  );

  RETURN jsonb_build_object('visit_id', _closed_visit_id, 'sponsored', _is_sponsored);
END;
$$;

GRANT EXECUTE ON FUNCTION public.discharge_patient(uuid, text) TO authenticated;


-- ================================================================
-- 20260728094016_1373792c-cea5-45d0-8cba-82d24f516d92.sql
-- ================================================================

DROP POLICY "Admin delete insurance_claims" ON public.insurance_claims;
CREATE POLICY "Admin delete insurance_claims" ON public.insurance_claims
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY "Uploader or admin update EMR attachments" ON public.emr_attachments;
CREATE POLICY "Uploader or admin update EMR attachments" ON public.emr_attachments
  FOR UPDATE TO authenticated
  USING ((uploaded_by = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK ((uploaded_by = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY "Fulfillers update only paid snap orders" ON public.snap_orders;
CREATE POLICY "Fulfillers update only paid snap orders" ON public.snap_orders
  FOR UPDATE TO authenticated
  USING ((status = 'paid'::text) AND (((target_station = 'pharmacy'::text) AND has_role(auth.uid(), 'pharmacist'::app_role)) OR ((target_station = 'lab'::text) AND has_role(auth.uid(), 'lab_tech'::app_role))))
  WITH CHECK ((status = ANY (ARRAY['paid'::text, 'fulfilled'::text, 'rejected'::text])) AND (((target_station = 'pharmacy'::text) AND has_role(auth.uid(), 'pharmacist'::app_role)) OR ((target_station = 'lab'::text) AND has_role(auth.uid(), 'lab_tech'::app_role))));


-- ================================================================
-- 20260728094156_e461416d-13d9-431b-a44b-e131b8559dbb.sql
-- ================================================================

CREATE OR REPLACE FUNCTION public.settle_invoice_atomic(
  _invoice_id uuid,
  _cash_amount numeric DEFAULT 0,
  _balance_amount numeric DEFAULT 0,
  _debt_amount numeric DEFAULT 0,
  _payment_method text DEFAULT 'cash',
  _notes text DEFAULT NULL,
  _sponsored boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice invoices%ROWTYPE;
  v_new_balance numeric;
  v_collected numeric;
  v_available numeric;
BEGIN
  IF NOT public.is_authenticated_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _cash_amount < 0 OR _balance_amount < 0 OR _debt_amount < 0 THEN
    RAISE EXCEPTION 'Amounts must be non-negative';
  END IF;

  -- Lock the invoice row for the duration of the transaction.
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = _invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_invoice.status = 'paid' THEN
    RAISE EXCEPTION 'Invoice already settled';
  END IF;

  -- Deduct from wallet balance (with concurrency-safe check).
  IF _balance_amount > 0 THEN
    SELECT balance INTO v_available
    FROM public.patients
    WHERE id = v_invoice.patient_id
    FOR UPDATE;

    IF v_available IS NULL OR v_available < _balance_amount THEN
      RAISE EXCEPTION 'Insufficient wallet balance (available: %, requested: %)',
        COALESCE(v_available, 0), _balance_amount;
    END IF;

    PERFORM public.adjust_patient_balance(
      v_invoice.patient_id,
      -_balance_amount,
      'invoice_deduction',
      'balance',
      NULL,
      _invoice_id,
      COALESCE(_notes, format('Applied to invoice %s', v_invoice.invoice_number))
    );
  END IF;

  -- Record shortfall as patient debt for cash accounts.
  IF _debt_amount > 0 THEN
    PERFORM public.adjust_patient_balance(
      v_invoice.patient_id,
      -_debt_amount,
      'debt_incurred',
      _payment_method,
      NULL,
      _invoice_id,
      format('Shortfall on invoice %s', v_invoice.invoice_number)
    );
  END IF;

  v_collected := COALESCE(v_invoice.paid_amount, 0) + _cash_amount + _balance_amount;

  UPDATE public.invoices
  SET paid_amount    = v_collected,
      status         = 'paid',
      payment_method = _payment_method,
      paid_at        = now(),
      notes          = COALESCE(_notes, notes),
      updated_at     = now()
  WHERE id = _invoice_id;

  SELECT balance INTO v_new_balance FROM public.patients WHERE id = v_invoice.patient_id;

  RETURN jsonb_build_object(
    'invoice_id',       _invoice_id,
    'invoice_number',   v_invoice.invoice_number,
    'patient_id',       v_invoice.patient_id,
    'collected',        v_collected,
    'cash_amount',      _cash_amount,
    'balance_amount',   _balance_amount,
    'debt_amount',      _debt_amount,
    'new_wallet_balance', v_new_balance,
    'sponsored',        _sponsored
  );
END;
$$;

REVOKE ALL ON FUNCTION public.settle_invoice_atomic(uuid, numeric, numeric, numeric, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_invoice_atomic(uuid, numeric, numeric, numeric, text, text, boolean) TO authenticated;


-- ================================================================
-- 20260728110333_2726af4b-5cd6-4a27-8320-aecea6a184af.sql
-- ================================================================

-- 1. Drop manual insert policies so direct inserts are denied
DROP POLICY IF EXISTS "Doctors can insert prescriptions" ON public.prescriptions;
DROP POLICY IF EXISTS "Doctors can insert prescription_items" ON public.prescription_items;
DROP POLICY IF EXISTS "Doctors and lab_tech can insert lab_requests" ON public.lab_requests;

-- 2. Snap -> prescription helper (pharmacist only, snap must be paid pharmacy snap)
CREATE OR REPLACE FUNCTION public.create_prescription_from_snap(
  _snap_id uuid,
  _diagnosis text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _items jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snap public.snap_orders%ROWTYPE;
  v_uid  uuid := auth.uid();
  v_prescription_id uuid;
  v_item jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_any_role(v_uid, ARRAY['pharmacist','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only pharmacists can materialise prescriptions from snaps';
  END IF;

  SELECT * INTO v_snap FROM public.snap_orders WHERE id = _snap_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snap order % not found', _snap_id;
  END IF;
  IF v_snap.target_station <> 'pharmacy' OR v_snap.order_type <> 'prescription' THEN
    RAISE EXCEPTION 'Snap % is not a pharmacy prescription snap', _snap_id;
  END IF;
  IF v_snap.status NOT IN ('paid','fulfilled') THEN
    RAISE EXCEPTION 'Snap % must be paid before creating a prescription (status=%)', _snap_id, v_snap.status;
  END IF;

  INSERT INTO public.prescriptions (patient_id, visit_id, diagnosis, notes, status, created_by)
  VALUES (v_snap.patient_id, v_snap.visit_id, _diagnosis, _notes, 'dispensed', v_uid::text)
  RETURNING id INTO v_prescription_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_items, '[]'::jsonb))
  LOOP
    INSERT INTO public.prescription_items
      (prescription_id, medication, dosage, frequency, duration, quantity, dispensed)
    VALUES (
      v_prescription_id,
      COALESCE(v_item->>'medication', v_item->>'name', 'Unknown'),
      COALESCE(v_item->>'dosage', ''),
      COALESCE(v_item->>'frequency', ''),
      COALESCE(v_item->>'duration', ''),
      COALESCE((v_item->>'quantity')::int, (v_item->>'qty')::int, 1),
      true
    );
  END LOOP;

  RETURN v_prescription_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_prescription_from_snap(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_prescription_from_snap(uuid, text, text, jsonb) TO authenticated;

-- 3. Snap -> lab_request helper (lab_tech only)
CREATE OR REPLACE FUNCTION public.create_lab_request_from_snap(
  _snap_id uuid,
  _tests text[],
  _diagnosis text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snap public.snap_orders%ROWTYPE;
  v_uid  uuid := auth.uid();
  v_lab_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_any_role(v_uid, ARRAY['lab_tech','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only lab technicians can materialise lab requests from snaps';
  END IF;

  SELECT * INTO v_snap FROM public.snap_orders WHERE id = _snap_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snap order % not found', _snap_id;
  END IF;
  IF v_snap.target_station <> 'lab' OR v_snap.order_type NOT IN ('lab','lab_result') THEN
    RAISE EXCEPTION 'Snap % is not a lab snap', _snap_id;
  END IF;
  IF v_snap.status NOT IN ('paid','fulfilled') THEN
    RAISE EXCEPTION 'Snap % must be paid before creating a lab request (status=%)', _snap_id, v_snap.status;
  END IF;
  IF _tests IS NULL OR array_length(_tests, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one test is required';
  END IF;

  INSERT INTO public.lab_requests
    (patient_id, visit_id, tests, diagnosis, status, requested_by, requested_at, printed)
  VALUES (
    v_snap.patient_id, v_snap.visit_id, _tests, _diagnosis,
    'pending', v_uid::text, now(), false
  )
  RETURNING id INTO v_lab_id;

  RETURN v_lab_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_lab_request_from_snap(uuid, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_lab_request_from_snap(uuid, text[], text) TO authenticated;


-- ================================================================
-- 20260728114220_eea66ff3-6f68-413d-bea2-9d01be6c2018.sql
-- ================================================================
CREATE OR REPLACE FUNCTION public.snap_orders_sync_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Advance the linked snap to "paid" as soon as the invoice is marked paid,
  -- regardless of whether the money came from the patient or a sponsor claim.
  IF NEW.status = 'paid'
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.status, '') <> 'paid') THEN
    UPDATE public.snap_orders
       SET status = 'paid', paid_at = now(), updated_at = now()
     WHERE invoice_id = NEW.id
       AND status IN ('awaiting_payment', 'pending_billing');
  END IF;
  RETURN NEW;
END;
$$;

-- Heal any snaps that got stuck under the old trigger definition.
UPDATE public.snap_orders so
   SET status = 'paid', paid_at = COALESCE(so.paid_at, now()), updated_at = now()
  FROM public.invoices i
 WHERE so.invoice_id = i.id
   AND i.status = 'paid'
   AND so.status IN ('awaiting_payment', 'pending_billing');

-- ================================================================
-- 20260728115107_66ef34e1-f8ce-4524-a2ca-2c732f5822f1.sql
-- ================================================================

CREATE OR REPLACE FUNCTION public.reconcile_paid_snap_orders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  healed_snaps int := 0;
  healed_patients int := 0;
  r record;
  next_station text;
BEGIN
  -- 1) Heal snap orders stuck at awaiting_payment whose invoice is paid.
  WITH updated AS (
    UPDATE public.snap_orders s
       SET status = 'paid',
           paid_at = COALESCE(s.paid_at, now()),
           updated_at = now()
      FROM public.invoices i
     WHERE s.invoice_id = i.id
       AND s.status = 'awaiting_payment'
       AND i.status = 'paid'
    RETURNING s.id
  )
  SELECT count(*) INTO healed_snaps FROM updated;

  -- 2) Heal patients stuck at awaiting_payment when nothing is truly pending.
  FOR r IN
    SELECT p.id AS patient_id
      FROM public.patients p
     WHERE p.status = 'awaiting_payment'
       AND NOT EXISTS (
         SELECT 1 FROM public.invoices i
          WHERE i.patient_id = p.id
            AND i.status IN ('pending','partial')
       )
  LOOP
    next_station := public.patient_pending_workflow_station(r.patient_id);

    IF next_station IS NULL THEN
      UPDATE public.patients
         SET status = 'discharged', updated_at = now()
       WHERE id = r.patient_id;
    ELSIF next_station <> 'awaiting_payment' THEN
      UPDATE public.patients
         SET status = next_station, updated_at = now()
       WHERE id = r.patient_id;
    ELSE
      CONTINUE;
    END IF;

    healed_patients := healed_patients + 1;

    PERFORM public.write_audit_log(
      'patient_status_reconciled',
      'patient',
      r.patient_id::text,
      jsonb_build_object('new_status', COALESCE(next_station, 'discharged'), 'source', 'reconcile_paid_snap_orders'),
      'success'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'healed_snaps', healed_snaps,
    'healed_patients', healed_patients,
    'ran_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_paid_snap_orders() TO authenticated, service_role;

-- Schedule every 5 minutes via pg_cron
DO $$
BEGIN
  PERFORM cron.unschedule('reconcile-paid-snap-orders');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'reconcile-paid-snap-orders',
  '*/5 * * * *',
  $$SELECT public.reconcile_paid_snap_orders();$$
);


-- ================================================================
-- 20260728121152_5f7c1928-26b4-4ce7-a0f9-400cb02020ad.sql
-- ================================================================

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS claim_submitted_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS claim_submitted_by uuid,
  ADD COLUMN IF NOT EXISTS claim_submission_notes text;

CREATE OR REPLACE FUNCTION public.mark_invoice_claim_submitted(
  _invoice_id uuid,
  _notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.has_role(_uid, 'admin'::app_role) OR public.has_role(_uid, 'claims_manager'::app_role)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.invoices
     SET claim_submitted_at = now(),
         claim_submitted_by = _uid,
         claim_submission_notes = COALESCE(_notes, claim_submission_notes)
   WHERE id = _invoice_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unmark_invoice_claim_submitted(
  _invoice_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.has_role(_uid, 'admin'::app_role) OR public.has_role(_uid, 'claims_manager'::app_role)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.invoices
     SET claim_submitted_at = NULL,
         claim_submitted_by = NULL
   WHERE id = _invoice_id;
END;
$$;


-- ================================================================
-- 20260729001714_737ee12c-4f53-47c9-9deb-a742d2ee977f.sql
-- ================================================================

CREATE OR REPLACE FUNCTION public.purge_clinical_data(_modules text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _result jsonb := '{}'::jsonb;
  _n bigint;
  _has text[] := _modules;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can purge clinical data';
  END IF;

  -- Order: dependents first
  IF 'tasks' = ANY(_has) THEN
    DELETE FROM public.task_claims; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('task_claims', _n);
  END IF;

  IF 'notifications' = ANY(_has) THEN
    DELETE FROM public.notifications; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('notifications', _n);
  END IF;

  IF 'errors' = ANY(_has) THEN
    DELETE FROM public.error_logs; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('error_logs', _n);
  END IF;

  IF 'audit' = ANY(_has) THEN
    DELETE FROM public.audit_logs; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('audit_logs', _n);
  END IF;

  IF 'lab' = ANY(_has) THEN
    DELETE FROM public.lab_requests; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('lab_requests', _n);
  END IF;

  IF 'prescriptions' = ANY(_has) THEN
    DELETE FROM public.prescription_items; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('prescription_items', _n);
    DELETE FROM public.prescriptions; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('prescriptions', _n);
  END IF;

  IF 'billing' = ANY(_has) THEN
    DELETE FROM public.invoice_items; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('invoice_items', _n);
    DELETE FROM public.sponsor_statement_items; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('sponsor_statement_items', _n);
    DELETE FROM public.sponsor_statements; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('sponsor_statements', _n);
    DELETE FROM public.insurance_claims; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('insurance_claims', _n);
    DELETE FROM public.corporate_transactions; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('corporate_transactions', _n);
    DELETE FROM public.balance_transactions; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('balance_transactions', _n);
    DELETE FROM public.balance_requests; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('balance_requests', _n);
    DELETE FROM public.invoices; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('invoices', _n);
  END IF;

  IF 'snaps' = ANY(_has) THEN
    DELETE FROM public.snap_orders; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('snap_orders', _n);
  END IF;

  IF 'admissions' = ANY(_has) THEN
    DELETE FROM public.admissions; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('admissions', _n);
    UPDATE public.beds SET status = 'available' WHERE status <> 'available';
    GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('beds_reset', _n);
  END IF;

  IF 'anc' = ANY(_has) THEN
    DELETE FROM public.anc_visits; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('anc_visits', _n);
    DELETE FROM public.anc_programs; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('anc_programs', _n);
  END IF;

  IF 'visits' = ANY(_has) THEN
    DELETE FROM public.visit_attachments; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('visit_attachments', _n);
    DELETE FROM public.emr_attachments; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('emr_attachments', _n);
    DELETE FROM public.vitals; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('vitals', _n);
    DELETE FROM public.patient_journey_history; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('patient_journey_history', _n);
    DELETE FROM public.patient_journey; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('patient_journey', _n);
    DELETE FROM public.visits; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('visits', _n);
  END IF;

  IF 'patients' = ANY(_has) THEN
    DELETE FROM public.patients; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('patients', _n);
  END IF;

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_clinical_data(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_clinical_data(text[]) TO authenticated;


-- ================================================================
-- 20260730112225_2783a0ff-cca6-4af2-a1f8-45344adf7093.sql
-- ================================================================
CREATE OR REPLACE FUNCTION public.copay_percent(_account_type text, _plan text DEFAULT NULL)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN lower(coalesce(_account_type,'')) = 'katchma'
      THEN CASE WHEN lower(coalesce(_plan,'')) LIKE '%basic%' THEN 0 ELSE 10 END
    WHEN lower(coalesce(_account_type,'')) IN ('nhia','nhis') THEN 10
    WHEN lower(coalesce(_account_type,'')) IN ('hmo','corporate','retainer','staff') THEN 0
    WHEN lower(coalesce(_account_type,'')) = 'staff_family' THEN 50
    ELSE 100
  END::numeric
$fn$;

REVOKE ALL ON FUNCTION public.copay_percent(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.copay_percent(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admission_bed_charge(_admission_id uuid)
RETURNS TABLE(days integer, daily_rate numeric, amount numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    GREATEST(1, CEIL(EXTRACT(EPOCH FROM (COALESCE(a.discharged_at, now()) - COALESCE(a.admitted_at, a.created_at))) / 86400.0))::int,
    COALESCE(r.daily_rate, 0)::numeric,
    (GREATEST(1, CEIL(EXTRACT(EPOCH FROM (COALESCE(a.discharged_at, now()) - COALESCE(a.admitted_at, a.created_at))) / 86400.0)) * COALESCE(r.daily_rate, 0))::numeric
  FROM public.admissions a
  LEFT JOIN public.beds b ON b.id = a.bed_id
  LEFT JOIN public.rooms r ON r.id = b.room_id
  WHERE a.id = _admission_id;
$fn$;

REVOKE ALL ON FUNCTION public.admission_bed_charge(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admission_bed_charge(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bill_admission_bed_days(_admission_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _adm RECORD;
  _p RECORD;
  _room RECORD;
  _days int;
  _rate numeric;
  _amount numeric;
  _pct numeric;
  _copay numeric;
  _inv uuid;
BEGIN
  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id;
  IF _adm IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id;
  IF _p IS NULL THEN RETURN NULL; END IF;

  SELECT d.days, d.daily_rate, d.amount INTO _days, _rate, _amount
  FROM public.admission_bed_charge(_admission_id) d;

  IF COALESCE(_amount, 0) <= 0 THEN RETURN NULL; END IF;

  SELECT id INTO _inv FROM public.invoices
  WHERE patient_id = _adm.patient_id
    AND notes = 'BED_DAYS:' || _admission_id::text
  LIMIT 1;
  IF _inv IS NOT NULL THEN RETURN _inv; END IF;

  _pct := public.copay_percent(_p.account_type, _p.insurance_plan);
  _copay := ROUND(_amount * _pct / 100.0, 2);

  SELECT r.room_number, r.room_class INTO _room
  FROM public.beds b JOIN public.rooms r ON r.id = b.room_id
  WHERE b.id = _adm.bed_id;

  INSERT INTO public.invoices (
    patient_id, visit_id, total_amount, original_amount, discount_amount,
    paid_amount, status, sponsor_type, corporate_account_id, notes
  ) VALUES (
    _adm.patient_id, _adm.visit_id, _amount, _amount, 0,
    0, 'pending',
    CASE WHEN _pct < 100 THEN _p.account_type ELSE NULL END,
    _p.corporate_id,
    'BED_DAYS:' || _admission_id::text
  ) RETURNING id INTO _inv;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
  VALUES (
    _inv,
    'Bed charge - ' || COALESCE(_room.room_class, 'ward') || ' - ' || _days || ' day(s)',
    _days, _rate, _amount, 'admission'
  );

  IF _copay > 0 THEN
    PERFORM public.adjust_patient_balance(
      _adm.patient_id, -_copay, 'invoice_payment', NULL, NULL, _inv,
      'Bed charge for admission (' || _days || ' day(s))'
    );
    UPDATE public.invoices
      SET paid_amount = _copay,
          status = CASE WHEN _copay >= _amount THEN 'paid' ELSE 'partial' END,
          paid_at = CASE WHEN _copay >= _amount THEN now() ELSE NULL END
      WHERE id = _inv;
  END IF;

  RETURN _inv;
END;
$fn$;

REVOKE ALL ON FUNCTION public.bill_admission_bed_days(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.bill_admission_bed_days(uuid) TO authenticated, service_role;

-- ================================================================
-- 20260730112255_f94f280c-720b-404d-a4dd-4661b0e7abc8.sql
-- ================================================================
CREATE OR REPLACE FUNCTION public.discharge_admission(_admission_id uuid, _notes text DEFAULT NULL::text, _settlement_method text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0, _settlement_notes text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _adm RECORD;
  _bal numeric;
  _debt numeric;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
       ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to discharge';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF _adm.status NOT IN ('active','ready_for_discharge') THEN
    RAISE EXCEPTION 'Admission is not active (%)', _adm.status;
  END IF;

  -- Accrued bed charge is billed here (once per admission)
  PERFORM public.bill_admission_bed_days(_admission_id);

  SELECT balance INTO _bal FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
  _debt := GREATEST(0, -COALESCE(_bal,0));

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash','pos','transfer') THEN
      IF COALESCE(_settlement_amount,0) < _debt THEN
        RAISE EXCEPTION 'Settlement amount % is less than debt %', _settlement_amount, _debt;
      END IF;
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, _settlement_amount, 'debt_cleared', _settlement_method,
        NULL, NULL, COALESCE(_settlement_notes, 'Discharge settlement')
      );
    ELSIF _settlement_method = 'waive' THEN
      IF NOT public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]) THEN
        RAISE EXCEPTION 'Only accountant/admin can waive debt';
      END IF;
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, _debt, 'debt_cleared', 'waive',
        NULL, NULL, COALESCE(_settlement_notes, 'Discharge - debt waived')
      );
    ELSIF _settlement_method = 'carry' THEN
      PERFORM public.write_audit_log(
        'debt_carried_on_discharge', 'admission', _admission_id::text,
        jsonb_build_object('patient_id', _adm.patient_id, 'debt', _debt, 'notes', _settlement_notes)
      );
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  UPDATE public.admissions
     SET status = 'discharged',
         discharged_at = now(),
         discharged_by = auth.uid(),
         discharge_notes = _notes,
         updated_at = now()
   WHERE id = _admission_id;

  IF _adm.bed_id IS NOT NULL THEN
    UPDATE public.beds SET status = 'available', updated_at = now() WHERE id = _adm.bed_id;
  END IF;

  UPDATE public.patients SET status = 'discharged', updated_at = now() WHERE id = _adm.patient_id;

  PERFORM public.write_audit_log(
    'admission_discharged', 'admission', _admission_id::text,
    jsonb_build_object('patient_id', _adm.patient_id, 'notes', _notes)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) FROM public;
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) TO authenticated, service_role;

-- ================================================================
-- 20260730114830_481f4a7c-1f47-4c94-9a5d-c329dcb60b16.sql
-- ================================================================
-- 1) Server-side, role-checked bed assignment
CREATE OR REPLACE FUNCTION public.assign_admission_bed(_admission_id uuid, _bed_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _adm RECORD;
  _bed RECORD;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only a nurse or admin can assign a ward/room/bed';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF _adm.status <> 'waiting_assignment' THEN
    RAISE EXCEPTION 'Admission is not waiting for a room (%)', _adm.status;
  END IF;

  SELECT * INTO _bed FROM public.beds WHERE id = _bed_id FOR UPDATE;
  IF _bed IS NULL OR NOT _bed.active THEN RAISE EXCEPTION 'Bed not found or inactive'; END IF;
  IF _bed.status <> 'available' THEN RAISE EXCEPTION 'Bed is not available'; END IF;

  UPDATE public.admissions
     SET bed_id = _bed_id,
         assigned_by_nurse = _uid,
         status = 'active',
         admitted_at = now(),
         updated_at = now()
   WHERE id = _admission_id;

  PERFORM public.write_audit_log(
    'admission_bed_assigned', 'admission', _admission_id::text,
    jsonb_build_object('patient_id', _adm.patient_id, 'bed_id', _bed_id)
  );
END $$;

REVOKE ALL ON FUNCTION public.assign_admission_bed(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_admission_bed(uuid, uuid) TO authenticated;

-- 2) Block direct table updates: all admission movement must go through checked RPCs
DROP POLICY IF EXISTS "Nurses & admin update admissions" ON public.admissions;
DROP POLICY IF EXISTS "Doctors create admissions" ON public.admissions;

-- 3) Ensure the RPCs remain reachable only by signed-in staff
REVOKE ALL ON FUNCTION public.request_admission(uuid, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_admission(uuid, text, text, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_ready_for_discharge(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_ready_for_discharge(uuid, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) TO authenticated;
REVOKE ALL ON FUNCTION public.forward_snap_to_billing(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forward_snap_to_billing(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.create_admitted_snap(uuid, text, text, text, text, jsonb, numeric, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_admitted_snap(uuid, text, text, text, text, jsonb, numeric, boolean, text) TO authenticated;


-- ================================================================
-- 20260730121417_b20d27f1-1604-4645-bbd2-f4d2d3718090.sql
-- ================================================================
ALTER FUNCTION public.simple_id(text, bigint) SET search_path = public;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args,
           pg_get_function_result(p.oid) AS ret
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon, PUBLIC;', r.proname, r.args);
    IF r.ret = 'trigger' THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM authenticated;', r.proname, r.args);
    END IF;
  END LOOP;
END $$;

-- ================================================================
-- 20260730123801_39619395-fa06-4b75-b765-0157e7d7dad2.sql
-- ================================================================
REVOKE EXECUTE ON FUNCTION public.anc_touch_updated_at() FROM anon, authenticated, PUBLIC;

-- ================================================================
-- 20260731101216_f9ad0b56-fe01-4ddd-936c-53ba4c700f24.sql
-- ================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'admissions','patients','visits','snap_orders','patient_journey','notifications',
    'beds','rooms','wards','invoices','invoice_items','lab_requests','prescriptions',
    'prescription_items','balance_requests','vitals','standing_orders','task_claims',
    'eligibility_verifications','stock_requests'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ================================================================
-- 20260731101727_1c04e970-2ef0-4bf8-bd30-c3f0dcfab420.sql
-- ================================================================
CREATE OR REPLACE FUNCTION public.request_admission(_patient_id uuid, _reason text DEFAULT NULL, _photo_path text DEFAULT NULL, _note text DEFAULT NULL, _visit_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _adm uuid;
  _visit uuid;
  _snap uuid;
  _role text;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to admit';
  END IF;
  IF _photo_path IS NULL OR length(trim(_photo_path)) = 0 THEN
    RAISE EXCEPTION 'ADMISSION_SNAP_REQUIRED: an admission-order photo is required';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.admissions
     WHERE patient_id = _patient_id
       AND status IN ('waiting_assignment','active','ready_for_discharge')
  ) THEN
    RAISE EXCEPTION 'Patient already has an open admission';
  END IF;

  _visit := _visit_id;
  IF _visit IS NULL THEN
    SELECT id INTO _visit FROM public.visits
     WHERE patient_id = _patient_id AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1;
  END IF;

  INSERT INTO public.admissions (
    patient_id, visit_id, admitting_doctor, reason, status,
    admission_snap_path, admission_note
  ) VALUES (
    _patient_id, _visit, _uid, _reason, 'waiting_assignment',
    _photo_path, _note
  ) RETURNING id INTO _adm;

  SELECT role::text INTO _role FROM public.user_roles WHERE user_id = _uid LIMIT 1;

  INSERT INTO public.snap_orders (
    patient_id, visit_id, order_type, target_station, source_role,
    photo_path, note, status, created_by, original_sender_role, intent
  ) VALUES (
    _patient_id, _visit, 'treatment', 'nurse', COALESCE(_role,'nurse'),
    _photo_path, COALESCE(_note, _reason), 'acknowledged', _uid, COALESCE(_role,'nurse'),
    'admission_order'
  ) RETURNING id INTO _snap;

  -- Move the patient out of the normal station queues into Awaiting Room.
  UPDATE public.patients
     SET status = 'awaiting_room', updated_at = now()
   WHERE id = _patient_id;

  PERFORM public.advance_journey(
    _patient_id, 'awaiting_room', 'nurse', NULL, 'nurse', 'Awaiting Room', _visit,
    'Admission requested'
  );

  PERFORM public.write_audit_log(
    'admission_requested', 'admission', _adm::text,
    jsonb_build_object('patient_id', _patient_id, 'snap_id', _snap, 'reason', _reason)
  );
  RETURN _adm;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_admission_bed(_admission_id uuid, _bed_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _adm RECORD;
  _bed RECORD;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only a nurse or admin can assign a ward/room/bed';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF _adm.status <> 'waiting_assignment' THEN
    RAISE EXCEPTION 'Admission is not waiting for a room (%)', _adm.status;
  END IF;

  SELECT * INTO _bed FROM public.beds WHERE id = _bed_id FOR UPDATE;
  IF _bed IS NULL OR NOT _bed.active THEN RAISE EXCEPTION 'Bed not found or inactive'; END IF;
  IF _bed.status <> 'available' THEN RAISE EXCEPTION 'Bed is not available'; END IF;

  UPDATE public.admissions
     SET bed_id = _bed_id,
         assigned_by_nurse = _uid,
         status = 'active',
         admitted_at = now(),
         updated_at = now()
   WHERE id = _admission_id;

  UPDATE public.patients
     SET status = 'admitted', updated_at = now()
   WHERE id = _adm.patient_id;

  PERFORM public.advance_journey(
    _adm.patient_id, 'admitted', 'nurse', NULL, 'ward', 'Ward', _adm.visit_id,
    'Bed assigned'
  );

  PERFORM public.write_audit_log(
    'admission_bed_assigned', 'admission', _admission_id::text,
    jsonb_build_object('patient_id', _adm.patient_id, 'bed_id', _bed_id)
  );
END;
$$;

-- Backfill: patients with an open admission should not sit in station queues.
UPDATE public.patients p
   SET status = 'awaiting_room', updated_at = now()
  FROM public.admissions a
 WHERE a.patient_id = p.id
   AND a.status = 'waiting_assignment'
   AND p.status IN ('waiting','with_nurse','with_doctor');

UPDATE public.patients p
   SET status = 'admitted', updated_at = now()
  FROM public.admissions a
 WHERE a.patient_id = p.id
   AND a.status IN ('active','ready_for_discharge')
   AND p.status IN ('waiting','with_nurse','with_doctor','awaiting_room');

-- ================================================================
-- 20260731103100_1d792087-ad8d-47ab-bf6f-3e70194c6bdf.sql
-- ================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['prescription_items','standing_orders','vitals','admissions','snap_orders','visit_attachments','balance_requests','rooms','stock_requests','visits','lab_requests','task_claims','invoice_items','patients','patient_journey','notifications','wards','prescriptions','invoices','eligibility_verifications','beds']
  LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY DEFAULT', t);
  END LOOP;
END $$;

-- ================================================================
-- 20260731113357_94fc5b37-7c7f-47e0-ba06-863b9c7fa4fe.sql
-- ================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
           t.typname = 'trigger' AS is_trigger
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_type t ON t.oid = p.prorettype
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', r.proname, r.args);
    IF NOT r.is_trigger THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', r.proname, r.args);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', r.proname, r.args);
  END LOOP;
END $$;

-- ================================================================
-- 20260731113842_2e4d8c37-d475-4fa3-831b-fe8246def08b.sql
-- ================================================================
-- Field-level authorisation for patient record updates -----------------------
CREATE OR REPLACE FUNCTION public.enforce_patient_field_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _old jsonb := to_jsonb(OLD);
  _new jsonb := to_jsonb(NEW);
  _key text;
  _identity_cols  text[] := ARRAY['first_name','last_name','date_of_birth','gender','phone','address','emergency_contact','occupation','photo_path'];
  _card_cols      text[] := ARRAY['card_number','mini_card_number'];
  _sponsor_cols   text[] := ARRAY['account_type','corporate_id','insurance_provider','insurance_plan','insurance_policy_number','enrollee_id','member_id_data','staff_link_id'];
  _clinical_cols  text[] := ARRAY['blood_group','allergies'];
BEGIN
  -- service_role / backend jobs (no auth context) are unaffected
  IF _uid IS NULL THEN RETURN NEW; END IF;
  IF public.has_role(_uid, 'admin'::app_role) THEN RETURN NEW; END IF;

  FOR _key IN
    SELECT k FROM jsonb_object_keys(_new) AS k
    WHERE (_new -> k) IS DISTINCT FROM (_old -> k)
  LOOP
    IF _key = ANY(_identity_cols) THEN
      IF NOT public.has_role(_uid, 'receptionist'::app_role) THEN
        RAISE EXCEPTION 'NOT_PERMITTED: only reception or an admin can change patient personal details (%)', _key;
      END IF;

    ELSIF _key = ANY(_card_cols) THEN
      RAISE EXCEPTION 'NOT_PERMITTED: only an admin can change patient card numbers (%)', _key;

    ELSIF _key = ANY(_sponsor_cols) THEN
      IF NOT public.has_any_role(_uid, ARRAY['receptionist','billing','accountant','claims_manager']::app_role[]) THEN
        RAISE EXCEPTION 'NOT_PERMITTED: only reception, billing, accounts or claims staff can change sponsor/insurance details (%)', _key;
      END IF;

    ELSIF _key = ANY(_clinical_cols) THEN
      IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','anc']::app_role[]) THEN
        RAISE EXCEPTION 'NOT_PERMITTED: only clinical staff can change clinical details (%)', _key;
      END IF;

    ELSIF _key = 'balance' THEN
      IF COALESCE(current_setting('app.allow_balance_write', true), '') <> 'on'
         AND NOT public.has_any_role(_uid, ARRAY['billing','cashier','accountant']::app_role[]) THEN
        RAISE EXCEPTION 'NOT_PERMITTED: patient balance can only be changed by billing/cashier/accounts or through a payment routine';
      END IF;
    END IF;
    -- remaining columns (status, assigned_doctor, last_visit, timestamps) stay
    -- open to any authenticated staff so the patient queues keep working.
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_patient_field_permissions() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_patients_field_permissions ON public.patients;
CREATE TRIGGER trg_patients_field_permissions
  BEFORE UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.enforce_patient_field_permissions();

-- Allow the sanctioned wallet routines to write balance regardless of role ----
CREATE OR REPLACE FUNCTION public.adjust_patient_balance(_patient_id uuid, _delta numeric, _transaction_type text, _payment_method text DEFAULT NULL::text, _related_request_id uuid DEFAULT NULL::uuid, _related_invoice_id uuid DEFAULT NULL::uuid, _notes text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _before NUMERIC;
  _after NUMERIC;
BEGIN
  SELECT balance INTO _before FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _before IS NULL THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;
  _after := _before + _delta;
  -- Only 'debt_incurred' transactions may push balance negative (short payments)
  IF _after < 0 AND _transaction_type <> 'debt_incurred' THEN
    RAISE EXCEPTION 'Insufficient balance (current: %, requested delta: %)', _before, _delta;
  END IF;
  PERFORM set_config('app.allow_balance_write', 'on', true);
  UPDATE public.patients SET balance = _after, updated_at = now() WHERE id = _patient_id;
  PERFORM set_config('app.allow_balance_write', 'off', true);
  INSERT INTO public.balance_transactions
    (patient_id, transaction_type, amount, balance_before, balance_after, payment_method, related_request_id, related_invoice_id, performed_by, notes)
  VALUES
    (_patient_id, _transaction_type, _delta, _before, _after, _payment_method, _related_request_id, _related_invoice_id, auth.uid(), _notes);
  RETURN _after;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_admitted_snap(_patient_id uuid, _order_type text, _target_station text, _photo_path text, _note text, _items jsonb, _total numeric, _allow_debt boolean DEFAULT false, _debt_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid UUID := auth.uid();
  _visit UUID;
  _admission UUID;
  _bal NUMERIC;
  _snap_id UUID;
  _new_bal NUMERIC;
  _debt NUMERIC := 0;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT id INTO _admission FROM public.admissions
   WHERE patient_id = _patient_id AND status = 'active' LIMIT 1;
  IF _admission IS NULL THEN
    RAISE EXCEPTION 'Patient is not currently admitted';
  END IF;

  SELECT id INTO _visit FROM public.visits
   WHERE patient_id = _patient_id AND status = 'open'
   ORDER BY opened_at DESC LIMIT 1;

  SELECT balance INTO _bal FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _bal IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  IF _bal < _total THEN
    IF NOT _allow_debt THEN
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE: balance % < required %', _bal, _total;
    END IF;
    IF _debt_reason IS NULL OR length(trim(_debt_reason)) < 3 THEN
      RAISE EXCEPTION 'Debt override requires a reason';
    END IF;
    _debt := _total - _bal;
  END IF;

  -- Deduct (allowed to go negative when overriding)
  _new_bal := _bal - _total;
  PERFORM set_config('app.allow_balance_write', 'on', true);
  UPDATE public.patients SET balance = _new_bal, updated_at = now() WHERE id = _patient_id;
  PERFORM set_config('app.allow_balance_write', 'off', true);
  INSERT INTO public.balance_transactions
    (patient_id, transaction_type, amount, balance_before, balance_after, performed_by, notes)
  VALUES
    (_patient_id, CASE WHEN _debt > 0 THEN 'debt_incurred' ELSE 'admitted_deduction' END,
     -_total, _bal, _new_bal, _uid,
     CASE WHEN _debt > 0
          THEN 'Admitted in-ward ' || _order_type || ' (debt ₦' || _debt || '): ' || COALESCE(_debt_reason,'')
          ELSE 'Admitted in-ward ' || _order_type END);

  INSERT INTO public.snap_orders (
    patient_id, visit_id, order_type, target_station, source_role,
    photo_path, note, matched_items, status, created_by,
    is_admitted_snap, debt_amount, debt_reason,
    billed_by, billed_at, paid_at, original_sender_role
  ) VALUES (
    _patient_id, _visit, _order_type, _target_station,
    (SELECT role::text FROM public.user_roles WHERE user_id = _uid LIMIT 1),
    _photo_path, _note, COALESCE(_items, '[]'::jsonb),
    'paid', _uid, true, _debt, _debt_reason,
    _uid, now(), now(),
    (SELECT role::text FROM public.user_roles WHERE user_id = _uid LIMIT 1)
  ) RETURNING id INTO _snap_id;

  PERFORM public.write_audit_log(
    CASE WHEN _debt > 0 THEN 'admitted_snap_debt' ELSE 'admitted_snap_created' END,
    'snap_order', _snap_id::text,
    jsonb_build_object(
      'patient_id', _patient_id, 'total', _total, 'debt', _debt,
      'balance_after', _new_bal, 'reason', _debt_reason,
      'target_station', _target_station, 'order_type', _order_type
    )
  );

  RETURN _snap_id;
END; $function$;

REVOKE ALL ON FUNCTION public.adjust_patient_balance(uuid, numeric, text, text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_patient_balance(uuid, numeric, text, text, uuid, uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_admitted_snap(uuid, text, text, text, text, jsonb, numeric, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_admitted_snap(uuid, text, text, text, text, jsonb, numeric, boolean, text) TO authenticated, service_role;

-- ================================================================
-- 20260731165524_c2b319f4-484d-467b-9982-f3941ca8a4c1.sql
-- ================================================================
-- 1. Patients: restrict UPDATE to operational roles (exclude 'store')
DROP POLICY IF EXISTS "Staff can update patients" ON public.patients;
CREATE POLICY "Operational staff can update patients"
ON public.patients FOR UPDATE TO authenticated
USING (has_any_role(auth.uid(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','anc','lab_tech','pharmacist','billing','cashier','accountant','claims_manager','admin']::app_role[]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','anc','lab_tech','pharmacist','billing','cashier','accountant','claims_manager','admin']::app_role[]));

-- 2. Invoices / invoice_items: scope SELECT to roles that need billing visibility
DROP POLICY IF EXISTS "Authenticated staff can read invoices" ON public.invoices;
CREATE POLICY "Billing-relevant staff can read invoices"
ON public.invoices FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','anc','billing','cashier','accountant','claims_manager','admin']::app_role[]));

DROP POLICY IF EXISTS "Authenticated staff can read invoice_items" ON public.invoice_items;
CREATE POLICY "Billing-relevant staff can read invoice_items"
ON public.invoice_items FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','anc','billing','cashier','accountant','claims_manager','admin']::app_role[]));

-- 3. Eligibility verifications: limit PII to roles that handle eligibility
DROP POLICY IF EXISTS "staff_view_eligibility" ON public.eligibility_verifications;
CREATE POLICY "eligibility_roles_view_eligibility"
ON public.eligibility_verifications FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['receptionist','claims_manager','billing','admin']::app_role[]));

-- 4. Staff: remove billing role's access to salary/bank data
DROP POLICY IF EXISTS "Admin and account can read staff" ON public.staff;
CREATE POLICY "Admin and accountant can read staff"
ON public.staff FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]));

-- 5. Non-sensitive staff directory for everyone else (used by the reception staff picker)
CREATE OR REPLACE VIEW public.staff_directory
WITH (security_invoker = off) AS
SELECT id, employee_id, first_name, last_name, role, department, status, family_deduction_consent
FROM public.staff;

REVOKE ALL ON public.staff_directory FROM PUBLIC, anon;
GRANT SELECT ON public.staff_directory TO authenticated;
GRANT ALL ON public.staff_directory TO service_role;

-- ================================================================
-- 20260731165539_48aebc8d-ba2a-41ec-96cd-5324cbc2539e.sql
-- ================================================================
DROP VIEW IF EXISTS public.staff_directory;

CREATE OR REPLACE FUNCTION public.get_staff_directory()
RETURNS TABLE (
  id uuid,
  employee_id text,
  first_name text,
  last_name text,
  role text,
  department text,
  status text,
  family_deduction_consent boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.employee_id, s.first_name, s.last_name, s.role, s.department, s.status, s.family_deduction_consent
  FROM public.staff s
  WHERE public.is_authenticated_staff()
$$;

REVOKE ALL ON FUNCTION public.get_staff_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_directory() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_staff_directory() TO service_role;

-- ================================================================
-- 20260731171335_7eeec626-5509-47f0-9d65-4288527239b0.sql
-- ================================================================
CREATE OR REPLACE FUNCTION public.forward_snap_to_billing(
  _source_snap_id uuid,
  _target_station text,
  _note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _src RECORD;
  _new uuid;
  _role text;
  _order_type text;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _target_station NOT IN ('pharmacy','lab') THEN
    RAISE EXCEPTION 'Target must be pharmacy or lab';
  END IF;

  SELECT * INTO _src FROM public.snap_orders WHERE id = _source_snap_id;
  IF _src IS NULL THEN RAISE EXCEPTION 'Source snap not found'; END IF;

  _order_type := CASE _target_station WHEN 'lab' THEN 'lab' ELSE 'prescription' END;
  SELECT role::text INTO _role FROM public.user_roles WHERE user_id = _uid LIMIT 1;

  INSERT INTO public.snap_orders (
    patient_id, visit_id, order_type, target_station, source_role,
    photo_path, note, status, created_by, original_sender_role,
    parent_snap_id, matched_items, ocr_text, ocr_confidence
  ) VALUES (
    _src.patient_id, _src.visit_id, _order_type, _target_station,
    COALESCE(_role, _src.source_role),
    _src.photo_path,
    COALESCE(_note, 'Forwarded from admitted patient snap'),
    'pending_billing', _uid, COALESCE(_role, _src.source_role),
    _src.id, COALESCE(_src.matched_items, '[]'::jsonb),
    _src.ocr_text, _src.ocr_confidence
  ) RETURNING id INTO _new;

  IF _src.target_station IN ('nurse','doctor') AND _src.status = 'pending_billing' THEN
    UPDATE public.snap_orders
       SET status = 'acknowledged',
           ack_by = _uid,
           ack_at = now(),
           updated_at = now()
     WHERE id = _src.id;
  END IF;

  PERFORM public.write_audit_log(
    'snap_forwarded_to_billing', 'snap_order', _new::text,
    jsonb_build_object(
      'source_snap_id', _src.id,
      'patient_id', _src.patient_id,
      'target_station', _target_station
    )
  );
  RETURN _new;
END $$;

REVOKE ALL ON FUNCTION public.forward_snap_to_billing(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forward_snap_to_billing(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forward_snap_to_billing(uuid, text, text) TO service_role;

-- ================================================================
-- 20260801123831_206bf5e9-22e7-483e-87ef-ba91061e55e9.sql
-- ================================================================
CREATE OR REPLACE FUNCTION public.create_admitted_snap(_patient_id uuid, _order_type text, _target_station text, _photo_path text, _note text, _items jsonb, _total numeric, _allow_debt boolean DEFAULT false, _debt_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid UUID := auth.uid();
  _visit UUID;
  _admission UUID;
  _bal NUMERIC;
  _snap_id UUID;
  _new_bal NUMERIC;
  _debt NUMERIC := 0;
  _invoice UUID;
  _role TEXT;
  _acct TEXT;
  _corp UUID;
  _sponsor TEXT;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT id INTO _admission FROM public.admissions
   WHERE patient_id = _patient_id AND status IN ('active','ready_for_discharge')
   ORDER BY admitted_at DESC NULLS LAST LIMIT 1;
  IF _admission IS NULL THEN
    RAISE EXCEPTION 'Patient is not currently admitted';
  END IF;

  SELECT id INTO _visit FROM public.visits
   WHERE patient_id = _patient_id AND status = 'open'
   ORDER BY opened_at DESC LIMIT 1;

  SELECT balance, lower(coalesce(account_type,'')), corporate_id
    INTO _bal, _acct, _corp
    FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _bal IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  IF _bal < _total THEN
    IF NOT _allow_debt THEN
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE: balance % < required %', _bal, _total;
    END IF;
    IF _debt_reason IS NULL OR length(trim(_debt_reason)) < 3 THEN
      RAISE EXCEPTION 'Debt override requires a reason';
    END IF;
    _debt := _total - _bal;
  END IF;

  SELECT role::text INTO _role FROM public.user_roles WHERE user_id = _uid LIMIT 1;

  _sponsor := CASE
    WHEN _acct IN ('corporate','retainer') THEN _acct
    WHEN _acct IN ('cash','normal','') THEN NULL
    ELSE _acct END;

  -- Invoice for the in-ward charge (settled from the wallet immediately)
  INSERT INTO public.invoices (
    patient_id, invoice_number, total_amount, original_amount, paid_amount,
    status, payment_method, notes, visit_id, paid_at,
    sponsor_type, corporate_account_id, created_by
  ) VALUES (
    _patient_id, '', _total, _total, _total,
    'paid', 'wallet',
    'In-ward ' || _order_type || ' (admitted snap)' ||
      CASE WHEN _debt > 0 THEN ' — debt ₦' || _debt ELSE '' END,
    _visit, now(), _sponsor,
    CASE WHEN _acct IN ('corporate','retainer') THEN _corp ELSE NULL END,
    _role
  ) RETURNING id INTO _invoice;

  IF jsonb_typeof(COALESCE(_items,'[]'::jsonb)) = 'array' THEN
    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
    SELECT _invoice,
           COALESCE(it->>'name', 'Item'),
           GREATEST(COALESCE((it->>'qty')::int, 1), 1),
           COALESCE((it->>'unit_price')::numeric, 0),
           GREATEST(COALESCE((it->>'qty')::int, 1), 1) * COALESCE((it->>'unit_price')::numeric, 0),
           COALESCE(it->>'category', _order_type)
    FROM jsonb_array_elements(_items) AS it;
  END IF;

  -- Deduct (allowed to go negative when overriding)
  _new_bal := _bal - _total;
  PERFORM set_config('app.allow_balance_write', 'on', true);
  UPDATE public.patients SET balance = _new_bal, updated_at = now() WHERE id = _patient_id;
  PERFORM set_config('app.allow_balance_write', 'off', true);
  INSERT INTO public.balance_transactions
    (patient_id, transaction_type, amount, balance_before, balance_after, performed_by, related_invoice_id, notes)
  VALUES
    (_patient_id, CASE WHEN _debt > 0 THEN 'debt_incurred' ELSE 'admitted_deduction' END,
     -_total, _bal, _new_bal, _uid, _invoice,
     CASE WHEN _debt > 0
          THEN 'Admitted in-ward ' || _order_type || ' (debt ₦' || _debt || '): ' || COALESCE(_debt_reason,'')
          ELSE 'Admitted in-ward ' || _order_type END);

  INSERT INTO public.snap_orders (
    patient_id, visit_id, order_type, target_station, source_role,
    photo_path, note, matched_items, status, created_by,
    is_admitted_snap, debt_amount, debt_reason,
    invoice_id, billed_by, billed_at, paid_at, original_sender_role
  ) VALUES (
    _patient_id, _visit, _order_type, _target_station, _role,
    _photo_path, _note, COALESCE(_items, '[]'::jsonb),
    'paid', _uid, true, _debt, _debt_reason,
    _invoice, _uid, now(), now(), _role
  ) RETURNING id INTO _snap_id;

  PERFORM public.write_audit_log(
    CASE WHEN _debt > 0 THEN 'admitted_snap_debt' ELSE 'admitted_snap_created' END,
    'snap_order', _snap_id::text,
    jsonb_build_object(
      'patient_id', _patient_id, 'total', _total, 'debt', _debt,
      'balance_after', _new_bal, 'reason', _debt_reason,
      'invoice_id', _invoice,
      'target_station', _target_station, 'order_type', _order_type
    )
  );

  RETURN _snap_id;
END; $function$;

REVOKE EXECUTE ON FUNCTION public.create_admitted_snap(uuid,text,text,text,text,jsonb,numeric,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_admitted_snap(uuid,text,text,text,text,jsonb,numeric,boolean,text) TO authenticated, service_role;

-- ================================================================
-- 20260801145936_b47dfac3-72ad-49da-b1ee-b0957d6f5d17.sql
-- ================================================================
CREATE OR REPLACE FUNCTION public.forward_snap_to_billing(_source_snap_id uuid, _target_station text, _note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _src RECORD;
  _new uuid;
  _role text;
  _order_type text;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _target_station NOT IN ('pharmacy','lab') THEN
    RAISE EXCEPTION 'Target must be pharmacy or lab';
  END IF;

  SELECT * INTO _src FROM public.snap_orders WHERE id = _source_snap_id;
  IF _src IS NULL THEN RAISE EXCEPTION 'Source snap not found'; END IF;

  -- Admission-order snaps are single-use: once forwarded (or acknowledged)
  -- they are consumed and live only on the patient's card.
  IF _src.intent = 'admission_order' THEN
    IF _src.ack_at IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.snap_orders c WHERE c.parent_snap_id = _src.id) THEN
      RAISE EXCEPTION 'ADMISSION_SNAP_ALREADY_USED: this admission snap has already been used. Take a new snap.';
    END IF;
  END IF;

  _order_type := CASE _target_station WHEN 'lab' THEN 'lab' ELSE 'prescription' END;
  SELECT role::text INTO _role FROM public.user_roles WHERE user_id = _uid LIMIT 1;

  INSERT INTO public.snap_orders (
    patient_id, visit_id, order_type, target_station, source_role,
    photo_path, note, status, created_by, original_sender_role,
    parent_snap_id, matched_items, ocr_text, ocr_confidence
  ) VALUES (
    _src.patient_id, _src.visit_id, _order_type, _target_station,
    COALESCE(_role, _src.source_role),
    _src.photo_path,
    COALESCE(_note, 'Forwarded from admitted patient snap'),
    'pending_billing', _uid, COALESCE(_role, _src.source_role),
    _src.id, COALESCE(_src.matched_items, '[]'::jsonb),
    _src.ocr_text, _src.ocr_confidence
  ) RETURNING id INTO _new;

  IF _src.intent = 'admission_order'
     OR (_src.target_station IN ('nurse','doctor') AND _src.status = 'pending_billing') THEN
    UPDATE public.snap_orders
       SET status = 'acknowledged',
           ack_by = _uid,
           ack_at = now(),
           updated_at = now()
     WHERE id = _src.id;
  END IF;

  PERFORM public.write_audit_log(
    'snap_forwarded_to_billing', 'snap_order', _new::text,
    jsonb_build_object(
      'source_snap_id', _src.id,
      'patient_id', _src.patient_id,
      'target_station', _target_station
    )
  );
  RETURN _new;
END $function$;

REVOKE EXECUTE ON FUNCTION public.forward_snap_to_billing(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forward_snap_to_billing(uuid, text, text) TO authenticated, service_role;

-- ================================================================
-- 20260801161124_33e96e34-a337-417d-bcce-7a32f89e972b.sql
-- ================================================================
ALTER TABLE public.snap_orders ALTER COLUMN photo_path DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.create_admitted_snap(_patient_id uuid, _order_type text, _target_station text, _photo_path text, _note text, _items jsonb, _total numeric, _allow_debt boolean DEFAULT false, _debt_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid UUID := auth.uid();
  _visit UUID;
  _admission UUID;
  _bal NUMERIC;
  _snap_id UUID;
  _new_bal NUMERIC;
  _debt NUMERIC := 0;
  _invoice UUID;
  _role TEXT;
  _acct TEXT;
  _plan TEXT;
  _corp UUID;
  _sponsor TEXT;
  _pct NUMERIC;
  _patient_share NUMERIC;
  _covered NUMERIC;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT id INTO _admission FROM public.admissions
   WHERE patient_id = _patient_id AND status IN ('active','ready_for_discharge')
   ORDER BY admitted_at DESC NULLS LAST LIMIT 1;
  IF _admission IS NULL THEN
    RAISE EXCEPTION 'Patient is not currently admitted';
  END IF;

  SELECT id INTO _visit FROM public.visits
   WHERE patient_id = _patient_id AND status = 'open'
   ORDER BY opened_at DESC LIMIT 1;

  SELECT balance, lower(coalesce(account_type,'')), insurance_plan, corporate_id
    INTO _bal, _acct, _plan, _corp
    FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _bal IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  -- Sponsor split: the wallet is only charged the patient's own share.
  _pct := public.copay_percent(_acct, _plan);
  _patient_share := round(COALESCE(_total,0) * _pct / 100.0, 2);
  _covered := GREATEST(0, round(COALESCE(_total,0) - _patient_share, 2));

  IF _bal < _patient_share THEN
    IF NOT _allow_debt THEN
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE: balance % < required %', _bal, _patient_share;
    END IF;
    IF _debt_reason IS NULL OR length(trim(_debt_reason)) < 3 THEN
      RAISE EXCEPTION 'Debt override requires a reason';
    END IF;
    _debt := _patient_share - _bal;
  END IF;

  SELECT role::text INTO _role FROM public.user_roles WHERE user_id = _uid LIMIT 1;

  _sponsor := CASE
    WHEN _acct IN ('corporate','retainer') THEN _acct
    WHEN _acct IN ('cash','normal','') THEN NULL
    ELSE _acct END;

  INSERT INTO public.invoices (
    patient_id, invoice_number, total_amount, original_amount, discount_amount, paid_amount,
    status, payment_method, notes, visit_id, paid_at,
    sponsor_type, corporate_account_id, created_by
  ) VALUES (
    _patient_id, '', _total, _total, 0, _patient_share,
    'paid', 'wallet',
    'In-ward ' || _order_type || ' (admitted order)' ||
      CASE WHEN _covered > 0 THEN ' — sponsor covered ₦' || _covered ELSE '' END ||
      CASE WHEN _debt > 0 THEN ' — debt ₦' || _debt ELSE '' END,
    _visit, now(), _sponsor,
    CASE WHEN _acct IN ('corporate','retainer') THEN _corp ELSE NULL END,
    _role
  ) RETURNING id INTO _invoice;

  IF jsonb_typeof(COALESCE(_items,'[]'::jsonb)) = 'array' THEN
    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
    SELECT _invoice,
           COALESCE(it->>'name', 'Item'),
           GREATEST(COALESCE((it->>'qty')::int, 1), 1),
           COALESCE((it->>'unit_price')::numeric, 0),
           GREATEST(COALESCE((it->>'qty')::int, 1), 1) * COALESCE((it->>'unit_price')::numeric, 0),
           COALESCE(it->>'category', _order_type)
    FROM jsonb_array_elements(_items) AS it;
  END IF;

  _new_bal := _bal - _patient_share;
  IF _patient_share <> 0 THEN
    PERFORM set_config('app.allow_balance_write', 'on', true);
    UPDATE public.patients SET balance = _new_bal, updated_at = now() WHERE id = _patient_id;
    PERFORM set_config('app.allow_balance_write', 'off', true);
    INSERT INTO public.balance_transactions
      (patient_id, transaction_type, amount, balance_before, balance_after, performed_by, related_invoice_id, notes)
    VALUES
      (_patient_id, CASE WHEN _debt > 0 THEN 'debt_incurred' ELSE 'admitted_deduction' END,
       -_patient_share, _bal, _new_bal, _uid, _invoice,
       CASE WHEN _debt > 0
            THEN 'Admitted in-ward ' || _order_type || ' (debt ₦' || _debt || '): ' || COALESCE(_debt_reason,'')
            ELSE 'Admitted in-ward ' || _order_type END);
  END IF;

  INSERT INTO public.snap_orders (
    patient_id, visit_id, order_type, target_station, source_role,
    photo_path, note, matched_items, status, created_by,
    is_admitted_snap, debt_amount, debt_reason,
    invoice_id, billed_by, billed_at, paid_at, original_sender_role
  ) VALUES (
    _patient_id, _visit, _order_type, _target_station, _role,
    NULLIF(_photo_path,''), _note, COALESCE(_items, '[]'::jsonb),
    'paid', _uid, true, _debt, _debt_reason,
    _invoice, _uid, now(), now(), _role
  ) RETURNING id INTO _snap_id;

  PERFORM public.write_audit_log(
    CASE WHEN _debt > 0 THEN 'admitted_snap_debt' ELSE 'admitted_snap_created' END,
    'snap_order', _snap_id::text,
    jsonb_build_object(
      'patient_id', _patient_id, 'total', _total,
      'patient_share', _patient_share, 'sponsor_covered', _covered,
      'debt', _debt, 'balance_after', _new_bal, 'reason', _debt_reason,
      'invoice_id', _invoice, 'has_photo', (_photo_path IS NOT NULL),
      'target_station', _target_station, 'order_type', _order_type
    )
  );

  RETURN _snap_id;
END; $function$;

REVOKE EXECUTE ON FUNCTION public.create_admitted_snap(uuid,text,text,text,text,jsonb,numeric,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_admitted_snap(uuid,text,text,text,text,jsonb,numeric,boolean,text) TO authenticated, service_role;

-- ================================================================
-- 20260802155407_bd40c7ae-1465-4b0e-9a6e-cb1eb220ea05.sql
-- ================================================================
-- 1. Calendar-night based bed charge
CREATE OR REPLACE FUNCTION public.admission_bed_charge(_admission_id uuid)
 RETURNS TABLE(days integer, daily_rate numeric, amount numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    GREATEST(1, (COALESCE(a.discharged_at, now())::date - COALESCE(a.admitted_at, a.created_at)::date))::int,
    COALESCE(r.daily_rate, 0)::numeric,
    ROUND(GREATEST(1, (COALESCE(a.discharged_at, now())::date - COALESCE(a.admitted_at, a.created_at)::date)) * COALESCE(r.daily_rate, 0), 2)::numeric
  FROM public.admissions a
  LEFT JOIN public.beds b ON b.id = a.bed_id
  LEFT JOIN public.rooms r ON r.id = b.room_id
  WHERE a.id = _admission_id;
$function$;

-- 2. Bed billing must never hard-fail on insufficient balance
CREATE OR REPLACE FUNCTION public.bill_admission_bed_days(_admission_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD;
  _p RECORD;
  _room RECORD;
  _days int;
  _rate numeric;
  _amount numeric;
  _pct numeric;
  _copay numeric;
  _inv uuid;
  _bal numeric;
  _from_wallet numeric;
  _debt numeric;
BEGIN
  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id;
  IF _adm IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id;
  IF _p IS NULL THEN RETURN NULL; END IF;

  SELECT d.days, d.daily_rate, d.amount INTO _days, _rate, _amount
  FROM public.admission_bed_charge(_admission_id) d;

  IF COALESCE(_amount, 0) <= 0 THEN RETURN NULL; END IF;

  SELECT id INTO _inv FROM public.invoices
  WHERE patient_id = _adm.patient_id
    AND notes = 'BED_DAYS:' || _admission_id::text
  LIMIT 1;
  IF _inv IS NOT NULL THEN RETURN _inv; END IF;

  _pct := public.copay_percent(_p.account_type, _p.insurance_plan);
  _copay := ROUND(_amount * _pct / 100.0, 2);

  SELECT r.room_number, r.room_class INTO _room
  FROM public.beds b JOIN public.rooms r ON r.id = b.room_id
  WHERE b.id = _adm.bed_id;

  INSERT INTO public.invoices (
    patient_id, visit_id, total_amount, original_amount, discount_amount,
    paid_amount, status, sponsor_type, corporate_account_id, notes
  ) VALUES (
    _adm.patient_id, _adm.visit_id, _amount, _amount, 0,
    0, 'pending',
    CASE WHEN _pct < 100 THEN _p.account_type ELSE NULL END,
    _p.corporate_id,
    'BED_DAYS:' || _admission_id::text
  ) RETURNING id INTO _inv;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
  VALUES (
    _inv,
    'Bed charge - ' || COALESCE(_room.room_class, 'ward') || ' - ' || _days || ' night(s)',
    _days, _rate, _amount, 'admission'
  );

  IF _copay > 0 THEN
    SELECT balance INTO _bal FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
    _from_wallet := ROUND(LEAST(GREATEST(COALESCE(_bal,0), 0), _copay), 2);
    _debt := ROUND(_copay - _from_wallet, 2);

    IF _from_wallet > 0 THEN
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, -_from_wallet, 'invoice_payment', NULL, NULL, _inv,
        'Bed charge for admission (' || _days || ' night(s))'
      );
    END IF;

    IF _debt > 0 THEN
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, -_debt, 'debt_incurred', NULL, NULL, _inv,
        'Bed charge shortfall on discharge (' || _days || ' night(s))'
      );
    END IF;

    UPDATE public.invoices
      SET paid_amount = _from_wallet,
          status = CASE WHEN _from_wallet >= _amount THEN 'paid'
                        WHEN _from_wallet > 0 THEN 'partial'
                        ELSE 'pending' END,
          paid_at = CASE WHEN _from_wallet >= _amount THEN now() ELSE NULL END
      WHERE id = _inv;
  END IF;

  RETURN _inv;
END;
$function$;

-- 3. Discharge preview (server-side source of truth)
CREATE OR REPLACE FUNCTION public.admission_discharge_preview(_admission_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD;
  _p RECORD;
  _nights int; _rate numeric; _bed_total numeric;
  _pct numeric; _share numeric; _covered numeric;
  _bal numeric; _prior numeric; _already boolean;
  _due numeric; _after numeric;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
       ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','cashier','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id;

  SELECT d.days, d.daily_rate, d.amount INTO _nights, _rate, _bed_total
  FROM public.admission_bed_charge(_admission_id) d;

  _pct := public.copay_percent(_p.account_type, _p.insurance_plan);
  _share := ROUND(COALESCE(_bed_total,0) * _pct / 100.0, 2);
  _covered := ROUND(GREATEST(0, COALESCE(_bed_total,0) - _share), 2);

  SELECT EXISTS (
    SELECT 1 FROM public.invoices
    WHERE patient_id = _adm.patient_id
      AND notes = 'BED_DAYS:' || _admission_id::text
  ) INTO _already;

  IF _already THEN
    _share := 0; _covered := 0;
  END IF;

  _bal := COALESCE(_p.balance, 0);
  _prior := ROUND(GREATEST(0, -_bal), 2);
  _after := ROUND(_bal - _share, 2);
  _due := ROUND(GREATEST(0, -_after), 2);

  RETURN jsonb_build_object(
    'admission_id', _admission_id,
    'patient_id', _adm.patient_id,
    'admitted_at', COALESCE(_adm.admitted_at, _adm.created_at),
    'nights', COALESCE(_nights, 0),
    'daily_rate', COALESCE(_rate, 0),
    'bed_total', COALESCE(_bed_total, 0),
    'bed_already_billed', _already,
    'copay_pct', _pct,
    'sponsor_covered', _covered,
    'bed_patient_share', _share,
    'current_balance', _bal,
    'prior_outstanding', _prior,
    'total_due', _due,
    'balance_after_bed', _after
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admission_discharge_preview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admission_discharge_preview(uuid) TO authenticated, service_role;

-- 4. Discharge with partial settlement + carry
DROP FUNCTION IF EXISTS public.discharge_admission(uuid, text, text, numeric, text);

CREATE OR REPLACE FUNCTION public.discharge_admission(_admission_id uuid, _notes text DEFAULT NULL::text, _settlement_method text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0, _settlement_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD;
  _bal numeric;
  _debt numeric;
  _collected numeric := 0;
  _remaining numeric := 0;
  _inv RECORD;
  _apply numeric;
  _left numeric;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
       ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to discharge';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF _adm.status NOT IN ('active','ready_for_discharge') THEN
    RAISE EXCEPTION 'Admission is not active (%)', _adm.status;
  END IF;

  -- Accrued bed charge is billed here (once per admission); never fails on low balance
  PERFORM public.bill_admission_bed_days(_admission_id);

  SELECT balance INTO _bal FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
  _debt := ROUND(GREATEST(0, -COALESCE(_bal,0)), 2);
  _remaining := _debt;

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash','pos','transfer') THEN
      _collected := ROUND(GREATEST(COALESCE(_settlement_amount,0), 0), 2);
      IF _collected <= 0 THEN
        RAISE EXCEPTION 'Settlement amount must be greater than zero';
      END IF;
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, _collected, 'debt_cleared', _settlement_method,
        NULL, NULL, COALESCE(_settlement_notes, 'Discharge settlement')
      );
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
      IF _remaining > 0 THEN
        IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
          RAISE EXCEPTION 'PARTIAL_REASON_REQUIRED: provide a reason for the outstanding %', _remaining;
        END IF;
        PERFORM public.write_audit_log(
          'discharge_partial_settlement', 'admission', _admission_id::text,
          jsonb_build_object('patient_id', _adm.patient_id, 'debt', _debt,
                             'collected', _collected, 'outstanding', _remaining,
                             'method', _settlement_method, 'notes', _settlement_notes)
        );
      END IF;

    ELSIF _settlement_method = 'waive' THEN
      IF NOT public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]) THEN
        RAISE EXCEPTION 'Only accountant/admin can waive debt';
      END IF;
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, _debt, 'debt_cleared', 'waive',
        NULL, NULL, COALESCE(_settlement_notes, 'Discharge - debt waived')
      );
      _remaining := 0;

    ELSIF _settlement_method = 'carry' THEN
      IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
        RAISE EXCEPTION 'CARRY_REASON_REQUIRED: provide a reason for carrying the debt';
      END IF;
      PERFORM public.write_audit_log(
        'debt_carried_on_discharge', 'admission', _admission_id::text,
        jsonb_build_object('patient_id', _adm.patient_id, 'debt', _debt, 'notes', _settlement_notes)
      );
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  -- Apply money actually received (cash/pos/transfer or waive) to unpaid invoices, oldest first
  _left := CASE WHEN _settlement_method IN ('cash','pos','transfer') THEN _collected
                WHEN _settlement_method = 'waive' THEN _debt
                ELSE 0 END;
  IF _left > 0 THEN
    FOR _inv IN
      SELECT id, total_amount, COALESCE(paid_amount,0) AS paid
      FROM public.invoices
      WHERE patient_id = _adm.patient_id
        AND status IN ('pending','partial')
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN _left <= 0;
      _apply := ROUND(LEAST(_left, _inv.total_amount - _inv.paid), 2);
      CONTINUE WHEN _apply <= 0;
      UPDATE public.invoices
         SET paid_amount = _inv.paid + _apply,
             status = CASE WHEN _inv.paid + _apply >= _inv.total_amount THEN 'paid' ELSE 'partial' END,
             paid_at = CASE WHEN _inv.paid + _apply >= _inv.total_amount THEN now() ELSE paid_at END,
             payment_method = COALESCE(payment_method, _settlement_method),
             updated_at = now()
       WHERE id = _inv.id;
      _left := ROUND(_left - _apply, 2);
    END LOOP;
  END IF;

  UPDATE public.admissions
     SET status = 'discharged',
         discharged_at = now(),
         discharged_by = auth.uid(),
         discharge_notes = _notes,
         updated_at = now()
   WHERE id = _admission_id;

  IF _adm.bed_id IS NOT NULL THEN
    UPDATE public.beds SET status = 'available', updated_at = now() WHERE id = _adm.bed_id;
  END IF;

  UPDATE public.patients SET status = 'discharged', updated_at = now() WHERE id = _adm.patient_id;

  PERFORM public.write_audit_log(
    'admission_discharged', 'admission', _admission_id::text,
    jsonb_build_object('patient_id', _adm.patient_id, 'notes', _notes,
                       'debt', _debt, 'collected', _collected, 'outstanding', _remaining,
                       'method', _settlement_method)
  );

  RETURN jsonb_build_object('debt', _debt, 'collected', _collected, 'outstanding', _remaining);
END;
$function$;

REVOKE ALL ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) TO authenticated, service_role;

-- ================================================================
-- 20260802160412_7e713599-ebec-4c9d-b317-b79c0bf3c322.sql
-- ================================================================
-- 1. Wallet eligibility: only cash/normal/staff_family hold a personal balance
CREATE OR REPLACE FUNCTION public.has_wallet(_account_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT lower(coalesce(_account_type,'')) IN ('','normal','cash','staff_family')
$$;

-- 2. Single source of truth for what a patient personally still owes
CREATE OR REPLACE FUNCTION public.patient_outstanding(_patient_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT ROUND(
    GREATEST(0, -COALESCE(p.balance,0))
    + COALESCE((
        SELECT SUM(GREATEST(0,
          ROUND(i.total_amount * public.copay_percent(p.account_type, p.insurance_plan) / 100.0, 2)
          - COALESCE(i.paid_amount,0)))
        FROM public.invoices i
        WHERE i.patient_id = p.id AND i.status IN ('pending','partial')
      ), 0)
  , 2)
  FROM public.patients p WHERE p.id = _patient_id
$$;

REVOKE EXECUTE ON FUNCTION public.patient_outstanding(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patient_outstanding(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.has_wallet(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_wallet(text) TO authenticated, service_role;

-- 3. Bed billing: never touch a sponsored patient's wallet
CREATE OR REPLACE FUNCTION public.bill_admission_bed_days(_admission_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _adm RECORD; _p RECORD; _room RECORD;
  _days int; _rate numeric; _amount numeric;
  _pct numeric; _copay numeric; _inv uuid;
  _bal numeric; _from_wallet numeric; _debt numeric; _wallet boolean;
  _sponsor text;
BEGIN
  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id;
  IF _adm IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id;
  IF _p IS NULL THEN RETURN NULL; END IF;

  SELECT d.days, d.daily_rate, d.amount INTO _days, _rate, _amount
  FROM public.admission_bed_charge(_admission_id) d;
  IF COALESCE(_amount,0) <= 0 THEN RETURN NULL; END IF;

  SELECT id INTO _inv FROM public.invoices
   WHERE patient_id = _adm.patient_id AND notes = 'BED_DAYS:' || _admission_id::text LIMIT 1;
  IF _inv IS NOT NULL THEN RETURN _inv; END IF;

  _pct    := public.copay_percent(_p.account_type, _p.insurance_plan);
  _copay  := ROUND(_amount * _pct / 100.0, 2);
  _wallet := public.has_wallet(_p.account_type);
  _sponsor := CASE WHEN lower(coalesce(_p.account_type,'')) IN ('','normal','cash') THEN NULL
                   ELSE lower(_p.account_type) END;

  SELECT r.room_number, r.room_class INTO _room
  FROM public.beds b JOIN public.rooms r ON r.id = b.room_id WHERE b.id = _adm.bed_id;

  INSERT INTO public.invoices (
    patient_id, visit_id, total_amount, original_amount, discount_amount,
    paid_amount, status, payment_method, sponsor_type, corporate_account_id, notes
  ) VALUES (
    _adm.patient_id, _adm.visit_id, _amount, _amount, 0,
    0, 'pending',
    CASE WHEN _pct = 0 AND _sponsor IS NOT NULL THEN 'sponsor_claim' ELSE NULL END,
    _sponsor,
    CASE WHEN lower(coalesce(_p.account_type,'')) IN ('corporate','retainer') THEN _p.corporate_id ELSE NULL END,
    'BED_DAYS:' || _admission_id::text
  ) RETURNING id INTO _inv;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
  VALUES (_inv,
    'Bed charge - ' || COALESCE(_room.room_class,'ward') || ' - ' || _days || ' night(s)',
    _days, _rate, _amount, 'admission');

  -- Only wallet patients settle through their personal balance. Sponsored
  -- patients simply carry their copay as an outstanding invoice share.
  IF _wallet AND _copay > 0 THEN
    SELECT balance INTO _bal FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
    _from_wallet := ROUND(LEAST(GREATEST(COALESCE(_bal,0),0), _copay), 2);
    _debt := ROUND(_copay - _from_wallet, 2);

    IF _from_wallet > 0 THEN
      PERFORM public.adjust_patient_balance(_adm.patient_id, -_from_wallet, 'invoice_payment',
        NULL, NULL, _inv, 'Bed charge for admission (' || _days || ' night(s))');
    END IF;
    IF _debt > 0 THEN
      PERFORM public.adjust_patient_balance(_adm.patient_id, -_debt, 'debt_incurred',
        NULL, NULL, _inv, 'Bed charge shortfall on discharge (' || _days || ' night(s))');
    END IF;

    -- copay is fully accounted for in the wallet (cash paid + debt carried)
    UPDATE public.invoices
       SET paid_amount = _copay,
           payment_method = 'wallet',
           status = CASE WHEN _copay >= _amount THEN 'paid' ELSE 'pending' END,
           paid_at = CASE WHEN _copay >= _amount THEN now() ELSE NULL END
     WHERE id = _inv;
  END IF;

  RETURN _inv;
END;
$function$;

-- 4. In-ward orders: same wallet gating for sponsored patients
CREATE OR REPLACE FUNCTION public.create_admitted_snap(_patient_id uuid, _order_type text, _target_station text, _photo_path text, _note text, _items jsonb, _total numeric, _allow_debt boolean DEFAULT false, _debt_reason text DEFAULT NULL::text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _uid UUID := auth.uid();
  _visit UUID; _admission UUID; _bal NUMERIC; _snap_id UUID; _new_bal NUMERIC;
  _debt NUMERIC := 0; _invoice UUID; _role TEXT;
  _acct TEXT; _plan TEXT; _corp UUID; _sponsor TEXT;
  _pct NUMERIC; _patient_share NUMERIC; _covered NUMERIC; _wallet BOOLEAN;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT id INTO _admission FROM public.admissions
   WHERE patient_id = _patient_id AND status IN ('active','ready_for_discharge')
   ORDER BY admitted_at DESC NULLS LAST LIMIT 1;
  IF _admission IS NULL THEN RAISE EXCEPTION 'Patient is not currently admitted'; END IF;

  SELECT id INTO _visit FROM public.visits
   WHERE patient_id = _patient_id AND status = 'open' ORDER BY opened_at DESC LIMIT 1;

  SELECT balance, lower(coalesce(account_type,'')), insurance_plan, corporate_id
    INTO _bal, _acct, _plan, _corp
    FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _bal IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  _pct := public.copay_percent(_acct, _plan);
  _patient_share := round(COALESCE(_total,0) * _pct / 100.0, 2);
  _covered := GREATEST(0, round(COALESCE(_total,0) - _patient_share, 2));
  _wallet := public.has_wallet(_acct);

  IF _wallet AND _bal < _patient_share THEN
    IF NOT _allow_debt THEN
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE: balance % < required %', _bal, _patient_share;
    END IF;
    IF _debt_reason IS NULL OR length(trim(_debt_reason)) < 3 THEN
      RAISE EXCEPTION 'Debt override requires a reason';
    END IF;
    _debt := _patient_share - _bal;
  END IF;

  SELECT role::text INTO _role FROM public.user_roles WHERE user_id = _uid LIMIT 1;

  _sponsor := CASE WHEN _acct IN ('cash','normal','') THEN NULL ELSE _acct END;

  INSERT INTO public.invoices (
    patient_id, invoice_number, total_amount, original_amount, discount_amount, paid_amount,
    status, payment_method, notes, visit_id, paid_at,
    sponsor_type, corporate_account_id, created_by
  ) VALUES (
    _patient_id, '', _total, _total, 0,
    CASE WHEN _wallet THEN _patient_share ELSE 0 END,
    CASE WHEN _wallet AND _patient_share >= COALESCE(_total,0) THEN 'paid' ELSE 'pending' END,
    CASE WHEN _wallet THEN 'wallet'
         WHEN _pct = 0 THEN 'sponsor_claim' ELSE NULL END,
    'In-ward ' || _order_type || ' (admitted order)' ||
      CASE WHEN _covered > 0 THEN ' — sponsor covered ₦' || _covered ELSE '' END ||
      CASE WHEN _debt > 0 THEN ' — debt ₦' || _debt ELSE '' END,
    _visit,
    CASE WHEN _wallet AND _patient_share >= COALESCE(_total,0) THEN now() ELSE NULL END,
    _sponsor,
    CASE WHEN _acct IN ('corporate','retainer') THEN _corp ELSE NULL END,
    _role
  ) RETURNING id INTO _invoice;

  IF jsonb_typeof(COALESCE(_items,'[]'::jsonb)) = 'array' THEN
    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
    SELECT _invoice, COALESCE(it->>'name','Item'),
           GREATEST(COALESCE((it->>'qty')::int,1),1),
           COALESCE((it->>'unit_price')::numeric,0),
           GREATEST(COALESCE((it->>'qty')::int,1),1) * COALESCE((it->>'unit_price')::numeric,0),
           COALESCE(it->>'category', _order_type)
    FROM jsonb_array_elements(_items) AS it;
  END IF;

  IF _wallet AND _patient_share <> 0 THEN
    _new_bal := _bal - _patient_share;
    PERFORM set_config('app.allow_balance_write','on',true);
    UPDATE public.patients SET balance = _new_bal, updated_at = now() WHERE id = _patient_id;
    PERFORM set_config('app.allow_balance_write','off',true);
    INSERT INTO public.balance_transactions
      (patient_id, transaction_type, amount, balance_before, balance_after, performed_by, related_invoice_id, notes)
    VALUES
      (_patient_id, CASE WHEN _debt > 0 THEN 'debt_incurred' ELSE 'admitted_deduction' END,
       -_patient_share, _bal, _new_bal, _uid, _invoice,
       CASE WHEN _debt > 0
            THEN 'Admitted in-ward ' || _order_type || ' (debt ₦' || _debt || '): ' || COALESCE(_debt_reason,'')
            ELSE 'Admitted in-ward ' || _order_type END);
  END IF;

  INSERT INTO public.snap_orders (
    patient_id, visit_id, order_type, target_station, source_role,
    photo_path, note, matched_items, status, invoice_id, created_by,
    billed_by, billed_at, paid_at, is_admitted_snap, debt_amount, debt_reason, intent
  ) VALUES (
    _patient_id, _visit, _order_type, _target_station, COALESCE(_role,'nurse'),
    _photo_path, _note, COALESCE(_items,'[]'::jsonb),
    'paid', _invoice, _uid, _uid, now(), now(), true, _debt, _debt_reason, 'in_ward_order'
  ) RETURNING id INTO _snap_id;

  RETURN _snap_id;
END;
$function$;

-- 5. Discharge preview built on the shared outstanding calculation
CREATE OR REPLACE FUNCTION public.admission_discharge_preview(_admission_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _adm RECORD; _p RECORD;
  _nights int; _rate numeric; _bed_total numeric;
  _pct numeric; _share numeric; _covered numeric;
  _bal numeric; _prior numeric; _already boolean; _due numeric;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
       ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','cashier','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id;

  SELECT d.days, d.daily_rate, d.amount INTO _nights, _rate, _bed_total
  FROM public.admission_bed_charge(_admission_id) d;

  _pct := public.copay_percent(_p.account_type, _p.insurance_plan);
  _share := ROUND(COALESCE(_bed_total,0) * _pct / 100.0, 2);
  _covered := ROUND(GREATEST(0, COALESCE(_bed_total,0) - _share), 2);

  SELECT EXISTS (SELECT 1 FROM public.invoices
    WHERE patient_id = _adm.patient_id AND notes = 'BED_DAYS:' || _admission_id::text) INTO _already;
  IF _already THEN _share := 0; _covered := 0; END IF;

  _bal   := COALESCE(_p.balance,0);
  _prior := public.patient_outstanding(_adm.patient_id);
  _due   := ROUND(_prior + _share, 2);

  RETURN jsonb_build_object(
    'admission_id', _admission_id,
    'patient_id', _adm.patient_id,
    'admitted_at', COALESCE(_adm.admitted_at, _adm.created_at),
    'account_type', _p.account_type,
    'insurance_plan', _p.insurance_plan,
    'has_wallet', public.has_wallet(_p.account_type),
    'nights', COALESCE(_nights,0),
    'daily_rate', COALESCE(_rate,0),
    'bed_total', COALESCE(_bed_total,0),
    'bed_already_billed', _already,
    'copay_pct', _pct,
    'sponsor_covered', _covered,
    'bed_patient_share', _share,
    'current_balance', _bal,
    'prior_outstanding', _prior,
    'total_due', _due,
    'balance_after_bed', ROUND(_bal - CASE WHEN public.has_wallet(_p.account_type) THEN _share ELSE 0 END, 2)
  );
END;
$function$;

-- 6. Discharge: settle only the patient's own share, never the sponsor's
CREATE OR REPLACE FUNCTION public.discharge_admission(_admission_id uuid, _notes text DEFAULT NULL::text, _settlement_method text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0, _settlement_notes text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _adm RECORD; _p RECORD; _wallet boolean;
  _debt numeric; _collected numeric := 0; _remaining numeric := 0;
  _inv RECORD; _apply numeric; _left numeric; _pct numeric; _share numeric;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
       ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to discharge';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF _adm.status NOT IN ('active','ready_for_discharge') THEN
    RAISE EXCEPTION 'Admission is not active (%)', _adm.status;
  END IF;

  PERFORM public.bill_admission_bed_days(_admission_id);

  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
  _wallet := public.has_wallet(_p.account_type);
  _pct    := public.copay_percent(_p.account_type, _p.insurance_plan);
  _debt   := public.patient_outstanding(_adm.patient_id);
  _remaining := _debt;

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash','pos','transfer') THEN
      _collected := ROUND(GREATEST(COALESCE(_settlement_amount,0),0), 2);
      IF _collected <= 0 THEN RAISE EXCEPTION 'Settlement amount must be greater than zero'; END IF;
      -- clear wallet debt first (cash/staff_family patients only)
      IF _wallet AND _p.balance < 0 THEN
        PERFORM public.adjust_patient_balance(
          _adm.patient_id, LEAST(_collected, -_p.balance), 'debt_cleared', _settlement_method,
          NULL, NULL, COALESCE(_settlement_notes,'Discharge settlement'));
      END IF;
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
      IF _remaining > 0 THEN
        IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
          RAISE EXCEPTION 'PARTIAL_REASON_REQUIRED: provide a reason for the outstanding %', _remaining;
        END IF;
        PERFORM public.write_audit_log('discharge_partial_settlement','admission',_admission_id::text,
          jsonb_build_object('patient_id',_adm.patient_id,'debt',_debt,'collected',_collected,
                             'outstanding',_remaining,'method',_settlement_method,'notes',_settlement_notes));
      END IF;

    ELSIF _settlement_method = 'waive' THEN
      IF NOT public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]) THEN
        RAISE EXCEPTION 'Only accountant/admin can waive debt';
      END IF;
      IF _wallet AND _p.balance < 0 THEN
        PERFORM public.adjust_patient_balance(_adm.patient_id, -_p.balance, 'debt_cleared','waive',
          NULL, NULL, COALESCE(_settlement_notes,'Discharge - debt waived'));
      END IF;
      _remaining := 0;

    ELSIF _settlement_method = 'carry' THEN
      IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
        RAISE EXCEPTION 'CARRY_REASON_REQUIRED: provide a reason for carrying the debt';
      END IF;
      PERFORM public.write_audit_log('debt_carried_on_discharge','admission',_admission_id::text,
        jsonb_build_object('patient_id',_adm.patient_id,'debt',_debt,'notes',_settlement_notes));
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  -- Apply money received (or the waiver) to the PATIENT SHARE of unpaid invoices, oldest first.
  _left := CASE WHEN _settlement_method IN ('cash','pos','transfer') THEN _collected
                WHEN _settlement_method = 'waive' THEN _debt ELSE 0 END;
  IF _left > 0 THEN
    FOR _inv IN
      SELECT id, total_amount, COALESCE(paid_amount,0) AS paid
      FROM public.invoices
      WHERE patient_id = _adm.patient_id AND status IN ('pending','partial')
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN _left <= 0;
      _share := ROUND(_inv.total_amount * _pct / 100.0, 2);
      _apply := ROUND(LEAST(_left, GREATEST(0, _share - _inv.paid)), 2);
      CONTINUE WHEN _apply <= 0;
      UPDATE public.invoices
         SET paid_amount = _inv.paid + _apply,
             status = CASE WHEN _inv.paid + _apply >= _share THEN 'paid' ELSE 'partial' END,
             paid_at = CASE WHEN _inv.paid + _apply >= _share THEN now() ELSE paid_at END,
             payment_method = COALESCE(payment_method, _settlement_method),
             updated_at = now()
       WHERE id = _inv.id;
      _left := ROUND(_left - _apply, 2);
    END LOOP;
  END IF;

  UPDATE public.admissions
     SET status='discharged', discharged_at=now(), discharged_by=auth.uid(),
         discharge_notes=_notes, updated_at=now()
   WHERE id = _admission_id;

  IF _adm.bed_id IS NOT NULL THEN
    UPDATE public.beds SET status='available', updated_at=now() WHERE id = _adm.bed_id;
  END IF;

  UPDATE public.patients SET status='discharged', updated_at=now() WHERE id = _adm.patient_id;

  PERFORM public.write_audit_log('admission_discharged','admission',_admission_id::text,
    jsonb_build_object('patient_id',_adm.patient_id,'notes',_notes,'debt',_debt,
                       'collected',_collected,'outstanding',_remaining,'method',_settlement_method));

  RETURN jsonb_build_object('debt',_debt,'collected',_collected,'outstanding',_remaining);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.bill_admission_bed_days(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_admitted_snap(uuid,text,text,text,text,jsonb,numeric,boolean,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admission_discharge_preview(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.discharge_admission(uuid,text,text,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bill_admission_bed_days(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_admitted_snap(uuid,text,text,text,text,jsonb,numeric,boolean,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admission_discharge_preview(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid,text,text,numeric,text) TO authenticated, service_role;

-- ================================================================
-- 20260802163046_dd69369a-7c26-4422-84ef-af7dfb800a41.sql
-- ================================================================
-- Apply a patient's positive wallet balance to their unpaid patient-share invoices (oldest first)
CREATE OR REPLACE FUNCTION public.apply_wallet_to_outstanding(_patient_id uuid, _note text DEFAULT 'Balance applied to outstanding bill')
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _p RECORD; _pct numeric; _credit numeric; _applied numeric := 0;
  _inv RECORD; _share numeric; _apply numeric;
BEGIN
  SELECT * INTO _p FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _p IS NULL THEN RETURN 0; END IF;
  IF NOT public.has_wallet(_p.account_type) THEN RETURN 0; END IF;

  _credit := ROUND(GREATEST(COALESCE(_p.balance,0), 0), 2);
  IF _credit <= 0 THEN RETURN 0; END IF;

  _pct := public.copay_percent(_p.account_type, _p.insurance_plan);

  FOR _inv IN
    SELECT id, total_amount, COALESCE(paid_amount,0) AS paid
    FROM public.invoices
    WHERE patient_id = _patient_id AND status IN ('pending','partial')
    ORDER BY created_at ASC
  LOOP
    EXIT WHEN _credit <= 0;
    _share := ROUND(_inv.total_amount * _pct / 100.0, 2);
    _apply := ROUND(LEAST(_credit, GREATEST(0, _share - _inv.paid)), 2);
    CONTINUE WHEN _apply <= 0;

    UPDATE public.invoices
       SET paid_amount = _inv.paid + _apply,
           status = CASE WHEN _inv.paid + _apply >= _share THEN 'paid' ELSE 'partial' END,
           paid_at = CASE WHEN _inv.paid + _apply >= _share THEN now() ELSE paid_at END,
           payment_method = COALESCE(payment_method, 'wallet'),
           updated_at = now()
     WHERE id = _inv.id;

    PERFORM public.adjust_patient_balance(_patient_id, -_apply, 'invoice_payment',
      'wallet', NULL, _inv.id, _note);

    _credit  := ROUND(_credit - _apply, 2);
    _applied := ROUND(_applied + _apply, 2);
  END LOOP;

  RETURN _applied;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_wallet_to_outstanding(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_wallet_to_outstanding(uuid, text) TO service_role;

-- Preview: show gross total, wallet credit applied, and the net amount to collect
CREATE OR REPLACE FUNCTION public.admission_discharge_preview(_admission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD; _p RECORD;
  _nights int; _rate numeric; _bed_total numeric;
  _pct numeric; _share numeric; _covered numeric;
  _bal numeric; _prior numeric; _already boolean;
  _gross numeric; _credit numeric; _applied numeric; _due numeric;
  _wallet boolean;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
       ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','cashier','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id;

  SELECT d.days, d.daily_rate, d.amount INTO _nights, _rate, _bed_total
  FROM public.admission_bed_charge(_admission_id) d;

  _pct := public.copay_percent(_p.account_type, _p.insurance_plan);
  _share := ROUND(COALESCE(_bed_total,0) * _pct / 100.0, 2);
  _covered := ROUND(GREATEST(0, COALESCE(_bed_total,0) - _share), 2);

  SELECT EXISTS (SELECT 1 FROM public.invoices
    WHERE patient_id = _adm.patient_id AND notes = 'BED_DAYS:' || _admission_id::text) INTO _already;
  IF _already THEN _share := 0; _covered := 0; END IF;

  _wallet := public.has_wallet(_p.account_type);
  _bal    := COALESCE(_p.balance,0);
  _prior  := public.patient_outstanding(_adm.patient_id);
  _gross  := ROUND(_prior + _share, 2);

  _credit  := CASE WHEN _wallet THEN ROUND(GREATEST(_bal,0),2) ELSE 0 END;
  _applied := ROUND(LEAST(_credit, _gross), 2);
  _due     := ROUND(GREATEST(0, _gross - _applied), 2);

  RETURN jsonb_build_object(
    'admission_id', _admission_id,
    'patient_id', _adm.patient_id,
    'admitted_at', COALESCE(_adm.admitted_at, _adm.created_at),
    'account_type', _p.account_type,
    'insurance_plan', _p.insurance_plan,
    'has_wallet', _wallet,
    'nights', COALESCE(_nights,0),
    'daily_rate', COALESCE(_rate,0),
    'bed_total', COALESCE(_bed_total,0),
    'bed_already_billed', _already,
    'copay_pct', _pct,
    'sponsor_covered', _covered,
    'bed_patient_share', _share,
    'current_balance', _bal,
    'prior_outstanding', _prior,
    'gross_total', _gross,
    'wallet_credit', _credit,
    'wallet_applied', _applied,
    'total_due', _due,
    'balance_after_bed', ROUND(_bal - _applied, 2)
  );
END;
$function$;

-- Discharge: use the wallet credit before asking for money
CREATE OR REPLACE FUNCTION public.discharge_admission(_admission_id uuid, _notes text DEFAULT NULL::text, _settlement_method text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0, _settlement_notes text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD; _p RECORD; _wallet boolean;
  _debt numeric; _collected numeric := 0; _remaining numeric := 0;
  _inv RECORD; _apply numeric; _left numeric; _pct numeric; _share numeric;
  _wallet_used numeric := 0;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
       ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to discharge';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF _adm.status NOT IN ('active','ready_for_discharge') THEN
    RAISE EXCEPTION 'Admission is not active (%)', _adm.status;
  END IF;

  PERFORM public.bill_admission_bed_days(_admission_id);

  -- Use whatever money the patient still has on account against the bill first
  _wallet_used := public.apply_wallet_to_outstanding(_adm.patient_id, 'Balance applied at discharge');

  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
  _wallet := public.has_wallet(_p.account_type);
  _pct    := public.copay_percent(_p.account_type, _p.insurance_plan);
  _debt   := public.patient_outstanding(_adm.patient_id);
  _remaining := _debt;

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash','pos','transfer') THEN
      _collected := ROUND(GREATEST(COALESCE(_settlement_amount,0),0), 2);
      IF _collected <= 0 THEN RAISE EXCEPTION 'Settlement amount must be greater than zero'; END IF;
      IF _wallet AND _p.balance < 0 THEN
        PERFORM public.adjust_patient_balance(
          _adm.patient_id, LEAST(_collected, -_p.balance), 'debt_cleared', _settlement_method,
          NULL, NULL, COALESCE(_settlement_notes,'Discharge settlement'));
      END IF;
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
      IF _remaining > 0 THEN
        IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
          RAISE EXCEPTION 'PARTIAL_REASON_REQUIRED: provide a reason for the outstanding %', _remaining;
        END IF;
        PERFORM public.write_audit_log('discharge_partial_settlement','admission',_admission_id::text,
          jsonb_build_object('patient_id',_adm.patient_id,'debt',_debt,'collected',_collected,
                             'outstanding',_remaining,'method',_settlement_method,'notes',_settlement_notes));
      END IF;

    ELSIF _settlement_method = 'waive' THEN
      IF NOT public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]) THEN
        RAISE EXCEPTION 'Only accountant/admin can waive debt';
      END IF;
      IF _wallet AND _p.balance < 0 THEN
        PERFORM public.adjust_patient_balance(_adm.patient_id, -_p.balance, 'debt_cleared','waive',
          NULL, NULL, COALESCE(_settlement_notes,'Discharge - debt waived'));
      END IF;
      _remaining := 0;

    ELSIF _settlement_method = 'carry' THEN
      IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
        RAISE EXCEPTION 'CARRY_REASON_REQUIRED: provide a reason for carrying the debt';
      END IF;
      PERFORM public.write_audit_log('debt_carried_on_discharge','admission',_admission_id::text,
        jsonb_build_object('patient_id',_adm.patient_id,'debt',_debt,'notes',_settlement_notes));
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  _left := CASE WHEN _settlement_method IN ('cash','pos','transfer') THEN _collected
                WHEN _settlement_method = 'waive' THEN _debt ELSE 0 END;
  IF _left > 0 THEN
    FOR _inv IN
      SELECT id, total_amount, COALESCE(paid_amount,0) AS paid
      FROM public.invoices
      WHERE patient_id = _adm.patient_id AND status IN ('pending','partial')
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN _left <= 0;
      _share := ROUND(_inv.total_amount * _pct / 100.0, 2);
      _apply := ROUND(LEAST(_left, GREATEST(0, _share - _inv.paid)), 2);
      CONTINUE WHEN _apply <= 0;
      UPDATE public.invoices
         SET paid_amount = _inv.paid + _apply,
             status = CASE WHEN _inv.paid + _apply >= _share THEN 'paid' ELSE 'partial' END,
             paid_at = CASE WHEN _inv.paid + _apply >= _share THEN now() ELSE paid_at END,
             payment_method = COALESCE(payment_method, _settlement_method),
             updated_at = now()
       WHERE id = _inv.id;
      _left := ROUND(_left - _apply, 2);
    END LOOP;
  END IF;

  UPDATE public.admissions
     SET status='discharged', discharged_at=now(), discharged_by=auth.uid(),
         discharge_notes=_notes, updated_at=now()
   WHERE id = _admission_id;

  IF _adm.bed_id IS NOT NULL THEN
    UPDATE public.beds SET status='available', updated_at=now() WHERE id = _adm.bed_id;
  END IF;

  UPDATE public.patients SET status='discharged', updated_at=now() WHERE id = _adm.patient_id;

  PERFORM public.write_audit_log('admission_discharged','admission',_admission_id::text,
    jsonb_build_object('patient_id',_adm.patient_id,'notes',_notes,'debt',_debt,
                       'wallet_applied',_wallet_used,'collected',_collected,
                       'outstanding',_remaining,'method',_settlement_method));

  RETURN jsonb_build_object('debt',_debt,'wallet_applied',_wallet_used,
                            'collected',_collected,'outstanding',_remaining);
END;
$function$;

-- ================================================================
-- 20260802163815_b0b4e344-ddae-4091-bf3f-8c19f028de19.sql
-- ================================================================
CREATE OR REPLACE FUNCTION public.discharge_admission(_admission_id uuid, _notes text DEFAULT NULL::text, _settlement_method text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0, _settlement_notes text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD; _p RECORD; _wallet boolean;
  _debt numeric; _collected numeric := 0; _remaining numeric := 0;
  _inv RECORD; _apply numeric; _left numeric; _pct numeric; _share numeric;
  _wallet_used numeric := 0;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
       ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to discharge';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF _adm.status NOT IN ('active','ready_for_discharge') THEN
    RAISE EXCEPTION 'Admission is not active (%)', _adm.status;
  END IF;

  PERFORM public.bill_admission_bed_days(_admission_id);

  _wallet_used := public.apply_wallet_to_outstanding(_adm.patient_id, 'Balance applied at discharge');

  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
  _wallet := public.has_wallet(_p.account_type);
  _pct    := public.copay_percent(_p.account_type, _p.insurance_plan);
  _debt   := public.patient_outstanding(_adm.patient_id);
  _remaining := _debt;

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash','pos','transfer') THEN
      _collected := ROUND(GREATEST(COALESCE(_settlement_amount,0),0), 2);
      IF _collected <= 0 THEN RAISE EXCEPTION 'Settlement amount must be greater than zero'; END IF;
      IF _wallet AND _p.balance < 0 THEN
        PERFORM public.adjust_patient_balance(
          _adm.patient_id, LEAST(_collected, -_p.balance), 'debt_cleared', _settlement_method,
          NULL, NULL, COALESCE(_settlement_notes,'Discharge settlement'));
      END IF;
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
      IF _remaining > 0 THEN
        IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
          RAISE EXCEPTION 'PARTIAL_REASON_REQUIRED: provide a reason for the outstanding %', _remaining;
        END IF;
        PERFORM public.write_audit_log('discharge_partial_settlement','admission',_admission_id::text,
          jsonb_build_object('patient_id',_adm.patient_id,'debt',_debt,'collected',_collected,
                             'outstanding',_remaining,'method',_settlement_method,'notes',_settlement_notes));
      END IF;

    ELSIF _settlement_method = 'carry' THEN
      IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
        RAISE EXCEPTION 'CARRY_REASON_REQUIRED: provide a reason for carrying the debt';
      END IF;
      PERFORM public.write_audit_log('debt_carried_on_discharge','admission',_admission_id::text,
        jsonb_build_object('patient_id',_adm.patient_id,'debt',_debt,'notes',_settlement_notes));
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  _left := CASE WHEN _settlement_method IN ('cash','pos','transfer') THEN _collected ELSE 0 END;
  IF _left > 0 THEN
    FOR _inv IN
      SELECT id, total_amount, COALESCE(paid_amount,0) AS paid
      FROM public.invoices
      WHERE patient_id = _adm.patient_id AND status IN ('pending','partial')
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN _left <= 0;
      _share := ROUND(_inv.total_amount * _pct / 100.0, 2);
      _apply := ROUND(LEAST(_left, GREATEST(0, _share - _inv.paid)), 2);
      CONTINUE WHEN _apply <= 0;
      UPDATE public.invoices
         SET paid_amount = _inv.paid + _apply,
             status = CASE WHEN _inv.paid + _apply >= _share THEN 'paid' ELSE 'partial' END,
             paid_at = CASE WHEN _inv.paid + _apply >= _share THEN now() ELSE paid_at END,
             payment_method = COALESCE(payment_method, _settlement_method),
             updated_at = now()
       WHERE id = _inv.id;
      _left := ROUND(_left - _apply, 2);
    END LOOP;
  END IF;

  UPDATE public.admissions
     SET status='discharged', discharged_at=now(), discharged_by=auth.uid(),
         discharge_notes=_notes, updated_at=now()
   WHERE id = _admission_id;

  IF _adm.bed_id IS NOT NULL THEN
    UPDATE public.beds SET status='available', updated_at=now() WHERE id = _adm.bed_id;
  END IF;

  UPDATE public.patients SET status='discharged', updated_at=now() WHERE id = _adm.patient_id;

  PERFORM public.write_audit_log('admission_discharged','admission',_admission_id::text,
    jsonb_build_object('patient_id',_adm.patient_id,'notes',_notes,'debt',_debt,
                       'wallet_applied',_wallet_used,'collected',_collected,
                       'outstanding',_remaining,'method',_settlement_method));

  RETURN jsonb_build_object('debt',_debt,'wallet_applied',_wallet_used,
                            'collected',_collected,'outstanding',_remaining);
END;
$function$;

-- ================================================================
-- 20260802164453_49e8d420-af91-4570-bb60-a0595218614f.sql
-- ================================================================
CREATE OR REPLACE FUNCTION public.apply_wallet_to_outstanding(_patient_id uuid, _note text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _p RECORD; _pct numeric; _credit numeric; _applied numeric := 0;
  _inv RECORD; _share numeric; _apply numeric;
BEGIN
  SELECT * INTO _p FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _p IS NULL THEN RETURN 0; END IF;
  IF NOT public.has_wallet(_p.account_type) THEN RETURN 0; END IF;

  _credit := ROUND(GREATEST(COALESCE(_p.balance,0), 0), 2);
  IF _credit <= 0 THEN RETURN 0; END IF;

  _pct := public.copay_percent(_p.account_type, _p.insurance_plan);

  FOR _inv IN
    SELECT id, total_amount, COALESCE(paid_amount,0) AS paid
    FROM public.invoices
    WHERE patient_id = _patient_id AND status IN ('pending','partial')
    ORDER BY created_at ASC
  LOOP
    EXIT WHEN _credit <= 0;
    _share := ROUND(_inv.total_amount * _pct / 100.0, 2);
    _apply := ROUND(LEAST(_credit, GREATEST(0, _share - _inv.paid)), 2);
    CONTINUE WHEN _apply <= 0;

    UPDATE public.invoices
       SET paid_amount = _inv.paid + _apply,
           status = CASE WHEN _inv.paid + _apply >= _share THEN 'paid' ELSE 'partial' END,
           paid_at = CASE WHEN _inv.paid + _apply >= _share THEN now() ELSE paid_at END,
           payment_method = COALESCE(payment_method, 'wallet'),
           updated_at = now()
     WHERE id = _inv.id;

    PERFORM public.adjust_patient_balance(_patient_id, -_apply, 'invoice_deduction',
      'wallet', NULL, _inv.id, _note);

    _credit  := ROUND(_credit - _apply, 2);
    _applied := ROUND(_applied + _apply, 2);
  END LOOP;

  RETURN _applied;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.apply_wallet_to_outstanding(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_wallet_to_outstanding(uuid, text) TO authenticated;

-- ================================================================
-- 20260802172223_51010528-1a75-428a-9091-a95f808620f9.sql
-- ================================================================
-- 1) Nurse/doctor confirmation step: send admission to cashier for settlement
CREATE OR REPLACE FUNCTION public.send_admission_to_cashier(_admission_id uuid, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _adm RECORD;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to send patient for discharge';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF _adm.status = 'ready_for_discharge' THEN RETURN; END IF;
  IF _adm.status <> 'active' THEN
    RAISE EXCEPTION 'Admission is not active (%)', _adm.status;
  END IF;

  UPDATE public.admissions
     SET status = 'ready_for_discharge',
         ready_for_discharge_at = now(),
         ready_for_discharge_by = _uid,
         discharge_notes = COALESCE(_note, discharge_notes),
         updated_at = now()
   WHERE id = _admission_id;

  PERFORM public.write_audit_log('discharge_sent_to_cashier','admission',_admission_id::text,
    jsonb_build_object('patient_id',_adm.patient_id,'note',_note));
END $function$;

REVOKE ALL ON FUNCTION public.send_admission_to_cashier(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_admission_to_cashier(uuid, text) TO authenticated;

-- 2) Settlement is cashier-only, and only after the ward confirmed discharge
CREATE OR REPLACE FUNCTION public.discharge_admission(_admission_id uuid, _notes text DEFAULT NULL::text, _settlement_method text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0, _settlement_notes text DEFAULT NULL::text, _refund_amount numeric DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD; _p RECORD; _wallet boolean;
  _debt numeric; _collected numeric := 0; _remaining numeric := 0;
  _inv RECORD; _apply numeric; _left numeric; _pct numeric; _share numeric;
  _wallet_used numeric := 0; _refund numeric := 0; _credit numeric := 0;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
       ARRAY['cashier','billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only the cashier can settle and complete a discharge';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF _adm.status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'Admission must be confirmed for discharge by the ward first (%)', _adm.status;
  END IF;

  PERFORM public.bill_admission_bed_days(_admission_id);

  _wallet_used := public.apply_wallet_to_outstanding(_adm.patient_id, 'Balance applied at discharge');

  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
  _wallet := public.has_wallet(_p.account_type);
  _pct    := public.copay_percent(_p.account_type, _p.insurance_plan);
  _debt   := public.patient_outstanding(_adm.patient_id);
  _remaining := _debt;

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash','pos','transfer') THEN
      _collected := ROUND(GREATEST(COALESCE(_settlement_amount,0),0), 2);
      IF _collected <= 0 THEN RAISE EXCEPTION 'Settlement amount must be greater than zero'; END IF;
      IF _wallet AND _p.balance < 0 THEN
        PERFORM public.adjust_patient_balance(
          _adm.patient_id, LEAST(_collected, -_p.balance), 'debt_cleared', _settlement_method,
          NULL, NULL, COALESCE(_settlement_notes,'Discharge settlement'));
      END IF;
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
      IF _remaining > 0 THEN
        IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
          RAISE EXCEPTION 'PARTIAL_REASON_REQUIRED: provide a reason for the outstanding %', _remaining;
        END IF;
        PERFORM public.write_audit_log('discharge_partial_settlement','admission',_admission_id::text,
          jsonb_build_object('patient_id',_adm.patient_id,'debt',_debt,'collected',_collected,
                             'outstanding',_remaining,'method',_settlement_method,'notes',_settlement_notes));
      END IF;

    ELSIF _settlement_method = 'carry' THEN
      IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
        RAISE EXCEPTION 'CARRY_REASON_REQUIRED: provide a reason for carrying the debt';
      END IF;
      PERFORM public.write_audit_log('debt_carried_on_discharge','admission',_admission_id::text,
        jsonb_build_object('patient_id',_adm.patient_id,'debt',_debt,'notes',_settlement_notes));
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  _left := CASE WHEN _settlement_method IN ('cash','pos','transfer') THEN _collected ELSE 0 END;
  IF _left > 0 THEN
    FOR _inv IN
      SELECT id, total_amount, COALESCE(paid_amount,0) AS paid
      FROM public.invoices
      WHERE patient_id = _adm.patient_id AND status IN ('pending','partial')
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN _left <= 0;
      _share := ROUND(_inv.total_amount * _pct / 100.0, 2);
      _apply := ROUND(LEAST(_left, GREATEST(0, _share - _inv.paid)), 2);
      CONTINUE WHEN _apply <= 0;
      UPDATE public.invoices
         SET paid_amount = _inv.paid + _apply,
             status = CASE WHEN _inv.paid + _apply >= _share THEN 'paid' ELSE 'partial' END,
             paid_at = CASE WHEN _inv.paid + _apply >= _share THEN now() ELSE paid_at END,
             payment_method = COALESCE(payment_method, _settlement_method),
             updated_at = now()
       WHERE id = _inv.id;
      _left := ROUND(_left - _apply, 2);
    END LOOP;
  END IF;

  -- Overpayment stays as credit on the wallet unless the cashier pays it out
  IF _wallet AND _left > 0 THEN
    PERFORM public.adjust_patient_balance(
      _adm.patient_id, _left, 'topup', _settlement_method, NULL, NULL,
      'Change from discharge settlement left on balance');
    _credit := _left;
  END IF;

  -- Cashier hands cash back to the patient (refund out of wallet credit)
  _refund := ROUND(GREATEST(COALESCE(_refund_amount,0),0), 2);
  IF _refund > 0 THEN
    IF NOT _wallet THEN RAISE EXCEPTION 'Sponsored accounts have no wallet to refund from'; END IF;
    SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
    IF _refund > _p.balance THEN
      RAISE EXCEPTION 'Refund % exceeds available balance %', _refund, _p.balance;
    END IF;
    PERFORM public.adjust_patient_balance(
      _adm.patient_id, -_refund, 'refund', _settlement_method, NULL, NULL,
      'Change paid out at discharge');
  END IF;

  UPDATE public.admissions
     SET status='discharged', discharged_at=now(), discharged_by=auth.uid(),
         discharge_notes=COALESCE(_notes, discharge_notes), updated_at=now()
   WHERE id = _admission_id;

  IF _adm.bed_id IS NOT NULL THEN
    UPDATE public.beds SET status='available', updated_at=now() WHERE id = _adm.bed_id;
  END IF;

  UPDATE public.patients SET status='discharged', updated_at=now() WHERE id = _adm.patient_id;

  PERFORM public.write_audit_log('admission_discharged','admission',_admission_id::text,
    jsonb_build_object('patient_id',_adm.patient_id,'notes',_notes,'debt',_debt,
                       'wallet_applied',_wallet_used,'collected',_collected,
                       'outstanding',_remaining,'credit_left',_credit,'refunded',_refund,
                       'method',_settlement_method));

  RETURN jsonb_build_object('debt',_debt,'wallet_applied',_wallet_used,
                            'collected',_collected,'outstanding',_remaining,
                            'credit_left',_credit,'refunded',_refund);
END;
$function$;

DROP FUNCTION IF EXISTS public.discharge_admission(uuid, text, text, numeric, text);

REVOKE ALL ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) TO authenticated;

-- ================================================================
-- 20260802173040_29a82fed-e183-4835-ae26-5d40cbe624fb.sql
-- ================================================================
CREATE OR REPLACE FUNCTION public.discharge_admission(_admission_id uuid, _notes text DEFAULT NULL::text, _settlement_method text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0, _settlement_notes text DEFAULT NULL::text, _refund_amount numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD; _p RECORD; _wallet boolean;
  _debt numeric; _collected numeric := 0; _remaining numeric := 0;
  _inv RECORD; _apply numeric; _left numeric; _pct numeric; _share numeric;
  _wallet_used numeric := 0; _refund numeric := 0; _credit numeric := 0;
  _got_lock boolean;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
       ARRAY['cashier','billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only the cashier can settle and complete a discharge';
  END IF;

  -- Reject concurrent double-submits (two cashiers / double click) outright
  -- instead of queueing them behind the row lock.
  _got_lock := pg_try_advisory_xact_lock(hashtextextended('discharge_admission', 0), hashtextextended(_admission_id::text, 0));
  IF NOT _got_lock THEN
    RAISE EXCEPTION 'DISCHARGE_IN_PROGRESS: this discharge is already being settled — refresh the queue';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;

  IF _adm.status = 'discharged' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was already settled and discharged on %',
      COALESCE(to_char(_adm.discharged_at, 'DD Mon YYYY HH24:MI'), 'an earlier date');
  END IF;
  IF _adm.status = 'cancelled' THEN
    RAISE EXCEPTION 'ADMISSION_CANCELLED: this admission was cancelled and cannot be settled';
  END IF;
  IF _adm.status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'NOT_IN_CASHIER_QUEUE: the ward has not confirmed this discharge yet (%)', _adm.status;
  END IF;

  PERFORM public.bill_admission_bed_days(_admission_id);

  _wallet_used := public.apply_wallet_to_outstanding(_adm.patient_id, 'Balance applied at discharge');

  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
  _wallet := public.has_wallet(_p.account_type);
  _pct    := public.copay_percent(_p.account_type, _p.insurance_plan);
  _debt   := public.patient_outstanding(_adm.patient_id);
  _remaining := _debt;

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash','pos','transfer') THEN
      _collected := ROUND(GREATEST(COALESCE(_settlement_amount,0),0), 2);
      IF _collected <= 0 THEN RAISE EXCEPTION 'Settlement amount must be greater than zero'; END IF;
      IF _wallet AND _p.balance < 0 THEN
        PERFORM public.adjust_patient_balance(
          _adm.patient_id, LEAST(_collected, -_p.balance), 'debt_cleared', _settlement_method,
          NULL, NULL, COALESCE(_settlement_notes,'Discharge settlement'));
      END IF;
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
      IF _remaining > 0 THEN
        IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
          RAISE EXCEPTION 'PARTIAL_REASON_REQUIRED: provide a reason for the outstanding %', _remaining;
        END IF;
        PERFORM public.write_audit_log('discharge_partial_settlement','admission',_admission_id::text,
          jsonb_build_object('patient_id',_adm.patient_id,'debt',_debt,'collected',_collected,
                             'outstanding',_remaining,'method',_settlement_method,'notes',_settlement_notes));
      END IF;

    ELSIF _settlement_method = 'carry' THEN
      IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
        RAISE EXCEPTION 'CARRY_REASON_REQUIRED: provide a reason for carrying the debt';
      END IF;
      PERFORM public.write_audit_log('debt_carried_on_discharge','admission',_admission_id::text,
        jsonb_build_object('patient_id',_adm.patient_id,'debt',_debt,'notes',_settlement_notes));
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  _left := CASE WHEN _settlement_method IN ('cash','pos','transfer') THEN _collected ELSE 0 END;
  IF _left > 0 THEN
    FOR _inv IN
      SELECT id, total_amount, COALESCE(paid_amount,0) AS paid
      FROM public.invoices
      WHERE patient_id = _adm.patient_id AND status IN ('pending','partial')
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN _left <= 0;
      _share := ROUND(_inv.total_amount * _pct / 100.0, 2);
      _apply := ROUND(LEAST(_left, GREATEST(0, _share - _inv.paid)), 2);
      CONTINUE WHEN _apply <= 0;
      UPDATE public.invoices
         SET paid_amount = _inv.paid + _apply,
             status = CASE WHEN _inv.paid + _apply >= _share THEN 'paid' ELSE 'partial' END,
             paid_at = CASE WHEN _inv.paid + _apply >= _share THEN now() ELSE paid_at END,
             payment_method = COALESCE(payment_method, _settlement_method),
             updated_at = now()
       WHERE id = _inv.id;
      _left := ROUND(_left - _apply, 2);
    END LOOP;
  END IF;

  IF _wallet AND _left > 0 THEN
    PERFORM public.adjust_patient_balance(
      _adm.patient_id, _left, 'topup', _settlement_method, NULL, NULL,
      'Change from discharge settlement left on balance');
    _credit := _left;
  END IF;

  _refund := ROUND(GREATEST(COALESCE(_refund_amount,0),0), 2);
  IF _refund > 0 THEN
    IF NOT _wallet THEN RAISE EXCEPTION 'Sponsored accounts have no wallet to refund from'; END IF;
    SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
    IF _refund > _p.balance THEN
      RAISE EXCEPTION 'Refund % exceeds available balance %', _refund, _p.balance;
    END IF;
    PERFORM public.adjust_patient_balance(
      _adm.patient_id, -_refund, 'refund', _settlement_method, NULL, NULL,
      'Change paid out at discharge');
  END IF;

  UPDATE public.admissions
     SET status='discharged', discharged_at=now(), discharged_by=auth.uid(),
         discharge_notes=COALESCE(_notes, discharge_notes), updated_at=now()
   WHERE id = _admission_id AND status = 'ready_for_discharge';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was settled by someone else — refresh the queue';
  END IF;

  IF _adm.bed_id IS NOT NULL THEN
    UPDATE public.beds SET status='available', updated_at=now() WHERE id = _adm.bed_id;
  END IF;

  UPDATE public.patients SET status='discharged', updated_at=now() WHERE id = _adm.patient_id;

  PERFORM public.write_audit_log('admission_discharged','admission',_admission_id::text,
    jsonb_build_object('patient_id',_adm.patient_id,'notes',_notes,'debt',_debt,
                       'wallet_applied',_wallet_used,'collected',_collected,
                       'outstanding',_remaining,'credit_left',_credit,'refunded',_refund,
                       'method',_settlement_method));

  RETURN jsonb_build_object('debt',_debt,'wallet_applied',_wallet_used,
                            'collected',_collected,'outstanding',_remaining,
                            'credit_left',_credit,'refunded',_refund);
END;
$function$;

-- ================================================================
-- 20260802173457_3e4fcb5e-4970-4276-a570-8d6d50132eb1.sql
-- ================================================================
ALTER TABLE public.admissions DROP CONSTRAINT IF EXISTS admissions_status_check;
ALTER TABLE public.admissions ADD CONSTRAINT admissions_status_check CHECK (status = ANY (ARRAY['waiting_assignment'::text, 'active'::text, 'ready_for_discharge'::text, 'discharged'::text, 'cancelled'::text]));

-- ================================================================
-- 20260802175519_b40544d3-e3e3-4919-8cc5-a15de1544f1a.sql
-- ================================================================
CREATE OR REPLACE FUNCTION public.discharge_admission(_admission_id uuid, _notes text DEFAULT NULL::text, _settlement_method text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0, _settlement_notes text DEFAULT NULL::text, _refund_amount numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD; _p RECORD; _wallet boolean;
  _debt numeric; _collected numeric := 0; _remaining numeric := 0;
  _inv RECORD; _apply numeric; _left numeric; _pct numeric; _share numeric;
  _wallet_used numeric := 0; _refund numeric := 0; _credit numeric := 0;
  _got_lock boolean;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
       ARRAY['cashier','billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only the cashier can settle and complete a discharge';
  END IF;

  _got_lock := pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('discharge_admission', 0), pg_catalog.hashtextextended(_admission_id::text, 0));
  IF NOT _got_lock THEN
    RAISE EXCEPTION 'DISCHARGE_IN_PROGRESS: this discharge is already being settled — refresh the queue';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;

  IF _adm.status = 'discharged' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was already settled and discharged on %',
      COALESCE(to_char(_adm.discharged_at, 'DD Mon YYYY HH24:MI'), 'an earlier date');
  END IF;
  IF _adm.status = 'cancelled' THEN
    RAISE EXCEPTION 'ADMISSION_CANCELLED: this admission was cancelled and cannot be settled';
  END IF;
  IF _adm.status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'NOT_IN_CASHIER_QUEUE: the ward has not confirmed this discharge yet (%)', _adm.status;
  END IF;

  PERFORM public.bill_admission_bed_days(_admission_id);

  _wallet_used := public.apply_wallet_to_outstanding(_adm.patient_id, 'Balance applied at discharge');

  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
  _wallet := public.has_wallet(_p.account_type);
  _pct    := public.copay_percent(_p.account_type, _p.insurance_plan);
  _debt   := public.patient_outstanding(_adm.patient_id);
  _remaining := _debt;

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash','pos','transfer') THEN
      _collected := ROUND(GREATEST(COALESCE(_settlement_amount,0),0), 2);
      IF _collected <= 0 THEN RAISE EXCEPTION 'Settlement amount must be greater than zero'; END IF;
      IF _wallet AND _p.balance < 0 THEN
        PERFORM public.adjust_patient_balance(
          _adm.patient_id, LEAST(_collected, -_p.balance), 'debt_cleared', _settlement_method,
          NULL, NULL, COALESCE(_settlement_notes,'Discharge settlement'));
      END IF;
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
      IF _remaining > 0 THEN
        PERFORM public.write_audit_log('discharge_partial_settlement','admission',_admission_id::text,
          jsonb_build_object('patient_id',_adm.patient_id,'debt',_debt,'collected',_collected,
                             'outstanding',_remaining,'method',_settlement_method,'notes',_settlement_notes));
      END IF;

    ELSIF _settlement_method = 'carry' THEN
      PERFORM public.write_audit_log('debt_carried_on_discharge','admission',_admission_id::text,
        jsonb_build_object('patient_id',_adm.patient_id,'debt',_debt,'notes',_settlement_notes));
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  _left := CASE WHEN _settlement_method IN ('cash','pos','transfer') THEN _collected ELSE 0 END;
  IF _left > 0 THEN
    FOR _inv IN
      SELECT id, total_amount, COALESCE(paid_amount,0) AS paid
      FROM public.invoices
      WHERE patient_id = _adm.patient_id AND status IN ('pending','partial')
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN _left <= 0;
      _share := ROUND(_inv.total_amount * _pct / 100.0, 2);
      _apply := ROUND(LEAST(_left, GREATEST(0, _share - _inv.paid)), 2);
      CONTINUE WHEN _apply <= 0;
      UPDATE public.invoices
         SET paid_amount = _inv.paid + _apply,
             status = CASE WHEN _inv.paid + _apply >= _share THEN 'paid' ELSE 'partial' END,
             paid_at = CASE WHEN _inv.paid + _apply >= _share THEN now() ELSE paid_at END,
             payment_method = COALESCE(payment_method, _settlement_method),
             updated_at = now()
       WHERE id = _inv.id;
      _left := ROUND(_left - _apply, 2);
    END LOOP;
  END IF;

  IF _wallet AND _left > 0 THEN
    PERFORM public.adjust_patient_balance(
      _adm.patient_id, _left, 'topup', _settlement_method, NULL, NULL,
      'Change from discharge settlement left on balance');
    _credit := _left;
  END IF;

  _refund := ROUND(GREATEST(COALESCE(_refund_amount,0),0), 2);
  IF _refund > 0 THEN
    IF NOT _wallet THEN RAISE EXCEPTION 'Sponsored accounts have no wallet to refund from'; END IF;
    SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
    IF _refund > _p.balance THEN
      RAISE EXCEPTION 'Refund % exceeds available balance %', _refund, _p.balance;
    END IF;
    PERFORM public.adjust_patient_balance(
      _adm.patient_id, -_refund, 'refund', _settlement_method, NULL, NULL,
      'Change paid out at discharge');
  END IF;

  UPDATE public.admissions
     SET status='discharged', discharged_at=now(), discharged_by=auth.uid(),
         discharge_notes=COALESCE(_notes, discharge_notes), updated_at=now()
   WHERE id = _admission_id AND status = 'ready_for_discharge';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was settled by someone else — refresh the queue';
  END IF;

  IF _adm.bed_id IS NOT NULL THEN
    UPDATE public.beds SET status='available', updated_at=now() WHERE id = _adm.bed_id;
  END IF;

  UPDATE public.patients SET status='discharged', updated_at=now() WHERE id = _adm.patient_id;

  PERFORM public.write_audit_log('admission_discharged','admission',_admission_id::text,
    jsonb_build_object('patient_id',_adm.patient_id,'notes',_notes,'debt',_debt,
                       'wallet_applied',_wallet_used,'collected',_collected,
                       'outstanding',_remaining,'credit_left',_credit,'refunded',_refund,
                       'method',_settlement_method));

  RETURN jsonb_build_object('debt',_debt,'wallet_applied',_wallet_used,
                            'collected',_collected,'outstanding',_remaining,
                            'credit_left',_credit,'refunded',_refund);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) TO authenticated;

-- ================================================================
-- 20260802193417_5deb48e4-7a2e-4714-a8e1-bd30e8865d88.sql
-- ================================================================
CREATE OR REPLACE FUNCTION public.discharge_admission(_admission_id uuid, _notes text DEFAULT NULL::text, _settlement_method text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0, _settlement_notes text DEFAULT NULL::text, _refund_amount numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD; _p RECORD; _wallet boolean;
  _debt numeric; _collected numeric := 0; _remaining numeric := 0;
  _inv RECORD; _apply numeric; _left numeric; _pct numeric; _share numeric;
  _wallet_used numeric := 0; _refund numeric := 0; _credit numeric := 0;
  _got_lock boolean;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
       ARRAY['cashier','billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only the cashier can settle and complete a discharge';
  END IF;

  -- one settlement at a time per admission (single-key bigint advisory lock)
  _got_lock := pg_catalog.pg_try_advisory_xact_lock(
                 pg_catalog.hashtextextended('discharge_admission:' || _admission_id::text, 0));
  IF NOT _got_lock THEN
    RAISE EXCEPTION 'DISCHARGE_IN_PROGRESS: this discharge is already being settled — refresh the queue';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;

  IF _adm.status = 'discharged' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was already settled and discharged on %',
      COALESCE(to_char(_adm.discharged_at, 'DD Mon YYYY HH24:MI'), 'an earlier date');
  END IF;
  IF _adm.status = 'cancelled' THEN
    RAISE EXCEPTION 'ADMISSION_CANCELLED: this admission was cancelled and cannot be settled';
  END IF;
  IF _adm.status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'NOT_IN_CASHIER_QUEUE: the ward has not confirmed this discharge yet (%)', _adm.status;
  END IF;

  PERFORM public.bill_admission_bed_days(_admission_id);

  _wallet_used := public.apply_wallet_to_outstanding(_adm.patient_id, 'Balance applied at discharge');

  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
  _wallet := public.has_wallet(_p.account_type);
  _pct    := public.copay_percent(_p.account_type, _p.insurance_plan);
  _debt   := public.patient_outstanding(_adm.patient_id);
  _remaining := _debt;

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash','pos','transfer') THEN
      _collected := ROUND(GREATEST(COALESCE(_settlement_amount,0),0), 2);
      IF _collected <= 0 THEN RAISE EXCEPTION 'Settlement amount must be greater than zero'; END IF;
      IF _wallet AND _p.balance < 0 THEN
        PERFORM public.adjust_patient_balance(
          _adm.patient_id, LEAST(_collected, -_p.balance), 'debt_cleared', _settlement_method,
          NULL, NULL, COALESCE(_settlement_notes,'Discharge settlement'));
      END IF;
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
      IF _remaining > 0 THEN
        PERFORM public.write_audit_log('discharge_partial_settlement','admission',_admission_id::text,
          jsonb_build_object('patient_id',_adm.patient_id,'debt',_debt,'collected',_collected,
                             'outstanding',_remaining,'method',_settlement_method,'notes',_settlement_notes));
      END IF;

    ELSIF _settlement_method = 'carry' THEN
      PERFORM public.write_audit_log('debt_carried_on_discharge','admission',_admission_id::text,
        jsonb_build_object('patient_id',_adm.patient_id,'debt',_debt,'notes',_settlement_notes));
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  _left := CASE WHEN _settlement_method IN ('cash','pos','transfer') THEN _collected ELSE 0 END;
  IF _left > 0 THEN
    FOR _inv IN
      SELECT id, total_amount, COALESCE(paid_amount,0) AS paid
      FROM public.invoices
      WHERE patient_id = _adm.patient_id AND status IN ('pending','partial')
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN _left <= 0;
      _share := ROUND(_inv.total_amount * _pct / 100.0, 2);
      _apply := ROUND(LEAST(_left, GREATEST(0, _share - _inv.paid)), 2);
      CONTINUE WHEN _apply <= 0;
      UPDATE public.invoices
         SET paid_amount = _inv.paid + _apply,
             status = CASE WHEN _inv.paid + _apply >= _share THEN 'paid' ELSE 'partial' END,
             paid_at = CASE WHEN _inv.paid + _apply >= _share THEN now() ELSE paid_at END,
             payment_method = COALESCE(payment_method, _settlement_method),
             updated_at = now()
       WHERE id = _inv.id;
      _left := ROUND(_left - _apply, 2);
    END LOOP;
  END IF;

  IF _wallet AND _left > 0 THEN
    PERFORM public.adjust_patient_balance(
      _adm.patient_id, _left, 'topup', _settlement_method, NULL, NULL,
      'Change from discharge settlement left on balance');
    _credit := _left;
  END IF;

  _refund := ROUND(GREATEST(COALESCE(_refund_amount,0),0), 2);
  IF _refund > 0 THEN
    IF NOT _wallet THEN RAISE EXCEPTION 'Sponsored accounts have no wallet to refund from'; END IF;
    SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
    IF _refund > _p.balance THEN
      RAISE EXCEPTION 'Refund % exceeds available balance %', _refund, _p.balance;
    END IF;
    PERFORM public.adjust_patient_balance(
      _adm.patient_id, -_refund, 'refund', _settlement_method, NULL, NULL,
      'Change paid out at discharge');
  END IF;

  UPDATE public.admissions
     SET status='discharged', discharged_at=now(), discharged_by=auth.uid(),
         discharge_notes=COALESCE(_notes, discharge_notes), updated_at=now()
   WHERE id = _admission_id AND status = 'ready_for_discharge';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was settled by someone else — refresh the queue';
  END IF;

  IF _adm.bed_id IS NOT NULL THEN
    UPDATE public.beds SET status='available', updated_at=now() WHERE id = _adm.bed_id;
  END IF;

  UPDATE public.patients SET status='discharged', updated_at=now() WHERE id = _adm.patient_id;

  PERFORM public.write_audit_log('admission_discharged','admission',_admission_id::text,
    jsonb_build_object('patient_id',_adm.patient_id,'notes',_notes,'debt',_debt,
                       'wallet_applied',_wallet_used,'collected',_collected,
                       'outstanding',_remaining,'credit_left',_credit,'refunded',_refund,
                       'method',_settlement_method));

  RETURN jsonb_build_object('debt',_debt,'wallet_applied',_wallet_used,
                            'collected',_collected,'outstanding',_remaining,
                            'credit_left',_credit,'refunded',_refund);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) TO authenticated;

-- ================================================================
-- 20260802201739_a8121027-ac48-463c-9fee-c54d6cfe9c10.sql
-- ================================================================
CREATE OR REPLACE FUNCTION public.bill_admission_bed_days(_admission_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _adm RECORD; _p RECORD; _room RECORD;
  _days int; _rate numeric; _amount numeric;
  _pct numeric; _copay numeric; _inv uuid;
  _bal numeric; _from_wallet numeric; _debt numeric; _wallet boolean;
  _sponsor text;
BEGIN
  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id;
  IF _adm IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id;
  IF _p IS NULL THEN RETURN NULL; END IF;

  SELECT d.days, d.daily_rate, d.amount INTO _days, _rate, _amount
  FROM public.admission_bed_charge(_admission_id) d;
  IF COALESCE(_amount,0) <= 0 THEN RETURN NULL; END IF;

  SELECT id INTO _inv FROM public.invoices
   WHERE patient_id = _adm.patient_id AND notes = 'BED_DAYS:' || _admission_id::text LIMIT 1;
  IF _inv IS NOT NULL THEN RETURN _inv; END IF;

  _pct    := public.copay_percent(_p.account_type, _p.insurance_plan);
  _copay  := ROUND(_amount * _pct / 100.0, 2);
  _wallet := public.has_wallet(_p.account_type);
  _sponsor := CASE WHEN lower(coalesce(_p.account_type,'')) IN ('','normal','cash') THEN NULL
                   ELSE lower(_p.account_type) END;

  SELECT r.room_number, r.room_class INTO _room
  FROM public.beds b JOIN public.rooms r ON r.id = b.room_id WHERE b.id = _adm.bed_id;

  INSERT INTO public.invoices (
    patient_id, visit_id, total_amount, original_amount, discount_amount,
    paid_amount, status, payment_method, sponsor_type, corporate_account_id, notes
  ) VALUES (
    _adm.patient_id, _adm.visit_id, _amount, _amount, 0,
    0, 'pending',
    CASE WHEN _pct = 0 AND _sponsor IS NOT NULL THEN 'sponsor_claim' ELSE NULL END,
    _sponsor,
    CASE WHEN lower(coalesce(_p.account_type,'')) IN ('corporate','retainer') THEN _p.corporate_id ELSE NULL END,
    'BED_DAYS:' || _admission_id::text
  ) RETURNING id INTO _inv;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
  VALUES (_inv,
    'Bed charge - ' || COALESCE(_room.room_class,'ward') || ' - ' || _days || ' night(s)',
    _days, _rate, _amount, 'admission');

  IF _wallet AND _copay > 0 THEN
    SELECT balance INTO _bal FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
    _from_wallet := ROUND(LEAST(GREATEST(COALESCE(_bal,0),0), _copay), 2);
    _debt := ROUND(_copay - _from_wallet, 2);

    IF _from_wallet > 0 THEN
      PERFORM public.adjust_patient_balance(_adm.patient_id, -_from_wallet, 'invoice_deduction',
        'wallet', NULL, _inv, 'Bed charge for admission (' || _days || ' night(s))');
    END IF;
    IF _debt > 0 THEN
      PERFORM public.adjust_patient_balance(_adm.patient_id, -_debt, 'debt_incurred',
        NULL, NULL, _inv, 'Bed charge shortfall on discharge (' || _days || ' night(s))');
    END IF;

    UPDATE public.invoices
       SET paid_amount = _copay,
           payment_method = 'wallet',
           status = CASE WHEN _copay >= _amount THEN 'paid' ELSE 'pending' END,
           paid_at = CASE WHEN _copay >= _amount THEN now() ELSE NULL END
     WHERE id = _inv;
  END IF;

  RETURN _inv;
END;
$$;

REVOKE ALL ON FUNCTION public.bill_admission_bed_days(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bill_admission_bed_days(uuid) TO authenticated;

-- ================================================================
-- 20260802204659_b918f60b-6608-4db9-9f63-3c7a2a3d6376.sql
-- ================================================================
CREATE OR REPLACE FUNCTION public.discharge_admission(_admission_id uuid, _notes text DEFAULT NULL::text, _settlement_method text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0, _settlement_notes text DEFAULT NULL::text, _refund_amount numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD; _p RECORD; _wallet boolean;
  _debt numeric; _collected numeric := 0; _remaining numeric := 0;
  _inv RECORD; _apply numeric; _left numeric; _pct numeric; _share numeric;
  _wallet_used numeric := 0; _refund numeric := 0; _credit numeric := 0;
  _debt_cleared numeric := 0;
  _got_lock boolean;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
       ARRAY['cashier','billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only the cashier can settle and complete a discharge';
  END IF;

  _got_lock := pg_catalog.pg_try_advisory_xact_lock(
                 pg_catalog.hashtextextended('discharge_admission:' || _admission_id::text, 0));
  IF NOT _got_lock THEN
    RAISE EXCEPTION 'DISCHARGE_IN_PROGRESS: this discharge is already being settled — refresh the queue';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;

  IF _adm.status = 'discharged' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was already settled and discharged on %',
      COALESCE(to_char(_adm.discharged_at, 'DD Mon YYYY HH24:MI'), 'an earlier date');
  END IF;
  IF _adm.status = 'cancelled' THEN
    RAISE EXCEPTION 'ADMISSION_CANCELLED: this admission was cancelled and cannot be settled';
  END IF;
  IF _adm.status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'NOT_IN_CASHIER_QUEUE: the ward has not confirmed this discharge yet (%)', _adm.status;
  END IF;

  PERFORM public.bill_admission_bed_days(_admission_id);

  _wallet_used := public.apply_wallet_to_outstanding(_adm.patient_id, 'Balance applied at discharge');

  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
  _wallet := public.has_wallet(_p.account_type);
  _pct    := public.copay_percent(_p.account_type, _p.insurance_plan);
  _debt   := public.patient_outstanding(_adm.patient_id);
  _remaining := _debt;

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash','pos','transfer') THEN
      _collected := ROUND(GREATEST(COALESCE(_settlement_amount,0),0), 2);
      IF _collected <= 0 THEN RAISE EXCEPTION 'Settlement amount must be greater than zero'; END IF;
      IF _wallet AND _p.balance < 0 THEN
        _debt_cleared := ROUND(LEAST(_collected, -_p.balance), 2);
        PERFORM public.adjust_patient_balance(
          _adm.patient_id, _debt_cleared, 'debt_cleared', _settlement_method,
          NULL, NULL, COALESCE(_settlement_notes,'Discharge settlement'));
      END IF;
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
      IF _remaining > 0 THEN
        PERFORM public.write_audit_log('discharge_partial_settlement','admission',_admission_id::text,
          jsonb_build_object('patient_id',_adm.patient_id,'debt',_debt,'collected',_collected,
                             'outstanding',_remaining,'method',_settlement_method,'notes',_settlement_notes));
      END IF;

    ELSIF _settlement_method = 'carry' THEN
      PERFORM public.write_audit_log('debt_carried_on_discharge','admission',_admission_id::text,
        jsonb_build_object('patient_id',_adm.patient_id,'debt',_debt,'notes',_settlement_notes));
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  -- Money still in hand AFTER the part already used to clear negative balance.
  _left := CASE WHEN _settlement_method IN ('cash','pos','transfer')
                THEN ROUND(GREATEST(0, _collected - _debt_cleared), 2) ELSE 0 END;

  IF _left > 0 THEN
    FOR _inv IN
      SELECT id, total_amount, COALESCE(paid_amount,0) AS paid
      FROM public.invoices
      WHERE patient_id = _adm.patient_id AND status IN ('pending','partial')
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN _left <= 0;
      _share := ROUND(_inv.total_amount * _pct / 100.0, 2);
      _apply := ROUND(LEAST(_left, GREATEST(0, _share - _inv.paid)), 2);
      CONTINUE WHEN _apply <= 0;
      UPDATE public.invoices
         SET paid_amount = _inv.paid + _apply,
             status = CASE WHEN _inv.paid + _apply >= _share THEN 'paid' ELSE 'partial' END,
             paid_at = CASE WHEN _inv.paid + _apply >= _share THEN now() ELSE paid_at END,
             payment_method = COALESCE(payment_method, _settlement_method),
             updated_at = now()
       WHERE id = _inv.id;
      _left := ROUND(_left - _apply, 2);
    END LOOP;
  END IF;

  -- Anything still left is a genuine overpayment.
  IF _wallet AND _left > 0 THEN
    PERFORM public.adjust_patient_balance(
      _adm.patient_id, _left, 'topup', _settlement_method, NULL, NULL,
      'Change from discharge settlement left on balance');
    _credit := _left;
  END IF;

  _refund := ROUND(GREATEST(COALESCE(_refund_amount,0),0), 2);
  IF _refund > 0 THEN
    IF NOT _wallet THEN RAISE EXCEPTION 'Sponsored accounts have no wallet to refund from'; END IF;
    SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
    IF _refund > _p.balance THEN
      RAISE EXCEPTION 'Refund % exceeds available balance %', _refund, _p.balance;
    END IF;
    PERFORM public.adjust_patient_balance(
      _adm.patient_id, -_refund, 'refund', _settlement_method, NULL, NULL,
      'Change paid out at discharge');
  END IF;

  UPDATE public.admissions
     SET status='discharged', discharged_at=now(), discharged_by=auth.uid(),
         discharge_notes=COALESCE(_notes, discharge_notes), updated_at=now()
   WHERE id = _admission_id AND status = 'ready_for_discharge';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was settled by someone else — refresh the queue';
  END IF;

  IF _adm.bed_id IS NOT NULL THEN
    UPDATE public.beds SET status='available', updated_at=now() WHERE id = _adm.bed_id;
  END IF;

  UPDATE public.patients SET status='discharged', updated_at=now() WHERE id = _adm.patient_id;

  PERFORM public.write_audit_log('admission_discharged','admission',_admission_id::text,
    jsonb_build_object('patient_id',_adm.patient_id,'notes',_notes,'debt',_debt,
                       'wallet_applied',_wallet_used,'collected',_collected,
                       'debt_cleared',_debt_cleared,
                       'outstanding',_remaining,'credit_left',_credit,'refunded',_refund,
                       'method',_settlement_method));

  RETURN jsonb_build_object('debt',_debt,'wallet_applied',_wallet_used,
                            'collected',_collected,'outstanding',_remaining,
                            'credit_left',_credit,'refunded',_refund);
END;
$function$;

REVOKE ALL ON FUNCTION public.discharge_admission(uuid,text,text,numeric,text,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid,text,text,numeric,text,numeric) TO authenticated;

-- ================================================================
-- 20260802232908_57759403-226f-4725-afc1-4aa65cfedaaa.sql
-- ================================================================
CREATE OR REPLACE FUNCTION public.mark_invoice_claim_settled(_invoice_id uuid, _notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _inv public.invoices%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.has_role(_uid, 'admin'::app_role) OR public.has_role(_uid, 'claims_manager'::app_role)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT * INTO _inv FROM public.invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice not found';
  END IF;

  IF _inv.status = 'paid' AND _inv.paid_amount >= _inv.total_amount THEN
    RETURN jsonb_build_object('ok', true, 'already_settled', true, 'invoice_id', _invoice_id);
  END IF;

  UPDATE public.invoices
     SET paid_amount = total_amount,
         status = 'paid',
         payment_method = COALESCE(payment_method, 'sponsor_claim'),
         paid_at = COALESCE(paid_at, now()),
         claim_submitted_at = COALESCE(claim_submitted_at, now()),
         claim_submitted_by = COALESCE(claim_submitted_by, _uid),
         claim_submission_notes = COALESCE(_notes, claim_submission_notes),
         updated_at = now()
   WHERE id = _invoice_id;

  INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, details, status, actor_role)
  VALUES (_uid, 'claim_invoice_settled', 'invoice', _invoice_id::text,
          jsonb_build_object('invoice_number', _inv.invoice_number,
                             'amount', _inv.total_amount,
                             'previous_paid', _inv.paid_amount,
                             'notes', _notes),
          'success', public.current_actor_role(_uid));

  RETURN jsonb_build_object('ok', true, 'invoice_id', _invoice_id, 'amount', _inv.total_amount);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_invoice_claim_settled(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_invoice_claim_settled(uuid, text) TO authenticated;

-- ================================================================
-- 20260802233411_bbd89560-0e7f-4b71-b17f-0874d228b6b0.sql
-- ================================================================
-- Restrict the database export backup bucket to admins only.
DROP POLICY IF EXISTS "Admins can read database export backups" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload database export backups" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update database export backups" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete database export backups" ON storage.objects;

CREATE POLICY "Admins can read database export backups"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'database_export_26_07_26' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can upload database export backups"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'database_export_26_07_26' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update database export backups"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'database_export_26_07_26' AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (bucket_id = 'database_export_26_07_26' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete database export backups"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'database_export_26_07_26' AND public.has_role(auth.uid(), 'admin'));

-- ================================================================
-- 20260803115547_5bd0a968-5256-49b9-83be-3d2c4259c622.sql
-- ================================================================
DROP TABLE IF EXISTS public.anc_visits CASCADE;
DROP TABLE IF EXISTS public.anc_programs CASCADE;
DROP FUNCTION IF EXISTS public.anc_touch_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.generate_anc_number() CASCADE;

-- ================================================================
-- 20260803190804_847e3ae0-76ee-4147-a19b-193692d22302.sql
-- ================================================================
DROP TABLE IF EXISTS public.stock_movements CASCADE;
DROP TABLE IF EXISTS public.stock_requests CASCADE;
DROP TABLE IF EXISTS public.inventory_items CASCADE;

