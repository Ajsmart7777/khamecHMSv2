CREATE OR REPLACE FUNCTION public.admission_discharge_preview(_admission_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD; _p RECORD;
  _nights int; _rate numeric; _bed_total numeric;
  _pct numeric; _share numeric; _covered numeric;
  _bal numeric; _prior numeric; _already boolean;
  _gross numeric; _credit numeric; _applied numeric; _due numeric;
  _wallet boolean;
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

  SELECT EXISTS (SELECT 1 FROM public.invoices
    WHERE patient_id = _adm.patient_id AND notes = 'BED_DAYS:' || _admission_id::text) INTO _already;
  IF _already THEN _share := 0; _covered := 0; END IF;

  _wallet := public.has_wallet(_p.account_type);
  _bal    := COALESCE(_p.balance,0);
  _prior  := public.patient_outstanding(_adm.patient_id);
  _gross  := ROUND(_prior + _share, 2);

  _credit  := CASE WHEN _wallet THEN ROUND(GREATEST(_bal,0),2) ELSE 0 END;
  _applied := ROUND(LEAST(_credit, _gross), 2);
  _due     := ROUND(GREATEST(0, _gross - _applied), 2);

  RETURN jsonb_build_object(
    'admission_id', _admission_id,
    'patient_id', _adm.patient_id,
    'admitted_at', COALESCE(_adm.admitted_at, _adm.created_at),
    'account_type', _p.account_type,
    'insurance_plan', _p.insurance_plan,
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
