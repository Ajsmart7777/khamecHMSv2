-- SOURCE: 20260819120000_crdb_workflow_compatibility.sql statement 8
CREATE OR REPLACE FUNCTION public.adjust_patient_balance(_patient_id UUID, _delta DECIMAL, _transaction_type STRING, _payment_method STRING DEFAULT NULL::STRING, _related_request_id UUID DEFAULT NULL::UUID, _related_invoice_id UUID DEFAULT NULL::UUID, _notes STRING DEFAULT NULL::STRING) RETURNS DECIMAL LANGUAGE plpgsql SECURITY DEFINER AS $$DECLARE
_before DECIMAL;
_after DECIMAL;
BEGIN
SELECT balance FROM khamec.public.patients WHERE id = _patient_id FOR UPDATE INTO _before;
IF _before IS NULL THEN
	RAISE EXCEPTION 'Patient not found';
END IF;
_after := _before + _delta;
IF (_after < 0) AND (_transaction_type != 'debt_incurred') THEN
	RAISE EXCEPTION 'Insufficient balance (current: %, requested delta: %)', _before, _delta;
END IF;
SELECT set_config('application_name', 'hms-balance-write', true);
UPDATE khamec.public.patients SET balance = _after, updated_at = now():::TIMESTAMPTZ WHERE id = _patient_id;
SELECT set_config('application_name', '', true);
INSERT INTO khamec.public.balance_transactions(patient_id, transaction_type, amount, balance_before, balance_after, payment_method, related_request_id, related_invoice_id, performed_by, notes) VALUES (_patient_id, _transaction_type, _delta, _before, _after, _payment_method, _related_request_id, _related_invoice_id, public.hms_current_user_id(), _notes);
RETURN _after;
END;
$$;

-- SOURCE: 20260819120000_crdb_workflow_compatibility.sql statement 9
CREATE OR REPLACE FUNCTION public.create_admitted_snap(_patient_id UUID, _order_type STRING, _target_station STRING, _photo_path STRING, _note STRING, _items JSONB, _total DECIMAL, _allow_debt BOOL DEFAULT false, _debt_reason STRING DEFAULT NULL::STRING) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$DECLARE
_uid UUID := public.hms_current_user_id();
_visit UUID;
_admission UUID;
_bal DECIMAL;
_snap_id UUID;
_new_bal DECIMAL;
_debt DECIMAL := 0;
_invoice UUID;
_role STRING;
_acct STRING;
_plan STRING;
_corp UUID;
_sponsor STRING;
_pct DECIMAL;
_patient_share DECIMAL;
_covered DECIMAL;
BEGIN
IF NOT public.has_any_role(_uid, ARRAY[b'@':::@101928, b' ':::@101928, b'\xf8':::@101928, b'\xfc':::@101928, b'\x10':::@101928]:::@101929) THEN
	RAISE EXCEPTION 'Not authorized';
END IF;
SELECT id FROM khamec.public.admissions WHERE (patient_id = _patient_id) AND (status IN ('active':::STRING, 'ready_for_discharge':::STRING)) ORDER BY admitted_at DESC NULLS LAST LIMIT 1 INTO _admission;
IF _admission IS NULL THEN
	RAISE EXCEPTION 'Patient is not currently admitted';
END IF;
SELECT id FROM khamec.public.visits WHERE (patient_id = _patient_id) AND (status = 'open') ORDER BY opened_at DESC LIMIT 1 INTO _visit;
SELECT balance, lower(COALESCE(account_type, '')), insurance_plan, corporate_id FROM khamec.public.patients WHERE id = _patient_id FOR UPDATE INTO _bal, _acct, _plan, _corp;
IF _bal IS NULL THEN
	RAISE EXCEPTION 'Patient not found';
END IF;
_pct := public.copay_percent(_acct, _plan);
_patient_share := round((COALESCE(_total, 0) * _pct) / 100.0, 2);
_covered := greatest(0, round(COALESCE(_total, 0) - _patient_share, 2));
IF _bal < _patient_share THEN
	IF NOT _allow_debt THEN
	RAISE EXCEPTION 'INSUFFICIENT_BALANCE: balance % < required %', _bal, _patient_share;
END IF;
	IF (_debt_reason IS NULL) OR (length(btrim(_debt_reason)) < 3) THEN
	RAISE EXCEPTION 'Debt override requires a reason';
END IF;
	_debt := _patient_share - _bal;
END IF;
SELECT "role"::STRING FROM khamec.public.user_roles WHERE user_id = _uid LIMIT 1 INTO _role;
_sponsor := CASE WHEN _acct IN ('corporate':::STRING, 'retainer':::STRING) THEN _acct WHEN _acct IN ('cash':::STRING, 'normal':::STRING, '':::STRING) THEN NULL ELSE _acct END;
INSERT INTO khamec.public.invoices(patient_id, invoice_number, total_amount, original_amount, discount_amount, paid_amount, status, payment_method, notes, visit_id, paid_at, sponsor_type, corporate_account_id, created_by) VALUES (_patient_id, '', _total, _total, 0, _patient_share, 'paid', 'wallet', ((('In-ward ' || _order_type) || ' (admitted order)') || CASE WHEN _covered > 0 THEN e' \U00002014 sponsor covered \U000020A6' || _covered ELSE '' END) || CASE WHEN _debt > 0 THEN e' \U00002014 debt \U000020A6' || _debt ELSE '' END, _visit, now():::TIMESTAMPTZ, _sponsor, CASE WHEN _acct IN ('corporate':::STRING, 'retainer':::STRING) THEN _corp ELSE NULL END, _role) RETURNING id INTO _invoice;
IF jsonb_typeof(COALESCE(_items, '[]'::JSONB)) = 'array' THEN
	INSERT INTO khamec.public.invoice_items(invoice_id, description, quantity, unit_price, total, category) SELECT _invoice, COALESCE(it->>'name', 'Item'), greatest(COALESCE((it->>'qty')::INT8, 1), 1), COALESCE((it->>'unit_price')::DECIMAL, 0), greatest(COALESCE((it->>'qty')::INT8, 1), 1) * COALESCE((it->>'unit_price')::DECIMAL, 0), COALESCE(it->>'category', _order_type) FROM ROWS FROM (jsonb_array_elements(_items)) AS it;
END IF;
_new_bal := _bal - _patient_share;
IF _patient_share != 0 THEN
SELECT set_config('application_name', 'hms-balance-write', true);
	UPDATE khamec.public.patients SET balance = _new_bal, updated_at = now():::TIMESTAMPTZ WHERE id = _patient_id;
SELECT set_config('application_name', '', true);
	INSERT INTO khamec.public.balance_transactions(patient_id, transaction_type, amount, balance_before, balance_after, performed_by, related_invoice_id, notes) VALUES (_patient_id, CASE WHEN _debt > 0 THEN 'debt_incurred' ELSE 'admitted_deduction' END, -_patient_share, _bal, _new_bal, _uid, _invoice, CASE WHEN _debt > 0 THEN (((('Admitted in-ward ' || _order_type) || e' (debt \U000020A6') || _debt) || '): ') || COALESCE(_debt_reason, '') ELSE 'Admitted in-ward ' || _order_type END);
END IF;
INSERT INTO khamec.public.snap_orders(patient_id, visit_id, order_type, target_station, source_role, photo_path, note, matched_items, status, created_by, is_admitted_snap, debt_amount, debt_reason, invoice_id, billed_by, billed_at, paid_at, original_sender_role) VALUES (_patient_id, _visit, _order_type, _target_station, _role, NULLIF(_photo_path, ''), _note, COALESCE(_items, '[]'::JSONB), 'paid', _uid, true, _debt, _debt_reason, _invoice, _uid, now():::TIMESTAMPTZ, now():::TIMESTAMPTZ, _role) RETURNING id INTO _snap_id;
SELECT write_audit_log(CASE WHEN _debt > 0 THEN 'admitted_snap_debt' ELSE 'admitted_snap_created' END, 'snap_order', _snap_id::STRING, jsonb_build_object('patient_id', _patient_id, 'total', _total, 'patient_share', _patient_share, 'sponsor_covered', _covered, 'debt', _debt, 'balance_after', _new_bal, 'reason', _debt_reason, 'invoice_id', _invoice, 'has_photo', (_photo_path IS NOT NULL), 'target_station', _target_station, 'order_type', _order_type), 'success');
RETURN _snap_id;
END;
$$;

