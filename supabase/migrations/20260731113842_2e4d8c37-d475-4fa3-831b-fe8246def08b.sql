-- Field-level authorisation for patient record updates -----------------------
CREATE OR REPLACE FUNCTION public.enforce_patient_field_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _old jsonb := to_jsonb(OLD);
  _new jsonb := to_jsonb(NEW);
  _key text;
  _identity_cols  text[] := ARRAY['first_name','last_name','date_of_birth','gender','phone','address','emergency_contact','occupation','photo_path'];
  _card_cols      text[] := ARRAY['card_number','mini_card_number'];
  _sponsor_cols   text[] := ARRAY['account_type','corporate_id','insurance_provider','insurance_plan','insurance_policy_number','enrollee_id','member_id_data','staff_link_id'];
  _clinical_cols  text[] := ARRAY['blood_group','allergies'];
BEGIN
  -- service_role / backend jobs (no auth context) are unaffected
  IF _uid IS NULL THEN RETURN NEW; END IF;
  IF public.has_role(_uid, 'admin'::app_role) THEN RETURN NEW; END IF;

  FOR _key IN
    SELECT k FROM jsonb_object_keys(_new) AS k
    WHERE (_new -> k) IS DISTINCT FROM (_old -> k)
  LOOP
    IF _key = ANY(_identity_cols) THEN
      IF NOT public.has_role(_uid, 'receptionist'::app_role) THEN
        RAISE EXCEPTION 'NOT_PERMITTED: only reception or an admin can change patient personal details (%)', _key;
      END IF;

    ELSIF _key = ANY(_card_cols) THEN
      RAISE EXCEPTION 'NOT_PERMITTED: only an admin can change patient card numbers (%)', _key;

    ELSIF _key = ANY(_sponsor_cols) THEN
      IF NOT public.has_any_role(_uid, ARRAY['receptionist','billing','accountant','claims_manager']::app_role[]) THEN
        RAISE EXCEPTION 'NOT_PERMITTED: only reception, billing, accounts or claims staff can change sponsor/insurance details (%)', _key;
      END IF;

    ELSIF _key = ANY(_clinical_cols) THEN
      IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','anc']::app_role[]) THEN
        RAISE EXCEPTION 'NOT_PERMITTED: only clinical staff can change clinical details (%)', _key;
      END IF;

    ELSIF _key = 'balance' THEN
      IF COALESCE(current_setting('app.allow_balance_write', true), '') <> 'on'
         AND NOT public.has_any_role(_uid, ARRAY['billing','cashier','accountant']::app_role[]) THEN
        RAISE EXCEPTION 'NOT_PERMITTED: patient balance can only be changed by billing/cashier/accounts or through a payment routine';
      END IF;
    END IF;
    -- remaining columns (status, assigned_doctor, last_visit, timestamps) stay
    -- open to any authenticated staff so the patient queues keep working.
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_patient_field_permissions() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_patients_field_permissions ON public.patients;
CREATE TRIGGER trg_patients_field_permissions
  BEFORE UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.enforce_patient_field_permissions();

-- Allow the sanctioned wallet routines to write balance regardless of role ----
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
  PERFORM set_config('app.allow_balance_write', 'on', true);
  UPDATE public.patients SET balance = _after, updated_at = now() WHERE id = _patient_id;
  PERFORM set_config('app.allow_balance_write', 'off', true);
  INSERT INTO public.balance_transactions
    (patient_id, transaction_type, amount, balance_before, balance_after, payment_method, related_request_id, related_invoice_id, performed_by, notes)
  VALUES
    (_patient_id, _transaction_type, _delta, _before, _after, _payment_method, _related_request_id, _related_invoice_id, auth.uid(), _notes);
  RETURN _after;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_admitted_snap(_patient_id uuid, _order_type text, _target_station text, _photo_path text, _note text, _items jsonb, _total numeric, _allow_debt boolean DEFAULT false, _debt_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  PERFORM set_config('app.allow_balance_write', 'on', true);
  UPDATE public.patients SET balance = _new_bal, updated_at = now() WHERE id = _patient_id;
  PERFORM set_config('app.allow_balance_write', 'off', true);
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
END; $function$;

REVOKE ALL ON FUNCTION public.adjust_patient_balance(uuid, numeric, text, text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_patient_balance(uuid, numeric, text, text, uuid, uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_admitted_snap(uuid, text, text, text, text, jsonb, numeric, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_admitted_snap(uuid, text, text, text, text, jsonb, numeric, boolean, text) TO authenticated, service_role;