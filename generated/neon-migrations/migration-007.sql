-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 26
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

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 27
DROP TRIGGER IF EXISTS trg_snap_paid_sync ON public.invoices;

-- SOURCE: 20260721122202_f04bbfd3-3fd2-497b-a9b9-ab7d75411ccb.sql statement 28
CREATE TRIGGER trg_snap_paid_sync
  AFTER INSERT OR UPDATE OF paid_amount, total_amount ON public.invoices
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
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(),
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
REVOKE EXECUTE ON FUNCTION public.invoices_touch_visit_totals() FROM PUBLIC, anon;

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
    has_any_role(auth.uid(), ARRAY['accountant'::app_role, 'admin'::app_role])
    OR staff_id IN (SELECT id FROM public.staff WHERE auth_user_id = auth.uid())
  );

-- SOURCE: 20260721130157_785610bf-4fa0-4eff-9b04-7c3862d0cd87.sql statement 3
DROP POLICY IF EXISTS "Staff can read own leave" ON public.staff_leave;

-- SOURCE: 20260721130157_785610bf-4fa0-4eff-9b04-7c3862d0cd87.sql statement 4
CREATE POLICY "Staff read own leave, admins read all"
  ON public.staff_leave FOR SELECT
  TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['accountant'::app_role, 'admin'::app_role, 'billing'::app_role])
    OR staff_id IN (SELECT id FROM public.staff WHERE auth_user_id = auth.uid())
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
  USING (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]));

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
  USING (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]));

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
  USING (public.has_any_role(auth.uid(), ARRAY['admin','accountant','nurse']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','accountant','nurse']::app_role[]));

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 19
CREATE TABLE public.admissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL,
  bed_id UUID REFERENCES public.beds(id) ON DELETE SET NULL,
  admitting_doctor UUID REFERENCES neon_auth.user(id),
  assigned_by_nurse UUID REFERENCES neon_auth.user(id),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'waiting_assignment'
    CHECK (status IN ('waiting_assignment','active','discharged','cancelled')),
  admitted_at TIMESTAMPTZ,
  discharged_at TIMESTAMPTZ,
  discharge_notes TEXT,
  discharged_by UUID REFERENCES neon_auth.user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 20
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admissions TO authenticated;

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 21
GRANT ALL ON public.admissions TO service_role;

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 22
ALTER TABLE public.admissions ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 23
CREATE POLICY "Clinical & billing staff read admissions" ON public.admissions
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['doctor','doctor1','doctor2','nurse','billing','accountant','admin','claims_manager','receptionist']::app_role[]));

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 24
CREATE POLICY "Doctors create admissions" ON public.admissions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(),
    ARRAY['doctor','doctor1','doctor2','admin']::app_role[]));

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 25
CREATE POLICY "Nurses & admin update admissions" ON public.admissions
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(),
    ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','admin']::app_role[]));

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 26
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 32
CREATE TRIGGER admissions_sync_bed
AFTER INSERT OR UPDATE OF bed_id, status ON public.admissions
FOR EACH ROW EXECUTE FUNCTION public.sync_bed_status();

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 33
ALTER TABLE public.snap_orders
  ADD COLUMN IF NOT EXISTS original_sender_role TEXT,
  ADD COLUMN IF NOT EXISTS parent_snap_id UUID REFERENCES public.snap_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS returned_to UUID REFERENCES neon_auth.user(id),
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ack_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ack_by UUID REFERENCES neon_auth.user(id);

-- SOURCE: 20260721141353_d382902f-7b78-4b84-a70d-f216456bcfdb.sql statement 34
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

-- SOURCE: 20260721141413_9d5f818d-0cc3-41b1-90de-7f88920f5ee4.sql statement 2
REVOKE EXECUTE ON FUNCTION public.sync_bed_status() FROM PUBLIC, anon, authenticated;

-- SOURCE: 20260721144302_74e7be2d-3222-4d57-932f-fa039bcb1744.sql statement 1
UPDATE public.notifications SET target_role = NULL WHERE target_role = 'all';

-- SOURCE: 20260721144302_74e7be2d-3222-4d57-932f-fa039bcb1744.sql statement 2
DROP POLICY IF EXISTS "Users can read own or targeted notifications" ON public.notifications;

