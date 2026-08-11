-- Database size function
CREATE OR REPLACE FUNCTION public.get_database_size()
RETURNS TABLE (
  database_size_bytes bigint,
  database_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if user is admin
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can check database size';
  END IF;

  RETURN QUERY
  SELECT pg_database_size(current_database()), current_database()::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_database_size() TO authenticated;
GRANT ALL ON FUNCTION public.get_database_size() TO service_role;
