-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 5
ALTER TABLE public.corporate_manual_service_rows ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 6
CREATE POLICY "Accountants and admins can view corporate manual services"
  ON public.corporate_manual_service_rows FOR SELECT TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]));

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 7
CREATE POLICY "Accountants and admins can manage corporate manual services"
  ON public.corporate_manual_service_rows FOR ALL TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]))
  WITH CHECK (public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]));

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 8
CREATE OR REPLACE FUNCTION public.touch_corporate_manual_service_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
BEGIN NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 9
CREATE TRIGGER trg_touch_corporate_manual_service_row
  BEFORE UPDATE ON public.corporate_manual_service_rows
  FOR EACH ROW EXECUTE FUNCTION public.touch_corporate_manual_service_row();

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 10
CREATE TABLE public.corporate_statement_manual_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id UUID NOT NULL REFERENCES public.sponsor_statements(id) ON DELETE CASCADE,
  manual_service_id UUID NOT NULL REFERENCES public.corporate_manual_service_rows(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (statement_id, manual_service_id),
  UNIQUE (manual_service_id)
);

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 11
CREATE INDEX IF NOT EXISTS idx_corporate_statement_manual_items_statement
  ON public.corporate_statement_manual_items(statement_id);

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 12
GRANT SELECT ON public.corporate_statement_manual_items TO authenticated;

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 13
GRANT ALL ON public.corporate_statement_manual_items TO service_role;

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 14
ALTER TABLE public.corporate_statement_manual_items ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 15
CREATE POLICY "Accountants and admins can view corporate statement manual items"
  ON public.corporate_statement_manual_items FOR SELECT TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]));

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 16
CREATE TABLE public.corporate_statement_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id UUID NOT NULL REFERENCES public.sponsor_statements(id) ON DELETE CASCADE,
  sponsor_id UUID NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'bank_transfer' CHECK (payment_method IN ('bank_transfer','cash','cheque','pos','other')),
  bank_reference TEXT,
  notes TEXT,
  recorded_by UUID REFERENCES public.auth_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 17
CREATE INDEX IF NOT EXISTS idx_corporate_statement_payments_statement
  ON public.corporate_statement_payments(statement_id, payment_date);

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 18
CREATE INDEX IF NOT EXISTS idx_corporate_statement_payments_sponsor
  ON public.corporate_statement_payments(sponsor_id, payment_date DESC);

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 19
GRANT SELECT ON public.corporate_statement_payments TO authenticated;

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 20
GRANT ALL ON public.corporate_statement_payments TO service_role;

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 21
ALTER TABLE public.corporate_statement_payments ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 22
CREATE POLICY "Accountants and admins can view corporate statement payments"
  ON public.corporate_statement_payments FOR SELECT TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]));

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 23
CREATE OR REPLACE FUNCTION public.enforce_corporate_manual_service_editability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _status TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT s.status INTO _status
      FROM public.sponsor_statements s
     WHERE s.sponsor_id = (NEW).sponsor_id
       AND s.period_year = (NEW).period_year
       AND s.period_month = (NEW).period_month
       AND s.status IN ('finalized','printed','paid')
     LIMIT 1;
  ELSE
    SELECT s.status INTO _status
      FROM public.corporate_statement_manual_items mi
      JOIN public.sponsor_statements s ON s.id = mi.statement_id
     WHERE mi.manual_service_id = (OLD).id
       AND s.status IN ('finalized','printed','paid')
     LIMIT 1;
  END IF;

  IF _status IS NOT NULL THEN
    RAISE EXCEPTION 'Walk-in services cannot be changed after their statement is %', _status;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 24
CREATE TRIGGER trg_enforce_corporate_manual_service_editability
  BEFORE INSERT OR UPDATE OR DELETE ON public.corporate_manual_service_rows
  FOR EACH ROW EXECUTE FUNCTION public.enforce_corporate_manual_service_editability();

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 25
CREATE OR REPLACE FUNCTION public.enforce_corporate_manual_item_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _statement public.sponsor_statements;
  _manual public.corporate_manual_service_rows;
BEGIN
  SELECT * INTO _statement FROM public.sponsor_statements WHERE id = (NEW).statement_id;
  SELECT * INTO _manual FROM public.corporate_manual_service_rows WHERE id = (NEW).manual_service_id;

  IF (_statement).sponsor_id IS NULL OR (_manual).sponsor_id IS NULL THEN
    RAISE EXCEPTION 'Statement or manual service row not found';
  END IF;
  IF (_statement).status <> 'draft' THEN
    RAISE EXCEPTION 'Manual service rows can only be attached to a draft statement';
  END IF;
  IF (_statement).sponsor_id <> (_manual).sponsor_id
     OR (_statement).period_year <> (_manual).period_year
     OR (_statement).period_month <> (_manual).period_month THEN
    RAISE EXCEPTION 'Manual service row must belong to the same sponsor and statement period';
  END IF;
  RETURN NEW;
