-- SOURCE: 20260721141413_9d5f818d-0cc3-41b1-90de-7f88920f5ee4.sql statement 2
SELECT 1;

-- SOURCE: 20260721144302_74e7be2d-3222-4d57-932f-fa039bcb1744.sql statement 1
UPDATE public.notifications SET target_role = NULL WHERE target_role = 'all';

-- SOURCE: 20260721144302_74e7be2d-3222-4d57-932f-fa039bcb1744.sql statement 2
DROP POLICY IF EXISTS "Users can read own or targeted notifications" ON public.notifications;

-- SOURCE: 20260721144302_74e7be2d-3222-4d57-932f-fa039bcb1744.sql statement 3
CREATE POLICY "Users can read own or targeted notifications"
ON public.notifications FOR SELECT
TO authenticated
USING (
  user_id = public.hms_current_user_id()
  OR (user_id IS NULL AND target_role IS NULL)
  OR (user_id IS NULL AND target_role IS NOT NULL AND has_role(public.hms_current_user_id(), target_role::app_role))
);

-- SOURCE: 20260721144302_74e7be2d-3222-4d57-932f-fa039bcb1744.sql statement 4
DROP POLICY IF EXISTS "Users can update own or targeted notifications" ON public.notifications;

-- SOURCE: 20260721144302_74e7be2d-3222-4d57-932f-fa039bcb1744.sql statement 5
CREATE POLICY "Users can update own or targeted notifications"
ON public.notifications FOR UPDATE
TO authenticated
USING (
  user_id = public.hms_current_user_id()
  OR (user_id IS NULL AND target_role IS NULL)
  OR (user_id IS NULL AND target_role IS NOT NULL AND has_role(public.hms_current_user_id(), target_role::app_role))
);

-- SOURCE: 20260721144745_48caadb1-e16a-45d5-bdfb-17b5bd5be27e.sql statement 1
UPDATE public.patients
   SET corporate_id = NULL
 WHERE corporate_id IS NOT NULL
   AND corporate_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- SOURCE: 20260721152317_3c33f06b-af5b-4525-b0dd-7c003190ca22.sql statement 1
CREATE OR REPLACE FUNCTION public.adjust_patient_balance(_patient_id uuid, _delta numeric, _transaction_type text, _payment_method text DEFAULT NULL::text, _related_request_id uuid DEFAULT NULL::uuid, _related_invoice_id uuid DEFAULT NULL::uuid, _notes text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 
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
    (_patient_id, _transaction_type, _delta, _before, _after, _payment_method, _related_request_id, _related_invoice_id, public.hms_current_user_id(), _notes);
  RETURN _after;
END;
$function$;

-- SOURCE: 20260721153822_af0e5b21-6328-4aae-9dd1-e091a237ae61.sql statement 1
ALTER TABLE public.balance_transactions DROP CONSTRAINT IF EXISTS balance_transactions_transaction_type_check;

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
LANGUAGE plpgsql SECURITY DEFINER  AS $$
DECLARE
  _uid UUID := public.hms_current_user_id();
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

  SELECT public.write_audit_log(CASE WHEN _debt > 0 THEN 'admitted_snap_debt' ELSE 'admitted_snap_created' END, 'snap_order', _snap_id::text, jsonb_build_object(
      'patient_id', _patient_id, 'total', _total, 'debt', _debt,
      'balance_after', _new_bal, 'reason', _debt_reason,
      'target_station', _target_station, 'order_type', _order_type
    )
  , 'success');

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

AS $$
DECLARE
  _adm public.admissions;
  _bal numeric;
  _debt numeric;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(),
       ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to discharge';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF (_adm).status <> 'active' THEN RAISE EXCEPTION 'Admission is not active (%)', (_adm).status; END IF;

  SELECT balance INTO _bal FROM public.patients WHERE id = (_adm).patient_id FOR UPDATE;
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
      SELECT public.adjust_patient_balance((_adm).patient_id, _settlement_amount, 'debt_cleared', _settlement_method, NULL, NULL, COALESCE(_settlement_notes)
      );
    ELSIF _settlement_method = 'waive' THEN
      IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]) THEN
        RAISE EXCEPTION 'Only accountant/admin can waive debt';
      END IF;
      SELECT public.adjust_patient_balance((_adm).patient_id, _debt, 'debt_cleared', 'waive', NULL, NULL, COALESCE(_settlement_notes)
      );
    ELSIF _settlement_method = 'carry' THEN
      -- Debt stays on patient balance; log only
      SELECT public.write_audit_log('debt_carried_on_discharge', 'admission', _admission_id::text, jsonb_build_object('patient_id', (_adm).patient_id, 'debt', _debt, 'notes', _settlement_notes)
      , 'success');
    ELSE
      RAISE EXCEPTION 'Unknown settlement method: %', _settlement_method;
    END IF;
  END IF;

  UPDATE public.admissions
    SET status = 'discharged',
        discharged_at = now(),
        discharged_by = public.hms_current_user_id(),
        discharge_notes = _notes,
        updated_at = now()
    WHERE id = _admission_id;

  SELECT public.write_audit_log('patient_discharged', 'admission', _admission_id::text, jsonb_build_object(
      'patient_id', (_adm).patient_id,
      'bed_id', (_adm).bed_id,
      'debt_at_discharge', _debt,
      'settlement_method', _settlement_method,
      'settlement_amount', _settlement_amount
    )
  , 'success');
