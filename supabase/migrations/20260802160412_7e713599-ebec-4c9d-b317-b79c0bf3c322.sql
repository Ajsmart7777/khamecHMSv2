-- 1. Wallet eligibility: only cash/normal/staff_family hold a personal balance
CREATE OR REPLACE FUNCTION public.has_wallet(_account_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT lower(coalesce(_account_type,'')) IN ('','normal','cash','staff_family')
$$;

-- 2. Single source of truth for what a patient personally still owes
CREATE OR REPLACE FUNCTION public.patient_outstanding(_patient_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT ROUND(
    GREATEST(0, -COALESCE(p.balance,0))
    + COALESCE((
        SELECT SUM(GREATEST(0,
          ROUND(i.total_amount * public.copay_percent(p.account_type, p.insurance_plan) / 100.0, 2)
          - COALESCE(i.paid_amount,0)))
        FROM public.invoices i
        WHERE i.patient_id = p.id AND i.status IN ('pending','partial')
      ), 0)
  , 2)
  FROM public.patients p WHERE p.id = _patient_id
$$;

REVOKE EXECUTE ON FUNCTION public.patient_outstanding(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patient_outstanding(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.has_wallet(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_wallet(text) TO authenticated, service_role;

-- 3. Bed billing: never touch a sponsored patient's wallet
CREATE OR REPLACE FUNCTION public.bill_admission_bed_days(_admission_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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

  -- Only wallet patients settle through their personal balance. Sponsored
  -- patients simply carry their copay as an outstanding invoice share.
  IF _wallet AND _copay > 0 THEN
    SELECT balance INTO _bal FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
    _from_wallet := ROUND(LEAST(GREATEST(COALESCE(_bal,0),0), _copay), 2);
    _debt := ROUND(_copay - _from_wallet, 2);

    IF _from_wallet > 0 THEN
      PERFORM public.adjust_patient_balance(_adm.patient_id, -_from_wallet, 'invoice_payment',
        NULL, NULL, _inv, 'Bed charge for admission (' || _days || ' night(s))');
    END IF;
    IF _debt > 0 THEN
      PERFORM public.adjust_patient_balance(_adm.patient_id, -_debt, 'debt_incurred',
        NULL, NULL, _inv, 'Bed charge shortfall on discharge (' || _days || ' night(s))');
    END IF;

    -- copay is fully accounted for in the wallet (cash paid + debt carried)
    UPDATE public.invoices
       SET paid_amount = _copay,
           payment_method = 'wallet',
           status = CASE WHEN _copay >= _amount THEN 'paid' ELSE 'pending' END,
           paid_at = CASE WHEN _copay >= _amount THEN now() ELSE NULL END
     WHERE id = _inv;
  END IF;

  RETURN _inv;
END;
$function$;

-- 4. In-ward orders: same wallet gating for sponsored patients
CREATE OR REPLACE FUNCTION public.create_admitted_snap(_patient_id uuid, _order_type text, _target_station text, _photo_path text, _note text, _items jsonb, _total numeric, _allow_debt boolean DEFAULT false, _debt_reason text DEFAULT NULL::text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _uid UUID := auth.uid();
  _visit UUID; _admission UUID; _bal NUMERIC; _snap_id UUID; _new_bal NUMERIC;
  _debt NUMERIC := 0; _invoice UUID; _role TEXT;
  _acct TEXT; _plan TEXT; _corp UUID; _sponsor TEXT;
  _pct NUMERIC; _patient_share NUMERIC; _covered NUMERIC; _wallet BOOLEAN;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT id INTO _admission FROM public.admissions
   WHERE patient_id = _patient_id AND status IN ('active','ready_for_discharge')
   ORDER BY admitted_at DESC NULLS LAST LIMIT 1;
  IF _admission IS NULL THEN RAISE EXCEPTION 'Patient is not currently admitted'; END IF;

  SELECT id INTO _visit FROM public.visits
   WHERE patient_id = _patient_id AND status = 'open' ORDER BY opened_at DESC LIMIT 1;

  SELECT balance, lower(coalesce(account_type,'')), insurance_plan, corporate_id
    INTO _bal, _acct, _plan, _corp
    FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _bal IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  _pct := public.copay_percent(_acct, _plan);
  _patient_share := round(COALESCE(_total,0) * _pct / 100.0, 2);
  _covered := GREATEST(0, round(COALESCE(_total,0) - _patient_share, 2));
  _wallet := public.has_wallet(_acct);

  IF _wallet AND _bal < _patient_share THEN
    IF NOT _allow_debt THEN
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE: balance % < required %', _bal, _patient_share;
    END IF;
    IF _debt_reason IS NULL OR length(trim(_debt_reason)) < 3 THEN
      RAISE EXCEPTION 'Debt override requires a reason';
    END IF;
    _debt := _patient_share - _bal;
  END IF;

  SELECT role::text INTO _role FROM public.user_roles WHERE user_id = _uid LIMIT 1;

  _sponsor := CASE WHEN _acct IN ('cash','normal','') THEN NULL ELSE _acct END;

  INSERT INTO public.invoices (
    patient_id, invoice_number, total_amount, original_amount, discount_amount, paid_amount,
    status, payment_method, notes, visit_id, paid_at,
    sponsor_type, corporate_account_id, created_by
  ) VALUES (
    _patient_id, '', _total, _total, 0,
    CASE WHEN _wallet THEN _patient_share ELSE 0 END,
    CASE WHEN _wallet AND _patient_share >= COALESCE(_total,0) THEN 'paid' ELSE 'pending' END,
    CASE WHEN _wallet THEN 'wallet'
         WHEN _pct = 0 THEN 'sponsor_claim' ELSE NULL END,
    'In-ward ' || _order_type || ' (admitted order)' ||
      CASE WHEN _covered > 0 THEN ' — sponsor covered ₦' || _covered ELSE '' END ||
      CASE WHEN _debt > 0 THEN ' — debt ₦' || _debt ELSE '' END,
    _visit,
    CASE WHEN _wallet AND _patient_share >= COALESCE(_total,0) THEN now() ELSE NULL END,
    _sponsor,
    CASE WHEN _acct IN ('corporate','retainer') THEN _corp ELSE NULL END,
    _role
  ) RETURNING id INTO _invoice;

  IF jsonb_typeof(COALESCE(_items,'[]'::jsonb)) = 'array' THEN
    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
    SELECT _invoice, COALESCE(it->>'name','Item'),
           GREATEST(COALESCE((it->>'qty')::int,1),1),
           COALESCE((it->>'unit_price')::numeric,0),
           GREATEST(COALESCE((it->>'qty')::int,1),1) * COALESCE((it->>'unit_price')::numeric,0),
           COALESCE(it->>'category', _order_type)
    FROM jsonb_array_elements(_items) AS it;
  END IF;

  IF _wallet AND _patient_share <> 0 THEN
    _new_bal := _bal - _patient_share;
    PERFORM set_config('app.allow_balance_write','on',true);
    UPDATE public.patients SET balance = _new_bal, updated_at = now() WHERE id = _patient_id;
    PERFORM set_config('app.allow_balance_write','off',true);
    INSERT INTO public.balance_transactions
      (patient_id, transaction_type, amount, balance_before, balance_after, performed_by, related_invoice_id, notes)
    VALUES
      (_patient_id, CASE WHEN _debt > 0 THEN 'debt_incurred' ELSE 'admitted_deduction' END,
       -_patient_share, _bal, _new_bal, _uid, _invoice,
       CASE WHEN _debt > 0
            THEN 'Admitted in-ward ' || _order_type || ' (debt ₦' || _debt || '): ' || COALESCE(_debt_reason,'')
            ELSE 'Admitted in-ward ' || _order_type END);
  END IF;

  INSERT INTO public.snap_orders (
    patient_id, visit_id, order_type, target_station, source_role,
    photo_path, note, matched_items, status, invoice_id, created_by,
    billed_by, billed_at, paid_at, is_admitted_snap, debt_amount, debt_reason, intent
  ) VALUES (
    _patient_id, _visit, _order_type, _target_station, COALESCE(_role,'nurse'),
    _photo_path, _note, COALESCE(_items,'[]'::jsonb),
    'paid', _invoice, _uid, _uid, now(), now(), true, _debt, _debt_reason, 'in_ward_order'
  ) RETURNING id INTO _snap_id;

  RETURN _snap_id;
END;
$function$;

-- 5. Discharge preview built on the shared outstanding calculation
CREATE OR REPLACE FUNCTION public.admission_discharge_preview(_admission_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _adm RECORD; _p RECORD;
  _nights int; _rate numeric; _bed_total numeric;
  _pct numeric; _share numeric; _covered numeric;
  _bal numeric; _prior numeric; _already boolean; _due numeric;
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

  _bal   := COALESCE(_p.balance,0);
  _prior := public.patient_outstanding(_adm.patient_id);
  _due   := ROUND(_prior + _share, 2);

  RETURN jsonb_build_object(
    'admission_id', _admission_id,
    'patient_id', _adm.patient_id,
    'admitted_at', COALESCE(_adm.admitted_at, _adm.created_at),
    'account_type', _p.account_type,
    'insurance_plan', _p.insurance_plan,
    'has_wallet', public.has_wallet(_p.account_type),
    'nights', COALESCE(_nights,0),
    'daily_rate', COALESCE(_rate,0),
    'bed_total', COALESCE(_bed_total,0),
    'bed_already_billed', _already,
    'copay_pct', _pct,
    'sponsor_covered', _covered,
    'bed_patient_share', _share,
    'current_balance', _bal,
    'prior_outstanding', _prior,
    'total_due', _due,
    'balance_after_bed', ROUND(_bal - CASE WHEN public.has_wallet(_p.account_type) THEN _share ELSE 0 END, 2)
  );
END;
$function$;

-- 6. Discharge: settle only the patient's own share, never the sponsor's
CREATE OR REPLACE FUNCTION public.discharge_admission(_admission_id uuid, _notes text DEFAULT NULL::text, _settlement_method text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0, _settlement_notes text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _adm RECORD; _p RECORD; _wallet boolean;
  _debt numeric; _collected numeric := 0; _remaining numeric := 0;
  _inv RECORD; _apply numeric; _left numeric; _pct numeric; _share numeric;
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
      -- clear wallet debt first (cash/staff_family patients only)
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

    ELSIF _settlement_method = 'waive' THEN
      IF NOT public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]) THEN
        RAISE EXCEPTION 'Only accountant/admin can waive debt';
      END IF;
      IF _wallet AND _p.balance < 0 THEN
        PERFORM public.adjust_patient_balance(_adm.patient_id, -_p.balance, 'debt_cleared','waive',
          NULL, NULL, COALESCE(_settlement_notes,'Discharge - debt waived'));
      END IF;
      _remaining := 0;

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

  -- Apply money received (or the waiver) to the PATIENT SHARE of unpaid invoices, oldest first.
  _left := CASE WHEN _settlement_method IN ('cash','pos','transfer') THEN _collected
                WHEN _settlement_method = 'waive' THEN _debt ELSE 0 END;
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
                       'collected',_collected,'outstanding',_remaining,'method',_settlement_method));

  RETURN jsonb_build_object('debt',_debt,'collected',_collected,'outstanding',_remaining);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.bill_admission_bed_days(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_admitted_snap(uuid,text,text,text,text,jsonb,numeric,boolean,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admission_discharge_preview(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.discharge_admission(uuid,text,text,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bill_admission_bed_days(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_admitted_snap(uuid,text,text,text,text,jsonb,numeric,boolean,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admission_discharge_preview(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid,text,text,numeric,text) TO authenticated, service_role;