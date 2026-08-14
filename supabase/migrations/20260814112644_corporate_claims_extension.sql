-- Corporate claims extension: manual walk-in services, reconciled payments, and multi-month covering-letter data.

-- 1. Manual rows cover company walk-ins who have no patient registration or HMS invoice.
CREATE TABLE public.corporate_manual_service_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id UUID NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  period_year INTEGER NOT NULL CHECK (period_year BETWEEN 2000 AND 2100),
  period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  service_date DATE NOT NULL,
  patient_name TEXT NOT NULL CHECK (length(btrim(patient_name)) > 0),
  service_description TEXT NOT NULL CHECK (length(btrim(service_description)) > 0),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sponsor_id, period_year, period_month, service_date, patient_name, service_description)
);

CREATE INDEX idx_corporate_manual_service_rows_period
  ON public.corporate_manual_service_rows(sponsor_id, period_year, period_month, service_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_manual_service_rows TO authenticated;
GRANT ALL ON public.corporate_manual_service_rows TO service_role;
ALTER TABLE public.corporate_manual_service_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Accountants and admins can view corporate manual services"
  ON public.corporate_manual_service_rows FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]));

CREATE POLICY "Accountants and admins can manage corporate manual services"
  ON public.corporate_manual_service_rows FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]));

CREATE OR REPLACE FUNCTION public.touch_corporate_manual_service_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_touch_corporate_manual_service_row
  BEFORE UPDATE ON public.corporate_manual_service_rows
  FOR EACH ROW EXECUTE FUNCTION public.touch_corporate_manual_service_row();

-- 2. Statement-to-manual-row mapping keeps the statement auditable without weakening
--    the non-null invoice constraint on sponsor_statement_items.
CREATE TABLE public.corporate_statement_manual_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id UUID NOT NULL REFERENCES public.sponsor_statements(id) ON DELETE CASCADE,
  manual_service_id UUID NOT NULL REFERENCES public.corporate_manual_service_rows(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (statement_id, manual_service_id),
  UNIQUE (manual_service_id)
);

CREATE INDEX idx_corporate_statement_manual_items_statement
  ON public.corporate_statement_manual_items(statement_id);

GRANT SELECT ON public.corporate_statement_manual_items TO authenticated;
GRANT ALL ON public.corporate_statement_manual_items TO service_role;
ALTER TABLE public.corporate_statement_manual_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Accountants and admins can view corporate statement manual items"
  ON public.corporate_statement_manual_items FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]));

-- 3. Payments are recorded against their statement, permitting partial settlement and
--    explicit overpayment credit without changing retainer deposit accounting.
CREATE TABLE public.corporate_statement_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id UUID NOT NULL REFERENCES public.sponsor_statements(id) ON DELETE CASCADE,
  sponsor_id UUID NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'bank_transfer' CHECK (payment_method IN ('bank_transfer','cash','cheque','pos','other')),
  bank_reference TEXT,
  notes TEXT,
  recorded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_corporate_statement_payments_statement
  ON public.corporate_statement_payments(statement_id, payment_date);
CREATE INDEX idx_corporate_statement_payments_sponsor
  ON public.corporate_statement_payments(sponsor_id, payment_date DESC);

GRANT SELECT ON public.corporate_statement_payments TO authenticated;
GRANT ALL ON public.corporate_statement_payments TO service_role;
ALTER TABLE public.corporate_statement_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Accountants and admins can view corporate statement payments"
  ON public.corporate_statement_payments FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]));

-- A closed corporate statement is immutable with respect to its manual service rows.
CREATE OR REPLACE FUNCTION public.enforce_corporate_manual_service_editability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _status TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT s.status INTO _status
      FROM public.sponsor_statements s
     WHERE s.sponsor_id = NEW.sponsor_id
       AND s.period_year = NEW.period_year
       AND s.period_month = NEW.period_month
       AND s.status IN ('finalized','printed','paid')
     LIMIT 1;
  ELSE
    SELECT s.status INTO _status
      FROM public.corporate_statement_manual_items mi
      JOIN public.sponsor_statements s ON s.id = mi.statement_id
     WHERE mi.manual_service_id = OLD.id
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

