CREATE OR REPLACE FUNCTION public.copay_percent(_account_type text, _plan text DEFAULT NULL)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN lower(coalesce(_account_type,'')) = 'katchma'
      THEN CASE WHEN lower(coalesce(_plan,'')) LIKE '%basic%' THEN 0 ELSE 10 END
    WHEN lower(coalesce(_account_type,'')) IN ('nhia','nhis') THEN 10
    WHEN lower(coalesce(_account_type,'')) IN ('hmo','corporate','retainer','staff') THEN 0
    WHEN lower(coalesce(_account_type,'')) = 'staff_family' THEN 50
    ELSE 100
  END::numeric
$fn$;

REVOKE ALL ON FUNCTION public.copay_percent(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.copay_percent(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admission_bed_charge(_admission_id uuid)
RETURNS TABLE(days integer, daily_rate numeric, amount numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    GREATEST(1, CEIL(EXTRACT(EPOCH FROM (COALESCE(a.discharged_at, now()) - COALESCE(a.admitted_at, a.created_at))) / 86400.0))::int,
    COALESCE(r.daily_rate, 0)::numeric,
    (GREATEST(1, CEIL(EXTRACT(EPOCH FROM (COALESCE(a.discharged_at, now()) - COALESCE(a.admitted_at, a.created_at))) / 86400.0)) * COALESCE(r.daily_rate, 0))::numeric
  FROM public.admissions a
  LEFT JOIN public.beds b ON b.id = a.bed_id
  LEFT JOIN public.rooms r ON r.id = b.room_id
  WHERE a.id = _admission_id;
$fn$;

REVOKE ALL ON FUNCTION public.admission_bed_charge(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admission_bed_charge(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bill_admission_bed_days(_admission_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
    'Bed charge - ' || COALESCE(_room.room_class, 'ward') || ' - ' || _days || ' day(s)',
    _days, _rate, _amount, 'admission'
  );

  IF _copay > 0 THEN
    PERFORM public.adjust_patient_balance(
      _adm.patient_id, -_copay, 'invoice_payment', NULL, NULL, _inv,
      'Bed charge for admission (' || _days || ' day(s))'
    );
    UPDATE public.invoices
      SET paid_amount = _copay,
          status = CASE WHEN _copay >= _amount THEN 'paid' ELSE 'partial' END,
          paid_at = CASE WHEN _copay >= _amount THEN now() ELSE NULL END
      WHERE id = _inv;
  END IF;

  RETURN _inv;
END;
$fn$;

REVOKE ALL ON FUNCTION public.bill_admission_bed_days(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.bill_admission_bed_days(uuid) TO authenticated, service_role;