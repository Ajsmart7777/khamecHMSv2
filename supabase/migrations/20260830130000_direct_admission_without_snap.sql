-- Direct admission path without image or typed note. Existing snap admission is unchanged.
CREATE OR REPLACE FUNCTION public.request_admission_direct(
  _patient_id uuid,
  _visit_id uuid DEFAULT NULL,
  _reason text DEFAULT NULL,
  _note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _uid uuid := public.hms_current_user_id();
  _adm uuid;
  _visit uuid := _visit_id;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to admit';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.admissions
    WHERE patient_id = _patient_id
      AND status IN ('waiting_assignment','active','ready_for_discharge')
  ) THEN
    RAISE EXCEPTION 'Patient already has an open admission';
  END IF;
  IF _visit IS NULL THEN
    SELECT id INTO _visit FROM public.visits
    WHERE patient_id = _patient_id AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;
  END IF;
  INSERT INTO public.admissions (
    patient_id, visit_id, admitting_doctor, reason, status,
    admission_snap_path, admission_note
  ) VALUES (
    _patient_id, _visit, _uid, NULLIF(trim(_reason), ''), 'waiting_assignment',
    NULL, NULLIF(trim(_note), '')
  ) RETURNING id INTO _adm;
  SELECT public.write_audit_log(
    'admission_requested_direct', 'admission', _adm::text,
    jsonb_build_object('patient_id', _patient_id, 'visit_id', _visit, 'mode', 'direct_without_snap')
  );
  RETURN _adm;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_admission_direct(uuid, uuid, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.request_admission_direct(uuid, uuid, text, text) FROM anon;

