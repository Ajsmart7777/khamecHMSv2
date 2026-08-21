-- SOURCE: 20260812163043_50700de6-7a1a-4cea-87b9-296186073bfa.sql statement 8
ALTER TABLE public.invoices
  ADD COLUMN salary_deduction_batch_id uuid REFERENCES public.staff_deduction_batches(id);

-- SOURCE: 20260812163043_50700de6-7a1a-4cea-87b9-296186073bfa.sql statement 9
CREATE INDEX IF NOT EXISTS idx_invoices_salary_deduction_batch
  ON public.invoices (salary_deduction_batch_id)
  WHERE is_salary_deduction = true;

-- SOURCE: 20260812163043_50700de6-7a1a-4cea-87b9-296186073bfa.sql statement 10
CREATE OR REPLACE FUNCTION public.close_family_deduction_batch(
  _invoice_ids uuid[],
  _period_month integer DEFAULT NULL,
  _period_year integer DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _batch_id uuid;
  _total numeric := 0;
  _staff_count integer := 0;
  _invoice_count integer := 0;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['admin','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'Only accountants or admins can close a deduction cycle';
  END IF;

  IF _invoice_ids IS NULL OR array_length(_invoice_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No bills selected to close';
  END IF;

  SELECT COALESCE(SUM(paid_amount), 0), COUNT(DISTINCT staff_sponsor_id), COUNT(*)
    INTO _total, _staff_count, _invoice_count
  FROM public.invoices
  WHERE id = ANY(_invoice_ids)
    AND is_salary_deduction = true
    AND salary_deduction_batch_id IS NULL;

  IF _invoice_count = 0 THEN
    RAISE EXCEPTION 'These bills have already been closed into a batch';
  END IF;

  INSERT INTO public.staff_deduction_batches (
    batch_number, period_month, period_year, total_amount,
    staff_count, invoice_count, notes, closed_by
  ) VALUES (
    'FD-' || to_char(now(), 'YYYYMMDD-HH24MISS'),
    _period_month, _period_year, _total,
    _staff_count, _invoice_count, _notes, public.hms_current_user_id()
  ) RETURNING id INTO _batch_id;

  UPDATE public.invoices
  SET salary_deduction_batch_id = _batch_id
  WHERE id = ANY(_invoice_ids)
    AND is_salary_deduction = true
    AND salary_deduction_batch_id IS NULL;

  RETURN _batch_id;
END;
$$;

-- SOURCE: 20260812163043_50700de6-7a1a-4cea-87b9-296186073bfa.sql statement 11
GRANT EXECUTE ON FUNCTION public.close_family_deduction_batch(uuid[], integer, integer, text) TO authenticated;

-- SOURCE: 20260812163059_189dfa0f-11ff-4aa3-abfe-de01308229cb.sql statement 1
REVOKE EXECUTE ON FUNCTION public.close_family_deduction_batch(uuid[], integer, integer, text) FROM PUBLIC, anon;

-- SOURCE: 20260812163059_189dfa0f-11ff-4aa3-abfe-de01308229cb.sql statement 2
GRANT EXECUTE ON FUNCTION public.close_family_deduction_batch(uuid[], integer, integer, text) TO authenticated;

-- SOURCE: 20260812170000_observation_fee_logic.sql statement 1
CREATE OR REPLACE FUNCTION public.admission_bed_charge(_admission_id uuid)
RETURNS TABLE(days integer, daily_rate numeric, amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  _admitted_at timestamptz;
  _discharged_at timestamptz;
  _created_at timestamptz;
  _rate numeric;
  _nights int;
  _amount numeric;
BEGIN
  SELECT a.admitted_at, a.discharged_at, a.created_at, r.daily_rate
    INTO _admitted_at, _discharged_at, _created_at, _rate
  FROM public.admissions a
  LEFT JOIN public.beds b ON b.id = a.bed_id
  LEFT JOIN public.rooms r ON r.id = b.room_id
  WHERE a.id = _admission_id;

  IF _created_at IS NULL THEN
    RETURN QUERY SELECT 0, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  _nights := GREATEST(0, (COALESCE(_discharged_at, now())::date - COALESCE(_admitted_at, _created_at)::date))::int;
  IF _nights = 0 THEN
    RETURN QUERY SELECT 0, 3000::numeric, 3000::numeric;
  ELSE
    _rate := COALESCE(_rate, 0)::numeric;
    _amount := ROUND(_nights::numeric * _rate, 2)::numeric;
    RETURN QUERY SELECT _nights, _rate, _amount;
  END IF;
END;
$function$;

-- SOURCE: 20260812170000_observation_fee_logic.sql statement 2
REVOKE ALL ON FUNCTION public.admission_bed_charge(uuid) FROM PUBLIC, anon;

-- SOURCE: 20260812170000_observation_fee_logic.sql statement 3
GRANT EXECUTE ON FUNCTION public.admission_bed_charge(uuid) TO authenticated, service_role;

-- SOURCE: 20260812170000_observation_fee_logic.sql statement 4
CREATE OR REPLACE FUNCTION public.bill_admission_bed_days(_admission_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 
AS $function$
DECLARE
  _adm public.admissions;
  _p public.patients;
  _room_class text;
  _days int;
  _rate numeric;
  _amount numeric;
  _pct numeric;
  _copay numeric;
  _inv uuid;
  _bal numeric;
  _from_wallet numeric;
  _debt numeric;
  _item_desc text;
BEGIN
  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id;
  IF _adm IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _p FROM public.patients WHERE id = (_adm).patient_id;
  IF _p IS NULL THEN RETURN NULL; END IF;

  SELECT d.days, d.daily_rate, d.amount INTO _days, _rate, _amount
  FROM public.admission_bed_charge(_admission_id) d;

  IF COALESCE(_amount, 0) <= 0 THEN RETURN NULL; END IF;

  SELECT id INTO _inv FROM public.invoices
  WHERE patient_id = (_adm).patient_id
    AND notes = 'BED_DAYS:' || _admission_id::text
  LIMIT 1;
  IF _inv IS NOT NULL THEN RETURN _inv; END IF;

  _pct := public.copay_percent((_p).account_type, (_p).insurance_plan);
  _copay := ROUND(_amount * _pct / 100.0, 2);

  SELECT r.room_class INTO _room_class FROM public.beds b JOIN public.rooms r ON r.id = b.room_id
  WHERE b.id = (_adm).bed_id;

  INSERT INTO public.invoices (
    patient_id, visit_id, total_amount, original_amount, discount_amount,
    paid_amount, status, sponsor_type, corporate_account_id, notes
  ) VALUES (
    (_adm).patient_id, (_adm).visit_id, _amount, _amount, 0,
    0, 'pending',
    CASE WHEN _pct < 100 THEN (_p).account_type ELSE NULL END,
    NULLIF(((_p).corporate_id)::STRING, '')::UUID,
    'BED_DAYS:' || _admission_id::text
  ) RETURNING id INTO _inv;

  IF _days = 0 THEN
    _item_desc := 'Observation fee (same-day discharge)';
  else
    _item_desc := 'Bed charge - ' || COALESCE(_room_class, 'ward') || ' - ' || _days || ' night(s)';
  END IF;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
  VALUES (
    _inv,
    _item_desc,
    CASE WHEN _days = 0 THEN 1 ELSE _days END,
    _rate, _amount, 'admission'
  );

  IF _copay > 0 THEN
    SELECT balance INTO _bal FROM public.patients WHERE id = (_adm).patient_id FOR UPDATE;
    _from_wallet := ROUND(LEAST(GREATEST(COALESCE(_bal,0), 0), _copay), 2);
    _debt := ROUND(_copay - _from_wallet, 2);

    IF _from_wallet > 0 THEN
      SELECT public.adjust_patient_balance(
        (_adm).patient_id, -_from_wallet, 'invoice_payment', NULL, NULL, _inv,
        CASE WHEN _days = 0 THEN 'Observation fee for admission' ELSE 'Bed charge for admission (' || _days || ' night(s))' END
      );
    END IF;

    IF _debt > 0 THEN
      SELECT public.adjust_patient_balance(
        (_adm).patient_id, -_debt, 'debt_incurred', NULL, NULL, _inv,
        CASE WHEN _days = 0 THEN 'Observation fee shortfall on discharge' ELSE 'Bed charge shortfall on discharge (' || _days || ' night(s))' END
      );
    END IF;

    UPDATE public.invoices
      SET paid_amount = _from_wallet,
          status = CASE WHEN _from_wallet >= _amount THEN 'paid'
                        WHEN _from_wallet > 0 THEN 'partial'
                        ELSE 'pending' END,
          paid_at = CASE WHEN _from_wallet >= _amount THEN now() ELSE NULL END
      WHERE id = _inv;
  END IF;

  RETURN _inv;
END;
$function$;

-- SOURCE: 20260812170000_observation_fee_logic.sql statement 5
REVOKE ALL ON FUNCTION public.bill_admission_bed_days(uuid) FROM PUBLIC, anon;

-- SOURCE: 20260812170000_observation_fee_logic.sql statement 6
GRANT EXECUTE ON FUNCTION public.bill_admission_bed_days(uuid) TO authenticated, service_role;

-- SOURCE: 20260812170000_observation_fee_logic.sql statement 7
CREATE OR REPLACE FUNCTION public.admission_discharge_preview(_admission_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
  SECURITY DEFINER
 
AS $function$
DECLARE
  _adm public.admissions;
  _p public.patients;
  _nights int; _rate numeric; _bed_total numeric;
  _pct numeric; _share numeric; _covered numeric;
  _bal numeric; _prior numeric; _already boolean;
  _due numeric; _after numeric;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(),
       ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','cashier','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  SELECT * INTO _p FROM public.patients WHERE id = (_adm).patient_id;

  SELECT d.days, d.daily_rate, d.amount INTO _nights, _rate, _bed_total
  FROM public.admission_bed_charge(_admission_id) d;

  _pct := public.copay_percent((_p).account_type, (_p).insurance_plan);
  _share := ROUND(COALESCE(_bed_total,0) * _pct / 100.0, 2);
  _covered := ROUND(GREATEST(0, COALESCE(_bed_total,0) - _share), 2);

  SELECT EXISTS (
    SELECT 1 FROM public.invoices
    WHERE patient_id = (_adm).patient_id
      AND notes = 'BED_DAYS:' || _admission_id::text
  ) INTO _already;

  IF _already THEN
    _share := 0; _covered := 0;
  END IF;

  _bal := COALESCE((_p).balance, 0);
  _prior := ROUND(GREATEST(0, -_bal), 2);
  _after := ROUND(_bal - _share, 2);
  _due := ROUND(GREATEST(0, -_after), 2);

  RETURN jsonb_build_object(
    'admission_id', _admission_id,
    'patient_id', (_adm).patient_id,
    'admitted_at', COALESCE((_adm).admitted_at, (_adm).created_at),
    'nights', COALESCE(_nights, 0),
    'daily_rate', COALESCE(_rate, 0),
    'bed_total', COALESCE(_bed_total, 0),
    'bed_already_billed', _already,
    'copay_pct', _pct,
    'sponsor_covered', _covered,
    'bed_patient_share', _share,
    'current_balance', _bal,
    'prior_outstanding', _prior,
    'total_due', _due,
    'balance_after_bed', _after
  );
END;
$function$;

-- SOURCE: 20260812170000_observation_fee_logic.sql statement 8
REVOKE ALL ON FUNCTION public.admission_discharge_preview(uuid) FROM PUBLIC, anon;

-- SOURCE: 20260812170000_observation_fee_logic.sql statement 9
GRANT EXECUTE ON FUNCTION public.admission_discharge_preview(uuid) TO authenticated, service_role;

-- SOURCE: 20260812203000_fix_discharge_preview.sql statement 1
CREATE OR REPLACE FUNCTION public.admission_discharge_preview(_admission_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
  SECURITY DEFINER
 
AS $function$
DECLARE
  _adm public.admissions; _p public.patients;
  _nights int; _rate numeric; _bed_total numeric;
  _pct numeric; _share numeric; _covered numeric;
  _bal numeric; _prior numeric; _already boolean;
  _gross numeric; _credit numeric; _applied numeric; _due numeric;
  _wallet boolean;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(),
       ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','cashier','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  SELECT * INTO _p FROM public.patients WHERE id = (_adm).patient_id;

  SELECT d.days, d.daily_rate, d.amount INTO _nights, _rate, _bed_total
  FROM public.admission_bed_charge(_admission_id) d;

  _pct := public.copay_percent((_p).account_type, (_p).insurance_plan);
  _share := ROUND(COALESCE(_bed_total,0) * _pct / 100.0, 2);
  _covered := ROUND(GREATEST(0, COALESCE(_bed_total,0) - _share), 2);

  SELECT EXISTS (SELECT 1 FROM public.invoices
    WHERE patient_id = (_adm).patient_id AND notes = 'BED_DAYS:' || _admission_id::text) INTO _already;
  IF _already THEN _share := 0; _covered := 0; END IF;

  _wallet := public.has_wallet((_p).account_type);
  _bal    := COALESCE((_p).balance,0);
  _prior  := public.patient_outstanding((_adm).patient_id);
  _gross  := ROUND(_prior + _share, 2);

  _credit  := CASE WHEN _wallet THEN ROUND(GREATEST(_bal,0),2) ELSE 0 END;
  _applied := ROUND(LEAST(_credit, _gross), 2);
  _due     := ROUND(GREATEST(0, _gross - _applied), 2);

  RETURN jsonb_build_object(
    'admission_id', _admission_id,
    'patient_id', (_adm).patient_id,
    'admitted_at', COALESCE((_adm).admitted_at, (_adm).created_at),
    'account_type', (_p).account_type,
    'insurance_plan', (_p).insurance_plan,
    'has_wallet', _wallet,
    'nights', COALESCE(_nights,0),
    'daily_rate', COALESCE(_rate,0),
    'bed_total', COALESCE(_bed_total,0),
    'bed_already_billed', _already,
    'copay_pct', _pct,
    'sponsor_covered', _covered,
    'bed_patient_share', _share,
    'current_balance', _bal,
    'prior_outstanding', _prior,
    'gross_total', _gross,
    'wallet_credit', _credit,
    'wallet_applied', _applied,
    'total_due', _due,
    'balance_after_bed', ROUND(_bal - _applied, 2)
  );
END;
$function$;

-- SOURCE: 20260812210500_add_salary_deduction_method.sql statement 1
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

    ELSIF _settlement_method = 'salary' THEN
      IF (_p).staff_link_id IS NULL THEN
        RAISE EXCEPTION 'STAFF_LINK_REQUIRED: this patient is not linked to any staff member for salary deduction';
      END IF;
      _remaining := 0;
      SELECT public.write_audit_log('salary_deduction_on_discharge', 'admission', _admission_id::text, jsonb_build_object('patient_id',(_adm).patient_id,'debt',_debt,'staff_id',(_p).staff_link_id,'notes',_settlement_notes), 'success');

    ELSIF _settlement_method = 'carry' THEN
      SELECT public.write_audit_log('debt_carried_on_discharge', 'admission', _admission_id::text, jsonb_build_object('patient_id',(_adm).patient_id,'debt',_debt,'notes',_settlement_notes), 'success');
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  -- Money/Credit to apply to invoices
  _left := CASE WHEN _settlement_method IN ('cash','pos','transfer')
                THEN ROUND(GREATEST(0, _collected - _debt_cleared), 2)
                WHEN _settlement_method = 'salary' THEN _debt
                ELSE 0 END;

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

  -- Anything still left is a genuine overpayment (only for cash/pos/transfer).
  IF _wallet AND _left > 0 AND _settlement_method IN ('cash','pos','transfer') THEN
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

-- SOURCE: 20260812213200_sync_discharge_workflow_status.sql statement 1
CREATE OR REPLACE FUNCTION public.discharge_admission(
  _admission_id uuid,
  _notes text DEFAULT NULL::text,
  _settlement_method text DEFAULT NULL::text,
  _settlement_amount numeric DEFAULT 0,
  _settlement_notes text DEFAULT NULL::text,
  _refund_amount numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER

AS $function$
DECLARE
  _adm public.admissions;
  _p public.patients;
  _wallet boolean;
  _debt numeric;
  _collected numeric := 0;
  _remaining numeric := 0;
  _inv public.invoices;
  _apply numeric;
  _left numeric;
  _applied numeric := 0;
  _pct numeric;
  _share numeric;
  _wallet_used numeric := 0;
  _refund numeric := 0;
  _credit numeric := 0;
  _debt_cleared numeric := 0;
  _got_lock boolean;
BEGIN
  IF NOT public.has_any_role(
    public.hms_current_user_id(),
    ARRAY['cashier','billing','accountant','admin']::app_role[]
  ) THEN
    RAISE EXCEPTION 'Only the cashier can settle and complete a discharge';
  END IF;

  _got_lock := true;
  IF NOT _got_lock THEN
    RAISE EXCEPTION 'DISCHARGE_IN_PROGRESS: this discharge is already being settled — refresh the queue';
  END IF;

  SELECT * INTO _adm FROM public.admissions
  WHERE id = _admission_id
  FOR UPDATE;

  IF _adm IS NULL THEN
    RAISE EXCEPTION 'Admission not found';
  END IF;
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
  _wallet_used := public.apply_wallet_to_outstanding(
    (_adm).patient_id,
    'Balance applied at discharge'
  );

  SELECT * INTO _p FROM public.patients
  WHERE id = (_adm).patient_id
  FOR UPDATE;

  _wallet := public.has_wallet((_p).account_type);
  _pct := public.copay_percent((_p).account_type, (_p).insurance_plan);
  _debt := public.patient_outstanding((_adm).patient_id);
  _remaining := _debt;

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash', 'pos', 'transfer') THEN
      _collected := ROUND(GREATEST(COALESCE(_settlement_amount, 0), 0), 2);
      IF _collected <= 0 THEN
        RAISE EXCEPTION 'Settlement amount must be greater than zero';
      END IF;
      IF _wallet AND (_p).balance < 0 THEN
        _debt_cleared := ROUND(LEAST(_collected, -(_p).balance), 2);
        SELECT public.adjust_patient_balance((_adm).patient_id, _debt_cleared, 'debt_cleared', _settlement_method, NULL, NULL, COALESCE(_settlement_notes)
        );
      END IF;
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
      IF _remaining > 0 THEN
        SELECT public.write_audit_log('discharge_partial_settlement', 'admission', _admission_id::text, jsonb_build_object(
            'patient_id', (_adm).patient_id,
            'debt', _debt,
            'collected', _collected,
            'outstanding', _remaining,
            'method', _settlement_method,
            'notes', _settlement_notes
          )
        , 'success');
      END IF;
    ELSIF _settlement_method = 'salary' THEN
      IF (_p).staff_link_id IS NULL THEN
        RAISE EXCEPTION 'STAFF_LINK_REQUIRED: this patient is not linked to any staff member for salary deduction';
      END IF;
      _remaining := 0;
      SELECT public.write_audit_log('salary_deduction_on_discharge', 'admission', _admission_id::text, jsonb_build_object(
          'patient_id', (_adm).patient_id,
          'debt', _debt,
          'staff_id', (_p).staff_link_id,
          'notes', _settlement_notes
        )
      , 'success');
    ELSIF _settlement_method = 'carry' THEN
      SELECT public.write_audit_log('debt_carried_on_discharge', 'admission', _admission_id::text, jsonb_build_object(
          'patient_id', (_adm).patient_id,
          'debt', _debt,
          'notes', _settlement_notes
        )
      , 'success');
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  _left := CASE
    WHEN _settlement_method IN ('cash', 'pos', 'transfer')
      THEN ROUND(GREATEST(0, _collected - _debt_cleared), 2)
    WHEN _settlement_method = 'salary' THEN _debt
    ELSE 0
  END;

  IF _left > 0 THEN
    SELECT COALESCE(SUM(applied), 0) INTO _applied
    FROM (
      SELECT LEAST(due, GREATEST(_left - prior_due, 0))::numeric AS applied
      FROM (
        SELECT ROUND(total_amount * _pct / 100.0, 2)::numeric AS share,
               GREATEST((ROUND(total_amount * _pct / 100.0, 2)) - COALESCE(paid_amount, 0), 0)::numeric AS due,
               COALESCE(SUM(GREATEST((ROUND(total_amount * _pct / 100.0, 2)) - COALESCE(paid_amount, 0), 0)) OVER (
                 ORDER BY created_at ASC, id ASC
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ), 0)::numeric AS prior_due
        FROM public.invoices
        WHERE patient_id = (_adm).patient_id AND status IN ('pending', 'partial')
      ) unpaid
    ) allocation;

    WITH unpaid AS (
      SELECT id, total_amount, COALESCE(paid_amount, 0)::numeric AS paid,
             ROUND(total_amount * _pct / 100.0, 2)::numeric AS share,
             GREATEST((ROUND(total_amount * _pct / 100.0, 2)) - COALESCE(paid_amount, 0), 0)::numeric AS due,
             COALESCE(SUM(GREATEST((ROUND(total_amount * _pct / 100.0, 2)) - COALESCE(paid_amount, 0), 0)) OVER (
               ORDER BY created_at ASC, id ASC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0)::numeric AS prior_due
      FROM public.invoices
      WHERE patient_id = (_adm).patient_id AND status IN ('pending', 'partial')
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
           is_salary_deduction = CASE WHEN _settlement_method = 'salary' THEN true ELSE is_salary_deduction END,
           staff_sponsor_id = CASE WHEN _settlement_method = 'salary' THEN (_p).staff_link_id ELSE staff_sponsor_id END,
           updated_at = now()
      FROM allocated a
     WHERE i.id = a.id AND a.applied > 0;

    _left := ROUND(_left - COALESCE(_applied, 0), 2);
  END IF;

  IF _wallet AND _left > 0 AND _settlement_method IN ('cash', 'pos', 'transfer') THEN
    SELECT public.adjust_patient_balance(
      (_adm).patient_id,
      _left,
      'topup',
      _settlement_method,
      NULL,
      NULL,
      'Change from discharge settlement left on balance'
    );
    _credit := _left;
  END IF;

  _refund := ROUND(GREATEST(COALESCE(_refund_amount, 0), 0), 2);
  IF _refund > 0 THEN
    IF NOT _wallet THEN
      RAISE EXCEPTION 'Sponsored accounts have no wallet to refund from';
    END IF;
    SELECT * INTO _p FROM public.patients
    WHERE id = (_adm).patient_id
    FOR UPDATE;
    IF _refund > (_p).balance THEN
      RAISE EXCEPTION 'Refund % exceeds available balance %', _refund, (_p).balance;
    END IF;
    SELECT public.adjust_patient_balance(
      (_adm).patient_id,
      -_refund,
      'refund',
      _settlement_method,
      NULL,
      NULL,
      'Change paid out at discharge'
    );
  END IF;

  UPDATE public.admissions
  SET status = 'discharged',
      discharged_at = now(),
      discharged_by = public.hms_current_user_id(),
      discharge_notes = COALESCE(_notes, discharge_notes),
      updated_at = now()
  WHERE id = _admission_id
    AND status = 'ready_for_discharge';

  IF (_adm).status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was settled by someone else — refresh the queue';
  END IF;

  IF (_adm).bed_id IS NOT NULL THEN
    UPDATE public.beds
    SET status = 'available', updated_at = now()
    WHERE id = (_adm).bed_id;
  END IF;

  -- Central workflow write: update patient_journey, append journey history,
  -- and mirror patients.status atomically with the admission discharge.
  SELECT public.advance_journey(
    (_adm).patient_id,
    'discharged',
    'reception',
    NULL,
    NULL,
    NULL,
    (_adm).visit_id,
    'Inpatient cashier settlement completed'
  );

  SELECT public.write_audit_log('admission_discharged', 'admission', _admission_id::text, jsonb_build_object(
      'patient_id', (_adm).patient_id,
      'notes', _notes,
      'debt', _debt,
      'wallet_applied', _wallet_used,
      'collected', _collected,
      'debt_cleared', _debt_cleared,
      'outstanding', _remaining,
      'credit_left', _credit,
      'refunded', _refund,
      'method', _settlement_method
    )
  , 'success');

  RETURN jsonb_build_object(
    'debt', _debt,
    'wallet_applied', _wallet_used,
    'collected', _collected,
    'outstanding', _remaining,
    'credit_left', _credit,
    'refunded', _refund
  );
END;
$function$;

-- SOURCE: 20260812213200_sync_discharge_workflow_status.sql statement 2
WITH candidates AS (
  SELECT
    j.id AS journey_id,
    j.patient_id,
    j.visit_id,
    j.current_state AS from_state,
    j.owner_role AS from_owner_role,
    j.owner_user_id AS from_owner_user_id
  FROM public.patient_journey j
  JOIN public.patients p ON p.id = j.patient_id
  WHERE p.status = 'admitted'
    AND j.current_state = 'admitted'
    AND EXISTS (
      SELECT 1
      FROM public.admissions a
      WHERE a.patient_id = p.id
        AND a.status = 'discharged'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.admissions a
      WHERE a.patient_id = p.id
        AND a.status IN ('waiting_assignment', 'active', 'ready_for_discharge')
    )
), updated_journeys AS (
  UPDATE public.patient_journey j
  SET current_state = 'discharged',
      owner_role = 'reception',
      owner_user_id = NULL,
      updated_at = now()
  FROM candidates c
  WHERE j.id = c.journey_id
  RETURNING j.id, c.patient_id, c.visit_id, c.from_state, c.from_owner_role, c.from_owner_user_id
), history_written AS (
  INSERT INTO public.patient_journey_history (
    journey_id,
    patient_id,
    visit_id,
    from_state,
    to_state,
    from_owner_role,
    to_owner_role,
    from_owner_user_id,
    to_owner_user_id,
    reason
  )
  SELECT
    id,
    patient_id,
    visit_id,
    from_state,
    'discharged',
    from_owner_role,
    'reception',
    from_owner_user_id,
    NULL,
    'Repair: previously settled inpatient was left in admitted workflow state'
  FROM updated_journeys
  RETURNING patient_id
)
UPDATE public.patients p
SET status = 'discharged',
    updated_at = now()
FROM history_written h
WHERE p.id = h.patient_id;

-- SOURCE: 20260812213200_sync_discharge_workflow_status.sql statement 3
REVOKE EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) FROM PUBLIC, anon;

-- SOURCE: 20260812213200_sync_discharge_workflow_status.sql statement 4
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) TO authenticated;

-- SOURCE: 20260812213400_finalize_inpatient_workflow_sync.sql statement 1
CREATE OR REPLACE FUNCTION public.discharge_admission(
  _admission_id uuid,
  _notes text DEFAULT NULL::text,
  _settlement_method text DEFAULT NULL::text,
  _settlement_amount numeric DEFAULT 0,
  _settlement_notes text DEFAULT NULL::text,
  _refund_amount numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER

AS $function$
DECLARE
  _adm public.admissions;
  _p public.patients;
  _wallet boolean;
  _debt numeric;
  _collected numeric := 0;
  _remaining numeric := 0;
  _inv public.invoices;
  _apply numeric;
  _left numeric;
  _applied numeric := 0;
  _pct numeric;
  _share numeric;
  _wallet_used numeric := 0;
  _refund numeric := 0;
  _credit numeric := 0;
  _debt_cleared numeric := 0;
  _got_lock boolean;
  _journey public.patient_journey;
  _journey_id uuid;
BEGIN
  IF NOT public.has_any_role(
    public.hms_current_user_id(),
    ARRAY['cashier','billing','accountant','admin']::app_role[]
  ) THEN
    RAISE EXCEPTION 'Only the cashier can settle and complete a discharge';
  END IF;

  _got_lock := true;
  IF NOT _got_lock THEN
    RAISE EXCEPTION 'DISCHARGE_IN_PROGRESS: this discharge is already being settled — refresh the queue';
  END IF;

  SELECT * INTO _adm FROM public.admissions
  WHERE id = _admission_id
  FOR UPDATE;

  IF _adm IS NULL THEN
    RAISE EXCEPTION 'Admission not found';
  END IF;
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
  _wallet_used := public.apply_wallet_to_outstanding(
    (_adm).patient_id,
    'Balance applied at discharge'
  );

  SELECT * INTO _p FROM public.patients
  WHERE id = (_adm).patient_id
  FOR UPDATE;

  _wallet := public.has_wallet((_p).account_type);
  _pct := public.copay_percent((_p).account_type, (_p).insurance_plan);
  _debt := public.patient_outstanding((_adm).patient_id);
  _remaining := _debt;

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash', 'pos', 'transfer') THEN
      _collected := ROUND(GREATEST(COALESCE(_settlement_amount, 0), 0), 2);
      IF _collected <= 0 THEN
        RAISE EXCEPTION 'Settlement amount must be greater than zero';
      END IF;
      IF _wallet AND (_p).balance < 0 THEN
        _debt_cleared := ROUND(LEAST(_collected, -(_p).balance), 2);
        SELECT public.adjust_patient_balance((_adm).patient_id, _debt_cleared, 'debt_cleared', _settlement_method, NULL, NULL, COALESCE(_settlement_notes)
        );
      END IF;
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
      IF _remaining > 0 THEN
        SELECT public.write_audit_log('discharge_partial_settlement', 'admission', _admission_id::text, jsonb_build_object(
            'patient_id', (_adm).patient_id,
            'debt', _debt,
            'collected', _collected,
            'outstanding', _remaining,
            'method', _settlement_method,
            'notes', _settlement_notes
          )
        , 'success');
      END IF;
    ELSIF _settlement_method = 'salary' THEN
      IF (_p).staff_link_id IS NULL THEN
        RAISE EXCEPTION 'STAFF_LINK_REQUIRED: this patient is not linked to any staff member for salary deduction';
      END IF;
      _remaining := 0;
      SELECT public.write_audit_log('salary_deduction_on_discharge', 'admission', _admission_id::text, jsonb_build_object(
          'patient_id', (_adm).patient_id,
          'debt', _debt,
          'staff_id', (_p).staff_link_id,
          'notes', _settlement_notes
        )
      , 'success');
    ELSIF _settlement_method = 'carry' THEN
      SELECT public.write_audit_log('debt_carried_on_discharge', 'admission', _admission_id::text, jsonb_build_object(
          'patient_id', (_adm).patient_id,
          'debt', _debt,
          'notes', _settlement_notes
        )
      , 'success');
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  _left := CASE
    WHEN _settlement_method IN ('cash', 'pos', 'transfer')
      THEN ROUND(GREATEST(0, _collected - _debt_cleared), 2)
    WHEN _settlement_method = 'salary' THEN _debt
    ELSE 0
  END;

  IF _left > 0 THEN
    SELECT COALESCE(SUM(applied), 0) INTO _applied
    FROM (
      SELECT LEAST(due, GREATEST(_left - prior_due, 0))::numeric AS applied
      FROM (
        SELECT ROUND(total_amount * _pct / 100.0, 2)::numeric AS share,
               GREATEST((ROUND(total_amount * _pct / 100.0, 2)) - COALESCE(paid_amount, 0), 0)::numeric AS due,
               COALESCE(SUM(GREATEST((ROUND(total_amount * _pct / 100.0, 2)) - COALESCE(paid_amount, 0), 0)) OVER (
                 ORDER BY created_at ASC, id ASC
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ), 0)::numeric AS prior_due
        FROM public.invoices
        WHERE patient_id = (_adm).patient_id AND status IN ('pending', 'partial')
      ) unpaid
    ) allocation;

    WITH unpaid AS (
      SELECT id, total_amount, COALESCE(paid_amount, 0)::numeric AS paid,
             ROUND(total_amount * _pct / 100.0, 2)::numeric AS share,
             GREATEST((ROUND(total_amount * _pct / 100.0, 2)) - COALESCE(paid_amount, 0), 0)::numeric AS due,
             COALESCE(SUM(GREATEST((ROUND(total_amount * _pct / 100.0, 2)) - COALESCE(paid_amount, 0), 0)) OVER (
               ORDER BY created_at ASC, id ASC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0)::numeric AS prior_due
      FROM public.invoices
      WHERE patient_id = (_adm).patient_id AND status IN ('pending', 'partial')
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
           is_salary_deduction = CASE WHEN _settlement_method = 'salary' THEN true ELSE is_salary_deduction END,
           staff_sponsor_id = CASE WHEN _settlement_method = 'salary' THEN (_p).staff_link_id ELSE staff_sponsor_id END,
           updated_at = now()
      FROM allocated a
     WHERE i.id = a.id AND a.applied > 0;

    _left := ROUND(_left - COALESCE(_applied, 0), 2);
  END IF;

  IF _wallet AND _left > 0 AND _settlement_method IN ('cash', 'pos', 'transfer') THEN
    SELECT public.adjust_patient_balance(
      (_adm).patient_id,
      _left,
      'topup',
      _settlement_method,
      NULL,
      NULL,
      'Change from discharge settlement left on balance'
    );
    _credit := _left;
  END IF;

  _refund := ROUND(GREATEST(COALESCE(_refund_amount, 0), 0), 2);
  IF _refund > 0 THEN
    IF NOT _wallet THEN
      RAISE EXCEPTION 'Sponsored accounts have no wallet to refund from';
    END IF;
    SELECT * INTO _p FROM public.patients
    WHERE id = (_adm).patient_id
    FOR UPDATE;
    IF _refund > (_p).balance THEN
      RAISE EXCEPTION 'Refund % exceeds available balance %', _refund, (_p).balance;
    END IF;
    SELECT public.adjust_patient_balance(
      (_adm).patient_id,
      -_refund,
      'refund',
      _settlement_method,
      NULL,
      NULL,
      'Change paid out at discharge'
    );
  END IF;

  UPDATE public.admissions
  SET status = 'discharged',
      discharged_at = now(),
      discharged_by = public.hms_current_user_id(),
      discharge_notes = COALESCE(_notes, discharge_notes),
      updated_at = now()
  WHERE id = _admission_id
    AND status = 'ready_for_discharge';

  IF (_adm).status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was settled by someone else — refresh the queue';
  END IF;

  IF (_adm).bed_id IS NOT NULL THEN
    UPDATE public.beds
    SET status = 'available', updated_at = now()
    WHERE id = (_adm).bed_id;
  END IF;

  -- An inpatient cashier settlement is the authoritative terminal event for
  -- this admission. It writes the journey and its audit record directly so the
  -- new admission invoice cannot be misclassified as pending outpatient work.
  SELECT * INTO _journey
  FROM public.patient_journey
  WHERE patient_id = (_adm).patient_id
  FOR UPDATE;

  IF (_journey).id IS NULL THEN
    INSERT INTO public.patient_journey (
      patient_id, visit_id, current_state, owner_role, owner_user_id
    ) VALUES (
      (_adm).patient_id, (_adm).visit_id, 'discharged', 'reception', NULL
    )
    RETURNING id INTO _journey_id;

    INSERT INTO public.patient_journey_history (
      journey_id, patient_id, visit_id, from_state, to_state,
      from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
      reason
    ) VALUES (
      _journey_id, (_adm).patient_id, (_adm).visit_id, NULL, 'discharged',
      NULL, 'reception', NULL, NULL,
      'Inpatient cashier settlement completed'
    );
  ELSE
    UPDATE public.patient_journey
    SET visit_id = COALESCE((_adm).visit_id, (_journey).visit_id),
        current_state = 'discharged',
        owner_role = 'reception',
        owner_user_id = NULL,
        updated_at = now()
    WHERE id = (_journey).id;

    INSERT INTO public.patient_journey_history (
      journey_id, patient_id, visit_id, from_state, to_state,
      from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
      reason
    ) VALUES (
      (_journey).id, (_adm).patient_id, COALESCE((_adm).visit_id, (_journey).visit_id),
      (_journey).current_state, 'discharged',
      (_journey).owner_role, 'reception', (_journey).owner_user_id, NULL,
      'Inpatient cashier settlement completed'
    );
  END IF;

  UPDATE public.patients
  SET status = 'discharged',
      updated_at = now()
  WHERE id = (_adm).patient_id;

  SELECT public.write_audit_log('admission_discharged', 'admission', _admission_id::text, jsonb_build_object(
      'patient_id', (_adm).patient_id,
      'notes', _notes,
      'debt', _debt,
      'wallet_applied', _wallet_used,
      'collected', _collected,
      'debt_cleared', _debt_cleared,
      'outstanding', _remaining,
      'credit_left', _credit,
      'refunded', _refund,
      'method', _settlement_method
    )
  , 'success');

  RETURN jsonb_build_object(
    'debt', _debt,
    'wallet_applied', _wallet_used,
    'collected', _collected,
    'outstanding', _remaining,
    'credit_left', _credit,
    'refunded', _refund
  );
END;
$function$;

-- SOURCE: 20260812213400_finalize_inpatient_workflow_sync.sql statement 2
WITH candidates AS (
  SELECT
    j.id AS journey_id,
    j.patient_id,
    j.visit_id,
    j.current_state AS from_state,
    j.owner_role AS from_owner_role,
    j.owner_user_id AS from_owner_user_id
  FROM public.patient_journey j
  JOIN public.patients p ON p.id = j.patient_id
  WHERE p.status = 'admitted'
    AND j.current_state = 'admitted'
    AND EXISTS (
      SELECT 1
      FROM public.admissions a
      WHERE a.patient_id = p.id
        AND a.status = 'discharged'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.admissions a
      WHERE a.patient_id = p.id
        AND a.status IN ('waiting_assignment', 'active', 'ready_for_discharge')
    )
), updated_journeys AS (
  UPDATE public.patient_journey j
  SET current_state = 'discharged',
      owner_role = 'reception',
      owner_user_id = NULL,
      updated_at = now()
  FROM candidates c
  WHERE j.id = c.journey_id
  RETURNING j.id, c.patient_id, c.visit_id, c.from_state, c.from_owner_role, c.from_owner_user_id
), history_written AS (
  INSERT INTO public.patient_journey_history (
    journey_id,
    patient_id,
    visit_id,
    from_state,
    to_state,
    from_owner_role,
    to_owner_role,
    from_owner_user_id,
    to_owner_user_id,
    reason
  )
  SELECT
    id,
    patient_id,
    visit_id,
    from_state,
    'discharged',
    from_owner_role,
    'reception',
    from_owner_user_id,
    NULL,
    'Repair: previously settled inpatient was left in admitted workflow state'
  FROM updated_journeys
  RETURNING patient_id
)
UPDATE public.patients p
SET status = 'discharged',
    updated_at = now()
FROM history_written h
WHERE p.id = h.patient_id;

-- SOURCE: 20260812213400_finalize_inpatient_workflow_sync.sql statement 3
REVOKE EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) FROM PUBLIC, anon;

-- SOURCE: 20260812213400_finalize_inpatient_workflow_sync.sql statement 4
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) TO authenticated;

-- SOURCE: 20260813104627_024a2714-c14d-4239-8f32-680c0176f4f1.sql statement 1
CREATE OR REPLACE FUNCTION public.can_add_snap_for_patient(_patient_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER

AS $$
DECLARE
  _status text;
  _is_admitted boolean;
  _has_lab_return boolean;
  _has_paid_lab_req boolean;
  _has_paid_rx_req boolean;
BEGIN
  IF _user_id IS NULL OR _patient_id IS NULL THEN RETURN false; END IF;

  -- Admin always allowed.
  IF public.has_role(_user_id, 'admin'::app_role) THEN RETURN true; END IF;

  -- Lab Tech check: if they have a PAID lab request for this patient, they must be allowed to fulfill it.
  IF public.has_role(_user_id, 'lab_tech'::app_role) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.snap_orders
       WHERE patient_id = _patient_id
         AND target_station = 'lab'
         AND status = 'paid'
    ) INTO _has_paid_lab_req;
    IF _has_paid_lab_req THEN RETURN true; END IF;
  END IF;

  -- Pharmacist check: if they have a PAID pharmacy request for this patient, they must be allowed to fulfill it.
  IF public.has_role(_user_id, 'pharmacist'::app_role) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.snap_orders
       WHERE patient_id = _patient_id
         AND target_station = 'pharmacy'
         AND status = 'paid'
    ) INTO _has_paid_rx_req;
    IF _has_paid_rx_req THEN RETURN true; END IF;
  END IF;

  SELECT status::text INTO _status FROM public.patients WHERE id = _patient_id;
  IF _status IS NULL THEN RETURN false; END IF;

  -- Lab result check: if a lab result is ready for THIS user, they are an owner.
  SELECT EXISTS (
    SELECT 1 FROM public.snap_orders
     WHERE patient_id = _patient_id
       AND order_type = 'lab_result'
       AND status = 'returned'
       AND returned_to = _user_id
  ) INTO _has_lab_return;

  IF _has_lab_return THEN RETURN true; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.admissions
     WHERE patient_id = _patient_id AND status = 'active'
  ) INTO _is_admitted;

  -- Admitted patients: nursing/doctor roles retain ownership in the ward.
  IF _is_admitted OR _status = 'admitted' THEN
    RETURN public.has_any_role(_user_id,
      ARRAY['nurse','doctor','doctor1','doctor2']::app_role[]);
  END IF;

  -- Allow nurses to act on 'waiting' status (Queue)
  IF _status = 'waiting' THEN
    RETURN public.has_role(_user_id, 'nurse'::app_role);
  END IF;

  RETURN CASE _status
    WHEN 'with_nurse'   THEN public.has_role(_user_id, 'nurse'::app_role)
    WHEN 'with_doctor'  THEN public.has_any_role(_user_id,
                              ARRAY['doctor','doctor1','doctor2']::app_role[])
    WHEN 'in_lab'       THEN public.has_role(_user_id, 'lab_tech'::app_role)
    WHEN 'at_pharmacy'  THEN public.has_role(_user_id, 'pharmacist'::app_role)
    ELSE false
  END;
END;
$$;

-- SOURCE: 20260813110813_28560c82-d597-49fc-aa18-224044418212.sql statement 1
CREATE OR REPLACE FUNCTION public.can_add_snap_for_patient(_patient_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER

AS $$
DECLARE
  _status text;
  _is_admitted boolean;
  _has_lab_return boolean;
  _has_paid_lab_req boolean;
  _has_paid_rx_req boolean;
BEGIN
  IF _user_id IS NULL OR _patient_id IS NULL THEN RETURN false; END IF;

  -- Admin always allowed.
  IF public.has_role(_user_id, 'admin'::app_role) THEN RETURN true; END IF;

  -- Check if there's an active admission for this patient
  SELECT EXISTS (
    SELECT 1 FROM public.admissions
     WHERE patient_id = _patient_id AND status = 'active'
  ) INTO _is_admitted;

  -- Admitted patients: nursing/doctor roles ALWAYS have ownership to add orders.
  IF _is_admitted THEN
    RETURN public.has_any_role(_user_id,
      ARRAY['nurse','doctor','doctor1','doctor2']::app_role[]);
  END IF;

  -- Lab Tech check: if they have a PAID lab request for this patient, they must be allowed to fulfill it.
  IF public.has_role(_user_id, 'lab_tech'::app_role) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.snap_orders
       WHERE patient_id = _patient_id
         AND target_station = 'lab'
         AND status = 'paid'
    ) INTO _has_paid_lab_req;
    IF _has_paid_lab_req THEN RETURN true; END IF;
  END IF;

  -- Pharmacist check: if they have a PAID pharmacy request for this patient, they must be allowed to fulfill it.
  IF public.has_role(_user_id, 'pharmacist'::app_role) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.snap_orders
       WHERE patient_id = _patient_id
         AND target_station = 'pharmacy'
         AND status = 'paid'
    ) INTO _has_paid_rx_req;
    IF _has_paid_rx_req THEN RETURN true; END IF;
  END IF;

  SELECT status::text INTO _status FROM public.patients WHERE id = _patient_id;
  IF _status IS NULL THEN RETURN false; END IF;

  -- Lab result check: if a lab result is ready for THIS user, they are an owner.
  SELECT EXISTS (
    SELECT 1 FROM public.snap_orders
     WHERE patient_id = _patient_id
       AND order_type = 'lab_result'
       AND status = 'returned'
       AND returned_to = _user_id
  ) INTO _has_lab_return;

  IF _has_lab_return THEN RETURN true; END IF;

  -- Clinical staff can add orders while patient is awaiting billing (during a visit)
  IF _status = 'awaiting_billing' THEN
    RETURN public.has_any_role(_user_id,
      ARRAY['nurse','doctor','doctor1','doctor2']::app_role[]);
  END IF;

  -- Allow nurses to act on 'waiting' status (Queue)
  IF _status = 'waiting' THEN
    RETURN public.has_role(_user_id, 'nurse'::app_role);
  END IF;

  RETURN CASE _status
    WHEN 'with_nurse'   THEN public.has_role(_user_id, 'nurse'::app_role)
    WHEN 'with_doctor'  THEN public.has_any_role(_user_id,
                              ARRAY['doctor','doctor1','doctor2']::app_role[])
    WHEN 'in_lab'       THEN public.has_role(_user_id, 'lab_tech'::app_role)
    WHEN 'at_pharmacy'  THEN public.has_role(_user_id, 'pharmacist'::app_role)
    WHEN 'admitted'     THEN public.has_any_role(_user_id,
                              ARRAY['nurse','doctor','doctor1','doctor2']::app_role[])
    ELSE false
  END;
END;
$$;

-- SOURCE: 20260813114243_99220060-0a69-4f96-ac75-e7fdf48ee8a6.sql statement 1
CREATE OR REPLACE FUNCTION public.can_add_snap_for_patient(_patient_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER

AS $$
DECLARE
  _status text;
  _is_admitted boolean;
  _has_lab_return boolean;
  _has_paid_lab_req boolean;
  _has_paid_rx_req boolean;
  _user_role app_role;
BEGIN
  IF _user_id IS NULL OR _patient_id IS NULL THEN RETURN false; END IF;

  -- Admin always allowed.
  IF public.has_role(_user_id, 'admin'::app_role) THEN RETURN true; END IF;

  -- Get patient status
  SELECT status::text INTO _status FROM public.patients WHERE id = _patient_id;
  IF _status IS NULL THEN RETURN false; END IF;

  -- Get current user role (taking first role found for simplicity in this logic)
  SELECT role INTO _user_role FROM public.user_roles WHERE user_id = _user_id LIMIT 1;

  -- Lab Tech check: if they have a PAID lab request for this patient, they must be allowed to fulfill it.
  IF _user_role = 'lab_tech'::app_role THEN
    SELECT EXISTS (
      SELECT 1 FROM public.snap_orders
       WHERE patient_id = _patient_id
         AND target_station = 'lab'
         AND status = 'paid'
    ) INTO _has_paid_lab_req;
    IF _has_paid_lab_req THEN RETURN true; END IF;
  END IF;

  -- Pharmacist check: if they have a PAID pharmacy request for this patient, they must be allowed to fulfill it.
  IF _user_role = 'pharmacist'::app_role THEN
    SELECT EXISTS (
      SELECT 1 FROM public.snap_orders
       WHERE patient_id = _patient_id
         AND target_station = 'pharmacy'
         AND status = 'paid'
    ) INTO _has_paid_rx_req;
    IF _has_paid_rx_req THEN RETURN true; END IF;
  END IF;

  -- Lab result check: if a lab result was returned to THIS user, they are an owner.
  -- This is a HARD RULE: returned results grant ownership back to sender.
  SELECT EXISTS (
    SELECT 1 FROM public.snap_orders
     WHERE patient_id = _patient_id
       AND order_type = 'lab_result'
       AND status = 'returned'
       AND returned_to = _user_id
  ) INTO _has_lab_return;

  IF _has_lab_return THEN RETURN true; END IF;

  -- Admission check
  SELECT EXISTS (
    SELECT 1 FROM public.admissions
     WHERE patient_id = _patient_id AND status = 'active'
  ) INTO _is_admitted;

  -- Admitted patients: clinical staff always have ownership.
  IF _is_admitted OR _status = 'admitted' THEN
    RETURN _user_role IN ('nurse', 'doctor', 'doctor1', 'doctor2');
  END IF;

  -- CLINICAL OWNERSHIP RULES
  -- 1. Nurse owns when status is 'waiting' (triage) or 'with_nurse' (vitals/triage in progress)
  IF _user_role = 'nurse' AND _status IN ('waiting', 'with_nurse') THEN
    RETURN true;
  END IF;

  -- 2. Doctor owns when status is 'with_doctor'
  IF _user_role IN ('doctor', 'doctor1', 'doctor2') AND _status = 'with_doctor' THEN
    -- If it's doctor1 or doctor2, check assignment
    DECLARE
      _assigned_doc text;
    BEGIN
      SELECT assigned_doctor::text INTO _assigned_doc FROM public.patients WHERE id = _patient_id;
      IF _assigned_doc IS NOT NULL AND _assigned_doc != _user_role::text AND _user_role::text IN ('doctor1', 'doctor2') THEN
        RETURN false; -- Assigned to the other doctor
      END IF;
      RETURN true;
    END;
  END IF;

  -- 3. Multi-order workflow: allow clinical staff to add snaps even if status is 'awaiting_billing'
  -- as long as they were the last ones interacting (nurse or doctor).
  IF _user_role IN ('nurse', 'doctor', 'doctor1', 'doctor2') AND _status = 'awaiting_billing' THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- SOURCE: 20260813114309_a756cd4f-3bef-4cc4-835f-f3f2f5cefe0a.sql statement 1
CREATE OR REPLACE FUNCTION public.can_add_snap_for_patient(_patient_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER

AS $$
DECLARE
  _status text;
  _is_admitted boolean;
  _has_lab_return boolean;
  _has_paid_lab_req boolean;
  _has_paid_rx_req boolean;
  _user_role app_role;
BEGIN
  IF _user_id IS NULL OR _patient_id IS NULL THEN RETURN false; END IF;

  -- Admin always allowed.
  IF public.has_role(_user_id, 'admin'::app_role) THEN RETURN true; END IF;

  -- Get patient status
  SELECT status::text INTO _status FROM public.patients WHERE id = _patient_id;
  IF _status IS NULL THEN RETURN false; END IF;

  -- Get current user role (taking first role found for simplicity in this logic)
  SELECT role INTO _user_role FROM public.user_roles WHERE user_id = _user_id LIMIT 1;

  -- Lab Tech check: if they have a PAID lab request for this patient, they must be allowed to fulfill it.
  IF _user_role = 'lab_tech'::app_role THEN
    SELECT EXISTS (
      SELECT 1 FROM public.snap_orders
       WHERE patient_id = _patient_id
         AND target_station = 'lab'
         AND status = 'paid'
    ) INTO _has_paid_lab_req;
    IF _has_paid_lab_req THEN RETURN true; END IF;
  END IF;

  -- Pharmacist check: if they have a PAID pharmacy request for this patient, they must be allowed to fulfill it.
  IF _user_role = 'pharmacist'::app_role THEN
    SELECT EXISTS (
      SELECT 1 FROM public.snap_orders
       WHERE patient_id = _patient_id
         AND target_station = 'pharmacy'
         AND status = 'paid'
    ) INTO _has_paid_rx_req;
    IF _has_paid_rx_req THEN RETURN true; END IF;
  END IF;

  -- Lab result check: if a lab result was returned to THIS user, they are an owner.
  -- This is a HARD RULE: returned results grant ownership back to sender.
  SELECT EXISTS (
    SELECT 1 FROM public.snap_orders
     WHERE patient_id = _patient_id
       AND order_type = 'lab_result'
       AND status = 'returned'
       AND returned_to = _user_id
  ) INTO _has_lab_return;

  IF _has_lab_return THEN RETURN true; END IF;

  -- Admission check
  SELECT EXISTS (
    SELECT 1 FROM public.admissions
     WHERE patient_id = _patient_id AND status = 'active'
  ) INTO _is_admitted;

  -- Admitted patients: clinical staff always have ownership.
  IF _is_admitted OR _status = 'admitted' THEN
    RETURN _user_role IN ('nurse', 'doctor', 'doctor1', 'doctor2');
  END IF;

  -- CLINICAL OWNERSHIP RULES
  -- 1. Nurse owns when status is 'waiting' (triage) or 'with_nurse' (vitals/triage in progress)
  IF _user_role = 'nurse' AND _status IN ('waiting', 'with_nurse') THEN
    RETURN true;
  END IF;

  -- 2. Doctor owns when status is 'with_doctor'
  IF _user_role IN ('doctor', 'doctor1', 'doctor2') AND _status = 'with_doctor' THEN
    -- If it's doctor1 or doctor2, check assignment
    DECLARE
      _assigned_doc text;
    BEGIN
      SELECT assigned_doctor::text INTO _assigned_doc FROM public.patients WHERE id = _patient_id;
      IF _assigned_doc IS NOT NULL AND _assigned_doc != _user_role::text AND _user_role::text IN ('doctor1', 'doctor2') THEN
        RETURN false; -- Assigned to the other doctor
      END IF;
      RETURN true;
    END;
  END IF;

  -- 3. Multi-order workflow: allow clinical staff to add snaps even if status is 'awaiting_billing'
  -- as long as they were the last ones interacting (nurse or doctor).
  IF _user_role IN ('nurse', 'doctor', 'doctor1', 'doctor2') AND _status = 'awaiting_billing' THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 1
CREATE TABLE public.patient_archive_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  patient_card_number text NOT NULL,
  patient_name text NOT NULL,
  archive_reference text NOT NULL,
  archived_by uuid NOT NULL REFERENCES public.auth_users(id),
  archived_at timestamptz NOT NULL DEFAULT now(),
  visit_count integer NOT NULL DEFAULT 0,
  invoice_count integer NOT NULL DEFAULT 0,
  row_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  attachment_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  archive_manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  case_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'pending_download'
    CHECK (status IN ('pending_download', 'download_confirmed', 'purged')),
  download_confirmed_at timestamptz,
  download_confirmed_by uuid REFERENCES public.auth_users(id),
  purged_at timestamptz,
  purged_by uuid REFERENCES public.auth_users(id),
  CONSTRAINT patient_archive_records_reference_patient_key UNIQUE (archive_reference, patient_id)
);

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 2
CREATE INDEX IF NOT EXISTS patient_archive_records_status_idx
  ON public.patient_archive_records (status, archived_at DESC);

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 3
CREATE INDEX IF NOT EXISTS patient_archive_records_patient_idx
  ON public.patient_archive_records (patient_id, archived_at DESC);

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 4
ALTER TABLE public.patient_archive_records ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 5
CREATE POLICY "Admins can manage patient archive records"
  ON public.patient_archive_records
  FOR ALL
  TO authenticated
  USING (public.has_role(public.hms_current_user_id(), 'admin'::app_role))
  WITH CHECK (public.has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 6
CREATE OR REPLACE FUNCTION public.patient_archive_case_fingerprint(_patient_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER

AS $$
  SELECT md5(concat_ws('|',
    COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id)::text FROM public.visits v WHERE v.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id)::text FROM public.admissions a WHERE a.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id)::text FROM public.invoices i WHERE i.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ii) ORDER BY ii.id)::text FROM public.invoice_items ii WHERE ii.invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = _patient_id)), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ssi) ORDER BY ssi.id)::text FROM public.sponsor_statement_items ssi WHERE ssi.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ic) ORDER BY ic.id)::text FROM public.insurance_claims ic WHERE ic.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(bt) ORDER BY bt.id)::text FROM public.balance_transactions bt WHERE bt.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(br) ORDER BY br.id)::text FROM public.balance_requests br WHERE br.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pr) ORDER BY pr.id)::text FROM public.prescriptions pr WHERE pr.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pi) ORDER BY pi.id)::text FROM public.prescription_items pi WHERE pi.prescription_id IN (SELECT id FROM public.prescriptions WHERE patient_id = _patient_id)), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(lr) ORDER BY lr.id)::text FROM public.lab_requests lr WHERE lr.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(vt) ORDER BY vt.id)::text FROM public.vitals vt WHERE vt.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(so) ORDER BY so.id)::text FROM public.snap_orders so WHERE so.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(sto) ORDER BY sto.id)::text FROM public.standing_orders sto WHERE sto.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(rl) ORDER BY rl.id)::text FROM public.referral_letters rl WHERE rl.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(va) ORDER BY va.id)::text FROM public.visit_attachments va WHERE va.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ea) ORDER BY ea.id)::text FROM public.emr_attachments ea WHERE ea.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ev) ORDER BY ev.id)::text FROM public.eligibility_verifications ev WHERE ev.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pjh) ORDER BY pjh.id)::text FROM public.patient_journey_history pjh WHERE pjh.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pj) ORDER BY pj.id)::text FROM public.patient_journey pj WHERE pj.patient_id = _patient_id), '[]')
  ));
