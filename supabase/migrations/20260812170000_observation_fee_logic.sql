-- Migration: Observation fee for same-day admission and overnight room charge logic
-- Date: 2026-08-12

-- 1. Update admission_bed_charge function
-- A "night" only counts if the patient was still admitted when the next calendar day started (past midnight).
-- Nights = (discharge_date::date - admitted_date::date)
-- If nights = 0 -> observation only = 3000 flat (daily_rate = 3000, days = 0, amount = 3000)
-- If nights >= 1 -> nights * daily_rate (days = nights, daily_rate = room.daily_rate, amount = nights * daily_rate)

CREATE OR REPLACE FUNCTION public.admission_bed_charge(_admission_id uuid)
 RETURNS TABLE(days integer, daily_rate numeric, amount numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD;
  _rate numeric;
  _nights int;
  _amount numeric;
BEGIN
  SELECT a.*, r.daily_rate AS room_daily_rate INTO _adm
  FROM public.admissions a
  LEFT JOIN public.beds b ON b.id = a.bed_id
  LEFT JOIN public.rooms r ON r.id = b.room_id
  WHERE a.id = _admission_id;

  IF _adm IS NULL THEN
    RETURN QUERY SELECT 0, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  _nights := GREATEST(0, (COALESCE(_adm.discharged_at, now())::date - COALESCE(_adm.admitted_at, _adm.created_at)::date))::int;

  IF _nights = 0 THEN
    RETURN QUERY SELECT 0, 3000::numeric, 3000::numeric;
  ELSE
    _rate := COALESCE(_adm.room_daily_rate, 0)::numeric;
    _amount := ROUND(_nights * _rate, 2)::numeric;
    RETURN QUERY SELECT _nights, _rate, _amount;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.admission_bed_charge(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admission_bed_charge(uuid) TO authenticated, service_role;


-- 2. Update bill_admission_bed_days function to correctly handle observation fee vs room charge
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
  _item_desc text;
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

  IF _days = 0 THEN
    _item_desc := 'Observation fee (same-day discharge)';
  else
    _item_desc := 'Bed charge - ' || COALESCE(_room.room_class, 'ward') || ' - ' || _days || ' night(s)';
  END IF;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
  VALUES (
    _inv,
    _item_desc,
    CASE WHEN _days = 0 THEN 1 ELSE _days END,
    _rate, _amount, 'admission'
  );

  IF _copay > 0 THEN
    SELECT balance INTO _bal FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
    _from_wallet := ROUND(LEAST(GREATEST(COALESCE(_bal,0), 0), _copay), 2);
    _debt := ROUND(_copay - _from_wallet, 2);

    IF _from_wallet > 0 THEN
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, -_from_wallet, 'invoice_payment', NULL, NULL, _inv,
        CASE WHEN _days = 0 THEN 'Observation fee for admission' ELSE 'Bed charge for admission (' || _days || ' night(s))' END
      );
    END IF;

    IF _debt > 0 THEN
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, -_debt, 'debt_incurred', NULL, NULL, _inv,
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

REVOKE ALL ON FUNCTION public.bill_admission_bed_days(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bill_admission_bed_days(uuid) TO authenticated, service_role;


-- 3. Update admission_discharge_preview function
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