END;
$$;

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 26
CREATE TRIGGER trg_enforce_corporate_manual_item_match
  BEFORE INSERT OR UPDATE ON public.corporate_statement_manual_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_corporate_manual_item_match();

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 27
ALTER TABLE public.sponsor_statements
  ADD COLUMN IF NOT EXISTS manual_service_count INTEGER NOT NULL DEFAULT 0;

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 28
CREATE OR REPLACE FUNCTION public.generate_sponsor_statement(
  _sponsor_id UUID,
  _year INT,
  _month INT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _sponsor public.corporate_accounts;
  _start DATE;
  _end DATE;
  _statement_id UUID;
  _existing_status TEXT;
  _invoice_total NUMERIC(14,2) := 0;
  _manual_total NUMERIC(14,2) := 0;
  _total NUMERIC(14,2) := 0;
  _inv_count INT := 0;
  _pat_count INT := 0;
  _manual_count INT := 0;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _month NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Invalid statement month';
  END IF;

  SELECT * INTO _sponsor FROM public.corporate_accounts WHERE id = _sponsor_id;
  IF (_sponsor).id IS NULL THEN
    RAISE EXCEPTION 'Sponsor not found';
  END IF;
  IF (_sponsor).account_type NOT IN ('corporate','retainer') THEN
    RAISE EXCEPTION 'Sponsor is not a corporate or retainer account';
  END IF;

  _start := make_date(_year, _month, 1);
  _end := (_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  SELECT id, status INTO _statement_id, _existing_status
    FROM public.sponsor_statements
   WHERE sponsor_id = _sponsor_id AND period_year = _year AND period_month = _month;

  IF _statement_id IS NOT NULL THEN
    IF _existing_status IN ('finalized','printed','paid') THEN
      RAISE EXCEPTION 'Statement for % (%-%) is % and cannot be regenerated. Void it first.',
        (_sponsor).company_name, _year, _month, _existing_status;
    END IF;
    DELETE FROM public.corporate_statement_manual_items WHERE statement_id = _statement_id;
    DELETE FROM public.sponsor_statement_items WHERE statement_id = _statement_id;
  ELSE
    _statement_id := gen_random_uuid();
    INSERT INTO public.sponsor_statements
      (id, statement_number, sponsor_id, sponsor_type, period_year, period_month,
       period_start, period_end, generated_by)
    VALUES
      (_statement_id, public.next_statement_number(_year, _month), _sponsor_id,
       (_sponsor).account_type, _year, _month, _start, _end, public.hms_current_user_id());
  END IF;

  INSERT INTO public.sponsor_statement_items
    (statement_id, invoice_id, patient_id, amount, service_date)
  SELECT
    _statement_id, i.id, i.patient_id, i.total_amount, i.created_at::DATE
  FROM public.invoices i
  WHERE i.corporate_account_id = _sponsor_id
    AND i.sponsor_type = (_sponsor).account_type
    AND i.created_at >= _start
    AND i.created_at < (_end + INTERVAL '1 day');

  INSERT INTO public.corporate_statement_manual_items (statement_id, manual_service_id)
  SELECT _statement_id, m.id
    FROM public.corporate_manual_service_rows m
   WHERE m.sponsor_id = _sponsor_id
     AND m.period_year = _year
     AND m.period_month = _month;

  SELECT COALESCE(SUM(amount), 0), COUNT(*), COUNT(DISTINCT patient_id)
    INTO _invoice_total, _inv_count, _pat_count
    FROM public.sponsor_statement_items
   WHERE statement_id = _statement_id;

  SELECT COALESCE(SUM(m.amount), 0), COUNT(*)
    INTO _manual_total, _manual_count
    FROM public.corporate_statement_manual_items mi
    JOIN public.corporate_manual_service_rows m ON m.id = mi.manual_service_id
   WHERE mi.statement_id = _statement_id;

  _total := _invoice_total + _manual_total;

  UPDATE public.sponsor_statements
     SET total_amount = _total,
         invoice_count = _inv_count,
         patient_count = _pat_count,
         manual_service_count = _manual_count,
         generated_at = now(),
         generated_by = COALESCE(public.hms_current_user_id(), generated_by),
         status = 'draft'
   WHERE id = _statement_id;

  RETURN _statement_id;
END;
$$;

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 29
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
  _uid UUID := public.hms_current_user_id();
  _statement public.sponsor_statements;
  _paid_total NUMERIC(14,2);
  _new_status TEXT;
  _payment_id UUID;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;
  IF _payment_date IS NULL THEN
    RAISE EXCEPTION 'Payment date is required';
  END IF;
  IF _payment_method NOT IN ('bank_transfer','cash','cheque','pos','other') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;

  SELECT * INTO _statement FROM public.sponsor_statements
   WHERE id = _statement_id
   FOR UPDATE;

  IF (_statement).id IS NULL THEN
    RAISE EXCEPTION 'Statement not found';
  END IF;
  IF (_statement).sponsor_type <> 'corporate' THEN
    RAISE EXCEPTION 'Corporate payment recording only applies to corporate statements';
  END IF;
  IF (_statement).status IN ('draft','void') THEN
    RAISE EXCEPTION 'Finalize the statement before recording a payment';
  END IF;

  INSERT INTO public.corporate_statement_payments
    (statement_id, sponsor_id, payment_date, amount, payment_method, bank_reference, notes, recorded_by)
  VALUES
    ((_statement).id, (_statement).sponsor_id, _payment_date, _amount, _payment_method,
     NULLIF(btrim(_bank_reference), ''), NULLIF(btrim(_notes), ''), _uid)
  RETURNING id INTO _payment_id;

  SELECT COALESCE(SUM(amount), 0) INTO _paid_total
    FROM public.corporate_statement_payments
   WHERE statement_id = (_statement).id;

  _new_status := CASE
    WHEN _paid_total >= (_statement).total_amount THEN 'paid'
    WHEN (_statement).status = 'printed' THEN 'printed'
    ELSE 'finalized'
  END;

  UPDATE public.sponsor_statements
     SET status = _new_status,
         paid_at = CASE WHEN _new_status = 'paid' THEN COALESCE(paid_at, now()) ELSE paid_at END,
         updated_at = now()
   WHERE id = (_statement).id;

  SELECT public.write_audit_log('corporate_statement_payment_recorded', 'corporate_statement_payment', _payment_id::TEXT, jsonb_build_object(
      'statement_id', (_statement).id,
      'sponsor_id', (_statement).sponsor_id,
      'amount', _amount,
      'payment_date', _payment_date,
      'payment_method', _payment_method,
      'bank_reference', NULLIF(btrim(_bank_reference), ''),
      'statement_total', (_statement).total_amount,
      'paid_to_date', _paid_total,
      'credit', GREATEST(_paid_total - (_statement).total_amount, 0)
    , 'success'), 'success');

  RETURN jsonb_build_object(
    'payment_id', _payment_id,
    'statement_id', (_statement).id,
    'paid_to_date', _paid_total,
    'statement_total', (_statement).total_amount,
    'balance', (_statement).total_amount - _paid_total,
    'credit', GREATEST(_paid_total - (_statement).total_amount, 0),
    'status', _new_status
  );
END;
$$;

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 30
REVOKE EXECUTE ON FUNCTION public.record_corporate_statement_payment(UUID, DATE, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon;

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 31
GRANT EXECUTE ON FUNCTION public.record_corporate_statement_payment(UUID, DATE, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 32
CREATE OR REPLACE FUNCTION public.prevent_unreconciled_corporate_paid_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _payment_total NUMERIC(14,2);
BEGIN
  IF (NEW).status = 'paid' AND (OLD).status IS DISTINCT FROM 'paid' AND (NEW).sponsor_type = 'corporate' THEN
    SELECT COALESCE(SUM(amount), 0) INTO _payment_total
      FROM public.corporate_statement_payments
     WHERE statement_id = (NEW).id;
    IF _payment_total < (NEW).total_amount THEN
      RAISE EXCEPTION 'Corporate statements may be marked paid only through recorded payments';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 33
CREATE TRIGGER trg_prevent_unreconciled_corporate_paid_status
  BEFORE UPDATE ON public.sponsor_statements
  FOR EACH ROW EXECUTE FUNCTION public.prevent_unreconciled_corporate_paid_status();

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 34
CREATE OR REPLACE FUNCTION public.get_corporate_covering_letter_data(
  _sponsor_id UUID,
  _as_of_year INT,
  _as_of_month INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _sponsor public.corporate_accounts;
  _cutoff DATE;
  _payload JSONB;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _as_of_month NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Invalid statement month';
  END IF;

  SELECT * INTO _sponsor FROM public.corporate_accounts
   WHERE id = _sponsor_id;
  IF (_sponsor).id IS NULL OR (_sponsor).account_type <> 'corporate' THEN
    RAISE EXCEPTION 'Corporate sponsor not found';
  END IF;

  _cutoff := (make_date(_as_of_year, _as_of_month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  WITH statements AS (
    SELECT s.id, s.statement_number, s.period_year, s.period_month, s.period_start, s.period_end,
           s.total_amount, s.invoice_count, s.patient_count, s.manual_service_count, s.status,
           COALESCE(SUM(p.amount) FILTER (WHERE p.payment_date <= _cutoff), 0)::NUMERIC(14,2) AS paid_amount
      FROM public.sponsor_statements s
      LEFT JOIN public.corporate_statement_payments p ON p.statement_id = s.id
     WHERE s.sponsor_id = _sponsor_id
       AND s.sponsor_type = 'corporate'
       AND s.status <> 'void'
       AND (s.period_year, s.period_month) <= (_as_of_year, _as_of_month)
     GROUP BY s.id
  ), payment_history AS (
    SELECT p.id, p.statement_id, s.statement_number, s.period_year, s.period_month,
           p.payment_date, p.amount, p.payment_method, p.bank_reference, p.notes
      FROM public.corporate_statement_payments p
      JOIN statements s ON s.id = p.statement_id
     WHERE p.payment_date <= _cutoff
  )
  SELECT jsonb_build_object(
    'sponsor', jsonb_build_object(
      'id', (_sponsor).id,
      'company_name', (_sponsor).company_name,
      'contact_person', (_sponsor).contact_person,
      'email', (_sponsor).email,
      'phone', (_sponsor).phone,
      'address', (_sponsor).address
    ),
    'as_of_year', _as_of_year,
    'as_of_month', _as_of_month,
    'as_of_date', _cutoff,
    'statements', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'statement_number', s.statement_number,
        'period_year', s.period_year,
        'period_month', s.period_month,
        'period_start', s.period_start,
        'period_end', s.period_end,
        'total_amount', s.total_amount,
        'paid_amount', s.paid_amount,
        'balance', s.total_amount - s.paid_amount,
        'invoice_count', s.invoice_count,
        'patient_count', s.patient_count,
        'manual_service_count', s.manual_service_count,
        'status', s.status
      ) ORDER BY s.period_year, s.period_month)
      FROM statements s
    ), '[]'::JSONB),
    'payment_history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ph.id,
        'statement_id', ph.statement_id,
        'statement_number', ph.statement_number,
        'period_year', ph.period_year,
        'period_month', ph.period_month,
        'payment_date', ph.payment_date,
        'amount', ph.amount,
        'payment_method', ph.payment_method,
        'bank_reference', ph.bank_reference,
        'notes', ph.notes
      ) ORDER BY ph.payment_date, ph.created_at)
      FROM (
        SELECT ph.*, p.created_at
          FROM payment_history ph
          JOIN public.corporate_statement_payments p ON p.id = ph.id
      ) ph
    ), '[]'::JSONB),
    'current_manual_services', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id,
        'patient_name', m.patient_name,
        'service_description', m.service_description,
        'service_date', m.service_date,
        'amount', m.amount,
        'notes', m.notes
      ) ORDER BY m.service_date, m.patient_name)
      FROM public.corporate_statement_manual_items mi
      JOIN public.corporate_manual_service_rows m ON m.id = mi.manual_service_id
      JOIN statements s ON s.id = mi.statement_id
     WHERE s.period_year = _as_of_year AND s.period_month = _as_of_month
    ), '[]'::JSONB),
    'summary', jsonb_build_object(
      'total_billed', COALESCE((SELECT SUM(s.total_amount) FROM statements s), 0),
      'total_paid', COALESCE((SELECT SUM(s.paid_amount) FROM statements s), 0),
      'net_balance_due', GREATEST(COALESCE((SELECT SUM(s.total_amount - s.paid_amount) FROM statements s), 0), 0),
      'credit_amount', GREATEST(-COALESCE((SELECT SUM(s.total_amount - s.paid_amount) FROM statements s), 0), 0)
    )
  ) INTO _payload;

  RETURN _payload;
