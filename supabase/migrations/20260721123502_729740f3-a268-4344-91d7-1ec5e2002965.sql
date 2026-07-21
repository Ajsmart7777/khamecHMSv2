
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
