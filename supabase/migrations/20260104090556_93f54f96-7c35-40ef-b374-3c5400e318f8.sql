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