END;
$$;

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 35
REVOKE EXECUTE ON FUNCTION public.get_corporate_covering_letter_data(UUID, INT, INT) FROM PUBLIC, anon;

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 36
GRANT EXECUTE ON FUNCTION public.get_corporate_covering_letter_data(UUID, INT, INT) TO authenticated;

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 37
REVOKE EXECUTE ON FUNCTION public.generate_sponsor_statement(UUID, INT, INT) FROM PUBLIC, anon;

-- SOURCE: 20260814112644_corporate_claims_extension.sql statement 38
GRANT EXECUTE ON FUNCTION public.generate_sponsor_statement(UUID, INT, INT) TO authenticated;

-- SOURCE: 20260814114545_retainer_covering_letter.sql statement 1
CREATE OR REPLACE FUNCTION public.get_retainer_covering_letter_data(
  _sponsor_id UUID,
  _as_of_year INT,
  _as_of_month INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _sponsor public.corporate_accounts;
  _cutoff DATE;
  _history_cutoff DATE;
  _payload JSONB;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _as_of_month NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Invalid statement month';
  END IF;

  SELECT * INTO _sponsor FROM public.corporate_accounts
   WHERE id = _sponsor_id;

  IF (_sponsor).id IS NULL OR (_sponsor).account_type <> 'retainer' THEN
    RAISE EXCEPTION 'Retainer sponsor not found';
  END IF;

  _cutoff := (make_date(_as_of_year, _as_of_month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
  -- A covering letter must not show a deposit posted after it was issued.
  _history_cutoff := LEAST(_cutoff, CURRENT_DATE);

  WITH statements AS (
    SELECT
      s.id,
      s.statement_number,
      s.period_year,
      s.period_month,
      s.period_start,
      s.period_end,
      s.total_amount,
      s.invoice_count,
      s.patient_count,
      s.manual_service_count,
      s.status,
      COALESCE((
        SELECT SUM(ABS(t.amount))
          FROM public.corporate_transactions t
         WHERE t.related_statement_id = s.id
           AND t.transaction_type = 'monthly_deduction'
      ), 0)::NUMERIC(14,2) AS paid_amount
    FROM public.sponsor_statements s
    WHERE s.sponsor_id = _sponsor_id
      AND s.sponsor_type = 'retainer'
      AND s.status <> 'void'
      AND (s.period_year, s.period_month) <= (_as_of_year, _as_of_month)
  ), transaction_history AS (
    SELECT
      t.id,
      t.related_statement_id AS statement_id,
      s.statement_number,
      s.period_year,
      s.period_month,
      t.created_at::DATE AS transaction_date,
      ABS(t.amount)::NUMERIC(14,2) AS amount,
      t.transaction_type,
      t.notes
    FROM public.corporate_transactions t
    LEFT JOIN statements s ON s.id = t.related_statement_id
    WHERE t.sponsor_id = _sponsor_id
      AND (
        (t.transaction_type = 'monthly_deduction' AND s.id IS NOT NULL)
        OR (t.transaction_type IN ('deposit', 'refund', 'adjustment') AND t.created_at::DATE <= _history_cutoff)
      )
  )
  SELECT jsonb_build_object(
    'sponsor', jsonb_build_object(
      'id', (_sponsor).id,
      'company_name', (_sponsor).company_name,
      'contact_person', (_sponsor).contact_person,
      'email', (_sponsor).email,
      'phone', (_sponsor).phone,
      'address', (_sponsor).address
    ),
    'as_of_year', _as_of_year,
    'as_of_month', _as_of_month,
    'as_of_date', _cutoff,
    'statements', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'statement_number', s.statement_number,
        'period_year', s.period_year,
        'period_month', s.period_month,
        'period_start', s.period_start,
        'period_end', s.period_end,
        'total_amount', s.total_amount,
        'paid_amount', s.paid_amount,
        'balance', s.total_amount - s.paid_amount,
        'invoice_count', s.invoice_count,
        'patient_count', s.patient_count,
        'manual_service_count', s.manual_service_count,
        'status', s.status
      ) ORDER BY s.period_year, s.period_month)
      FROM statements s
    ), '[]'::JSONB),
    'transaction_history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', th.id,
        'statement_id', th.statement_id,
        'statement_number', th.statement_number,
        'period_year', th.period_year,
        'period_month', th.period_month,
        'transaction_date', th.transaction_date,
        'amount', th.amount,
        'transaction_type', th.transaction_type,
        'notes', th.notes
      ) ORDER BY th.transaction_date, th.id)
      FROM transaction_history th
    ), '[]'::JSONB),
    'summary', jsonb_build_object(
      'total_billed', COALESCE((SELECT SUM(s.total_amount) FROM statements s), 0),
      'total_paid', COALESCE((SELECT SUM(s.paid_amount) FROM statements s), 0),
      'net_balance_due', GREATEST(COALESCE((SELECT SUM(s.total_amount - s.paid_amount) FROM statements s), 0), 0),
      'credit_amount', 0,
      'available_deposit_balance', GREATEST(COALESCE((_sponsor).balance, 0), 0)
    )
  ) INTO _payload;

  RETURN _payload;
