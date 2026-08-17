-- SOURCE: 20260802173457_3e4fcb5e-4970-4276-a570-8d6d50132eb1.sql statement 1
ALTER TABLE public.admissions DROP CONSTRAINT IF EXISTS admissions_status_check;

-- SOURCE: 20260802173457_3e4fcb5e-4970-4276-a570-8d6d50132eb1.sql statement 2
ALTER TABLE public.admissions ADD CONSTRAINT admissions_status_check CHECK (status = ANY (ARRAY['waiting_assignment'::text, 'active'::text, 'ready_for_discharge'::text, 'discharged'::text, 'cancelled'::text]));

-- SOURCE: 20260802175519_b40544d3-e3e3-4919-8cc5-a15de1544f1a.sql statement 1
CREATE OR REPLACE FUNCTION public.discharge_admission(_admission_id uuid, _notes text DEFAULT NULL::text, _settlement_method text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0, _settlement_notes text DEFAULT NULL::text, _refund_amount numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 
AS $function$
DECLARE
  _adm public.admissions; _p public.patients; _wallet boolean;
  _debt numeric; _collected numeric := 0; _remaining numeric := 0;
  _inv public.invoices; _apply numeric; _left numeric;
  _applied numeric := 0; _pct numeric; _share numeric;
  _wallet_used numeric := 0; _refund numeric := 0; _credit numeric := 0;
  _got_lock boolean;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(),
       ARRAY['cashier','billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only the cashier can settle and complete a discharge';
  END IF;

  _got_lock := true;
  IF NOT _got_lock THEN
    RAISE EXCEPTION 'DISCHARGE_IN_PROGRESS: this discharge is already being settled — refresh the queue';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;

  IF (_adm).status = 'discharged' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was already settled and discharged on %',
      COALESCE(to_char((_adm).discharged_at, 'DD Mon YYYY HH24:MI'), 'an earlier date');
  END IF;
  IF (_adm).status = 'cancelled' THEN
    RAISE EXCEPTION 'ADMISSION_CANCELLED: this admission was cancelled and cannot be settled';
  END IF;
  IF (_adm).status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'NOT_IN_CASHIER_QUEUE: the ward has not confirmed this discharge yet (%)', (_adm).status;
  END IF;

  SELECT public.bill_admission_bed_days(_admission_id);

  _wallet_used := public.apply_wallet_to_outstanding((_adm).patient_id, 'Balance applied at discharge');

  SELECT * INTO _p FROM public.patients WHERE id = (_adm).patient_id FOR UPDATE;
  _wallet := public.has_wallet((_p).account_type);
  _pct    := public.copay_percent((_p).account_type, (_p).insurance_plan);
  _debt   := public.patient_outstanding((_adm).patient_id);
  _remaining := _debt;

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash','pos','transfer') THEN
      _collected := ROUND(GREATEST(COALESCE(_settlement_amount,0),0), 2);
      IF _collected <= 0 THEN RAISE EXCEPTION 'Settlement amount must be greater than zero'; END IF;
      IF _wallet AND (_p).balance < 0 THEN
        SELECT public.adjust_patient_balance(
          (_adm).patient_id, LEAST(_collected, -(_p).balance), 'debt_cleared', _settlement_method,
          NULL, NULL, COALESCE(_settlement_notes,'Discharge settlement'));
      END IF;
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
      IF _remaining > 0 THEN
        SELECT public.write_audit_log('discharge_partial_settlement', 'admission', _admission_id::text, jsonb_build_object('patient_id',(_adm).patient_id,'debt',_debt,'collected',_collected,
                             'outstanding',_remaining,'method',_settlement_method,'notes',_settlement_notes), 'success');
      END IF;

    ELSIF _settlement_method = 'carry' THEN
      SELECT public.write_audit_log('debt_carried_on_discharge', 'admission', _admission_id::text, jsonb_build_object('patient_id',(_adm).patient_id,'debt',_debt,'notes',_settlement_notes), 'success');
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  _left := CASE WHEN _settlement_method IN ('cash','pos','transfer') THEN _collected ELSE 0 END;
  IF _left > 0 THEN
    SELECT COALESCE(SUM(applied), 0) INTO _applied
    FROM (
      SELECT LEAST(share, GREATEST(_left - prior_due, 0))::numeric AS applied
      FROM (
        SELECT ROUND(total_amount * _pct / 100.0, 2)::numeric AS share,
               GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)::numeric AS due,
               COALESCE(SUM(GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)) OVER (
                 ORDER BY created_at ASC, id ASC
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ), 0)::numeric AS prior_due
        FROM public.invoices
        WHERE patient_id = (_adm).patient_id AND status IN ('pending','partial')
      ) unpaid
    ) allocation;

    WITH unpaid AS (
      SELECT id, total_amount, COALESCE(paid_amount, 0)::numeric AS paid,
             ROUND(total_amount * _pct / 100.0, 2)::numeric AS share,
             GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)::numeric AS due,
             COALESCE(SUM(GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)) OVER (
               ORDER BY created_at ASC, id ASC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0)::numeric AS prior_due
      FROM public.invoices
      WHERE patient_id = (_adm).patient_id AND status IN ('pending','partial')
    ), allocated AS (
      SELECT id, total_amount, paid, share,
             LEAST(due, GREATEST(_left - prior_due, 0))::numeric AS applied
      FROM unpaid
    )
    UPDATE public.invoices i
       SET paid_amount = a.paid + a.applied,
           status = CASE WHEN a.paid + a.applied >= a.share THEN 'paid' ELSE 'partial' END,
           paid_at = CASE WHEN a.paid + a.applied >= a.share THEN now() ELSE i.paid_at END,
           payment_method = COALESCE(i.payment_method, _settlement_method),
           updated_at = now()
      FROM allocated a
     WHERE i.id = a.id AND a.applied > 0;

    _left := ROUND(_left - COALESCE(_applied, 0), 2);
  END IF;

  IF _wallet AND _left > 0 THEN
    SELECT public.adjust_patient_balance(
      (_adm).patient_id, _left, 'topup', _settlement_method, NULL, NULL,
      'Change from discharge settlement left on balance');
    _credit := _left;
  END IF;

  _refund := ROUND(GREATEST(COALESCE(_refund_amount,0),0), 2);
  IF _refund > 0 THEN
    IF NOT _wallet THEN RAISE EXCEPTION 'Sponsored accounts have no wallet to refund from'; END IF;
    SELECT * INTO _p FROM public.patients WHERE id = (_adm).patient_id FOR UPDATE;
    IF _refund > (_p).balance THEN
      RAISE EXCEPTION 'Refund % exceeds available balance %', _refund, (_p).balance;
    END IF;
    SELECT public.adjust_patient_balance(
      (_adm).patient_id, -_refund, 'refund', _settlement_method, NULL, NULL,
      'Change paid out at discharge');
  END IF;

  UPDATE public.admissions
     SET status='discharged', discharged_at=now(), discharged_by=public.hms_current_user_id(),
         discharge_notes=COALESCE(_notes, discharge_notes), updated_at=now()
   WHERE id = _admission_id AND status = 'ready_for_discharge';

  IF (_adm).status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was settled by someone else — refresh the queue';
  END IF;

  IF (_adm).bed_id IS NOT NULL THEN
    UPDATE public.beds SET status='available', updated_at=now() WHERE id = (_adm).bed_id;
  END IF;

  UPDATE public.patients SET status='discharged', updated_at=now() WHERE id = (_adm).patient_id;

  SELECT public.write_audit_log('admission_discharged', 'admission', _admission_id::text, jsonb_build_object('patient_id',(_adm).patient_id,'notes',_notes,'debt',_debt,
                       'wallet_applied',_wallet_used,'collected',_collected,
                       'outstanding',_remaining,'credit_left',_credit,'refunded',_refund,
                       'method',_settlement_method), 'success');

  RETURN jsonb_build_object('debt',_debt,'wallet_applied',_wallet_used,
                            'collected',_collected,'outstanding',_remaining,
                            'credit_left',_credit,'refunded',_refund);
END;
$function$;

-- SOURCE: 20260802175519_b40544d3-e3e3-4919-8cc5-a15de1544f1a.sql statement 2
REVOKE EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) FROM PUBLIC, anon;

-- SOURCE: 20260802175519_b40544d3-e3e3-4919-8cc5-a15de1544f1a.sql statement 3
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) TO authenticated;

