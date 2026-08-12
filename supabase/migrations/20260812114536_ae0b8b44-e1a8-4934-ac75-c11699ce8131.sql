-- Drop the existing function to allow changing parameter defaults/signatures
DROP FUNCTION IF EXISTS public.write_audit_log(text, jsonb, uuid, text, text);
DROP FUNCTION IF EXISTS public.write_audit_log(text, jsonb, uuid, text);

-- 1. Create the version WITH the status parameter (default 'success')
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

-- 2. Create an explicit overload WITHOUT the status parameter 
-- This explicitly handles the 4-argument call from other PL/pgSQL functions.
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

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text) TO service_role;
