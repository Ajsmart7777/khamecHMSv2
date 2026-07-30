-- Regression sweep: privileged backend routines must stay locked down.
-- Any query below returning rows = REGRESSION. All must return zero rows.

-- 1. No SECURITY DEFINER function in public may be executable by anon or PUBLIC.
SELECT n.nspname AS schema, p.proname AS function, pg_get_function_identity_arguments(p.oid) AS args,
       'anon/PUBLIC can execute' AS problem
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
  AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('public', p.oid, 'EXECUTE'));

-- 2. Trigger functions must not be directly callable by app roles.
SELECT n.nspname AS schema, p.proname AS function, 'trigger fn directly callable' AS problem
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_type t ON t.oid = p.prorettype
WHERE n.nspname = 'public'
  AND t.typname = 'trigger'
  AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
       OR has_function_privilege('public', p.oid, 'EXECUTE'));

-- 3. Every SECURITY DEFINER function must pin a non-mutable search_path.
SELECT n.nspname AS schema, p.proname AS function, 'mutable search_path' AS problem
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
  AND (p.proconfig IS NULL
       OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'));

-- 4. Summary smoke numbers (informational, not pass/fail).
SELECT count(*) FILTER (WHERE p.prosecdef) AS security_definer_fns,
       count(*) AS total_public_fns
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public';