END;
$$;

-- SOURCE: 20260814114545_retainer_covering_letter.sql statement 2
REVOKE EXECUTE ON FUNCTION public.get_retainer_covering_letter_data(UUID, INT, INT) FROM PUBLIC, anon;

-- SOURCE: 20260814114545_retainer_covering_letter.sql statement 3
GRANT EXECUTE ON FUNCTION public.get_retainer_covering_letter_data(UUID, INT, INT) TO authenticated;

-- SOURCE: 20260814114803_retainer_covering_letter_balance_cutoff.sql statement 1
CREATE OR REPLACE FUNCTION public.get_retainer_covering_letter_data(
  _sponsor_id UUID,
  _as_of_year INT,
  _as_of_month INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _sponsor public.corporate_accounts;
  _cutoff DATE;
  _history_cutoff DATE;
  _available_deposit NUMERIC(14,2);
  _payload JSONB;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _as_of_month NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Invalid statement month';
  END IF;

  SELECT * INTO _sponsor FROM public.corporate_accounts
   WHERE id = _sponsor_id;

  IF (_sponsor).id IS NULL OR (_sponsor).account_type <> 'retainer' THEN
    RAISE EXCEPTION 'Retainer sponsor not found';
  END IF;

  _cutoff := (make_date(_as_of_year, _as_of_month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
  _history_cutoff := LEAST(_cutoff, CURRENT_DATE);

  IF _cutoff >= CURRENT_DATE THEN
    _available_deposit := GREATEST(COALESCE((_sponsor).balance, 0), 0);
  ELSE
    SELECT GREATEST(COALESCE(t.balance_after, 0), 0)
      INTO _available_deposit
      FROM public.corporate_transactions t
     WHERE t.sponsor_id = _sponsor_id
       AND t.created_at::DATE <= _history_cutoff
     ORDER BY t.created_at DESC, t.id DESC
     LIMIT 1;
    _available_deposit := COALESCE(_available_deposit, 0);
  END IF;

  WITH statements AS (
    SELECT
      s.id,
      s.statement_number,
      s.period_year,
      s.period_month,
      s.period_start,
      s.period_end,
      s.total_amount,
      s.invoice_count,
      s.patient_count,
      s.manual_service_count,
      s.status,
      COALESCE((
        SELECT SUM(ABS(t.amount))
          FROM public.corporate_transactions t
         WHERE t.related_statement_id = s.id
           AND t.transaction_type = 'monthly_deduction'
      ), 0)::NUMERIC(14,2) AS paid_amount
    FROM public.sponsor_statements s
    WHERE s.sponsor_id = _sponsor_id
      AND s.sponsor_type = 'retainer'
      AND s.status <> 'void'
      AND (s.period_year, s.period_month) <= (_as_of_year, _as_of_month)
  ), transaction_history AS (
    SELECT
      t.id,
      t.related_statement_id AS statement_id,
      s.statement_number,
      s.period_year,
      s.period_month,
      t.created_at::DATE AS transaction_date,
      ABS(t.amount)::NUMERIC(14,2) AS amount,
      t.transaction_type,
      t.notes
    FROM public.corporate_transactions t
    LEFT JOIN statements s ON s.id = t.related_statement_id
    WHERE t.sponsor_id = _sponsor_id
      AND (
        (t.transaction_type = 'monthly_deduction' AND s.id IS NOT NULL)
        OR (t.transaction_type IN ('deposit', 'refund', 'adjustment') AND t.created_at::DATE <= _history_cutoff)
      )
  )
  SELECT jsonb_build_object(
    'sponsor', jsonb_build_object(
      'id', (_sponsor).id,
      'company_name', (_sponsor).company_name,
      'contact_person', (_sponsor).contact_person,
      'email', (_sponsor).email,
      'phone', (_sponsor).phone,
      'address', (_sponsor).address
    ),
    'as_of_year', _as_of_year,
    'as_of_month', _as_of_month,
    'as_of_date', _cutoff,
    'statements', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'statement_number', s.statement_number,
        'period_year', s.period_year,
        'period_month', s.period_month,
        'period_start', s.period_start,
        'period_end', s.period_end,
        'total_amount', s.total_amount,
        'paid_amount', s.paid_amount,
        'balance', s.total_amount - s.paid_amount,
        'invoice_count', s.invoice_count,
        'patient_count', s.patient_count,
        'manual_service_count', s.manual_service_count,
        'status', s.status
      ) ORDER BY s.period_year, s.period_month)
      FROM statements s
    ), '[]'::JSONB),
    'transaction_history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', th.id,
        'statement_id', th.statement_id,
        'statement_number', th.statement_number,
        'period_year', th.period_year,
        'period_month', th.period_month,
        'transaction_date', th.transaction_date,
        'amount', th.amount,
        'transaction_type', th.transaction_type,
        'notes', th.notes
      ) ORDER BY th.transaction_date, th.id)
      FROM transaction_history th
    ), '[]'::JSONB),
    'summary', jsonb_build_object(
      'total_billed', COALESCE((SELECT SUM(s.total_amount) FROM statements s), 0),
      'total_paid', COALESCE((SELECT SUM(s.paid_amount) FROM statements s), 0),
      'net_balance_due', GREATEST(COALESCE((SELECT SUM(s.total_amount - s.paid_amount) FROM statements s), 0), 0),
      'credit_amount', 0,
      'available_deposit_balance', _available_deposit
    )
  ) INTO _payload;

  RETURN _payload;
