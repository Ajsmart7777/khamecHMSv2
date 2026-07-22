
CREATE OR REPLACE FUNCTION public.discharge_admission(
  _admission_id uuid,
  _notes text DEFAULT NULL,
  _settlement_method text DEFAULT NULL,  -- 'cash','pos','transfer','waive','carry' or NULL when balance>=0
  _settlement_amount numeric DEFAULT 0,
  _settlement_notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _adm RECORD;
  _bal numeric;
  _debt numeric;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
       ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to discharge';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF _adm.status <> 'active' THEN RAISE EXCEPTION 'Admission is not active (%)', _adm.status; END IF;

  SELECT balance INTO _bal FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
  _debt := GREATEST(0, -COALESCE(_bal,0));

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % — pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash','pos','transfer') THEN
      IF COALESCE(_settlement_amount,0) < _debt THEN
        RAISE EXCEPTION 'Settlement amount % is less than debt %', _settlement_amount, _debt;
      END IF;
      -- Credit the patient balance to clear debt (and keep any excess)
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, _settlement_amount, 'debt_cleared', _settlement_method,
        NULL, NULL,
        COALESCE(_settlement_notes, 'Discharge settlement')
      );
    ELSIF _settlement_method = 'waive' THEN
      IF NOT public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]) THEN
        RAISE EXCEPTION 'Only accountant/admin can waive debt';
      END IF;
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, _debt, 'debt_cleared', 'waive',
        NULL, NULL,
        COALESCE(_settlement_notes, 'Discharge — debt waived')
      );
    ELSIF _settlement_method = 'carry' THEN
      -- Debt stays on patient balance; log only
      PERFORM public.write_audit_log(
        'debt_carried_on_discharge', 'admission', _admission_id::text,
        jsonb_build_object('patient_id', _adm.patient_id, 'debt', _debt, 'notes', _settlement_notes)
      );
    ELSE
      RAISE EXCEPTION 'Unknown settlement method: %', _settlement_method;
    END IF;
  END IF;

  UPDATE public.admissions
    SET status = 'discharged',
        discharged_at = now(),
        discharged_by = auth.uid(),
        discharge_notes = _notes,
        updated_at = now()
    WHERE id = _admission_id;

  PERFORM public.write_audit_log(
    'patient_discharged', 'admission', _admission_id::text,
    jsonb_build_object(
      'patient_id', _adm.patient_id,
      'bed_id', _adm.bed_id,
      'debt_at_discharge', _debt,
      'settlement_method', _settlement_method,
      'settlement_amount', _settlement_amount
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) TO authenticated;
