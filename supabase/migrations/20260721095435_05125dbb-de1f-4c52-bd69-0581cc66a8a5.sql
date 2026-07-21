
-- Sponsor statements: consolidated monthly bills for corporate & retainer accounts
CREATE TABLE public.sponsor_statements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  statement_number TEXT NOT NULL UNIQUE,
  sponsor_id UUID NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE RESTRICT,
  sponsor_type TEXT NOT NULL CHECK (sponsor_type IN ('corporate','retainer')),
  period_year INT NOT NULL,
  period_month INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  invoice_count INT NOT NULL DEFAULT 0,
  patient_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized','printed','paid','void')),
  notes TEXT,
  generated_by UUID REFERENCES auth.users(id),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at TIMESTAMPTZ,
  printed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sponsor_id, period_year, period_month)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sponsor_statements TO authenticated;
GRANT ALL ON public.sponsor_statements TO service_role;
ALTER TABLE public.sponsor_statements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Accountants & admins can view statements" ON public.sponsor_statements
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]));
CREATE POLICY "Accountants & admins can manage statements" ON public.sponsor_statements
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]));

CREATE TABLE public.sponsor_statement_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  statement_id UUID NOT NULL REFERENCES public.sponsor_statements(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  amount NUMERIC(14,2) NOT NULL,
  service_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (statement_id, invoice_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sponsor_statement_items TO authenticated;
GRANT ALL ON public.sponsor_statement_items TO service_role;
ALTER TABLE public.sponsor_statement_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Accountants & admins can view items" ON public.sponsor_statement_items
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]));
CREATE POLICY "Accountants & admins can manage items" ON public.sponsor_statement_items
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]));

CREATE INDEX idx_sponsor_statement_items_statement ON public.sponsor_statement_items(statement_id);
CREATE INDEX idx_sponsor_statements_period ON public.sponsor_statements(period_year, period_month);
CREATE INDEX idx_sponsor_statements_sponsor ON public.sponsor_statements(sponsor_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_sponsor_statement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
REVOKE EXECUTE ON FUNCTION public.touch_sponsor_statement() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_touch_sponsor_statement BEFORE UPDATE ON public.sponsor_statements
  FOR EACH ROW EXECUTE FUNCTION public.touch_sponsor_statement();

-- Statement number generator: STM-YYYYMM-XXXX
CREATE OR REPLACE FUNCTION public.next_statement_number(_year INT, _month INT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _seq INT; BEGIN
  SELECT COUNT(*) + 1 INTO _seq FROM public.sponsor_statements
    WHERE period_year = _year AND period_month = _month;
  RETURN 'STM-' || _year::TEXT || LPAD(_month::TEXT, 2, '0') || '-' || LPAD(_seq::TEXT, 4, '0');
END; $$;
REVOKE EXECUTE ON FUNCTION public.next_statement_number(INT, INT) FROM PUBLIC, anon, authenticated;

-- Generate a single sponsor statement (idempotent for draft; will not touch finalized/paid)
CREATE OR REPLACE FUNCTION public.generate_sponsor_statement(
  _sponsor_id UUID, _year INT, _month INT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _sponsor RECORD;
  _start DATE;
  _end DATE;
  _statement_id UUID;
  _existing_status TEXT;
  _total NUMERIC(14,2) := 0;
  _inv_count INT := 0;
  _pat_count INT := 0;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT id, account_type, company_name INTO _sponsor
    FROM public.corporate_accounts WHERE id = _sponsor_id;
  IF _sponsor.id IS NULL THEN RAISE EXCEPTION 'Sponsor not found'; END IF;
  IF _sponsor.account_type NOT IN ('corporate','retainer') THEN
    RAISE EXCEPTION 'Sponsor is not a corporate or retainer account';
  END IF;

  _start := make_date(_year, _month, 1);
  _end   := (_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  SELECT id, status INTO _statement_id, _existing_status
    FROM public.sponsor_statements
    WHERE sponsor_id = _sponsor_id AND period_year = _year AND period_month = _month;

  IF _statement_id IS NOT NULL THEN
    IF _existing_status IN ('finalized','printed','paid') THEN
      RAISE EXCEPTION 'Statement for % (%-%) is % and cannot be regenerated. Void it first.',
        _sponsor.company_name, _year, _month, _existing_status;
    END IF;
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

  -- Insert every invoice in the period for patients linked to this sponsor
  INSERT INTO public.sponsor_statement_items
    (statement_id, invoice_id, patient_id, amount, service_date)
  SELECT
    _statement_id, i.id, i.patient_id, i.total_amount, i.created_at::date
  FROM public.invoices i
  JOIN public.patients p ON p.id = i.patient_id
  WHERE p.corporate_id = _sponsor_id
    AND p.account_type = _sponsor.account_type
    AND i.created_at >= _start
    AND i.created_at <  (_end + INTERVAL '1 day');

  SELECT COALESCE(SUM(amount),0), COUNT(*), COUNT(DISTINCT patient_id)
    INTO _total, _inv_count, _pat_count
  FROM public.sponsor_statement_items WHERE statement_id = _statement_id;

  UPDATE public.sponsor_statements
    SET total_amount = _total,
        invoice_count = _inv_count,
        patient_count = _pat_count,
        generated_at = now(),
        generated_by = COALESCE(auth.uid(), generated_by),
        status = 'draft'
    WHERE id = _statement_id;

  RETURN _statement_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.generate_sponsor_statement(UUID, INT, INT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.generate_sponsor_statement(UUID, INT, INT) TO authenticated;

-- Generate for every active sponsor in the given month
CREATE OR REPLACE FUNCTION public.generate_all_sponsor_statements(_year INT, _month INT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _rec RECORD; _count INT := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  FOR _rec IN
    SELECT id FROM public.corporate_accounts
    WHERE status = 'active' AND account_type IN ('corporate','retainer')
  LOOP
    BEGIN
      PERFORM public.generate_sponsor_statement(_rec.id, _year, _month);
      _count := _count + 1;
    EXCEPTION WHEN OTHERS THEN
      -- skip finalized/existing; keep going
      NULL;
    END;
  END LOOP;
  RETURN _count;
END; $$;
REVOKE EXECUTE ON FUNCTION public.generate_all_sponsor_statements(INT, INT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.generate_all_sponsor_statements(INT, INT) TO authenticated, service_role;