END;
$$;

-- SOURCE: 20260814122746_retainer_month_settlement_alignment.sql statement 1
ALTER TABLE public.corporate_transactions
  ADD COLUMN IF NOT EXISTS transaction_date date;

-- SOURCE: 20260814122746_retainer_month_settlement_alignment.sql statement 2
UPDATE public.corporate_transactions
SET transaction_date = created_at::date
WHERE transaction_date IS NULL;

-- SOURCE: 20260814122746_retainer_month_settlement_alignment.sql statement 3
ALTER TABLE public.corporate_transactions
  ALTER COLUMN transaction_date SET DEFAULT CURRENT_DATE,
  ALTER COLUMN transaction_date SET NOT NULL;

-- SOURCE: 20260814122746_retainer_month_settlement_alignment.sql statement 4
ALTER TABLE public.corporate_transactions
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS bank_reference text;

-- SOURCE: 20260814122746_retainer_month_settlement_alignment.sql statement 5
CREATE INDEX IF NOT EXISTS idx_corporate_transactions_sponsor_transaction_date
  ON public.corporate_transactions (sponsor_id, transaction_date DESC, created_at DESC);

-- SOURCE: 20260814122746_retainer_month_settlement_alignment.sql statement 6
CREATE OR REPLACE FUNCTION public.retainer_deposit(
  _sponsor_id uuid,
  _amount numeric,
  _notes text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _uid uuid := public.hms_current_user_id();
  _sponsor public.corporate_accounts;
  _new_bal numeric(14,2);
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  SELECT * INTO _sponsor FROM public.corporate_accounts
  WHERE id = _sponsor_id
  FOR UPDATE;

  IF (_sponsor).id IS NULL THEN
    RAISE EXCEPTION 'Sponsor not found';
  END IF;
  IF (_sponsor).account_type <> 'retainer' THEN
    RAISE EXCEPTION 'Retainer deposits only apply to retainer sponsors';
  END IF;

  _new_bal := (_sponsor).balance + _amount;

  UPDATE public.corporate_accounts
  SET balance = _new_bal, updated_at = now()
  WHERE id = _sponsor_id;

  INSERT INTO public.corporate_transactions (
    sponsor_id, transaction_type, amount, balance_before, balance_after,
    transaction_date, payment_method, bank_reference, notes, performed_by
  ) VALUES (
    _sponsor_id, 'deposit', _amount, (_sponsor).balance, _new_bal,
    CURRENT_DATE, 'bank_transfer', NULL, _notes, _uid
  );

  SELECT public.write_audit_log('sponsor_deposit', 'corporate_account', _sponsor_id::text, jsonb_build_object('amount', _amount, 'new_balance', _new_bal, 'notes', _notes)
  , 'success');

  RETURN _new_bal;
END;
$$;

-- SOURCE: 20260814122746_retainer_month_settlement_alignment.sql statement 7
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

AS $$
DECLARE
  _uid uuid := public.hms_current_user_id();
  _statement public.sponsor_statements;
  _sponsor public.corporate_accounts;
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

  SELECT * INTO _statement FROM public.sponsor_statements ss
  JOIN public.corporate_accounts ca ON ca.id = ss.sponsor_id
  WHERE ss.id = _statement_id
  FOR UPDATE OF ss, ca;

  IF (_statement).id IS NULL THEN
    RAISE EXCEPTION 'Statement not found';
  END IF;
  IF (_statement).account_type <> 'retainer' THEN
    RAISE EXCEPTION 'This settlement workflow only applies to retainer statements';
  END IF;
  IF (_statement).status IN ('paid', 'void') THEN
    RAISE EXCEPTION 'Statement is already % — no further settlement can be applied', (_statement).status;
  END IF;

  SELECT COALESCE(SUM(-amount), 0)
  INTO _already_applied
  FROM public.corporate_transactions
  WHERE related_statement_id = _statement_id
    AND transaction_type = 'monthly_deduction';

  _outstanding_before := GREATEST((_statement).total_amount - _already_applied, 0);
  SELECT balance INTO _balance_before FROM public.corporate_accounts WHERE id = (_statement).sponsor_id;
  _balance_after_receipt := _balance_before;

  IF _amount_received > 0 THEN
    _balance_after_receipt := _balance_before + _amount_received;

    UPDATE public.corporate_accounts
    SET balance = _balance_after_receipt, updated_at = now()
    WHERE id = (_statement).sponsor_id;

    INSERT INTO public.corporate_transactions (
      sponsor_id, transaction_type, amount, balance_before, balance_after,
      related_statement_id, transaction_date, payment_method, bank_reference, notes, performed_by
    ) VALUES (
      (_statement).sponsor_id, 'deposit', _amount_received, _balance_before, _balance_after_receipt,
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
    WHERE id = (_statement).sponsor_id;

    INSERT INTO public.corporate_transactions (
      sponsor_id, transaction_type, amount, balance_before, balance_after,
      related_statement_id, transaction_date, payment_method, bank_reference, notes, performed_by
    ) VALUES (
      (_statement).sponsor_id, 'monthly_deduction', -_applied_now,
      _balance_after_receipt, _balance_after_application,
      _statement_id, _payment_date, NULL, NULL,
      COALESCE(NULLIF(_notes, ''), 'Retainer funding applied to statement ' || (_statement).statement_number), _uid
    );
  END IF;

  UPDATE public.sponsor_statements
  SET status = _final_status,
      finalized_at = COALESCE(finalized_at, now()),
      paid_at = CASE WHEN _final_status = 'paid' THEN now() ELSE paid_at END,
      updated_at = now()
  WHERE id = _statement_id;

  SELECT public.write_audit_log('retainer_statement_settled', 'sponsor_statement', _statement_id::text, jsonb_build_object(
      'sponsor_id', (_statement).sponsor_id,
      'statement_number', (_statement).statement_number,
      'amount_received', _amount_received,
      'applied_now', _applied_now,
      'outstanding_after', _outstanding_after,
      'available_deposit_balance', _balance_after_application,
      'payment_date', _payment_date,
      'payment_method', _payment_method,
      'bank_reference', NULLIF(_bank_reference, '')
    , 'success'), 'success');

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

-- SOURCE: 20260814122746_retainer_month_settlement_alignment.sql statement 8
GRANT EXECUTE ON FUNCTION public.settle_retainer_statement(uuid, numeric, date, text, text, text) TO authenticated;

-- SOURCE: 20260814122826_retainer_covering_letter_settlement_dates.sql statement 1
CREATE OR REPLACE FUNCTION public.get_retainer_covering_letter_data(
  _sponsor_id UUID,
  _as_of_year INT,
  _as_of_month INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _sponsor public.corporate_accounts;
  _cutoff DATE;
  _history_cutoff DATE;
  _available_deposit NUMERIC(14,2);
  _payload JSONB;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _as_of_month NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Invalid statement month';
  END IF;

  SELECT * INTO _sponsor FROM public.corporate_accounts
   WHERE id = _sponsor_id;

  IF (_sponsor).id IS NULL OR (_sponsor).account_type <> 'retainer' THEN
    RAISE EXCEPTION 'Retainer sponsor not found';
  END IF;

  _cutoff := (make_date(_as_of_year, _as_of_month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
  _history_cutoff := LEAST(_cutoff, CURRENT_DATE);

  SELECT GREATEST(COALESCE(t.balance_after, 0), 0)
    INTO _available_deposit
    FROM public.corporate_transactions t
   WHERE t.sponsor_id = _sponsor_id
     AND COALESCE(t.transaction_date, t.created_at::DATE) <= _history_cutoff
   ORDER BY COALESCE(t.transaction_date, t.created_at::DATE) DESC, t.created_at DESC, t.id DESC
   LIMIT 1;
  _available_deposit := COALESCE(_available_deposit, 0);

  WITH statements AS (
    SELECT
      s.id,
      s.statement_number,
      s.period_year,
      s.period_month,
      s.period_start,
      s.period_end,
      s.total_amount,
      s.invoice_count,
      s.patient_count,
      s.manual_service_count,
      s.status,
      COALESCE((
        SELECT SUM(ABS(t.amount))
          FROM public.corporate_transactions t
         WHERE t.related_statement_id = s.id
           AND t.transaction_type = 'monthly_deduction'
           AND COALESCE(t.transaction_date, t.created_at::DATE) <= _history_cutoff
      ), 0)::NUMERIC(14,2) AS paid_amount
    FROM public.sponsor_statements s
    WHERE s.sponsor_id = _sponsor_id
      AND s.sponsor_type = 'retainer'
      AND s.status <> 'void'
      AND (s.period_year, s.period_month) <= (_as_of_year, _as_of_month)
  ), transaction_history AS (
    SELECT
      t.id,
      t.related_statement_id AS statement_id,
      s.statement_number,
      s.period_year,
      s.period_month,
      COALESCE(t.transaction_date, t.created_at::DATE) AS transaction_date,
      ABS(t.amount)::NUMERIC(14,2) AS amount,
      t.transaction_type,
      t.payment_method,
      t.bank_reference,
      t.notes
    FROM public.corporate_transactions t
    LEFT JOIN statements s ON s.id = t.related_statement_id
    WHERE t.sponsor_id = _sponsor_id
      AND COALESCE(t.transaction_date, t.created_at::DATE) <= _history_cutoff
      AND (
        (t.transaction_type = 'monthly_deduction' AND s.id IS NOT NULL)
        OR t.transaction_type IN ('deposit', 'refund', 'adjustment')
      )
  )
  SELECT jsonb_build_object(
    'sponsor', jsonb_build_object(
      'id', (_sponsor).id,
      'company_name', (_sponsor).company_name,
      'contact_person', (_sponsor).contact_person,
      'email', (_sponsor).email,
      'phone', (_sponsor).phone,
      'address', (_sponsor).address
    ),
    'as_of_year', _as_of_year,
    'as_of_month', _as_of_month,
    'as_of_date', _cutoff,
    'statements', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'statement_number', s.statement_number,
        'period_year', s.period_year,
        'period_month', s.period_month,
        'period_start', s.period_start,
        'period_end', s.period_end,
        'total_amount', s.total_amount,
        'paid_amount', s.paid_amount,
        'balance', s.total_amount - s.paid_amount,
        'invoice_count', s.invoice_count,
        'patient_count', s.patient_count,
        'manual_service_count', s.manual_service_count,
        'status', s.status
      ) ORDER BY s.period_year, s.period_month)
      FROM statements s
    ), '[]'::JSONB),
    'transaction_history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', th.id,
        'statement_id', th.statement_id,
        'statement_number', th.statement_number,
        'period_year', th.period_year,
        'period_month', th.period_month,
        'transaction_date', th.transaction_date,
        'amount', th.amount,
        'transaction_type', th.transaction_type,
        'payment_method', th.payment_method,
        'bank_reference', th.bank_reference,
        'notes', th.notes
      ) ORDER BY th.transaction_date, th.id)
      FROM transaction_history th
    ), '[]'::JSONB),
    'summary', jsonb_build_object(
      'total_billed', COALESCE((SELECT SUM(s.total_amount) FROM statements s), 0),
      'total_paid', COALESCE((SELECT SUM(s.paid_amount) FROM statements s), 0),
      'net_balance_due', GREATEST(COALESCE((SELECT SUM(s.total_amount - s.paid_amount) FROM statements s), 0), 0),
      'credit_amount', 0,
      'available_deposit_balance', _available_deposit
    )
  ) INTO _payload;

  RETURN _payload;
