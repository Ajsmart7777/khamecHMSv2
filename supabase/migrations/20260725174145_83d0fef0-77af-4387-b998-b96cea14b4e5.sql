
-- Make contact_person and email optional (retainers only need name/phone/address)
ALTER TABLE public.corporate_accounts ALTER COLUMN contact_person DROP NOT NULL;
ALTER TABLE public.corporate_accounts ALTER COLUMN email DROP NOT NULL;

-- 1. Transactions table for corporate/retainer deposits, deductions, refunds
CREATE TABLE public.corporate_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id UUID NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('deposit','monthly_deduction','refund','adjustment','debt_incurred')),
  amount NUMERIC(14,2) NOT NULL,
  balance_before NUMERIC(14,2) NOT NULL,
  balance_after NUMERIC(14,2) NOT NULL,
  related_statement_id UUID REFERENCES public.sponsor_statements(id) ON DELETE SET NULL,
  notes TEXT,
  performed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.corporate_transactions TO authenticated;
GRANT ALL ON public.corporate_transactions TO service_role;

ALTER TABLE public.corporate_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Accountants & admins can view corporate transactions"
  ON public.corporate_transactions FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin','billing']::app_role[]));

CREATE POLICY "Accountants & admins can insert corporate transactions"
  ON public.corporate_transactions FOR INSERT
  TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]));

CREATE INDEX idx_corporate_transactions_sponsor ON public.corporate_transactions(sponsor_id, created_at DESC);

-- 2. close_retainer_month RPC
CREATE OR REPLACE FUNCTION public.close_retainer_month(
  _sponsor_id UUID,
  _year INT,
  _month INT,
  _notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _sponsor RECORD;
  _stmt_id UUID;
  _stmt RECORD;
  _bal_before NUMERIC(14,2);
  _deduct NUMERIC(14,2) := 0;
  _outstanding NUMERIC(14,2) := 0;
  _new_bal NUMERIC(14,2);
  _final_status TEXT;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _sponsor FROM public.corporate_accounts WHERE id = _sponsor_id FOR UPDATE;
  IF _sponsor.id IS NULL THEN RAISE EXCEPTION 'Sponsor not found'; END IF;
  IF _sponsor.account_type <> 'retainer' THEN
    RAISE EXCEPTION 'close_retainer_month only applies to retainer sponsors';
  END IF;

  -- Ensure a statement exists (generate if missing / regenerate if draft)
  SELECT id, status INTO _stmt_id, _final_status
    FROM public.sponsor_statements
    WHERE sponsor_id = _sponsor_id AND period_year = _year AND period_month = _month;

  IF _stmt_id IS NULL OR _final_status = 'draft' THEN
    _stmt_id := public.generate_sponsor_statement(_sponsor_id, _year, _month);
  END IF;

  SELECT * INTO _stmt FROM public.sponsor_statements WHERE id = _stmt_id FOR UPDATE;
  IF _stmt.status IN ('paid','void') THEN
    RAISE EXCEPTION 'Statement is already % — nothing to close', _stmt.status;
  END IF;

  _bal_before := _sponsor.balance;

  IF _bal_before >= _stmt.total_amount THEN
    _deduct := _stmt.total_amount;
    _outstanding := 0;
    _final_status := 'paid';
  ELSIF _bal_before > 0 THEN
    _deduct := _bal_before;
    _outstanding := _stmt.total_amount - _bal_before;
    _final_status := 'finalized';
  ELSE
    _deduct := 0;
    _outstanding := _stmt.total_amount;
    _final_status := 'finalized';
  END IF;

  _new_bal := _bal_before - _deduct;

  IF _deduct > 0 THEN
    UPDATE public.corporate_accounts
       SET balance = _new_bal, updated_at = now()
     WHERE id = _sponsor_id;

    INSERT INTO public.corporate_transactions
      (sponsor_id, transaction_type, amount, balance_before, balance_after,
       related_statement_id, notes, performed_by)
    VALUES
      (_sponsor_id, 'monthly_deduction', -_deduct, _bal_before, _new_bal,
       _stmt_id,
       COALESCE(_notes, 'Monthly deduction for ' || _year || '-' || lpad(_month::text,2,'0')),
       _uid);
  END IF;

  IF _outstanding > 0 THEN
    INSERT INTO public.corporate_transactions
      (sponsor_id, transaction_type, amount, balance_before, balance_after,
       related_statement_id, notes, performed_by)
    VALUES
      (_sponsor_id, 'debt_incurred', -_outstanding, _new_bal, _new_bal,
       _stmt_id,
       'Outstanding balance for ' || _year || '-' || lpad(_month::text,2,'0'),
       _uid);
  END IF;

  UPDATE public.sponsor_statements
     SET status = _final_status,
         finalized_at = COALESCE(finalized_at, now()),
         paid_at = CASE WHEN _final_status = 'paid' THEN now() ELSE paid_at END,
         notes = COALESCE(NULLIF(_notes,''), notes),
         updated_at = now()
   WHERE id = _stmt_id;

  PERFORM public.write_audit_log(
    'retainer_month_closed', 'sponsor_statement', _stmt_id::text,
    jsonb_build_object(
      'sponsor_id', _sponsor_id,
      'sponsor_name', _sponsor.company_name,
      'year', _year, 'month', _month,
      'total_amount', _stmt.total_amount,
      'deducted', _deduct,
      'outstanding', _outstanding,
      'final_status', _final_status
    )
  );

  RETURN jsonb_build_object(
    'statement_id', _stmt_id,
    'total_amount', _stmt.total_amount,
    'deducted', _deduct,
    'outstanding', _outstanding,
    'balance_after', _new_bal,
    'final_status', _final_status
  );
END;
$$;

-- 3. Deposit helper (audited)
CREATE OR REPLACE FUNCTION public.retainer_deposit(
  _sponsor_id UUID,
  _amount NUMERIC,
  _notes TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _sponsor RECORD;
  _new_bal NUMERIC(14,2);
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  SELECT * INTO _sponsor FROM public.corporate_accounts WHERE id = _sponsor_id FOR UPDATE;
  IF _sponsor.id IS NULL THEN RAISE EXCEPTION 'Sponsor not found'; END IF;

  _new_bal := _sponsor.balance + _amount;

  UPDATE public.corporate_accounts
     SET balance = _new_bal, updated_at = now()
   WHERE id = _sponsor_id;

  INSERT INTO public.corporate_transactions
    (sponsor_id, transaction_type, amount, balance_before, balance_after, notes, performed_by)
  VALUES
    (_sponsor_id, 'deposit', _amount, _sponsor.balance, _new_bal, _notes, _uid);

  PERFORM public.write_audit_log(
    'sponsor_deposit', 'corporate_account', _sponsor_id::text,
    jsonb_build_object('amount', _amount, 'new_balance', _new_bal, 'notes', _notes)
  );

  RETURN _new_bal;
END;
$$;
