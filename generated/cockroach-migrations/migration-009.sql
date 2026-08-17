-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 24
CREATE TRIGGER trg_snap_orders_updated
  BEFORE UPDATE ON public.snap_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 25
CREATE TRIGGER trg_snap_orders_autofill_visit
  BEFORE INSERT ON public.snap_orders
  FOR EACH ROW EXECUTE FUNCTION public.autofill_visit_id();

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 26
CREATE OR REPLACE FUNCTION public.snap_orders_sync_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
BEGIN
  IF (NEW).paid_amount >= (NEW).total_amount AND (NEW).total_amount > 0
     AND (TG_OP = 'INSERT' OR (OLD).paid_amount < (OLD).total_amount) THEN
    UPDATE public.snap_orders
      SET status = 'paid', paid_at = now(), updated_at = now()
    WHERE invoice_id = (NEW).id
      AND status = 'awaiting_payment';
  END IF;
  RETURN NEW;
END;
$$;

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 27
DROP TRIGGER IF EXISTS trg_snap_paid_sync ON public.invoices;

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 28
CREATE TRIGGER trg_snap_paid_sync
  AFTER INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.snap_orders_sync_paid();

-- SOURCE: 20260721123502_729740f3-a268-4344-91d7-1ec5e2002965.sql statement 1
CREATE OR REPLACE FUNCTION public.get_visit_audit_trail(_visit_id uuid)
RETURNS TABLE (
  id uuid,
  action text,
  resource_type text,
  resource_id text,
  details jsonb,
  status text,
  user_id uuid,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(),
       ARRAY['claims_manager','accountant','billing','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT a.id, a.action, a.resource_type, a.resource_id, a.details, a.status, a.user_id, a.created_at
  FROM public.audit_logs a
  WHERE (a.resource_type = 'visit' AND a.resource_id = _visit_id::text)
     OR (a.resource_type IN ('invoice','prescription')
         AND a.resource_id IN (
           SELECT i.id::text FROM public.invoices i WHERE i.visit_id = _visit_id
           UNION
           SELECT p.id::text FROM public.prescriptions p WHERE p.visit_id = _visit_id
         ))
  ORDER BY a.created_at ASC;
END;
$$;

-- SOURCE: 20260721123502_729740f3-a268-4344-91d7-1ec5e2002965.sql statement 2
GRANT EXECUTE ON FUNCTION public.get_visit_audit_trail(uuid) TO authenticated;

-- SOURCE: 20260721130022_07e39dec-ed92-44df-b456-fc18e90c8848.sql statement 1
REVOKE EXECUTE ON FUNCTION public.autofill_visit_id() FROM PUBLIC, anon;

-- SOURCE: 20260721130022_07e39dec-ed92-44df-b456-fc18e90c8848.sql statement 2
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

-- SOURCE: 20260721130022_07e39dec-ed92-44df-b456-fc18e90c8848.sql statement 3
REVOKE EXECUTE ON FUNCTION public.snap_orders_sync_paid() FROM PUBLIC, anon;

-- SOURCE: 20260721130022_07e39dec-ed92-44df-b456-fc18e90c8848.sql statement 4
REVOKE EXECUTE ON FUNCTION public.next_visit_number() FROM PUBLIC, anon;

-- SOURCE: 20260721130022_07e39dec-ed92-44df-b456-fc18e90c8848.sql statement 5
REVOKE EXECUTE ON FUNCTION public.recalc_visit_totals(uuid) FROM PUBLIC, anon;

-- SOURCE: 20260721130022_07e39dec-ed92-44df-b456-fc18e90c8848.sql statement 6
REVOKE EXECUTE ON FUNCTION public.close_visit(uuid) FROM PUBLIC, anon;

-- SOURCE: 20260721130022_07e39dec-ed92-44df-b456-fc18e90c8848.sql statement 7
GRANT EXECUTE ON FUNCTION public.close_visit(uuid) TO authenticated;

-- SOURCE: 20260721130022_07e39dec-ed92-44df-b456-fc18e90c8848.sql statement 8
REVOKE EXECUTE ON FUNCTION public.get_visit_audit_trail(uuid) FROM PUBLIC, anon;

-- SOURCE: 20260721130022_07e39dec-ed92-44df-b456-fc18e90c8848.sql statement 9
GRANT EXECUTE ON FUNCTION public.get_visit_audit_trail(uuid) TO authenticated;

-- SOURCE: 20260721130022_07e39dec-ed92-44df-b456-fc18e90c8848.sql statement 10
REVOKE EXECUTE ON FUNCTION public.open_visit_for_patient(uuid, text, boolean, text) FROM PUBLIC, anon;

-- SOURCE: 20260721130022_07e39dec-ed92-44df-b456-fc18e90c8848.sql statement 11
GRANT EXECUTE ON FUNCTION public.open_visit_for_patient(uuid, text, boolean, text) TO authenticated;

-- SOURCE: 20260721130157_785610bf-4fa0-4eff-9b04-7c3862d0cd87.sql statement 1
DROP POLICY IF EXISTS "Staff can view family members" ON public.staff_family_members;

-- SOURCE: 20260721130157_785610bf-4fa0-4eff-9b04-7c3862d0cd87.sql statement 2
CREATE POLICY "Staff view own family, admins view all"
  ON public.staff_family_members FOR SELECT
  TO authenticated
  USING (
    has_any_role(public.hms_current_user_id(), ARRAY['accountant'::app_role, 'admin'::app_role])
    OR staff_id = public.hms_current_staff_id()
  );

-- SOURCE: 20260721130157_785610bf-4fa0-4eff-9b04-7c3862d0cd87.sql statement 3
DROP POLICY IF EXISTS "Staff can read own leave" ON public.staff_leave;

-- SOURCE: 20260721130157_785610bf-4fa0-4eff-9b04-7c3862d0cd87.sql statement 4
CREATE POLICY "Staff read own leave, admins read all"
  ON public.staff_leave FOR SELECT
  TO authenticated
  USING (
    has_any_role(public.hms_current_user_id(), ARRAY['accountant'::app_role, 'admin'::app_role, 'billing'::app_role])
    OR staff_id = public.hms_current_staff_id()
  );

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 1
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

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 2
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wards TO authenticated;

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 3
GRANT ALL ON public.wards TO service_role;

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 4
ALTER TABLE public.wards ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 5
CREATE POLICY "Staff can view wards" ON public.wards
  FOR SELECT TO authenticated USING (public.is_authenticated_staff());

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 6
CREATE POLICY "Admin manages wards" ON public.wards
  FOR ALL TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['admin','accountant']::app_role[]))
  WITH CHECK (public.has_any_role(public.hms_current_user_id(), ARRAY['admin','accountant']::app_role[]));

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 7
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

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 8
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rooms TO authenticated;

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 9
GRANT ALL ON public.rooms TO service_role;

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 10
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 11
CREATE POLICY "Staff can view rooms" ON public.rooms
  FOR SELECT TO authenticated USING (public.is_authenticated_staff());

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 12
CREATE POLICY "Admin manages rooms" ON public.rooms
  FOR ALL TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['admin','accountant']::app_role[]))
  WITH CHECK (public.has_any_role(public.hms_current_user_id(), ARRAY['admin','accountant']::app_role[]));

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 13
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

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 14
GRANT SELECT, INSERT, UPDATE, DELETE ON public.beds TO authenticated;

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 15
GRANT ALL ON public.beds TO service_role;

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 16
ALTER TABLE public.beds ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 17
CREATE POLICY "Staff can view beds" ON public.beds
  FOR SELECT TO authenticated USING (public.is_authenticated_staff());

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 18
CREATE POLICY "Admin & nurses manage bed status" ON public.beds
  FOR ALL TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['admin','accountant','nurse']::app_role[]))
  WITH CHECK (public.has_any_role(public.hms_current_user_id(), ARRAY['admin','accountant','nurse']::app_role[]));

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 19
CREATE TABLE public.admissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL,
  bed_id UUID REFERENCES public.beds(id) ON DELETE SET NULL,
  admitting_doctor UUID REFERENCES public.auth_users(id),
  assigned_by_nurse UUID REFERENCES public.auth_users(id),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'waiting_assignment'
    CHECK (status IN ('waiting_assignment','active','discharged','cancelled')),
  admitted_at TIMESTAMPTZ,
  discharged_at TIMESTAMPTZ,
  discharge_notes TEXT,
  discharged_by UUID REFERENCES public.auth_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE: cockroach_compatibility statement admissions