-- SOURCE: 20260819120000_crdb_workflow_compatibility.sql statement 10
CREATE OR REPLACE FUNCTION public.settle_invoice_atomic(_invoice_id UUID, _cash_amount DECIMAL DEFAULT 0::DECIMAL, _balance_amount DECIMAL DEFAULT 0::DECIMAL, _debt_amount DECIMAL DEFAULT 0::DECIMAL, _payment_method STRING DEFAULT 'cash'::STRING, _notes STRING DEFAULT NULL::STRING, _sponsored BOOL DEFAULT false, _is_salary_deduction BOOL DEFAULT false)
	RETURNS JSONB
	VOLATILE
	NOT LEAKPROOF
	CALLED ON NULL INPUT
	LANGUAGE plpgsql
	SECURITY DEFINER
	AS $$
	DECLARE
	v_invoice invoices;
	v_new_balance DECIMAL;
	v_collected DECIMAL;
	v_available DECIMAL;
	v_staff_id UUID;
	BEGIN
	IF NOT public.is_authenticated_staff() THEN
		RAISE EXCEPTION 'Not authorized';
	END IF;
	IF ((_cash_amount < 0) OR (_balance_amount < 0)) OR (_debt_amount < 0) THEN
		RAISE EXCEPTION 'Amounts must be non-negative';
	END IF;
	SELECT public.invoices.id, public.invoices.patient_id, public.invoices.invoice_number, public.invoices.total_amount, public.invoices.paid_amount, public.invoices.status, public.invoices.payment_method, public.invoices.notes, public.invoices.created_by, public.invoices.created_at, public.invoices.updated_at, public.invoices.paid_at, public.invoices.original_amount, public.invoices.discount_amount, public.invoices.sponsor_type, public.invoices.corporate_account_id, public.invoices.visit_id, public.invoices.claim_submitted_at, public.invoices.claim_submitted_by, public.invoices.claim_submission_notes, public.invoices.is_salary_deduction FROM khamec.public.invoices WHERE id = _invoice_id FOR UPDATE INTO v_invoice;
	IF (v_invoice).id IS NULL THEN
		RAISE EXCEPTION 'Invoice not found';
	END IF;
	IF (v_invoice).status = 'paid' THEN
		RAISE EXCEPTION 'Invoice already settled';
	END IF;
	IF _is_salary_deduction THEN
		SELECT staff_id FROM khamec.public.staff_family_members WHERE patient_id = (v_invoice).patient_id INTO v_staff_id;
		IF v_staff_id IS NULL THEN
		RAISE EXCEPTION 'Patient is not linked to a staff sponsor';
	END IF;
	END IF;
	IF _balance_amount > 0 THEN
		SELECT balance FROM khamec.public.patients WHERE id = (v_invoice).patient_id FOR UPDATE INTO v_available;
		IF (v_available IS NULL) OR (v_available < _balance_amount) THEN
		RAISE EXCEPTION 'Insufficient wallet balance (available: %, requested: %)', COALESCE(v_available, 0), _balance_amount;
	END IF;
		SELECT public.adjust_patient_balance((v_invoice).patient_id, -_balance_amount, 'invoice_deduction', 'balance', NULL, _invoice_id, COALESCE(_notes, format('Applied to invoice %s', (v_invoice).invoice_number)));
	END IF;
	IF _debt_amount > 0 THEN
		SELECT public.adjust_patient_balance((v_invoice).patient_id, -_debt_amount, 'debt_incurred', _payment_method, NULL, _invoice_id, format('Shortfall on invoice %s', (v_invoice).invoice_number));
	END IF;
	IF (NOT _sponsored) AND ((_cash_amount + _balance_amount) > ((v_invoice).total_amount - COALESCE((v_invoice).paid_amount, 0))) THEN
		DECLARE
	v_overpayment DECIMAL;
	BEGIN
	v_overpayment := (_cash_amount + _balance_amount) - ((v_invoice).total_amount - COALESCE((v_invoice).paid_amount, 0));
	SELECT public.adjust_patient_balance((v_invoice).patient_id, v_overpayment, 'overpayment_credit', _payment_method, NULL, _invoice_id, format('Overpayment on invoice %s', (v_invoice).invoice_number));
	END;
	END IF;
	v_collected := (COALESCE((v_invoice).paid_amount, 0) + _cash_amount) + _balance_amount;
	UPDATE khamec.public.invoices SET paid_amount = v_collected, status = 'paid', payment_method = CASE WHEN _is_salary_deduction THEN 'salary_deduction' ELSE _payment_method END, paid_at = now():::TIMESTAMPTZ, notes = COALESCE(_notes, notes), updated_at = now():::TIMESTAMPTZ WHERE id = _invoice_id;
	SELECT balance FROM khamec.public.patients WHERE id = (v_invoice).patient_id INTO v_new_balance;
	RETURN jsonb_build_object('invoice_id', _invoice_id, 'invoice_number', (v_invoice).invoice_number, 'patient_id', (v_invoice).patient_id, 'collected', v_collected, 'cash_amount', _cash_amount, 'balance_amount', _balance_amount, 'debt_amount', _debt_amount, 'new_wallet_balance', v_new_balance, 'sponsored', _sponsored, 'is_salary_deduction', _is_salary_deduction);
	END;
$$;

-- SOURCE: 20260819120000_crdb_workflow_compatibility.sql statement 11
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

-- SOURCE: 20260819133000_crdb_snap_order_constraints.sql statement 1
ALTER TABLE public.snap_orders DROP CONSTRAINT IF EXISTS check_order_type;

-- SOURCE: 20260819133000_crdb_snap_order_constraints.sql statement 2
ALTER TABLE public.snap_orders DROP CONSTRAINT IF EXISTS check_target_station;

-- SOURCE: 20260819133000_crdb_snap_order_constraints.sql statement 3
ALTER TABLE public.snap_orders DROP CONSTRAINT IF EXISTS check_status;

-- SOURCE: 20260819143000_remove_external_doctor_feature.sql statement 1
CREATE OR REPLACE FUNCTION public.patient_archive_case_fingerprint(_patient_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT md5(concat_ws('|',
    COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id)::text FROM public.visits v WHERE v.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id)::text FROM public.admissions a WHERE a.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id)::text FROM public.invoices i WHERE i.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ii) ORDER BY ii.id)::text FROM public.invoice_items ii WHERE ii.invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = _patient_id)), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ssi) ORDER BY ssi.id)::text FROM public.sponsor_statement_items ssi WHERE ssi.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ic) ORDER BY ic.id)::text FROM public.insurance_claims ic WHERE ic.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(bt) ORDER BY bt.id)::text FROM public.balance_transactions bt WHERE bt.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(br) ORDER BY br.id)::text FROM public.balance_requests br WHERE br.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pr) ORDER BY pr.id)::text FROM public.prescriptions pr WHERE pr.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pi) ORDER BY pi.id)::text FROM public.prescription_items pi WHERE pi.prescription_id IN (SELECT id FROM public.prescriptions WHERE patient_id = _patient_id)), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(lr) ORDER BY lr.id)::text FROM public.lab_requests lr WHERE lr.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(vt) ORDER BY vt.id)::text FROM public.vitals vt WHERE vt.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(so) ORDER BY so.id)::text FROM public.snap_orders so WHERE so.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', sto.id,
      'patient_id', sto.patient_id,
      'photo_url', sto.photo_url,
      'notes', sto.notes,
      'status', sto.status,
      'expiry_date', sto.expiry_date,
      'transcribed_prescription_id', sto.transcribed_prescription_id,
      'captured_by', sto.captured_by,
      'fulfilled_by', sto.fulfilled_by,
      'fulfilled_at', sto.fulfilled_at,
      'created_at', sto.created_at,
      'updated_at', sto.updated_at,
      'order_type', sto.order_type,
      'visit_id', sto.visit_id
    ) ORDER BY sto.id)::text FROM public.standing_orders sto WHERE sto.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(rl) ORDER BY rl.id)::text FROM public.referral_letters rl WHERE rl.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(va) ORDER BY va.id)::text FROM public.visit_attachments va WHERE va.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ea) ORDER BY ea.id)::text FROM public.emr_attachments ea WHERE ea.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ev) ORDER BY ev.id)::text FROM public.eligibility_verifications ev WHERE ev.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pjh) ORDER BY pjh.id)::text FROM public.patient_journey_history pjh WHERE pjh.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pj) ORDER BY pj.id)::text FROM public.patient_journey pj WHERE pj.patient_id = _patient_id), '[]'),
    COALESCE((SELECT p.photo_path::text FROM public.patients p WHERE p.id = _patient_id), '')
  ));
$$;

