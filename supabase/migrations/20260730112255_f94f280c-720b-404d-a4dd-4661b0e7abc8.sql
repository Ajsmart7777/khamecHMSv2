CREATE OR REPLACE FUNCTION public.discharge_admission(_admission_id uuid, _notes text DEFAULT NULL::text, _settlement_method text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0, _settlement_notes text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
  IF _adm.status NOT IN ('active','ready_for_discharge') THEN
    RAISE EXCEPTION 'Admission is not active (%)', _adm.status;
  END IF;

  -- Accrued bed charge is billed here (once per admission)
  PERFORM public.bill_admission_bed_days(_admission_id);

  SELECT balance INTO _bal FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
  _debt := GREATEST(0, -COALESCE(_bal,0));

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash','pos','transfer') THEN
      IF COALESCE(_settlement_amount,0) < _debt THEN
        RAISE EXCEPTION 'Settlement amount % is less than debt %', _settlement_amount, _debt;
      END IF;
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, _settlement_amount, 'debt_cleared', _settlement_method,
        NULL, NULL, COALESCE(_settlement_notes, 'Discharge settlement')
      );
    ELSIF _settlement_method = 'waive' THEN
      IF NOT public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]) THEN
        RAISE EXCEPTION 'Only accountant/admin can waive debt';
      END IF;
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, _debt, 'debt_cleared', 'waive',
        NULL, NULL, COALESCE(_settlement_notes, 'Discharge - debt waived')
      );
    ELSIF _settlement_method = 'carry' THEN
      PERFORM public.write_audit_log(
        'debt_carried_on_discharge', 'admission', _admission_id::text,
        jsonb_build_object('patient_id', _adm.patient_id, 'debt', _debt, 'notes', _settlement_notes)
      );
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  UPDATE public.admissions
     SET status = 'discharged',
         discharged_at = now(),
         discharged_by = auth.uid(),
         discharge_notes = _notes,
         updated_at = now()
   WHERE id = _admission_id;

  IF _adm.bed_id IS NOT NULL THEN
    UPDATE public.beds SET status = 'available', updated_at = now() WHERE id = _adm.bed_id;
  END IF;

  UPDATE public.patients SET status = 'discharged', updated_at = now() WHERE id = _adm.patient_id;

  PERFORM public.write_audit_log(
    'admission_discharged', 'admission', _admission_id::text,
    jsonb_build_object('patient_id', _adm.patient_id, 'notes', _notes)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) FROM public;
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) TO authenticated, service_role;