END;
$$;

-- SOURCE: 20260722123425_8ad87bf1-0b64-4709-b1c0-469452ad5b0f.sql statement 2
REVOKE EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) FROM public, anon;

-- SOURCE: 20260722123425_8ad87bf1-0b64-4709-b1c0-469452ad5b0f.sql statement 3
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) TO authenticated;

-- SOURCE: 20260722145620_a5f6b050-69e9-4627-8c4f-0fe2a77da966.sql statement 1
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS occupation TEXT;

-- SOURCE: 20260722145620_a5f6b050-69e9-4627-8c4f-0fe2a77da966.sql statement 2
ALTER TABLE public.patients
  ALTER COLUMN last_name DROP NOT NULL,
  ALTER COLUMN emergency_contact DROP NOT NULL;

-- SOURCE: 20260722161443_6cbd436f-4745-4e96-9540-6aeef8950bc0.sql statement 1
ALTER TYPE public.app_role ADD VALUE 'anc';

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 1
CREATE TABLE public.anc_programs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  anc_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','archived')),
  registration_date DATE NOT NULL DEFAULT CURRENT_DATE,
  lmp DATE, edd DATE,
  gravida INTEGER, para INTEGER,
  height NUMERIC, weight NUMERIC,
  religion TEXT, tribe TEXT,
  occupation TEXT, husband_occupation TEXT,
  previous_pregnancies JSONB DEFAULT '[]'::jsonb,
  remarks TEXT, pelvic_assessment TEXT, special_considerations TEXT,
  high_risk BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES public.auth_users(id),
  closed_at TIMESTAMPTZ,
  delivery_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 2
CREATE INDEX IF NOT EXISTS idx_anc_programs_patient ON public.anc_programs(patient_id);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 3
CREATE INDEX IF NOT EXISTS idx_anc_programs_status ON public.anc_programs(status);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 4
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_anc_per_patient ON public.anc_programs(patient_id) WHERE status='active';

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 5
GRANT SELECT, INSERT, UPDATE, DELETE ON public.anc_programs TO authenticated;

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 6
GRANT ALL ON public.anc_programs TO service_role;

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 7
ALTER TABLE public.anc_programs ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 8
CREATE POLICY "anc_programs_view" ON public.anc_programs FOR SELECT TO authenticated USING (
  public.has_role(public.hms_current_user_id(),'anc') OR public.has_role(public.hms_current_user_id(),'nurse') OR
  public.has_role(public.hms_current_user_id(),'doctor') OR public.has_role(public.hms_current_user_id(),'doctor1') OR public.has_role(public.hms_current_user_id(),'doctor2') OR
  public.has_role(public.hms_current_user_id(),'lab_tech') OR public.has_role(public.hms_current_user_id(),'pharmacist') OR
  public.has_role(public.hms_current_user_id(),'receptionist') OR public.has_role(public.hms_current_user_id(),'billing') OR
  public.has_role(public.hms_current_user_id(),'admin')
);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 9
CREATE POLICY "anc_programs_insert" ON public.anc_programs FOR INSERT TO authenticated WITH CHECK (
  public.has_role(public.hms_current_user_id(),'anc') OR public.has_role(public.hms_current_user_id(),'nurse') OR public.has_role(public.hms_current_user_id(),'admin')
);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 10
CREATE POLICY "anc_programs_update" ON public.anc_programs FOR UPDATE TO authenticated USING (
  public.has_role(public.hms_current_user_id(),'anc') OR public.has_role(public.hms_current_user_id(),'nurse') OR
  public.has_role(public.hms_current_user_id(),'doctor1') OR public.has_role(public.hms_current_user_id(),'doctor2') OR public.has_role(public.hms_current_user_id(),'admin')
);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 11
CREATE POLICY "anc_programs_delete" ON public.anc_programs FOR DELETE TO authenticated USING (public.has_role(public.hms_current_user_id(),'admin'));

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 12
CREATE OR REPLACE FUNCTION public.anc_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql  AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 13
CREATE TRIGGER trg_anc_programs_updated BEFORE UPDATE ON public.anc_programs
FOR EACH ROW EXECUTE FUNCTION public.anc_touch_updated_at();

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 14
CREATE TABLE public.anc_visits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  anc_program_id UUID NOT NULL REFERENCES public.anc_programs(id) ON DELETE CASCADE,
  visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  week_of_pregnancy INTEGER,
  weight NUMERIC, blood_pressure TEXT, urine TEXT, hb TEXT, oedema TEXT,
  fundal_height TEXT, presentation TEXT, fetal_heart_rate TEXT,
  comment TEXT, next_visit DATE,
  staff_id UUID REFERENCES public.auth_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 15