-- SOURCE: 20260802193417_5deb48e4-7a2e-4714-a8e1-bd30e8865d88.sql statement 1
CREATE OR REPLACE FUNCTION public.discharge_admission(_admission_id uuid, _notes text DEFAULT NULL::text, _settlement_method text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0, _settlement_notes text DEFAULT NULL::text, _refund_amount numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 
AS $function$
DECLARE
  _adm public.admissions; _p public.patients; _wallet boolean;
  _debt numeric; _collected numeric := 0; _remaining numeric := 0;
  _inv public.invoices; _apply numeric; _left numeric;
  _applied numeric := 0; _pct numeric; _share numeric;
  _wallet_used numeric := 0; _refund numeric := 0; _credit numeric := 0;
  _got_lock boolean;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(),
       ARRAY['cashier','billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only the cashier can settle and complete a discharge';
  END IF;

  -- one settlement at a time per admission (single-key bigint advisory lock)
  _got_lock := true;
  IF NOT _got_lock THEN
    RAISE EXCEPTION 'DISCHARGE_IN_PROGRESS: this discharge is already being settled — refresh the queue';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;

  IF (_adm).status = 'discharged' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was already settled and discharged on %',
      COALESCE(to_char((_adm).discharged_at, 'DD Mon YYYY HH24:MI'), 'an earlier date');
  END IF;
  IF (_adm).status = 'cancelled' THEN
    RAISE EXCEPTION 'ADMISSION_CANCELLED: this admission was cancelled and cannot be settled';
  END IF;
  IF (_adm).status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'NOT_IN_CASHIER_QUEUE: the ward has not confirmed this discharge yet (%)', (_adm).status;
  END IF;

  SELECT public.bill_admission_bed_days(_admission_id);

  _wallet_used := public.apply_wallet_to_outstanding((_adm).patient_id, 'Balance applied at discharge');

  SELECT * INTO _p FROM public.patients WHERE id = (_adm).patient_id FOR UPDATE;
  _wallet := public.has_wallet((_p).account_type);
  _pct    := public.copay_percent((_p).account_type, (_p).insurance_plan);
  _debt   := public.patient_outstanding((_adm).patient_id);
  _remaining := _debt;

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash','pos','transfer') THEN
      _collected := ROUND(GREATEST(COALESCE(_settlement_amount,0),0), 2);
      IF _collected <= 0 THEN RAISE EXCEPTION 'Settlement amount must be greater than zero'; END IF;
      IF _wallet AND (_p).balance < 0 THEN
        SELECT public.adjust_patient_balance(
          (_adm).patient_id, LEAST(_collected, -(_p).balance), 'debt_cleared', _settlement_method,
          NULL, NULL, COALESCE(_settlement_notes,'Discharge settlement'));
      END IF;
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
      IF _remaining > 0 THEN
        SELECT public.write_audit_log('discharge_partial_settlement', 'admission', _admission_id::text, jsonb_build_object('patient_id',(_adm).patient_id,'debt',_debt,'collected',_collected,
                             'outstanding',_remaining,'method',_settlement_method,'notes',_settlement_notes), 'success');
      END IF;

    ELSIF _settlement_method = 'carry' THEN
      SELECT public.write_audit_log('debt_carried_on_discharge', 'admission', _admission_id::text, jsonb_build_object('patient_id',(_adm).patient_id,'debt',_debt,'notes',_settlement_notes), 'success');
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  _left := CASE WHEN _settlement_method IN ('cash','pos','transfer') THEN _collected ELSE 0 END;
  IF _left > 0 THEN
    SELECT COALESCE(SUM(applied), 0) INTO _applied
    FROM (
      SELECT LEAST(share, GREATEST(_left - prior_due, 0))::numeric AS applied
      FROM (
        SELECT ROUND(total_amount * _pct / 100.0, 2)::numeric AS share,
               GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)::numeric AS due,
               COALESCE(SUM(GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)) OVER (
                 ORDER BY created_at ASC, id ASC
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ), 0)::numeric AS prior_due
        FROM public.invoices
        WHERE patient_id = (_adm).patient_id AND status IN ('pending','partial')
      ) unpaid
    ) allocation;

    WITH unpaid AS (
      SELECT id, total_amount, COALESCE(paid_amount, 0)::numeric AS paid,
             ROUND(total_amount * _pct / 100.0, 2)::numeric AS share,
             GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)::numeric AS due,
             COALESCE(SUM(GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)) OVER (
               ORDER BY created_at ASC, id ASC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0)::numeric AS prior_due
      FROM public.invoices
      WHERE patient_id = (_adm).patient_id AND status IN ('pending','partial')
    ), allocated AS (
      SELECT id, total_amount, paid, share,
             LEAST(due, GREATEST(_left - prior_due, 0))::numeric AS applied
      FROM unpaid
    )
    UPDATE public.invoices i
       SET paid_amount = a.paid + a.applied,
           status = CASE WHEN a.paid + a.applied >= a.share THEN 'paid' ELSE 'partial' END,
           paid_at = CASE WHEN a.paid + a.applied >= a.share THEN now() ELSE i.paid_at END,
           payment_method = COALESCE(i.payment_method, _settlement_method),
           updated_at = now()
      FROM allocated a
     WHERE i.id = a.id AND a.applied > 0;

    _left := ROUND(_left - COALESCE(_applied, 0), 2);
  END IF;

  IF _wallet AND _left > 0 THEN
    SELECT public.adjust_patient_balance(
      (_adm).patient_id, _left, 'topup', _settlement_method, NULL, NULL,
      'Change from discharge settlement left on balance');
    _credit := _left;
  END IF;

  _refund := ROUND(GREATEST(COALESCE(_refund_amount,0),0), 2);
  IF _refund > 0 THEN
    IF NOT _wallet THEN RAISE EXCEPTION 'Sponsored accounts have no wallet to refund from'; END IF;
    SELECT * INTO _p FROM public.patients WHERE id = (_adm).patient_id FOR UPDATE;
    IF _refund > (_p).balance THEN
      RAISE EXCEPTION 'Refund % exceeds available balance %', _refund, (_p).balance;
    END IF;
    SELECT public.adjust_patient_balance(
      (_adm).patient_id, -_refund, 'refund', _settlement_method, NULL, NULL,
      'Change paid out at discharge');
  END IF;

  UPDATE public.admissions
     SET status='discharged', discharged_at=now(), discharged_by=public.hms_current_user_id(),
         discharge_notes=COALESCE(_notes, discharge_notes), updated_at=now()
   WHERE id = _admission_id AND status = 'ready_for_discharge';

  IF (_adm).status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was settled by someone else — refresh the queue';
  END IF;

  IF (_adm).bed_id IS NOT NULL THEN
    UPDATE public.beds SET status='available', updated_at=now() WHERE id = (_adm).bed_id;
  END IF;

  UPDATE public.patients SET status='discharged', updated_at=now() WHERE id = (_adm).patient_id;

  SELECT public.write_audit_log('admission_discharged', 'admission', _admission_id::text, jsonb_build_object('patient_id',(_adm).patient_id,'notes',_notes,'debt',_debt,
                       'wallet_applied',_wallet_used,'collected',_collected,
                       'outstanding',_remaining,'credit_left',_credit,'refunded',_refund,
                       'method',_settlement_method), 'success');

  RETURN jsonb_build_object('debt',_debt,'wallet_applied',_wallet_used,
                            'collected',_collected,'outstanding',_remaining,
                            'credit_left',_credit,'refunded',_refund);
END;
$function$;

-- SOURCE: 20260802193417_5deb48e4-7a2e-4714-a8e1-bd30e8865d88.sql statement 2
REVOKE EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) FROM PUBLIC, anon;

-- SOURCE: 20260802193417_5deb48e4-7a2e-4714-a8e1-bd30e8865d88.sql statement 3
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) TO authenticated;

