-- Sponsor month-end: full service-column set for manual patient records and
-- strict manual close semantics for Corporate/Retainer month-end.
--
-- 1. corporate_manual_patient_records gains the complete service column set
--    (consultation, drugs_dressing, blood_iv_fluid, surgery, xray, delivery)
--    alongside the existing medication, lab_test, bed, others columns.
-- 2. Manual walk-in service rows and manual patient records may be edited for
--    any month until the accountant explicitly closes that month through
--    close_corporate_month / close_retainer_month. No auto finalization.

-- 1. New service columns on manual patient records (CockroachDB-safe ADD COLUMN IF NOT EXISTS).
ALTER TABLE public.corporate_manual_patient_records
  ADD COLUMN IF NOT EXISTS consultation NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.corporate_manual_patient_records
  ADD COLUMN IF NOT EXISTS drugs_dressing NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.corporate_manual_patient_records
  ADD COLUMN IF NOT EXISTS blood_iv_fluid NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.corporate_manual_patient_records
  ADD COLUMN IF NOT EXISTS surgery NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.corporate_manual_patient_records
  ADD COLUMN IF NOT EXISTS xray NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.corporate_manual_patient_records
  ADD COLUMN IF NOT EXISTS delivery NUMERIC NOT NULL DEFAULT 0;

-- Walk-in paper services also record their service category column so the
-- covering-letter/covering tables can classify the slip consistently.
ALTER TABLE public.corporate_manual_service_rows
  ADD COLUMN IF NOT EXISTS service_category TEXT NOT NULL DEFAULT 'others';

-- 2. Manual close semantics. sponsor_statements may only leave 'draft' through
--    close_corporate_month / close_retainer_month (which stamp finalized_at).
--    Direct status patches from the UI (e.g. print actions, bulk finalize) are
--    blocked. Settlement transitions (finalized -> paid) stay allowed when
--    payments/funding actually landed.
--
--    CockroachDB (<= v26.2): trigger-record fields must be read in the
--    parenthesized composite form (NEW).col / (OLD).col. Plain NEW.col is
--    resolved as a relation.column prefix and fails at CREATE FUNCTION with
--    'no data source matches prefix: new in this context' (issue #114687;
--    unparenthesized plpgsql resolution returns in v26.3).
CREATE OR REPLACE FUNCTION public.enforce_sponsor_statement_manual_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW).status IS DISTINCT FROM (OLD).status THEN
    -- Draft -> finalized without an explicit close timestamp is auto
    -- finalization and is rejected. close_*_month functions always set
    -- finalized_at alongside the status change.
    IF (NEW).status = 'finalized' AND (OLD).status = 'draft' AND (NEW).finalized_at IS NULL THEN
      RAISE EXCEPTION 'Month-end reports are closed only by the accountant through Close & Issue; set finalized_at via close_corporate_month/close_retainer_month';
    END IF;

    -- Draft -> printed directly is also an unauthorized close.
    IF (NEW).status = 'printed' AND (OLD).status = 'draft' AND (NEW).finalized_at IS NULL THEN
      RAISE EXCEPTION 'Month-end reports are issued only through Close & Issue by the accountant';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_sponsor_statement_manual_close ON public.sponsor_statements;
CREATE TRIGGER trg_enforce_sponsor_statement_manual_close
  BEFORE UPDATE ON public.sponsor_statements
  FOR EACH ROW EXECUTE FUNCTION public.enforce_sponsor_statement_manual_close();

-- 3. Manual patient records stay editable for every month until the accountant
--    closes it. Mirror the walk-in service-row guard used by corporate claims.
CREATE OR REPLACE FUNCTION public.enforce_manual_patient_record_editability()
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
      FROM public.sponsor_statements s
     WHERE s.sponsor_id = (OLD).sponsor_id
       AND s.period_year = (OLD).period_year
       AND s.period_month = (OLD).period_month
       AND s.status IN ('finalized','printed','paid')
     LIMIT 1;
  END IF;

  IF _status IS NOT NULL THEN
    RAISE EXCEPTION 'Manual patient records are locked because the % report was already closed and issued', _status;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_manual_patient_record_editability ON public.corporate_manual_patient_records;
CREATE TRIGGER trg_enforce_manual_patient_record_editability
  BEFORE INSERT OR UPDATE OR DELETE ON public.corporate_manual_patient_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_manual_patient_record_editability();