END;
$$;

-- SOURCE: 20260814141522_safe_sponsor_account_deletion.sql statement 1
CREATE OR REPLACE FUNCTION public.delete_unused_sponsor_account(
  p_sponsor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  v_account public.corporate_accounts;
  v_linked_patient_count integer := 0;
  v_invoice_count integer := 0;
  v_claim_count integer := 0;
  v_transaction_count integer := 0;
  v_statement_item_count integer := 0;
  v_manual_item_count integer := 0;
  v_manual_service_count integer := 0;
  v_statement_payment_count integer := 0;
  v_nonzero_statement_count integer := 0;
  v_account_label text;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role, 'admin'::app_role]) THEN
    RAISE EXCEPTION 'Only billing staff and administrators can remove sponsor accounts.';
  END IF;

  SELECT *
  INTO v_account
  FROM public.corporate_accounts
  WHERE id = p_sponsor_id
  FOR UPDATE;
  IF (v_account).id IS NULL THEN
    RAISE EXCEPTION 'Sponsor account not found.';
  END IF;

  v_account_label := CASE
    WHEN (v_account).account_type = 'retainer' THEN 'Retainer'
    ELSE 'Corporate'
  END;

  SELECT count(*)
  INTO v_linked_patient_count
  FROM public.patients
  WHERE corporate_id = p_sponsor_id;

  SELECT count(*)
  INTO v_invoice_count
  FROM public.invoices
  WHERE corporate_account_id = p_sponsor_id;

  SELECT count(*)
  INTO v_claim_count
  FROM public.insurance_claims
  WHERE corporate_account_id = p_sponsor_id;

  SELECT count(*)
  INTO v_transaction_count
  FROM public.corporate_transactions
  WHERE sponsor_id = p_sponsor_id;

  SELECT count(*)
  INTO v_statement_item_count
  FROM public.sponsor_statement_items ssi
  JOIN public.sponsor_statements ss ON ss.id = ssi.statement_id
  WHERE ss.sponsor_id = p_sponsor_id;

  SELECT count(*)
  INTO v_manual_item_count
  FROM public.corporate_statement_manual_items csmi
  JOIN public.sponsor_statements ss ON ss.id = csmi.statement_id
  WHERE ss.sponsor_id = p_sponsor_id;

  SELECT count(*)
  INTO v_manual_service_count
  FROM public.corporate_manual_service_rows
  WHERE sponsor_id = p_sponsor_id;

  SELECT count(*)
  INTO v_statement_payment_count
  FROM public.corporate_statement_payments
  WHERE sponsor_id = p_sponsor_id;

  SELECT count(*)
  INTO v_nonzero_statement_count
  FROM public.sponsor_statements
  WHERE sponsor_id = p_sponsor_id
    AND total_amount <> 0;

  IF v_linked_patient_count > 0
     OR v_invoice_count > 0
     OR v_claim_count > 0
     OR v_transaction_count > 0
     OR v_statement_item_count > 0
     OR v_manual_item_count > 0
     OR v_manual_service_count > 0
     OR v_statement_payment_count > 0
     OR v_nonzero_statement_count > 0
     OR (v_account).balance <> 0 THEN
    UPDATE public.corporate_accounts
    SET status = 'suspended',
        updated_at = now()
    WHERE id = p_sponsor_id
      AND status <> 'suspended';

    RETURN jsonb_build_object(
      'action', 'suspended',
      'account_type', (v_account).account_type,
      'message', format(
        '%s account was not deleted because it has linked patients, balance, or financial history. It has been suspended so no new patients or services should be assigned to it; its records remain available for audit.',
        v_account_label
      ),
      'linked_patient_count', v_linked_patient_count,
      'invoice_count', v_invoice_count,
      'statement_count', v_nonzero_statement_count,
      'transaction_count', v_transaction_count,
      'manual_service_count', v_manual_service_count,
      'remaining_balance', (v_account).balance
    );
  END IF;

  -- Any remaining statements are demonstrably empty setup records with no invoice,
  -- manual-service, or payment history. Remove them before deleting the sponsor row.
  DELETE FROM public.sponsor_statements
  WHERE sponsor_id = p_sponsor_id;

  DELETE FROM public.corporate_accounts
  WHERE id = p_sponsor_id;

  RETURN jsonb_build_object(
    'action', 'deleted',
    'account_type', (v_account).account_type,
    'message', format('%s account and its empty setup reports were deleted.', v_account_label)
  );
