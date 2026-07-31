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