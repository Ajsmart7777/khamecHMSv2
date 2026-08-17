-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 13
CREATE TRIGGER visits_touch_updated_at
  BEFORE UPDATE ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 14
CREATE TABLE IF NOT EXISTS public.visit_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  label TEXT,
  station public.visit_station NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  captured_by UUID REFERENCES public.auth_users(id),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 15
CREATE INDEX IF NOT EXISTS visit_attachments_visit_idx ON public.visit_attachments (visit_id, captured_at DESC);

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 16
CREATE INDEX IF NOT EXISTS visit_attachments_patient_idx ON public.visit_attachments (patient_id, captured_at DESC);

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 17
GRANT SELECT, INSERT, DELETE ON public.visit_attachments TO authenticated;

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 18
GRANT ALL ON public.visit_attachments TO service_role;

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 19
ALTER TABLE public.visit_attachments ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 20
CREATE POLICY "Authenticated staff can view attachments"
  ON public.visit_attachments FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 21
CREATE POLICY "Staff can add attachments"
  ON public.visit_attachments FOR INSERT TO authenticated
  WITH CHECK (
    captured_by = public.hms_current_user_id()
    AND public.has_any_role(public.hms_current_user_id(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','lab_tech','pharmacist','billing','accountant','admin']::app_role[])
  );

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 22
CREATE POLICY "Admin can delete attachments"
  ON public.visit_attachments FOR DELETE TO authenticated
  USING (public.has_role(public.hms_current_user_id(), 'admin'));

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 23
ALTER TABLE public.invoices        ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL;

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 24
ALTER TABLE public.prescriptions   ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL;

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 25
ALTER TABLE public.lab_requests    ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL;

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 26
ALTER TABLE public.vitals          ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL;

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 27
ALTER TABLE public.standing_orders ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL;

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 28
CREATE INDEX IF NOT EXISTS invoices_visit_idx        ON public.invoices(visit_id);

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 29
CREATE INDEX IF NOT EXISTS prescriptions_visit_idx   ON public.prescriptions(visit_id);

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 30
CREATE INDEX IF NOT EXISTS lab_requests_visit_idx    ON public.lab_requests(visit_id);

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 31
CREATE INDEX IF NOT EXISTS vitals_visit_idx          ON public.vitals(visit_id);

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 32
CREATE INDEX IF NOT EXISTS standing_orders_visit_idx ON public.standing_orders(visit_id);

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 33
CREATE OR REPLACE FUNCTION public.next_visit_number()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER  AS $$
DECLARE
  _prefix TEXT := 'VST-' || to_char(now(),'YYMMDD') || '-';
  _seq INT;
BEGIN
  SELECT COUNT(*)+1 INTO _seq FROM public.visits WHERE visit_number LIKE _prefix || '%';
  RETURN _prefix || LPAD(_seq::TEXT, 4, '0');
END; $$;

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 34
CREATE OR REPLACE FUNCTION public.open_visit_for_patient(
  _patient_id UUID,
  _presenting_complaint TEXT DEFAULT NULL,
  _force_new BOOLEAN DEFAULT FALSE,
  _force_new_reason TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER  AS $$
DECLARE
  _existing UUID;
  _new_id UUID;
  _p public.patients;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(),
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

  SELECT * INTO _p FROM public.patients WHERE id = _patient_id;
  IF _p IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  INSERT INTO public.visits (
    visit_number, patient_id, presenting_complaint,
    sponsor_type, corporate_id, insurance_plan,
    opened_by, force_new_reason
  ) VALUES (
    public.next_visit_number(), _patient_id, _presenting_complaint,
    (_p).account_type, NULLIF(((_p).corporate_id)::STRING, '')::UUID, (_p).insurance_plan,
    public.hms_current_user_id(), CASE WHEN _force_new THEN _force_new_reason END
  ) RETURNING id INTO _new_id;

  RETURN _new_id;
END; $$;

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 35
CREATE OR REPLACE FUNCTION public.autofill_visit_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER  AS $$
DECLARE _vid UUID;
BEGIN
  IF (NEW).visit_id IS NULL AND (NEW).patient_id IS NOT NULL THEN
    SELECT id INTO _vid FROM public.visits
      WHERE patient_id = (NEW).patient_id AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1;
    IF _vid IS NOT NULL THEN NEW.visit_id := _vid; END IF;
  END IF;
  RETURN NEW;
END; $$;

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 36
DROP TRIGGER IF EXISTS invoices_autofill_visit ON public.invoices;

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 37
CREATE TRIGGER invoices_autofill_visit BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.autofill_visit_id();

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 38
DROP TRIGGER IF EXISTS prescriptions_autofill_visit ON public.prescriptions;

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 39
CREATE TRIGGER prescriptions_autofill_visit BEFORE INSERT ON public.prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.autofill_visit_id();

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 40
DROP TRIGGER IF EXISTS lab_requests_autofill_visit ON public.lab_requests;

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 41
CREATE TRIGGER lab_requests_autofill_visit BEFORE INSERT ON public.lab_requests
  FOR EACH ROW EXECUTE FUNCTION public.autofill_visit_id();

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 42
DROP TRIGGER IF EXISTS vitals_autofill_visit ON public.vitals;

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 43
CREATE TRIGGER vitals_autofill_visit BEFORE INSERT ON public.vitals
  FOR EACH ROW EXECUTE FUNCTION public.autofill_visit_id();

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 44
DROP TRIGGER IF EXISTS standing_orders_autofill_visit ON public.standing_orders;

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 45
CREATE TRIGGER standing_orders_autofill_visit BEFORE INSERT ON public.standing_orders
  FOR EACH ROW EXECUTE FUNCTION public.autofill_visit_id();

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 46
CREATE OR REPLACE FUNCTION public.recalc_visit_totals(_visit_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER  AS $$
BEGIN
  IF _visit_id IS NULL THEN RETURN; END IF;
  UPDATE public.visits v SET
    total_charged = COALESCE((SELECT SUM(total_amount) FROM public.invoices WHERE visit_id = _visit_id), 0),
    total_paid    = COALESCE((SELECT SUM(paid_amount)  FROM public.invoices WHERE visit_id = _visit_id), 0),
    updated_at = now()
  WHERE v.id = _visit_id;
END; $$;

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 47
CREATE OR REPLACE FUNCTION public.invoices_touch_visit_totals()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _old_visit UUID;
  _new_visit UUID;
  _old_charged NUMERIC := 0;
  _old_paid NUMERIC := 0;
  _new_charged NUMERIC := 0;
  _new_paid NUMERIC := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _old_visit := (OLD).visit_id;
    _old_charged := COALESCE((OLD).total_amount, 0);
    _old_paid := COALESCE((OLD).paid_amount, 0);
    IF _old_visit IS NOT NULL THEN
      UPDATE public.visits
      SET total_charged = COALESCE(total_charged, 0) - _old_charged,
          total_paid = COALESCE(total_paid, 0) - _old_paid,
          updated_at = now()
      WHERE id = _old_visit;
    END IF;
    RETURN OLD;
  END IF;

  _new_visit := (NEW).visit_id;
  _new_charged := COALESCE((NEW).total_amount, 0);
  _new_paid := COALESCE((NEW).paid_amount, 0);
  IF TG_OP = 'UPDATE' THEN
    _old_visit := (OLD).visit_id;
    _old_charged := COALESCE((OLD).total_amount, 0);
    _old_paid := COALESCE((OLD).paid_amount, 0);
    IF _old_visit IS DISTINCT FROM _new_visit THEN
      IF _old_visit IS NOT NULL THEN
        UPDATE public.visits
        SET total_charged = COALESCE(total_charged, 0) - _old_charged,
            total_paid = COALESCE(total_paid, 0) - _old_paid,
            updated_at = now()
        WHERE id = _old_visit;
      END IF;
      IF _new_visit IS NOT NULL THEN
        UPDATE public.visits
        SET total_charged = COALESCE(total_charged, 0) + _new_charged,
            total_paid = COALESCE(total_paid, 0) + _new_paid,
            updated_at = now()
        WHERE id = _new_visit;
      END IF;
    ELSE
      IF _new_visit IS NOT NULL THEN
        UPDATE public.visits
        SET total_charged = COALESCE(total_charged, 0) + (_new_charged - _old_charged),
            total_paid = COALESCE(total_paid, 0) + (_new_paid - _old_paid),
            updated_at = now()
        WHERE id = _new_visit;
      END IF;
    END IF;
  ELSE
    IF _new_visit IS NOT NULL THEN
      UPDATE public.visits
      SET total_charged = COALESCE(total_charged, 0) + _new_charged,
          total_paid = COALESCE(total_paid, 0) + _new_paid,
          updated_at = now()
      WHERE id = _new_visit;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 48
DROP TRIGGER IF EXISTS invoices_visit_totals ON public.invoices;

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 49
CREATE OR REPLACE FUNCTION public.invoices_touch_visit_totals()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _old_visit UUID;
  _new_visit UUID;
  _old_charged NUMERIC := 0;
  _old_paid NUMERIC := 0;
  _new_charged NUMERIC := 0;
  _new_paid NUMERIC := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _old_visit := (OLD).visit_id;
    _old_charged := COALESCE((OLD).total_amount, 0);
    _old_paid := COALESCE((OLD).paid_amount, 0);
    IF _old_visit IS NOT NULL THEN
      UPDATE public.visits
      SET total_charged = COALESCE(total_charged, 0) - _old_charged,
          total_paid = COALESCE(total_paid, 0) - _old_paid,
          updated_at = now()
      WHERE id = _old_visit;
    END IF;
    RETURN OLD;
  END IF;

  _new_visit := (NEW).visit_id;
  _new_charged := COALESCE((NEW).total_amount, 0);
  _new_paid := COALESCE((NEW).paid_amount, 0);
  IF TG_OP = 'UPDATE' THEN
    _old_visit := (OLD).visit_id;
    _old_charged := COALESCE((OLD).total_amount, 0);
    _old_paid := COALESCE((OLD).paid_amount, 0);
    IF _old_visit IS DISTINCT FROM _new_visit THEN
      IF _old_visit IS NOT NULL THEN
        UPDATE public.visits
        SET total_charged = COALESCE(total_charged, 0) - _old_charged,
            total_paid = COALESCE(total_paid, 0) - _old_paid,
            updated_at = now()
        WHERE id = _old_visit;
      END IF;
      IF _new_visit IS NOT NULL THEN
        UPDATE public.visits
        SET total_charged = COALESCE(total_charged, 0) + _new_charged,
            total_paid = COALESCE(total_paid, 0) + _new_paid,
            updated_at = now()
        WHERE id = _new_visit;
      END IF;
    ELSE
      IF _new_visit IS NOT NULL THEN
        UPDATE public.visits
        SET total_charged = COALESCE(total_charged, 0) + (_new_charged - _old_charged),
            total_paid = COALESCE(total_paid, 0) + (_new_paid - _old_paid),
            updated_at = now()
        WHERE id = _new_visit;
      END IF;
    END IF;
  ELSE
    IF _new_visit IS NOT NULL THEN
      UPDATE public.visits
      SET total_charged = COALESCE(total_charged, 0) + _new_charged,
          total_paid = COALESCE(total_paid, 0) + _new_paid,
          updated_at = now()
      WHERE id = _new_visit;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 50
CREATE OR REPLACE FUNCTION public.close_visit(_visit_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER  AS $$
DECLARE _v public.visits;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only billing/cashier/admin can settle a visit';
  END IF;
  SELECT public.recalc_visit_totals(_visit_id);
  SELECT * INTO _v FROM public.visits WHERE id = _visit_id;
  IF _v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF (_v).status <> 'open' THEN RAISE EXCEPTION 'Visit is already %', (_v).status; END IF;

  UPDATE public.visits
    SET status = 'settled', closed_at = now(), closed_by = public.hms_current_user_id(), updated_at = now()
  WHERE id = _visit_id;

  SELECT public.write_audit_log('visit_settled', 'visit', _visit_id::text, jsonb_build_object(
      'visit_number', (_v).visit_number,
      'patient_id', (_v).patient_id,
      'sponsor_type', (_v).sponsor_type,
      'total_charged', (_v).total_charged,
      'total_paid', (_v).total_paid
    )
  , 'success');
END; $$;

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 2
CREATE TABLE IF NOT EXISTS public.pricelist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  size TEXT,
  pack_qty INT NOT NULL DEFAULT 1,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  category TEXT NOT NULL CHECK (category IN (
    'drug_liquid','drug_tablet','drug_capsule','drug_injection',
    'drug_topical','consumable','lab','imaging','bed','procedure','other'
  )),
  search_text TEXT GENERATED ALWAYS AS (
    lower(coalesce(name,'') || ' ' || coalesce(size,''))
  ) STORED,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 3
CREATE INDEX IF NOT EXISTS pricelist_search_idx ON public.pricelist USING gin (search_text gin_trgm_ops);

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 4
CREATE INDEX IF NOT EXISTS pricelist_category_idx ON public.pricelist(category);

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 5
CREATE UNIQUE INDEX IF NOT EXISTS pricelist_unique_name_size ON public.pricelist(lower(name), lower(coalesce(size,'')));

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 6
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pricelist TO authenticated;

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 7
GRANT ALL ON public.pricelist TO service_role;

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 8
ALTER TABLE public.pricelist ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 9
CREATE POLICY "Any staff can view pricelist"
  ON public.pricelist FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 10
CREATE POLICY "Admin/accountant manage pricelist"
  ON public.pricelist FOR ALL TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['admin','accountant']::app_role[]))
  WITH CHECK (public.has_any_role(public.hms_current_user_id(), ARRAY['admin','accountant']::app_role[]));

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 11
CREATE TRIGGER trg_pricelist_updated
  BEFORE UPDATE ON public.pricelist
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 12
CREATE TABLE IF NOT EXISTS public.snap_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  visit_id   UUID REFERENCES public.visits(id) ON DELETE SET NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('prescription','lab','treatment')),
  target_station TEXT NOT NULL CHECK (target_station IN ('pharmacy','lab')),
  source_role TEXT NOT NULL,
  photo_path TEXT NOT NULL,
  note TEXT,
  ocr_text TEXT,
  ocr_confidence NUMERIC(4,3),
  matched_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending_billing' CHECK (status IN (
    'pending_billing','awaiting_payment','paid','fulfilled','rejected','cancelled'
  )),
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES public.auth_users(id),
  billed_by   UUID REFERENCES public.auth_users(id),
  billed_at   TIMESTAMPTZ,
  paid_at     TIMESTAMPTZ,
  fulfilled_by UUID REFERENCES public.auth_users(id),
  fulfilled_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 13