END;
$$;

-- SOURCE: 20260814141522_safe_sponsor_account_deletion.sql statement 2
REVOKE ALL ON FUNCTION public.delete_unused_sponsor_account(uuid) FROM PUBLIC;

-- SOURCE: 20260814141522_safe_sponsor_account_deletion.sql statement 3
GRANT EXECUTE ON FUNCTION public.delete_unused_sponsor_account(uuid) TO authenticated;

-- SOURCE: 20260814144431_payroll_transfer_state_safety.sql statement 1
ALTER TABLE public.payroll_payments
  ADD COLUMN IF NOT EXISTS failure_reason text;

-- SOURCE: 20260814144431_payroll_transfer_state_safety.sql statement 2
WITH latest_payment AS (
  SELECT DISTINCT ON (payroll_entry_id)
    payroll_entry_id,
    status
  FROM public.payroll_payments
  ORDER BY payroll_entry_id, created_at DESC
)
UPDATE public.payroll_entries AS entry
SET status = latest_payment.status
FROM latest_payment
WHERE entry.id = latest_payment.payroll_entry_id
  AND entry.status = 'processing'
  AND latest_payment.status IN ('failed', 'reversed');

-- SOURCE: 20260814155000_fix_purge_archive_patient_reference.sql statement 1
ALTER TABLE public.patient_archive_records
  ALTER COLUMN patient_id DROP NOT NULL;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 1
