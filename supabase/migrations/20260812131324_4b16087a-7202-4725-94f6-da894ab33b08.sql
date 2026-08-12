
-- Drop ALL variants of write_audit_log to ensure a clean slate.
DROP FUNCTION IF EXISTS public.write_audit_log(text, text, text, jsonb, text);
DROP FUNCTION IF EXISTS public.write_audit_log(text, jsonb, uuid, text, text);
DROP FUNCTION IF EXISTS public.write_audit_log(text, jsonb, uuid, text);
DROP FUNCTION IF EXISTS public.write_audit_log(text, json, uuid, text);
DROP FUNCTION IF EXISTS public.write_audit_log(text, json, uuid, text, text);

-- Unified base function
CREATE OR REPLACE FUNCTION public.write_audit_log(
    _action text,
    _details jsonb,
    _resource_id text,
    _resource_type text,
    _status text DEFAULT 'success'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _uid uuid := auth.uid();
    _role text := public.current_actor_role(auth.uid());
BEGIN
    INSERT INTO public.audit_logs (
        user_id,
        action,
        resource_type,
        resource_id,
        details,
        status,
        actor_role
    )
    VALUES (
        _uid,
        _action,
        _resource_type,
        _resource_id,
        COALESCE(_details, '{}'::jsonb) || jsonb_build_object('actor_role', _role),
        _status,
        _role
    );
END;
$$;

-- Overload for (text, text, text, jsonb, text) -> Legacy (action, resource_type, resource_id, details, status)
CREATE OR REPLACE FUNCTION public.write_audit_log(
    _action text,
    _resource_type text,
    _resource_id text,
    _details jsonb,
    _status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.write_audit_log(_action, _details, _resource_id, _resource_type, _status);
END;
$$;

-- Overload for (text, text, text, jsonb) -> Legacy 4-args
CREATE OR REPLACE FUNCTION public.write_audit_log(
    _action text,
    _resource_type text,
    _resource_id text,
    _details jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.write_audit_log(_action, _details, _resource_id, _resource_type, 'success');
END;
$$;

-- Overload for (text, jsonb, uuid, text) -> Modern 4-args
CREATE OR REPLACE FUNCTION public.write_audit_log(
    _action text,
    _details jsonb,
    _resource_id uuid,
    _resource_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.write_audit_log(_action, _details, _resource_id::text, _resource_type, 'success');
END;
$$;

-- Overload for (text, json, uuid, text) -> JSON catch-all
CREATE OR REPLACE FUNCTION public.write_audit_log(
    _action text,
    _details json,
    _resource_id uuid,
    _resource_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.write_audit_log(_action, _details::jsonb, _resource_id::text, _resource_type, 'success');
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, text, text, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, json, uuid, text) TO authenticated, service_role;
