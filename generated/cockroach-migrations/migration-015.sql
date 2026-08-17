-- SOURCE: 20260729001714_737ee12c-4f53-47c9-9deb-a742d2ee977f.sql statement 3
GRANT EXECUTE ON FUNCTION public.purge_clinical_data(text[]) TO authenticated;

-- SOURCE: 20260730112225_2783a0ff-cca6-4af2-a1f8-45344adf7093.sql statement 1
CREATE OR REPLACE FUNCTION public.copay_percent(_account_type text, _plan text DEFAULT NULL)
RETURNS numeric
LANGUAGE sql
IMMUTABLE

AS $fn$
  SELECT CASE
    WHEN lower(coalesce(_account_type,'')) = 'katchma'
      THEN CASE WHEN lower(coalesce(_plan,'')) LIKE '%basic%' THEN 0 ELSE 10 END
    WHEN lower(coalesce(_account_type,'')) IN ('nhia','nhis') THEN 10
    WHEN lower(coalesce(_account_type,'')) IN ('hmo','corporate','retainer','staff') THEN 0
    WHEN lower(coalesce(_account_type,'')) = 'staff_family' THEN 50
    ELSE 100
  END::numeric
$fn$;

-- SOURCE: 20260730112225_2783a0ff-cca6-4af2-a1f8-45344adf7093.sql statement 2
REVOKE ALL ON FUNCTION public.copay_percent(text, text) FROM public;

-- SOURCE: 20260730112225_2783a0ff-cca6-4af2-a1f8-45344adf7093.sql statement 3
GRANT EXECUTE ON FUNCTION public.copay_percent(text, text) TO authenticated, service_role;

