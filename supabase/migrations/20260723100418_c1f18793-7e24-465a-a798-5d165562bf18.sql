
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