CREATE INDEX IF NOT EXISTS idx_anc_visits_program ON public.anc_visits(anc_program_id);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 16
CREATE INDEX IF NOT EXISTS idx_anc_visits_date ON public.anc_visits(visit_date);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 17
GRANT SELECT, INSERT, UPDATE, DELETE ON public.anc_visits TO authenticated;

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 18
GRANT ALL ON public.anc_visits TO service_role;

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 19
ALTER TABLE public.anc_visits ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 20
CREATE POLICY "anc_visits_view" ON public.anc_visits FOR SELECT TO authenticated USING (
  public.has_role(public.hms_current_user_id(),'anc') OR public.has_role(public.hms_current_user_id(),'nurse') OR
  public.has_role(public.hms_current_user_id(),'doctor') OR public.has_role(public.hms_current_user_id(),'doctor1') OR public.has_role(public.hms_current_user_id(),'doctor2') OR
  public.has_role(public.hms_current_user_id(),'lab_tech') OR public.has_role(public.hms_current_user_id(),'pharmacist') OR
  public.has_role(public.hms_current_user_id(),'billing') OR public.has_role(public.hms_current_user_id(),'admin')
);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 21
CREATE POLICY "anc_visits_insert" ON public.anc_visits FOR INSERT TO authenticated WITH CHECK (
  public.has_role(public.hms_current_user_id(),'anc') OR public.has_role(public.hms_current_user_id(),'nurse') OR
  public.has_role(public.hms_current_user_id(),'doctor1') OR public.has_role(public.hms_current_user_id(),'doctor2') OR public.has_role(public.hms_current_user_id(),'admin')
);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 22
CREATE POLICY "anc_visits_update" ON public.anc_visits FOR UPDATE TO authenticated USING (
  public.has_role(public.hms_current_user_id(),'admin') OR public.has_role(public.hms_current_user_id(),'anc')
);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 23
CREATE POLICY "anc_visits_delete" ON public.anc_visits FOR DELETE TO authenticated USING (public.has_role(public.hms_current_user_id(),'admin'));

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 26
CREATE OR REPLACE FUNCTION public.generate_anc_number()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER  AS $$
DECLARE yr TEXT := to_char(CURRENT_DATE,'YYYY'); seq INTEGER;
BEGIN
  SELECT COUNT(*)+1 INTO seq FROM public.anc_programs WHERE anc_number LIKE 'ANC-'||yr||'-%';
  RETURN 'ANC-'||yr||'-'||lpad(seq::text,5,'0');
END; $$;

-- SOURCE: 20260722190607_916ae97b-63d7-45e0-848b-b60ba03f8a47.sql statement 1
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS enrollee_id TEXT;

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 1
ALTER TABLE public.snap_orders
  ADD COLUMN IF NOT EXISTS ocr_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS ocr_text text,
  ADD COLUMN IF NOT EXISTS ocr_confidence numeric,
  ADD COLUMN IF NOT EXISTS ocr_model text,
  ADD COLUMN IF NOT EXISTS ocr_matches jsonb,
  ADD COLUMN IF NOT EXISTS ocr_error text,
  ADD COLUMN IF NOT EXISTS ocr_corrected_text text,
  ADD COLUMN IF NOT EXISTS ocr_corrected_by uuid,
  ADD COLUMN IF NOT EXISTS ocr_corrected_at timestamptz;

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 2
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 3
GRANT SELECT ON public.app_settings TO authenticated;

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 4
GRANT ALL ON public.app_settings TO service_role;

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 5
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 6
DROP POLICY IF EXISTS "read settings" ON public.app_settings;

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 7
CREATE POLICY "read settings" ON public.app_settings
  FOR SELECT TO authenticated USING (true);

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 8
DROP POLICY IF EXISTS "admin writes settings" ON public.app_settings;

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 9
CREATE POLICY "admin writes settings" ON public.app_settings
  FOR ALL TO authenticated
  USING (public.has_role(public.hms_current_user_id(), 'admin'))
  WITH CHECK (public.has_role(public.hms_current_user_id(), 'admin'));