-- SOURCE: 20260730112225_2783a0ff-cca6-4af2-a1f8-45344adf7093.sql statement 4
CREATE OR REPLACE FUNCTION public.admission_bed_charge(_admission_id uuid)
RETURNS TABLE(days integer, daily_rate numeric, amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  _admitted_at timestamptz;
  _discharged_at timestamptz;
  _created_at timestamptz;
  _rate numeric;
  _nights int;
  _amount numeric;
BEGIN
  SELECT a.admitted_at, a.discharged_at, a.created_at, r.daily_rate
    INTO _admitted_at, _discharged_at, _created_at, _rate
  FROM public.admissions a
  LEFT JOIN public.beds b ON b.id = a.bed_id
  LEFT JOIN public.rooms r ON r.id = b.room_id
  WHERE a.id = _admission_id;

  IF _created_at IS NULL THEN
    RETURN QUERY SELECT 0, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  _nights := GREATEST(0, (COALESCE(_discharged_at, now())::date - COALESCE(_admitted_at, _created_at)::date))::int;
  IF _nights = 0 THEN
    RETURN QUERY SELECT 0, 3000::numeric, 3000::numeric;
  ELSE
    _rate := COALESCE(_rate, 0)::numeric;
    _amount := ROUND(_nights::numeric * _rate, 2)::numeric;
    RETURN QUERY SELECT _nights, _rate, _amount;
  END IF;
END;
$function$;

-- SOURCE: 20260730112225_2783a0ff-cca6-4af2-a1f8-45344adf7093.sql statement 5
REVOKE ALL ON FUNCTION public.admission_bed_charge(uuid) FROM public;

-- SOURCE: 20260730112225_2783a0ff-cca6-4af2-a1f8-45344adf7093.sql statement 6
GRANT EXECUTE ON FUNCTION public.admission_bed_charge(uuid) TO authenticated, service_role;

-- SOURCE: 20260730112225_2783a0ff-cca6-4af2-a1f8-45344adf7093.sql statement 7
CREATE OR REPLACE FUNCTION public.bill_admission_bed_days(_admission_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER

AS $fn$
DECLARE
  _adm public.admissions;
  _p public.patients;
  _room_class text;
  _days int;
  _rate numeric;
  _amount numeric;
  _pct numeric;
  _copay numeric;
  _inv uuid;
BEGIN
  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id;
  IF _adm IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _p FROM public.patients WHERE id = (_adm).patient_id;
  IF _p IS NULL THEN RETURN NULL; END IF;

  SELECT d.days, d.daily_rate, d.amount INTO _days, _rate, _amount
  FROM public.admission_bed_charge(_admission_id) d;

  IF COALESCE(_amount, 0) <= 0 THEN RETURN NULL; END IF;

  SELECT id INTO _inv FROM public.invoices
  WHERE patient_id = (_adm).patient_id
    AND notes = 'BED_DAYS:' || _admission_id::text
  LIMIT 1;
  IF _inv IS NOT NULL THEN RETURN _inv; END IF;

  _pct := public.copay_percent((_p).account_type, (_p).insurance_plan);
  _copay := ROUND(_amount * _pct / 100.0, 2);

  SELECT r.room_class INTO _room_class FROM public.beds b JOIN public.rooms r ON r.id = b.room_id
  WHERE b.id = (_adm).bed_id;

  INSERT INTO public.invoices (
    patient_id, visit_id, total_amount, original_amount, discount_amount,
    paid_amount, status, sponsor_type, corporate_account_id, notes
  ) VALUES (
    (_adm).patient_id, (_adm).visit_id, _amount, _amount, 0,
    0, 'pending',
    CASE WHEN _pct < 100 THEN (_p).account_type ELSE NULL END,
    NULLIF(((_p).corporate_id)::STRING, '')::UUID,
    'BED_DAYS:' || _admission_id::text
  ) RETURNING id INTO _inv;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
  VALUES (
    _inv,
    'Bed charge - ' || COALESCE(_room_class, 'ward') || ' - ' || _days || ' day(s)',
    _days, _rate, _amount, 'admission'
  );

  IF _copay > 0 THEN
    SELECT public.adjust_patient_balance(
      (_adm).patient_id, -_copay, 'invoice_payment', NULL, NULL, _inv,
      'Bed charge for admission (' || _days || ' day(s))'
    );
    UPDATE public.invoices
      SET paid_amount = _copay,
          status = CASE WHEN _copay >= _amount THEN 'paid' ELSE 'partial' END,
          paid_at = CASE WHEN _copay >= _amount THEN now() ELSE NULL END
      WHERE id = _inv;
  END IF;

  RETURN _inv;
END;
$fn$;

-- SOURCE: 20260730112225_2783a0ff-cca6-4af2-a1f8-45344adf7093.sql statement 8
REVOKE ALL ON FUNCTION public.bill_admission_bed_days(uuid) FROM public;

-- SOURCE: 20260730112225_2783a0ff-cca6-4af2-a1f8-45344adf7093.sql statement 9
GRANT EXECUTE ON FUNCTION public.bill_admission_bed_days(uuid) TO authenticated, service_role;

-- SOURCE: 20260730112255_f94f280c-720b-404d-a4dd-4661b0e7abc8.sql statement 1
CREATE OR REPLACE FUNCTION public.discharge_admission(_admission_id uuid, _notes text DEFAULT NULL::text, _settlement_method text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0, _settlement_notes text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER

AS $fn$
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
  IF (_adm).status NOT IN ('active','ready_for_discharge') THEN
    RAISE EXCEPTION 'Admission is not active (%)', (_adm).status;
  END IF;

  -- Accrued bed charge is billed here (once per admission)
  SELECT public.bill_admission_bed_days(_admission_id);

  SELECT balance INTO _bal FROM public.patients WHERE id = (_adm).patient_id FOR UPDATE;
  _debt := GREATEST(0, -COALESCE(_bal,0));

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash','pos','transfer') THEN
      IF COALESCE(_settlement_amount,0) < _debt THEN
        RAISE EXCEPTION 'Settlement amount % is less than debt %', _settlement_amount, _debt;
      END IF;
      SELECT public.adjust_patient_balance((_adm).patient_id, _settlement_amount, 'debt_cleared', _settlement_method, NULL, NULL, COALESCE(_settlement_notes)
      );
    ELSIF _settlement_method = 'waive' THEN
      IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]) THEN
        RAISE EXCEPTION 'Only accountant/admin can waive debt';
      END IF;
      SELECT public.adjust_patient_balance((_adm).patient_id, _debt, 'debt_cleared', 'waive', NULL, NULL, COALESCE(_settlement_notes)
      );
    ELSIF _settlement_method = 'carry' THEN
      SELECT public.write_audit_log('debt_carried_on_discharge', 'admission', _admission_id::text, jsonb_build_object('patient_id', (_adm).patient_id, 'debt', _debt, 'notes', _settlement_notes)
      , 'success');
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  UPDATE public.admissions
     SET status = 'discharged',
         discharged_at = now(),
         discharged_by = public.hms_current_user_id(),
         discharge_notes = _notes,
         updated_at = now()
   WHERE id = _admission_id;

  IF (_adm).bed_id IS NOT NULL THEN
    UPDATE public.beds SET status = 'available', updated_at = now() WHERE id = (_adm).bed_id;
  END IF;

  UPDATE public.patients SET status = 'discharged', updated_at = now() WHERE id = (_adm).patient_id;

  SELECT public.write_audit_log('admission_discharged', 'admission', _admission_id::text, jsonb_build_object('patient_id', (_adm).patient_id, 'notes', _notes)
  , 'success');
END;
$fn$;

-- SOURCE: 20260730112255_f94f280c-720b-404d-a4dd-4661b0e7abc8.sql statement 2
REVOKE ALL ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) FROM public;