-- SOURCE: 20260721144302_74e7be2d-3222-4d57-932f-fa039bcb1744.sql statement 3
CREATE POLICY "Users can read own or targeted notifications"
ON public.notifications FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR (user_id IS NULL AND target_role IS NULL)
  OR (user_id IS NULL AND target_role IS NOT NULL AND has_role(auth.uid(), target_role::app_role))
);

-- SOURCE: 20260721144302_74e7be2d-3222-4d57-932f-fa039bcb1744.sql statement 4
DROP POLICY IF EXISTS "Users can update own or targeted notifications" ON public.notifications;

-- SOURCE: 20260721144302_74e7be2d-3222-4d57-932f-fa039bcb1744.sql statement 5
CREATE POLICY "Users can update own or targeted notifications"
ON public.notifications FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  OR (user_id IS NULL AND target_role IS NULL)
  OR (user_id IS NULL AND target_role IS NOT NULL AND has_role(auth.uid(), target_role::app_role))
);

-- SOURCE: 20260721144745_48caadb1-e16a-45d5-bdfb-17b5bd5be27e.sql statement 1
UPDATE public.patients
   SET corporate_id = NULL
 WHERE corporate_id IS NOT NULL
   AND corporate_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- SOURCE: 20260721144745_48caadb1-e16a-45d5-bdfb-17b5bd5be27e.sql statement 2
ALTER TABLE public.patients
  ALTER COLUMN corporate_id TYPE uuid USING corporate_id::uuid;

-- SOURCE: 20260721144745_48caadb1-e16a-45d5-bdfb-17b5bd5be27e.sql statement 3
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patients_corporate_id_fkey'
  ) THEN
    ALTER TABLE public.patients
      ADD CONSTRAINT patients_corporate_id_fkey
      FOREIGN KEY (corporate_id) REFERENCES public.corporate_accounts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- SOURCE: 20260721152317_3c33f06b-af5b-4525-b0dd-7c003190ca22.sql statement 1