CREATE TRIGGER trg_enforce_corporate_manual_service_editability
  BEFORE INSERT OR UPDATE OR DELETE ON public.corporate_manual_service_rows
  FOR EACH ROW EXECUTE FUNCTION public.enforce_corporate_manual_service_editability();

CREATE OR REPLACE FUNCTION public.enforce_corporate_manual_item_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _statement RECORD;
  _manual RECORD;
BEGIN
  SELECT sponsor_id, period_year, period_month, status INTO _statement
    FROM public.sponsor_statements WHERE id = NEW.statement_id;
  SELECT sponsor_id, period_year, period_month INTO _manual
    FROM public.corporate_manual_service_rows WHERE id = NEW.manual_service_id;

  IF _statement.sponsor_id IS NULL OR _manual.sponsor_id IS NULL THEN
    RAISE EXCEPTION 'Statement or manual service row not found';
  END IF;
  IF _statement.status <> 'draft' THEN
    RAISE EXCEPTION 'Manual service rows can only be attached to a draft statement';
  END IF;
  IF _statement.sponsor_id <> _manual.sponsor_id
     OR _statement.period_year <> _manual.period_year
     OR _statement.period_month <> _manual.period_month THEN
    RAISE EXCEPTION 'Manual service row must belong to the same sponsor and statement period';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_corporate_manual_item_match
  BEFORE INSERT OR UPDATE ON public.corporate_statement_manual_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_corporate_manual_item_match();

-- The monthly statement exposes how many manual services form part of its total.
ALTER TABLE public.sponsor_statements
  ADD COLUMN IF NOT EXISTS manual_service_count INTEGER NOT NULL DEFAULT 0;

-- Use the invoice's corporate-account snapshot and add all manual rows from the same period.
CREATE OR REPLACE FUNCTION public.generate_sponsor_statement(
  _sponsor_id UUID,
  _year INT,
  _month INT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sponsor RECORD;
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
  IF NOT public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _month NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Invalid statement month';
  END IF;

  SELECT id, account_type, company_name INTO _sponsor
    FROM public.corporate_accounts WHERE id = _sponsor_id;
  IF _sponsor.id IS NULL THEN
    RAISE EXCEPTION 'Sponsor not found';
  END IF;
  IF _sponsor.account_type NOT IN ('corporate','retainer') THEN
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
        _sponsor.company_name, _year, _month, _existing_status;
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
       _sponsor.account_type, _year, _month, _start, _end, auth.uid());
  END IF;

  INSERT INTO public.sponsor_statement_items
    (statement_id, invoice_id, patient_id, amount, service_date)
  SELECT
    _statement_id, i.id, i.patient_id, i.total_amount, i.created_at::DATE
  FROM public.invoices i
  WHERE i.corporate_account_id = _sponsor_id
    AND i.sponsor_type = _sponsor.account_type
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
         generated_by = COALESCE(auth.uid(), generated_by),
         status = 'draft'
   WHERE id = _statement_id;

  RETURN _statement_id;
END;
$$;