-- SOURCE: 20260730112255_f94f280c-720b-404d-a4dd-4661b0e7abc8.sql statement 3
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) TO authenticated, service_role;

-- SOURCE: 20260730114830_481f4a7c-1f47-4c94-9a5d-c329dcb60b16.sql statement 1
CREATE OR REPLACE FUNCTION public.assign_admission_bed(_admission_id uuid, _bed_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _uid uuid := public.hms_current_user_id();
  _adm public.admissions;
  _bed public.beds;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only a nurse or admin can assign a ward/room/bed';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF (_adm).status <> 'waiting_assignment' THEN
    RAISE EXCEPTION 'Admission is not waiting for a room (%)', (_adm).status;
  END IF;

  SELECT * INTO _bed FROM public.beds WHERE id = _bed_id FOR UPDATE;
  IF _bed IS NULL OR NOT (_bed).active THEN RAISE EXCEPTION 'Bed not found or inactive'; END IF;
  IF (_bed).status <> 'available' THEN RAISE EXCEPTION 'Bed is not available'; END IF;

  UPDATE public.admissions
     SET bed_id = _bed_id,
         assigned_by_nurse = _uid,
         status = 'active',
         admitted_at = now(),
         updated_at = now()
   WHERE id = _admission_id;

  SELECT public.write_audit_log('admission_bed_assigned', 'admission', _admission_id::text, jsonb_build_object('patient_id', (_adm).patient_id, 'bed_id', _bed_id)
  , 'success');
END $$;

-- SOURCE: 20260730114830_481f4a7c-1f47-4c94-9a5d-c329dcb60b16.sql statement 2
REVOKE ALL ON FUNCTION public.assign_admission_bed(uuid, uuid) FROM PUBLIC, anon;

-- SOURCE: 20260730114830_481f4a7c-1f47-4c94-9a5d-c329dcb60b16.sql statement 3
GRANT EXECUTE ON FUNCTION public.assign_admission_bed(uuid, uuid) TO authenticated;

-- SOURCE: 20260730114830_481f4a7c-1f47-4c94-9a5d-c329dcb60b16.sql statement 4
DROP POLICY IF EXISTS "Nurses & admin update admissions" ON public.admissions;

-- SOURCE: 20260730114830_481f4a7c-1f47-4c94-9a5d-c329dcb60b16.sql statement 5
DROP POLICY IF EXISTS "Doctors create admissions" ON public.admissions;

-- SOURCE: 20260730114830_481f4a7c-1f47-4c94-9a5d-c329dcb60b16.sql statement 6
REVOKE ALL ON FUNCTION public.request_admission(uuid, text, text, text, uuid) FROM PUBLIC, anon;

-- SOURCE: 20260730114830_481f4a7c-1f47-4c94-9a5d-c329dcb60b16.sql statement 7
GRANT EXECUTE ON FUNCTION public.request_admission(uuid, text, text, text, uuid) TO authenticated;

-- SOURCE: 20260730114830_481f4a7c-1f47-4c94-9a5d-c329dcb60b16.sql statement 8
REVOKE ALL ON FUNCTION public.mark_ready_for_discharge(uuid, uuid, text) FROM PUBLIC, anon;

-- SOURCE: 20260730114830_481f4a7c-1f47-4c94-9a5d-c329dcb60b16.sql statement 9
GRANT EXECUTE ON FUNCTION public.mark_ready_for_discharge(uuid, uuid, text) TO authenticated;

-- SOURCE: 20260730114830_481f4a7c-1f47-4c94-9a5d-c329dcb60b16.sql statement 10
REVOKE ALL ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) FROM PUBLIC, anon;

