
-- Fix signature mismatch for public.adjust_patient_balance and enhance refund logic
-- The existing migrations have a conflict between (uuid, numeric, text, text, uuid, uuid, text) 
-- and how it's being called in refund_invoice_item.

-- Drop existing variants to ensure clean state
DROP FUNCTION IF EXISTS public.adjust_patient_balance(uuid, numeric, text, text, uuid, uuid, text);

-- Recreate with standard signature used in modern migrations
CREATE OR REPLACE FUNCTION public.adjust_patient_balance(
    _patient_id uuid,
    _delta numeric,
    _transaction_type text,
    _payment_method text DEFAULT NULL::text,
    _related_request_id uuid DEFAULT NULL::uuid,
    _related_invoice_id uuid DEFAULT NULL::uuid,
    _notes text DEFAULT NULL::text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _before NUMERIC;
  _after NUMERIC;
BEGIN
  SELECT balance INTO _before FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _before IS NULL THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;
  
  _after := _before + _delta;
  
  -- Only 'debt_incurred' transactions may push balance negative
  IF _after < 0 AND _transaction_type <> 'debt_incurred' THEN
    RAISE EXCEPTION 'Insufficient balance (current: %, requested delta: %)', _before, _delta;
  END IF;

  -- Bypass the RLS trigger if it exists
  PERFORM set_config('app.allow_balance_write', 'on', true);
  UPDATE public.patients SET balance = _after, updated_at = now() WHERE id = _patient_id;
  PERFORM set_config('app.allow_balance_write', 'off', true);

  INSERT INTO public.balance_transactions
    (patient_id, transaction_type, amount, balance_before, balance_after, payment_method, related_request_id, related_invoice_id, performed_by, notes)
  VALUES
    (_patient_id, _transaction_type, _delta, _before, _after, _payment_method, _related_request_id, _related_invoice_id, auth.uid(), _notes);

  RETURN _after;
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_patient_balance(uuid, numeric, text, text, uuid, uuid, text) TO authenticated, service_role;

-- Now fix the refund_invoice_item function to call adjust_patient_balance with the CORRECT argument order
CREATE OR REPLACE FUNCTION public.refund_invoice_item(
    _item_id uuid,
    _payment_method text DEFAULT 'balance'
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _item_total numeric;
    _patient_id uuid;
    _invoice_id uuid;
    _item_desc text;
    _new_balance numeric;
    _is_sponsored boolean;
    _current_status text;
    _account_type text;
BEGIN
    -- Check if eligible and current status
    SELECT ii.total, i.patient_id, ii.invoice_id, ii.description, (i.sponsor_type IS NOT NULL), ii.dispensing_status, p.account_type
    INTO _item_total, _patient_id, _invoice_id, _item_desc, _is_sponsored, _current_status, _account_type
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    JOIN public.patients p ON p.id = i.patient_id
    WHERE ii.id = _item_id;

    IF _current_status = 'refunded' THEN
        RAISE EXCEPTION 'Item has already been refunded';
    END IF;

    IF _current_status NOT IN ('unavailable', 'refund_requested', 'refund_pending') THEN
        RAISE EXCEPTION 'Item not eligible for refund (current status: %)', _current_status;
    END IF;

    -- Mark as refunded
    UPDATE public.invoice_items
    SET dispensing_status = 'refunded',
        dispensing_updated_at = now(),
        dispensing_updated_by = auth.uid()
    WHERE id = _item_id;

    -- For Cash/Wallet patients, credit their balance if method is 'balance' or 'leave_in_balance'
    IF NOT _is_sponsored AND (_payment_method = 'balance' OR _payment_method = 'leave_in_balance') THEN
        -- Corrected call order: patient_id, delta, type, method, request, invoice, notes
        SELECT public.adjust_patient_balance(
            _patient_id,
            _item_total,
            'topup',
            'cash',
            null,
            _invoice_id,
            'Refund for not given item: ' || _item_desc
        ) INTO _new_balance;
    ELSE
        SELECT balance INTO _new_balance FROM public.patients WHERE id = _patient_id;
    END IF;

    PERFORM public.write_audit_log(
        'item_refunded',
        jsonb_build_object('item_id', _item_id, 'amount', _item_total, 'method', _payment_method, 'is_sponsored', _is_sponsored),
        _invoice_id,
        'invoices'
    );

    RETURN json_build_object(
        'success', true,
        'amount', _item_total,
        'new_balance', _new_balance,
        'is_sponsored', _is_sponsored
    );
END;
$$;
