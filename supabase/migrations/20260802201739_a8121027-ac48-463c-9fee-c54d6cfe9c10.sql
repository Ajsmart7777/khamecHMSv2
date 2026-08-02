CREATE OR REPLACE FUNCTION public.bill_admission_bed_days(_admission_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _adm RECORD; _p RECORD; _room RECORD;
  _days int; _rate numeric; _amount numeric;
  _pct numeric; _copay numeric; _inv uuid;
  _bal numeric; _from_wallet numeric; _debt numeric; _wallet boolean;
  _sponsor text;
BEGIN
  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id;
  IF _adm IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id;
  IF _p IS NULL THEN RETURN NULL; END IF;

  SELECT d.days, d.daily_rate, d.amount INTO _days, _rate, _amount
  FROM public.admission_bed_charge(_admission_id) d;
  IF COALESCE(_amount,0) <= 0 THEN RETURN NULL; END IF;

  SELECT id INTO _inv FROM public.invoices
   WHERE patient_id = _adm.patient_id AND notes = 'BED_DAYS:' || _admission_id::text LIMIT 1;
  IF _inv IS NOT NULL THEN RETURN _inv; END IF;

  _pct    := public.copay_percent(_p.account_type, _p.insurance_plan);
  _copay  := ROUND(_amount * _pct / 100.0, 2);
  _wallet := public.has_wallet(_p.account_type);
  _sponsor := CASE WHEN lower(coalesce(_p.account_type,'')) IN ('','normal','cash') THEN NULL
                   ELSE lower(_p.account_type) END;

  SELECT r.room_number, r.room_class INTO _room
  FROM public.beds b JOIN public.rooms r ON r.id = b.room_id WHERE b.id = _adm.bed_id;

  INSERT INTO public.invoices (
    patient_id, visit_id, total_amount, original_amount, discount_amount,
    paid_amount, status, payment_method, sponsor_type, corporate_account_id, notes
  ) VALUES (
    _adm.patient_id, _adm.visit_id, _amount, _amount, 0,
    0, 'pending',
    CASE WHEN _pct = 0 AND _sponsor IS NOT NULL THEN 'sponsor_claim' ELSE NULL END,
    _sponsor,
    CASE WHEN lower(coalesce(_p.account_type,'')) IN ('corporate','retainer') THEN _p.corporate_id ELSE NULL END,
    'BED_DAYS:' || _admission_id::text
  ) RETURNING id INTO _inv;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
  VALUES (_inv,
    'Bed charge - ' || COALESCE(_room.room_class,'ward') || ' - ' || _days || ' night(s)',
    _days, _rate, _amount, 'admission');

  IF _wallet AND _copay > 0 THEN
    SELECT balance INTO _bal FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
    _from_wallet := ROUND(LEAST(GREATEST(COALESCE(_bal,0),0), _copay), 2);
    _debt := ROUND(_copay - _from_wallet, 2);

    IF _from_wallet > 0 THEN
      PERFORM public.adjust_patient_balance(_adm.patient_id, -_from_wallet, 'invoice_deduction',
        'wallet', NULL, _inv, 'Bed charge for admission (' || _days || ' night(s))');
    END IF;
    IF _debt > 0 THEN
      PERFORM public.adjust_patient_balance(_adm.patient_id, -_debt, 'debt_incurred',
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

REVOKE ALL ON FUNCTION public.bill_admission_bed_days(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bill_admission_bed_days(uuid) TO authenticated;