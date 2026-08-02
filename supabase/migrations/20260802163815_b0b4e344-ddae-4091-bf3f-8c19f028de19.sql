CREATE OR REPLACE FUNCTION public.discharge_admission(_admission_id uuid, _notes text DEFAULT NULL::text, _settlement_method text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0, _settlement_notes text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD; _p RECORD; _wallet boolean;
  _debt numeric; _collected numeric := 0; _remaining numeric := 0;
  _inv RECORD; _apply numeric; _left numeric; _pct numeric; _share numeric;
  _wallet_used numeric := 0;
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

  PERFORM public.bill_admission_bed_days(_admission_id);

  _wallet_used := public.apply_wallet_to_outstanding(_adm.patient_id, 'Balance applied at discharge');

  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
  _wallet := public.has_wallet(_p.account_type);
  _pct    := public.copay_percent(_p.account_type, _p.insurance_plan);
  _debt   := public.patient_outstanding(_adm.patient_id);
  _remaining := _debt;

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash','pos','transfer') THEN
      _collected := ROUND(GREATEST(COALESCE(_settlement_amount,0),0), 2);
      IF _collected <= 0 THEN RAISE EXCEPTION 'Settlement amount must be greater than zero'; END IF;
      IF _wallet AND _p.balance < 0 THEN
        PERFORM public.adjust_patient_balance(
          _adm.patient_id, LEAST(_collected, -_p.balance), 'debt_cleared', _settlement_method,
          NULL, NULL, COALESCE(_settlement_notes,'Discharge settlement'));
      END IF;
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
      IF _remaining > 0 THEN
        IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
          RAISE EXCEPTION 'PARTIAL_REASON_REQUIRED: provide a reason for the outstanding %', _remaining;
        END IF;
        PERFORM public.write_audit_log('discharge_partial_settlement','admission',_admission_id::text,
          jsonb_build_object('patient_id',_adm.patient_id,'debt',_debt,'collected',_collected,
                             'outstanding',_remaining,'method',_settlement_method,'notes',_settlement_notes));
      END IF;

    ELSIF _settlement_method = 'carry' THEN
      IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
        RAISE EXCEPTION 'CARRY_REASON_REQUIRED: provide a reason for carrying the debt';
      END IF;
      PERFORM public.write_audit_log('debt_carried_on_discharge','admission',_admission_id::text,
        jsonb_build_object('patient_id',_adm.patient_id,'debt',_debt,'notes',_settlement_notes));
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  _left := CASE WHEN _settlement_method IN ('cash','pos','transfer') THEN _collected ELSE 0 END;
  IF _left > 0 THEN
    FOR _inv IN
      SELECT id, total_amount, COALESCE(paid_amount,0) AS paid
      FROM public.invoices
      WHERE patient_id = _adm.patient_id AND status IN ('pending','partial')
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN _left <= 0;
      _share := ROUND(_inv.total_amount * _pct / 100.0, 2);
      _apply := ROUND(LEAST(_left, GREATEST(0, _share - _inv.paid)), 2);
      CONTINUE WHEN _apply <= 0;
      UPDATE public.invoices
         SET paid_amount = _inv.paid + _apply,
             status = CASE WHEN _inv.paid + _apply >= _share THEN 'paid' ELSE 'partial' END,
             paid_at = CASE WHEN _inv.paid + _apply >= _share THEN now() ELSE paid_at END,
             payment_method = COALESCE(payment_method, _settlement_method),
             updated_at = now()
       WHERE id = _inv.id;
      _left := ROUND(_left - _apply, 2);
    END LOOP;
  END IF;

  UPDATE public.admissions
     SET status='discharged', discharged_at=now(), discharged_by=auth.uid(),
         discharge_notes=_notes, updated_at=now()
   WHERE id = _admission_id;

  IF _adm.bed_id IS NOT NULL THEN
    UPDATE public.beds SET status='available', updated_at=now() WHERE id = _adm.bed_id;
  END IF;

  UPDATE public.patients SET status='discharged', updated_at=now() WHERE id = _adm.patient_id;

  PERFORM public.write_audit_log('admission_discharged','admission',_admission_id::text,
    jsonb_build_object('patient_id',_adm.patient_id,'notes',_notes,'debt',_debt,
                       'wallet_applied',_wallet_used,'collected',_collected,
                       'outstanding',_remaining,'method',_settlement_method));

  RETURN jsonb_build_object('debt',_debt,'wallet_applied',_wallet_used,
                            'collected',_collected,'outstanding',_remaining);
END;
$function$;