-- CockroachDB compatibility repair for cashier, lab results, and billing JSONB writes
-- Generated from read-only live routine definitions; review before applying to another database.

ALTER TABLE public.snap_orders ADD COLUMN IF NOT EXISTS result_text STRING;
COMMENT ON COLUMN public.snap_orders.result_text IS 'Typed laboratory result returned to the requesting clinical station';
CREATE INDEX IF NOT EXISTS idx_snap_orders_result_text ON public.snap_orders (result_text) WHERE result_text IS NOT NULL;
ALTER TABLE public.patients DROP CONSTRAINT IF EXISTS check_balance_non_negative;
ALTER TABLE public.balance_transactions DROP CONSTRAINT IF EXISTS check_transaction_type;
ALTER TABLE public.balance_transactions DROP CONSTRAINT IF EXISTS balance_transactions_transaction_type_check;
ALTER TABLE public.balance_transactions ADD CONSTRAINT balance_transactions_transaction_type_check CHECK (transaction_type IN ('topup','refund','invoice_deduction','staff_family_coverage','staff_coverage','adjustment','debt_incurred','debt_cleared','admitted_deduction','overpayment_credit','manual_adjustment'));

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

CREATE OR REPLACE FUNCTION public.enforce_patient_field_permissions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$DECLARE
_uid UUID := public.hms_current_user_id();
_old JSONB := to_jsonb(old);
_new JSONB := to_jsonb(new);
_identity_cols STRING[] := ARRAY['first_name', 'last_name', 'date_of_birth', 'gender', 'phone', 'address', 'emergency_contact', 'occupation', 'photo_path'];
_card_cols STRING[] := ARRAY['card_number', 'mini_card_number'];
_sponsor_cols STRING[] := ARRAY['account_type', 'corporate_id', 'insurance_provider', 'insurance_plan', 'insurance_policy_number', 'enrollee_id', 'member_id_data', 'staff_link_id'];
_clinical_cols STRING[] := ARRAY['blood_group', 'allergies'];
BEGIN
IF _uid IS NULL THEN
	RETURN new;
END IF;
IF public.has_role(_uid, 'admin'::app_role) THEN
	RETURN new;
END IF;
IF EXISTS (SELECT 1 FROM ROWS FROM (jsonb_object_keys(_new)) AS changed (key) WHERE ((_new->changed.key) IS DISTINCT FROM (_old->changed.key)) AND (changed.key = ANY (_identity_cols))) THEN
	IF NOT public.has_role(_uid, 'receptionist'::app_role) THEN
	RAISE EXCEPTION 'NOT_PERMITTED: only reception or an admin can change patient personal details';
END IF;
ELSIF EXISTS (SELECT 1 FROM ROWS FROM (jsonb_object_keys(_new)) AS changed (key) WHERE ((_new->changed.key) IS DISTINCT FROM (_old->changed.key)) AND (changed.key = ANY (_card_cols))) THEN
	RAISE EXCEPTION 'NOT_PERMITTED: only an admin can change patient card numbers';
ELSIF EXISTS (SELECT 1 FROM ROWS FROM (jsonb_object_keys(_new)) AS changed (key) WHERE ((_new->changed.key) IS DISTINCT FROM (_old->changed.key)) AND (changed.key = ANY (_sponsor_cols))) THEN
	IF NOT public.has_any_role(_uid, ARRAY['receptionist', 'billing', 'accountant', 'claims_manager']::app_role[]) THEN
	RAISE EXCEPTION 'NOT_PERMITTED: only reception, billing, accounts or claims staff can change sponsor/insurance details';
END IF;
ELSIF EXISTS (SELECT 1 FROM ROWS FROM (jsonb_object_keys(_new)) AS changed (key) WHERE ((_new->changed.key) IS DISTINCT FROM (_old->changed.key)) AND (changed.key = ANY (_clinical_cols))) THEN
	IF NOT public.has_any_role(_uid, ARRAY['nurse', 'doctor', 'doctor1', 'doctor2', 'anc']::app_role[]) THEN
	RAISE EXCEPTION 'NOT_PERMITTED: only clinical staff can change clinical details';
END IF;
ELSIF EXISTS (SELECT 1 FROM ROWS FROM (jsonb_object_keys(_new)) AS changed (key) WHERE ((_new->changed.key) IS DISTINCT FROM (_old->changed.key)) AND (changed.key = 'balance')) THEN
	IF (COALESCE(current_setting('application_name', true), '') != 'hms-balance-write') AND (NOT public.has_any_role(_uid, ARRAY['billing', 'cashier', 'accountant']::app_role[])) THEN
	RAISE EXCEPTION 'NOT_PERMITTED: patient balance can only be changed by billing/cashier/accounts or through a payment routine';
END IF;
END IF;
RETURN new;
END;
$$;
