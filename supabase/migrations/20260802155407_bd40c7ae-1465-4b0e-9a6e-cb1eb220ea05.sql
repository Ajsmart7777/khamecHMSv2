-- 1. Calendar-night based bed charge
CREATE OR REPLACE FUNCTION public.admission_bed_charge(_admission_id uuid)
 RETURNS TABLE(days integer, daily_rate numeric, amount numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    GREATEST(1, (COALESCE(a.discharged_at, now())::date - COALESCE(a.admitted_at, a.created_at)::date))::int,
    COALESCE(r.daily_rate, 0)::numeric,
    ROUND(GREATEST(1, (COALESCE(a.discharged_at, now())::date - COALESCE(a.admitted_at, a.created_at)::date)) * COALESCE(r.daily_rate, 0), 2)::numeric
  FROM public.admissions a
  LEFT JOIN public.beds b ON b.id = a.bed_id
  LEFT JOIN public.rooms r ON r.id = b.room_id
  WHERE a.id = _admission_id;
$function$;

-- 2. Bed billing must never hard-fail on insufficient balance
CREATE OR REPLACE FUNCTION public.bill_admission_bed_days(_admission_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD;
  _p RECORD;
  _room RECORD;
  _days int;
  _rate numeric;
  _amount numeric;
  _pct numeric;
  _copay numeric;
  _inv uuid;
  _bal numeric;
  _from_wallet numeric;
  _debt numeric;
BEGIN
  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id;
  IF _adm IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id;
  IF _p IS NULL THEN RETURN NULL; END IF;

  SELECT d.days, d.daily_rate, d.amount INTO _days, _rate, _amount
  FROM public.admission_bed_charge(_admission_id) d;

  IF COALESCE(_amount, 0) <= 0 THEN RETURN NULL; END IF;

  SELECT id INTO _inv FROM public.invoices
  WHERE patient_id = _adm.patient_id
    AND notes = 'BED_DAYS:' || _admission_id::text
  LIMIT 1;
  IF _inv IS NOT NULL THEN RETURN _inv; END IF;

  _pct := public.copay_percent(_p.account_type, _p.insurance_plan);
  _copay := ROUND(_amount * _pct / 100.0, 2);

  SELECT r.room_number, r.room_class INTO _room
  FROM public.beds b JOIN public.rooms r ON r.id = b.room_id
  WHERE b.id = _adm.bed_id;

  INSERT INTO public.invoices (
    patient_id, visit_id, total_amount, original_amount, discount_amount,
    paid_amount, status, sponsor_type, corporate_account_id, notes
  ) VALUES (
    _adm.patient_id, _adm.visit_id, _amount, _amount, 0,
    0, 'pending',
    CASE WHEN _pct < 100 THEN _p.account_type ELSE NULL END,
    _p.corporate_id,
    'BED_DAYS:' || _admission_id::text
  ) RETURNING id INTO _inv;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
  VALUES (
    _inv,
    'Bed charge - ' || COALESCE(_room.room_class, 'ward') || ' - ' || _days || ' night(s)',
    _days, _rate, _amount, 'admission'
  );

  IF _copay > 0 THEN
    SELECT balance INTO _bal FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
    _from_wallet := ROUND(LEAST(GREATEST(COALESCE(_bal,0), 0), _copay), 2);
    _debt := ROUND(_copay - _from_wallet, 2);

    IF _from_wallet > 0 THEN
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, -_from_wallet, 'invoice_payment', NULL, NULL, _inv,
        'Bed charge for admission (' || _days || ' night(s))'
      );
    END IF;

    IF _debt > 0 THEN
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, -_debt, 'debt_incurred', NULL, NULL, _inv,
        'Bed charge shortfall on discharge (' || _days || ' night(s))'
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

-- 3. Discharge preview (server-side source of truth)
CREATE OR REPLACE FUNCTION public.admission_discharge_preview(_admission_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD;
  _p RECORD;
  _nights int; _rate numeric; _bed_total numeric;
  _pct numeric; _share numeric; _covered numeric;
  _bal numeric; _prior numeric; _already boolean;
  _due numeric; _after numeric;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
       ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','cashier','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id;

  SELECT d.days, d.daily_rate, d.amount INTO _nights, _rate, _bed_total
  FROM public.admission_bed_charge(_admission_id) d;

  _pct := public.copay_percent(_p.account_type, _p.insurance_plan);
  _share := ROUND(COALESCE(_bed_total,0) * _pct / 100.0, 2);
  _covered := ROUND(GREATEST(0, COALESCE(_bed_total,0) - _share), 2);

  SELECT EXISTS (
    SELECT 1 FROM public.invoices
    WHERE patient_id = _adm.patient_id
      AND notes = 'BED_DAYS:' || _admission_id::text
  ) INTO _already;

  IF _already THEN
    _share := 0; _covered := 0;
  END IF;

  _bal := COALESCE(_p.balance, 0);
  _prior := ROUND(GREATEST(0, -_bal), 2);
  _after := ROUND(_bal - _share, 2);
  _due := ROUND(GREATEST(0, -_after), 2);

  RETURN jsonb_build_object(
    'admission_id', _admission_id,
    'patient_id', _adm.patient_id,
    'admitted_at', COALESCE(_adm.admitted_at, _adm.created_at),
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

REVOKE ALL ON FUNCTION public.admission_discharge_preview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admission_discharge_preview(uuid) TO authenticated, service_role;

-- 4. Discharge with partial settlement + carry
DROP FUNCTION IF EXISTS public.discharge_admission(uuid, text, text, numeric, text);

CREATE OR REPLACE FUNCTION public.discharge_admission(_admission_id uuid, _notes text DEFAULT NULL::text, _settlement_method text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0, _settlement_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD;
  _bal numeric;
  _debt numeric;
  _collected numeric := 0;
  _remaining numeric := 0;
  _inv RECORD;
  _apply numeric;
  _left numeric;
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

  -- Accrued bed charge is billed here (once per admission); never fails on low balance
  PERFORM public.bill_admission_bed_days(_admission_id);

  SELECT balance INTO _bal FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
  _debt := ROUND(GREATEST(0, -COALESCE(_bal,0)), 2);
  _remaining := _debt;

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash','pos','transfer') THEN
      _collected := ROUND(GREATEST(COALESCE(_settlement_amount,0), 0), 2);
      IF _collected <= 0 THEN
        RAISE EXCEPTION 'Settlement amount must be greater than zero';
      END IF;
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, _collected, 'debt_cleared', _settlement_method,
        NULL, NULL, COALESCE(_settlement_notes, 'Discharge settlement')
      );
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
      IF _remaining > 0 THEN
        IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
          RAISE EXCEPTION 'PARTIAL_REASON_REQUIRED: provide a reason for the outstanding %', _remaining;
        END IF;
        PERFORM public.write_audit_log(
          'discharge_partial_settlement', 'admission', _admission_id::text,
          jsonb_build_object('patient_id', _adm.patient_id, 'debt', _debt,
                             'collected', _collected, 'outstanding', _remaining,
                             'method', _settlement_method, 'notes', _settlement_notes)
        );
      END IF;

    ELSIF _settlement_method = 'waive' THEN
      IF NOT public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]) THEN
        RAISE EXCEPTION 'Only accountant/admin can waive debt';
      END IF;
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, _debt, 'debt_cleared', 'waive',
        NULL, NULL, COALESCE(_settlement_notes, 'Discharge - debt waived')
      );
      _remaining := 0;

    ELSIF _settlement_method = 'carry' THEN
      IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
        RAISE EXCEPTION 'CARRY_REASON_REQUIRED: provide a reason for carrying the debt';
      END IF;
      PERFORM public.write_audit_log(
        'debt_carried_on_discharge', 'admission', _admission_id::text,
        jsonb_build_object('patient_id', _adm.patient_id, 'debt', _debt, 'notes', _settlement_notes)
      );
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  -- Apply money actually received (cash/pos/transfer or waive) to unpaid invoices, oldest first
  _left := CASE WHEN _settlement_method IN ('cash','pos','transfer') THEN _collected
                WHEN _settlement_method = 'waive' THEN _debt
                ELSE 0 END;
  IF _left > 0 THEN
    FOR _inv IN
      SELECT id, total_amount, COALESCE(paid_amount,0) AS paid
      FROM public.invoices
      WHERE patient_id = _adm.patient_id
        AND status IN ('pending','partial')
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN _left <= 0;
      _apply := ROUND(LEAST(_left, _inv.total_amount - _inv.paid), 2);
      CONTINUE WHEN _apply <= 0;
      UPDATE public.invoices
         SET paid_amount = _inv.paid + _apply,
             status = CASE WHEN _inv.paid + _apply >= _inv.total_amount THEN 'paid' ELSE 'partial' END,
             paid_at = CASE WHEN _inv.paid + _apply >= _inv.total_amount THEN now() ELSE paid_at END,
             payment_method = COALESCE(payment_method, _settlement_method),
             updated_at = now()
       WHERE id = _inv.id;
      _left := ROUND(_left - _apply, 2);
    END LOOP;
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
    jsonb_build_object('patient_id', _adm.patient_id, 'notes', _notes,
                       'debt', _debt, 'collected', _collected, 'outstanding', _remaining,
                       'method', _settlement_method)
  );

  RETURN jsonb_build_object('debt', _debt, 'collected', _collected, 'outstanding', _remaining);
END;
$function$;

REVOKE ALL ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) TO authenticated, service_role;