-- SOURCE: 20260730114830_481f4a7c-1f47-4c94-9a5d-c329dcb60b16.sql statement 11
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) TO authenticated;

-- SOURCE: 20260730114830_481f4a7c-1f47-4c94-9a5d-c329dcb60b16.sql statement 12
REVOKE ALL ON FUNCTION public.forward_snap_to_billing(uuid, text, text) FROM PUBLIC, anon;

-- SOURCE: 20260730114830_481f4a7c-1f47-4c94-9a5d-c329dcb60b16.sql statement 13
GRANT EXECUTE ON FUNCTION public.forward_snap_to_billing(uuid, text, text) TO authenticated;

-- SOURCE: 20260730114830_481f4a7c-1f47-4c94-9a5d-c329dcb60b16.sql statement 14
REVOKE ALL ON FUNCTION public.create_admitted_snap(uuid, text, text, text, text, jsonb, numeric, boolean, text) FROM PUBLIC, anon;

-- SOURCE: 20260730114830_481f4a7c-1f47-4c94-9a5d-c329dcb60b16.sql statement 15
GRANT EXECUTE ON FUNCTION public.create_admitted_snap(uuid, text, text, text, text, jsonb, numeric, boolean, text) TO authenticated;

-- SOURCE: 20260730123801_39619395-fa06-4b75-b765-0157e7d7dad2.sql statement 1
SELECT 1;

