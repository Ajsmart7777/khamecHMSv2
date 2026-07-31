DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
           t.typname = 'trigger' AS is_trigger
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_type t ON t.oid = p.prorettype
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', r.proname, r.args);
    IF NOT r.is_trigger THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', r.proname, r.args);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', r.proname, r.args);
  END LOOP;
END $$;