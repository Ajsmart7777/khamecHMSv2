-- Fix archive confirmation counting on CockroachDB.
-- The previous compatibility rewrite counted pending rows after changing them
-- to download_confirmed, so every valid confirmation incorrectly raised the
-- "No pending archive records" error.

CREATE OR REPLACE FUNCTION public.confirm_archive_download(_archive_reference text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reference text := btrim(COALESCE(_archive_reference, ''));
  v_pending integer := 0;
BEGIN
  IF NOT public.has_role(public.hms_current_user_id(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can confirm an archive download';
  END IF;

  IF v_reference = '' THEN
    RAISE EXCEPTION 'An archive reference is required';
  END IF;

  SELECT count(*) INTO v_pending
  FROM public.patient_archive_records
  WHERE archive_reference = v_reference
    AND status = 'pending_download';

  IF v_pending = 0 THEN
    RAISE EXCEPTION 'No pending archive records were found for reference %', v_reference;
  END IF;

  UPDATE public.patient_archive_records
  SET status = 'download_confirmed',
      download_confirmed_at = now(),
      download_confirmed_by = public.hms_current_user_id()
  WHERE archive_reference = v_reference
    AND status = 'pending_download';

  SELECT public.write_audit_log(
    'confirm_archive_download',
    'patient_archive_records',
    v_reference,
    jsonb_build_object('patient_count', v_pending),
    'success'
  );

  RETURN v_pending;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_archive_download(text) TO authenticated;