-- SOURCE: 20260731101727_1c04e970-2ef0-4bf8-bd30-c3f0dcfab420.sql statement 1
CREATE OR REPLACE FUNCTION public.request_admission(_patient_id uuid, _reason text DEFAULT NULL, _photo_path text DEFAULT NULL, _note text DEFAULT NULL, _visit_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _uid uuid := public.hms_current_user_id();
  _adm uuid;
  _visit uuid;
  _snap uuid;
  _role text;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to admit';
  END IF;
  IF _photo_path IS NULL OR length(trim(_photo_path)) = 0 THEN
    RAISE EXCEPTION 'ADMISSION_SNAP_REQUIRED: an admission-order photo is required';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.admissions
     WHERE patient_id = _patient_id
       AND status IN ('waiting_assignment','active','ready_for_discharge')
  ) THEN
    RAISE EXCEPTION 'Patient already has an open admission';
  END IF;

  _visit := _visit_id;
  IF _visit IS NULL THEN
    SELECT id INTO _visit FROM public.visits
     WHERE patient_id = _patient_id AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1;
  END IF;

  INSERT INTO public.admissions (
    patient_id, visit_id, admitting_doctor, reason, status,
    admission_snap_path, admission_note
  ) VALUES (
    _patient_id, _visit, _uid, _reason, 'waiting_assignment',
    _photo_path, _note
  ) RETURNING id INTO _adm;

  SELECT role::text INTO _role FROM public.user_roles WHERE user_id = _uid LIMIT 1;

  INSERT INTO public.snap_orders (
    patient_id, visit_id, order_type, target_station, source_role,
    photo_path, note, status, created_by, original_sender_role, intent
  ) VALUES (
    _patient_id, _visit, 'treatment', 'nurse', COALESCE(_role,'nurse'),
    _photo_path, COALESCE(_note, _reason), 'acknowledged', _uid, COALESCE(_role,'nurse'),
    'admission_order'
  ) RETURNING id INTO _snap;

  -- Move the patient out of the normal station queues into Awaiting Room.
  UPDATE public.patients
     SET status = 'awaiting_room', updated_at = now()
   WHERE id = _patient_id;

  SELECT public.advance_journey(
    _patient_id, 'awaiting_room', 'nurse', NULL, 'nurse', 'Awaiting Room', _visit,
    'Admission requested'
  );

  SELECT public.write_audit_log('admission_requested', 'admission', _adm::text, jsonb_build_object('patient_id', _patient_id, 'snap_id', _snap, 'reason', _reason)
  , 'success');
  RETURN _adm;
END;
$$;

