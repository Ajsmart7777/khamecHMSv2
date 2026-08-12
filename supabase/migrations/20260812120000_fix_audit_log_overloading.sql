-- Force drop all variants to ensure clean state
DROP FUNCTION IF EXISTS public.write_audit_log(text, jsonb, uuid, text, text);
DROP FUNCTION IF EXISTS public.write_audit_log(text, jsonb, uuid, text);
DROP FUNCTION IF EXISTS public.write_audit_log(text, json, uuid, text);
DROP FUNCTION IF EXISTS public.write_audit_log(text, json, uuid, text, text);

-- 1. Base function with 5 arguments (text, jsonb, uuid, text, text)
CREATE OR REPLACE FUNCTION public.write_audit_log(
    _action text,
    _details jsonb,
    _resource_id uuid,
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
        _resource_id::text,
        COALESCE(_details, '{}'::jsonb) || jsonb_build_object('actor_role', _role),
        _status,
        _role
    );
END;
$$;

-- 2. Overload for 4 arguments (text, jsonb, uuid, text)
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
    PERFORM public.write_audit_log(_action, _details, _resource_id, _resource_type, 'success');
END;
$$;

-- 3. Overload for 4 arguments using JSON (not JSONB) to catch 'unknown' or legacy JSON casts
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
    PERFORM public.write_audit_log(_action, _details::jsonb, _resource_id, _resource_type, 'success');
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, json, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, json, uuid, text) TO service_role;
