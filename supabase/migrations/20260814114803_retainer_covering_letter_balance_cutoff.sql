-- Correct the Retainer covering letter so a historical letter does not display
-- a deposit balance that was posted after its selected statement month.
CREATE OR REPLACE FUNCTION public.get_retainer_covering_letter_data(
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
  _history_cutoff DATE;
  _available_deposit NUMERIC(14,2);
  _payload JSONB;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _as_of_month NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Invalid statement month';
  END IF;

  SELECT id, company_name, contact_person, email, phone, address, account_type, balance
    INTO _sponsor
    FROM public.corporate_accounts
   WHERE id = _sponsor_id;

  IF _sponsor.id IS NULL OR _sponsor.account_type <> 'retainer' THEN
    RAISE EXCEPTION 'Retainer sponsor not found';
  END IF;

  _cutoff := (make_date(_as_of_year, _as_of_month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
  _history_cutoff := LEAST(_cutoff, CURRENT_DATE);

  IF _cutoff >= CURRENT_DATE THEN
    _available_deposit := GREATEST(COALESCE(_sponsor.balance, 0), 0);
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

COMMENT ON FUNCTION public.get_retainer_covering_letter_data(UUID, INT, INT) IS
  'Returns Retainer statements, deposit applications, balance history, arrears, and an as-of available deposit balance for a selected covering-letter period.';
