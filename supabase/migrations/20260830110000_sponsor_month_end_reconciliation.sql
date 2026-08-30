-- Professional sponsor month-end reconciliation.
-- Corporate overpayments remain report-level credit; they do not change account balance.

ALTER TABLE public.sponsor_statements
  ADD COLUMN IF NOT EXISTS previous_outstanding NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_applied NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_used NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_due NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coverage_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (coverage_status IN ('unpaid','partial','covered','credit'));

CREATE INDEX IF NOT EXISTS idx_sponsor_statements_reconciliation
  ON public.sponsor_statements(sponsor_id, period_year, period_month, status);

CREATE OR REPLACE FUNCTION public.close_corporate_month(
  _sponsor_id UUID,
  _year INT,
  _month INT,
  _notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _uid UUID := auth.uid();
  _statement_id UUID;
  _statement_total NUMERIC(14,2) := 0;
  _statement_status TEXT;
  _prior_outstanding NUMERIC(14,2) := 0;
  _prior_credit NUMERIC(14,2) := 0;
  _credit_applied NUMERIC(14,2) := 0;
  _amount_due NUMERIC(14,2) := 0;
  _paid NUMERIC(14,2) := 0;
  _coverage TEXT := 'unpaid';
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _month NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Invalid statement month';
  END IF;

  SELECT s.id, s.total_amount, s.status
    INTO _statement_id, _statement_total, _statement_status
    FROM public.sponsor_statements s
   WHERE s.sponsor_id = _sponsor_id
     AND s.sponsor_type = 'corporate'
     AND s.period_year = _year
     AND s.period_month = _month
   FOR UPDATE;

  IF _statement_id IS NULL OR _statement_status = 'draft' THEN
    _statement_id := public.generate_sponsor_statement(_sponsor_id, _year, _month);
    SELECT s.id, s.total_amount, s.status
      INTO _statement_id, _statement_total, _statement_status
      FROM public.sponsor_statements s
     WHERE s.id = _statement_id
     FOR UPDATE;
  ELSIF _statement_status IN ('void','paid') THEN
    RAISE EXCEPTION 'Statement is already % and cannot be closed', _statement_status;
  END IF;

  SELECT COALESCE(SUM(GREATEST(s.total_amount - COALESCE(p.paid_amount, 0), 0)), 0),
         COALESCE(SUM(GREATEST(COALESCE(p.paid_amount, 0) - s.total_amount - COALESCE(s.credit_used, 0), 0)), 0)
    INTO _prior_outstanding, _prior_credit
    FROM public.sponsor_statements s
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(cp.amount), 0)::NUMERIC(14,2) AS paid_amount
        FROM public.corporate_statement_payments cp
       WHERE cp.statement_id = s.id
    ) p ON TRUE
   WHERE s.sponsor_id = _sponsor_id
     AND s.sponsor_type = 'corporate'
     AND s.status <> 'void'
     AND (s.period_year < _year OR (s.period_year = _year AND s.period_month < _month));

  _credit_applied := LEAST(_prior_credit, _prior_outstanding + COALESCE(_statement_total, 0));
  _amount_due := GREATEST(_prior_outstanding + COALESCE(_statement_total, 0) - _credit_applied, 0);

    SELECT COALESCE(SUM(cp.amount), 0) INTO _paid
    FROM public.corporate_statement_payments cp
   WHERE cp.statement_id = _statement_id;

  IF _paid >= _amount_due AND _amount_due > 0 THEN
    _coverage := CASE WHEN _paid > _amount_due THEN 'credit' ELSE 'covered' END;
  ELSIF _paid > 0 THEN
    _coverage := 'partial';
  ELSE
    _coverage := CASE WHEN _amount_due = 0 AND _statement_total = 0 THEN 'covered' ELSE 'unpaid' END;
  END IF;

  UPDATE public.sponsor_statements
     SET previous_outstanding = _prior_outstanding,
         credit_applied = _credit_applied,
         credit_used = _credit_applied,
         amount_due = _amount_due,
         coverage_status = _coverage,
         status = CASE WHEN _coverage IN ('covered','credit') THEN 'paid' ELSE 'finalized' END,
         finalized_at = COALESCE(finalized_at, now()),
         paid_at = CASE WHEN _coverage IN ('covered','credit') THEN COALESCE(paid_at, now()) ELSE paid_at END,
         notes = COALESCE(NULLIF(_notes, ''), notes),
         updated_at = now()
   WHERE id = _statement_id;

  PERFORM public.write_audit_log(
    'corporate_month_closed', 'sponsor_statement', _statement_id::text,
    jsonb_build_object(
      'sponsor_id', _sponsor_id, 'year', _year, 'month', _month,
      'current_billing', _statement_total,
      'previous_outstanding', _prior_outstanding,
      'credit_applied', _credit_applied,
      'amount_due', _amount_due,
      'paid_to_date', _paid,
      'coverage_status', _coverage
    )
  );

  RETURN jsonb_build_object(
    'statement_id', _statement_id,
    'current_billing', _statement_total,
    'previous_outstanding', _prior_outstanding,
    'credit_applied', _credit_applied,
    'amount_due', _amount_due,
    'paid_to_date', _paid,
    'coverage_status', _coverage
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.close_corporate_month(UUID, INT, INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_corporate_month(UUID, INT, INT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_corporate_statement_payment(
  _statement_id UUID,
  _payment_date DATE,
  _amount NUMERIC,
  _payment_method TEXT DEFAULT 'bank_transfer',
  _bank_reference TEXT DEFAULT NULL,
  _notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _uid UUID := auth.uid();
  _statement_sponsor_id UUID;
  _statement_sponsor_type TEXT;
  _statement_total NUMERIC(14,2);
  _statement_status TEXT;
  _paid_total NUMERIC(14,2);
  _due NUMERIC(14,2);
  _new_status TEXT;
  _payment_id UUID;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['accountant','admin']::app_role[]) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Payment amount must be greater than zero'; END IF;
  IF _payment_date IS NULL THEN RAISE EXCEPTION 'Payment date is required'; END IF;
  IF _payment_method NOT IN ('bank_transfer','cash','cheque','pos','other') THEN RAISE EXCEPTION 'Unsupported payment method'; END IF;

  SELECT sponsor_id, sponsor_type, total_amount, amount_due, status
    INTO _statement_sponsor_id, _statement_sponsor_type, _statement_total, _due, _statement_status
    FROM public.sponsor_statements
   WHERE id = _statement_id
   FOR UPDATE;
  IF _statement_sponsor_id IS NULL OR _statement_sponsor_type <> 'corporate' THEN RAISE EXCEPTION 'Corporate statement not found'; END IF;
  IF _statement_status IN ('draft','void') THEN RAISE EXCEPTION 'Finalize the statement before recording a payment'; END IF;

  _due := GREATEST(COALESCE(NULLIF(_due, 0), _statement_total), 0);
  INSERT INTO public.corporate_statement_payments(statement_id, sponsor_id, payment_date, amount, payment_method, bank_reference, notes, recorded_by)
  VALUES (_statement_id, _statement_sponsor_id, _payment_date, _amount, _payment_method, NULLIF(btrim(_bank_reference), ''), NULLIF(btrim(_notes), ''), _uid)
  RETURNING id INTO _payment_id;

  SELECT COALESCE(SUM(amount), 0) INTO _paid_total FROM public.corporate_statement_payments WHERE statement_id = _statement_id;
  _new_status := CASE WHEN _paid_total > _due THEN 'credit' WHEN _paid_total >= _due THEN 'covered' ELSE 'partial' END;

  UPDATE public.sponsor_statements
     SET coverage_status = _new_status,
         status = CASE WHEN _new_status IN ('covered','credit') THEN 'paid' ELSE 'finalized' END,
         paid_at = CASE WHEN _new_status IN ('covered','credit') THEN COALESCE(paid_at, now()) ELSE paid_at END,
         updated_at = now()
   WHERE id = _statement_id;

  RETURN jsonb_build_object(
    'payment_id', _payment_id, 'statement_id', _statement_id,
    'paid_to_date', _paid_total, 'amount_due', _due,
    'balance', _due - _paid_total,
    'credit', GREATEST(_paid_total - _due, 0), 'status', _new_status
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_corporate_statement_payment(UUID, DATE, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_corporate_statement_payment(UUID, DATE, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON COLUMN public.sponsor_statements.previous_outstanding IS 'Outstanding balance carried from earlier sponsor statements, shown separately from current-month billing.';
COMMENT ON COLUMN public.sponsor_statements.credit_applied IS 'Prior overpayment credit applied to this period; corporate credit remains report-level and does not alter account balance.';
COMMENT ON COLUMN public.sponsor_statements.credit_used IS 'Corporate report-level credit consumed by this statement; prevents the same overpayment from being carried forward twice.';
COMMENT ON COLUMN public.sponsor_statements.amount_due IS 'Grand payable amount: previous outstanding plus current billing minus applied credit.';
COMMENT ON COLUMN public.sponsor_statements.coverage_status IS 'Month-end coverage state: unpaid, partial, covered, or credit.';
