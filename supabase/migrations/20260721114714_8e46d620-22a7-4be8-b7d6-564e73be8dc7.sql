-- ============================================================================
-- VISIT CARD SYSTEM
-- ============================================================================

-- Enum: which station captured/attached something
DO $$ BEGIN
  CREATE TYPE public.visit_station AS ENUM (
    'reception','nurse','doctor','lab','pharmacy','billing','cashier','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.visit_status AS ENUM ('open','settled','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- visits: one envelope per patient visit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_number TEXT NOT NULL UNIQUE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  status public.visit_status NOT NULL DEFAULT 'open',
  presenting_complaint TEXT,
  -- snapshot at check-in so mid-visit changes don't corrupt claims
  sponsor_type TEXT,
  corporate_id UUID REFERENCES public.corporate_accounts(id) ON DELETE SET NULL,
  insurance_plan TEXT,
  -- running totals kept in sync by triggers
  total_charged NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_by UUID REFERENCES auth.users(id),
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES auth.users(id),
  cancel_reason TEXT,
  force_new_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visits_patient_status_idx ON public.visits (patient_id, status);
CREATE INDEX IF NOT EXISTS visits_status_opened_idx ON public.visits (status, opened_at DESC);
CREATE INDEX IF NOT EXISTS visits_sponsor_idx ON public.visits (sponsor_type, corporate_id);

GRANT SELECT, INSERT, UPDATE ON public.visits TO authenticated;
GRANT ALL ON public.visits TO service_role;

ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated staff can view visits"
  ON public.visits FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Clinical/reception/billing can open visits"
  ON public.visits FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','billing','admin']::app_role[]));

CREATE POLICY "Staff can update visits"
  ON public.visits FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','lab_tech','pharmacist','billing','accountant','admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','lab_tech','pharmacist','billing','accountant','admin']::app_role[]));

CREATE TRIGGER visits_touch_updated_at
  BEFORE UPDATE ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

-- ---------------------------------------------------------------------------
-- visit_attachments: photos captured at each station
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.visit_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  label TEXT,
  station public.visit_station NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  captured_by UUID REFERENCES auth.users(id),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visit_attachments_visit_idx ON public.visit_attachments (visit_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS visit_attachments_patient_idx ON public.visit_attachments (patient_id, captured_at DESC);

GRANT SELECT, INSERT, DELETE ON public.visit_attachments TO authenticated;
GRANT ALL ON public.visit_attachments TO service_role;

ALTER TABLE public.visit_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated staff can view attachments"
  ON public.visit_attachments FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Staff can add attachments"
  ON public.visit_attachments FOR INSERT TO authenticated
  WITH CHECK (
    captured_by = auth.uid()
    AND public.has_any_role(auth.uid(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','lab_tech','pharmacist','billing','accountant','admin']::app_role[])
  );

CREATE POLICY "Admin can delete attachments"
  ON public.visit_attachments FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- Backfill FK columns on existing tables (nullable — legacy rows stay valid)
-- ---------------------------------------------------------------------------
ALTER TABLE public.invoices        ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL;
ALTER TABLE public.prescriptions   ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL;
ALTER TABLE public.lab_requests    ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL;
ALTER TABLE public.vitals          ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL;
ALTER TABLE public.standing_orders ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS invoices_visit_idx        ON public.invoices(visit_id);
CREATE INDEX IF NOT EXISTS prescriptions_visit_idx   ON public.prescriptions(visit_id);
CREATE INDEX IF NOT EXISTS lab_requests_visit_idx    ON public.lab_requests(visit_id);
CREATE INDEX IF NOT EXISTS vitals_visit_idx          ON public.vitals(visit_id);
CREATE INDEX IF NOT EXISTS standing_orders_visit_idx ON public.standing_orders(visit_id);

-- ---------------------------------------------------------------------------
-- Helper: generate next visit number VST-YYMMDD-XXXX
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_visit_number()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _prefix TEXT := 'VST-' || to_char(now(),'YYMMDD') || '-';
  _seq INT;
BEGIN
  SELECT COUNT(*)+1 INTO _seq FROM public.visits WHERE visit_number LIKE _prefix || '%';
  RETURN _prefix || LPAD(_seq::TEXT, 4, '0');
END; $$;

-- ---------------------------------------------------------------------------
-- Helper: open (or resume) a visit for a patient
--   _force_new = true always opens a fresh visit even if one is open
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.open_visit_for_patient(
  _patient_id UUID,
  _presenting_complaint TEXT DEFAULT NULL,
  _force_new BOOLEAN DEFAULT FALSE,
  _force_new_reason TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _existing UUID;
  _new_id UUID;
  _p RECORD;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
       ARRAY['receptionist','nurse','doctor','doctor1','doctor2','billing','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to open a visit';
  END IF;

  IF NOT _force_new THEN
    SELECT id INTO _existing FROM public.visits
      WHERE patient_id = _patient_id AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1;
    IF _existing IS NOT NULL THEN
      RETURN _existing;
    END IF;
  END IF;

  SELECT account_type, corporate_id, insurance_plan
    INTO _p FROM public.patients WHERE id = _patient_id;
  IF _p IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  INSERT INTO public.visits (
    visit_number, patient_id, presenting_complaint,
    sponsor_type, corporate_id, insurance_plan,
    opened_by, force_new_reason
  ) VALUES (
    public.next_visit_number(), _patient_id, _presenting_complaint,
    _p.account_type, _p.corporate_id, _p.insurance_plan,
    auth.uid(), CASE WHEN _force_new THEN _force_new_reason END
  ) RETURNING id INTO _new_id;

  RETURN _new_id;
END; $$;

-- ---------------------------------------------------------------------------
-- Auto-attach new invoices/prescriptions/lab/vitals/standing orders to the
-- patient's currently open visit (only when visit_id was not set explicitly)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.autofill_visit_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _vid UUID;
BEGIN
  IF NEW.visit_id IS NULL AND NEW.patient_id IS NOT NULL THEN
    SELECT id INTO _vid FROM public.visits
      WHERE patient_id = NEW.patient_id AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1;
    IF _vid IS NOT NULL THEN NEW.visit_id := _vid; END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS invoices_autofill_visit ON public.invoices;
CREATE TRIGGER invoices_autofill_visit BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.autofill_visit_id();

DROP TRIGGER IF EXISTS prescriptions_autofill_visit ON public.prescriptions;
CREATE TRIGGER prescriptions_autofill_visit BEFORE INSERT ON public.prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.autofill_visit_id();

DROP TRIGGER IF EXISTS lab_requests_autofill_visit ON public.lab_requests;
CREATE TRIGGER lab_requests_autofill_visit BEFORE INSERT ON public.lab_requests
  FOR EACH ROW EXECUTE FUNCTION public.autofill_visit_id();

DROP TRIGGER IF EXISTS vitals_autofill_visit ON public.vitals;
CREATE TRIGGER vitals_autofill_visit BEFORE INSERT ON public.vitals
  FOR EACH ROW EXECUTE FUNCTION public.autofill_visit_id();

DROP TRIGGER IF EXISTS standing_orders_autofill_visit ON public.standing_orders;
CREATE TRIGGER standing_orders_autofill_visit BEFORE INSERT ON public.standing_orders
  FOR EACH ROW EXECUTE FUNCTION public.autofill_visit_id();

-- ---------------------------------------------------------------------------
-- Keep visit totals in sync from invoices
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalc_visit_totals(_visit_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _visit_id IS NULL THEN RETURN; END IF;
  UPDATE public.visits v SET
    total_charged = COALESCE((SELECT SUM(total_amount) FROM public.invoices WHERE visit_id = _visit_id), 0),
    total_paid    = COALESCE((SELECT SUM(paid_amount)  FROM public.invoices WHERE visit_id = _visit_id), 0),
    updated_at = now()
  WHERE v.id = _visit_id;
END; $$;

CREATE OR REPLACE FUNCTION public.invoices_touch_visit_totals()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_visit_totals(OLD.visit_id);
    RETURN OLD;
  ELSE
    PERFORM public.recalc_visit_totals(NEW.visit_id);
    IF TG_OP = 'UPDATE' AND OLD.visit_id IS DISTINCT FROM NEW.visit_id THEN
      PERFORM public.recalc_visit_totals(OLD.visit_id);
    END IF;
    RETURN NEW;
  END IF;
END; $$;

DROP TRIGGER IF EXISTS invoices_visit_totals ON public.invoices;
CREATE TRIGGER invoices_visit_totals
  AFTER INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.invoices_touch_visit_totals();

-- ---------------------------------------------------------------------------
-- Close (settle) a visit
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_visit(_visit_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _v RECORD;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only billing/cashier/admin can settle a visit';
  END IF;
  PERFORM public.recalc_visit_totals(_visit_id);
  SELECT * INTO _v FROM public.visits WHERE id = _visit_id;
  IF _v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF _v.status <> 'open' THEN RAISE EXCEPTION 'Visit is already %', _v.status; END IF;

  UPDATE public.visits
    SET status = 'settled', closed_at = now(), closed_by = auth.uid(), updated_at = now()
  WHERE id = _visit_id;

  PERFORM public.write_audit_log(
    'visit_settled', 'visit', _visit_id::text,
    jsonb_build_object(
      'visit_number', _v.visit_number,
      'patient_id', _v.patient_id,
      'sponsor_type', _v.sponsor_type,
      'total_charged', _v.total_charged,
      'total_paid', _v.total_paid
    )
  );
END; $$;