CREATE TABLE public.inventory_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code IN ('main_store', 'pharmacy')),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 2
INSERT INTO public.inventory_locations (code, name)
VALUES ('main_store', 'Main Store'), ('pharmacy', 'Pharmacy')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 3
CREATE TABLE public.inventory_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pricelist_item_id uuid NOT NULL UNIQUE REFERENCES public.pricelist(id) ON DELETE RESTRICT,
  sku text NOT NULL UNIQUE,
  unit_label text NOT NULL DEFAULT 'unit',
  minimum_level numeric(14,3) NOT NULL DEFAULT 0 CHECK (minimum_level >= 0),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.auth_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- SOURCE: cockroach_compatibility statement inventory_locations
CREATE TABLE IF NOT EXISTS public.inventory_locations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, name text NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.inventory_locations (code, name) VALUES ('main_store', 'Main Store'), ('pharmacy', 'Pharmacy') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 4
CREATE TABLE public.inventory_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.inventory_products(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  batch_number text NOT NULL,
  expiry_date date NOT NULL,
  unit_cost numeric(14,2) NOT NULL CHECK (unit_cost >= 0),
  quantity_on_hand numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'quarantined', 'expired')),
  source_batch_id uuid REFERENCES public.inventory_batches(id) ON DELETE SET NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_batches_location_product_batch_expiry_key UNIQUE (product_id, location_id, batch_number, expiry_date)
);

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 5
CREATE TABLE public.stock_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_kind text NOT NULL CHECK (receipt_kind IN ('opening_count', 'supplier_delivery')),
  supplier_name text,
  supplier_reference text,
  received_on date NOT NULL DEFAULT current_date,
  location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  note text,
  received_by uuid NOT NULL REFERENCES public.auth_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 6
CREATE TABLE public.stock_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.stock_receipts(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES public.inventory_batches(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.inventory_products(id) ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(14,2) NOT NULL CHECK (unit_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