-- SOURCE: 20260802201739_a8121027-ac48-463c-9fee-c54d6cfe9c10.sql statement 1
CREATE OR REPLACE FUNCTION public.bill_admission_bed_days(_admission_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _adm public.admissions; _p public.patients; _room_class text;
  _days int; _rate numeric; _amount numeric;
  _pct numeric; _copay numeric; _inv uuid;
  _bal numeric; _from_wallet numeric; _debt numeric; _wallet boolean;
  _sponsor text;
BEGIN
  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id;
  IF _adm IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _p FROM public.patients WHERE id = (_adm).patient_id;
  IF _p IS NULL THEN RETURN NULL; END IF;

  SELECT d.days, d.daily_rate, d.amount INTO _days, _rate, _amount
  FROM public.admission_bed_charge(_admission_id) d;
  IF COALESCE(_amount,0) <= 0 THEN RETURN NULL; END IF;

  SELECT id INTO _inv FROM public.invoices
   WHERE patient_id = (_adm).patient_id AND notes = 'BED_DAYS:' || _admission_id::text LIMIT 1;
  IF _inv IS NOT NULL THEN RETURN _inv; END IF;

  _pct    := public.copay_percent((_p).account_type, (_p).insurance_plan);
  _copay  := ROUND(_amount * _pct / 100.0, 2);
  _wallet := public.has_wallet((_p).account_type);
  _sponsor := CASE WHEN lower(coalesce((_p).account_type,'')) IN ('','normal','cash') THEN NULL
                   ELSE lower((_p).account_type) END;

  SELECT r.room_class INTO _room_class FROM public.beds b JOIN public.rooms r ON r.id = b.room_id WHERE b.id = (_adm).bed_id;

  INSERT INTO public.invoices (
    patient_id, visit_id, total_amount, original_amount, discount_amount,
    paid_amount, status, payment_method, sponsor_type, corporate_account_id, notes
  ) VALUES (
    (_adm).patient_id, (_adm).visit_id, _amount, _amount, 0,
    0, 'pending',
    CASE WHEN _pct = 0 AND _sponsor IS NOT NULL THEN 'sponsor_claim' ELSE NULL END,
    _sponsor,
    CASE WHEN lower(coalesce((_p).account_type,'')) IN ('corporate','retainer') THEN NULLIF(((_p).corporate_id)::STRING, '')::UUID ELSE NULL END,
    'BED_DAYS:' || _admission_id::text
  ) RETURNING id INTO _inv;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
  VALUES (_inv,
    'Bed charge - ' || COALESCE(_room_class,'ward') || ' - ' || _days || ' night(s)',
    _days, _rate, _amount, 'admission');

  IF _wallet AND _copay > 0 THEN
    SELECT balance INTO _bal FROM public.patients WHERE id = (_adm).patient_id FOR UPDATE;
    _from_wallet := ROUND(LEAST(GREATEST(COALESCE(_bal,0),0), _copay), 2);
    _debt := ROUND(_copay - _from_wallet, 2);

    IF _from_wallet > 0 THEN
      SELECT public.adjust_patient_balance((_adm).patient_id, -_from_wallet, 'invoice_deduction',
        'wallet', NULL, _inv, 'Bed charge for admission (' || _days || ' night(s))');
    END IF;
    IF _debt > 0 THEN
      SELECT public.adjust_patient_balance((_adm).patient_id, -_debt, 'debt_incurred',
        NULL, NULL, _inv, 'Bed charge shortfall on discharge (' || _days || ' night(s))');
    END IF;

    UPDATE public.invoices
       SET paid_amount = _copay,
           payment_method = 'wallet',
           status = CASE WHEN _copay >= _amount THEN 'paid' ELSE 'pending' END,
           paid_at = CASE WHEN _copay >= _amount THEN now() ELSE NULL END
     WHERE id = _inv;
  END IF;

  RETURN _inv;
END;
$$;

-- SOURCE: 20260802201739_a8121027-ac48-463c-9fee-c54d6cfe9c10.sql statement 2
REVOKE ALL ON FUNCTION public.bill_admission_bed_days(uuid) FROM PUBLIC, anon;

-- SOURCE: 20260802201739_a8121027-ac48-463c-9fee-c54d6cfe9c10.sql statement 3
GRANT EXECUTE ON FUNCTION public.bill_admission_bed_days(uuid) TO authenticated;

-- SOURCE: 20260802204659_b918f60b-6608-4db9-9f63-3c7a2a3d6376.sql statement 1
CREATE OR REPLACE FUNCTION public.discharge_admission(_admission_id uuid, _notes text DEFAULT NULL::text, _settlement_method text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0, _settlement_notes text DEFAULT NULL::text, _refund_amount numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 
AS $function$
DECLARE
  _adm public.admissions; _p public.patients; _wallet boolean;
  _debt numeric; _collected numeric := 0; _remaining numeric := 0;
  _inv public.invoices; _apply numeric; _left numeric;
  _applied numeric := 0; _pct numeric; _share numeric;
  _wallet_used numeric := 0; _refund numeric := 0; _credit numeric := 0;
  _debt_cleared numeric := 0;
  _got_lock boolean;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(),
       ARRAY['cashier','billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only the cashier can settle and complete a discharge';
  END IF;

  _got_lock := true;
  IF NOT _got_lock THEN
    RAISE EXCEPTION 'DISCHARGE_IN_PROGRESS: this discharge is already being settled — refresh the queue';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;

  IF (_adm).status = 'discharged' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was already settled and discharged on %',
      COALESCE(to_char((_adm).discharged_at, 'DD Mon YYYY HH24:MI'), 'an earlier date');
  END IF;
  IF (_adm).status = 'cancelled' THEN
    RAISE EXCEPTION 'ADMISSION_CANCELLED: this admission was cancelled and cannot be settled';
  END IF;
  IF (_adm).status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'NOT_IN_CASHIER_QUEUE: the ward has not confirmed this discharge yet (%)', (_adm).status;
  END IF;

  SELECT public.bill_admission_bed_days(_admission_id);

  _wallet_used := public.apply_wallet_to_outstanding((_adm).patient_id, 'Balance applied at discharge');

  SELECT * INTO _p FROM public.patients WHERE id = (_adm).patient_id FOR UPDATE;
  _wallet := public.has_wallet((_p).account_type);
  _pct    := public.copay_percent((_p).account_type, (_p).insurance_plan);
  _debt   := public.patient_outstanding((_adm).patient_id);
  _remaining := _debt;

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash','pos','transfer') THEN
      _collected := ROUND(GREATEST(COALESCE(_settlement_amount,0),0), 2);
      IF _collected <= 0 THEN RAISE EXCEPTION 'Settlement amount must be greater than zero'; END IF;
      IF _wallet AND (_p).balance < 0 THEN
        _debt_cleared := ROUND(LEAST(_collected, -(_p).balance), 2);
        SELECT public.adjust_patient_balance((_adm).patient_id, _debt_cleared, 'debt_cleared', _settlement_method, NULL, NULL, COALESCE(_settlement_notes));
      END IF;
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
      IF _remaining > 0 THEN
        SELECT public.write_audit_log('discharge_partial_settlement', 'admission', _admission_id::text, jsonb_build_object('patient_id',(_adm).patient_id,'debt',_debt,'collected',_collected,
                             'outstanding',_remaining,'method',_settlement_method,'notes',_settlement_notes), 'success');
      END IF;

    ELSIF _settlement_method = 'carry' THEN
      SELECT public.write_audit_log('debt_carried_on_discharge', 'admission', _admission_id::text, jsonb_build_object('patient_id',(_adm).patient_id,'debt',_debt,'notes',_settlement_notes), 'success');
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  -- Money still in hand AFTER the part already used to clear negative balance.
  _left := CASE WHEN _settlement_method IN ('cash','pos','transfer')
                THEN ROUND(GREATEST(0, _collected - _debt_cleared), 2) ELSE 0 END;

  IF _left > 0 THEN
    SELECT COALESCE(SUM(applied), 0) INTO _applied
    FROM (
      SELECT LEAST(share, GREATEST(_left - prior_due, 0))::numeric AS applied
      FROM (
        SELECT ROUND(total_amount * _pct / 100.0, 2)::numeric AS share,
               GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)::numeric AS due,
               COALESCE(SUM(GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)) OVER (
                 ORDER BY created_at ASC, id ASC
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ), 0)::numeric AS prior_due
        FROM public.invoices
        WHERE patient_id = (_adm).patient_id AND status IN ('pending','partial')
      ) unpaid
    ) allocation;

    WITH unpaid AS (
      SELECT id, total_amount, COALESCE(paid_amount, 0)::numeric AS paid,
             ROUND(total_amount * _pct / 100.0, 2)::numeric AS share,
             GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)::numeric AS due,
             COALESCE(SUM(GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)) OVER (
               ORDER BY created_at ASC, id ASC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0)::numeric AS prior_due
      FROM public.invoices
      WHERE patient_id = (_adm).patient_id AND status IN ('pending','partial')
    ), allocated AS (
      SELECT id, total_amount, paid, share,
             LEAST(due, GREATEST(_left - prior_due, 0))::numeric AS applied
      FROM unpaid
    )
    UPDATE public.invoices i
       SET paid_amount = a.paid + a.applied,
           status = CASE WHEN a.paid + a.applied >= a.share THEN 'paid' ELSE 'partial' END,
           paid_at = CASE WHEN a.paid + a.applied >= a.share THEN now() ELSE i.paid_at END,
           payment_method = COALESCE(i.payment_method, _settlement_method),
           updated_at = now()
      FROM allocated a
     WHERE i.id = a.id AND a.applied > 0;

    _left := ROUND(_left - COALESCE(_applied, 0), 2);
  END IF;

  -- Anything still left is a genuine overpayment.
  IF _wallet AND _left > 0 THEN
    SELECT public.adjust_patient_balance(
      (_adm).patient_id, _left, 'topup', _settlement_method, NULL, NULL,
      'Change from discharge settlement left on balance');
    _credit := _left;
  END IF;

  _refund := ROUND(GREATEST(COALESCE(_refund_amount,0),0), 2);
  IF _refund > 0 THEN
    IF NOT _wallet THEN RAISE EXCEPTION 'Sponsored accounts have no wallet to refund from'; END IF;
    SELECT * INTO _p FROM public.patients WHERE id = (_adm).patient_id FOR UPDATE;
    IF _refund > (_p).balance THEN
      RAISE EXCEPTION 'Refund % exceeds available balance %', _refund, (_p).balance;
    END IF;
    SELECT public.adjust_patient_balance(
      (_adm).patient_id, -_refund, 'refund', _settlement_method, NULL, NULL,
      'Change paid out at discharge');
  END IF;

  UPDATE public.admissions
     SET status='discharged', discharged_at=now(), discharged_by=public.hms_current_user_id(),
         discharge_notes=COALESCE(_notes, discharge_notes), updated_at=now()
   WHERE id = _admission_id AND status = 'ready_for_discharge';

  IF (_adm).status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was settled by someone else — refresh the queue';
  END IF;

  IF (_adm).bed_id IS NOT NULL THEN
    UPDATE public.beds SET status='available', updated_at=now() WHERE id = (_adm).bed_id;
  END IF;

  UPDATE public.patients SET status='discharged', updated_at=now() WHERE id = (_adm).patient_id;

  SELECT public.write_audit_log('admission_discharged', 'admission', _admission_id::text, jsonb_build_object('patient_id',(_adm).patient_id,'notes',_notes,'debt',_debt,
                       'wallet_applied',_wallet_used,'collected',_collected,
                       'debt_cleared',_debt_cleared,
                       'outstanding',_remaining,'credit_left',_credit,'refunded',_refund,
                       'method',_settlement_method), 'success');

  RETURN jsonb_build_object('debt',_debt,'wallet_applied',_wallet_used,
                            'collected',_collected,'outstanding',_remaining,
                            'credit_left',_credit,'refunded',_refund);
END;
$function$;