-- SOURCE: 20260819143000_remove_external_doctor_feature.sql statement 2
CREATE OR REPLACE FUNCTION public.patient_archive_storage_snapshot(_patient_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_row_counts jsonb;
  v_payload_bytes bigint;
BEGIN
  SELECT jsonb_build_object(
    'invoice_items', (SELECT count(*) FROM public.invoice_items ii WHERE ii.invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = _patient_id)),
    'sponsor_statement_items', (SELECT count(*) FROM public.sponsor_statement_items WHERE patient_id = _patient_id),
    'insurance_claims', (SELECT count(*) FROM public.insurance_claims WHERE patient_id = _patient_id),
    'balance_transactions', (SELECT count(*) FROM public.balance_transactions WHERE patient_id = _patient_id),
    'balance_requests', (SELECT count(*) FROM public.balance_requests WHERE patient_id = _patient_id),
    'invoices', (SELECT count(*) FROM public.invoices WHERE patient_id = _patient_id),
    'prescription_items', (SELECT count(*) FROM public.prescription_items pi WHERE pi.prescription_id IN (SELECT id FROM public.prescriptions WHERE patient_id = _patient_id)),
    'prescriptions', (SELECT count(*) FROM public.prescriptions WHERE patient_id = _patient_id),
    'lab_requests', (SELECT count(*) FROM public.lab_requests WHERE patient_id = _patient_id),
    'vitals', (SELECT count(*) FROM public.vitals WHERE patient_id = _patient_id),
    'snap_orders', (SELECT count(*) FROM public.snap_orders WHERE patient_id = _patient_id),
    'standing_orders', (SELECT count(*) FROM public.standing_orders WHERE patient_id = _patient_id),
    'referral_letters', (SELECT count(*) FROM public.referral_letters WHERE patient_id = _patient_id),
    'visit_attachments', (SELECT count(*) FROM public.visit_attachments WHERE patient_id = _patient_id),
    'emr_attachments', (SELECT count(*) FROM public.emr_attachments WHERE patient_id = _patient_id),
    'eligibility_verifications', (SELECT count(*) FROM public.eligibility_verifications WHERE patient_id = _patient_id),
    'patient_journey_history', (SELECT count(*) FROM public.patient_journey_history WHERE patient_id = _patient_id),
    'patient_journey', (SELECT count(*) FROM public.patient_journey WHERE patient_id = _patient_id),
    'admissions', (SELECT count(*) FROM public.admissions WHERE patient_id = _patient_id),
    'visits', (SELECT count(*) FROM public.visits WHERE patient_id = _patient_id)
  ) INTO v_row_counts;

  SELECT COALESCE(sum(payload_bytes), 0)::bigint INTO v_payload_bytes
  FROM (
    SELECT pg_column_size(ii)::bigint AS payload_bytes FROM public.invoice_items ii WHERE ii.invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = _patient_id)
    UNION ALL SELECT pg_column_size(ssi)::bigint FROM public.sponsor_statement_items ssi WHERE ssi.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(ic)::bigint FROM public.insurance_claims ic WHERE ic.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(bt)::bigint FROM public.balance_transactions bt WHERE bt.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(br)::bigint FROM public.balance_requests br WHERE br.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(i)::bigint FROM public.invoices i WHERE i.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(pi)::bigint FROM public.prescription_items pi WHERE pi.prescription_id IN (SELECT id FROM public.prescriptions WHERE patient_id = _patient_id)
    UNION ALL SELECT pg_column_size(pr)::bigint FROM public.prescriptions pr WHERE pr.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(lr)::bigint FROM public.lab_requests lr WHERE lr.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(vt)::bigint FROM public.vitals vt WHERE vt.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(so)::bigint FROM public.snap_orders so WHERE so.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(jsonb_build_object(
      'id', sto.id,
      'patient_id', sto.patient_id,
      'photo_url', sto.photo_url,
      'notes', sto.notes,
      'status', sto.status,
      'expiry_date', sto.expiry_date,
      'transcribed_prescription_id', sto.transcribed_prescription_id,
      'captured_by', sto.captured_by,
      'fulfilled_by', sto.fulfilled_by,
      'fulfilled_at', sto.fulfilled_at,
      'created_at', sto.created_at,
      'updated_at', sto.updated_at,
      'order_type', sto.order_type,
      'visit_id', sto.visit_id
    ))::bigint FROM public.standing_orders sto WHERE sto.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(rl)::bigint FROM public.referral_letters rl WHERE rl.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(va)::bigint FROM public.visit_attachments va WHERE va.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(ea)::bigint FROM public.emr_attachments ea WHERE ea.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(ev)::bigint FROM public.eligibility_verifications ev WHERE ev.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(pjh)::bigint FROM public.patient_journey_history pjh WHERE pjh.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(pj)::bigint FROM public.patient_journey pj WHERE pj.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(a)::bigint FROM public.admissions a WHERE a.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(v)::bigint FROM public.visits v WHERE v.patient_id = _patient_id
  ) payload;

  RETURN jsonb_build_object(
    'row_counts', v_row_counts,
    'database_payload_bytes', v_payload_bytes
  );
END;
$$;

-- SOURCE: 20260819143000_remove_external_doctor_feature.sql statement 3
DROP TRIGGER IF EXISTS standing_orders_autofill_visit ON public.standing_orders;

-- SOURCE: 20260819143000_remove_external_doctor_feature.sql statement 4
ALTER TABLE public.standing_orders
  DROP CONSTRAINT IF EXISTS standing_orders_external_doctor_id_fkey;

-- SOURCE: 20260819143000_remove_external_doctor_feature.sql statement 5
ALTER TABLE public.standing_orders
  DROP COLUMN IF EXISTS external_doctor_id,
  DROP COLUMN IF EXISTS external_doctor_name;

-- SOURCE: 20260819143000_remove_external_doctor_feature.sql statement 6
DROP TABLE IF EXISTS public.external_doctors CASCADE;

-- SOURCE: 20260820150000_crdb_compatibility_constraint_cleanup.sql statement 1
ALTER TABLE public.patients DROP CONSTRAINT IF EXISTS check_status;

-- SOURCE: 20260820150000_crdb_compatibility_constraint_cleanup.sql statement 2
ALTER TABLE public.patients DROP CONSTRAINT IF EXISTS check_account_type;

-- SOURCE: 20260820150000_crdb_compatibility_constraint_cleanup.sql statement 3
ALTER TABLE public.admissions DROP CONSTRAINT IF EXISTS check_status;

-- SOURCE: 20260820150000_crdb_compatibility_constraint_cleanup.sql statement 4
ALTER TABLE public.stock_transfers DROP CONSTRAINT IF EXISTS check_status;

-- SOURCE: 20260820150000_crdb_compatibility_constraint_cleanup.sql statement 5
ALTER TABLE public.snap_orders DROP CONSTRAINT IF EXISTS snap_orders_status_check;

-- SOURCE: 20260820150000_crdb_compatibility_constraint_cleanup.sql statement 6
ALTER TABLE public.snap_orders ADD CONSTRAINT snap_orders_status_check
  CHECK (status IN ('pending_billing','awaiting_payment','paid','fulfilled','rejected','cancelled','returned','acknowledged','held_no_balance'));

-- SOURCE: 20260820150000_crdb_compatibility_constraint_cleanup.sql statement 7
ALTER TABLE public.standing_orders DROP CONSTRAINT IF EXISTS check_order_type1;

-- SOURCE: 20260820150000_crdb_compatibility_constraint_cleanup.sql statement 8
ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_database_payload_bytes1;

-- SOURCE: 20260820150000_crdb_compatibility_constraint_cleanup.sql statement 9
ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_database_payload_bytes2;

-- SOURCE: 20260820150000_crdb_compatibility_constraint_cleanup.sql statement 10
ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_database_payload_bytes3;

-- SOURCE: 20260820150000_crdb_compatibility_constraint_cleanup.sql statement 11
ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_r2_cleanup_status1;

-- SOURCE: 20260820150000_crdb_compatibility_constraint_cleanup.sql statement 12
ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_r2_cleanup_status2;

-- SOURCE: 20260820150000_crdb_compatibility_constraint_cleanup.sql statement 13
ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_r2_cleanup_status3;

-- SOURCE: 20260820150000_crdb_compatibility_constraint_cleanup.sql statement 14
ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_r2_deleted_bytes1;

-- SOURCE: 20260820150000_crdb_compatibility_constraint_cleanup.sql statement 15
ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_r2_deleted_bytes2;

-- SOURCE: 20260820150000_crdb_compatibility_constraint_cleanup.sql statement 16
ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_r2_deleted_bytes3;

