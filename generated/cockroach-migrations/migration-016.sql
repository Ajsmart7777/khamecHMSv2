-- SOURCE: 20260731165539_48aebc8d-ba2a-41ec-96cd-5324cbc2539e.sql statement 4
GRANT EXECUTE ON FUNCTION public.get_staff_directory() TO authenticated;

-- SOURCE: 20260731165539_48aebc8d-ba2a-41ec-96cd-5324cbc2539e.sql statement 5
GRANT EXECUTE ON FUNCTION public.get_staff_directory() TO service_role;

-- SOURCE: 20260731171335_7eeec626-5509-47f0-9d65-4288527239b0.sql statement 1
CREATE OR REPLACE FUNCTION public.forward_snap_to_billing(
  _source_snap_id uuid,
  _target_station text,
  _note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _uid uuid := public.hms_current_user_id();
  _src public.snap_orders;
  _new uuid;
  _role text;
  _order_type text;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _target_station NOT IN ('pharmacy','lab') THEN
    RAISE EXCEPTION 'Target must be pharmacy or lab';
  END IF;

  SELECT * INTO _src FROM public.snap_orders WHERE id = _source_snap_id;
  IF _src IS NULL THEN RAISE EXCEPTION 'Source snap not found'; END IF;

  _order_type := CASE _target_station WHEN 'lab' THEN 'lab' ELSE 'prescription' END;
  SELECT role::text INTO _role FROM public.user_roles WHERE user_id = _uid LIMIT 1;

  INSERT INTO public.snap_orders (
    patient_id, visit_id, order_type, target_station, source_role,
    photo_path, note, status, created_by, original_sender_role,
    parent_snap_id, matched_items, ocr_text, ocr_confidence
  ) VALUES (
    (_src).patient_id, (_src).visit_id, _order_type, _target_station,
    COALESCE(_role, (_src).source_role),
    (_src).photo_path,
    COALESCE(_note, 'Forwarded from admitted patient snap'),
    'pending_billing', _uid, COALESCE(_role, (_src).source_role),
    (_src).id, COALESCE((_src).matched_items, '[]'::jsonb),
    (_src).ocr_text, (_src).ocr_confidence
  ) RETURNING id INTO _new;

  IF (_src).target_station IN ('nurse','doctor') AND (_src).status = 'pending_billing' THEN
    UPDATE public.snap_orders
       SET status = 'acknowledged',
           ack_by = _uid,
           ack_at = now(),
           updated_at = now()
     WHERE id = (_src).id;
  END IF;

  SELECT public.write_audit_log('snap_forwarded_to_billing', 'snap_order', _new::text, jsonb_build_object(
      'source_snap_id', (_src).id,
      'patient_id', (_src).patient_id,
      'target_station', _target_station
    )
  , 'success');
  RETURN _new;
END $$;

-- SOURCE: 20260731171335_7eeec626-5509-47f0-9d65-4288527239b0.sql statement 2
REVOKE ALL ON FUNCTION public.forward_snap_to_billing(uuid, text, text) FROM PUBLIC, anon;

-- SOURCE: 20260731171335_7eeec626-5509-47f0-9d65-4288527239b0.sql statement 3
GRANT EXECUTE ON FUNCTION public.forward_snap_to_billing(uuid, text, text) TO authenticated;

-- SOURCE: 20260731171335_7eeec626-5509-47f0-9d65-4288527239b0.sql statement 4
GRANT EXECUTE ON FUNCTION public.forward_snap_to_billing(uuid, text, text) TO service_role;

-- SOURCE: 20260801123831_206bf5e9-22e7-483e-87ef-ba91061e55e9.sql statement 1
CREATE OR REPLACE FUNCTION public.create_admitted_snap(_patient_id uuid, _order_type text, _target_station text, _photo_path text, _note text, _items jsonb, _total numeric, _allow_debt boolean DEFAULT false, _debt_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 
AS $function$
DECLARE
  _uid UUID := public.hms_current_user_id();
  _visit UUID;
  _admission UUID;
  _bal NUMERIC;
  _snap_id UUID;
  _new_bal NUMERIC;
  _debt NUMERIC := 0;
  _invoice UUID;
  _role TEXT;
  _acct TEXT;
  _corp UUID;
  _sponsor TEXT;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT id INTO _admission FROM public.admissions
   WHERE patient_id = _patient_id AND status IN ('active','ready_for_discharge')
   ORDER BY admitted_at DESC NULLS LAST LIMIT 1;
  IF _admission IS NULL THEN
    RAISE EXCEPTION 'Patient is not currently admitted';
  END IF;

  SELECT id INTO _visit FROM public.visits
   WHERE patient_id = _patient_id AND status = 'open'
   ORDER BY opened_at DESC LIMIT 1;

  SELECT balance, lower(coalesce(account_type,'')), corporate_id
    INTO _bal, _acct, _corp
    FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _bal IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  IF _bal < _total THEN
    IF NOT _allow_debt THEN
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE: balance % < required %', _bal, _total;
    END IF;
    IF _debt_reason IS NULL OR length(trim(_debt_reason)) < 3 THEN
      RAISE EXCEPTION 'Debt override requires a reason';
    END IF;
    _debt := _total - _bal;
  END IF;

  SELECT role::text INTO _role FROM public.user_roles WHERE user_id = _uid LIMIT 1;

  _sponsor := CASE
    WHEN _acct IN ('corporate','retainer') THEN _acct
    WHEN _acct IN ('cash','normal','') THEN NULL
    ELSE _acct END;

  -- Invoice for the in-ward charge (settled from the wallet immediately)
  INSERT INTO public.invoices (
    patient_id, invoice_number, total_amount, original_amount, paid_amount,
    status, payment_method, notes, visit_id, paid_at,
    sponsor_type, corporate_account_id, created_by
  ) VALUES (
    _patient_id, '', _total, _total, _total,
    'paid', 'wallet',
    'In-ward ' || _order_type || ' (admitted snap)' ||
      CASE WHEN _debt > 0 THEN ' — debt ₦' || _debt ELSE '' END,
    _visit, now(), _sponsor,
    CASE WHEN _acct IN ('corporate','retainer') THEN _corp ELSE NULL END,
    _role
  ) RETURNING id INTO _invoice;

  IF jsonb_typeof(COALESCE(_items,'[]'::jsonb)) = 'array' THEN
    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
    SELECT _invoice,
           COALESCE(it->>'name', 'Item'),
           GREATEST(COALESCE((it->>'qty')::int, 1), 1),
           COALESCE((it->>'unit_price')::numeric, 0),
           GREATEST(COALESCE((it->>'qty')::int, 1), 1) * COALESCE((it->>'unit_price')::numeric, 0),
           COALESCE(it->>'category', _order_type)
    FROM jsonb_array_elements(_items) AS it;
  END IF;

  -- Deduct (allowed to go negative when overriding)
  _new_bal := _bal - _total;
  SELECT set_config('app.allow_balance_write', 'on', true);
  UPDATE public.patients SET balance = _new_bal, updated_at = now() WHERE id = _patient_id;
  SELECT set_config('app.allow_balance_write', 'off', true);
  INSERT INTO public.balance_transactions
    (patient_id, transaction_type, amount, balance_before, balance_after, performed_by, related_invoice_id, notes)
  VALUES
    (_patient_id, CASE WHEN _debt > 0 THEN 'debt_incurred' ELSE 'admitted_deduction' END,
     -_total, _bal, _new_bal, _uid, _invoice,
     CASE WHEN _debt > 0
          THEN 'Admitted in-ward ' || _order_type || ' (debt ₦' || _debt || '): ' || COALESCE(_debt_reason,'')
          ELSE 'Admitted in-ward ' || _order_type END);

  INSERT INTO public.snap_orders (
    patient_id, visit_id, order_type, target_station, source_role,
    photo_path, note, matched_items, status, created_by,
    is_admitted_snap, debt_amount, debt_reason,
    invoice_id, billed_by, billed_at, paid_at, original_sender_role
  ) VALUES (
    _patient_id, _visit, _order_type, _target_station, _role,
    _photo_path, _note, COALESCE(_items, '[]'::jsonb),
    'paid', _uid, true, _debt, _debt_reason,
    _invoice, _uid, now(), now(), _role
  ) RETURNING id INTO _snap_id;

  SELECT public.write_audit_log(CASE WHEN _debt > 0 THEN 'admitted_snap_debt' ELSE 'admitted_snap_created' END, 'snap_order', _snap_id::text, jsonb_build_object(
      'patient_id', _patient_id, 'total', _total, 'debt', _debt,
      'balance_after', _new_bal, 'reason', _debt_reason,
      'invoice_id', _invoice,
      'target_station', _target_station, 'order_type', _order_type
    )
  , 'success');

  RETURN _snap_id;
END; $function$;

-- SOURCE: 20260801123831_206bf5e9-22e7-483e-87ef-ba91061e55e9.sql statement 2
REVOKE EXECUTE ON FUNCTION public.create_admitted_snap(uuid,text,text,text,text,jsonb,numeric,boolean,text) FROM PUBLIC, anon;

-- SOURCE: 20260801123831_206bf5e9-22e7-483e-87ef-ba91061e55e9.sql statement 3
GRANT EXECUTE ON FUNCTION public.create_admitted_snap(uuid,text,text,text,text,jsonb,numeric,boolean,text) TO authenticated, service_role;

-- SOURCE: 20260801145936_b47dfac3-72ad-49da-b1ee-b0957d6f5d17.sql statement 1
CREATE OR REPLACE FUNCTION public.forward_snap_to_billing(_source_snap_id uuid, _target_station text, _note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 
AS $function$
DECLARE
  _uid uuid := public.hms_current_user_id();
  _src public.snap_orders;
  _new uuid;
  _role text;
  _order_type text;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _target_station NOT IN ('pharmacy','lab') THEN
    RAISE EXCEPTION 'Target must be pharmacy or lab';
  END IF;

  SELECT * INTO _src FROM public.snap_orders WHERE id = _source_snap_id;
  IF _src IS NULL THEN RAISE EXCEPTION 'Source snap not found'; END IF;

  -- Admission-order snaps are single-use: once forwarded (or acknowledged)
  -- they are consumed and live only on the patient's card.
  IF (_src).intent = 'admission_order' THEN
    IF (_src).ack_at IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.snap_orders c WHERE c.parent_snap_id = (_src).id) THEN
      RAISE EXCEPTION 'ADMISSION_SNAP_ALREADY_USED: this admission snap has already been used. Take a new snap.';
    END IF;
  END IF;

  _order_type := CASE _target_station WHEN 'lab' THEN 'lab' ELSE 'prescription' END;
  SELECT role::text INTO _role FROM public.user_roles WHERE user_id = _uid LIMIT 1;

  INSERT INTO public.snap_orders (
    patient_id, visit_id, order_type, target_station, source_role,
    photo_path, note, status, created_by, original_sender_role,
    parent_snap_id, matched_items, ocr_text, ocr_confidence
  ) VALUES (
    (_src).patient_id, (_src).visit_id, _order_type, _target_station,
    COALESCE(_role, (_src).source_role),
    (_src).photo_path,
    COALESCE(_note, 'Forwarded from admitted patient snap'),
    'pending_billing', _uid, COALESCE(_role, (_src).source_role),
    (_src).id, COALESCE((_src).matched_items, '[]'::jsonb),
    (_src).ocr_text, (_src).ocr_confidence
  ) RETURNING id INTO _new;

  IF (_src).intent = 'admission_order'
     OR ((_src).target_station IN ('nurse','doctor') AND (_src).status = 'pending_billing') THEN
    UPDATE public.snap_orders
       SET status = 'acknowledged',
           ack_by = _uid,
           ack_at = now(),
           updated_at = now()
     WHERE id = (_src).id;
  END IF;

  SELECT public.write_audit_log('snap_forwarded_to_billing', 'snap_order', _new::text, jsonb_build_object(
      'source_snap_id', (_src).id,
      'patient_id', (_src).patient_id,
      'target_station', _target_station
    )
  , 'success');
  RETURN _new;
END $function$;

-- SOURCE: 20260801145936_b47dfac3-72ad-49da-b1ee-b0957d6f5d17.sql statement 2
REVOKE EXECUTE ON FUNCTION public.forward_snap_to_billing(uuid, text, text) FROM PUBLIC, anon;

-- SOURCE: 20260801145936_b47dfac3-72ad-49da-b1ee-b0957d6f5d17.sql statement 3
GRANT EXECUTE ON FUNCTION public.forward_snap_to_billing(uuid, text, text) TO authenticated, service_role;

-- SOURCE: 20260801161124_33e96e34-a337-417d-bcce-7a32f89e972b.sql statement 1
ALTER TABLE public.snap_orders ALTER COLUMN photo_path DROP NOT NULL;

-- SOURCE: 20260801161124_33e96e34-a337-417d-bcce-7a32f89e972b.sql statement 2
CREATE OR REPLACE FUNCTION public.create_admitted_snap(_patient_id uuid, _order_type text, _target_station text, _photo_path text, _note text, _items jsonb, _total numeric, _allow_debt boolean DEFAULT false, _debt_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 
AS $function$
DECLARE
  _uid UUID := public.hms_current_user_id();
  _visit UUID;
  _admission UUID;
  _bal NUMERIC;
  _snap_id UUID;
  _new_bal NUMERIC;
  _debt NUMERIC := 0;
  _invoice UUID;
  _role TEXT;
  _acct TEXT;
  _plan TEXT;
  _corp UUID;
  _sponsor TEXT;
  _pct NUMERIC;
  _patient_share NUMERIC;
  _covered NUMERIC;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT id INTO _admission FROM public.admissions
   WHERE patient_id = _patient_id AND status IN ('active','ready_for_discharge')
   ORDER BY admitted_at DESC NULLS LAST LIMIT 1;
  IF _admission IS NULL THEN
    RAISE EXCEPTION 'Patient is not currently admitted';
  END IF;

  SELECT id INTO _visit FROM public.visits
   WHERE patient_id = _patient_id AND status = 'open'
   ORDER BY opened_at DESC LIMIT 1;

  SELECT balance, lower(coalesce(account_type,'')), insurance_plan, corporate_id
    INTO _bal, _acct, _plan, _corp
    FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _bal IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  -- Sponsor split: the wallet is only charged the patient's own share.
  _pct := public.copay_percent(_acct, _plan);
  _patient_share := round(COALESCE(_total,0) * _pct / 100.0, 2);
  _covered := GREATEST(0, round(COALESCE(_total,0) - _patient_share, 2));

  IF _bal < _patient_share THEN
    IF NOT _allow_debt THEN
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE: balance % < required %', _bal, _patient_share;
    END IF;
    IF _debt_reason IS NULL OR length(trim(_debt_reason)) < 3 THEN
      RAISE EXCEPTION 'Debt override requires a reason';
    END IF;
    _debt := _patient_share - _bal;
  END IF;

  SELECT role::text INTO _role FROM public.user_roles WHERE user_id = _uid LIMIT 1;

  _sponsor := CASE
    WHEN _acct IN ('corporate','retainer') THEN _acct
    WHEN _acct IN ('cash','normal','') THEN NULL
    ELSE _acct END;

  INSERT INTO public.invoices (
    patient_id, invoice_number, total_amount, original_amount, discount_amount, paid_amount,
    status, payment_method, notes, visit_id, paid_at,
    sponsor_type, corporate_account_id, created_by
  ) VALUES (
    _patient_id, '', _total, _total, 0, _patient_share,
    'paid', 'wallet',
    'In-ward ' || _order_type || ' (admitted order)' ||
      CASE WHEN _covered > 0 THEN ' — sponsor covered ₦' || _covered ELSE '' END ||
      CASE WHEN _debt > 0 THEN ' — debt ₦' || _debt ELSE '' END,
    _visit, now(), _sponsor,
    CASE WHEN _acct IN ('corporate','retainer') THEN _corp ELSE NULL END,
    _role
  ) RETURNING id INTO _invoice;

  IF jsonb_typeof(COALESCE(_items,'[]'::jsonb)) = 'array' THEN
    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
    SELECT _invoice,
           COALESCE(it->>'name', 'Item'),
           GREATEST(COALESCE((it->>'qty')::int, 1), 1),
           COALESCE((it->>'unit_price')::numeric, 0),
           GREATEST(COALESCE((it->>'qty')::int, 1), 1) * COALESCE((it->>'unit_price')::numeric, 0),
           COALESCE(it->>'category', _order_type)
    FROM jsonb_array_elements(_items) AS it;
  END IF;

  _new_bal := _bal - _patient_share;
  IF _patient_share <> 0 THEN
    SELECT set_config('app.allow_balance_write', 'on', true);
    UPDATE public.patients SET balance = _new_bal, updated_at = now() WHERE id = _patient_id;
    SELECT set_config('app.allow_balance_write', 'off', true);
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
    photo_path, note, matched_items, status, created_by,
    is_admitted_snap, debt_amount, debt_reason,
    invoice_id, billed_by, billed_at, paid_at, original_sender_role
  ) VALUES (
    _patient_id, _visit, _order_type, _target_station, _role,
    NULLIF(_photo_path,''), _note, COALESCE(_items, '[]'::jsonb),
    'paid', _uid, true, _debt, _debt_reason,
    _invoice, _uid, now(), now(), _role
  ) RETURNING id INTO _snap_id;

  SELECT public.write_audit_log(CASE WHEN _debt > 0 THEN 'admitted_snap_debt' ELSE 'admitted_snap_created' END, 'snap_order', _snap_id::text, jsonb_build_object(
      'patient_id', _patient_id, 'total', _total,
      'patient_share', _patient_share, 'sponsor_covered', _covered,
      'debt', _debt, 'balance_after', _new_bal, 'reason', _debt_reason,
      'invoice_id', _invoice, 'has_photo', (_photo_path IS NOT NULL),
      'target_station', _target_station, 'order_type', _order_type
    )
  , 'success');

  RETURN _snap_id;
END; $function$;

-- SOURCE: 20260801161124_33e96e34-a337-417d-bcce-7a32f89e972b.sql statement 3
REVOKE EXECUTE ON FUNCTION public.create_admitted_snap(uuid,text,text,text,text,jsonb,numeric,boolean,text) FROM PUBLIC, anon;

-- SOURCE: 20260801161124_33e96e34-a337-417d-bcce-7a32f89e972b.sql statement 4
GRANT EXECUTE ON FUNCTION public.create_admitted_snap(uuid,text,text,text,text,jsonb,numeric,boolean,text) TO authenticated, service_role;

-- SOURCE: 20260802155407_bd40c7ae-1465-4b0e-9a6e-cb1eb220ea05.sql statement 1
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

-- SOURCE: 20260802155407_bd40c7ae-1465-4b0e-9a6e-cb1eb220ea05.sql statement 2
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

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
  VALUES (
    _inv,
    'Bed charge - ' || COALESCE(_room_class, 'ward') || ' - ' || _days || ' night(s)',
    _days, _rate, _amount, 'admission'
  );

  IF _copay > 0 THEN
    SELECT balance INTO _bal FROM public.patients WHERE id = (_adm).patient_id FOR UPDATE;
    _from_wallet := ROUND(LEAST(GREATEST(COALESCE(_bal,0), 0), _copay), 2);
    _debt := ROUND(_copay - _from_wallet, 2);

    IF _from_wallet > 0 THEN
      SELECT public.adjust_patient_balance(
        (_adm).patient_id, -_from_wallet, 'invoice_payment', NULL, NULL, _inv,
        'Bed charge for admission (' || _days || ' night(s))'
      );
    END IF;

    IF _debt > 0 THEN
      SELECT public.adjust_patient_balance(
        (_adm).patient_id, -_debt, 'debt_incurred', NULL, NULL, _inv,
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

-- SOURCE: 20260802155407_bd40c7ae-1465-4b0e-9a6e-cb1eb220ea05.sql statement 3
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

-- SOURCE: 20260802155407_bd40c7ae-1465-4b0e-9a6e-cb1eb220ea05.sql statement 4
REVOKE ALL ON FUNCTION public.admission_discharge_preview(uuid) FROM PUBLIC, anon;

-- SOURCE: 20260802155407_bd40c7ae-1465-4b0e-9a6e-cb1eb220ea05.sql statement 5
GRANT EXECUTE ON FUNCTION public.admission_discharge_preview(uuid) TO authenticated, service_role;

-- SOURCE: 20260802155407_bd40c7ae-1465-4b0e-9a6e-cb1eb220ea05.sql statement 6
DROP FUNCTION IF EXISTS public.discharge_admission(uuid, text, text, numeric, text);

-- SOURCE: 20260802155407_bd40c7ae-1465-4b0e-9a6e-cb1eb220ea05.sql statement 7
CREATE OR REPLACE FUNCTION public.discharge_admission(_admission_id uuid, _notes text DEFAULT NULL::text, _settlement_method text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0, _settlement_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 
AS $function$
DECLARE
  _adm public.admissions;
  _bal numeric;
  _debt numeric;
  _collected numeric := 0;
  _remaining numeric := 0;
  _inv public.invoices;
  _apply numeric;
  _left numeric;
  _applied numeric := 0;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(),
       ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to discharge';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF (_adm).status NOT IN ('active','ready_for_discharge') THEN
    RAISE EXCEPTION 'Admission is not active (%)', (_adm).status;
  END IF;

  -- Accrued bed charge is billed here (once per admission); never fails on low balance
  SELECT public.bill_admission_bed_days(_admission_id);

  SELECT balance INTO _bal FROM public.patients WHERE id = (_adm).patient_id FOR UPDATE;
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
      SELECT public.adjust_patient_balance((_adm).patient_id, _collected, 'debt_cleared', _settlement_method, NULL, NULL, COALESCE(_settlement_notes)
      );
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
      IF _remaining > 0 THEN
        IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
          RAISE EXCEPTION 'PARTIAL_REASON_REQUIRED: provide a reason for the outstanding %', _remaining;
        END IF;
        SELECT public.write_audit_log('discharge_partial_settlement', 'admission', _admission_id::text, jsonb_build_object('patient_id', (_adm).patient_id, 'debt', _debt,
                             'collected', _collected, 'outstanding', _remaining,
                             'method', _settlement_method, 'notes', _settlement_notes)
        , 'success');
      END IF;

    ELSIF _settlement_method = 'waive' THEN
      IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]) THEN
        RAISE EXCEPTION 'Only accountant/admin can waive debt';
      END IF;
      SELECT public.adjust_patient_balance((_adm).patient_id, _debt, 'debt_cleared', 'waive', NULL, NULL, COALESCE(_settlement_notes), 'success');
      _remaining := 0;

    ELSIF _settlement_method = 'carry' THEN
      IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
        RAISE EXCEPTION 'CARRY_REASON_REQUIRED: provide a reason for carrying the debt';
      END IF;
      SELECT public.write_audit_log('debt_carried_on_discharge', 'admission', _admission_id::text, jsonb_build_object('patient_id', (_adm).patient_id, 'debt', _debt, 'notes', _settlement_notes)
      , 'success');
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  -- Apply money actually received (cash/pos/transfer or waive) to unpaid invoices, oldest first
  _left := CASE WHEN _settlement_method IN ('cash','pos','transfer') THEN _collected
                WHEN _settlement_method = 'waive' THEN _debt
                ELSE 0 END;
  IF _left > 0 THEN
    SELECT COALESCE(SUM(applied), 0) INTO _applied
    FROM (
      SELECT LEAST(due, GREATEST(_left - prior_due, 0))::numeric AS applied
      FROM (
        SELECT GREATEST(total_amount - COALESCE(paid_amount, 0), 0)::numeric AS due,
               COALESCE(SUM(GREATEST(total_amount - COALESCE(paid_amount, 0), 0)) OVER (
                 ORDER BY created_at ASC, id ASC
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ), 0)::numeric AS prior_due
        FROM public.invoices
        WHERE patient_id = (_adm).patient_id
          AND status IN ('pending','partial')
      ) unpaid
    ) allocation;

    WITH unpaid AS (
      SELECT id, total_amount, COALESCE(paid_amount, 0)::numeric AS paid,
             GREATEST(total_amount - COALESCE(paid_amount, 0), 0)::numeric AS due,
             COALESCE(SUM(GREATEST(total_amount - COALESCE(paid_amount, 0), 0)) OVER (
               ORDER BY created_at ASC, id ASC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0)::numeric AS prior_due
      FROM public.invoices
      WHERE patient_id = (_adm).patient_id
        AND status IN ('pending','partial')
    ), allocated AS (
      SELECT id, total_amount, paid,
             LEAST(due, GREATEST(_left - prior_due, 0))::numeric AS applied
      FROM unpaid
    )
    UPDATE public.invoices i
       SET paid_amount = a.paid + a.applied,
           status = CASE WHEN a.paid + a.applied >= a.total_amount THEN 'paid' ELSE 'partial' END,
           paid_at = CASE WHEN a.paid + a.applied >= a.total_amount THEN now() ELSE i.paid_at END,
           payment_method = COALESCE(i.payment_method, _settlement_method),
           updated_at = now()
      FROM allocated a
     WHERE i.id = a.id AND a.applied > 0;

    _left := ROUND(_left - COALESCE(_applied, 0), 2);
  END IF;

  UPDATE public.admissions
     SET status = 'discharged',
         discharged_at = now(),
         discharged_by = public.hms_current_user_id(),
         discharge_notes = _notes,
         updated_at = now()
   WHERE id = _admission_id;

  IF (_adm).bed_id IS NOT NULL THEN
    UPDATE public.beds SET status = 'available', updated_at = now() WHERE id = (_adm).bed_id;
  END IF;

  UPDATE public.patients SET status = 'discharged', updated_at = now() WHERE id = (_adm).patient_id;

  SELECT public.write_audit_log('admission_discharged', 'admission', _admission_id::text, jsonb_build_object('patient_id', (_adm).patient_id, 'notes', _notes,
                       'debt', _debt, 'collected', _collected, 'outstanding', _remaining,
                       'method', _settlement_method)
  , 'success');

  RETURN jsonb_build_object('debt', _debt, 'collected', _collected, 'outstanding', _remaining);
END;
$function$;

-- SOURCE: 20260802155407_bd40c7ae-1465-4b0e-9a6e-cb1eb220ea05.sql statement 8
REVOKE ALL ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) FROM PUBLIC, anon;

-- SOURCE: 20260802155407_bd40c7ae-1465-4b0e-9a6e-cb1eb220ea05.sql statement 9
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) TO authenticated, service_role;

-- SOURCE: 20260802160412_7e713599-ebec-4c9d-b317-b79c0bf3c322.sql statement 1
CREATE OR REPLACE FUNCTION public.has_wallet(_account_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE  AS $$
  SELECT lower(coalesce(_account_type,'')) IN ('','normal','cash','staff_family')
$$;

-- SOURCE: 20260802160412_7e713599-ebec-4c9d-b317-b79c0bf3c322.sql statement 2
CREATE OR REPLACE FUNCTION public.patient_outstanding(_patient_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER  AS $$
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

-- SOURCE: 20260802160412_7e713599-ebec-4c9d-b317-b79c0bf3c322.sql statement 3
REVOKE EXECUTE ON FUNCTION public.patient_outstanding(uuid) FROM PUBLIC, anon;

-- SOURCE: 20260802160412_7e713599-ebec-4c9d-b317-b79c0bf3c322.sql statement 4
GRANT EXECUTE ON FUNCTION public.patient_outstanding(uuid) TO authenticated, service_role;

-- SOURCE: 20260802160412_7e713599-ebec-4c9d-b317-b79c0bf3c322.sql statement 5
REVOKE EXECUTE ON FUNCTION public.has_wallet(text) FROM PUBLIC, anon;

-- SOURCE: 20260802160412_7e713599-ebec-4c9d-b317-b79c0bf3c322.sql statement 6
GRANT EXECUTE ON FUNCTION public.has_wallet(text) TO authenticated, service_role;

-- SOURCE: 20260802160412_7e713599-ebec-4c9d-b317-b79c0bf3c322.sql statement 7
CREATE OR REPLACE FUNCTION public.bill_admission_bed_days(_admission_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER  AS $function$
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

  -- Only wallet patients settle through their personal balance. Sponsored
  -- patients simply carry their copay as an outstanding invoice share.
  IF _wallet AND _copay > 0 THEN
    SELECT balance INTO _bal FROM public.patients WHERE id = (_adm).patient_id FOR UPDATE;
    _from_wallet := ROUND(LEAST(GREATEST(COALESCE(_bal,0),0), _copay), 2);
    _debt := ROUND(_copay - _from_wallet, 2);

    IF _from_wallet > 0 THEN
      SELECT public.adjust_patient_balance((_adm).patient_id, -_from_wallet, 'invoice_payment',
        NULL, NULL, _inv, 'Bed charge for admission (' || _days || ' night(s))');
    END IF;
    IF _debt > 0 THEN
      SELECT public.adjust_patient_balance((_adm).patient_id, -_debt, 'debt_incurred',
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

-- SOURCE: 20260802160412_7e713599-ebec-4c9d-b317-b79c0bf3c322.sql statement 8
CREATE OR REPLACE FUNCTION public.create_admitted_snap(_patient_id uuid, _order_type text, _target_station text, _photo_path text, _note text, _items jsonb, _total numeric, _allow_debt boolean DEFAULT false, _debt_reason text DEFAULT NULL::text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER  AS $function$
DECLARE
  _uid UUID := public.hms_current_user_id();
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
    SELECT set_config('app.allow_balance_write','on',true);
    UPDATE public.patients SET balance = _new_bal, updated_at = now() WHERE id = _patient_id;
    SELECT set_config('app.allow_balance_write','off',true);
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

-- SOURCE: 20260802160412_7e713599-ebec-4c9d-b317-b79c0bf3c322.sql statement 9
CREATE OR REPLACE FUNCTION public.admission_discharge_preview(_admission_id uuid)
RETURNS jsonb LANGUAGE plpgsql  SECURITY DEFINER  AS $function$
DECLARE
  _adm public.admissions; _p public.patients;
  _nights int; _rate numeric; _bed_total numeric;
  _pct numeric; _share numeric; _covered numeric;
  _bal numeric; _prior numeric; _already boolean; _due numeric;
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

  _bal   := COALESCE((_p).balance,0);
  _prior := public.patient_outstanding((_adm).patient_id);
  _due   := ROUND(_prior + _share, 2);

  RETURN jsonb_build_object(
    'admission_id', _admission_id,
    'patient_id', (_adm).patient_id,
    'admitted_at', COALESCE((_adm).admitted_at, (_adm).created_at),
    'account_type', (_p).account_type,
    'insurance_plan', (_p).insurance_plan,
    'has_wallet', public.has_wallet((_p).account_type),
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
    'balance_after_bed', ROUND(_bal - CASE WHEN public.has_wallet((_p).account_type) THEN _share ELSE 0 END, 2)
  );
END;
$function$;

-- SOURCE: 20260802160412_7e713599-ebec-4c9d-b317-b79c0bf3c322.sql statement 10
CREATE OR REPLACE FUNCTION public.discharge_admission(_admission_id uuid, _notes text DEFAULT NULL::text, _settlement_method text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0, _settlement_notes text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER  AS $function$
DECLARE
  _adm public.admissions; _p public.patients; _wallet boolean;
  _debt numeric; _collected numeric := 0; _remaining numeric := 0;
  _inv public.invoices; _apply numeric; _left numeric;
  _applied numeric := 0; _pct numeric; _share numeric;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(),
       ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to discharge';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF (_adm).status NOT IN ('active','ready_for_discharge') THEN
    RAISE EXCEPTION 'Admission is not active (%)', (_adm).status;
  END IF;

  SELECT public.bill_admission_bed_days(_admission_id);

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
      -- clear wallet debt first (cash/staff_family patients only)
      IF _wallet AND (_p).balance < 0 THEN
        SELECT public.adjust_patient_balance(
          (_adm).patient_id, LEAST(_collected, -(_p).balance), 'debt_cleared', _settlement_method,
          NULL, NULL, COALESCE(_settlement_notes,'Discharge settlement'));
      END IF;
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
      IF _remaining > 0 THEN
        IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
          RAISE EXCEPTION 'PARTIAL_REASON_REQUIRED: provide a reason for the outstanding %', _remaining;
        END IF;
        SELECT public.write_audit_log('discharge_partial_settlement', 'admission', _admission_id::text, jsonb_build_object('patient_id',(_adm).patient_id,'debt',_debt,'collected',_collected,
                             'outstanding',_remaining,'method',_settlement_method,'notes',_settlement_notes), 'success');
      END IF;

    ELSIF _settlement_method = 'waive' THEN
      IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]) THEN
        RAISE EXCEPTION 'Only accountant/admin can waive debt';
      END IF;
      IF _wallet AND (_p).balance < 0 THEN
        SELECT public.adjust_patient_balance((_adm).patient_id, -(_p).balance, 'debt_cleared', 'waive', NULL, NULL, COALESCE(_settlement_notes), 'success');
      END IF;
      _remaining := 0;

    ELSIF _settlement_method = 'carry' THEN
      IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
        RAISE EXCEPTION 'CARRY_REASON_REQUIRED: provide a reason for carrying the debt';
      END IF;
      SELECT public.write_audit_log('debt_carried_on_discharge', 'admission', _admission_id::text, jsonb_build_object('patient_id',(_adm).patient_id,'debt',_debt,'notes',_settlement_notes), 'success');
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  -- Apply money received (or the waiver) to the PATIENT SHARE of unpaid invoices, oldest first.
  _left := CASE WHEN _settlement_method IN ('cash','pos','transfer') THEN _collected
                WHEN _settlement_method = 'waive' THEN _debt ELSE 0 END;
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

  UPDATE public.admissions
     SET status='discharged', discharged_at=now(), discharged_by=public.hms_current_user_id(),
         discharge_notes=_notes, updated_at=now()
   WHERE id = _admission_id;

  IF (_adm).bed_id IS NOT NULL THEN
    UPDATE public.beds SET status='available', updated_at=now() WHERE id = (_adm).bed_id;
  END IF;

  UPDATE public.patients SET status='discharged', updated_at=now() WHERE id = (_adm).patient_id;

  SELECT public.write_audit_log('admission_discharged', 'admission', _admission_id::text, jsonb_build_object('patient_id',(_adm).patient_id,'notes',_notes,'debt',_debt,
                       'collected',_collected,'outstanding',_remaining,'method',_settlement_method), 'success');

  RETURN jsonb_build_object('debt',_debt,'collected',_collected,'outstanding',_remaining);
END;
$function$;

-- SOURCE: 20260802160412_7e713599-ebec-4c9d-b317-b79c0bf3c322.sql statement 11
REVOKE EXECUTE ON FUNCTION public.bill_admission_bed_days(uuid) FROM PUBLIC, anon;

-- SOURCE: 20260802160412_7e713599-ebec-4c9d-b317-b79c0bf3c322.sql statement 12
REVOKE EXECUTE ON FUNCTION public.create_admitted_snap(uuid,text,text,text,text,jsonb,numeric,boolean,text) FROM PUBLIC, anon;

-- SOURCE: 20260802160412_7e713599-ebec-4c9d-b317-b79c0bf3c322.sql statement 13
REVOKE EXECUTE ON FUNCTION public.admission_discharge_preview(uuid) FROM PUBLIC, anon;

-- SOURCE: 20260802160412_7e713599-ebec-4c9d-b317-b79c0bf3c322.sql statement 14
REVOKE EXECUTE ON FUNCTION public.discharge_admission(uuid,text,text,numeric,text) FROM PUBLIC, anon;

-- SOURCE: 20260802160412_7e713599-ebec-4c9d-b317-b79c0bf3c322.sql statement 15
GRANT EXECUTE ON FUNCTION public.bill_admission_bed_days(uuid) TO authenticated, service_role;

-- SOURCE: 20260802160412_7e713599-ebec-4c9d-b317-b79c0bf3c322.sql statement 16
GRANT EXECUTE ON FUNCTION public.create_admitted_snap(uuid,text,text,text,text,jsonb,numeric,boolean,text) TO authenticated, service_role;

-- SOURCE: 20260802160412_7e713599-ebec-4c9d-b317-b79c0bf3c322.sql statement 17
GRANT EXECUTE ON FUNCTION public.admission_discharge_preview(uuid) TO authenticated, service_role;

-- SOURCE: 20260802160412_7e713599-ebec-4c9d-b317-b79c0bf3c322.sql statement 18
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid,text,text,numeric,text) TO authenticated, service_role;

-- SOURCE: 20260802163046_dd69369a-7c26-4422-84ef-af7dfb800a41.sql statement 1
CREATE OR REPLACE FUNCTION public.apply_wallet_to_outstanding(_patient_id uuid, _note text DEFAULT 'Balance applied to outstanding bill')
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER

AS $function$
DECLARE
  _p public.patients; _pct numeric; _credit numeric; _applied numeric := 0;
  _inv public.invoices; _share numeric; _apply numeric;
BEGIN
  SELECT * INTO _p FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _p IS NULL THEN RETURN 0; END IF;
  IF NOT public.has_wallet((_p).account_type) THEN RETURN 0; END IF;

  _credit := ROUND(GREATEST(COALESCE((_p).balance,0), 0), 2);
  IF _credit <= 0 THEN RETURN 0; END IF;

  _pct := public.copay_percent((_p).account_type, (_p).insurance_plan);

  SELECT COALESCE(SUM(applied), 0) INTO _applied
  FROM (
    SELECT LEAST(share, GREATEST(_credit - prior_due, 0))::numeric AS applied
    FROM (
      SELECT ROUND(total_amount * _pct / 100.0, 2)::numeric AS share,
             GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)::numeric AS due,
             COALESCE(SUM(GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)) OVER (
               ORDER BY created_at ASC, id ASC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0)::numeric AS prior_due
      FROM public.invoices
      WHERE patient_id = _patient_id AND status IN ('pending','partial')
    ) unpaid
  ) allocation;

  IF _applied > 0 THEN
    WITH unpaid AS (
      SELECT id, total_amount, COALESCE(paid_amount, 0)::numeric AS paid,
             ROUND(total_amount * _pct / 100.0, 2)::numeric AS share,
             GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)::numeric AS due,
             COALESCE(SUM(GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)) OVER (
               ORDER BY created_at ASC, id ASC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0)::numeric AS prior_due
      FROM public.invoices
      WHERE patient_id = _patient_id AND status IN ('pending','partial')
    ), allocated AS (
      SELECT id, total_amount, paid, share,
             LEAST(due, GREATEST(_credit - prior_due, 0))::numeric AS applied
      FROM unpaid
    )
    UPDATE public.invoices i
       SET paid_amount = a.paid + a.applied,
           status = CASE WHEN a.paid + a.applied >= a.share THEN 'paid' ELSE 'partial' END,
           paid_at = CASE WHEN a.paid + a.applied >= a.share THEN now() ELSE i.paid_at END,
           payment_method = COALESCE(i.payment_method, 'wallet'),
           updated_at = now()
      FROM allocated a
     WHERE i.id = a.id AND a.applied > 0;

    SELECT public.adjust_patient_balance(_patient_id, -_applied, 'invoice_deduction',
      'wallet', NULL, NULL, _note);
  END IF;

  RETURN _applied;
END;
$function$;

-- SOURCE: 20260802163046_dd69369a-7c26-4422-84ef-af7dfb800a41.sql statement 2
REVOKE ALL ON FUNCTION public.apply_wallet_to_outstanding(uuid, text) FROM PUBLIC, anon;

-- SOURCE: 20260802163046_dd69369a-7c26-4422-84ef-af7dfb800a41.sql statement 3
GRANT EXECUTE ON FUNCTION public.apply_wallet_to_outstanding(uuid, text) TO service_role;

-- SOURCE: 20260802163046_dd69369a-7c26-4422-84ef-af7dfb800a41.sql statement 4
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

-- SOURCE: 20260802163046_dd69369a-7c26-4422-84ef-af7dfb800a41.sql statement 5
CREATE OR REPLACE FUNCTION public.discharge_admission(_admission_id uuid, _notes text DEFAULT NULL::text, _settlement_method text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0, _settlement_notes text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER

AS $function$
DECLARE
  _adm public.admissions; _p public.patients; _wallet boolean;
  _debt numeric; _collected numeric := 0; _remaining numeric := 0;
  _inv public.invoices; _apply numeric; _left numeric;
  _applied numeric := 0; _pct numeric; _share numeric;
  _wallet_used numeric := 0;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(),
       ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to discharge';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF (_adm).status NOT IN ('active','ready_for_discharge') THEN
    RAISE EXCEPTION 'Admission is not active (%)', (_adm).status;
  END IF;

  SELECT public.bill_admission_bed_days(_admission_id);

  -- Use whatever money the patient still has on account against the bill first
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
        IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
          RAISE EXCEPTION 'PARTIAL_REASON_REQUIRED: provide a reason for the outstanding %', _remaining;
        END IF;
        SELECT public.write_audit_log('discharge_partial_settlement', 'admission', _admission_id::text, jsonb_build_object('patient_id',(_adm).patient_id,'debt',_debt,'collected',_collected,
                             'outstanding',_remaining,'method',_settlement_method,'notes',_settlement_notes), 'success');
      END IF;

    ELSIF _settlement_method = 'waive' THEN
      IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]) THEN
        RAISE EXCEPTION 'Only accountant/admin can waive debt';
      END IF;
      IF _wallet AND (_p).balance < 0 THEN
        SELECT public.adjust_patient_balance((_adm).patient_id, -(_p).balance, 'debt_cleared', 'waive', NULL, NULL, COALESCE(_settlement_notes), 'success');
      END IF;
      _remaining := 0;

    ELSIF _settlement_method = 'carry' THEN
      IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
        RAISE EXCEPTION 'CARRY_REASON_REQUIRED: provide a reason for carrying the debt';
      END IF;
      SELECT public.write_audit_log('debt_carried_on_discharge', 'admission', _admission_id::text, jsonb_build_object('patient_id',(_adm).patient_id,'debt',_debt,'notes',_settlement_notes), 'success');
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  _left := CASE WHEN _settlement_method IN ('cash','pos','transfer') THEN _collected
                WHEN _settlement_method = 'waive' THEN _debt ELSE 0 END;
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

  UPDATE public.admissions
     SET status='discharged', discharged_at=now(), discharged_by=public.hms_current_user_id(),
         discharge_notes=_notes, updated_at=now()
   WHERE id = _admission_id;

  IF (_adm).bed_id IS NOT NULL THEN
    UPDATE public.beds SET status='available', updated_at=now() WHERE id = (_adm).bed_id;
  END IF;

  UPDATE public.patients SET status='discharged', updated_at=now() WHERE id = (_adm).patient_id;

  SELECT public.write_audit_log('admission_discharged', 'admission', _admission_id::text, jsonb_build_object('patient_id',(_adm).patient_id,'notes',_notes,'debt',_debt,
                       'wallet_applied',_wallet_used,'collected',_collected,
                       'outstanding',_remaining,'method',_settlement_method), 'success');

  RETURN jsonb_build_object('debt',_debt,'wallet_applied',_wallet_used,
                            'collected',_collected,'outstanding',_remaining);
END;
$function$;

-- SOURCE: 20260802163815_b0b4e344-ddae-4091-bf3f-8c19f028de19.sql statement 1
CREATE OR REPLACE FUNCTION public.discharge_admission(_admission_id uuid, _notes text DEFAULT NULL::text, _settlement_method text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0, _settlement_notes text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER

AS $function$
DECLARE
  _adm public.admissions; _p public.patients; _wallet boolean;
  _debt numeric; _collected numeric := 0; _remaining numeric := 0;
  _inv public.invoices; _apply numeric; _left numeric;
  _applied numeric := 0; _pct numeric; _share numeric;
  _wallet_used numeric := 0;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(),
       ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to discharge';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF (_adm).status NOT IN ('active','ready_for_discharge') THEN
    RAISE EXCEPTION 'Admission is not active (%)', (_adm).status;
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
        IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
          RAISE EXCEPTION 'PARTIAL_REASON_REQUIRED: provide a reason for the outstanding %', _remaining;
        END IF;
        SELECT public.write_audit_log('discharge_partial_settlement', 'admission', _admission_id::text, jsonb_build_object('patient_id',(_adm).patient_id,'debt',_debt,'collected',_collected,
                             'outstanding',_remaining,'method',_settlement_method,'notes',_settlement_notes), 'success');
      END IF;

    ELSIF _settlement_method = 'carry' THEN
      IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
        RAISE EXCEPTION 'CARRY_REASON_REQUIRED: provide a reason for carrying the debt';
      END IF;
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

  UPDATE public.admissions
     SET status='discharged', discharged_at=now(), discharged_by=public.hms_current_user_id(),
         discharge_notes=_notes, updated_at=now()
   WHERE id = _admission_id;

  IF (_adm).bed_id IS NOT NULL THEN
    UPDATE public.beds SET status='available', updated_at=now() WHERE id = (_adm).bed_id;
  END IF;

  UPDATE public.patients SET status='discharged', updated_at=now() WHERE id = (_adm).patient_id;

  SELECT public.write_audit_log('admission_discharged', 'admission', _admission_id::text, jsonb_build_object('patient_id',(_adm).patient_id,'notes',_notes,'debt',_debt,
                       'wallet_applied',_wallet_used,'collected',_collected,
                       'outstanding',_remaining,'method',_settlement_method), 'success');

  RETURN jsonb_build_object('debt',_debt,'wallet_applied',_wallet_used,
                            'collected',_collected,'outstanding',_remaining);
END;
$function$;

-- SOURCE: 20260802164453_49e8d420-af91-4570-bb60-a0595218614f.sql statement 1
CREATE OR REPLACE FUNCTION public.apply_wallet_to_outstanding(_patient_id uuid, _note text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER

AS $fn$
DECLARE
  _p public.patients; _pct numeric; _credit numeric; _applied numeric := 0;
  _inv public.invoices; _share numeric; _apply numeric;
BEGIN
  SELECT * INTO _p FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _p IS NULL THEN RETURN 0; END IF;
  IF NOT public.has_wallet((_p).account_type) THEN RETURN 0; END IF;

  _credit := ROUND(GREATEST(COALESCE((_p).balance,0), 0), 2);
  IF _credit <= 0 THEN RETURN 0; END IF;

  _pct := public.copay_percent((_p).account_type, (_p).insurance_plan);

  SELECT COALESCE(SUM(applied), 0) INTO _applied
  FROM (
    SELECT LEAST(share, GREATEST(_credit - prior_due, 0))::numeric AS applied
    FROM (
      SELECT ROUND(total_amount * _pct / 100.0, 2)::numeric AS share,
             GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)::numeric AS due,
             COALESCE(SUM(GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)) OVER (
               ORDER BY created_at ASC, id ASC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0)::numeric AS prior_due
      FROM public.invoices
      WHERE patient_id = _patient_id AND status IN ('pending','partial')
    ) unpaid
  ) allocation;

  IF _applied > 0 THEN
    WITH unpaid AS (
      SELECT id, total_amount, COALESCE(paid_amount, 0)::numeric AS paid,
             ROUND(total_amount * _pct / 100.0, 2)::numeric AS share,
             GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)::numeric AS due,
             COALESCE(SUM(GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)) OVER (
               ORDER BY created_at ASC, id ASC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0)::numeric AS prior_due
      FROM public.invoices
      WHERE patient_id = _patient_id AND status IN ('pending','partial')
    ), allocated AS (
      SELECT id, total_amount, paid, share,
             LEAST(due, GREATEST(_credit - prior_due, 0))::numeric AS applied
      FROM unpaid
    )
    UPDATE public.invoices i
       SET paid_amount = a.paid + a.applied,
           status = CASE WHEN a.paid + a.applied >= a.share THEN 'paid' ELSE 'partial' END,
           paid_at = CASE WHEN a.paid + a.applied >= a.share THEN now() ELSE i.paid_at END,
           payment_method = COALESCE(i.payment_method, 'wallet'),
           updated_at = now()
      FROM allocated a
     WHERE i.id = a.id AND a.applied > 0;

    SELECT public.adjust_patient_balance(_patient_id, -_applied, 'invoice_deduction',
      'wallet', NULL, NULL, _note);
  END IF;

  RETURN _applied;
END;
$fn$;

-- SOURCE: 20260802164453_49e8d420-af91-4570-bb60-a0595218614f.sql statement 2
REVOKE EXECUTE ON FUNCTION public.apply_wallet_to_outstanding(uuid, text) FROM PUBLIC, anon;

-- SOURCE: 20260802164453_49e8d420-af91-4570-bb60-a0595218614f.sql statement 3
GRANT EXECUTE ON FUNCTION public.apply_wallet_to_outstanding(uuid, text) TO authenticated;

-- SOURCE: 20260802172223_51010528-1a75-428a-9091-a95f808620f9.sql statement 1
CREATE OR REPLACE FUNCTION public.send_admission_to_cashier(_admission_id uuid, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER

AS $function$
DECLARE
  _uid uuid := public.hms_current_user_id();
  _adm public.admissions;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to send patient for discharge';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF (_adm).status = 'ready_for_discharge' THEN RETURN; END IF;
  IF (_adm).status <> 'active' THEN
    RAISE EXCEPTION 'Admission is not active (%)', (_adm).status;
  END IF;

  UPDATE public.admissions
     SET status = 'ready_for_discharge',
         ready_for_discharge_at = now(),
         ready_for_discharge_by = _uid,
         discharge_notes = COALESCE(_note, discharge_notes),
         updated_at = now()
   WHERE id = _admission_id;

  SELECT public.write_audit_log('discharge_sent_to_cashier', 'admission', _admission_id::text, jsonb_build_object('patient_id',(_adm).patient_id,'note',_note), 'success');
END $function$;

-- SOURCE: 20260802172223_51010528-1a75-428a-9091-a95f808620f9.sql statement 2
REVOKE ALL ON FUNCTION public.send_admission_to_cashier(uuid, text) FROM PUBLIC, anon;

-- SOURCE: 20260802172223_51010528-1a75-428a-9091-a95f808620f9.sql statement 3
GRANT EXECUTE ON FUNCTION public.send_admission_to_cashier(uuid, text) TO authenticated;

-- SOURCE: 20260802172223_51010528-1a75-428a-9091-a95f808620f9.sql statement 4
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
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(),
       ARRAY['cashier','billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only the cashier can settle and complete a discharge';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF (_adm).status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'Admission must be confirmed for discharge by the ward first (%)', (_adm).status;
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
        IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
          RAISE EXCEPTION 'PARTIAL_REASON_REQUIRED: provide a reason for the outstanding %', _remaining;
        END IF;
        SELECT public.write_audit_log('discharge_partial_settlement', 'admission', _admission_id::text, jsonb_build_object('patient_id',(_adm).patient_id,'debt',_debt,'collected',_collected,
                             'outstanding',_remaining,'method',_settlement_method,'notes',_settlement_notes), 'success');
      END IF;

    ELSIF _settlement_method = 'carry' THEN
      IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
        RAISE EXCEPTION 'CARRY_REASON_REQUIRED: provide a reason for carrying the debt';
      END IF;
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

  -- Overpayment stays as credit on the wallet unless the cashier pays it out
  IF _wallet AND _left > 0 THEN
    SELECT public.adjust_patient_balance(
      (_adm).patient_id, _left, 'topup', _settlement_method, NULL, NULL,
      'Change from discharge settlement left on balance');
    _credit := _left;
  END IF;

  -- Cashier hands cash back to the patient (refund out of wallet credit)
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
   WHERE id = _admission_id;

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

-- SOURCE: 20260802172223_51010528-1a75-428a-9091-a95f808620f9.sql statement 5
DROP FUNCTION IF EXISTS public.discharge_admission(uuid, text, text, numeric, text);

-- SOURCE: 20260802172223_51010528-1a75-428a-9091-a95f808620f9.sql statement 6
REVOKE ALL ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) FROM PUBLIC, anon;

-- SOURCE: 20260802172223_51010528-1a75-428a-9091-a95f808620f9.sql statement 7
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) TO authenticated;

-- SOURCE: 20260802173040_29a82fed-e183-4835-ae26-5d40cbe624fb.sql statement 1
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

  -- Reject concurrent double-submits (two cashiers / double click) outright
  -- instead of queueing them behind the row lock.
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
        IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
          RAISE EXCEPTION 'PARTIAL_REASON_REQUIRED: provide a reason for the outstanding %', _remaining;
        END IF;
        SELECT public.write_audit_log('discharge_partial_settlement', 'admission', _admission_id::text, jsonb_build_object('patient_id',(_adm).patient_id,'debt',_debt,'collected',_collected,
                             'outstanding',_remaining,'method',_settlement_method,'notes',_settlement_notes), 'success');
      END IF;

    ELSIF _settlement_method = 'carry' THEN
      IF _settlement_notes IS NULL OR length(trim(_settlement_notes)) < 3 THEN
        RAISE EXCEPTION 'CARRY_REASON_REQUIRED: provide a reason for carrying the debt';
      END IF;
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