-- SOURCE: 20260802204659_b918f60b-6608-4db9-9f63-3c7a2a3d6376.sql statement 2
REVOKE ALL ON FUNCTION public.discharge_admission(uuid,text,text,numeric,text,numeric) FROM PUBLIC, anon;

-- SOURCE: 20260802204659_b918f60b-6608-4db9-9f63-3c7a2a3d6376.sql statement 3
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid,text,text,numeric,text,numeric) TO authenticated;

-- SOURCE: 20260802232908_57759403-226f-4725-afc1-4aa65cfedaaa.sql statement 1
CREATE OR REPLACE FUNCTION public.mark_invoice_claim_settled(_invoice_id uuid, _notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _uid uuid := public.hms_current_user_id();
  _inv public.invoices;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.has_role(_uid, 'admin'::app_role) OR public.has_role(_uid, 'claims_manager'::app_role)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT * INTO _inv FROM public.invoices WHERE id = _invoice_id FOR UPDATE;
  IF (_inv).id IS NULL THEN
    RAISE EXCEPTION 'invoice not found';
  END IF;

  IF (_inv).status = 'paid' AND (_inv).paid_amount >= (_inv).total_amount THEN
    RETURN jsonb_build_object('ok', true, 'already_settled', true, 'invoice_id', _invoice_id);
  END IF;

  UPDATE public.invoices
     SET paid_amount = total_amount,
         status = 'paid',
         payment_method = COALESCE(payment_method, 'sponsor_claim'),
         paid_at = COALESCE(paid_at, now()),
         claim_submitted_at = COALESCE(claim_submitted_at, now()),
         claim_submitted_by = COALESCE(claim_submitted_by, _uid),
         claim_submission_notes = COALESCE(_notes, claim_submission_notes),
         updated_at = now()
   WHERE id = _invoice_id;

  INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, details, status, actor_role)
  VALUES (_uid, 'claim_invoice_settled', 'invoice', _invoice_id::text,
          jsonb_build_object('invoice_number', (_inv).invoice_number,
                             'amount', (_inv).total_amount,
                             'previous_paid', (_inv).paid_amount,
                             'notes', _notes),
          'success', public.current_actor_role(_uid));

  RETURN jsonb_build_object('ok', true, 'invoice_id', _invoice_id, 'amount', (_inv).total_amount);
END;
$$;

-- SOURCE: 20260802232908_57759403-226f-4725-afc1-4aa65cfedaaa.sql statement 2
REVOKE ALL ON FUNCTION public.mark_invoice_claim_settled(uuid, text) FROM PUBLIC, anon;

-- SOURCE: 20260802232908_57759403-226f-4725-afc1-4aa65cfedaaa.sql statement 3
GRANT EXECUTE ON FUNCTION public.mark_invoice_claim_settled(uuid, text) TO authenticated;

-- SOURCE: 20260803115547_5bd0a968-5256-49b9-83be-3d2c4259c622.sql statement 1
DROP TABLE IF EXISTS public.anc_visits CASCADE;

-- SOURCE: 20260803115547_5bd0a968-5256-49b9-83be-3d2c4259c622.sql statement 2
DROP TABLE IF EXISTS public.anc_programs CASCADE;

-- SOURCE: 20260803115547_5bd0a968-5256-49b9-83be-3d2c4259c622.sql statement 3
DROP FUNCTION IF EXISTS public.anc_touch_updated_at();

-- SOURCE: 20260803115547_5bd0a968-5256-49b9-83be-3d2c4259c622.sql statement 4
DROP FUNCTION IF EXISTS public.generate_anc_number();

-- SOURCE: 20260803190804_847e3ae0-76ee-4147-a19b-193692d22302.sql statement 1
DROP TABLE IF EXISTS public.stock_movements CASCADE;

-- SOURCE: 20260803190804_847e3ae0-76ee-4147-a19b-193692d22302.sql statement 2
DROP TABLE IF EXISTS public.stock_requests CASCADE;

-- SOURCE: 20260803190804_847e3ae0-76ee-4147-a19b-193692d22302.sql statement 3
DROP TABLE IF EXISTS public.inventory_items CASCADE;

-- SOURCE: 20260806004955_ebbf8314-a1b5-4fc4-ad8f-3a937ee9ff3f.sql statement 1
-- Invoices
    ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_patient_id_fkey; ALTER TABLE public.invoices ADD CONSTRAINT invoices_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Admissions
    ALTER TABLE public.admissions DROP CONSTRAINT IF EXISTS admissions_patient_id_fkey; ALTER TABLE public.admissions ADD CONSTRAINT admissions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Balance transactions
    ALTER TABLE public.balance_transactions DROP CONSTRAINT IF EXISTS balance_transactions_patient_id_fkey; ALTER TABLE public.balance_transactions ADD CONSTRAINT balance_transactions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Snap orders
    ALTER TABLE public.snap_orders DROP CONSTRAINT IF EXISTS snap_orders_patient_id_fkey; ALTER TABLE public.snap_orders ADD CONSTRAINT snap_orders_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Visits
    ALTER TABLE public.visits DROP CONSTRAINT IF EXISTS visits_patient_id_fkey; ALTER TABLE public.visits ADD CONSTRAINT visits_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Vitals
    ALTER TABLE public.vitals DROP CONSTRAINT IF EXISTS vitals_patient_id_fkey; ALTER TABLE public.vitals ADD CONSTRAINT vitals_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Lab Requests
    ALTER TABLE public.lab_requests DROP CONSTRAINT IF EXISTS lab_requests_patient_id_fkey; ALTER TABLE public.lab_requests ADD CONSTRAINT lab_requests_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Audit Logs / Journey
    ALTER TABLE public.patient_journey DROP CONSTRAINT IF EXISTS patient_journey_patient_id_fkey; ALTER TABLE public.patient_journey ADD CONSTRAINT patient_journey_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Eligibility
    ALTER TABLE public.eligibility_verifications DROP CONSTRAINT IF EXISTS eligibility_verifications_patient_id_fkey; ALTER TABLE public.eligibility_verifications ADD CONSTRAINT eligibility_verifications_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;
    
    ALTER TABLE public.eligibility_verifications DROP CONSTRAINT IF EXISTS eligibility_verifications_consumed_patient_id_fkey; ALTER TABLE public.eligibility_verifications ADD CONSTRAINT eligibility_verifications_consumed_patient_id_fkey FOREIGN KEY (consumed_patient_id) REFERENCES public.patients(id) ON DELETE SET NULL;

    -- EMR / Attachments
    ALTER TABLE public.emr_attachments DROP CONSTRAINT IF EXISTS emr_attachments_patient_id_fkey; ALTER TABLE public.emr_attachments ADD CONSTRAINT emr_attachments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;
    
    ALTER TABLE public.visit_attachments DROP CONSTRAINT IF EXISTS visit_attachments_patient_id_fkey; ALTER TABLE public.visit_attachments ADD CONSTRAINT visit_attachments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Insurance / Statements
    ALTER TABLE public.insurance_claims DROP CONSTRAINT IF EXISTS insurance_claims_patient_id_fkey; ALTER TABLE public.insurance_claims ADD CONSTRAINT insurance_claims_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    ALTER TABLE public.sponsor_statement_items DROP CONSTRAINT IF EXISTS sponsor_statement_items_patient_id_fkey; ALTER TABLE public.sponsor_statement_items ADD CONSTRAINT sponsor_statement_items_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Staff links
    ALTER TABLE public.staff_family_members DROP CONSTRAINT IF EXISTS staff_family_members_patient_id_fkey; ALTER TABLE public.staff_family_members ADD CONSTRAINT staff_family_members_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Standing orders
    ALTER TABLE public.standing_orders DROP CONSTRAINT IF EXISTS standing_orders_patient_id_fkey; ALTER TABLE public.standing_orders ADD CONSTRAINT standing_orders_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;
    
    -- Balance Requests
    ALTER TABLE public.balance_requests DROP CONSTRAINT IF EXISTS balance_requests_patient_id_fkey; ALTER TABLE public.balance_requests ADD CONSTRAINT balance_requests_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

-- SOURCE: 20260807_clinical_typed_orders.sql statement 1
CREATE TABLE IF NOT EXISTS public.referral_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL,
  destination TEXT NOT NULL,
  specialist TEXT,
  reason TEXT,
  clinical_notes TEXT,
  typed_body TEXT,
  input_method TEXT NOT NULL CHECK (input_method IN ('typed', 'snap')),
  snap_id UUID REFERENCES public.snap_orders(id) ON DELETE SET NULL,
  file_path TEXT, -- Internal storage path
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final', 'sent')),
  ref_number TEXT UNIQUE,
  finalized_at TIMESTAMPTZ,
  finalized_by UUID REFERENCES public.auth_users(id),
  created_by UUID NOT NULL REFERENCES public.auth_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE: 20260807_clinical_typed_orders.sql statement 2
ALTER TABLE public.referral_letters ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260807_clinical_typed_orders.sql statement 3
CREATE POLICY "Staff can view all referrals"
  ON public.referral_letters FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

-- SOURCE: 20260807_clinical_typed_orders.sql statement 4
CREATE POLICY "Clinicians can create referrals"
  ON public.referral_letters FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(public.hms_current_user_id(), ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]));