-- SOURCE: 20260820150000_crdb_compatibility_constraint_cleanup.sql statement 17
ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_r2_object_bytes1;

-- SOURCE: 20260820150000_crdb_compatibility_constraint_cleanup.sql statement 18
ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_r2_object_bytes2;

-- SOURCE: 20260820150000_crdb_compatibility_constraint_cleanup.sql statement 19
ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_r2_object_bytes3;

-- SOURCE: 20260820160000_crdb_store_catalog_function.sql statement 1
CREATE OR REPLACE FUNCTION public.get_inventory_catalog()
RETURNS TABLE (
  product_id uuid,
  pricelist_item_id uuid,
  medicine_name text,
  category text,
  size text,
  sale_price numeric,
  sku text,
  unit_label text,
  minimum_level numeric,
  active boolean
)
LANGUAGE sql
STABLE
    SECURITY DEFINER
AS $$
  SELECT ip.id,
         p.id,
         p.name,
         p.category,
         p.size,
         p.price,
         ip.sku,
         ip.unit_label,
         ip.minimum_level,
         ip.active
  FROM public.inventory_products ip
  JOIN public.pricelist p ON p.id = ip.pricelist_item_id
  WHERE public.has_any_role(
    public.hms_current_user_id(),
    ARRAY[
      'store'::public.app_role,
      'pharmacist'::public.app_role,
      'accountant'::public.app_role,
      'admin'::public.app_role
    ]
  )
  ORDER BY p.name;
$$;

-- SOURCE: 20260820160000_crdb_store_catalog_function.sql statement 2
GRANT EXECUTE ON FUNCTION public.get_inventory_catalog() TO authenticated;

