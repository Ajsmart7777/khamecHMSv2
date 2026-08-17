CREATE OR REPLACE FUNCTION public.audit_user_roles() 
RETURNS trigger 
LANGUAGE plpgsql 
AS $$
BEGIN 
    IF tg_op = 'INSERT' THEN 
        SELECT public.write_audit_log('role_assigned', 'user_role', (new).id::STRING, jsonb_build_object('target_user_id', (new).user_id, 'role', (new)."role"), 'success'); 
        RETURN new; 
    ELSIF tg_op = 'DELETE' THEN 
        SELECT public.write_audit_log('role_removed', 'user_role', (old).id::STRING, jsonb_build_object('target_user_id', (old).user_id, 'role', (old)."role"), 'success'); 
        RETURN old; 
    ELSIF (tg_op = 'UPDATE') AND (((new)."role" IS DISTINCT FROM (old)."role") OR ((new).user_id IS DISTINCT FROM (old).user_id)) THEN 
        SELECT public.write_audit_log('role_assigned', 'user_role', (new).id::STRING, jsonb_build_object('target_user_id', (new).user_id, 'old_role', (old)."role", 'new_role', (new)."role"), 'success'); 
        RETURN new; 
    END IF; 
    RETURN new; 
END;
$$;