-- SOURCE: 20260807_clinical_typed_orders.sql statement 5
CREATE POLICY "Creators can update draft referrals"
  ON public.referral_letters FOR UPDATE TO authenticated
  USING (status = 'draft' AND (created_by = public.hms_current_user_id() OR public.has_role(public.hms_current_user_id(), 'admin')))
  WITH CHECK (status = 'draft' AND (created_by = public.hms_current_user_id() OR public.has_role(public.hms_current_user_id(), 'admin')));

-- SOURCE: 20260807_clinical_typed_orders.sql statement 6
GRANT SELECT, INSERT, UPDATE ON public.referral_letters TO authenticated;

-- SOURCE: 20260807_clinical_typed_orders.sql statement 7
GRANT ALL ON public.referral_letters TO service_role;

-- SOURCE: 20260807_clinical_typed_orders.sql statement 8
CREATE SEQUENCE IF NOT EXISTS public.referrals_number_seq START 1;

-- SOURCE: 20260807_clinical_typed_orders.sql statement 9
GRANT USAGE ON SEQUENCE public.referrals_number_seq TO authenticated;

-- SOURCE: 20260807_clinical_typed_orders.sql statement 10
CREATE OR REPLACE FUNCTION public.create_prescription_from_typed(
  _patient_id uuid,
  _visit_id uuid,
  _diagnosis text,
  _notes text,
  _items jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  v_uid uuid := public.hms_current_user_id();
  v_prescription_id uuid;
  v_item jsonb;
  v_qty int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.has_any_role(v_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Unauthorized role';
  END IF;

  -- Validate patient/visit
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = _patient_id) THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;
  IF _visit_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.visits WHERE id = _visit_id AND patient_id = _patient_id) THEN
      RAISE EXCEPTION 'Invalid visit for patient';
    END IF;
  END IF;

  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'At least one medication is required';
  END IF;

  INSERT INTO public.prescriptions (patient_id, visit_id, diagnosis, notes, status, created_by)
  VALUES (_patient_id, _visit_id, _diagnosis, _notes, 'pending', v_uid::text)
  RETURNING id INTO v_prescription_id;

  SELECT value INTO v_item
  FROM jsonb_array_elements(_items) AS item(value)
  WHERE COALESCE(value->>'quantity', '') = ''
     OR (value->>'quantity') !~ '^[0-9]+$'
     OR (value->>'quantity')::int <= 0
     OR COALESCE(value->>'medication', '') = ''
     OR COALESCE(value->>'dosage', '') = ''
     OR COALESCE(value->>'frequency', '') = ''
     OR COALESCE(value->>'duration', '') = ''
  LIMIT 1;
  IF v_item IS NOT NULL THEN
    RAISE EXCEPTION 'Each medication requires a positive integer quantity, medication, dosage, frequency, and duration';
  END IF;

  INSERT INTO public.prescription_items
    (prescription_id, medication, dosage, frequency, duration, quantity, dispensed)
  SELECT
    v_prescription_id,
    value->>'medication',
    value->>'dosage',
    value->>'frequency',
    value->>'duration',
    (value->>'quantity')::int,
    false
  FROM jsonb_array_elements(_items) AS item(value);

  SELECT public.write_audit_log('create_typed_prescription', 'prescriptions', v_prescription_id::text, jsonb_build_object('patient_id', _patient_id), 'success');
  RETURN v_prescription_id;
END;
$$;

