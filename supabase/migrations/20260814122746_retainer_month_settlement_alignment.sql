-- Simplified Retainer month-end settlement: record company funding with a payment trail
-- and apply available Retainer credit to a specific finalized monthly statement.

ALTER TABLE public.corporate_transactions
  ADD COLUMN IF NOT EXISTS transaction_date date;

UPDATE public.corporate_transactions
SET transaction_date = created_at::date
WHERE transaction_date IS NULL;

ALTER TABLE public.corporate_transactions
  ALTER COLUMN transaction_date SET DEFAULT CURRENT_DATE,
  ALTER COLUMN transaction_date SET NOT NULL;

ALTER TABLE public.corporate_transactions
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS bank_reference text;

CREATE INDEX IF NOT EXISTS idx_corporate_transactions_sponsor_transaction_date
  ON public.corporate_transactions (sponsor_id, transaction_date DESC, created_at DESC);

-- Keep the legacy three-argument function available for any existing caller.
CREATE OR REPLACE FUNCTION public.retainer_deposit(
  _sponsor_id uuid,
  _amount numeric,
  _notes text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _sponsor record;
  _new_bal numeric(14,2);
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  SELECT * INTO _sponsor
  FROM public.corporate_accounts
  WHERE id = _sponsor_id
  FOR UPDATE;

  IF _sponsor.id IS NULL THEN
    RAISE EXCEPTION 'Sponsor not found';
  END IF;
  IF _sponsor.account_type <> 'retainer' THEN
    RAISE EXCEPTION 'Retainer deposits only apply to retainer sponsors';
  END IF;

  _new_bal := _sponsor.balance + _amount;

  UPDATE public.corporate_accounts
  SET balance = _new_bal, updated_at = now()
  WHERE id = _sponsor_id;

  INSERT INTO public.corporate_transactions (
    sponsor_id, transaction_type, amount, balance_before, balance_after,
    transaction_date, payment_method, bank_reference, notes, performed_by
  ) VALUES (
    _sponsor_id, 'deposit', _amount, _sponsor.balance, _new_bal,
    CURRENT_DATE, 'bank_transfer', NULL, _notes, _uid
  );

  PERFORM public.write_audit_log(
    'sponsor_deposit', 'corporate_account', _sponsor_id::text,
    jsonb_build_object('amount', _amount, 'new_balance', _new_bal, 'notes', _notes)
  );

  RETURN _new_bal;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_retainer_statement(
  _statement_id uuid,
  _amount_received numeric,
  _payment_date date,
  _payment_method text DEFAULT 'bank_transfer',
  _bank_reference text DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _statement record;
  _sponsor record;
  _balance_before numeric(14,2);
  _balance_after_receipt numeric(14,2);
  _balance_after_application numeric(14,2);
  _already_applied numeric(14,2) := 0;
  _outstanding_before numeric(14,2) := 0;
  _applied_now numeric(14,2) := 0;
  _outstanding_after numeric(14,2) := 0;
  _final_status text;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _amount_received IS NULL OR _amount_received < 0 THEN
    RAISE EXCEPTION 'Received amount cannot be negative';
  END IF;
  IF _payment_date IS NULL THEN
    RAISE EXCEPTION 'Payment date is required';
  END IF;

  SELECT ss.*, ca.company_name, ca.account_type, ca.balance AS sponsor_balance
  INTO _statement
  FROM public.sponsor_statements ss
  JOIN public.corporate_accounts ca ON ca.id = ss.sponsor_id
  WHERE ss.id = _statement_id
  FOR UPDATE OF ss, ca;

  IF _statement.id IS NULL THEN
    RAISE EXCEPTION 'Statement not found';
  END IF;
  IF _statement.account_type <> 'retainer' THEN
    RAISE EXCEPTION 'This settlement workflow only applies to retainer statements';
  END IF;
  IF _statement.status IN ('paid', 'void') THEN
    RAISE EXCEPTION 'Statement is already % — no further settlement can be applied', _statement.status;
  END IF;

  SELECT COALESCE(SUM(-amount), 0)
  INTO _already_applied
  FROM public.corporate_transactions
  WHERE related_statement_id = _statement_id
    AND transaction_type = 'monthly_deduction';

  _outstanding_before := GREATEST(_statement.total_amount - _already_applied, 0);
  _balance_before := _statement.sponsor_balance;
  _balance_after_receipt := _balance_before;

  IF _amount_received > 0 THEN
    _balance_after_receipt := _balance_before + _amount_received;

    UPDATE public.corporate_accounts
    SET balance = _balance_after_receipt, updated_at = now()
    WHERE id = _statement.sponsor_id;

    INSERT INTO public.corporate_transactions (
      sponsor_id, transaction_type, amount, balance_before, balance_after,
      related_statement_id, transaction_date, payment_method, bank_reference, notes, performed_by
    ) VALUES (
      _statement.sponsor_id, 'deposit', _amount_received, _balance_before, _balance_after_receipt,
      _statement_id, _payment_date, COALESCE(NULLIF(_payment_method, ''), 'bank_transfer'),
      NULLIF(_bank_reference, ''), NULLIF(_notes, ''), _uid
    );
  END IF;

  _applied_now := LEAST(_balance_after_receipt, _outstanding_before);
  _balance_after_application := _balance_after_receipt - _applied_now;
  _outstanding_after := _outstanding_before - _applied_now;
  _final_status := CASE WHEN _outstanding_after = 0 THEN 'paid' ELSE 'finalized' END;

  IF _applied_now > 0 THEN
    UPDATE public.corporate_accounts
    SET balance = _balance_after_application, updated_at = now()
    WHERE id = _statement.sponsor_id;

    INSERT INTO public.corporate_transactions (
      sponsor_id, transaction_type, amount, balance_before, balance_after,
      related_statement_id, transaction_date, payment_method, bank_reference, notes, performed_by
    ) VALUES (
      _statement.sponsor_id, 'monthly_deduction', -_applied_now,
      _balance_after_receipt, _balance_after_application,
      _statement_id, _payment_date, NULL, NULL,
      COALESCE(NULLIF(_notes, ''), 'Retainer funding applied to statement ' || _statement.statement_number), _uid
    );
  END IF;

  UPDATE public.sponsor_statements
  SET status = _final_status,
      finalized_at = COALESCE(finalized_at, now()),
      paid_at = CASE WHEN _final_status = 'paid' THEN now() ELSE paid_at END,
      updated_at = now()
  WHERE id = _statement_id;

  PERFORM public.write_audit_log(
    'retainer_statement_settled', 'sponsor_statement', _statement_id::text,
    jsonb_build_object(
      'sponsor_id', _statement.sponsor_id,
      'statement_number', _statement.statement_number,
      'amount_received', _amount_received,
      'applied_now', _applied_now,
      'outstanding_after', _outstanding_after,
      'available_deposit_balance', _balance_after_application,
      'payment_date', _payment_date,
      'payment_method', _payment_method,
      'bank_reference', NULLIF(_bank_reference, '')
    )
  );

  RETURN jsonb_build_object(
    'statement_id', _statement_id,
    'received', _amount_received,
    'applied', _applied_now,
    'outstanding', _outstanding_after,
    'available_deposit_balance', _balance_after_application,
    'credit', GREATEST(_balance_after_application, 0),
    'status', _final_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_retainer_statement(uuid, numeric, date, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.settle_retainer_statement(uuid, numeric, date, text, text, text) IS
  'Records Retainer company funding with payment details and applies available Retainer balance to one open monthly statement.';
