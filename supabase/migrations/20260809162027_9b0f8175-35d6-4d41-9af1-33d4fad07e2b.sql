CREATE OR REPLACE FUNCTION public.settle_invoice_atomic(
  _invoice_id uuid,
  _cash_amount numeric DEFAULT 0,
  _balance_amount numeric DEFAULT 0,
  _debt_amount numeric DEFAULT 0,
  _payment_method text DEFAULT 'cash',
  _notes text DEFAULT NULL,
  _sponsored boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice invoices%ROWTYPE;
  v_new_balance numeric;
  v_collected numeric;
  v_available numeric;
BEGIN
  IF NOT public.is_authenticated_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _cash_amount < 0 OR _balance_amount < 0 OR _debt_amount < 0 THEN
    RAISE EXCEPTION 'Amounts must be non-negative';
  END IF;

  -- Lock the invoice row for the duration of the transaction.
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = _invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_invoice.status = 'paid' THEN
    RAISE EXCEPTION 'Invoice already settled';
  END IF;

  -- Deduct from wallet balance (with concurrency-safe check).
  IF _balance_amount > 0 THEN
    SELECT balance INTO v_available
    FROM public.patients
    WHERE id = v_invoice.patient_id
    FOR UPDATE;

    IF v_available IS NULL OR v_available < _balance_amount THEN
      RAISE EXCEPTION 'Insufficient wallet balance (available: %, requested: %)',
        COALESCE(v_available, 0), _balance_amount;
    END IF;

    PERFORM public.adjust_patient_balance(
      v_invoice.patient_id,
      -_balance_amount,
      'invoice_deduction',
      'balance',
      NULL,
      _invoice_id,
      COALESCE(_notes, format('Applied to invoice %s', v_invoice.invoice_number))
    );
  END IF;

  -- Record shortfall as patient debt for cash accounts.
  IF _debt_amount > 0 THEN
    PERFORM public.adjust_patient_balance(
      v_invoice.patient_id,
      -_debt_amount,
      'debt_incurred',
      _payment_method,
      NULL,
      _invoice_id,
      format('Shortfall on invoice %s', v_invoice.invoice_number)
    );
  END IF;

  -- Handle overpayment (only for non-sponsored cash patients)
  IF NOT _sponsored AND (_cash_amount + _balance_amount) > (v_invoice.total_amount - COALESCE(v_invoice.paid_amount, 0)) THEN
    DECLARE
      v_overpayment numeric;
    BEGIN
      v_overpayment := (_cash_amount + _balance_amount) - (v_invoice.total_amount - COALESCE(v_invoice.paid_amount, 0));
      PERFORM public.adjust_patient_balance(
        v_invoice.patient_id,
        v_overpayment,
        'overpayment_credit',
        _payment_method,
        NULL,
        _invoice_id,
        format('Overpayment on invoice %s', v_invoice.invoice_number)
      );
    END;
  END IF;

  v_collected := COALESCE(v_invoice.paid_amount, 0) + _cash_amount + _balance_amount;

  UPDATE public.invoices
  SET paid_amount    = v_collected,
      status         = 'paid',
      payment_method = _payment_method,
      paid_at        = now(),
      notes          = COALESCE(_notes, notes),
      updated_at     = now()
  WHERE id = _invoice_id;

  SELECT balance INTO v_new_balance FROM public.patients WHERE id = v_invoice.patient_id;

  RETURN jsonb_build_object(
    'invoice_id',       _invoice_id,
    'invoice_number',   v_invoice.invoice_number,
    'patient_id',       v_invoice.patient_id,
    'collected',        v_collected,
    'cash_amount',      _cash_amount,
    'balance_amount',   _balance_amount,
    'debt_amount',      _debt_amount,
    'new_wallet_balance', v_new_balance,
    'sponsored',        _sponsored
  );
END;
$$;