-- SOURCE: 20260807_clinical_typed_orders.sql statement 11
CREATE OR REPLACE FUNCTION public.create_lab_request_from_typed(
  _patient_id uuid,
  _visit_id uuid,
  _diagnosis text,
  _tests text[]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  v_uid uuid := public.hms_current_user_id();
  v_lab_id uuid;
  v_req_num text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.has_any_role(v_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Unauthorized role';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = _patient_id) THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;
  IF _visit_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.visits WHERE id = _visit_id AND patient_id = _patient_id) THEN
      RAISE EXCEPTION 'Invalid visit for patient';
    END IF;
  END IF;

  IF _tests IS NULL OR array_length(_tests, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one test is required';
  END IF;

  -- Generate request number (matching existing convention if possible, otherwise serial)
  v_req_num := 'LAB-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('public.lab_requests_number_seq')::text, 4, '0');

  INSERT INTO public.lab_requests
    (patient_id, visit_id, tests, diagnosis, status, requested_by, requested_at, printed, request_number)
  VALUES (
    _patient_id, _visit_id, _tests, _diagnosis,
    'pending', v_uid::text, now(), false, v_req_num
  )
  RETURNING id INTO v_lab_id;

  SELECT public.write_audit_log('create_typed_lab_request', 'lab_requests', v_lab_id::text, jsonb_build_object('patient_id', _patient_id), 'success');
  RETURN v_lab_id;
END;
$$;

-- SOURCE: 20260807_clinical_typed_orders.sql statement 12
CREATE OR REPLACE FUNCTION public.finalize_referral(
  _referral_id uuid,
  _file_path text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  v_uid uuid := public.hms_current_user_id();
  v_ref public.referral_letters;
  v_ref_num text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_ref FROM public.referral_letters WHERE id = _referral_id FOR UPDATE;
  IF (v_ref).id IS NULL THEN RAISE EXCEPTION 'Referral not found'; END IF;

  IF (v_ref).created_by <> v_uid AND NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Unauthorized to finalize this referral';
  END IF;

  IF (v_ref).status <> 'draft' THEN
    RAISE EXCEPTION 'Referral is already finalized or sent';
  END IF;

  IF COALESCE((v_ref).destination, '') = '' THEN
    RAISE EXCEPTION 'Destination is required to finalize referral';
  END IF;

  v_ref_num := 'REF-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('public.referrals_number_seq')::text, 4, '0');

  UPDATE public.referral_letters
  SET 
    status = 'final',
    ref_number = v_ref_num,
    file_path = COALESCE(_file_path, file_path),
    finalized_at = now(),
    finalized_by = v_uid,
    updated_at = now()
  WHERE id = _referral_id;

  -- Create EMR attachment if file_path is provided (avoid duplicates)
  IF _file_path IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.emr_attachments WHERE patient_id = (v_ref).patient_id AND file_path = _file_path) THEN
        INSERT INTO public.emr_attachments (patient_id, uploaded_by, file_path, file_name, category, description)
        VALUES ((v_ref).patient_id, v_uid, _file_path, 'Referral Letter ' || v_ref_num, 'referral', 'Referral Letter ' || v_ref_num);
    END IF;
  END IF;

  SELECT public.write_audit_log('finalize_referral', 'referral_letters', _referral_id::text, jsonb_build_object('ref_number', v_ref_num), 'success');

  RETURN jsonb_build_object(
    'referral_id', _referral_id,
    'ref_number', v_ref_num
  );
END;
$$;

-- SOURCE: 20260807_clinical_typed_orders.sql statement 13
GRANT EXECUTE ON FUNCTION public.create_prescription_from_typed(uuid, uuid, text, text, jsonb) TO authenticated;

-- SOURCE: 20260807_clinical_typed_orders.sql statement 14
GRANT EXECUTE ON FUNCTION public.create_lab_request_from_typed(uuid, uuid, text, text[]) TO authenticated;

-- SOURCE: 20260807_clinical_typed_orders.sql statement 15
GRANT EXECUTE ON FUNCTION public.finalize_referral(uuid, text) TO authenticated;

-- SOURCE: 20260808052340_f70bdf13-1f73-4ad4-9bfd-66f30fd3f362.sql statement 1
DROP POLICY IF EXISTS "Admins and reception can delete patients" ON public.patients;

-- SOURCE: 20260808052340_f70bdf13-1f73-4ad4-9bfd-66f30fd3f362.sql statement 2
DROP POLICY IF EXISTS "Only admins can delete patients" ON public.patients;

-- SOURCE: 20260808052340_f70bdf13-1f73-4ad4-9bfd-66f30fd3f362.sql statement 3
CREATE POLICY "Admins and reception can delete patients"
ON public.patients
FOR DELETE
TO authenticated
USING (
  public.has_role(public.hms_current_user_id(), 'admin') OR 
  public.has_role(public.hms_current_user_id(), 'receptionist')
);

-- SOURCE: 20260808052340_f70bdf13-1f73-4ad4-9bfd-66f30fd3f362.sql statement 4
GRANT DELETE ON public.patients TO authenticated;

-- SOURCE: 20260808053935_facc2feb-f1c6-46e5-8de2-e4669cf486a1.sql statement 1
-- Patient Deletion Policies (Safely drop and recreate)
    DROP POLICY IF EXISTS "Admins and reception can delete patients" ON public.patients;
    DROP POLICY IF EXISTS "Only admins can delete patients" ON public.patients;
    
    CREATE POLICY "Admins and reception can delete patients"
    ON public.patients
    FOR DELETE
    TO authenticated
    USING (
      public.has_role(public.hms_current_user_id(), 'admin') OR 
      public.has_role(public.hms_current_user_id(), 'receptionist')
    );

    -- Cascade delete constraints for related tables
    -- Invoices
    ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_patient_id_fkey;
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Admissions
    ALTER TABLE public.admissions DROP CONSTRAINT IF EXISTS admissions_patient_id_fkey;
    ALTER TABLE public.admissions ADD CONSTRAINT admissions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Balance transactions
    ALTER TABLE public.balance_transactions DROP CONSTRAINT IF EXISTS balance_transactions_patient_id_fkey;
    ALTER TABLE public.balance_transactions ADD CONSTRAINT balance_transactions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Snap orders
    ALTER TABLE public.snap_orders DROP CONSTRAINT IF EXISTS snap_orders_patient_id_fkey;
    ALTER TABLE public.snap_orders ADD CONSTRAINT snap_orders_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Visits
    ALTER TABLE public.visits DROP CONSTRAINT IF EXISTS visits_patient_id_fkey;
    ALTER TABLE public.visits ADD CONSTRAINT visits_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Vitals
    ALTER TABLE public.vitals DROP CONSTRAINT IF EXISTS vitals_patient_id_fkey;
    ALTER TABLE public.vitals ADD CONSTRAINT vitals_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Lab Requests
    ALTER TABLE public.lab_requests DROP CONSTRAINT IF EXISTS lab_requests_patient_id_fkey;
    ALTER TABLE public.lab_requests ADD CONSTRAINT lab_requests_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Audit Logs / Journey
    ALTER TABLE public.patient_journey DROP CONSTRAINT IF EXISTS patient_journey_patient_id_fkey;
    ALTER TABLE public.patient_journey ADD CONSTRAINT patient_journey_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Eligibility
    ALTER TABLE public.eligibility_verifications DROP CONSTRAINT IF EXISTS eligibility_verifications_patient_id_fkey;
    ALTER TABLE public.eligibility_verifications ADD CONSTRAINT eligibility_verifications_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;
    
    ALTER TABLE public.eligibility_verifications DROP CONSTRAINT IF EXISTS eligibility_verifications_consumed_patient_id_fkey;
    ALTER TABLE public.eligibility_verifications ADD CONSTRAINT eligibility_verifications_consumed_patient_id_fkey FOREIGN KEY (consumed_patient_id) REFERENCES public.patients(id) ON DELETE SET NULL;

    -- EMR / Attachments
    ALTER TABLE public.emr_attachments DROP CONSTRAINT IF EXISTS emr_attachments_patient_id_fkey;
    ALTER TABLE public.emr_attachments ADD CONSTRAINT emr_attachments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;
    
    ALTER TABLE public.visit_attachments DROP CONSTRAINT IF EXISTS visit_attachments_patient_id_fkey;
    ALTER TABLE public.visit_attachments ADD CONSTRAINT visit_attachments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Insurance / Statements
    ALTER TABLE public.insurance_claims DROP CONSTRAINT IF EXISTS insurance_claims_patient_id_fkey;
    ALTER TABLE public.insurance_claims ADD CONSTRAINT insurance_claims_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    ALTER TABLE public.sponsor_statement_items DROP CONSTRAINT IF EXISTS sponsor_statement_items_patient_id_fkey;
    ALTER TABLE public.sponsor_statement_items ADD CONSTRAINT sponsor_statement_items_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Staff links
    ALTER TABLE public.staff_family_members DROP CONSTRAINT IF EXISTS staff_family_members_patient_id_fkey;
    ALTER TABLE public.staff_family_members ADD CONSTRAINT staff_family_members_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Standing orders
    ALTER TABLE public.standing_orders DROP CONSTRAINT IF EXISTS standing_orders_patient_id_fkey;
    ALTER TABLE public.standing_orders ADD CONSTRAINT standing_orders_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;
    
    -- Balance Requests
    ALTER TABLE public.balance_requests DROP CONSTRAINT IF EXISTS balance_requests_patient_id_fkey;
    ALTER TABLE public.balance_requests ADD CONSTRAINT balance_requests_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

-- SOURCE: 20260808053935_facc2feb-f1c6-46e5-8de2-e4669cf486a1.sql statement 2
GRANT DELETE ON public.patients TO authenticated;

-- SOURCE: 20260808053935_facc2feb-f1c6-46e5-8de2-e4669cf486a1.sql statement 3
GRANT ALL ON public.patients TO service_role;

-- SOURCE: 20260808055228_230256db-7f40-43d8-af9d-f6118f4ad3e5.sql statement 1
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_patient_id_fkey;
ALTER TABLE public.admissions DROP CONSTRAINT IF EXISTS admissions_patient_id_fkey;

-- SOURCE: 20260808060429_81689ebe-8932-4a9d-b3d2-0594a4c88264.sql statement 1
-- 1. Update public.create_prescription_from_typed to create a snap_order record
-- with status 'pending_billing' instead of going straight to the patient card.
CREATE OR REPLACE FUNCTION public.create_prescription_from_typed(
  _patient_id uuid,
  _visit_id uuid,
  _diagnosis text,
  _notes text,
  _items jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  v_uid uuid := public.hms_current_user_id();
  v_prescription_id uuid;
  v_snap_id uuid;
  v_item jsonb;
  v_qty int;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  
  -- Check roles
  IF NOT public.has_any_role(v_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Unauthorized role';
  END IF;

  -- Validate patient
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = _patient_id) THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;
  
  -- Validate visit
  IF _visit_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.visits WHERE id = _visit_id AND patient_id = _patient_id) THEN
      RAISE EXCEPTION 'Invalid visit for patient';
    END IF;
  END IF;

  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'At least one medication is required';
  END IF;

  -- 1. Create the prescription record
  INSERT INTO public.prescriptions (patient_id, visit_id, diagnosis, notes, status, created_by)
  VALUES (_patient_id, _visit_id, _diagnosis, _notes, 'pending', v_uid::text)
  RETURNING id INTO v_prescription_id;

  -- 2. Insert items
  SELECT value INTO v_item
  FROM jsonb_array_elements(_items) AS item(value)
  WHERE COALESCE(value->>'quantity', '') = ''
     OR (value->>'quantity') !~ '^[0-9]+$'
     OR (value->>'quantity')::int <= 0
     OR COALESCE(value->>'medication', '') = ''
     OR COALESCE(value->>'dosage', '') = ''
     OR COALESCE(value->>'frequency', '') = ''
     OR COALESCE(value->>'duration', '') = ''
  LIMIT 1;
  IF v_item IS NOT NULL THEN
    RAISE EXCEPTION 'Each medication requires a positive integer quantity, medication, dosage, frequency, and duration';
  END IF;

  INSERT INTO public.prescription_items
    (prescription_id, medication, dosage, frequency, duration, quantity, dispensed)
  SELECT
    v_prescription_id,
    value->>'medication',
    value->>'dosage',
    value->>'frequency',
    value->>'duration',
    (value->>'quantity')::int,
    false
  FROM jsonb_array_elements(_items) AS item(value);

  -- 3. SUSTAINABLE WORKFLOW: Create a snap_order pointing to Pharmacy via Billing
  -- This ensures it appears in the Billing queue first, just like snaps.
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;
  
  INSERT INTO public.snap_orders (
    patient_id, 
    visit_id, 
    order_type, 
    target_station, 
    source_role,
    status, 
    created_by, 
    original_sender_role,
    intent,
    note,
    -- We link it to the prescription record for reference
    ocr_text 
  ) VALUES (
    _patient_id, 
    _visit_id, 
    'prescription', 
    'pharmacy', 
    COALESCE(v_role, 'doctor'),
    'pending_billing', 
    v_uid, 
    COALESCE(v_role, 'doctor'),
    'typed_order',
    COALESCE(_notes, 'Typed Prescription'),
    'LINKED_PRESCRIPTION:' || v_prescription_id::text
  );

  -- Update patient status to ensure they appear in billing queues if not already there
  UPDATE public.patients SET status = 'awaiting_billing' WHERE id = _patient_id AND status != 'admitted';

  SELECT public.write_audit_log('create_typed_prescription', 'prescriptions', v_prescription_id::text, jsonb_build_object('patient_id', _patient_id), 'success');
  
  RETURN v_prescription_id;
END;
$$;

-- SOURCE: 20260808060429_81689ebe-8932-4a9d-b3d2-0594a4c88264.sql statement 2
CREATE OR REPLACE FUNCTION public.create_lab_request_from_typed(
  _patient_id uuid,
  _visit_id uuid,
  _diagnosis text,
  _tests text[]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  v_uid uuid := public.hms_current_user_id();
  v_lab_id uuid;
  v_req_num text;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  
  IF NOT public.has_any_role(v_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Unauthorized role';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = _patient_id) THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;
  
  IF _visit_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.visits WHERE id = _visit_id AND patient_id = _patient_id) THEN
      RAISE EXCEPTION 'Invalid visit for patient';
    END IF;
  END IF;

  IF _tests IS NULL OR array_length(_tests, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one test is required';
  END IF;

  -- Generate request number
  v_req_num := 'LAB-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('public.lab_requests_number_seq')::text, 4, '0');

  -- 1. Create the lab request record
  INSERT INTO public.lab_requests
    (patient_id, visit_id, tests, diagnosis, status, requested_by, requested_at, printed, request_number)
  VALUES (
    _patient_id, _visit_id, _tests, _diagnosis,
    'pending', v_uid::text, now(), false, v_req_num
  )
  RETURNING id INTO v_lab_id;

  -- 2. SUSTAINABLE WORKFLOW: Create a snap_order pointing to Lab via Billing
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;

  INSERT INTO public.snap_orders (
    patient_id, 
    visit_id, 
    order_type, 
    target_station, 
    source_role,
    status, 
    created_by, 
    original_sender_role,
    intent,
    note,
    -- Link to lab request
    ocr_text
  ) VALUES (
    _patient_id, 
    _visit_id, 
    'lab', 
    'lab', 
    COALESCE(v_role, 'doctor'),
    'pending_billing', 
    v_uid, 
    COALESCE(v_role, 'doctor'),
    'typed_order',
    'Typed Lab Order: ' || array_to_string(_tests, ', '),
    'LINKED_LAB_REQUEST:' || v_lab_id::text
  );

  -- Update patient status
  UPDATE public.patients SET status = 'awaiting_billing' WHERE id = _patient_id AND status != 'admitted';

  SELECT public.write_audit_log('create_typed_lab_request', 'lab_requests', v_lab_id::text, jsonb_build_object('patient_id', _patient_id), 'success');
  
  RETURN v_lab_id;
END;
$$;

-- SOURCE: 20260808060429_81689ebe-8932-4a9d-b3d2-0594a4c88264.sql statement 3
GRANT EXECUTE ON FUNCTION public.create_prescription_from_typed(uuid, uuid, text, text, jsonb) TO authenticated;

-- SOURCE: 20260808060429_81689ebe-8932-4a9d-b3d2-0594a4c88264.sql statement 4
GRANT EXECUTE ON FUNCTION public.create_lab_request_from_typed(uuid, uuid, text, text[]) TO authenticated;

-- SOURCE: 20260808072858_f8808217-ad2e-47a5-a43a-b31c0f16a15c.sql statement 1
CREATE OR REPLACE FUNCTION public.purge_clinical_data(_modules text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _result jsonb := '{}'::jsonb;
  _n bigint;
  _has text[] := _modules;
BEGIN
  IF NOT public.has_role(public.hms_current_user_id(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can purge clinical data';
  END IF;

  -- Order: dependents first
  IF 'tasks' = ANY(_has) THEN
    SELECT count(*) INTO _n FROM public.task_claims WHERE id IS NOT NULL;
    DELETE FROM public.task_claims WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('task_claims', _n);
  END IF;

  IF 'notifications' = ANY(_has) THEN
    SELECT count(*) INTO _n FROM public.notifications WHERE id IS NOT NULL;
    DELETE FROM public.notifications WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('notifications', _n);
  END IF;

  IF 'errors' = ANY(_has) THEN
    SELECT count(*) INTO _n FROM public.error_logs WHERE id IS NOT NULL;
    DELETE FROM public.error_logs WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('error_logs', _n);
  END IF;

  IF 'audit' = ANY(_has) THEN
    SELECT count(*) INTO _n FROM public.audit_logs WHERE id IS NOT NULL;
    DELETE FROM public.audit_logs WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('audit_logs', _n);
  END IF;

  IF 'lab' = ANY(_has) THEN
    SELECT count(*) INTO _n FROM public.lab_requests WHERE id IS NOT NULL;
    DELETE FROM public.lab_requests WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('lab_requests', _n);
  END IF;

  IF 'prescriptions' = ANY(_has) THEN
    SELECT count(*) INTO _n FROM public.prescription_items WHERE id IS NOT NULL;
    DELETE FROM public.prescription_items WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('prescription_items', _n);
    SELECT count(*) INTO _n FROM public.prescriptions WHERE id IS NOT NULL;
    DELETE FROM public.prescriptions WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('prescriptions', _n);
  END IF;

  IF 'billing' = ANY(_has) THEN
    SELECT count(*) INTO _n FROM public.invoice_items WHERE id IS NOT NULL;
    DELETE FROM public.invoice_items WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('invoice_items', _n);
    SELECT count(*) INTO _n FROM public.sponsor_statement_items WHERE id IS NOT NULL;
    DELETE FROM public.sponsor_statement_items WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('sponsor_statement_items', _n);
    SELECT count(*) INTO _n FROM public.sponsor_statements WHERE id IS NOT NULL;
    DELETE FROM public.sponsor_statements WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('sponsor_statements', _n);
    SELECT count(*) INTO _n FROM public.insurance_claims WHERE id IS NOT NULL;
    DELETE FROM public.insurance_claims WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('insurance_claims', _n);
    SELECT count(*) INTO _n FROM public.corporate_transactions WHERE id IS NOT NULL;
    DELETE FROM public.corporate_transactions WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('corporate_transactions', _n);
    SELECT count(*) INTO _n FROM public.balance_transactions WHERE id IS NOT NULL;
    DELETE FROM public.balance_transactions WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('balance_transactions', _n);
    SELECT count(*) INTO _n FROM public.balance_requests WHERE id IS NOT NULL;
    DELETE FROM public.balance_requests WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('balance_requests', _n);
    SELECT count(*) INTO _n FROM public.invoices WHERE id IS NOT NULL;
    DELETE FROM public.invoices WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('invoices', _n);
  END IF;

  IF 'snaps' = ANY(_has) THEN
    SELECT count(*) INTO _n FROM public.snap_orders WHERE id IS NOT NULL;
    DELETE FROM public.snap_orders WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('snap_orders', _n);
  END IF;

  IF 'admissions' = ANY(_has) THEN
    SELECT count(*) INTO _n FROM public.admissions WHERE id IS NOT NULL;
    DELETE FROM public.admissions WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('admissions', _n);
    SELECT count(*) INTO _n FROM public.beds WHERE status <> 'available';
    UPDATE public.beds SET status = 'available' WHERE status <> 'available';
    _result := _result || jsonb_build_object('beds_reset', _n);
  END IF;

  IF 'visits' = ANY(_has) THEN
    SELECT count(*) INTO _n FROM public.visit_attachments WHERE id IS NOT NULL;
    DELETE FROM public.visit_attachments WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('visit_attachments', _n);
    SELECT count(*) INTO _n FROM public.emr_attachments WHERE id IS NOT NULL;
    DELETE FROM public.emr_attachments WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('emr_attachments', _n);
    SELECT count(*) INTO _n FROM public.vitals WHERE id IS NOT NULL;
    DELETE FROM public.vitals WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('vitals', _n);
    SELECT count(*) INTO _n FROM public.patient_journey_history WHERE id IS NOT NULL;
    DELETE FROM public.patient_journey_history WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('patient_journey_history', _n);
    SELECT count(*) INTO _n FROM public.patient_journey WHERE id IS NOT NULL;
    DELETE FROM public.patient_journey WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('patient_journey', _n);
    SELECT count(*) INTO _n FROM public.visits WHERE id IS NOT NULL;
    DELETE FROM public.visits WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('visits', _n);
  END IF;

  IF 'patients' = ANY(_has) THEN
    SELECT count(*) INTO _n FROM public.patients WHERE id IS NOT NULL;
    DELETE FROM public.patients WHERE id IS NOT NULL;
    _result := _result || jsonb_build_object('patients', _n);
  END IF;

  RETURN _result;
END;
$$;

-- SOURCE: 20260809155732_b6a69068-513a-4a6e-923a-872c11961266.sql statement 1
SELECT now();

-- SOURCE: 20260809155809_7ef2d5d4-4e8a-4040-842d-a89231adea92.sql statement 1
SELECT now();

-- SOURCE: 20260809155819_0e25dc11-82f7-4df7-802c-225b6dffdbc4.sql statement 1
SELECT now();

-- SOURCE: 20260809161239_bada2f9c-341f-4b05-a505-7ff8b4780fcb.sql statement 1
CREATE OR REPLACE FUNCTION public.settle_invoice_atomic(
  _invoice_id uuid,
  _cash_amount numeric DEFAULT 0,
  _balance_amount numeric DEFAULT 0,
  _debt_amount numeric DEFAULT 0,
  _payment_method text DEFAULT 'cash',
  _notes text DEFAULT NULL,
  _sponsored boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  v_invoice public.invoices;
  v_new_balance numeric;
  v_collected numeric;
  v_available numeric;
BEGIN
  IF NOT public.is_authenticated_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _cash_amount < 0 OR _balance_amount < 0 OR _debt_amount < 0 THEN
    RAISE EXCEPTION 'Amounts must be non-negative';
  END IF;

  -- Lock the invoice row for the duration of the transaction.
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = _invoice_id
  FOR UPDATE;
  IF (v_invoice).id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF (v_invoice).status = 'paid' THEN
    RAISE EXCEPTION 'Invoice already settled';
  END IF;

  -- Deduct from wallet balance (with concurrency-safe check).
  IF _balance_amount > 0 THEN
    SELECT balance INTO v_available
    FROM public.patients
    WHERE id = (v_invoice).patient_id
    FOR UPDATE;

    IF v_available IS NULL OR v_available < _balance_amount THEN
      RAISE EXCEPTION 'Insufficient wallet balance (available: %, requested: %)',
        COALESCE(v_available, 0), _balance_amount;
    END IF;

    SELECT public.adjust_patient_balance(
      (v_invoice).patient_id,
      -_balance_amount,
      'invoice_deduction',
      'balance',
      NULL,
      _invoice_id,
      COALESCE(_notes, format('Applied to invoice %s', (v_invoice).invoice_number))
    );
  END IF;

  -- Record shortfall as patient debt for cash accounts.
  IF _debt_amount > 0 THEN
    SELECT public.adjust_patient_balance(
      (v_invoice).patient_id,
      -_debt_amount,
      'debt_incurred',
      _payment_method,
      NULL,
      _invoice_id,
      format('Shortfall on invoice %s', (v_invoice).invoice_number)
    );
  END IF;

  -- Handle overpayment (only for non-sponsored cash patients)
  IF NOT _sponsored AND (_cash_amount + _balance_amount) > ((v_invoice).total_amount - COALESCE((v_invoice).paid_amount, 0)) THEN
    DECLARE
      v_overpayment numeric;
    BEGIN
      v_overpayment := (_cash_amount + _balance_amount) - ((v_invoice).total_amount - COALESCE((v_invoice).paid_amount, 0));
      SELECT public.adjust_patient_balance(
        (v_invoice).patient_id,
        v_overpayment,
        'overpayment_credit',
        _payment_method,
        NULL,
        _invoice_id,
        format('Overpayment on invoice %s', (v_invoice).invoice_number)
      );
    END;
  END IF;

  v_collected := COALESCE((v_invoice).paid_amount, 0) + _cash_amount + _balance_amount;

  UPDATE public.invoices
  SET paid_amount    = v_collected,
      status         = 'paid',
      payment_method = _payment_method,
      paid_at        = now(),
      notes          = COALESCE(_notes, notes),
      updated_at     = now()
  WHERE id = _invoice_id;

  SELECT balance INTO v_new_balance FROM public.patients WHERE id = (v_invoice).patient_id;

  RETURN jsonb_build_object(
    'invoice_id',       _invoice_id,
    'invoice_number',   (v_invoice).invoice_number,
    'patient_id',       (v_invoice).patient_id,
    'collected',        v_collected,
    'cash_amount',      _cash_amount,
    'balance_amount',   _balance_amount,
    'debt_amount',      _debt_amount,
    'new_wallet_balance', v_new_balance,
    'sponsored',        _sponsored
  );
END;
$$;

-- SOURCE: 20260809162027_9b0f8175-35d6-4d41-9af1-33d4fad07e2b.sql statement 1
CREATE OR REPLACE FUNCTION public.settle_invoice_atomic(
  _invoice_id uuid,
  _cash_amount numeric DEFAULT 0,
  _balance_amount numeric DEFAULT 0,
  _debt_amount numeric DEFAULT 0,
  _payment_method text DEFAULT 'cash',
  _notes text DEFAULT NULL,
  _sponsored boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  v_invoice public.invoices;
  v_new_balance numeric;
  v_collected numeric;
  v_available numeric;
BEGIN
  IF NOT public.is_authenticated_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _cash_amount < 0 OR _balance_amount < 0 OR _debt_amount < 0 THEN
    RAISE EXCEPTION 'Amounts must be non-negative';
  END IF;

  -- Lock the invoice row for the duration of the transaction.
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = _invoice_id
  FOR UPDATE;
  IF (v_invoice).id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF (v_invoice).status = 'paid' THEN
    RAISE EXCEPTION 'Invoice already settled';
  END IF;

  -- Deduct from wallet balance (with concurrency-safe check).
  IF _balance_amount > 0 THEN
    SELECT balance INTO v_available
    FROM public.patients
    WHERE id = (v_invoice).patient_id
    FOR UPDATE;

    IF v_available IS NULL OR v_available < _balance_amount THEN
      RAISE EXCEPTION 'Insufficient wallet balance (available: %, requested: %)',
        COALESCE(v_available, 0), _balance_amount;
    END IF;

    SELECT public.adjust_patient_balance(
      (v_invoice).patient_id,
      -_balance_amount,
      'invoice_deduction',
      'balance',
      NULL,
      _invoice_id,
      COALESCE(_notes, format('Applied to invoice %s', (v_invoice).invoice_number))
    );
  END IF;

  -- Record shortfall as patient debt for cash accounts.
  IF _debt_amount > 0 THEN
    SELECT public.adjust_patient_balance(
      (v_invoice).patient_id,
      -_debt_amount,
      'debt_incurred',
      _payment_method,
      NULL,
      _invoice_id,
      format('Shortfall on invoice %s', (v_invoice).invoice_number)
    );
  END IF;

  -- Handle overpayment (only for non-sponsored cash patients)
  IF NOT _sponsored AND (_cash_amount + _balance_amount) > ((v_invoice).total_amount - COALESCE((v_invoice).paid_amount, 0)) THEN
    DECLARE
      v_overpayment numeric;
    BEGIN
      v_overpayment := (_cash_amount + _balance_amount) - ((v_invoice).total_amount - COALESCE((v_invoice).paid_amount, 0));
      SELECT public.adjust_patient_balance(
        (v_invoice).patient_id,
        v_overpayment,
        'overpayment_credit',
        _payment_method,
        NULL,
        _invoice_id,
        format('Overpayment on invoice %s', (v_invoice).invoice_number)
      );
    END;
  END IF;

  v_collected := COALESCE((v_invoice).paid_amount, 0) + _cash_amount + _balance_amount;

  UPDATE public.invoices
  SET paid_amount    = v_collected,
      status         = 'paid',
      payment_method = _payment_method,
      paid_at        = now(),
      notes          = COALESCE(_notes, notes),
      updated_at     = now()
  WHERE id = _invoice_id;

  SELECT balance INTO v_new_balance FROM public.patients WHERE id = (v_invoice).patient_id;

  RETURN jsonb_build_object(
    'invoice_id',       _invoice_id,
    'invoice_number',   (v_invoice).invoice_number,
    'patient_id',       (v_invoice).patient_id,
    'collected',        v_collected,
    'cash_amount',      _cash_amount,
    'balance_amount',   _balance_amount,
    'debt_amount',      _debt_amount,
    'new_wallet_balance', v_new_balance,
    'sponsored',        _sponsored
  );
END;
$$;

-- SOURCE: 20260809162337_b993a8b4-56c4-4c2a-aa13-7b76ad76eca6.sql statement 1
CREATE OR REPLACE FUNCTION public.settle_invoice_atomic(
  _invoice_id uuid,
  _cash_amount numeric DEFAULT 0,
  _balance_amount numeric DEFAULT 0,
  _debt_amount numeric DEFAULT 0,
  _payment_method text DEFAULT 'cash',
  _notes text DEFAULT NULL,
  _sponsored boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  v_invoice public.invoices;
  v_new_balance numeric;
  v_collected numeric;
  v_available numeric;
BEGIN
  IF NOT public.is_authenticated_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _cash_amount < 0 OR _balance_amount < 0 OR _debt_amount < 0 THEN
    RAISE EXCEPTION 'Amounts must be non-negative';
  END IF;

  -- Lock the invoice row for the duration of the transaction.
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = _invoice_id
  FOR UPDATE;
  IF (v_invoice).id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF (v_invoice).status = 'paid' THEN
    RAISE EXCEPTION 'Invoice already settled';
  END IF;

  -- Deduct from wallet balance (with concurrency-safe check).
  IF _balance_amount > 0 THEN
    SELECT balance INTO v_available
    FROM public.patients
    WHERE id = (v_invoice).patient_id
    FOR UPDATE;

    IF v_available IS NULL OR v_available < _balance_amount THEN
      RAISE EXCEPTION 'Insufficient wallet balance (available: %, requested: %)',
        COALESCE(v_available, 0), _balance_amount;
    END IF;

    SELECT public.adjust_patient_balance(
      (v_invoice).patient_id,
      -_balance_amount,
      'invoice_deduction',
      'balance',
      NULL,
      _invoice_id,
      COALESCE(_notes, format('Applied to invoice %s', (v_invoice).invoice_number))
    );
  END IF;

  -- Record shortfall as patient debt for cash accounts.
  IF _debt_amount > 0 THEN
    SELECT public.adjust_patient_balance(
      (v_invoice).patient_id,
      -_debt_amount,
      'debt_incurred',
      _payment_method,
      NULL,
      _invoice_id,
      format('Shortfall on invoice %s', (v_invoice).invoice_number)
    );
  END IF;

  -- Handle overpayment (only for non-sponsored cash patients)
  IF NOT _sponsored AND (_cash_amount + _balance_amount) > ((v_invoice).total_amount - COALESCE((v_invoice).paid_amount, 0)) THEN
    DECLARE
      v_overpayment numeric;
    BEGIN
      v_overpayment := (_cash_amount + _balance_amount) - ((v_invoice).total_amount - COALESCE((v_invoice).paid_amount, 0));
      SELECT public.adjust_patient_balance(
        (v_invoice).patient_id,
        v_overpayment,
        'overpayment_credit',
        _payment_method,
        NULL,
        _invoice_id,
        format('Overpayment on invoice %s', (v_invoice).invoice_number)
      );
    END;
  END IF;

  v_collected := COALESCE((v_invoice).paid_amount, 0) + _cash_amount + _balance_amount;

  UPDATE public.invoices
  SET paid_amount    = v_collected,
      status         = 'paid',
      payment_method = _payment_method,
      paid_at        = now(),
      notes          = COALESCE(_notes, notes),
      updated_at     = now()
  WHERE id = _invoice_id;

  SELECT balance INTO v_new_balance FROM public.patients WHERE id = (v_invoice).patient_id;

  RETURN jsonb_build_object(
    'invoice_id',       _invoice_id,
    'invoice_number',   (v_invoice).invoice_number,
    'patient_id',       (v_invoice).patient_id,
    'collected',        v_collected,
    'cash_amount',      _cash_amount,
    'balance_amount',   _balance_amount,
    'debt_amount',      _debt_amount,
    'new_wallet_balance', v_new_balance,
    'sponsored',        _sponsored
  );
END;
$$;

-- SOURCE: 20260809175339_3651aaba-5464-4d8a-b980-1b29b1f239ec.sql statement 1
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS family_deduction_consent BOOLEAN DEFAULT false;
