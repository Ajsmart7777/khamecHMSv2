
-- =========================================================
-- WARDS / ROOMS / BEDS
-- =========================================================
CREATE TABLE public.wards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  ward_type TEXT NOT NULL DEFAULT 'general',
  gender TEXT NOT NULL DEFAULT 'any' CHECK (gender IN ('male','female','any')),
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wards TO authenticated;
GRANT ALL ON public.wards TO service_role;
ALTER TABLE public.wards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view wards" ON public.wards
  FOR SELECT TO authenticated USING (public.is_authenticated_staff());
CREATE POLICY "Admin manages wards" ON public.wards
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]));

CREATE TABLE public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ward_id UUID NOT NULL REFERENCES public.wards(id) ON DELETE CASCADE,
  room_number TEXT NOT NULL,
  room_class TEXT NOT NULL DEFAULT 'general' CHECK (room_class IN ('private','semi_private','general','icu','vip')),
  daily_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ward_id, room_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rooms TO authenticated;
GRANT ALL ON public.rooms TO service_role;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view rooms" ON public.rooms
  FOR SELECT TO authenticated USING (public.is_authenticated_staff());
CREATE POLICY "Admin manages rooms" ON public.rooms
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]));

CREATE TABLE public.beds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  bed_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','occupied','maintenance')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, bed_label)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.beds TO authenticated;
GRANT ALL ON public.beds TO service_role;
ALTER TABLE public.beds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view beds" ON public.beds
  FOR SELECT TO authenticated USING (public.is_authenticated_staff());
CREATE POLICY "Admin & nurses manage bed status" ON public.beds
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','accountant','nurse']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','accountant','nurse']::app_role[]));

-- =========================================================
-- ADMISSIONS
-- =========================================================
CREATE TABLE public.admissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL,
  bed_id UUID REFERENCES public.beds(id) ON DELETE SET NULL,
  admitting_doctor UUID REFERENCES auth.users(id),
  assigned_by_nurse UUID REFERENCES auth.users(id),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'waiting_assignment'
    CHECK (status IN ('waiting_assignment','active','discharged','cancelled')),
  admitted_at TIMESTAMPTZ,
  discharged_at TIMESTAMPTZ,
  discharge_notes TEXT,
  discharged_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admissions TO authenticated;
GRANT ALL ON public.admissions TO service_role;
ALTER TABLE public.admissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clinical & billing staff read admissions" ON public.admissions
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['doctor','doctor1','doctor2','nurse','billing','accountant','admin','claims_manager','receptionist']::app_role[]));

CREATE POLICY "Doctors create admissions" ON public.admissions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(),
    ARRAY['doctor','doctor1','doctor2','admin']::app_role[]));

CREATE POLICY "Nurses & admin update admissions" ON public.admissions
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(),
    ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','admin']::app_role[]));

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER wards_touch BEFORE UPDATE ON public.wards
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER rooms_touch BEFORE UPDATE ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER beds_touch BEFORE UPDATE ON public.beds
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER admissions_touch BEFORE UPDATE ON public.admissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Auto-sync bed occupancy on admission changes
CREATE OR REPLACE FUNCTION public.sync_bed_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Free old bed if changed or discharged
  IF TG_OP = 'UPDATE' THEN
    IF OLD.bed_id IS NOT NULL
       AND (OLD.bed_id IS DISTINCT FROM NEW.bed_id OR NEW.status IN ('discharged','cancelled')) THEN
      UPDATE public.beds SET status='available', updated_at=now() WHERE id = OLD.bed_id;
    END IF;
  END IF;
  -- Occupy new bed if active
  IF NEW.bed_id IS NOT NULL AND NEW.status = 'active' THEN
    UPDATE public.beds SET status='occupied', updated_at=now() WHERE id = NEW.bed_id;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER admissions_sync_bed
AFTER INSERT OR UPDATE OF bed_id, status ON public.admissions
FOR EACH ROW EXECUTE FUNCTION public.sync_bed_status();

-- =========================================================
-- SNAP ORDERS: extend for lab-result return routing
-- =========================================================
ALTER TABLE public.snap_orders
  ADD COLUMN IF NOT EXISTS original_sender_role TEXT,
  ADD COLUMN IF NOT EXISTS parent_snap_id UUID REFERENCES public.snap_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS returned_to UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ack_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ack_by UUID REFERENCES auth.users(id);

-- Drop old status check if present, widen order_type and target_station values
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snap_orders_order_type_check') THEN
    ALTER TABLE public.snap_orders DROP CONSTRAINT snap_orders_order_type_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snap_orders_target_station_check') THEN
    ALTER TABLE public.snap_orders DROP CONSTRAINT snap_orders_target_station_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snap_orders_status_check') THEN
    ALTER TABLE public.snap_orders DROP CONSTRAINT snap_orders_status_check;
  END IF;
END $$;

ALTER TABLE public.snap_orders
  ADD CONSTRAINT snap_orders_order_type_check
    CHECK (order_type IN ('prescription','lab','treatment','lab_result')),
  ADD CONSTRAINT snap_orders_target_station_check
    CHECK (target_station IN ('pharmacy','lab','doctor','nurse','billing')),
  ADD CONSTRAINT snap_orders_status_check
    CHECK (status IN ('pending_billing','awaiting_payment','paid','fulfilled','rejected','cancelled','returned','acknowledged'));

CREATE INDEX IF NOT EXISTS snap_orders_returned_idx
  ON public.snap_orders(returned_to, status) WHERE order_type = 'lab_result';