CREATE INDEX IF NOT EXISTS snap_orders_patient_idx ON public.snap_orders(patient_id);

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 14
CREATE INDEX IF NOT EXISTS snap_orders_status_idx  ON public.snap_orders(status);

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 15
CREATE INDEX IF NOT EXISTS snap_orders_target_idx  ON public.snap_orders(target_station, status);

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 16
CREATE INDEX IF NOT EXISTS snap_orders_visit_idx   ON public.snap_orders(visit_id);

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 17
GRANT SELECT, INSERT, UPDATE, DELETE ON public.snap_orders TO authenticated;

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 18
GRANT ALL ON public.snap_orders TO service_role;

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 19
ALTER TABLE public.snap_orders ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 20
CREATE POLICY "Staff view snap orders"
  ON public.snap_orders FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 21
CREATE POLICY "Clinicians create snap orders"
  ON public.snap_orders FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(public.hms_current_user_id(),
    ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]));

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 22
CREATE POLICY "Ops update snap orders"
  ON public.snap_orders FOR UPDATE TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(),
    ARRAY['billing','accountant','pharmacist','lab_tech','admin']::app_role[]))
  WITH CHECK (public.has_any_role(public.hms_current_user_id(),
    ARRAY['billing','accountant','pharmacist','lab_tech','admin']::app_role[]));

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 23
CREATE POLICY "Admin delete snap orders"
  ON public.snap_orders FOR DELETE TO authenticated
  USING (public.has_role(public.hms_current_user_id(),'admin'));