-- Payment recording is the only supported path for corporate settlement.  It preserves
-- partial payments, lets payments exceed a statement (shown as credit), and marks a
-- statement paid only once payment evidence covers its total.
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
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _statement RECORD;
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

  SELECT * INTO _statement
    FROM public.sponsor_statements
   WHERE id = _statement_id
   FOR UPDATE;

  IF _statement.id IS NULL THEN
    RAISE EXCEPTION 'Statement not found';
  END IF;
  IF _statement.sponsor_type <> 'corporate' THEN
    RAISE EXCEPTION 'Corporate payment recording only applies to corporate statements';
  END IF;
  IF _statement.status IN ('draft','void') THEN
    RAISE EXCEPTION 'Finalize the statement before recording a payment';
  END IF;

  INSERT INTO public.corporate_statement_payments
    (statement_id, sponsor_id, payment_date, amount, payment_method, bank_reference, notes, recorded_by)
  VALUES
    (_statement.id, _statement.sponsor_id, _payment_date, _amount, _payment_method,
     NULLIF(btrim(_bank_reference), ''), NULLIF(btrim(_notes), ''), _uid)
  RETURNING id INTO _payment_id;

  SELECT COALESCE(SUM(amount), 0) INTO _paid_total
    FROM public.corporate_statement_payments
   WHERE statement_id = _statement.id;

  _new_status := CASE
    WHEN _paid_total >= _statement.total_amount THEN 'paid'
    WHEN _statement.status = 'printed' THEN 'printed'
    ELSE 'finalized'
  END;

  UPDATE public.sponsor_statements
     SET status = _new_status,
         paid_at = CASE WHEN _new_status = 'paid' THEN COALESCE(paid_at, now()) ELSE paid_at END,
         updated_at = now()
   WHERE id = _statement.id;

  PERFORM public.write_audit_log(
    'corporate_statement_payment_recorded',
    'corporate_statement_payment',
    _payment_id::TEXT,
    jsonb_build_object(
      'statement_id', _statement.id,
      'sponsor_id', _statement.sponsor_id,
      'amount', _amount,
      'payment_date', _payment_date,
      'payment_method', _payment_method,
      'bank_reference', NULLIF(btrim(_bank_reference), ''),
      'statement_total', _statement.total_amount,
      'paid_to_date', _paid_total,
      'credit', GREATEST(_paid_total - _statement.total_amount, 0)
    )
  );

  RETURN jsonb_build_object(
    'payment_id', _payment_id,
    'statement_id', _statement.id,
    'paid_to_date', _paid_total,
    'statement_total', _statement.total_amount,
    'balance', _statement.total_amount - _paid_total,
    'credit', GREATEST(_paid_total - _statement.total_amount, 0),
    'status', _new_status
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_corporate_statement_payment(UUID, DATE, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_corporate_statement_payment(UUID, DATE, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

-- Stop legacy status patches from marking a corporate statement paid without recorded payment evidence.
CREATE OR REPLACE FUNCTION public.prevent_unreconciled_corporate_paid_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _payment_total NUMERIC(14,2);
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' AND NEW.sponsor_type = 'corporate' THEN
    SELECT COALESCE(SUM(amount), 0) INTO _payment_total
      FROM public.corporate_statement_payments
     WHERE statement_id = NEW.id;
    IF _payment_total < NEW.total_amount THEN
      RAISE EXCEPTION 'Corporate statements may be marked paid only through recorded payments';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_unreconciled_corporate_paid_status
  BEFORE UPDATE OF status ON public.sponsor_statements
  FOR EACH ROW EXECUTE FUNCTION public.prevent_unreconciled_corporate_paid_status();

-- Provide a single reconciled payload for the covering letter as at a selected month-end.
CREATE OR REPLACE FUNCTION public.get_corporate_covering_letter_data(
  _sponsor_id UUID,
  _as_of_year INT,
  _as_of_month INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sponsor RECORD;
  _cutoff DATE;
  _payload JSONB;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _as_of_month NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Invalid statement month';
  END IF;

  SELECT id, company_name, contact_person, email, phone, address, account_type INTO _sponsor
    FROM public.corporate_accounts
   WHERE id = _sponsor_id;
  IF _sponsor.id IS NULL OR _sponsor.account_type <> 'corporate' THEN
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
      'id', _sponsor.id,
      'company_name', _sponsor.company_name,
      'contact_person', _sponsor.contact_person,
      'email', _sponsor.email,
      'phone', _sponsor.phone,
      'address', _sponsor.address
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

REVOKE EXECUTE ON FUNCTION public.get_corporate_covering_letter_data(UUID, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_corporate_covering_letter_data(UUID, INT, INT) TO authenticated;

-- Existing statement generation callers retain execute access after replacement.
REVOKE EXECUTE ON FUNCTION public.generate_sponsor_statement(UUID, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_sponsor_statement(UUID, INT, INT) TO authenticated;

COMMENT ON TABLE public.corporate_manual_service_rows IS
  'Company walk-in services entered from signed paper prescriptions or laboratory referrals.';
COMMENT ON TABLE public.corporate_statement_payments IS
  'Auditable payments against corporate monthly statements, including partial settlement and overpayment credit.';
COMMENT ON FUNCTION public.get_corporate_covering_letter_data(UUID, INT, INT) IS
  'Returns corporate statements, payments, current manual services, arrears, and credit data through a requested month.';