-- SOURCE: 20260821100000_fix_cockroach_discharge_settlement.sql statement 1
CREATE OR REPLACE FUNCTION public.patient_outstanding(_patient_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  _p public.patients;
  _pct numeric;
  _invoice_due numeric := 0;
BEGIN
  SELECT * INTO _p
  FROM public.patients
  WHERE id = _patient_id;

  IF _p IS NULL THEN
    RETURN 0;
  END IF;

  _pct := public.copay_percent((_p).account_type, (_p).insurance_plan);

  SELECT COALESCE(SUM(
    GREATEST(
      0,
      ROUND(i.total_amount * _pct / 100.0, 2) - COALESCE(i.paid_amount, 0)
    )
  ), 0)
  INTO _invoice_due
  FROM public.invoices i
  WHERE i.patient_id = _patient_id
    AND i.status IN ('pending', 'partial');

  RETURN ROUND(
    GREATEST(0, -COALESCE((_p).balance, 0)) + COALESCE(_invoice_due, 0),
    2
  );
END;
$$;

-- SOURCE: 20260821100000_fix_cockroach_discharge_settlement.sql statement 2
CREATE OR REPLACE FUNCTION public.apply_wallet_to_outstanding(
  _patient_id uuid,
  _note text DEFAULT NULL::text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _p public.patients;
  _pct numeric;
  _credit numeric;
  _applied_total numeric := 0;
  _inv_id uuid;
  _inv_total numeric;
  _inv_paid numeric;
  _share numeric;
  _apply numeric;
BEGIN
  SELECT * INTO _p
  FROM public.patients
  WHERE id = _patient_id
  FOR UPDATE;

  IF _p IS NULL OR NOT public.has_wallet((_p).account_type) THEN
    RETURN 0;
  END IF;

  _credit := ROUND(GREATEST(COALESCE((_p).balance, 0), 0), 2);
  IF _credit <= 0 THEN
    RETURN 0;
  END IF;

  _pct := public.copay_percent((_p).account_type, (_p).insurance_plan);

  WHILE _credit > 0 LOOP
    _inv_id := NULL;
    _inv_total := NULL;
    _inv_paid := NULL;

    SELECT i.id, i.total_amount, COALESCE(i.paid_amount, 0)
    INTO _inv_id, _inv_total, _inv_paid
    FROM public.invoices i
    WHERE i.patient_id = _patient_id
      AND i.status IN ('pending', 'partial')
      AND ROUND(COALESCE(i.total_amount, 0) * _pct / 100.0, 2) > COALESCE(i.paid_amount, 0)
    ORDER BY i.created_at ASC, i.id ASC
    LIMIT 1;

    IF _inv_id IS NULL THEN
      _credit := 0;
    ELSE
      _share := ROUND(COALESCE(_inv_total, 0) * _pct / 100.0, 2);
      _apply := ROUND(LEAST(_credit, GREATEST(0, _share - COALESCE(_inv_paid, 0))), 2);
      IF _apply > 0 THEN
        UPDATE public.invoices
        SET paid_amount = COALESCE(_inv_paid, 0) + _apply,
            status = CASE
              WHEN COALESCE(_inv_paid, 0) + _apply >= _share THEN 'paid'
              ELSE 'partial'
            END,
            paid_at = CASE
              WHEN COALESCE(_inv_paid, 0) + _apply >= _share THEN now()
              ELSE paid_at
            END,
            payment_method = COALESCE(payment_method, 'wallet'),
            updated_at = now()
        WHERE id = _inv_id;

        SELECT public.adjust_patient_balance(
          _patient_id,
          -_apply,
          'invoice_deduction',
          'wallet',
          NULL,
          _inv_id,
          _note
        );

        _credit := ROUND(_credit - _apply, 2);
        _applied_total := ROUND(_applied_total + _apply, 2);
      ELSE
        _credit := 0;
      END IF;
    END IF;
  END LOOP;

  RETURN _applied_total;
END;
$$;

-- SOURCE: 20260821100000_fix_cockroach_discharge_settlement.sql statement 3
CREATE OR REPLACE FUNCTION public.admission_discharge_preview(_admission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _adm public.admissions;
  _p public.patients;
  _nights int;
  _rate numeric;
  _bed_total numeric;
  _pct numeric;
  _share numeric;
  _covered numeric;
  _bal numeric;
  _prior numeric;
  _already boolean;
  _gross numeric;
  _credit numeric;
  _applied numeric;
  _due numeric;
  _admitted_at timestamptz;
  _discharged_at timestamptz;
  _created_at timestamptz;
  _room_rate numeric;
  _wallet boolean;
BEGIN
  IF NOT public.has_any_role(
    public.hms_current_user_id(),
    ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','cashier','receptionist','admin']::app_role[]
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _adm
  FROM public.admissions
  WHERE id = _admission_id;
  IF _adm IS NULL THEN
    RAISE EXCEPTION 'Admission not found';
  END IF;

  SELECT * INTO _p
  FROM public.patients
  WHERE id = (_adm).patient_id;
  IF _p IS NULL THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;

  -- Inline bed-charge calculation. The legacy set-returning helper triggers
  -- CockroachDB's top-level relational-expression error when called here.
  SELECT a.admitted_at, a.discharged_at, a.created_at, r.daily_rate
  INTO _admitted_at, _discharged_at, _created_at, _room_rate
  FROM public.admissions a
  LEFT JOIN public.beds b ON b.id = a.bed_id
  LEFT JOIN public.rooms r ON r.id = b.room_id
  WHERE a.id = _admission_id;

  IF _created_at IS NULL THEN
    _nights := 0;
    _rate := 0;
    _bed_total := 0;
  ELSE
    _nights := GREATEST(
      0,
      (COALESCE(_discharged_at, now())::date - COALESCE(_admitted_at, _created_at)::date)
    )::int;
    IF _nights = 0 THEN
      _rate := 3000;
      _bed_total := 3000;
    ELSE
      _rate := COALESCE(_room_rate, 0);
      _bed_total := ROUND(_nights::numeric * _rate, 2);
    END IF;
  END IF;

  _pct := public.copay_percent((_p).account_type, (_p).insurance_plan);
  _share := ROUND(COALESCE(_bed_total, 0) * _pct / 100.0, 2);
  _covered := ROUND(GREATEST(0, COALESCE(_bed_total, 0) - _share), 2);

  SELECT EXISTS (
    SELECT 1
    FROM public.invoices i
    WHERE i.patient_id = (_adm).patient_id
      AND i.notes = 'BED_DAYS:' || _admission_id::text
  ) INTO _already;

  IF _already THEN
    _share := 0;
    _covered := 0;
  END IF;

  _wallet := public.has_wallet((_p).account_type);
  _bal := COALESCE((_p).balance, 0);
  _prior := public.patient_outstanding((_adm).patient_id);
  _gross := ROUND(_prior + _share, 2);
  _credit := CASE WHEN _wallet THEN ROUND(GREATEST(_bal, 0), 2) ELSE 0 END;
  _applied := ROUND(LEAST(_credit, _gross), 2);
  _due := ROUND(GREATEST(0, _gross - _applied), 2);

  RETURN jsonb_build_object(
    'admission_id', _admission_id,
    'patient_id', (_adm).patient_id,
    'admitted_at', COALESCE((_adm).admitted_at, (_adm).created_at),
    'account_type', (_p).account_type,
    'insurance_plan', (_p).insurance_plan,
    'has_wallet', _wallet,
    'nights', COALESCE(_nights, 0),
    'daily_rate', COALESCE(_rate, 0),
    'bed_total', COALESCE(_bed_total, 0),
    'bed_already_billed', _already,
    'copay_pct', _pct,
    'sponsor_covered', _covered,
    'bed_patient_share', _share,
    'current_balance', _bal,
    'prior_outstanding', _prior,
    'gross_total', _gross,
    'wallet_credit', _credit,
    'wallet_applied', _applied,
    'total_due', _due,
    'balance_after_bed', ROUND(_bal - _applied, 2)
  );
END;
$$;

-- SOURCE: 20260821100000_fix_cockroach_discharge_settlement.sql statement 4
CREATE OR REPLACE FUNCTION public.discharge_admission(
  _admission_id uuid,
  _notes text DEFAULT NULL::text,
  _settlement_method text DEFAULT NULL::text,
  _settlement_amount numeric DEFAULT 0,
  _settlement_notes text DEFAULT NULL::text,
  _refund_amount numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _adm public.admissions;
  _p public.patients;
  _wallet boolean;
  _debt numeric;
  _collected numeric := 0;
  _remaining numeric := 0;
  _left numeric := 0;
  _applied numeric := 0;
  _pct numeric;
  _wallet_used numeric := 0;
  _refund numeric := 0;
  _credit numeric := 0;
  _debt_cleared numeric := 0;
  _journey public.patient_journey;
  _journey_id uuid;
  _inv_id uuid;
  _inv_total numeric;
  _inv_paid numeric;
  _share numeric;
  _due numeric;
  _apply numeric;
  _pending_station text;
BEGIN
  IF NOT public.has_any_role(
    public.hms_current_user_id(),
    ARRAY['cashier','billing','accountant','receptionist','admin']::app_role[]
  ) THEN
    RAISE EXCEPTION 'Only the cashier or reception can settle and complete a discharge';
  END IF;

  SELECT * INTO _adm
  FROM public.admissions
  WHERE id = _admission_id
  FOR UPDATE;

  IF _adm IS NULL THEN
    RAISE EXCEPTION 'Admission not found';
  END IF;
  IF (_adm).status = 'discharged' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was already settled and discharged on %',
      COALESCE(to_char((_adm).discharged_at, 'DD Mon YYYY HH24:MI'), 'an earlier date');
  END IF;
  IF (_adm).status = 'cancelled' THEN
    RAISE EXCEPTION 'ADMISSION_CANCELLED: this admission was cancelled and cannot be settled';
  END IF;
  IF (_adm).status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'NOT_IN_CASHIER_QUEUE: the ward has not confirmed this discharge yet (%)', (_adm).status;
  END IF;

  -- Do this safety check before billing or wallet mutations. Pending clinical
  -- work must be completed by Billing/Lab/Pharmacy before discharge settlement.
  SELECT public.patient_pending_workflow_station((_adm).patient_id)
  INTO _pending_station;
  IF _pending_station IS NOT NULL THEN
    RAISE EXCEPTION 'PENDING_WORKFLOW: complete % work before discharge settlement',
      CASE _pending_station
        WHEN 'awaiting_billing' THEN 'Billing'
        WHEN 'awaiting_payment' THEN 'Cashier payment'
        WHEN 'in_lab' THEN 'Laboratory'
        WHEN 'at_pharmacy' THEN 'Pharmacy'
        ELSE _pending_station
      END;
  END IF;

  SELECT public.bill_admission_bed_days(_admission_id);
  _wallet_used := public.apply_wallet_to_outstanding(
    (_adm).patient_id,
    'Balance applied at discharge'
  );

  SELECT * INTO _p
  FROM public.patients
  WHERE id = (_adm).patient_id
  FOR UPDATE;

  _wallet := public.has_wallet((_p).account_type);
  _pct := public.copay_percent((_p).account_type, (_p).insurance_plan);
  _debt := public.patient_outstanding((_adm).patient_id);
  _remaining := _debt;

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash', 'pos', 'transfer') THEN
      _collected := ROUND(GREATEST(COALESCE(_settlement_amount, 0), 0), 2);
      IF _collected <= 0 THEN
        RAISE EXCEPTION 'Settlement amount must be greater than zero';
      END IF;
      IF _wallet AND (_p).balance < 0 THEN
        _debt_cleared := ROUND(LEAST(_collected, -(_p).balance), 2);
        SELECT public.adjust_patient_balance((_adm).patient_id, _debt_cleared, 'debt_cleared', _settlement_method, NULL, NULL, COALESCE(_settlement_notes)
        );
      END IF;
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
    ELSIF _settlement_method = 'salary' THEN
      IF (_p).staff_link_id IS NULL THEN
        RAISE EXCEPTION 'STAFF_LINK_REQUIRED: this patient is not linked to any staff member for salary deduction';
      END IF;
      _remaining := 0;
    ELSIF _settlement_method = 'carry' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  _left := CASE
    WHEN _settlement_method IN ('cash', 'pos', 'transfer')
      THEN ROUND(GREATEST(0, _collected - _debt_cleared), 2)
    WHEN _settlement_method = 'salary' THEN _debt
    ELSE 0
  END;

  -- Allocate cash/salary settlement to the oldest unpaid patient shares.
  -- This loop is intentionally procedural: CockroachDB rejects the former
  -- correlated window/CTE expression with "top-level relational expression
  -- cannot have outer columns".
  IF _left > 0 THEN
    WHILE _left > 0 LOOP
      _inv_id := NULL;
      _inv_total := NULL;
      _inv_paid := NULL;

      SELECT i.id, i.total_amount, COALESCE(i.paid_amount, 0)
      INTO _inv_id, _inv_total, _inv_paid
      FROM public.invoices i
      WHERE i.patient_id = (_adm).patient_id
        AND i.status IN ('pending', 'partial')
        AND ROUND(COALESCE(i.total_amount, 0) * _pct / 100.0, 2) > COALESCE(i.paid_amount, 0)
      ORDER BY i.created_at ASC, i.id ASC
      LIMIT 1;

      IF _inv_id IS NULL THEN
        _left := 0;
      ELSE
        _share := ROUND(COALESCE(_inv_total, 0) * _pct / 100.0, 2);
        _due := GREATEST(_share - COALESCE(_inv_paid, 0), 0);
        _apply := ROUND(LEAST(_left, _due), 2);
        IF _apply > 0 THEN
          UPDATE public.invoices
          SET paid_amount = COALESCE(_inv_paid, 0) + _apply,
              status = CASE
                WHEN COALESCE(_inv_paid, 0) + _apply >= _share THEN 'paid'
                ELSE 'partial'
              END,
              paid_at = CASE
                WHEN COALESCE(_inv_paid, 0) + _apply >= _share THEN now()
                ELSE paid_at
              END,
              payment_method = COALESCE(payment_method, _settlement_method),
              is_salary_deduction = CASE
                WHEN _settlement_method = 'salary' THEN true
                ELSE is_salary_deduction
              END,
              staff_sponsor_id = CASE
                WHEN _settlement_method = 'salary' THEN (_p).staff_link_id
                ELSE staff_sponsor_id
              END,
              updated_at = now()
          WHERE id = _inv_id;

          _left := ROUND(_left - _apply, 2);
          _applied := ROUND(_applied + _apply, 2);
        ELSE
          _left := 0;
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF _wallet AND _left > 0 AND _settlement_method IN ('cash', 'pos', 'transfer') THEN
    SELECT public.adjust_patient_balance(
      (_adm).patient_id,
      _left,
      'topup',
      _settlement_method,
      NULL,
      NULL,
      'Change from discharge settlement left on balance'
    );
    _credit := _left;
  END IF;

  _refund := ROUND(GREATEST(COALESCE(_refund_amount, 0), 0), 2);
  IF _refund > 0 THEN
    IF NOT _wallet THEN
      RAISE EXCEPTION 'Sponsored accounts have no wallet to refund from';
    END IF;
    SELECT * INTO _p
    FROM public.patients
    WHERE id = (_adm).patient_id
    FOR UPDATE;
    IF _refund > (_p).balance THEN
      RAISE EXCEPTION 'Refund % exceeds available balance %', _refund, (_p).balance;
    END IF;
    SELECT public.adjust_patient_balance(
      (_adm).patient_id,
      -_refund,
      'refund',
      _settlement_method,
      NULL,
      NULL,
      'Change paid out at discharge'
    );
  END IF;

  UPDATE public.admissions
  SET status = 'discharged',
      discharged_at = now(),
      discharged_by = public.hms_current_user_id(),
      discharge_notes = COALESCE(_notes, discharge_notes),
      updated_at = now()
  WHERE id = _admission_id
    AND status = 'ready_for_discharge';

  IF (_adm).status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was settled by someone else — refresh the queue';
  END IF;

  UPDATE public.visits
  SET status = 'settled',
      closed_at = COALESCE(closed_at, now()),
      closed_by = COALESCE(closed_by, public.hms_current_user_id()),
      updated_at = now()
  WHERE id = (_adm).visit_id
    AND status <> 'settled';

  IF (_adm).bed_id IS NOT NULL THEN
    UPDATE public.beds
    SET status = 'available', updated_at = now()
    WHERE id = (_adm).bed_id;
  END IF;

  SELECT * INTO _journey
  FROM public.patient_journey
  WHERE patient_id = (_adm).patient_id
  FOR UPDATE;

  IF (_journey).id IS NULL THEN
    INSERT INTO public.patient_journey (
      patient_id, visit_id, current_state, owner_role, owner_user_id
    ) VALUES (
      (_adm).patient_id, (_adm).visit_id, 'discharged', 'reception', NULL
    )
    RETURNING id INTO _journey_id;

    INSERT INTO public.patient_journey_history (
      journey_id, patient_id, visit_id, from_state, to_state,
      from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
      reason
    ) VALUES (
      _journey_id, (_adm).patient_id, (_adm).visit_id, NULL, 'discharged',
      NULL, 'reception', NULL, NULL,
      'Inpatient cashier settlement completed'
    );
  ELSE
    UPDATE public.patient_journey
    SET visit_id = COALESCE((_adm).visit_id, (_journey).visit_id),
        current_state = 'discharged',
        owner_role = 'reception',
        owner_user_id = NULL,
        updated_at = now()
    WHERE id = (_journey).id;

    INSERT INTO public.patient_journey_history (
      journey_id, patient_id, visit_id, from_state, to_state,
      from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
      reason
    ) VALUES (
      (_journey).id, (_adm).patient_id, COALESCE((_adm).visit_id, (_journey).visit_id),
      (_journey).current_state, 'discharged',
      (_journey).owner_role, 'reception', (_journey).owner_user_id, NULL,
      'Inpatient cashier settlement completed'
    );
  END IF;

  UPDATE public.patients
  SET status = 'discharged', updated_at = now()
  WHERE id = (_adm).patient_id;

  SELECT public.write_audit_log(
    'admission_discharged',
    'admission',
    _admission_id::text,
    jsonb_build_object(
      'patient_id', (_adm).patient_id,
      'notes', _notes,
      'debt', _debt,
      'wallet_applied', _wallet_used,
      'collected', _collected,
      'debt_cleared', _debt_cleared,
      'outstanding', _remaining,
      'credit_left', _credit,
      'refunded', _refund,
      'method', _settlement_method
    ),
    'success'
  );

  RETURN jsonb_build_object(
    'debt', _debt,
    'wallet_applied', _wallet_used,
    'collected', _collected,
    'outstanding', _remaining,
    'credit_left', _credit,
    'refunded', _refund
  );
END;
$$;

-- SOURCE: 20260821100000_fix_cockroach_discharge_settlement.sql statement 5
CREATE OR REPLACE FUNCTION public.bill_admission_bed_days(_admission_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _adm public.admissions;
  _p public.patients;
  _room_class text;
  _admitted_at timestamptz;
  _discharged_at timestamptz;
  _created_at timestamptz;
  _room_rate numeric;
  _days int;
  _rate numeric;
  _amount numeric;
  _pct numeric;
  _copay numeric;
  _inv uuid;
  _bal numeric;
  _from_wallet numeric;
  _debt numeric;
  _item_desc text;
BEGIN
  SELECT * INTO _adm
  FROM public.admissions
  WHERE id = _admission_id;
  IF _adm IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO _p
  FROM public.patients
  WHERE id = (_adm).patient_id;
  IF _p IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT a.admitted_at, a.discharged_at, a.created_at, r.daily_rate
  INTO _admitted_at, _discharged_at, _created_at, _room_rate
  FROM public.admissions a
  LEFT JOIN public.beds b ON b.id = a.bed_id
  LEFT JOIN public.rooms r ON r.id = b.room_id
  WHERE a.id = _admission_id;
  IF _created_at IS NULL THEN
    RETURN NULL;
  END IF;

  _days := GREATEST(
    0,
    (COALESCE(_discharged_at, now())::date - COALESCE(_admitted_at, _created_at)::date)
  )::int;
  IF _days = 0 THEN
    _rate := 3000;
    _amount := 3000;
  ELSE
    _rate := COALESCE(_room_rate, 0);
    _amount := ROUND(_days::numeric * _rate, 2);
  END IF;
  IF COALESCE(_amount, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT id INTO _inv
  FROM public.invoices
  WHERE patient_id = (_adm).patient_id
    AND notes = 'BED_DAYS:' || _admission_id::text
  LIMIT 1;
  IF _inv IS NOT NULL THEN
    RETURN _inv;
  END IF;

  _pct := public.copay_percent((_p).account_type, (_p).insurance_plan);
  _copay := ROUND((_amount * _pct) / 100.0, 2);
  SELECT r.room_class
  INTO _room_class
  FROM public.beds b
  JOIN public.rooms r ON r.id = b.room_id
  WHERE b.id = (_adm).bed_id;

  INSERT INTO public.invoices(
    patient_id, visit_id, total_amount, original_amount, discount_amount,
    paid_amount, status, sponsor_type, corporate_account_id, notes
  ) VALUES (
    (_adm).patient_id, (_adm).visit_id, _amount, _amount, 0, 0, 'pending',
    CASE WHEN _pct < 100 THEN (_p).account_type ELSE NULL END,
    NULLIF((NULLIF(((_p).corporate_id)::STRING, '')::UUID)::text, '')::uuid,
    'BED_DAYS:' || _admission_id::text
  ) RETURNING id INTO _inv;

  IF _days = 0 THEN
    _item_desc := 'Observation fee (same-day discharge)';
  ELSE
    _item_desc := 'Bed charge - ' || COALESCE(_room_class, 'ward') ||
      ' - ' || _days || ' night(s)';
  END IF;
  INSERT INTO public.invoice_items(
    invoice_id, description, quantity, unit_price, total, category
  ) VALUES (
    _inv, _item_desc, CASE WHEN _days = 0 THEN 1 ELSE _days END,
    _rate, _amount, 'admission'
  );

  -- A fully sponsored admission has no patient share. Marking this invoice
  -- paid with a zero collection is required before the journey-discharge
  -- trigger runs; otherwise the new invoice remains pending and blocks the
  -- otherwise valid discharge transition.
  IF _copay = 0 THEN
    UPDATE public.invoices
    SET paid_amount = 0,
        status = 'paid',
        paid_at = now(),
        payment_method = 'sponsor',
        updated_at = now()
    WHERE id = _inv;
  END IF;

  IF _copay > 0 THEN
    SELECT balance INTO _bal
    FROM public.patients
    WHERE id = (_adm).patient_id
    FOR UPDATE;
    _from_wallet := ROUND(LEAST(GREATEST(COALESCE(_bal, 0), 0), _copay), 2);
    _debt := ROUND(_copay - _from_wallet, 2);
    IF _from_wallet > 0 THEN
      SELECT public.adjust_patient_balance(
        (_adm).patient_id, -_from_wallet, 'invoice_deduction', NULL,
        NULL, _inv,
        CASE WHEN _days = 0 THEN 'Observation fee for admission'
          ELSE 'Bed charge for admission (' || _days || ' night(s))' END
      );
    END IF;
    IF _debt > 0 THEN
      SELECT public.adjust_patient_balance(
        (_adm).patient_id, -_debt, 'debt_incurred', NULL,
        NULL, _inv,
        CASE WHEN _days = 0 THEN 'Observation fee shortfall on discharge'
          ELSE 'Bed charge shortfall on discharge (' || _days || ' night(s))' END
      );
    END IF;
    UPDATE public.invoices
    SET paid_amount = _from_wallet,
        status = CASE
          WHEN _from_wallet >= _amount THEN 'paid'
          WHEN _from_wallet > 0 THEN 'partial'
          ELSE 'pending'
        END,
        paid_at = CASE WHEN _from_wallet >= _amount THEN now() ELSE NULL END
    WHERE id = _inv;
  END IF;

  RETURN _inv;
END;
$$;

-- SOURCE: 20260821120000_admin_balances_cancel_settlement.sql statement 1
CREATE OR REPLACE FUNCTION public.admin_patient_balance_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _uid UUID := public.hms_current_user_id();
  _result JSONB;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT jsonb_build_object(
    'patient_count', COUNT(*)::INT,
    'patients_with_credit', COUNT(*) FILTER (WHERE COALESCE(balance, 0) > 0)::INT,
    'patients_with_debt', COUNT(*) FILTER (WHERE COALESCE(balance, 0) < 0)::INT,
    'total_balance', COALESCE(SUM(COALESCE(balance, 0)), 0),
    'total_wallet_credit', COALESCE(SUM(CASE WHEN COALESCE(balance, 0) > 0 THEN balance ELSE 0 END), 0),
    'total_wallet_debt', COALESCE(SUM(CASE WHEN COALESCE(balance, 0) < 0 THEN ABS(balance) ELSE 0 END), 0),
    'generated_at', now()
  )
  INTO _result
  FROM public.patients;

  RETURN _result;
END;
$$;

-- SOURCE: 20260821120000_admin_balances_cancel_settlement.sql statement 2
CREATE OR REPLACE FUNCTION public.admin_daily_wallet_balance_summary(_day DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _uid UUID := public.hms_current_user_id();
  _result JSONB;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['admin','accountant']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Balance transactions are signed: topups are positive and deductions/debt
  -- are negative. Summing through the end of the selected day gives the
  -- wallet position at that day’s close, independent of the current balance.
  WITH closing AS (
    SELECT
      p.id,
      COALESCE(SUM(bt.amount), 0) AS closing_balance
    FROM public.patients p
    LEFT JOIN public.balance_transactions bt
      ON bt.patient_id = p.id
     AND bt.created_at < ((_day + 1)::DATE)::TIMESTAMPTZ
    GROUP BY p.id
  )
  SELECT jsonb_build_object(
    'date', _day,
    'patients_with_credit', COUNT(*) FILTER (WHERE closing_balance > 0)::INT,
    'patients_with_debt', COUNT(*) FILTER (WHERE closing_balance < 0)::INT,
    'total_balance', COALESCE(SUM(closing_balance), 0),
    'total_wallet_credit', COALESCE(SUM(CASE WHEN closing_balance > 0 THEN closing_balance ELSE 0 END), 0),
    'total_wallet_debt', COALESCE(SUM(CASE WHEN closing_balance < 0 THEN ABS(closing_balance) ELSE 0 END), 0),
    'generated_at', now()
  )
  INTO _result
  FROM closing;

  RETURN _result;
END;
$$;

-- SOURCE: 20260821120000_admin_balances_cancel_settlement.sql statement 3
REVOKE ALL ON FUNCTION public.admin_patient_balance_summary() FROM PUBLIC, anon;

-- SOURCE: 20260821120000_admin_balances_cancel_settlement.sql statement 4
GRANT EXECUTE ON FUNCTION public.admin_patient_balance_summary() TO authenticated, service_role;

-- SOURCE: 20260821120000_admin_balances_cancel_settlement.sql statement 5
REVOKE ALL ON FUNCTION public.admin_daily_wallet_balance_summary(DATE) FROM PUBLIC, anon;

-- SOURCE: 20260821120000_admin_balances_cancel_settlement.sql statement 6
GRANT EXECUTE ON FUNCTION public.admin_daily_wallet_balance_summary(DATE) TO authenticated, service_role;

-- SOURCE: 20260821120000_admin_balances_cancel_settlement.sql statement 7
CREATE OR REPLACE FUNCTION public.cancel_admission_discharge(
  _admission_id UUID,
  _reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _uid UUID := public.hms_current_user_id();
  _adm public.admissions;
  _journey_id UUID;
  _why TEXT := NULLIF(TRIM(COALESCE(_reason, '')), '');
BEGIN
  IF NOT public.has_any_role(
    _uid,
    ARRAY['cashier','receptionist','billing','accountant','admin']::app_role[]
  ) THEN
    RAISE EXCEPTION 'Only Cashier/Reception or an administrator can cancel a pending discharge settlement';
  END IF;

  SELECT *
    INTO _adm
    FROM public.admissions
   WHERE id = _admission_id
   FOR UPDATE;

  IF (_adm).id IS NULL THEN
    RAISE EXCEPTION 'Admission not found';
  END IF;

  IF (_adm).status = 'discharged' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: a completed settlement cannot be cancelled';
  END IF;

  IF (_adm).status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'NOT_IN_CASHIER_QUEUE: this admission is currently %', (_adm).status;
  END IF;

  -- The admission is still ready_for_discharge, so discharge_admission has
  -- not committed any invoice, wallet, visit, or bed mutation. Reversing only
  -- the queue marker is therefore safe and leaves the patient admitted.
  UPDATE public.admissions
     SET status = 'active',
         ready_for_discharge_at = NULL,
         ready_for_discharge_by = NULL,
         discharge_order_snap_id = NULL,
         updated_at = now()
   WHERE id = _admission_id;

  _journey_id := public.advance_journey(
    (_adm).patient_id,
    'admitted',
    'nurse',
    NULL,
    'ward',
    'ward',
    (_adm).visit_id,
    COALESCE(_why, 'Cashier settlement cancelled; patient returned to ward')
  );

  SELECT public.write_audit_log('discharge_settlement_cancelled', 'admission', _admission_id::TEXT, jsonb_build_object(
      'patient_id', (_adm).patient_id,
      'visit_id', (_adm).visit_id,
      'reason', _why,
      'returned_to_status', 'active',
      'journey_id', _journey_id
    )
  , 'success');

  RETURN jsonb_build_object(
    'admission_id', _admission_id,
    'patient_id', (_adm).patient_id,
    'status', 'active',
    'journey_id', _journey_id,
    'message', 'Settlement cancelled; patient remains admitted'
  );
END;
$$;

-- SOURCE: 20260821120000_admin_balances_cancel_settlement.sql statement 8
REVOKE ALL ON FUNCTION public.cancel_admission_discharge(UUID, TEXT) FROM PUBLIC, anon;

-- SOURCE: 20260821120000_admin_balances_cancel_settlement.sql statement 9
GRANT EXECUTE ON FUNCTION public.cancel_admission_discharge(UUID, TEXT) TO authenticated, service_role;

-- SOURCE: 20260821130000_deceased_admission_workflow.sql statement 1
ALTER TABLE public.admissions
  ADD COLUMN IF NOT EXISTS death_reported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS death_reported_by UUID,
  ADD COLUMN IF NOT EXISTS death_report_notes TEXT,
  ADD COLUMN IF NOT EXISTS death_finalized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS death_finalized_by UUID;

-- SOURCE: 20260821130000_deceased_admission_workflow.sql statement 2
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS deceased_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deceased_notes TEXT;

-- SOURCE: 20260821130000_deceased_admission_workflow.sql statement 3
CREATE INDEX IF NOT EXISTS idx_admissions_death_reported
  ON public.admissions (death_reported_at)
  WHERE death_reported_at IS NOT NULL;

-- SOURCE: 20260821130000_deceased_admission_workflow.sql statement 4
CREATE OR REPLACE FUNCTION public.report_admission_death(
  _admission_id UUID,
  _death_at TIMESTAMPTZ DEFAULT NULL::TIMESTAMPTZ,
  _notes TEXT DEFAULT NULL::TEXT
)
RETURNS JSONB
LANGUAGE PLPGSQL
SECURITY DEFINER
AS $$
DECLARE
  _uid UUID := public.hms_current_user_id();
  _adm public.admissions;
  _journey_id UUID;
  _when TIMESTAMPTZ := COALESCE(_death_at, now());
BEGIN
  IF NOT public.has_any_role(
    _uid,
    ARRAY['nurse','doctor1','doctor2','admin']::app_role[]
  ) THEN
    RAISE EXCEPTION 'Only Nurse, Doctor, or Admin can report a patient death';
  END IF;

  IF _when > now() THEN
    RAISE EXCEPTION 'Death time cannot be in the future';
  END IF;

  SELECT * INTO _adm
  FROM public.admissions
  WHERE id = _admission_id
  FOR UPDATE;

  IF _adm IS NULL THEN
    RAISE EXCEPTION 'Admission not found';
  END IF;
  IF (_adm).status = 'discharged' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission is already completed';
  END IF;
  IF (_adm).status = 'cancelled' THEN
    RAISE EXCEPTION 'ADMISSION_CANCELLED: this admission cannot receive a death report';
  END IF;
  IF (_adm).death_reported_at IS NOT NULL THEN
    RAISE EXCEPTION 'DEATH_ALREADY_REPORTED: this admission is already awaiting final settlement';
  END IF;

  UPDATE public.admissions
  SET death_reported_at = _when,
      death_reported_by = _uid,
      death_report_notes = NULLIF(btrim(COALESCE(_notes, '')), ''),
      updated_at = now()
  WHERE id = _admission_id;

  SELECT public.advance_journey(
    (_adm).patient_id,
    'admitted',
    'nurse',
    NULL,
    'ward',
    'ward',
    (_adm).visit_id,
    'Death reported; awaiting final Cashier settlement'
  ) INTO _journey_id;

  SELECT public.write_audit_log(
    'admission_death_reported',
    'admission',
    _admission_id::TEXT,
    jsonb_build_object(
      'patient_id', (_adm).patient_id,
      'visit_id', (_adm).visit_id,
      'death_at', _when,
      'reported_by', _uid,
      'notes', _notes,
      'journey_id', _journey_id
    ),
    'success'
  );

  RETURN jsonb_build_object(
    'admission_id', _admission_id,
    'patient_id', (_adm).patient_id,
    'status', (_adm).status,
    'death_reported_at', _when,
    'journey_id', _journey_id,
    'message', 'Death reported; patient remains in the ward until final settlement'
  );
END;
$$;

-- SOURCE: 20260821130000_deceased_admission_workflow.sql statement 5
GRANT EXECUTE ON FUNCTION public.report_admission_death(UUID, TIMESTAMPTZ, TEXT) TO authenticated;

-- SOURCE: 20260821130000_deceased_admission_workflow.sql statement 6
GRANT EXECUTE ON FUNCTION public.report_admission_death(UUID, TIMESTAMPTZ, TEXT) TO service_role;

-- SOURCE: 20260821130000_deceased_admission_workflow.sql statement 7
CREATE OR REPLACE FUNCTION public.finalize_deceased_admission(
  _admission_id UUID,
  _notes TEXT DEFAULT NULL::TEXT,
  _settlement_method TEXT DEFAULT NULL::TEXT,
  _settlement_amount NUMERIC DEFAULT 0,
  _settlement_notes TEXT DEFAULT NULL::TEXT,
  _refund_amount NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE PLPGSQL
SECURITY DEFINER
AS $$
DECLARE
  _uid UUID := public.hms_current_user_id();
  _adm public.admissions;
  _result JSONB;
  _journey_id UUID;
BEGIN
  IF NOT public.has_any_role(
    _uid,
    ARRAY['receptionist','cashier','billing','accountant','admin']::app_role[]
  ) THEN
    RAISE EXCEPTION 'Only Cashier/Reception, Billing, Accountant, or Admin can finalize a deceased admission';
  END IF;

  SELECT * INTO _adm
  FROM public.admissions
  WHERE id = _admission_id
  FOR UPDATE;

  IF _adm IS NULL THEN
    RAISE EXCEPTION 'Admission not found';
  END IF;
  IF (_adm).death_reported_at IS NULL THEN
    RAISE EXCEPTION 'NOT_DEATH_REPORTED: report the patient death from the ward first';
  END IF;
  IF (_adm).status = 'discharged' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission already has a final state';
  END IF;
  IF (_adm).status = 'cancelled' THEN
    RAISE EXCEPTION 'ADMISSION_CANCELLED: this admission cannot be finalized';
  END IF;

  -- Put the locked admission into the same queue state expected by the
  -- already-tested discharge routine. If that routine fails, this transaction
  -- rolls back and the bed/admission remain unchanged.
  UPDATE public.admissions
  SET status = 'ready_for_discharge',
      ready_for_discharge_at = now(),
      ready_for_discharge_by = _uid,
      discharge_notes = COALESCE(_notes, discharge_notes),
      updated_at = now()
  WHERE id = _admission_id
    AND status = 'active';

  IF NOT EXISTS (
    SELECT 1
    FROM public.admissions
    WHERE id = _admission_id
      AND status = 'ready_for_discharge'
      AND ready_for_discharge_by = _uid
  ) THEN
    RAISE EXCEPTION 'DEATH_SETTLEMENT_BUSY: this admission is being processed; refresh and try again';
  END IF;

  SELECT public.discharge_admission(
    _admission_id,
    COALESCE(_notes, 'Final settlement after patient death'),
    _settlement_method,
    _settlement_amount,
    _settlement_notes,
    _refund_amount
  ) INTO _result;

  UPDATE public.admissions
  SET death_finalized_at = now(),
      death_finalized_by = _uid,
      discharge_notes = COALESCE(_notes, discharge_notes),
      updated_at = now()
  WHERE id = _admission_id;

  UPDATE public.patients
  SET status = 'discharged',
      deceased_at = COALESCE(deceased_at, (_adm).death_reported_at),
      deceased_notes = COALESCE(deceased_notes, (_adm).death_report_notes),
      updated_at = now()
  WHERE id = (_adm).patient_id;

  SELECT id INTO _journey_id
  FROM public.patient_journey
  WHERE patient_id = (_adm).patient_id;

  SELECT public.write_audit_log(
    'admission_death_finalized',
    'admission',
    _admission_id::TEXT,
    jsonb_build_object(
      'patient_id', (_adm).patient_id,
      'visit_id', (_adm).visit_id,
      'death_reported_at', (_adm).death_reported_at,
      'finalized_by', _uid,
      'settlement', _result,
      'journey_id', _journey_id,
      'archive_ready_after_eligibility_check', true
    ),
    'success'
  );

  RETURN COALESCE(_result, '{}'::JSONB) || jsonb_build_object(
    'admission_id', _admission_id,
    'patient_id', (_adm).patient_id,
    'outcome', 'deceased',
    'death_finalized_at', now(),
    'message', 'Final death settlement completed; bed released and patient is archive-eligible'
  );
END;
$$;

-- SOURCE: 20260821130000_deceased_admission_workflow.sql statement 8
GRANT EXECUTE ON FUNCTION public.finalize_deceased_admission(UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC) TO authenticated;

-- SOURCE: 20260821130000_deceased_admission_workflow.sql statement 9
GRANT EXECUTE ON FUNCTION public.finalize_deceased_admission(UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC) TO service_role;

-- SOURCE: 20260821130000_deceased_admission_workflow.sql statement 10
CREATE OR REPLACE FUNCTION public.mark_ready_for_discharge(
  _admission_id UUID,
  _snap_id UUID DEFAULT NULL::UUID,
  _note TEXT DEFAULT NULL::TEXT
)
RETURNS VOID
LANGUAGE PLPGSQL
SECURITY DEFINER
AS $$
DECLARE
  _uid UUID := public.hms_current_user_id();
  _adm public.admissions;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only doctors can create a discharge order';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF (_adm).death_reported_at IS NOT NULL THEN
    RAISE EXCEPTION 'DEATH_REPORTED: use the deceased final-settlement queue instead';
  END IF;
  IF (_adm).status <> 'active' THEN
    RAISE EXCEPTION 'Admission is not active (%)', (_adm).status;
  END IF;

  UPDATE public.admissions
  SET status = 'ready_for_discharge',
      ready_for_discharge_at = now(),
      ready_for_discharge_by = _uid,
      discharge_order_snap_id = _snap_id,
      discharge_notes = COALESCE(_note, discharge_notes),
      updated_at = now()
  WHERE id = _admission_id;

  SELECT public.write_audit_log(
    'discharge_order_signed', 'admission', _admission_id::TEXT,
    jsonb_build_object('patient_id', (_adm).patient_id, 'snap_id', _snap_id, 'note', _note),
    'success'
  );
END;
$$;

-- SOURCE: 20260821130000_deceased_admission_workflow.sql statement 11
GRANT EXECUTE ON FUNCTION public.mark_ready_for_discharge(UUID, UUID, TEXT) TO authenticated;

-- SOURCE: 20260821130000_deceased_admission_workflow.sql statement 12
GRANT EXECUTE ON FUNCTION public.mark_ready_for_discharge(UUID, UUID, TEXT) TO service_role;