-- SOURCE: 20260731101727_1c04e970-2ef0-4bf8-bd30-c3f0dcfab420.sql statement 2
CREATE OR REPLACE FUNCTION public.assign_admission_bed(_admission_id uuid, _bed_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _uid uuid := public.hms_current_user_id();
  _adm public.admissions;
  _bed public.beds;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only a nurse or admin can assign a ward/room/bed';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF (_adm).status <> 'waiting_assignment' THEN
    RAISE EXCEPTION 'Admission is not waiting for a room (%)', (_adm).status;
  END IF;

  SELECT * INTO _bed FROM public.beds WHERE id = _bed_id FOR UPDATE;
  IF _bed IS NULL OR NOT (_bed).active THEN RAISE EXCEPTION 'Bed not found or inactive'; END IF;
  IF (_bed).status <> 'available' THEN RAISE EXCEPTION 'Bed is not available'; END IF;

  UPDATE public.admissions
     SET bed_id = _bed_id,
         assigned_by_nurse = _uid,
         status = 'active',
         admitted_at = now(),
         updated_at = now()
   WHERE id = _admission_id;

  UPDATE public.patients
     SET status = 'admitted', updated_at = now()
   WHERE id = (_adm).patient_id;

  SELECT public.advance_journey(
    (_adm).patient_id, 'admitted', 'nurse', NULL, 'ward', 'Ward', (_adm).visit_id,
    'Bed assigned'
  );

  SELECT public.write_audit_log('admission_bed_assigned', 'admission', _admission_id::text, jsonb_build_object('patient_id', (_adm).patient_id, 'bed_id', _bed_id)
  , 'success');
END;
$$;

-- SOURCE: 20260731101727_1c04e970-2ef0-4bf8-bd30-c3f0dcfab420.sql statement 3
UPDATE public.patients p
   SET status = 'awaiting_room', updated_at = now()
  FROM public.admissions a
 WHERE a.patient_id = p.id
   AND a.status = 'waiting_assignment'
   AND p.status IN ('waiting','with_nurse','with_doctor');

-- SOURCE: 20260731101727_1c04e970-2ef0-4bf8-bd30-c3f0dcfab420.sql statement 4
UPDATE public.patients p
   SET status = 'admitted', updated_at = now()
  FROM public.admissions a
 WHERE a.patient_id = p.id
   AND a.status IN ('active','ready_for_discharge')
   AND p.status IN ('waiting','with_nurse','with_doctor','awaiting_room');

-- SOURCE: 20260731113842_2e4d8c37-d475-4fa3-831b-fe8246def08b.sql statement 1
CREATE OR REPLACE FUNCTION public.enforce_patient_field_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _uid uuid := public.hms_current_user_id();
  _old jsonb := to_jsonb(OLD);
  _new jsonb := to_jsonb(NEW);
  _identity_cols text[] := ARRAY['first_name','last_name','date_of_birth','gender','phone','address','emergency_contact','occupation','photo_path'];
  _card_cols text[] := ARRAY['card_number','mini_card_number'];
  _sponsor_cols text[] := ARRAY['account_type','corporate_id','insurance_provider','insurance_plan','insurance_policy_number','enrollee_id','member_id_data','staff_link_id'];
  _clinical_cols text[] := ARRAY['blood_group','allergies'];
BEGIN
  IF _uid IS NULL THEN RETURN NEW; END IF;
  IF public.has_role(_uid, 'admin'::app_role) THEN RETURN NEW; END IF;

  IF EXISTS (SELECT 1 FROM jsonb_object_keys(_new) AS changed(key) WHERE (_new -> changed.key) IS DISTINCT FROM (_old -> changed.key) AND changed.key = ANY(_identity_cols)) THEN
    IF NOT public.has_role(_uid, 'receptionist'::app_role) THEN
      RAISE EXCEPTION 'NOT_PERMITTED: only reception or an admin can change patient personal details';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM jsonb_object_keys(_new) AS changed(key) WHERE (_new -> changed.key) IS DISTINCT FROM (_old -> changed.key) AND changed.key = ANY(_card_cols)) THEN
    RAISE EXCEPTION 'NOT_PERMITTED: only an admin can change patient card numbers';
  ELSIF EXISTS (SELECT 1 FROM jsonb_object_keys(_new) AS changed(key) WHERE (_new -> changed.key) IS DISTINCT FROM (_old -> changed.key) AND changed.key = ANY(_sponsor_cols)) THEN
    IF NOT public.has_any_role(_uid, ARRAY['receptionist','billing','accountant','claims_manager']::app_role[]) THEN
      RAISE EXCEPTION 'NOT_PERMITTED: only reception, billing, accounts or claims staff can change sponsor/insurance details';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM jsonb_object_keys(_new) AS changed(key) WHERE (_new -> changed.key) IS DISTINCT FROM (_old -> changed.key) AND changed.key = ANY(_clinical_cols)) THEN
    IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','anc']::app_role[]) THEN
      RAISE EXCEPTION 'NOT_PERMITTED: only clinical staff can change clinical details';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM jsonb_object_keys(_new) AS changed(key) WHERE (_new -> changed.key) IS DISTINCT FROM (_old -> changed.key) AND changed.key = 'balance') THEN
    IF COALESCE(current_setting('app.allow_balance_write', true), '') <> 'on'
       AND NOT public.has_any_role(_uid, ARRAY['billing','cashier','accountant']::app_role[]) THEN
      RAISE EXCEPTION 'NOT_PERMITTED: patient balance can only be changed by billing/cashier/accounts or through a payment routine';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- SOURCE: 20260731113842_2e4d8c37-d475-4fa3-831b-fe8246def08b.sql statement 2
REVOKE ALL ON FUNCTION public.enforce_patient_field_permissions() FROM PUBLIC, anon, authenticated;

-- SOURCE: 20260731113842_2e4d8c37-d475-4fa3-831b-fe8246def08b.sql statement 3
DROP TRIGGER IF EXISTS trg_patients_field_permissions ON public.patients;

