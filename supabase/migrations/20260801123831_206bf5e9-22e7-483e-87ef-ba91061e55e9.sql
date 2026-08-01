CREATE OR REPLACE FUNCTION public.create_admitted_snap(_patient_id uuid, _order_type text, _target_station text, _photo_path text, _note text, _items jsonb, _total numeric, _allow_debt boolean DEFAULT false, _debt_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid UUID := auth.uid();
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
  PERFORM set_config('app.allow_balance_write', 'on', true);
  UPDATE public.patients SET balance = _new_bal, updated_at = now() WHERE id = _patient_id;
  PERFORM set_config('app.allow_balance_write', 'off', true);
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

  PERFORM public.write_audit_log(
    CASE WHEN _debt > 0 THEN 'admitted_snap_debt' ELSE 'admitted_snap_created' END,
    'snap_order', _snap_id::text,
    jsonb_build_object(
      'patient_id', _patient_id, 'total', _total, 'debt', _debt,
      'balance_after', _new_bal, 'reason', _debt_reason,
      'invoice_id', _invoice,
      'target_station', _target_station, 'order_type', _order_type
    )
  );

  RETURN _snap_id;
END; $function$;

REVOKE EXECUTE ON FUNCTION public.create_admitted_snap(uuid,text,text,text,text,jsonb,numeric,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_admitted_snap(uuid,text,text,text,text,jsonb,numeric,boolean,text) TO authenticated, service_role;