ALTER TABLE public.admissions ADD COLUMN IF NOT EXISTS visit_id uuid;

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 20
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admissions TO authenticated;

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 21
GRANT ALL ON public.admissions TO service_role;

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 22
ALTER TABLE public.admissions ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 23
CREATE POLICY "Clinical & billing staff read admissions" ON public.admissions
  FOR SELECT TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(),
    ARRAY['doctor','doctor1','doctor2','nurse','billing','accountant','admin','claims_manager','receptionist']::app_role[]));

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 24
CREATE POLICY "Doctors create admissions" ON public.admissions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(public.hms_current_user_id(),
    ARRAY['doctor','doctor1','doctor2','admin']::app_role[]));

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 25
CREATE POLICY "Nurses & admin update admissions" ON public.admissions
  FOR UPDATE TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(),
    ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','admin']::app_role[]))
  WITH CHECK (public.has_any_role(public.hms_current_user_id(),
    ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','admin']::app_role[]));

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 26
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER  AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 27
CREATE TRIGGER wards_touch BEFORE UPDATE ON public.wards
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 28
CREATE TRIGGER rooms_touch BEFORE UPDATE ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 29
CREATE TRIGGER beds_touch BEFORE UPDATE ON public.beds
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 30
CREATE TRIGGER admissions_touch BEFORE UPDATE ON public.admissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 31
CREATE OR REPLACE FUNCTION public.sync_bed_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER  AS $$
BEGIN
  -- Free old bed if changed or discharged
  IF TG_OP = 'UPDATE' THEN
    IF (OLD).bed_id IS NOT NULL
       AND ((OLD).bed_id IS DISTINCT FROM (NEW).bed_id OR (NEW).status IN ('discharged','cancelled')) THEN
      UPDATE public.beds SET status='available', updated_at=now() WHERE id = (OLD).bed_id;
    END IF;
  END IF;
  -- Occupy new bed if active
  IF (NEW).bed_id IS NOT NULL AND (NEW).status = 'active' THEN
    UPDATE public.beds SET status='occupied', updated_at=now() WHERE id = (NEW).bed_id;
  END IF;
  RETURN NEW;
END; $$;

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 32
CREATE TRIGGER admissions_sync_bed
AFTER INSERT OR UPDATE ON public.admissions
FOR EACH ROW EXECUTE FUNCTION public.sync_bed_status();

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 33
ALTER TABLE public.snap_orders
  ADD COLUMN IF NOT EXISTS original_sender_role TEXT,
  ADD COLUMN IF NOT EXISTS parent_snap_id UUID REFERENCES public.snap_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS returned_to UUID REFERENCES public.auth_users(id),
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ack_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ack_by UUID REFERENCES public.auth_users(id);

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 34
ALTER TABLE public.snap_orders DROP CONSTRAINT IF EXISTS snap_orders_order_type_check;
ALTER TABLE public.snap_orders DROP CONSTRAINT IF EXISTS snap_orders_target_station_check;
ALTER TABLE public.snap_orders DROP CONSTRAINT IF EXISTS snap_orders_status_check;

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 35
ALTER TABLE public.snap_orders
  ADD CONSTRAINT snap_orders_order_type_check
    CHECK (order_type IN ('prescription','lab','treatment','lab_result')),
  ADD CONSTRAINT snap_orders_target_station_check
    CHECK (target_station IN ('pharmacy','lab','doctor','nurse','billing')),
  ADD CONSTRAINT snap_orders_status_check
    CHECK (status IN ('pending_billing','awaiting_payment','paid','fulfilled','rejected','cancelled','returned','acknowledged'));

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 36
CREATE INDEX IF NOT EXISTS snap_orders_returned_idx
  ON public.snap_orders(returned_to, status) WHERE order_type = 'lab_result';

-- SOURCE: 20260721141413_9d5f818d-0cc3-41b1-90de-7f88920f5ee4.sql statement 1
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
