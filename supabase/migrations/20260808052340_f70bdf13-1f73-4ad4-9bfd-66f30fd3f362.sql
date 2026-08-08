-- First, drop the conflicting policies to ensure a clean state
DROP POLICY IF EXISTS "Admins and reception can delete patients" ON public.patients;
DROP POLICY IF EXISTS "Only admins can delete patients" ON public.patients;

-- Re-create the policy with correct access for both roles
CREATE POLICY "Admins and reception can delete patients"
ON public.patients
FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') OR 
  public.has_role(auth.uid(), 'receptionist')
);

-- Ensure authenticated users have the necessary table-level grant for DELETE
GRANT DELETE ON public.patients TO authenticated;