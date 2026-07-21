
CREATE EXTENSION IF NOT EXISTS pg_trgm;

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

CREATE INDEX IF NOT EXISTS pricelist_search_idx ON public.pricelist USING gin (search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS pricelist_category_idx ON public.pricelist(category);
CREATE UNIQUE INDEX IF NOT EXISTS pricelist_unique_name_size ON public.pricelist(lower(name), lower(coalesce(size,'')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pricelist TO authenticated;
GRANT ALL ON public.pricelist TO service_role;
ALTER TABLE public.pricelist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Any staff can view pricelist"
  ON public.pricelist FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Admin/accountant manage pricelist"
  ON public.pricelist FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]));

CREATE TRIGGER trg_pricelist_updated
  BEFORE UPDATE ON public.pricelist
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

-- snap_orders
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
  created_by  UUID REFERENCES auth.users(id),
  billed_by   UUID REFERENCES auth.users(id),
  billed_at   TIMESTAMPTZ,
  paid_at     TIMESTAMPTZ,
  fulfilled_by UUID REFERENCES auth.users(id),
  fulfilled_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS snap_orders_patient_idx ON public.snap_orders(patient_id);
CREATE INDEX IF NOT EXISTS snap_orders_status_idx  ON public.snap_orders(status);
CREATE INDEX IF NOT EXISTS snap_orders_target_idx  ON public.snap_orders(target_station, status);
CREATE INDEX IF NOT EXISTS snap_orders_visit_idx   ON public.snap_orders(visit_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.snap_orders TO authenticated;
GRANT ALL ON public.snap_orders TO service_role;
ALTER TABLE public.snap_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view snap orders"
  ON public.snap_orders FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Clinicians create snap orders"
  ON public.snap_orders FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(),
    ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]));

CREATE POLICY "Ops update snap orders"
  ON public.snap_orders FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['billing','accountant','pharmacist','lab_tech','admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(),
    ARRAY['billing','accountant','pharmacist','lab_tech','admin']::app_role[]));

CREATE POLICY "Admin delete snap orders"
  ON public.snap_orders FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_snap_orders_updated
  BEFORE UPDATE ON public.snap_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

CREATE TRIGGER trg_snap_orders_autofill_visit
  BEFORE INSERT ON public.snap_orders
  FOR EACH ROW EXECUTE FUNCTION public.autofill_visit_id();

-- Auto-mark snap as paid when its invoice is fully paid
CREATE OR REPLACE FUNCTION public.snap_orders_sync_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.paid_amount >= NEW.total_amount AND NEW.total_amount > 0
     AND (TG_OP = 'INSERT' OR OLD.paid_amount < OLD.total_amount) THEN
    UPDATE public.snap_orders
      SET status = 'paid', paid_at = now(), updated_at = now()
    WHERE invoice_id = NEW.id
      AND status = 'awaiting_payment';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snap_paid_sync ON public.invoices;
CREATE TRIGGER trg_snap_paid_sync
  AFTER INSERT OR UPDATE OF paid_amount, total_amount ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.snap_orders_sync_paid();
