-- SOURCE: 20260102085609_67890656-3806-4bae-a815-5dce5843d236.sql statement 1
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

-- SOURCE: 20260102085609_67890656-3806-4bae-a815-5dce5843d236.sql statement 2
CREATE INDEX idx_patients_status ON public.patients(status);

-- SOURCE: 20260102085609_67890656-3806-4bae-a815-5dce5843d236.sql statement 3
CREATE INDEX idx_patients_card_number ON public.patients(card_number);

-- SOURCE: 20260102085609_67890656-3806-4bae-a815-5dce5843d236.sql statement 4
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260102085609_67890656-3806-4bae-a815-5dce5843d236.sql statement 5
CREATE POLICY "Allow public read access to patients"
ON public.patients
FOR SELECT
TO anon, authenticated
USING (true);

-- SOURCE: 20260102085609_67890656-3806-4bae-a815-5dce5843d236.sql statement 6
CREATE POLICY "Allow public insert access to patients"
ON public.patients
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- SOURCE: 20260102085609_67890656-3806-4bae-a815-5dce5843d236.sql statement 7
CREATE POLICY "Allow public update access to patients"
ON public.patients
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- SOURCE: 20260102085609_67890656-3806-4bae-a815-5dce5843d236.sql statement 8
CREATE OR REPLACE FUNCTION public.update_patients_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- SOURCE: 20260102085609_67890656-3806-4bae-a815-5dce5843d236.sql statement 9
CREATE TRIGGER update_patients_updated_at
BEFORE UPDATE ON public.patients
FOR EACH ROW
EXECUTE FUNCTION public.update_patients_updated_at();

-- SOURCE: 20260102085650_3e9ecb01-abbb-4833-b3fd-508d9b268786.sql statement 1
CREATE OR REPLACE FUNCTION public.update_patients_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;

-- SOURCE: 20260102135919_40717372-9559-45fa-afb5-a445bdb89b47.sql statement 1
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

-- SOURCE: 20260102135919_40717372-9559-45fa-afb5-a445bdb89b47.sql statement 2
ALTER TABLE public.lab_requests ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260102135919_40717372-9559-45fa-afb5-a445bdb89b47.sql statement 3
CREATE POLICY "Allow public read access to lab_requests" 
ON public.lab_requests 
FOR SELECT 
USING (true);

-- SOURCE: 20260102135919_40717372-9559-45fa-afb5-a445bdb89b47.sql statement 4
CREATE POLICY "Allow public insert access to lab_requests" 
ON public.lab_requests 
FOR INSERT 
WITH CHECK (true);

-- SOURCE: 20260102135919_40717372-9559-45fa-afb5-a445bdb89b47.sql statement 5
CREATE POLICY "Allow public update access to lab_requests" 
ON public.lab_requests 
FOR UPDATE 
USING (true)
WITH CHECK (true);

-- SOURCE: 20260102135919_40717372-9559-45fa-afb5-a445bdb89b47.sql statement 6
CREATE TRIGGER update_lab_requests_updated_at
BEFORE UPDATE ON public.lab_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_patients_updated_at();

-- SOURCE: 20260102135919_40717372-9559-45fa-afb5-a445bdb89b47.sql statement 7
ALTER TABLE public.lab_requests REPLICA IDENTITY FULL;

-- SOURCE: 20260102135919_40717372-9559-45fa-afb5-a445bdb89b47.sql statement 9
CREATE INDEX idx_lab_requests_patient_id ON public.lab_requests(patient_id);

-- SOURCE: 20260102135919_40717372-9559-45fa-afb5-a445bdb89b47.sql statement 10
CREATE INDEX idx_lab_requests_status ON public.lab_requests(status);

-- SOURCE: 20260102141033_3ce479c8-fc0e-4d41-8a0e-69a70b8538d6.sql statement 1
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

-- SOURCE: 20260102141033_3ce479c8-fc0e-4d41-8a0e-69a70b8538d6.sql statement 2
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

-- SOURCE: 20260102141033_3ce479c8-fc0e-4d41-8a0e-69a70b8538d6.sql statement 3
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260102141033_3ce479c8-fc0e-4d41-8a0e-69a70b8538d6.sql statement 4
CREATE POLICY "Allow public read access to prescriptions"
ON public.prescriptions FOR SELECT
USING (true);

-- SOURCE: 20260102141033_3ce479c8-fc0e-4d41-8a0e-69a70b8538d6.sql statement 5
CREATE POLICY "Allow public insert access to prescriptions"
ON public.prescriptions FOR INSERT
WITH CHECK (true);

-- SOURCE: 20260102141033_3ce479c8-fc0e-4d41-8a0e-69a70b8538d6.sql statement 6
CREATE POLICY "Allow public update access to prescriptions"
ON public.prescriptions FOR UPDATE
USING (true)
WITH CHECK (true);

-- SOURCE: 20260102141033_3ce479c8-fc0e-4d41-8a0e-69a70b8538d6.sql statement 7
ALTER TABLE public.prescription_items ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260102141033_3ce479c8-fc0e-4d41-8a0e-69a70b8538d6.sql statement 8
CREATE POLICY "Allow public read access to prescription_items"
ON public.prescription_items FOR SELECT
USING (true);

-- SOURCE: 20260102141033_3ce479c8-fc0e-4d41-8a0e-69a70b8538d6.sql statement 9
CREATE POLICY "Allow public insert access to prescription_items"
ON public.prescription_items FOR INSERT
WITH CHECK (true);

