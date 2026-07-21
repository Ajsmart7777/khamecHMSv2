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