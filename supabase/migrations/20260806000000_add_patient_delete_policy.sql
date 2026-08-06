-- Allow receptionists and admins to delete patients
CREATE POLICY "Admins and reception can delete patients"
ON public.patients
FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') OR 
  public.has_role(auth.uid(), 'receptionist')
);

-- Grant DELETE permission to authenticated users (required for RLS to be evaluated for that action)
GRANT DELETE ON public.patients TO authenticated;