-- SOURCE: 20260731113842_2e4d8c37-d475-4fa3-831b-fe8246def08b.sql statement 4
CREATE TRIGGER trg_patients_field_permissions
  BEFORE UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.enforce_patient_field_permissions();

-- SOURCE: 20260731113842_2e4d8c37-d475-4fa3-831b-fe8246def08b.sql statement 5
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
  SELECT set_config('app.allow_balance_write', 'on', true);
  UPDATE public.patients SET balance = _after, updated_at = now() WHERE id = _patient_id;
  SELECT set_config('app.allow_balance_write', 'off', true);
  INSERT INTO public.balance_transactions
    (patient_id, transaction_type, amount, balance_before, balance_after, payment_method, related_request_id, related_invoice_id, performed_by, notes)
  VALUES
    (_patient_id, _transaction_type, _delta, _before, _after, _payment_method, _related_request_id, _related_invoice_id, public.hms_current_user_id(), _notes);
  RETURN _after;
END;
$function$;

-- SOURCE: 20260731113842_2e4d8c37-d475-4fa3-831b-fe8246def08b.sql statement 6
CREATE OR REPLACE FUNCTION public.create_admitted_snap(_patient_id uuid, _order_type text, _target_station text, _photo_path text, _note text, _items jsonb, _total numeric, _allow_debt boolean DEFAULT false, _debt_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 
AS $function$
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
  SELECT set_config('app.allow_balance_write', 'on', true);
  UPDATE public.patients SET balance = _new_bal, updated_at = now() WHERE id = _patient_id;
  SELECT set_config('app.allow_balance_write', 'off', true);
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
END; $function$;

-- SOURCE: 20260731113842_2e4d8c37-d475-4fa3-831b-fe8246def08b.sql statement 7
REVOKE ALL ON FUNCTION public.adjust_patient_balance(uuid, numeric, text, text, uuid, uuid, text) FROM PUBLIC, anon;

-- SOURCE: 20260731113842_2e4d8c37-d475-4fa3-831b-fe8246def08b.sql statement 8
GRANT EXECUTE ON FUNCTION public.adjust_patient_balance(uuid, numeric, text, text, uuid, uuid, text) TO authenticated, service_role;

-- SOURCE: 20260731113842_2e4d8c37-d475-4fa3-831b-fe8246def08b.sql statement 9
REVOKE ALL ON FUNCTION public.create_admitted_snap(uuid, text, text, text, text, jsonb, numeric, boolean, text) FROM PUBLIC, anon;

-- SOURCE: 20260731113842_2e4d8c37-d475-4fa3-831b-fe8246def08b.sql statement 10
GRANT EXECUTE ON FUNCTION public.create_admitted_snap(uuid, text, text, text, text, jsonb, numeric, boolean, text) TO authenticated, service_role;

-- SOURCE: 20260731165524_c2b319f4-484d-467b-9982-f3941ca8a4c1.sql statement 1
DROP POLICY IF EXISTS "Staff can update patients" ON public.patients;

-- SOURCE: 20260731165524_c2b319f4-484d-467b-9982-f3941ca8a4c1.sql statement 2
CREATE POLICY "Operational staff can update patients"
ON public.patients FOR UPDATE TO authenticated
USING (has_any_role(public.hms_current_user_id(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','anc','lab_tech','pharmacist','billing','cashier','accountant','claims_manager','admin']::app_role[]))
WITH CHECK (has_any_role(public.hms_current_user_id(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','anc','lab_tech','pharmacist','billing','cashier','accountant','claims_manager','admin']::app_role[]));

-- SOURCE: 20260731165524_c2b319f4-484d-467b-9982-f3941ca8a4c1.sql statement 3
DROP POLICY IF EXISTS "Authenticated staff can read invoices" ON public.invoices;

-- SOURCE: 20260731165524_c2b319f4-484d-467b-9982-f3941ca8a4c1.sql statement 4
CREATE POLICY "Billing-relevant staff can read invoices"
ON public.invoices FOR SELECT TO authenticated
USING (has_any_role(public.hms_current_user_id(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','anc','billing','cashier','accountant','claims_manager','admin']::app_role[]));

-- SOURCE: 20260731165524_c2b319f4-484d-467b-9982-f3941ca8a4c1.sql statement 5
DROP POLICY IF EXISTS "Authenticated staff can read invoice_items" ON public.invoice_items;

-- SOURCE: 20260731165524_c2b319f4-484d-467b-9982-f3941ca8a4c1.sql statement 6
CREATE POLICY "Billing-relevant staff can read invoice_items"
ON public.invoice_items FOR SELECT TO authenticated
USING (has_any_role(public.hms_current_user_id(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','anc','billing','cashier','accountant','claims_manager','admin']::app_role[]));

-- SOURCE: 20260731165524_c2b319f4-484d-467b-9982-f3941ca8a4c1.sql statement 7
DROP POLICY IF EXISTS "staff_view_eligibility" ON public.eligibility_verifications;

-- SOURCE: 20260731165524_c2b319f4-484d-467b-9982-f3941ca8a4c1.sql statement 8
CREATE POLICY "eligibility_roles_view_eligibility"
ON public.eligibility_verifications FOR SELECT TO authenticated
USING (has_any_role(public.hms_current_user_id(), ARRAY['receptionist','claims_manager','billing','admin']::app_role[]));

-- SOURCE: 20260731165524_c2b319f4-484d-467b-9982-f3941ca8a4c1.sql statement 9
DROP POLICY IF EXISTS "Admin and account can read staff" ON public.staff;

-- SOURCE: 20260731165524_c2b319f4-484d-467b-9982-f3941ca8a4c1.sql statement 10
CREATE POLICY "Admin and accountant can read staff"
ON public.staff FOR SELECT TO authenticated
USING (has_any_role(public.hms_current_user_id(), ARRAY['admin','accountant']::app_role[]));

-- SOURCE: 20260731165524_c2b319f4-484d-467b-9982-f3941ca8a4c1.sql statement 11
CREATE OR REPLACE VIEW public.staff_directory
AS
SELECT id, employee_id, first_name, last_name, role, department, status, family_deduction_consent
FROM public.staff;

-- SOURCE: 20260731165524_c2b319f4-484d-467b-9982-f3941ca8a4c1.sql statement 12
REVOKE ALL ON public.staff_directory FROM PUBLIC, anon;

-- SOURCE: 20260731165524_c2b319f4-484d-467b-9982-f3941ca8a4c1.sql statement 13
GRANT SELECT ON public.staff_directory TO authenticated;

-- SOURCE: 20260731165524_c2b319f4-484d-467b-9982-f3941ca8a4c1.sql statement 14
GRANT ALL ON public.staff_directory TO service_role;

-- SOURCE: 20260731165539_48aebc8d-ba2a-41ec-96cd-5324cbc2539e.sql statement 1
DROP VIEW IF EXISTS public.staff_directory;

-- SOURCE: 20260731165539_48aebc8d-ba2a-41ec-96cd-5324cbc2539e.sql statement 2
CREATE OR REPLACE FUNCTION public.get_staff_directory()
RETURNS TABLE (
  id uuid,
  employee_id text,
  first_name text,
  last_name text,
  role text,
  department text,
  status text,
  family_deduction_consent boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER

AS $$
  SELECT s.id, s.employee_id, s.first_name, s.last_name, s.role, s.department, s.status, s.family_deduction_consent
  FROM public.staff s
  WHERE public.is_authenticated_staff()
$$;

-- SOURCE: 20260731165539_48aebc8d-ba2a-41ec-96cd-5324cbc2539e.sql statement 3
REVOKE ALL ON FUNCTION public.get_staff_directory() FROM PUBLIC, anon;