$$;

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 7
CREATE OR REPLACE FUNCTION public.check_archive_eligibility(_patient_ids uuid[])
RETURNS TABLE (
  patient_id uuid,
  patient_card_number text,
  patient_name text,
  is_eligible boolean,
  reasons text[],
  closed_at timestamptz,
  row_counts jsonb,
  attachment_paths jsonb,
  case_fingerprint text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.has_role(public.hms_current_user_id(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can check archive eligibility';
  END IF;

  RETURN QUERY
  WITH requested AS (
    SELECT requested_id
    FROM unnest(COALESCE(_patient_ids, ARRAY[]::uuid[])) AS u(requested_id)
  ), base AS (
    SELECT r.requested_id,
           p.id AS actual_id,
           p.card_number,
           trim(concat_ws(' ', p.first_name, p.last_name)) AS full_name
    FROM requested r
    LEFT JOIN public.patients p ON p.id = r.requested_id
  ), journey_ranked AS (
    SELECT pj.patient_id, pj.current_state,
           row_number() OVER (PARTITION BY pj.patient_id ORDER BY pj.updated_at DESC NULLS LAST, pj.created_at DESC NULLS LAST) AS rn
    FROM public.patient_journey pj
  ), details AS (
    SELECT b.*, j.current_state,
           (SELECT max(v.updated_at) FROM public.visits v WHERE v.patient_id = b.actual_id AND v.status::text = 'settled') AS latest_closed_at,
           jsonb_build_object(
             'visits', (SELECT count(*) FROM public.visits WHERE patient_id = b.actual_id),
             'admissions', (SELECT count(*) FROM public.admissions WHERE patient_id = b.actual_id),
             'invoices', (SELECT count(*) FROM public.invoices WHERE patient_id = b.actual_id),
             'invoice_items', (SELECT count(*) FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = b.actual_id)),
             'prescriptions', (SELECT count(*) FROM public.prescriptions WHERE patient_id = b.actual_id),
             'lab_requests', (SELECT count(*) FROM public.lab_requests WHERE patient_id = b.actual_id),
             'snap_orders', (SELECT count(*) FROM public.snap_orders WHERE patient_id = b.actual_id),
             'referral_letters', (SELECT count(*) FROM public.referral_letters WHERE patient_id = b.actual_id),
             'attachments', (SELECT count(*) FROM public.visit_attachments WHERE patient_id = b.actual_id) + (SELECT count(*) FROM public.emr_attachments WHERE patient_id = b.actual_id)
           ) AS counts,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object('bucket', x.bucket, 'path', x.path, 'source', x.source) ORDER BY x.bucket, x.path, x.source)
             FROM (
               SELECT DISTINCT 'visit-cards'::text AS bucket, so.photo_path AS path, 'snap_orders.photo_path'::text AS source FROM public.snap_orders so WHERE so.patient_id = b.actual_id AND NULLIF(btrim(so.photo_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'visit-cards', va.storage_path, 'visit_attachments.storage_path' FROM public.visit_attachments va WHERE va.patient_id = b.actual_id AND NULLIF(btrim(va.storage_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'visit-cards', a.admission_snap_path, 'admissions.admission_snap_path' FROM public.admissions a WHERE a.patient_id = b.actual_id AND NULLIF(btrim(a.admission_snap_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'visit-cards', ev.reception_snap_path, 'eligibility_verifications.reception_snap_path' FROM public.eligibility_verifications ev WHERE ev.patient_id = b.actual_id AND NULLIF(btrim(ev.reception_snap_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'visit-cards', ev.verification_snap_path, 'eligibility_verifications.verification_snap_path' FROM public.eligibility_verifications ev WHERE ev.patient_id = b.actual_id AND NULLIF(btrim(ev.verification_snap_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'emr-attachments', ea.file_path, 'emr_attachments.file_path' FROM public.emr_attachments ea WHERE ea.patient_id = b.actual_id AND NULLIF(btrim(ea.file_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'emr-attachments', rl.file_path, 'referral_letters.file_path' FROM public.referral_letters rl WHERE rl.patient_id = b.actual_id AND NULLIF(btrim(rl.file_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'external-url', sto.photo_url, 'standing_orders.photo_url' FROM public.standing_orders sto WHERE sto.patient_id = b.actual_id AND NULLIF(btrim(sto.photo_url), '') IS NOT NULL
             ) x
           ), '[]'::jsonb) AS attachments
    FROM base b
    LEFT JOIN journey_ranked j ON j.patient_id = b.actual_id AND j.rn = 1
  ), reasoned AS (
    SELECT d.*, array_remove(ARRAY[
      CASE WHEN d.actual_id IS NULL THEN 'Patient record was not found'::text END,
      CASE WHEN d.actual_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.patient_id = d.actual_id AND v.status::text = 'settled') THEN 'No settled visit exists' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.visits v WHERE v.patient_id = d.actual_id AND v.status::text <> 'settled') THEN 'An active or unsettled visit still exists' END,
      CASE WHEN d.actual_id IS NOT NULL AND COALESCE(d.current_state, '') <> 'discharged' THEN 'Patient journey is not discharged' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.admissions a WHERE a.patient_id = d.actual_id AND a.status IN ('waiting_assignment', 'active', 'ready_for_discharge')) THEN 'An active admission still exists' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.invoices i WHERE i.patient_id = d.actual_id AND i.status::text IN ('pending', 'partial')) THEN 'An unpaid or partially paid invoice exists' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.lab_requests lr WHERE lr.patient_id = d.actual_id AND lr.status::text = 'pending') THEN 'A laboratory request is pending' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.prescriptions pr
        WHERE pr.patient_id = d.actual_id
          AND pr.status::text = 'pending'
          AND (
            SELECT count(*)
            FROM public.prescriptions pr_all
            WHERE pr_all.patient_id = pr.patient_id
              AND pr_all.visit_id = pr.visit_id
          ) > (
            SELECT count(*)
            FROM public.snap_orders so
            WHERE so.patient_id = pr.patient_id
              AND so.visit_id = pr.visit_id
              AND so.order_type::text = 'prescription'
              AND so.status::text = 'fulfilled'
          )
      ) THEN 'A pharmacy prescription is pending' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.snap_orders so WHERE so.patient_id = d.actual_id AND so.status::text = 'awaiting_payment') THEN 'A snap order awaits payment' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.balance_requests br WHERE br.patient_id = d.actual_id AND br.status::text = 'pending') THEN 'A patient balance request is pending' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.standing_orders sto WHERE sto.patient_id = d.actual_id AND COALESCE(sto.status::text, '') NOT IN ('completed', 'cancelled', 'closed', 'returned')) THEN 'A standing order or external referral is unresolved' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.referral_letters rl WHERE rl.patient_id = d.actual_id AND COALESCE(rl.status::text, '') NOT IN ('final', 'completed', 'sent', 'closed', 'cancelled')) THEN 'A referral letter is unfinished' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.insurance_claims ic WHERE ic.patient_id = d.actual_id AND COALESCE(ic.status::text, '') NOT IN ('paid', 'settled', 'closed', 'cancelled', 'rejected', 'denied')) THEN 'An insurance claim remains unresolved' END
    ], NULL) AS reason_list
    FROM details d
  )
  SELECT actual_id, card_number, full_name,
         cardinality(COALESCE(reason_list, ARRAY[]::text[])) = 0,
         COALESCE(reason_list, ARRAY[]::text[]), latest_closed_at, counts, attachments,
         CASE WHEN actual_id IS NULL THEN NULL ELSE public.patient_archive_case_fingerprint(actual_id) END
  FROM reasoned;
END;
$$;

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 8
CREATE OR REPLACE FUNCTION public.prepare_patient_archive(_archive_reference text, _archives jsonb)
RETURNS TABLE (archive_record_id uuid, patient_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reference text := btrim(COALESCE(_archive_reference, ''));
  v_bad integer;
  v_count integer;
BEGIN
  IF NOT public.has_role(public.hms_current_user_id(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can prepare an archive';
  END IF;
  IF v_reference = '' THEN RAISE EXCEPTION 'An archive reference is required'; END IF;
  IF jsonb_typeof(_archives) <> 'array' OR jsonb_array_length(_archives) = 0 THEN
    RAISE EXCEPTION 'At least one patient archive manifest is required';
  END IF;

  SELECT count(*) INTO v_bad
  FROM jsonb_array_elements(_archives) a(value)
  WHERE NULLIF(a.value ->> 'patient_id', '') IS NULL
     OR NULLIF(a.value ->> 'case_fingerprint', '') IS NULL;
  IF v_bad > 0 THEN RAISE EXCEPTION 'Each archive manifest must include patient_id and case_fingerprint'; END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(_archives) a(value)
    CROSS JOIN LATERAL public.check_archive_eligibility(ARRAY[(a.value ->> 'patient_id')::uuid]) e
    WHERE NOT e.is_eligible
       OR e.case_fingerprint IS DISTINCT FROM NULLIF(a.value ->> 'case_fingerprint', '')
  ) THEN
    RAISE EXCEPTION 'One or more patients are no longer eligible or their records changed. Create a new ZIP before continuing.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.patient_archive_records r
    JOIN jsonb_array_elements(_archives) a(value) ON r.patient_id = (a.value ->> 'patient_id')::uuid
    WHERE r.archive_reference = v_reference
  ) THEN
    RAISE EXCEPTION 'Archive reference % already contains one or more selected patients', v_reference;
  END IF;

  INSERT INTO public.patient_archive_records (
    patient_id, patient_card_number, patient_name, archive_reference, archived_by,
    visit_count, invoice_count, row_counts, attachment_paths, archive_manifest,
    case_fingerprint, status
  )
  SELECT e.patient_id, e.patient_card_number, e.patient_name, v_reference,
         public.hms_current_user_id(),
         COALESCE((e.row_counts ->> 'visits')::integer, 0),
         COALESCE((e.row_counts ->> 'invoices')::integer, 0),
         e.row_counts, e.attachment_paths, a.value -> 'manifest', e.case_fingerprint,
         'pending_download'
  FROM jsonb_array_elements(_archives) a(value)
  CROSS JOIN LATERAL public.check_archive_eligibility(ARRAY[(a.value ->> 'patient_id')::uuid]) e;

  SELECT count(*) INTO v_count
  FROM public.patient_archive_records
  WHERE archive_reference = v_reference AND archived_by = public.hms_current_user_id();
  SELECT public.write_audit_log('prepare_patient_archive', 'patient_archive_records', v_reference, jsonb_build_object('patient_count', v_count), 'success');
  RETURN QUERY SELECT r.id, r.patient_id FROM public.patient_archive_records r WHERE r.archive_reference = v_reference AND r.archived_by = public.hms_current_user_id();
END;
$$;

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 9
CREATE OR REPLACE FUNCTION public.confirm_archive_download(_archive_reference text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  v_reference text := btrim(COALESCE(_archive_reference, ''));
  v_updated integer;
BEGIN
  IF NOT public.has_role(public.hms_current_user_id(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can confirm an archive download';
  END IF;

  IF v_reference = '' THEN
    RAISE EXCEPTION 'An archive reference is required';
  END IF;

  UPDATE public.patient_archive_records
  SET status = 'download_confirmed',
      download_confirmed_at = now(),
      download_confirmed_by = public.hms_current_user_id()
  WHERE archive_reference = v_reference
    AND status = 'pending_download';

  SELECT count(*) INTO v_updated FROM public.patient_archive_records WHERE archive_reference = v_reference AND status = 'pending_download';

  IF v_updated = 0 THEN
    RAISE EXCEPTION 'No pending archive records were found for reference %', v_reference;
  END IF;

  SELECT public.write_audit_log(
    'confirm_archive_download',
    'patient_archive_records',
    v_reference,
    jsonb_build_object('patient_count', v_updated),
    'success'
  );

  RETURN v_updated;
END;
$$;

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 10
CREATE OR REPLACE FUNCTION public.purge_archived_cases(_patient_ids uuid[], _archive_reference text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reference text := btrim(COALESCE(_archive_reference, ''));
  v_statement_ids uuid[];
  v_purged_count integer;
BEGIN
  IF NOT public.has_role(public.hms_current_user_id(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can purge verified archives';
  END IF;
  IF v_reference = '' OR COALESCE(array_length(_patient_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Archive reference and at least one patient are required';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(_patient_ids) AS x) <> array_length(_patient_ids, 1) THEN
    RAISE EXCEPTION 'Duplicate patient identifiers are not allowed';
  END IF;
  IF (SELECT count(*) FROM public.patient_archive_records r WHERE r.archive_reference = v_reference AND r.patient_id = ANY(_patient_ids) AND r.status = 'download_confirmed') <> array_length(_patient_ids, 1) THEN
    RAISE EXCEPTION 'Every selected patient must have a download-confirmed archive with this reference';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(_patient_ids) AS ids(patient_id)
    LEFT JOIN public.patient_archive_records r ON r.archive_reference = v_reference AND r.patient_id = ids.patient_id AND r.status = 'download_confirmed'
    LEFT JOIN LATERAL public.check_archive_eligibility(ARRAY[ids.patient_id]) e ON true
    WHERE r.id IS NULL OR NOT e.is_eligible OR e.case_fingerprint IS DISTINCT FROM r.case_fingerprint
  ) THEN
    RAISE EXCEPTION 'One or more patients changed after archive preparation. Prepare and verify a new ZIP before purge.';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT ssi.statement_id), ARRAY[]::uuid[]) INTO v_statement_ids
  FROM public.sponsor_statement_items ssi WHERE ssi.patient_id = ANY(_patient_ids);

  DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = ANY(_patient_ids));
  DELETE FROM public.sponsor_statement_items WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.insurance_claims WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.balance_transactions WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.balance_requests WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.corporate_transactions ct WHERE ct.related_statement_id = ANY(v_statement_ids) AND NOT EXISTS (SELECT 1 FROM public.sponsor_statement_items remaining WHERE remaining.statement_id = ct.related_statement_id);
  DELETE FROM public.sponsor_statements ss WHERE ss.id = ANY(v_statement_ids) AND NOT EXISTS (SELECT 1 FROM public.sponsor_statement_items remaining WHERE remaining.statement_id = ss.id);
  DELETE FROM public.invoices WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.prescription_items WHERE prescription_id IN (SELECT id FROM public.prescriptions WHERE patient_id = ANY(_patient_ids));
  DELETE FROM public.prescriptions WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.lab_requests WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.vitals WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.snap_orders WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.standing_orders WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.referral_letters WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.visit_attachments WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.emr_attachments WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.eligibility_verifications WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.patient_journey_history WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.patient_journey WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.admissions WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.visits WHERE patient_id = ANY(_patient_ids);

  UPDATE public.patients SET status = 'registered', last_visit = NULL, updated_at = now() WHERE id = ANY(_patient_ids);
  UPDATE public.patient_archive_records SET status = 'purged', purged_at = now(), purged_by = public.hms_current_user_id() WHERE archive_reference = v_reference AND patient_id = ANY(_patient_ids) AND status = 'download_confirmed';
  SELECT count(*) INTO v_purged_count FROM public.patient_archive_records WHERE archive_reference = v_reference AND patient_id = ANY(_patient_ids) AND status = 'purged';
  SELECT public.write_audit_log('purge_archived_cases', 'patient_archive_records', v_reference, jsonb_build_object('patient_ids', _patient_ids, 'patient_count', v_purged_count), 'success');
  RETURN v_purged_count;
END;
$$;

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 11
REVOKE ALL ON FUNCTION public.patient_archive_case_fingerprint(uuid) FROM PUBLIC;

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 12
GRANT EXECUTE ON FUNCTION public.check_archive_eligibility(uuid[]) TO authenticated;

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 13
GRANT EXECUTE ON FUNCTION public.prepare_patient_archive(text, jsonb) TO authenticated;

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 14
GRANT EXECUTE ON FUNCTION public.confirm_archive_download(text) TO authenticated;

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 15
GRANT EXECUTE ON FUNCTION public.purge_archived_cases(uuid[], text) TO authenticated;

-- SOURCE: 20260813150100_archive_eligibility_name_resolution.sql statement 1
CREATE OR REPLACE FUNCTION public.check_archive_eligibility(_patient_ids uuid[])
RETURNS TABLE (
  patient_id uuid,
  patient_card_number text,
  patient_name text,
  is_eligible boolean,
  reasons text[],
  closed_at timestamptz,
  row_counts jsonb,
  attachment_paths jsonb,
  case_fingerprint text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.has_role(public.hms_current_user_id(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can check archive eligibility';
  END IF;

  RETURN QUERY
  WITH requested AS (
    SELECT requested_id
    FROM unnest(COALESCE(_patient_ids, ARRAY[]::uuid[])) AS u(requested_id)
  ), base AS (
    SELECT r.requested_id,
           p.id AS actual_id,
           p.card_number,
           trim(concat_ws(' ', p.first_name, p.last_name)) AS full_name
    FROM requested r
    LEFT JOIN public.patients p ON p.id = r.requested_id
  ), journey_ranked AS (
    SELECT pj.patient_id, pj.current_state,
           row_number() OVER (PARTITION BY pj.patient_id ORDER BY pj.updated_at DESC NULLS LAST, pj.created_at DESC NULLS LAST) AS rn
    FROM public.patient_journey pj
  ), details AS (
    SELECT b.*, j.current_state,
           (SELECT max(v.updated_at) FROM public.visits v WHERE v.patient_id = b.actual_id AND v.status::text = 'settled') AS latest_closed_at,
           jsonb_build_object(
             'visits', (SELECT count(*) FROM public.visits WHERE patient_id = b.actual_id),
             'admissions', (SELECT count(*) FROM public.admissions WHERE patient_id = b.actual_id),
             'invoices', (SELECT count(*) FROM public.invoices WHERE patient_id = b.actual_id),
             'invoice_items', (SELECT count(*) FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = b.actual_id)),
             'prescriptions', (SELECT count(*) FROM public.prescriptions WHERE patient_id = b.actual_id),
             'lab_requests', (SELECT count(*) FROM public.lab_requests WHERE patient_id = b.actual_id),
             'snap_orders', (SELECT count(*) FROM public.snap_orders WHERE patient_id = b.actual_id),
             'referral_letters', (SELECT count(*) FROM public.referral_letters WHERE patient_id = b.actual_id),
             'attachments', (SELECT count(*) FROM public.visit_attachments WHERE patient_id = b.actual_id) + (SELECT count(*) FROM public.emr_attachments WHERE patient_id = b.actual_id)
           ) AS counts,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object('bucket', x.bucket, 'path', x.path, 'source', x.source) ORDER BY x.bucket, x.path, x.source)
             FROM (
               SELECT DISTINCT 'visit-cards'::text AS bucket, so.photo_path AS path, 'snap_orders.photo_path'::text AS source FROM public.snap_orders so WHERE so.patient_id = b.actual_id AND NULLIF(btrim(so.photo_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'visit-cards', va.storage_path, 'visit_attachments.storage_path' FROM public.visit_attachments va WHERE va.patient_id = b.actual_id AND NULLIF(btrim(va.storage_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'visit-cards', a.admission_snap_path, 'admissions.admission_snap_path' FROM public.admissions a WHERE a.patient_id = b.actual_id AND NULLIF(btrim(a.admission_snap_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'visit-cards', ev.reception_snap_path, 'eligibility_verifications.reception_snap_path' FROM public.eligibility_verifications ev WHERE ev.patient_id = b.actual_id AND NULLIF(btrim(ev.reception_snap_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'visit-cards', ev.verification_snap_path, 'eligibility_verifications.verification_snap_path' FROM public.eligibility_verifications ev WHERE ev.patient_id = b.actual_id AND NULLIF(btrim(ev.verification_snap_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'emr-attachments', ea.file_path, 'emr_attachments.file_path' FROM public.emr_attachments ea WHERE ea.patient_id = b.actual_id AND NULLIF(btrim(ea.file_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'emr-attachments', rl.file_path, 'referral_letters.file_path' FROM public.referral_letters rl WHERE rl.patient_id = b.actual_id AND NULLIF(btrim(rl.file_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'external-url', sto.photo_url, 'standing_orders.photo_url' FROM public.standing_orders sto WHERE sto.patient_id = b.actual_id AND NULLIF(btrim(sto.photo_url), '') IS NOT NULL
             ) x
           ), '[]'::jsonb) AS attachments
    FROM base b
    LEFT JOIN journey_ranked j ON j.patient_id = b.actual_id AND j.rn = 1
  ), reasoned AS (
    SELECT d.*, array_remove(ARRAY[
      CASE WHEN d.actual_id IS NULL THEN 'Patient record was not found'::text END,
      CASE WHEN d.actual_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.patient_id = d.actual_id AND v.status::text = 'settled') THEN 'No settled visit exists' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.visits v WHERE v.patient_id = d.actual_id AND v.status::text <> 'settled') THEN 'An active or unsettled visit still exists' END,
      CASE WHEN d.actual_id IS NOT NULL AND COALESCE(d.current_state, '') <> 'discharged' THEN 'Patient journey is not discharged' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.admissions a WHERE a.patient_id = d.actual_id AND a.status IN ('waiting_assignment', 'active', 'ready_for_discharge')) THEN 'An active admission still exists' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.invoices i WHERE i.patient_id = d.actual_id AND i.status::text IN ('pending', 'partial')) THEN 'An unpaid or partially paid invoice exists' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.lab_requests lr WHERE lr.patient_id = d.actual_id AND lr.status::text = 'pending') THEN 'A laboratory request is pending' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.prescriptions pr
        WHERE pr.patient_id = d.actual_id
          AND pr.status::text = 'pending'
          AND (
            SELECT count(*)
            FROM public.prescriptions pr_all
            WHERE pr_all.patient_id = pr.patient_id
              AND pr_all.visit_id = pr.visit_id
          ) > (
            SELECT count(*)
            FROM public.snap_orders so
            WHERE so.patient_id = pr.patient_id
              AND so.visit_id = pr.visit_id
              AND so.order_type::text = 'prescription'
              AND so.status::text = 'fulfilled'
          )
      ) THEN 'A pharmacy prescription is pending' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.snap_orders so WHERE so.patient_id = d.actual_id AND so.status::text = 'awaiting_payment') THEN 'A snap order awaits payment' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.balance_requests br WHERE br.patient_id = d.actual_id AND br.status::text = 'pending') THEN 'A patient balance request is pending' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.standing_orders sto WHERE sto.patient_id = d.actual_id AND COALESCE(sto.status::text, '') NOT IN ('completed', 'cancelled', 'closed', 'returned')) THEN 'A standing order or external referral is unresolved' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.referral_letters rl WHERE rl.patient_id = d.actual_id AND COALESCE(rl.status::text, '') NOT IN ('final', 'completed', 'sent', 'closed', 'cancelled')) THEN 'A referral letter is unfinished' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.insurance_claims ic WHERE ic.patient_id = d.actual_id AND COALESCE(ic.status::text, '') NOT IN ('paid', 'settled', 'closed', 'cancelled', 'rejected', 'denied')) THEN 'An insurance claim remains unresolved' END
    ], NULL) AS reason_list
    FROM details d
  )
  SELECT actual_id, card_number, full_name,
         cardinality(COALESCE(reason_list, ARRAY[]::text[])) = 0,
         COALESCE(reason_list, ARRAY[]::text[]), latest_closed_at, counts, attachments,
         CASE WHEN actual_id IS NULL THEN NULL ELSE public.patient_archive_case_fingerprint(actual_id) END
  FROM reasoned;
END;
$$;

-- SOURCE: 20260813223000_archive_balance_retention_and_immediate_eligibility.sql statement 1
CREATE OR REPLACE FUNCTION public.check_archive_eligibility(_patient_ids uuid[])
RETURNS TABLE (
  patient_id uuid,
  patient_card_number text,
  patient_name text,
  is_eligible boolean,
  reasons text[],
  closed_at timestamptz,
  row_counts jsonb,
  attachment_paths jsonb,
  case_fingerprint text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.has_role(public.hms_current_user_id(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can check archive eligibility';
  END IF;

  RETURN QUERY
  WITH requested AS (
    SELECT requested_id
    FROM unnest(COALESCE(_patient_ids, ARRAY[]::uuid[])) AS u(requested_id)
  ), base AS (
    SELECT r.requested_id,
           p.id AS actual_id,
           p.card_number,
           trim(concat_ws(' ', p.first_name, p.last_name)) AS full_name
    FROM requested r
    LEFT JOIN public.patients p ON p.id = r.requested_id
  ), journey_ranked AS (
    SELECT pj.patient_id, pj.current_state,
           row_number() OVER (PARTITION BY pj.patient_id ORDER BY pj.updated_at DESC NULLS LAST, pj.created_at DESC NULLS LAST) AS rn
    FROM public.patient_journey pj
  ), details AS (
    SELECT b.*, j.current_state,
           (SELECT max(v.updated_at) FROM public.visits v WHERE v.patient_id = b.actual_id AND v.status::text = 'settled') AS latest_closed_at,
           jsonb_build_object(
             'visits', (SELECT count(*) FROM public.visits WHERE patient_id = b.actual_id),
             'admissions', (SELECT count(*) FROM public.admissions WHERE patient_id = b.actual_id),
             'invoices', (SELECT count(*) FROM public.invoices WHERE patient_id = b.actual_id),
             'invoice_items', (SELECT count(*) FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = b.actual_id)),
             'prescriptions', (SELECT count(*) FROM public.prescriptions WHERE patient_id = b.actual_id),
             'lab_requests', (SELECT count(*) FROM public.lab_requests WHERE patient_id = b.actual_id),
             'snap_orders', (SELECT count(*) FROM public.snap_orders WHERE patient_id = b.actual_id),
             'referral_letters', (SELECT count(*) FROM public.referral_letters WHERE patient_id = b.actual_id),
             'attachments', (SELECT count(*) FROM public.visit_attachments WHERE patient_id = b.actual_id) + (SELECT count(*) FROM public.emr_attachments WHERE patient_id = b.actual_id)
           ) AS counts,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object('bucket', x.bucket, 'path', x.path, 'source', x.source) ORDER BY x.bucket, x.path, x.source)
             FROM (
               SELECT DISTINCT 'visit-cards'::text AS bucket, so.photo_path AS path, 'snap_orders.photo_path'::text AS source FROM public.snap_orders so WHERE so.patient_id = b.actual_id AND NULLIF(btrim(so.photo_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'visit-cards', va.storage_path, 'visit_attachments.storage_path' FROM public.visit_attachments va WHERE va.patient_id = b.actual_id AND NULLIF(btrim(va.storage_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'visit-cards', a.admission_snap_path, 'admissions.admission_snap_path' FROM public.admissions a WHERE a.patient_id = b.actual_id AND NULLIF(btrim(a.admission_snap_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'visit-cards', ev.reception_snap_path, 'eligibility_verifications.reception_snap_path' FROM public.eligibility_verifications ev WHERE ev.patient_id = b.actual_id AND NULLIF(btrim(ev.reception_snap_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'visit-cards', ev.verification_snap_path, 'eligibility_verifications.verification_snap_path' FROM public.eligibility_verifications ev WHERE ev.patient_id = b.actual_id AND NULLIF(btrim(ev.verification_snap_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'emr-attachments', ea.file_path, 'emr_attachments.file_path' FROM public.emr_attachments ea WHERE ea.patient_id = b.actual_id AND NULLIF(btrim(ea.file_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'emr-attachments', rl.file_path, 'referral_letters.file_path' FROM public.referral_letters rl WHERE rl.patient_id = b.actual_id AND NULLIF(btrim(rl.file_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'external-url', sto.photo_url, 'standing_orders.photo_url' FROM public.standing_orders sto WHERE sto.patient_id = b.actual_id AND NULLIF(btrim(sto.photo_url), '') IS NOT NULL
             ) x
           ), '[]'::jsonb) AS attachments
    FROM base b
    LEFT JOIN journey_ranked j ON j.patient_id = b.actual_id AND j.rn = 1
  ), reasoned AS (
    SELECT d.*, array_remove(ARRAY[
      CASE WHEN d.actual_id IS NULL THEN 'Patient record was not found'::text END,
      CASE WHEN d.actual_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.patient_id = d.actual_id AND v.status::text = 'settled') THEN 'No settled visit exists' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.visits v WHERE v.patient_id = d.actual_id AND v.status::text <> 'settled') THEN 'An active or unsettled visit still exists' END,
      CASE WHEN d.actual_id IS NOT NULL AND COALESCE(d.current_state, '') <> 'discharged' THEN 'Patient journey is not discharged' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.admissions a WHERE a.patient_id = d.actual_id AND a.status IN ('waiting_assignment', 'active', 'ready_for_discharge')) THEN 'An active admission still exists' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.invoices i WHERE i.patient_id = d.actual_id AND i.status::text IN ('pending', 'partial')) THEN 'An unpaid or partially paid invoice exists' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.lab_requests lr WHERE lr.patient_id = d.actual_id AND lr.status::text = 'pending') THEN 'A laboratory request is pending' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.prescriptions pr
        WHERE pr.patient_id = d.actual_id
          AND pr.status::text = 'pending'
          AND (
            SELECT count(*)
            FROM public.prescriptions pr_all
            WHERE pr_all.patient_id = pr.patient_id
              AND pr_all.visit_id = pr.visit_id
          ) > (
            SELECT count(*)
            FROM public.snap_orders so
            WHERE so.patient_id = pr.patient_id
              AND so.visit_id = pr.visit_id
              AND so.order_type::text = 'prescription'
              AND so.status::text = 'fulfilled'
          )
      ) THEN 'A pharmacy prescription is pending' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.snap_orders so WHERE so.patient_id = d.actual_id AND so.status::text = 'awaiting_payment') THEN 'A snap order awaits payment' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.balance_requests br WHERE br.patient_id = d.actual_id AND br.status::text = 'pending') THEN 'A patient balance request is pending' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.standing_orders sto WHERE sto.patient_id = d.actual_id AND COALESCE(sto.status::text, '') NOT IN ('completed', 'cancelled', 'closed', 'returned')) THEN 'A standing order or external referral is unresolved' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.referral_letters rl WHERE rl.patient_id = d.actual_id AND COALESCE(rl.status::text, '') NOT IN ('final', 'completed', 'sent', 'closed', 'cancelled')) THEN 'A referral letter is unfinished' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.insurance_claims ic WHERE ic.patient_id = d.actual_id AND COALESCE(ic.status::text, '') NOT IN ('paid', 'settled', 'closed', 'cancelled', 'rejected', 'denied')) THEN 'An insurance claim remains unresolved' END
    ], NULL) AS reason_list
    FROM details d
  )
  SELECT actual_id, card_number, full_name,
         cardinality(COALESCE(reason_list, ARRAY[]::text[])) = 0,
         COALESCE(reason_list, ARRAY[]::text[]), latest_closed_at, counts, attachments,
         CASE WHEN actual_id IS NULL THEN NULL ELSE public.patient_archive_case_fingerprint(actual_id) END
  FROM reasoned;
END;
$$;

-- SOURCE: 20260813223000_archive_balance_retention_and_immediate_eligibility.sql statement 2
CREATE OR REPLACE FUNCTION public.purge_archived_cases(_patient_ids uuid[], _archive_reference text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reference text := btrim(COALESCE(_archive_reference, ''));
  v_statement_ids uuid[];
  v_purged_count integer;
BEGIN
  IF NOT public.has_role(public.hms_current_user_id(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can purge verified archives';
  END IF;
  IF v_reference = '' OR COALESCE(array_length(_patient_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Archive reference and at least one patient are required';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(_patient_ids) AS x) <> array_length(_patient_ids, 1) THEN
    RAISE EXCEPTION 'Duplicate patient identifiers are not allowed';
  END IF;
  IF (SELECT count(*) FROM public.patient_archive_records r WHERE r.archive_reference = v_reference AND r.patient_id = ANY(_patient_ids) AND r.status = 'download_confirmed') <> array_length(_patient_ids, 1) THEN
    RAISE EXCEPTION 'Every selected patient must have a download-confirmed archive with this reference';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(_patient_ids) AS ids(patient_id)
    LEFT JOIN public.patient_archive_records r ON r.archive_reference = v_reference AND r.patient_id = ids.patient_id AND r.status = 'download_confirmed'
    LEFT JOIN LATERAL public.check_archive_eligibility(ARRAY[ids.patient_id]) e ON true
    WHERE r.id IS NULL OR NOT e.is_eligible OR e.case_fingerprint IS DISTINCT FROM r.case_fingerprint
  ) THEN
    RAISE EXCEPTION 'One or more patients changed after archive preparation. Prepare and verify a new ZIP before purge.';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT ssi.statement_id), ARRAY[]::uuid[]) INTO v_statement_ids
  FROM public.sponsor_statement_items ssi WHERE ssi.patient_id = ANY(_patient_ids);

  DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = ANY(_patient_ids));
  DELETE FROM public.sponsor_statement_items WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.insurance_claims WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.balance_transactions WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.balance_requests WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.corporate_transactions ct WHERE ct.related_statement_id = ANY(v_statement_ids) AND NOT EXISTS (SELECT 1 FROM public.sponsor_statement_items remaining WHERE remaining.statement_id = ct.related_statement_id);
  DELETE FROM public.sponsor_statements ss WHERE ss.id = ANY(v_statement_ids) AND NOT EXISTS (SELECT 1 FROM public.sponsor_statement_items remaining WHERE remaining.statement_id = ss.id);
  DELETE FROM public.invoices WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.prescription_items WHERE prescription_id IN (SELECT id FROM public.prescriptions WHERE patient_id = ANY(_patient_ids));
  DELETE FROM public.prescriptions WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.lab_requests WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.vitals WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.snap_orders WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.standing_orders WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.referral_letters WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.visit_attachments WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.emr_attachments WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.eligibility_verifications WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.patient_journey_history WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.patient_journey WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.admissions WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.visits WHERE patient_id = ANY(_patient_ids);

  UPDATE public.patients SET status = 'registered', last_visit = NULL, updated_at = now() WHERE id = ANY(_patient_ids);
  UPDATE public.patient_archive_records SET status = 'purged', purged_at = now(), purged_by = public.hms_current_user_id() WHERE archive_reference = v_reference AND patient_id = ANY(_patient_ids) AND status = 'download_confirmed';
  SELECT count(*) INTO v_purged_count FROM public.patient_archive_records WHERE archive_reference = v_reference AND patient_id = ANY(_patient_ids) AND status = 'purged';
  SELECT public.write_audit_log('purge_archived_cases', 'patient_archive_records', v_reference, jsonb_build_object('patient_ids', _patient_ids, 'patient_count', v_purged_count), 'success');
  RETURN v_purged_count;
END;
$$;

-- SOURCE: 20260813223000_archive_balance_retention_and_immediate_eligibility.sql statement 3
GRANT EXECUTE ON FUNCTION public.check_archive_eligibility(uuid[]) TO authenticated;

-- SOURCE: 20260813223000_archive_balance_retention_and_immediate_eligibility.sql statement 4
GRANT EXECUTE ON FUNCTION public.purge_archived_cases(uuid[], text) TO authenticated;

-- SOURCE: 20260814103000_archive_storage_savings_reporting.sql statement 1
ALTER TABLE public.patient_archive_records
  ADD COLUMN IF NOT EXISTS database_payload_bytes bigint NOT NULL DEFAULT 0 CHECK (database_payload_bytes >= 0),
  ADD COLUMN IF NOT EXISTS database_rows_cleared jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS r2_object_bytes bigint NOT NULL DEFAULT 0 CHECK (r2_object_bytes >= 0),
  ADD COLUMN IF NOT EXISTS r2_deleted_bytes bigint NOT NULL DEFAULT 0 CHECK (r2_deleted_bytes >= 0),
  ADD COLUMN IF NOT EXISTS r2_deleted_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS r2_cleanup_status text NOT NULL DEFAULT 'not_started'
    CHECK (r2_cleanup_status IN ('not_started', 'partial', 'completed'));

-- SOURCE: 20260814103000_archive_storage_savings_reporting.sql statement 2
CREATE OR REPLACE FUNCTION public.patient_archive_storage_snapshot(_patient_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER

AS $$
DECLARE
  v_row_counts jsonb;
  v_payload_bytes bigint;
BEGIN
  SELECT jsonb_build_object(
    'invoice_items', (SELECT count(*) FROM public.invoice_items ii WHERE ii.invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = _patient_id)),
    'sponsor_statement_items', (SELECT count(*) FROM public.sponsor_statement_items WHERE patient_id = _patient_id),
    'insurance_claims', (SELECT count(*) FROM public.insurance_claims WHERE patient_id = _patient_id),
    'balance_transactions', (SELECT count(*) FROM public.balance_transactions WHERE patient_id = _patient_id),
    'balance_requests', (SELECT count(*) FROM public.balance_requests WHERE patient_id = _patient_id),
    'invoices', (SELECT count(*) FROM public.invoices WHERE patient_id = _patient_id),
    'prescription_items', (SELECT count(*) FROM public.prescription_items pi WHERE pi.prescription_id IN (SELECT id FROM public.prescriptions WHERE patient_id = _patient_id)),
    'prescriptions', (SELECT count(*) FROM public.prescriptions WHERE patient_id = _patient_id),
    'lab_requests', (SELECT count(*) FROM public.lab_requests WHERE patient_id = _patient_id),
    'vitals', (SELECT count(*) FROM public.vitals WHERE patient_id = _patient_id),
    'snap_orders', (SELECT count(*) FROM public.snap_orders WHERE patient_id = _patient_id),
    'standing_orders', (SELECT count(*) FROM public.standing_orders WHERE patient_id = _patient_id),
    'referral_letters', (SELECT count(*) FROM public.referral_letters WHERE patient_id = _patient_id),
    'visit_attachments', (SELECT count(*) FROM public.visit_attachments WHERE patient_id = _patient_id),
    'emr_attachments', (SELECT count(*) FROM public.emr_attachments WHERE patient_id = _patient_id),
    'eligibility_verifications', (SELECT count(*) FROM public.eligibility_verifications WHERE patient_id = _patient_id),
    'patient_journey_history', (SELECT count(*) FROM public.patient_journey_history WHERE patient_id = _patient_id),
    'patient_journey', (SELECT count(*) FROM public.patient_journey WHERE patient_id = _patient_id),
    'admissions', (SELECT count(*) FROM public.admissions WHERE patient_id = _patient_id),
    'visits', (SELECT count(*) FROM public.visits WHERE patient_id = _patient_id)
  ) INTO v_row_counts;

  SELECT COALESCE(sum(payload_bytes), 0)::bigint INTO v_payload_bytes
  FROM (
    SELECT pg_column_size(ii)::bigint AS payload_bytes FROM public.invoice_items ii WHERE ii.invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = _patient_id)
    UNION ALL SELECT pg_column_size(ssi)::bigint FROM public.sponsor_statement_items ssi WHERE ssi.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(ic)::bigint FROM public.insurance_claims ic WHERE ic.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(bt)::bigint FROM public.balance_transactions bt WHERE bt.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(br)::bigint FROM public.balance_requests br WHERE br.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(i)::bigint FROM public.invoices i WHERE i.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(pi)::bigint FROM public.prescription_items pi WHERE pi.prescription_id IN (SELECT id FROM public.prescriptions WHERE patient_id = _patient_id)
    UNION ALL SELECT pg_column_size(pr)::bigint FROM public.prescriptions pr WHERE pr.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(lr)::bigint FROM public.lab_requests lr WHERE lr.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(vt)::bigint FROM public.vitals vt WHERE vt.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(so)::bigint FROM public.snap_orders so WHERE so.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(sto)::bigint FROM public.standing_orders sto WHERE sto.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(rl)::bigint FROM public.referral_letters rl WHERE rl.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(va)::bigint FROM public.visit_attachments va WHERE va.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(ea)::bigint FROM public.emr_attachments ea WHERE ea.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(ev)::bigint FROM public.eligibility_verifications ev WHERE ev.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(pjh)::bigint FROM public.patient_journey_history pjh WHERE pjh.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(pj)::bigint FROM public.patient_journey pj WHERE pj.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(a)::bigint FROM public.admissions a WHERE a.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(v)::bigint FROM public.visits v WHERE v.patient_id = _patient_id
  ) payload;

  RETURN jsonb_build_object(
    'row_counts', v_row_counts,
    'database_payload_bytes', v_payload_bytes
  );
END;
$$;

-- SOURCE: 20260814103000_archive_storage_savings_reporting.sql statement 3
CREATE OR REPLACE FUNCTION public.record_archive_storage_measurement(_archive_reference text)
RETURNS TABLE (
  patient_id uuid,
  r2_object_bytes bigint,
  database_payload_bytes bigint,
  database_rows_cleared jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  v_reference text := btrim(COALESCE(_archive_reference, ''));
  v_updated integer;
BEGIN
  IF NOT public.has_role(public.hms_current_user_id(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can record archive storage measurements';
  END IF;

  IF v_reference = '' THEN
    RAISE EXCEPTION 'An archive reference is required';
  END IF;

  RETURN QUERY
  WITH snapshots AS (
    SELECT
      r.id,
      public.patient_archive_storage_snapshot(r.patient_id) AS snapshot,
      COALESCE((
        SELECT sum(file_bytes)::bigint
        FROM (
          SELECT max(COALESCE(NULLIF(file ->> 'bytes', '')::bigint, 0)) AS file_bytes
          FROM jsonb_array_elements(COALESCE(r.archive_manifest -> 'files', '[]'::jsonb)) file
          WHERE file ->> 'kind' = 'original_attachment'
            AND COALESCE(file ->> 'bucket', '') <> 'external-url'
            AND NULLIF(file ->> 'bucket', '') IS NOT NULL
            AND NULLIF(file ->> 'original_path', '') IS NOT NULL
          GROUP BY file ->> 'bucket', file ->> 'original_path'
        ) unique_r2_objects
      ), 0)::bigint AS measured_r2_bytes
    FROM public.patient_archive_records r
    WHERE r.archive_reference = v_reference
      AND r.status = 'pending_download'
  )
  UPDATE public.patient_archive_records r
  SET r2_object_bytes = s.measured_r2_bytes,
      database_payload_bytes = COALESCE((s.snapshot ->> 'database_payload_bytes')::bigint, 0),
      database_rows_cleared = COALESCE(s.snapshot -> 'row_counts', '{}'::jsonb)
  FROM snapshots s
  WHERE r.id = s.id
  RETURNING r.patient_id, r.r2_object_bytes, r.database_payload_bytes, r.database_rows_cleared;

  SELECT count(*) INTO v_updated FROM public.patient_archive_records WHERE archive_reference = v_reference AND status = 'pending_download';
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'No pending archive records were found for reference %', v_reference;
  END IF;

  SELECT public.write_audit_log(
    'record_archive_storage_measurement',
    'patient_archive_records',
    v_reference,
    jsonb_build_object('patient_count', v_updated),
    'success'
  );
END;
$$;

-- SOURCE: 20260814103000_archive_storage_savings_reporting.sql statement 4
CREATE OR REPLACE FUNCTION public.record_archive_r2_cleanup(_archive_reference text, _deleted_objects jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reference text := btrim(COALESCE(_archive_reference, ''));
  v_updated integer;
BEGIN
  IF NOT public.has_role(public.hms_current_user_id(), 'admin'::app_role) THEN RAISE EXCEPTION 'Only administrators can record R2 archive cleanup'; END IF;
  IF v_reference = '' THEN RAISE EXCEPTION 'An archive reference is required'; END IF;
  IF jsonb_typeof(_deleted_objects) <> 'array' THEN RAISE EXCEPTION 'Deleted R2 objects must be supplied as an array'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patient_archive_records WHERE archive_reference = v_reference AND status = 'purged') THEN
    RAISE EXCEPTION 'No purged archive records were found for reference %', v_reference;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.patient_archive_records r
    CROSS JOIN LATERAL jsonb_array_elements(_deleted_objects) o(value)
    WHERE r.archive_reference = v_reference AND r.status = 'purged'
      AND o.value ->> 'patient_id' = r.patient_id::text
      AND NULLIF(o.value ->> 'bucket', '') IS NOT NULL
      AND NULLIF(o.value ->> 'path', '') IS NOT NULL
      AND o.value ->> 'bucket' <> 'external-url'
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(r.attachment_paths, '[]'::jsonb)) e(value)
        WHERE e.value ->> 'bucket' = o.value ->> 'bucket' AND e.value ->> 'path' = o.value ->> 'path'
      )
  ) THEN
    RAISE EXCEPTION 'R2 cleanup objects do not match the verified archive record';
  END IF;

  WITH incoming AS (
    SELECT r.id,
           COALESCE(jsonb_agg(jsonb_build_object('bucket', o.value ->> 'bucket', 'path', o.value ->> 'path')) FILTER (WHERE o.value ->> 'patient_id' = r.patient_id::text AND NULLIF(o.value ->> 'bucket', '') IS NOT NULL AND NULLIF(o.value ->> 'path', '') IS NOT NULL), '[]'::jsonb) AS paths
    FROM public.patient_archive_records r
    LEFT JOIN LATERAL jsonb_array_elements(_deleted_objects) o(value) ON true
    WHERE r.archive_reference = v_reference AND r.status = 'purged'
    GROUP BY r.id
  ), merged AS (
    SELECT i.id,
           COALESCE((SELECT jsonb_agg(q.path) FROM (
             SELECT p AS path FROM jsonb_array_elements(COALESCE(r.r2_deleted_paths, '[]'::jsonb)) p
             UNION ALL SELECT p AS path FROM jsonb_array_elements(i.paths) p
           ) q), '[]'::jsonb) AS paths
    FROM incoming i JOIN public.patient_archive_records r ON r.id = i.id
  ), measured AS (
    SELECT m.id, m.paths,
           COALESCE((SELECT sum(bytes)::bigint FROM (
             SELECT max(COALESCE(NULLIF(f.value ->> 'bytes', '')::bigint, 0)) AS bytes
             FROM public.patient_archive_records r
             CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.archive_manifest -> 'files', '[]'::jsonb)) f(value)
             CROSS JOIN LATERAL jsonb_array_elements(m.paths) p(value)
             WHERE r.id = m.id AND f.value ->> 'kind' = 'original_attachment'
               AND f.value ->> 'bucket' = p.value ->> 'bucket' AND f.value ->> 'original_path' = p.value ->> 'path'
             GROUP BY f.value ->> 'bucket', f.value ->> 'original_path'
           ) bytes), 0)::bigint AS deleted_bytes
    FROM merged m
  )
  UPDATE public.patient_archive_records r
  SET r2_deleted_paths = m.paths,
      r2_deleted_bytes = m.deleted_bytes,
      r2_cleanup_status = CASE
        WHEN (SELECT count(*) FROM jsonb_array_elements(COALESCE(r.attachment_paths, '[]'::jsonb)) e(value) WHERE e.value ->> 'bucket' <> 'external-url' AND NULLIF(e.value ->> 'bucket', '') IS NOT NULL AND NULLIF(e.value ->> 'path', '') IS NOT NULL) = 0 THEN 'completed'
        WHEN jsonb_array_length(m.paths) >= (SELECT count(*) FROM jsonb_array_elements(COALESCE(r.attachment_paths, '[]'::jsonb)) e(value) WHERE e.value ->> 'bucket' <> 'external-url' AND NULLIF(e.value ->> 'bucket', '') IS NOT NULL AND NULLIF(e.value ->> 'path', '') IS NOT NULL) THEN 'completed'
        WHEN jsonb_array_length(m.paths) > 0 THEN 'partial' ELSE 'not_started' END
  FROM measured m WHERE r.id = m.id;

  SELECT count(*) INTO v_updated FROM public.patient_archive_records WHERE archive_reference = v_reference AND status = 'purged';
  SELECT public.write_audit_log('record_archive_r2_cleanup', 'patient_archive_records', v_reference, jsonb_build_object('patient_count', v_updated, 'deleted_object_count', jsonb_array_length(_deleted_objects)), 'success');
  RETURN v_updated;
END;
$$;

-- SOURCE: 20260814103000_archive_storage_savings_reporting.sql statement 5
REVOKE ALL ON FUNCTION public.patient_archive_storage_snapshot(uuid) FROM PUBLIC;

-- SOURCE: 20260814103000_archive_storage_savings_reporting.sql statement 6
GRANT EXECUTE ON FUNCTION public.record_archive_storage_measurement(text) TO authenticated;

-- SOURCE: 20260814103000_archive_storage_savings_reporting.sql statement 7
GRANT EXECUTE ON FUNCTION public.record_archive_r2_cleanup(text, jsonb) TO authenticated;

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 1
-- 1. Manual rows cover company walk-ins who have no patient registration or HMS invoice.
CREATE TABLE public.corporate_manual_service_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id UUID NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  period_year INTEGER NOT NULL CHECK (period_year BETWEEN 2000 AND 2100),
  period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  service_date DATE NOT NULL,
  patient_name TEXT NOT NULL CHECK (length(btrim(patient_name)) > 0),
  service_description TEXT NOT NULL CHECK (length(btrim(service_description)) > 0),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  notes TEXT,
  created_by UUID REFERENCES public.auth_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sponsor_id, period_year, period_month, service_date, patient_name, service_description)
);

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 2
CREATE INDEX IF NOT EXISTS idx_corporate_manual_service_rows_period
  ON public.corporate_manual_service_rows(sponsor_id, period_year, period_month, service_date);

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 3
GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_manual_service_rows TO authenticated;

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 4
GRANT ALL ON public.corporate_manual_service_rows TO service_role;