CREATE OR REPLACE FUNCTION public.adjust_patient_balance(_patient_id uuid, _delta numeric, _transaction_type text, _payment_method text DEFAULT NULL::text, _related_request_id uuid DEFAULT NULL::uuid, _related_invoice_id uuid DEFAULT NULL::uuid, _notes text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _before NUMERIC;
  _after NUMERIC;
BEGIN
  SELECT balance INTO _before FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _before IS NULL THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;
  _after := _before + _delta;
  -- Only 'debt_incurred' transactions may push balance negative (short payments)
  IF _after < 0 AND _transaction_type <> 'debt_incurred' THEN
    RAISE EXCEPTION 'Insufficient balance (current: %, requested delta: %)', _before, _delta;
  END IF;
  UPDATE public.patients SET balance = _after, updated_at = now() WHERE id = _patient_id;
  INSERT INTO public.balance_transactions
    (patient_id, transaction_type, amount, balance_before, balance_after, payment_method, related_request_id, related_invoice_id, performed_by, notes)
  VALUES
    (_patient_id, _transaction_type, _delta, _before, _after, _payment_method, _related_request_id, _related_invoice_id, auth.uid(), _notes);
  RETURN _after;
END;
$function$;

-- SOURCE: 20260721153822_af0e5b21-6328-4aae-9dd1-e091a237ae61.sql statement 1
ALTER TABLE public.balance_transactions DROP CONSTRAINT balance_transactions_transaction_type_check;

-- SOURCE: 20260721153822_af0e5b21-6328-4aae-9dd1-e091a237ae61.sql statement 2
ALTER TABLE public.balance_transactions ADD CONSTRAINT balance_transactions_transaction_type_check CHECK (transaction_type = ANY (ARRAY['topup'::text, 'refund'::text, 'invoice_deduction'::text, 'staff_family_coverage'::text, 'staff_coverage'::text, 'adjustment'::text, 'debt_incurred'::text, 'debt_cleared'::text]));

-- SOURCE: 20260722123051_c364e708-035b-406b-b4e5-91bdfba1fe31.sql statement 1
ALTER TABLE public.patients DROP CONSTRAINT IF EXISTS check_balance_non_negative;

-- SOURCE: 20260722123051_c364e708-035b-406b-b4e5-91bdfba1fe31.sql statement 2
ALTER TABLE public.wards ADD COLUMN IF NOT EXISTS min_admission_deposit NUMERIC(12,2) NOT NULL DEFAULT 0;

-- SOURCE: 20260722123051_c364e708-035b-406b-b4e5-91bdfba1fe31.sql statement 3
ALTER TABLE public.snap_orders
  ADD COLUMN IF NOT EXISTS is_admitted_snap BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS debt_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS debt_reason TEXT;

-- SOURCE: 20260722123051_c364e708-035b-406b-b4e5-91bdfba1fe31.sql statement 4
ALTER TABLE public.snap_orders DROP CONSTRAINT IF EXISTS snap_orders_status_check;

-- SOURCE: 20260722123051_c364e708-035b-406b-b4e5-91bdfba1fe31.sql statement 5
ALTER TABLE public.snap_orders ADD CONSTRAINT snap_orders_status_check
  CHECK (status = ANY (ARRAY[
    'pending_billing','awaiting_payment','paid','fulfilled','rejected','cancelled',
    'returned','acknowledged','held_no_balance'
  ]));

-- SOURCE: 20260722123051_c364e708-035b-406b-b4e5-91bdfba1fe31.sql statement 6
ALTER TABLE public.balance_transactions DROP CONSTRAINT IF EXISTS balance_transactions_transaction_type_check;

-- SOURCE: 20260722123051_c364e708-035b-406b-b4e5-91bdfba1fe31.sql statement 7
ALTER TABLE public.balance_transactions ADD CONSTRAINT balance_transactions_transaction_type_check
  CHECK (transaction_type = ANY (ARRAY[
    'topup','refund','invoice_deduction','staff_family_coverage','staff_coverage',
    'adjustment','debt_incurred','debt_cleared','admitted_deduction'
  ]));

-- SOURCE: 20260722123051_c364e708-035b-406b-b4e5-91bdfba1fe31.sql statement 8
CREATE OR REPLACE FUNCTION public.create_admitted_snap(
  _patient_id UUID,
  _order_type TEXT,
  _target_station TEXT,
  _photo_path TEXT,
  _note TEXT,
  _items JSONB,
  _total NUMERIC,
  _allow_debt BOOLEAN DEFAULT false,
  _debt_reason TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _visit UUID;
  _admission UUID;
  _bal NUMERIC;
  _snap_id UUID;
  _new_bal NUMERIC;
  _debt NUMERIC := 0;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT id INTO _admission FROM public.admissions
   WHERE patient_id = _patient_id AND status = 'active' LIMIT 1;
  IF _admission IS NULL THEN
    RAISE EXCEPTION 'Patient is not currently admitted';
  END IF;

  SELECT id INTO _visit FROM public.visits
   WHERE patient_id = _patient_id AND status = 'open'
   ORDER BY opened_at DESC LIMIT 1;

  SELECT balance INTO _bal FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _bal IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  IF _bal < _total THEN
    IF NOT _allow_debt THEN
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE: balance % < required %', _bal, _total;
    END IF;
    IF _debt_reason IS NULL OR length(trim(_debt_reason)) < 3 THEN
      RAISE EXCEPTION 'Debt override requires a reason';
    END IF;
    _debt := _total - _bal;
  END IF;

  -- Deduct (allowed to go negative when overriding)
  _new_bal := _bal - _total;
  UPDATE public.patients SET balance = _new_bal, updated_at = now() WHERE id = _patient_id;
  INSERT INTO public.balance_transactions
    (patient_id, transaction_type, amount, balance_before, balance_after, performed_by, notes)
  VALUES
    (_patient_id, CASE WHEN _debt > 0 THEN 'debt_incurred' ELSE 'admitted_deduction' END,
     -_total, _bal, _new_bal, _uid,
     CASE WHEN _debt > 0
          THEN 'Admitted in-ward ' || _order_type || ' (debt ₦' || _debt || '): ' || COALESCE(_debt_reason,'')
          ELSE 'Admitted in-ward ' || _order_type END);

  INSERT INTO public.snap_orders (
    patient_id, visit_id, order_type, target_station, source_role,
    photo_path, note, matched_items, status, created_by,
    is_admitted_snap, debt_amount, debt_reason,
    billed_by, billed_at, paid_at, original_sender_role
  ) VALUES (
    _patient_id, _visit, _order_type, _target_station,
    (SELECT role::text FROM public.user_roles WHERE user_id = _uid LIMIT 1),
    _photo_path, _note, COALESCE(_items, '[]'::jsonb),
    'paid', _uid, true, _debt, _debt_reason,
    _uid, now(), now(),
    (SELECT role::text FROM public.user_roles WHERE user_id = _uid LIMIT 1)
  ) RETURNING id INTO _snap_id;

  PERFORM public.write_audit_log(
    CASE WHEN _debt > 0 THEN 'admitted_snap_debt' ELSE 'admitted_snap_created' END,
    'snap_order', _snap_id::text,
    jsonb_build_object(
      'patient_id', _patient_id, 'total', _total, 'debt', _debt,
      'balance_after', _new_bal, 'reason', _debt_reason,
      'target_station', _target_station, 'order_type', _order_type
    )
  );

  RETURN _snap_id;
END; $$;

-- SOURCE: 20260722123051_c364e708-035b-406b-b4e5-91bdfba1fe31.sql statement 9
REVOKE ALL ON FUNCTION public.create_admitted_snap(UUID,TEXT,TEXT,TEXT,TEXT,JSONB,NUMERIC,BOOLEAN,TEXT) FROM public, anon;

-- SOURCE: 20260722123051_c364e708-035b-406b-b4e5-91bdfba1fe31.sql statement 10
GRANT EXECUTE ON FUNCTION public.create_admitted_snap(UUID,TEXT,TEXT,TEXT,TEXT,JSONB,NUMERIC,BOOLEAN,TEXT) TO authenticated;

-- SOURCE: 20260722123425_8ad87bf1-0b64-4709-b1c0-469452ad5b0f.sql statement 1
CREATE OR REPLACE FUNCTION public.discharge_admission(
  _admission_id uuid,
  _notes text DEFAULT NULL,
  _settlement_method text DEFAULT NULL,  -- 'cash','pos','transfer','waive','carry' or NULL when balance>=0
  _settlement_amount numeric DEFAULT 0,
  _settlement_notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _adm RECORD;
  _bal numeric;
  _debt numeric;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
       ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to discharge';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF _adm.status <> 'active' THEN RAISE EXCEPTION 'Admission is not active (%)', _adm.status; END IF;

  SELECT balance INTO _bal FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
  _debt := GREATEST(0, -COALESCE(_bal,0));

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % — pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash','pos','transfer') THEN
      IF COALESCE(_settlement_amount,0) < _debt THEN
        RAISE EXCEPTION 'Settlement amount % is less than debt %', _settlement_amount, _debt;
      END IF;
      -- Credit the patient balance to clear debt (and keep any excess)
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, _settlement_amount, 'debt_cleared', _settlement_method,
        NULL, NULL,
        COALESCE(_settlement_notes, 'Discharge settlement')
      );
    ELSIF _settlement_method = 'waive' THEN
      IF NOT public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]) THEN
        RAISE EXCEPTION 'Only accountant/admin can waive debt';
      END IF;
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, _debt, 'debt_cleared', 'waive',
        NULL, NULL,
        COALESCE(_settlement_notes, 'Discharge — debt waived')
      );
    ELSIF _settlement_method = 'carry' THEN
      -- Debt stays on patient balance; log only
      PERFORM public.write_audit_log(
        'debt_carried_on_discharge', 'admission', _admission_id::text,
        jsonb_build_object('patient_id', _adm.patient_id, 'debt', _debt, 'notes', _settlement_notes)
      );
    ELSE
      RAISE EXCEPTION 'Unknown settlement method: %', _settlement_method;
    END IF;
  END IF;

  UPDATE public.admissions
    SET status = 'discharged',
        discharged_at = now(),
        discharged_by = auth.uid(),
        discharge_notes = _notes,
        updated_at = now()
    WHERE id = _admission_id;

  PERFORM public.write_audit_log(
    'patient_discharged', 'admission', _admission_id::text,
    jsonb_build_object(
      'patient_id', _adm.patient_id,
      'bed_id', _adm.bed_id,
      'debt_at_discharge', _debt,
      'settlement_method', _settlement_method,
      'settlement_amount', _settlement_amount
    )
  );
END;
$$;
