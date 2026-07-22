
-- allow negative balances (already permitted at ledger level; drop table CHECK)
ALTER TABLE public.patients DROP CONSTRAINT IF EXISTS check_balance_non_negative;

-- ward-level minimum admission deposit
ALTER TABLE public.wards ADD COLUMN IF NOT EXISTS min_admission_deposit NUMERIC(12,2) NOT NULL DEFAULT 0;

-- snap_orders: fields for admitted in-ward flow
ALTER TABLE public.snap_orders
  ADD COLUMN IF NOT EXISTS is_admitted_snap BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS debt_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS debt_reason TEXT;

-- widen status check to include 'held_no_balance'
ALTER TABLE public.snap_orders DROP CONSTRAINT IF EXISTS snap_orders_status_check;
ALTER TABLE public.snap_orders ADD CONSTRAINT snap_orders_status_check
  CHECK (status = ANY (ARRAY[
    'pending_billing','awaiting_payment','paid','fulfilled','rejected','cancelled',
    'returned','acknowledged','held_no_balance'
  ]));

-- widen transaction_type to include admitted_deduction
ALTER TABLE public.balance_transactions DROP CONSTRAINT IF EXISTS balance_transactions_transaction_type_check;
ALTER TABLE public.balance_transactions ADD CONSTRAINT balance_transactions_transaction_type_check
  CHECK (transaction_type = ANY (ARRAY[
    'topup','refund','invoice_deduction','staff_family_coverage','staff_coverage',
    'adjustment','debt_incurred','debt_cleared','admitted_deduction'
  ]));

-- RPC: create in-ward snap for admitted patient, deducting from balance
CREATE OR REPLACE FUNCTION public.create_admitted_snap(
  _patient_id UUID,
  _order_type TEXT,
  _target_station TEXT,
  _photo_path TEXT,
  _note TEXT,
  _items JSONB,
  _total NUMERIC,
  _allow_debt BOOLEAN DEFAULT false,
  _debt_reason TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _visit UUID;
  _admission UUID;
  _bal NUMERIC;
  _snap_id UUID;
  _new_bal NUMERIC;
  _debt NUMERIC := 0;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT id INTO _admission FROM public.admissions
   WHERE patient_id = _patient_id AND status = 'active' LIMIT 1;
  IF _admission IS NULL THEN
    RAISE EXCEPTION 'Patient is not currently admitted';
  END IF;

  SELECT id INTO _visit FROM public.visits
   WHERE patient_id = _patient_id AND status = 'open'
   ORDER BY opened_at DESC LIMIT 1;

  SELECT balance INTO _bal FROM public.patients WHERE id = _patient_id FOR UPDATE;
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

  -- Deduct (allowed to go negative when overriding)
  _new_bal := _bal - _total;
  UPDATE public.patients SET balance = _new_bal, updated_at = now() WHERE id = _patient_id;
  INSERT INTO public.balance_transactions
    (patient_id, transaction_type, amount, balance_before, balance_after, performed_by, notes)
  VALUES
    (_patient_id, CASE WHEN _debt > 0 THEN 'debt_incurred' ELSE 'admitted_deduction' END,
     -_total, _bal, _new_bal, _uid,
     CASE WHEN _debt > 0
          THEN 'Admitted in-ward ' || _order_type || ' (debt ₦' || _debt || '): ' || COALESCE(_debt_reason,'')
          ELSE 'Admitted in-ward ' || _order_type END);

  INSERT INTO public.snap_orders (
    patient_id, visit_id, order_type, target_station, source_role,
    photo_path, note, matched_items, status, created_by,
    is_admitted_snap, debt_amount, debt_reason,
    billed_by, billed_at, paid_at, original_sender_role
  ) VALUES (
    _patient_id, _visit, _order_type, _target_station,
    (SELECT role::text FROM public.user_roles WHERE user_id = _uid LIMIT 1),
    _photo_path, _note, COALESCE(_items, '[]'::jsonb),
    'paid', _uid, true, _debt, _debt_reason,
    _uid, now(), now(),
    (SELECT role::text FROM public.user_roles WHERE user_id = _uid LIMIT 1)
  ) RETURNING id INTO _snap_id;

  PERFORM public.write_audit_log(
    CASE WHEN _debt > 0 THEN 'admitted_snap_debt' ELSE 'admitted_snap_created' END,
    'snap_order', _snap_id::text,
    jsonb_build_object(
      'patient_id', _patient_id, 'total', _total, 'debt', _debt,
      'balance_after', _new_bal, 'reason', _debt_reason,
      'target_station', _target_station, 'order_type', _order_type
    )
  );

  RETURN _snap_id;
END; $$;

REVOKE ALL ON FUNCTION public.create_admitted_snap(UUID,TEXT,TEXT,TEXT,TEXT,JSONB,NUMERIC,BOOLEAN,TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_admitted_snap(UUID,TEXT,TEXT,TEXT,TEXT,JSONB,NUMERIC,BOOLEAN,TEXT) TO authenticated;