-- SOURCE: 20260102141033_3ce479c8-fc0e-4d41-8a0e-69a70b8538d6.sql statement 10
CREATE POLICY "Allow public update access to prescription_items"
ON public.prescription_items FOR UPDATE
USING (true)
WITH CHECK (true);

-- SOURCE: 20260102141033_3ce479c8-fc0e-4d41-8a0e-69a70b8538d6.sql statement 11
CREATE TRIGGER update_prescriptions_updated_at
  BEFORE UPDATE ON public.prescriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_patients_updated_at();

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 1
CREATE TYPE public.app_role AS ENUM ('admin', 'doctor', 'nurse', 'receptionist', 'pharmacist', 'lab_tech', 'billing', 'store');

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 2
CREATE TABLE public.user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES neon_auth.user(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (user_id, role)
);

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 3
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 4
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

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 5
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

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 6
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

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 7
CREATE POLICY "Users can view their own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 8
CREATE POLICY "Only admins can insert roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 9
CREATE POLICY "Only admins can update roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 10
CREATE POLICY "Only admins can delete roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 11
DROP POLICY IF EXISTS "Allow public read access to patients" ON public.patients;

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 12
DROP POLICY IF EXISTS "Allow public insert access to patients" ON public.patients;

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 13
DROP POLICY IF EXISTS "Allow public update access to patients" ON public.patients;

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 14
CREATE POLICY "Authenticated staff can read patients"
ON public.patients
FOR SELECT
TO authenticated
USING (public.is_authenticated_staff());

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 15
CREATE POLICY "Reception and admin can insert patients"
ON public.patients
FOR INSERT
TO authenticated
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['receptionist', 'admin']::app_role[]));

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 16
CREATE POLICY "Staff can update patients"
ON public.patients
FOR UPDATE
TO authenticated
USING (public.is_authenticated_staff());

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 17
DROP POLICY IF EXISTS "Allow public read access to lab_requests" ON public.lab_requests;

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 18
DROP POLICY IF EXISTS "Allow public insert access to lab_requests" ON public.lab_requests;

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 19
DROP POLICY IF EXISTS "Allow public update access to lab_requests" ON public.lab_requests;

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 20
CREATE POLICY "Authenticated staff can read lab_requests"
ON public.lab_requests
FOR SELECT
TO authenticated
USING (public.is_authenticated_staff());

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 21
CREATE POLICY "Doctors and lab_tech can insert lab_requests"
ON public.lab_requests
FOR INSERT
TO authenticated
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['doctor', 'lab_tech', 'admin']::app_role[]));

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 22
CREATE POLICY "Doctors and lab_tech can update lab_requests"
ON public.lab_requests
FOR UPDATE
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['doctor', 'lab_tech', 'admin']::app_role[]));

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 23
DROP POLICY IF EXISTS "Allow public read access to prescriptions" ON public.prescriptions;

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 24
DROP POLICY IF EXISTS "Allow public insert access to prescriptions" ON public.prescriptions;

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 25
DROP POLICY IF EXISTS "Allow public update access to prescriptions" ON public.prescriptions;

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 26
CREATE POLICY "Authenticated staff can read prescriptions"
ON public.prescriptions
FOR SELECT
TO authenticated
USING (public.is_authenticated_staff());

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 27
CREATE POLICY "Doctors can insert prescriptions"
ON public.prescriptions
FOR INSERT
TO authenticated
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['doctor', 'admin']::app_role[]));

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 28
CREATE POLICY "Doctors and pharmacists can update prescriptions"
ON public.prescriptions
FOR UPDATE
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['doctor', 'pharmacist', 'admin']::app_role[]));

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 29
DROP POLICY IF EXISTS "Allow public read access to prescription_items" ON public.prescription_items;

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 30
DROP POLICY IF EXISTS "Allow public insert access to prescription_items" ON public.prescription_items;

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
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['doctor', 'admin']::app_role[]));

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 34
CREATE POLICY "Doctors and pharmacists can update prescription_items"
ON public.prescription_items
FOR UPDATE
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['doctor', 'pharmacist', 'admin']::app_role[]));

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 35
ALTER TABLE public.patients ADD CONSTRAINT check_balance_non_negative CHECK (balance >= 0);

-- SOURCE: 20260103093936_d89dca3e-5ece-4f84-a7d6-6ce57ccc417d.sql statement 36
ALTER TABLE public.prescription_items ADD CONSTRAINT check_quantity_positive CHECK (quantity > 0);

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 1
CREATE TABLE public.audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES neon_auth.user(id) ON DELETE SET NULL,
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
CREATE INDEX idx_audit_logs_user_id ON public.audit_logs(user_id);

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 3
CREATE INDEX idx_audit_logs_action ON public.audit_logs(action);

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 4
CREATE INDEX idx_audit_logs_resource_type ON public.audit_logs(resource_type);

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 5
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 6
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 7
CREATE POLICY "Only admins can read audit_logs"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 8
CREATE POLICY "Authenticated users can insert audit_logs"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

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
  user_id UUID REFERENCES neon_auth.user(id) ON DELETE SET NULL,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  context JSONB,
  url TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 11
CREATE INDEX idx_error_logs_created_at ON public.error_logs(created_at DESC);

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 12
CREATE INDEX idx_error_logs_error_type ON public.error_logs(error_type);

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 13
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260103095742_22e9c673-e599-404b-87d8-cb62a3cac130.sql statement 14
CREATE POLICY "Only admins can read error_logs"
ON public.error_logs
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));
