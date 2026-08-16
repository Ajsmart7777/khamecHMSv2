-- SOURCE: 20260725174145_83d0fef0-77af-4387-b998-b96cea14b4e5.sql statement 1
ALTER TABLE public.corporate_accounts ALTER COLUMN contact_person DROP NOT NULL;

-- SOURCE: 20260725174145_83d0fef0-77af-4387-b998-b96cea14b4e5.sql statement 2
ALTER TABLE public.corporate_accounts ALTER COLUMN email DROP NOT NULL;

-- SOURCE: 20260725174145_83d0fef0-77af-4387-b998-b96cea14b4e5.sql statement 3
CREATE TABLE public.corporate_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id UUID NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('deposit','monthly_deduction','refund','adjustment','debt_incurred')),
  amount NUMERIC(14,2) NOT NULL,
  balance_before NUMERIC(14,2) NOT NULL,
  balance_after NUMERIC(14,2) NOT NULL,
  related_statement_id UUID REFERENCES public.sponsor_statements(id) ON DELETE SET NULL,
  notes TEXT,
  performed_by UUID REFERENCES neon_auth.user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE: 20260725174145_83d0fef0-77af-4387-b998-b96cea14b4e5.sql statement 4
GRANT SELECT, INSERT ON public.corporate_transactions TO authenticated;

-- SOURCE: 20260725174145_83d0fef0-77af-4387-b998-b96cea14b4e5.sql statement 5
GRANT ALL ON public.corporate_transactions TO service_role;

-- SOURCE: 20260725174145_83d0fef0-77af-4387-b998-b96cea14b4e5.sql statement 6
ALTER TABLE public.corporate_transactions ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260725174145_83d0fef0-77af-4387-b998-b96cea14b4e5.sql statement 7
CREATE POLICY "Accountants & admins can view corporate transactions"
  ON public.corporate_transactions FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin','billing']::app_role[]));

-- SOURCE: 20260725174145_83d0fef0-77af-4387-b998-b96cea14b4e5.sql statement 8
CREATE POLICY "Accountants & admins can insert corporate transactions"
  ON public.corporate_transactions FOR INSERT
  TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]));

-- SOURCE: 20260725174145_83d0fef0-77af-4387-b998-b96cea14b4e5.sql statement 9
CREATE INDEX idx_corporate_transactions_sponsor ON public.corporate_transactions(sponsor_id, created_at DESC);

-- SOURCE: 20260725174145_83d0fef0-77af-4387-b998-b96cea14b4e5.sql statement 10
CREATE OR REPLACE FUNCTION public.close_retainer_month(
  _sponsor_id UUID,
  _year INT,
  _month INT,
  _notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _sponsor RECORD;
  _stmt_id UUID;
  _stmt RECORD;
  _bal_before NUMERIC(14,2);
  _deduct NUMERIC(14,2) := 0;
  _outstanding NUMERIC(14,2) := 0;
  _new_bal NUMERIC(14,2);
  _final_status TEXT;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _sponsor FROM public.corporate_accounts WHERE id = _sponsor_id FOR UPDATE;
  IF _sponsor.id IS NULL THEN RAISE EXCEPTION 'Sponsor not found'; END IF;
  IF _sponsor.account_type <> 'retainer' THEN
    RAISE EXCEPTION 'close_retainer_month only applies to retainer sponsors';
  END IF;

  -- Ensure a statement exists (generate if missing / regenerate if draft)
  SELECT id, status INTO _stmt_id, _final_status
    FROM public.sponsor_statements
    WHERE sponsor_id = _sponsor_id AND period_year = _year AND period_month = _month;

  IF _stmt_id IS NULL OR _final_status = 'draft' THEN
    _stmt_id := public.generate_sponsor_statement(_sponsor_id, _year, _month);
  END IF;

  SELECT * INTO _stmt FROM public.sponsor_statements WHERE id = _stmt_id FOR UPDATE;
  IF _stmt.status IN ('paid','void') THEN
    RAISE EXCEPTION 'Statement is already % — nothing to close', _stmt.status;
  END IF;

  _bal_before := _sponsor.balance;

  IF _bal_before >= _stmt.total_amount THEN
    _deduct := _stmt.total_amount;
    _outstanding := 0;
    _final_status := 'paid';
  ELSIF _bal_before > 0 THEN
    _deduct := _bal_before;
    _outstanding := _stmt.total_amount - _bal_before;
    _final_status := 'finalized';
  ELSE
    _deduct := 0;
    _outstanding := _stmt.total_amount;
    _final_status := 'finalized';
  END IF;

  _new_bal := _bal_before - _deduct;

  IF _deduct > 0 THEN
    UPDATE public.corporate_accounts
       SET balance = _new_bal, updated_at = now()
     WHERE id = _sponsor_id;

    INSERT INTO public.corporate_transactions
      (sponsor_id, transaction_type, amount, balance_before, balance_after,
       related_statement_id, notes, performed_by)
    VALUES
      (_sponsor_id, 'monthly_deduction', -_deduct, _bal_before, _new_bal,
       _stmt_id,
       COALESCE(_notes, 'Monthly deduction for ' || _year || '-' || lpad(_month::text,2,'0')),
       _uid);
  END IF;

  IF _outstanding > 0 THEN
    INSERT INTO public.corporate_transactions
      (sponsor_id, transaction_type, amount, balance_before, balance_after,
       related_statement_id, notes, performed_by)
    VALUES
      (_sponsor_id, 'debt_incurred', -_outstanding, _new_bal, _new_bal,
       _stmt_id,
       'Outstanding balance for ' || _year || '-' || lpad(_month::text,2,'0'),
       _uid);
  END IF;

  UPDATE public.sponsor_statements
     SET status = _final_status,
         finalized_at = COALESCE(finalized_at, now()),
         paid_at = CASE WHEN _final_status = 'paid' THEN now() ELSE paid_at END,
         notes = COALESCE(NULLIF(_notes,''), notes),
         updated_at = now()
   WHERE id = _stmt_id;

  PERFORM public.write_audit_log(
    'retainer_month_closed', 'sponsor_statement', _stmt_id::text,
    jsonb_build_object(
      'sponsor_id', _sponsor_id,
      'sponsor_name', _sponsor.company_name,
      'year', _year, 'month', _month,
      'total_amount', _stmt.total_amount,
      'deducted', _deduct,
      'outstanding', _outstanding,
      'final_status', _final_status
    )
  );

  RETURN jsonb_build_object(
    'statement_id', _stmt_id,
    'total_amount', _stmt.total_amount,
    'deducted', _deduct,
    'outstanding', _outstanding,
    'balance_after', _new_bal,
    'final_status', _final_status
  );
END;
$$;

-- SOURCE: 20260725174145_83d0fef0-77af-4387-b998-b96cea14b4e5.sql statement 11
CREATE OR REPLACE FUNCTION public.retainer_deposit(
  _sponsor_id UUID,
  _amount NUMERIC,
  _notes TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _sponsor RECORD;
  _new_bal NUMERIC(14,2);
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  SELECT * INTO _sponsor FROM public.corporate_accounts WHERE id = _sponsor_id FOR UPDATE;
  IF _sponsor.id IS NULL THEN RAISE EXCEPTION 'Sponsor not found'; END IF;

  _new_bal := _sponsor.balance + _amount;

  UPDATE public.corporate_accounts
     SET balance = _new_bal, updated_at = now()
   WHERE id = _sponsor_id;

  INSERT INTO public.corporate_transactions
    (sponsor_id, transaction_type, amount, balance_before, balance_after, notes, performed_by)
  VALUES
    (_sponsor_id, 'deposit', _amount, _sponsor.balance, _new_bal, _notes, _uid);

  PERFORM public.write_audit_log(
    'sponsor_deposit', 'corporate_account', _sponsor_id::text,
    jsonb_build_object('amount', _amount, 'new_balance', _new_bal, 'notes', _notes)
  );

  RETURN _new_bal;
END;
$$;

-- SOURCE: 20260726101151_e2ee403a-be45-4bf1-b8f4-0be36af388b1.sql statement 1
DO $$
DECLARE
  retainer_id uuid;
  corp_id uuid;
  ins_id uuid;
  pid uuid;
  vid uuid;
  invid uuid;
  first_names text[] := ARRAY['Aisha','Musa','Fatima','Ibrahim','Zainab','Umar','Halima','Sani','Amina','Yusuf'];
  last_names text[] := ARRAY['Bello','Abubakar','Sule','Danjuma','Garba','Idris','Kabir','Lawal','Salihu','Tanko'];
  i int;
  amt numeric;
  when_ts timestamptz;
BEGIN
  SELECT id INTO retainer_id FROM corporate_accounts WHERE account_type='retainer' LIMIT 1;

  SELECT id INTO corp_id FROM corporate_accounts WHERE company_name='Dangote Group' LIMIT 1;
  IF corp_id IS NULL THEN
    INSERT INTO corporate_accounts (company_name, phone, address, account_type, sponsor_type, status)
    VALUES ('Dangote Group', '08012340000', 'Dangote HQ, Kano', 'corporate', 'corporate', 'active')
    RETURNING id INTO corp_id;
  END IF;

  SELECT id INTO ins_id FROM insurance_providers WHERE name='NHIA' LIMIT 1;
  IF ins_id IS NULL THEN
    INSERT INTO insurance_providers (name, type, code, coverage_percentage, status)
    VALUES ('NHIA', 'nhia', 'NHIA-001', 90, 'active')
    RETURNING id INTO ins_id;
  END IF;

  FOR i IN 1..10 LOOP
    -- Retainer patient
    INSERT INTO patients (first_name, last_name, gender, phone, address, date_of_birth, account_type, corporate_id, card_number, mini_card_number, status)
    VALUES (first_names[i], last_names[i], CASE WHEN i%2=0 THEN 'male' ELSE 'female' END,
            '0803000' || lpad(i::text,4,'0'), 'Kano', '1990-01-01', 'retainer', retainer_id, '', '', 'discharged')
    RETURNING id INTO pid;
    when_ts := date_trunc('month', now()) + ((i-1) || ' days')::interval + interval '10 hours';
    INSERT INTO visits (patient_id, visit_number, status, sponsor_type, corporate_id, opened_at, presenting_complaint, claim_status)
    VALUES (pid, next_visit_number(), 'settled', 'retainer', retainer_id, when_ts, 'Routine consultation', 'pending')
    RETURNING id INTO vid;
    amt := 5000 + (i*500);
    INSERT INTO invoices (patient_id, visit_id, invoice_number, total_amount, original_amount, sponsor_type, corporate_account_id, status, created_at, updated_at)
    VALUES (pid, vid, '', amt, amt, 'retainer', retainer_id, 'pending', when_ts, when_ts)
    RETURNING id INTO invid;
    INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total, category) VALUES
      (invid, 'Consultation', 1, 2000, 2000, 'consultation'),
      (invid, 'Malaria RDT', 1, 1500, 1500, 'lab'),
      (invid, 'Drugs', 1, amt-3500, amt-3500, 'pharmacy');

    -- Corporate patient
    INSERT INTO patients (first_name, last_name, gender, phone, address, date_of_birth, account_type, corporate_id, card_number, mini_card_number, status)
    VALUES (first_names[i], last_names[((i+3)%10)+1], CASE WHEN i%2=0 THEN 'female' ELSE 'male' END,
            '0804000' || lpad(i::text,4,'0'), 'Kano', '1988-05-15', 'corporate', corp_id, '', '', 'discharged')
    RETURNING id INTO pid;
    when_ts := date_trunc('month', now()) + ((i-1) || ' days')::interval + interval '11 hours';
    INSERT INTO visits (patient_id, visit_number, status, sponsor_type, corporate_id, opened_at, presenting_complaint, claim_status)
    VALUES (pid, next_visit_number(), 'settled', 'corporate', corp_id, when_ts, 'Company medical', 'pending')
    RETURNING id INTO vid;
    amt := 7500 + (i*750);
    INSERT INTO invoices (patient_id, visit_id, invoice_number, total_amount, original_amount, sponsor_type, corporate_account_id, status, created_at, updated_at)
    VALUES (pid, vid, '', amt, amt, 'corporate', corp_id, 'pending', when_ts, when_ts)
    RETURNING id INTO invid;
    INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total, category) VALUES
      (invid, 'Consultation', 1, 3000, 3000, 'consultation'),
      (invid, 'Chest X-Ray', 1, 4500, 4500, 'lab'),
      (invid, 'Drugs', 1, amt-7500, amt-7500, 'pharmacy');

    -- Insurance patient
    INSERT INTO patients (first_name, last_name, gender, phone, address, date_of_birth, account_type, insurance_provider, insurance_policy_number, card_number, mini_card_number, status)
    VALUES (first_names[((i+5)%10)+1], last_names[i], CASE WHEN i%2=0 THEN 'male' ELSE 'female' END,
            '0805000' || lpad(i::text,4,'0'), 'Kano', '1985-08-20', 'insurance', 'NHIA', 'NHIA-POL-' || lpad(i::text,4,'0'), '', '', 'discharged')
    RETURNING id INTO pid;
    when_ts := date_trunc('month', now()) + ((i-1) || ' days')::interval + interval '12 hours';
    INSERT INTO visits (patient_id, visit_number, status, sponsor_type, opened_at, presenting_complaint, claim_status)
    VALUES (pid, next_visit_number(), 'settled', 'insurance', when_ts, 'Insurance visit', 'pending')
    RETURNING id INTO vid;
    amt := 6000 + (i*600);
    INSERT INTO invoices (patient_id, visit_id, invoice_number, total_amount, original_amount, sponsor_type, status, created_at, updated_at)
    VALUES (pid, vid, '', amt, amt, 'insurance', 'pending', when_ts, when_ts)
    RETURNING id INTO invid;
    INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total, category) VALUES
      (invid, 'Consultation', 1, 2500, 2500, 'consultation'),
      (invid, 'Blood test', 1, 2000, 2000, 'lab'),
      (invid, 'Drugs', 1, amt-4500, amt-4500, 'pharmacy');
  END LOOP;
END $$;

-- SOURCE: 20260727075202_a46f35f7-1c22-4377-999d-a3b1a3bb577e.sql statement 1
UPDATE public.patients SET account_type = 'nhis' WHERE account_type = 'insurance';

-- SOURCE: 20260727081705_fd9b41c5-2d30-4a60-82c7-9e9ee72a6009.sql statement 1
CREATE OR REPLACE FUNCTION public.reset_patient_history()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset patient history';
  END IF;

  DELETE FROM public.invoice_items;
  DELETE FROM public.sponsor_statement_items;
  DELETE FROM public.sponsor_statements;
  DELETE FROM public.insurance_claims;
  DELETE FROM public.corporate_transactions;
  DELETE FROM public.balance_transactions;
  DELETE FROM public.balance_requests;
  DELETE FROM public.invoices;
  DELETE FROM public.prescription_items;
  DELETE FROM public.prescriptions;
  DELETE FROM public.lab_requests;
  DELETE FROM public.vitals;
  DELETE FROM public.snap_orders;
  DELETE FROM public.standing_orders;
  DELETE FROM public.visit_attachments;
  DELETE FROM public.emr_attachments;
  DELETE FROM public.eligibility_verifications;
  DELETE FROM public.patient_journey_history;
  DELETE FROM public.patient_journey;
  DELETE FROM public.admissions;
  DELETE FROM public.anc_visits;
  DELETE FROM public.anc_programs;
  DELETE FROM public.visits;

  UPDATE public.patients
     SET status = 'registered',
         last_visit = NULL,
         balance = 0;

  UPDATE public.corporate_accounts SET balance = 0;

  PERFORM public.write_audit_log('reset_patient_history', 'patients', NULL, NULL, 'success');
END;
$$;

-- SOURCE: 20260727081705_fd9b41c5-2d30-4a60-82c7-9e9ee72a6009.sql statement 2
GRANT EXECUTE ON FUNCTION public.reset_patient_history() TO authenticated;

-- SOURCE: 20260727093011_870cb265-c493-4dc6-a874-e047abb75553.sql statement 1
CREATE OR REPLACE FUNCTION public.discharge_patient(_patient_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _v RECORD;
  _outstanding numeric;
  _is_sponsored boolean := false;
  _new_claim text;
  _closed_visit_id uuid := NULL;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin','billing','cashier','accountant']::app_role[]) THEN
    RAISE EXCEPTION 'Not permitted to discharge patients';
  END IF;

  -- Find the patient's open visit (if any)
  SELECT * INTO _v FROM public.visits
   WHERE patient_id = _patient_id AND status = 'open'
   ORDER BY opened_at DESC LIMIT 1;

  IF _v.id IS NOT NULL THEN
    PERFORM public.recalc_visit_totals(_v.id);
    SELECT * INTO _v FROM public.visits WHERE id = _v.id;

    _is_sponsored := _v.sponsor_type IS NOT NULL
                     AND lower(_v.sponsor_type) IN ('katchma','nhis','nhia','hmo','corporate','retainer','staff','staff_family');
    _outstanding := COALESCE(_v.total_charged,0) - COALESCE(_v.total_paid,0);

    IF NOT _is_sponsored AND _outstanding > 0 THEN
      RAISE EXCEPTION 'Cash patient still owes ₦% — collect payment at Cashier before discharge', _outstanding;
    END IF;

    _new_claim := _v.claim_status;
    IF _v.claim_status = 'not_applicable'
       AND COALESCE(_v.total_charged,0) > 0
       AND _is_sponsored
       AND lower(_v.sponsor_type) IN ('katchma','nhis','nhia','hmo','corporate','retainer')
    THEN
      _new_claim := 'pending';
    END IF;

    UPDATE public.visits
       SET status = 'settled',
           closed_at = now(),
           closed_by = _uid,
           claim_status = _new_claim,
           claim_last_action_at = CASE WHEN _new_claim <> _v.claim_status THEN now() ELSE claim_last_action_at END,
           claim_last_action_by = CASE WHEN _new_claim <> _v.claim_status THEN _uid ELSE claim_last_action_by END,
           updated_at = now()
     WHERE id = _v.id;

    _closed_visit_id := _v.id;

    PERFORM public.write_audit_log(
      'visit_settled_on_discharge', 'visit', _v.id::text,
      jsonb_build_object(
        'visit_number', _v.visit_number,
        'patient_id', _v.patient_id,
        'sponsor_type', _v.sponsor_type,
        'total_charged', _v.total_charged,
        'total_paid', _v.total_paid,
        'outstanding', _outstanding,
        'claim_status', _new_claim,
        'reason', _reason
      ), 'success'
    );
  END IF;

  UPDATE public.patients
     SET status = 'discharged', updated_at = now()
   WHERE id = _patient_id;

  PERFORM public.advance_journey(
    _patient_id, 'discharged', NULL, _uid, NULL, NULL, _closed_visit_id, _reason
  );

  PERFORM public.write_audit_log(
    'patient_discharged', 'patient', _patient_id::text,
    jsonb_build_object('visit_id', _closed_visit_id, 'reason', _reason), 'success'
  );

  RETURN jsonb_build_object('visit_id', _closed_visit_id, 'sponsored', _is_sponsored);
END;
$$;

-- SOURCE: 20260727093011_870cb265-c493-4dc6-a874-e047abb75553.sql statement 2
GRANT EXECUTE ON FUNCTION public.discharge_patient(uuid, text) TO authenticated;

-- SOURCE: 20260728094016_1373792c-cea5-45d0-8cba-82d24f516d92.sql statement 1
DROP POLICY "Admin delete insurance_claims" ON public.insurance_claims;

-- SOURCE: 20260728094016_1373792c-cea5-45d0-8cba-82d24f516d92.sql statement 2
CREATE POLICY "Admin delete insurance_claims" ON public.insurance_claims
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260728094016_1373792c-cea5-45d0-8cba-82d24f516d92.sql statement 3
DROP POLICY "Uploader or admin update EMR attachments" ON public.emr_attachments;

-- SOURCE: 20260728094016_1373792c-cea5-45d0-8cba-82d24f516d92.sql statement 4
CREATE POLICY "Uploader or admin update EMR attachments" ON public.emr_attachments
  FOR UPDATE TO authenticated
  USING ((uploaded_by = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK ((uploaded_by = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260728094016_1373792c-cea5-45d0-8cba-82d24f516d92.sql statement 5
DROP POLICY "Fulfillers update only paid snap orders" ON public.snap_orders;

-- SOURCE: 20260728094016_1373792c-cea5-45d0-8cba-82d24f516d92.sql statement 6
CREATE POLICY "Fulfillers update only paid snap orders" ON public.snap_orders
  FOR UPDATE TO authenticated
  USING ((status = 'paid'::text) AND (((target_station = 'pharmacy'::text) AND has_role(auth.uid(), 'pharmacist'::app_role)) OR ((target_station = 'lab'::text) AND has_role(auth.uid(), 'lab_tech'::app_role))))
  WITH CHECK ((status = ANY (ARRAY['paid'::text, 'fulfilled'::text, 'rejected'::text])) AND (((target_station = 'pharmacy'::text) AND has_role(auth.uid(), 'pharmacist'::app_role)) OR ((target_station = 'lab'::text) AND has_role(auth.uid(), 'lab_tech'::app_role))));

-- SOURCE: 20260728094156_e461416d-13d9-431b-a44b-e131b8559dbb.sql statement 1
CREATE OR REPLACE FUNCTION public.settle_invoice_atomic(
  _invoice_id uuid,
  _cash_amount numeric DEFAULT 0,
  _balance_amount numeric DEFAULT 0,
  _debt_amount numeric DEFAULT 0,
  _payment_method text DEFAULT 'cash',
  _notes text DEFAULT NULL,
  _sponsored boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice invoices%ROWTYPE;
  v_new_balance numeric;
  v_collected numeric;
  v_available numeric;
BEGIN
  IF NOT public.is_authenticated_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _cash_amount < 0 OR _balance_amount < 0 OR _debt_amount < 0 THEN
    RAISE EXCEPTION 'Amounts must be non-negative';
  END IF;

  -- Lock the invoice row for the duration of the transaction.
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = _invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_invoice.status = 'paid' THEN
    RAISE EXCEPTION 'Invoice already settled';
  END IF;

  -- Deduct from wallet balance (with concurrency-safe check).
  IF _balance_amount > 0 THEN
    SELECT balance INTO v_available
    FROM public.patients
    WHERE id = v_invoice.patient_id
    FOR UPDATE;

    IF v_available IS NULL OR v_available < _balance_amount THEN
      RAISE EXCEPTION 'Insufficient wallet balance (available: %, requested: %)',
        COALESCE(v_available, 0), _balance_amount;
    END IF;

    PERFORM public.adjust_patient_balance(
      v_invoice.patient_id,
      -_balance_amount,
      'invoice_deduction',
      'balance',
      NULL,
      _invoice_id,
      COALESCE(_notes, format('Applied to invoice %s', v_invoice.invoice_number))
    );
  END IF;

  -- Record shortfall as patient debt for cash accounts.
  IF _debt_amount > 0 THEN
    PERFORM public.adjust_patient_balance(
      v_invoice.patient_id,
      -_debt_amount,
      'debt_incurred',
      _payment_method,
      NULL,
      _invoice_id,
      format('Shortfall on invoice %s', v_invoice.invoice_number)
    );
  END IF;

  v_collected := COALESCE(v_invoice.paid_amount, 0) + _cash_amount + _balance_amount;

  UPDATE public.invoices
  SET paid_amount    = v_collected,
      status         = 'paid',
      payment_method = _payment_method,
      paid_at        = now(),
      notes          = COALESCE(_notes, notes),
      updated_at     = now()
  WHERE id = _invoice_id;

  SELECT balance INTO v_new_balance FROM public.patients WHERE id = v_invoice.patient_id;

  RETURN jsonb_build_object(
    'invoice_id',       _invoice_id,
    'invoice_number',   v_invoice.invoice_number,
    'patient_id',       v_invoice.patient_id,
    'collected',        v_collected,
    'cash_amount',      _cash_amount,
    'balance_amount',   _balance_amount,
    'debt_amount',      _debt_amount,
    'new_wallet_balance', v_new_balance,
    'sponsored',        _sponsored
  );
END;
$$;

-- SOURCE: 20260728094156_e461416d-13d9-431b-a44b-e131b8559dbb.sql statement 2
REVOKE ALL ON FUNCTION public.settle_invoice_atomic(uuid, numeric, numeric, numeric, text, text, boolean) FROM PUBLIC;

-- SOURCE: 20260728094156_e461416d-13d9-431b-a44b-e131b8559dbb.sql statement 3
GRANT EXECUTE ON FUNCTION public.settle_invoice_atomic(uuid, numeric, numeric, numeric, text, text, boolean) TO authenticated;

-- SOURCE: 20260728110333_2726af4b-5cd6-4a27-8320-aecea6a184af.sql statement 1
DROP POLICY IF EXISTS "Doctors can insert prescriptions" ON public.prescriptions;

-- SOURCE: 20260728110333_2726af4b-5cd6-4a27-8320-aecea6a184af.sql statement 2
DROP POLICY IF EXISTS "Doctors can insert prescription_items" ON public.prescription_items;

-- SOURCE: 20260728110333_2726af4b-5cd6-4a27-8320-aecea6a184af.sql statement 3
DROP POLICY IF EXISTS "Doctors and lab_tech can insert lab_requests" ON public.lab_requests;

-- SOURCE: 20260728110333_2726af4b-5cd6-4a27-8320-aecea6a184af.sql statement 4
CREATE OR REPLACE FUNCTION public.create_prescription_from_snap(
  _snap_id uuid,
  _diagnosis text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _items jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snap public.snap_orders%ROWTYPE;
  v_uid  uuid := auth.uid();
  v_prescription_id uuid;
  v_item jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_any_role(v_uid, ARRAY['pharmacist','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only pharmacists can materialise prescriptions from snaps';
  END IF;

  SELECT * INTO v_snap FROM public.snap_orders WHERE id = _snap_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snap order % not found', _snap_id;
  END IF;
  IF v_snap.target_station <> 'pharmacy' OR v_snap.order_type <> 'prescription' THEN
    RAISE EXCEPTION 'Snap % is not a pharmacy prescription snap', _snap_id;
  END IF;
  IF v_snap.status NOT IN ('paid','fulfilled') THEN
    RAISE EXCEPTION 'Snap % must be paid before creating a prescription (status=%)', _snap_id, v_snap.status;
  END IF;

  INSERT INTO public.prescriptions (patient_id, visit_id, diagnosis, notes, status, created_by)
  VALUES (v_snap.patient_id, v_snap.visit_id, _diagnosis, _notes, 'dispensed', v_uid::text)
  RETURNING id INTO v_prescription_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_items, '[]'::jsonb))
  LOOP
    INSERT INTO public.prescription_items
      (prescription_id, medication, dosage, frequency, duration, quantity, dispensed)
    VALUES (
      v_prescription_id,
      COALESCE(v_item->>'medication', v_item->>'name', 'Unknown'),
      COALESCE(v_item->>'dosage', ''),
      COALESCE(v_item->>'frequency', ''),
      COALESCE(v_item->>'duration', ''),
      COALESCE((v_item->>'quantity')::int, (v_item->>'qty')::int, 1),
      true
    );
  END LOOP;

  RETURN v_prescription_id;
END;
$$;

-- SOURCE: 20260728110333_2726af4b-5cd6-4a27-8320-aecea6a184af.sql statement 5
REVOKE ALL ON FUNCTION public.create_prescription_from_snap(uuid, text, text, jsonb) FROM PUBLIC;

-- SOURCE: 20260728110333_2726af4b-5cd6-4a27-8320-aecea6a184af.sql statement 6
GRANT EXECUTE ON FUNCTION public.create_prescription_from_snap(uuid, text, text, jsonb) TO authenticated;

-- SOURCE: 20260728110333_2726af4b-5cd6-4a27-8320-aecea6a184af.sql statement 7
CREATE OR REPLACE FUNCTION public.create_lab_request_from_snap(
  _snap_id uuid,
  _tests text[],
  _diagnosis text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snap public.snap_orders%ROWTYPE;
  v_uid  uuid := auth.uid();
  v_lab_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_any_role(v_uid, ARRAY['lab_tech','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only lab technicians can materialise lab requests from snaps';
  END IF;

  SELECT * INTO v_snap FROM public.snap_orders WHERE id = _snap_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snap order % not found', _snap_id;
  END IF;
  IF v_snap.target_station <> 'lab' OR v_snap.order_type NOT IN ('lab','lab_result') THEN
    RAISE EXCEPTION 'Snap % is not a lab snap', _snap_id;
  END IF;
  IF v_snap.status NOT IN ('paid','fulfilled') THEN
    RAISE EXCEPTION 'Snap % must be paid before creating a lab request (status=%)', _snap_id, v_snap.status;
  END IF;
  IF _tests IS NULL OR array_length(_tests, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one test is required';
  END IF;

  INSERT INTO public.lab_requests
    (patient_id, visit_id, tests, diagnosis, status, requested_by, requested_at, printed)
  VALUES (
    v_snap.patient_id, v_snap.visit_id, _tests, _diagnosis,
    'pending', v_uid::text, now(), false
  )
  RETURNING id INTO v_lab_id;

  RETURN v_lab_id;
END;
$$;

-- SOURCE: 20260728110333_2726af4b-5cd6-4a27-8320-aecea6a184af.sql statement 8
REVOKE ALL ON FUNCTION public.create_lab_request_from_snap(uuid, text[], text) FROM PUBLIC;

-- SOURCE: 20260728110333_2726af4b-5cd6-4a27-8320-aecea6a184af.sql statement 9
GRANT EXECUTE ON FUNCTION public.create_lab_request_from_snap(uuid, text[], text) TO authenticated;

-- SOURCE: 20260728114220_eea66ff3-6f68-413d-bea2-9d01be6c2018.sql statement 1
CREATE OR REPLACE FUNCTION public.snap_orders_sync_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Advance the linked snap to "paid" as soon as the invoice is marked paid,
  -- regardless of whether the money came from the patient or a sponsor claim.
  IF NEW.status = 'paid'
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.status, '') <> 'paid') THEN
    UPDATE public.snap_orders
       SET status = 'paid', paid_at = now(), updated_at = now()
     WHERE invoice_id = NEW.id
       AND status IN ('awaiting_payment', 'pending_billing');
  END IF;
  RETURN NEW;
END;
$$;

-- SOURCE: 20260728114220_eea66ff3-6f68-413d-bea2-9d01be6c2018.sql statement 2
UPDATE public.snap_orders so
   SET status = 'paid', paid_at = COALESCE(so.paid_at, now()), updated_at = now()
  FROM public.invoices i
 WHERE so.invoice_id = i.id
   AND i.status = 'paid'
   AND so.status IN ('awaiting_payment', 'pending_billing');

-- SOURCE: 20260728115107_66ef34e1-f8ce-4524-a2ca-2c732f5822f1.sql statement 1
CREATE OR REPLACE FUNCTION public.reconcile_paid_snap_orders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  healed_snaps int := 0;
  healed_patients int := 0;
  r record;
  next_station text;
BEGIN
  -- 1) Heal snap orders stuck at awaiting_payment whose invoice is paid.
  WITH updated AS (
    UPDATE public.snap_orders s
       SET status = 'paid',
           paid_at = COALESCE(s.paid_at, now()),
           updated_at = now()
      FROM public.invoices i
     WHERE s.invoice_id = i.id
       AND s.status = 'awaiting_payment'
       AND i.status = 'paid'
    RETURNING s.id
  )
  SELECT count(*) INTO healed_snaps FROM updated;

  -- 2) Heal patients stuck at awaiting_payment when nothing is truly pending.
  FOR r IN
    SELECT p.id AS patient_id
      FROM public.patients p
     WHERE p.status = 'awaiting_payment'
       AND NOT EXISTS (
         SELECT 1 FROM public.invoices i
          WHERE i.patient_id = p.id
            AND i.status IN ('pending','partial')
       )
  LOOP
    next_station := public.patient_pending_workflow_station(r.patient_id);

    IF next_station IS NULL THEN
      UPDATE public.patients
         SET status = 'discharged', updated_at = now()
       WHERE id = r.patient_id;
    ELSIF next_station <> 'awaiting_payment' THEN
      UPDATE public.patients
         SET status = next_station, updated_at = now()
       WHERE id = r.patient_id;
    ELSE
      CONTINUE;
    END IF;

    healed_patients := healed_patients + 1;

    PERFORM public.write_audit_log(
      'patient_status_reconciled',
      'patient',
      r.patient_id::text,
      jsonb_build_object('new_status', COALESCE(next_station, 'discharged'), 'source', 'reconcile_paid_snap_orders'),
      'success'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'healed_snaps', healed_snaps,
    'healed_patients', healed_patients,
    'ran_at', now()
  );
END;
$$;

-- SOURCE: 20260728115107_66ef34e1-f8ce-4524-a2ca-2c732f5822f1.sql statement 2
GRANT EXECUTE ON FUNCTION public.reconcile_paid_snap_orders() TO authenticated, service_role;

-- SOURCE: 20260728115107_66ef34e1-f8ce-4524-a2ca-2c732f5822f1.sql statement 3
DO $$
BEGIN
  PERFORM cron.unschedule('reconcile-paid-snap-orders');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- SOURCE: 20260728115107_66ef34e1-f8ce-4524-a2ca-2c732f5822f1.sql statement 4
SELECT cron.schedule(
  'reconcile-paid-snap-orders',
  '*/5 * * * *',
  $$SELECT public.reconcile_paid_snap_orders();$$
);

-- SOURCE: 20260728121152_5f7c1928-26b4-4ce7-a0f9-400cb02020ad.sql statement 1
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS claim_submitted_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS claim_submitted_by uuid,
  ADD COLUMN IF NOT EXISTS claim_submission_notes text;

-- SOURCE: 20260728121152_5f7c1928-26b4-4ce7-a0f9-400cb02020ad.sql statement 2
CREATE OR REPLACE FUNCTION public.mark_invoice_claim_submitted(
  _invoice_id uuid,
  _notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.has_role(_uid, 'admin'::app_role) OR public.has_role(_uid, 'claims_manager'::app_role)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.invoices
     SET claim_submitted_at = now(),
         claim_submitted_by = _uid,
         claim_submission_notes = COALESCE(_notes, claim_submission_notes)
   WHERE id = _invoice_id;
END;
$$;

-- SOURCE: 20260728121152_5f7c1928-26b4-4ce7-a0f9-400cb02020ad.sql statement 3
CREATE OR REPLACE FUNCTION public.unmark_invoice_claim_submitted(
  _invoice_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.has_role(_uid, 'admin'::app_role) OR public.has_role(_uid, 'claims_manager'::app_role)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.invoices
     SET claim_submitted_at = NULL,
         claim_submitted_by = NULL
   WHERE id = _invoice_id;
END;
$$;

-- SOURCE: 20260729001714_737ee12c-4f53-47c9-9deb-a742d2ee977f.sql statement 1
CREATE OR REPLACE FUNCTION public.purge_clinical_data(_modules text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _result jsonb := '{}'::jsonb;
  _n bigint;
  _has text[] := _modules;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can purge clinical data';
  END IF;

  -- Order: dependents first
  IF 'tasks' = ANY(_has) THEN
    DELETE FROM public.task_claims; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('task_claims', _n);
  END IF;

  IF 'notifications' = ANY(_has) THEN
    DELETE FROM public.notifications; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('notifications', _n);
  END IF;

  IF 'errors' = ANY(_has) THEN
    DELETE FROM public.error_logs; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('error_logs', _n);
  END IF;

  IF 'audit' = ANY(_has) THEN
    DELETE FROM public.audit_logs; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('audit_logs', _n);
  END IF;

  IF 'lab' = ANY(_has) THEN
    DELETE FROM public.lab_requests; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('lab_requests', _n);
  END IF;

  IF 'prescriptions' = ANY(_has) THEN
    DELETE FROM public.prescription_items; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('prescription_items', _n);
    DELETE FROM public.prescriptions; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('prescriptions', _n);
  END IF;

  IF 'billing' = ANY(_has) THEN
    DELETE FROM public.invoice_items; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('invoice_items', _n);
    DELETE FROM public.sponsor_statement_items; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('sponsor_statement_items', _n);
    DELETE FROM public.sponsor_statements; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('sponsor_statements', _n);
    DELETE FROM public.insurance_claims; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('insurance_claims', _n);
    DELETE FROM public.corporate_transactions; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('corporate_transactions', _n);
    DELETE FROM public.balance_transactions; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('balance_transactions', _n);
    DELETE FROM public.balance_requests; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('balance_requests', _n);
    DELETE FROM public.invoices; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('invoices', _n);
  END IF;

  IF 'snaps' = ANY(_has) THEN
    DELETE FROM public.snap_orders; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('snap_orders', _n);
  END IF;

  IF 'admissions' = ANY(_has) THEN
    DELETE FROM public.admissions; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('admissions', _n);
    UPDATE public.beds SET status = 'available' WHERE status <> 'available';
    GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('beds_reset', _n);
  END IF;

  IF 'anc' = ANY(_has) THEN
    DELETE FROM public.anc_visits; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('anc_visits', _n);
    DELETE FROM public.anc_programs; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('anc_programs', _n);
  END IF;

  IF 'visits' = ANY(_has) THEN
    DELETE FROM public.visit_attachments; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('visit_attachments', _n);
    DELETE FROM public.emr_attachments; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('emr_attachments', _n);
    DELETE FROM public.vitals; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('vitals', _n);
    DELETE FROM public.patient_journey_history; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('patient_journey_history', _n);
    DELETE FROM public.patient_journey; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('patient_journey', _n);
    DELETE FROM public.visits; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('visits', _n);
  END IF;

  IF 'patients' = ANY(_has) THEN
    DELETE FROM public.patients; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('patients', _n);
  END IF;

  RETURN _result;
END;
$$;

-- SOURCE: 20260729001714_737ee12c-4f53-47c9-9deb-a742d2ee977f.sql statement 2
REVOKE ALL ON FUNCTION public.purge_clinical_data(text[]) FROM PUBLIC, anon;

-- SOURCE: 20260729001714_737ee12c-4f53-47c9-9deb-a742d2ee977f.sql statement 3
GRANT EXECUTE ON FUNCTION public.purge_clinical_data(text[]) TO authenticated;

-- SOURCE: 20260730112225_2783a0ff-cca6-4af2-a1f8-45344adf7093.sql statement 1
CREATE OR REPLACE FUNCTION public.copay_percent(_account_type text, _plan text DEFAULT NULL)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    GREATEST(1, CEIL(EXTRACT(EPOCH FROM (COALESCE(a.discharged_at, now()) - COALESCE(a.admitted_at, a.created_at))) / 86400.0))::int,
    COALESCE(r.daily_rate, 0)::numeric,
    (GREATEST(1, CEIL(EXTRACT(EPOCH FROM (COALESCE(a.discharged_at, now()) - COALESCE(a.admitted_at, a.created_at))) / 86400.0)) * COALESCE(r.daily_rate, 0))::numeric
  FROM public.admissions a
  LEFT JOIN public.beds b ON b.id = a.bed_id
  LEFT JOIN public.rooms r ON r.id = b.room_id
  WHERE a.id = _admission_id;
$fn$;

-- SOURCE: 20260730112225_2783a0ff-cca6-4af2-a1f8-45344adf7093.sql statement 5
REVOKE ALL ON FUNCTION public.admission_bed_charge(uuid) FROM public;

-- SOURCE: 20260730112225_2783a0ff-cca6-4af2-a1f8-45344adf7093.sql statement 6
GRANT EXECUTE ON FUNCTION public.admission_bed_charge(uuid) TO authenticated, service_role;

-- SOURCE: 20260730112225_2783a0ff-cca6-4af2-a1f8-45344adf7093.sql statement 7
CREATE OR REPLACE FUNCTION public.bill_admission_bed_days(_admission_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _adm RECORD;
  _p RECORD;
  _room RECORD;
  _days int;
  _rate numeric;
  _amount numeric;
  _pct numeric;
  _copay numeric;
  _inv uuid;
BEGIN
  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id;
  IF _adm IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id;
  IF _p IS NULL THEN RETURN NULL; END IF;

  SELECT d.days, d.daily_rate, d.amount INTO _days, _rate, _amount
  FROM public.admission_bed_charge(_admission_id) d;

  IF COALESCE(_amount, 0) <= 0 THEN RETURN NULL; END IF;

  SELECT id INTO _inv FROM public.invoices
  WHERE patient_id = _adm.patient_id
    AND notes = 'BED_DAYS:' || _admission_id::text
  LIMIT 1;
  IF _inv IS NOT NULL THEN RETURN _inv; END IF;

  _pct := public.copay_percent(_p.account_type, _p.insurance_plan);
  _copay := ROUND(_amount * _pct / 100.0, 2);

  SELECT r.room_number, r.room_class INTO _room
  FROM public.beds b JOIN public.rooms r ON r.id = b.room_id
  WHERE b.id = _adm.bed_id;

  INSERT INTO public.invoices (
    patient_id, visit_id, total_amount, original_amount, discount_amount,
    paid_amount, status, sponsor_type, corporate_account_id, notes
  ) VALUES (
    _adm.patient_id, _adm.visit_id, _amount, _amount, 0,
    0, 'pending',
    CASE WHEN _pct < 100 THEN _p.account_type ELSE NULL END,
    _p.corporate_id,
    'BED_DAYS:' || _admission_id::text
  ) RETURNING id INTO _inv;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
  VALUES (
    _inv,
    'Bed charge - ' || COALESCE(_room.room_class, 'ward') || ' - ' || _days || ' day(s)',
    _days, _rate, _amount, 'admission'
  );

  IF _copay > 0 THEN
    PERFORM public.adjust_patient_balance(
      _adm.patient_id, -_copay, 'invoice_payment', NULL, NULL, _inv,
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
SET search_path = public
AS $fn$
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
  IF _adm.status NOT IN ('active','ready_for_discharge') THEN
    RAISE EXCEPTION 'Admission is not active (%)', _adm.status;
  END IF;

  -- Accrued bed charge is billed here (once per admission)
  PERFORM public.bill_admission_bed_days(_admission_id);

  SELECT balance INTO _bal FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
  _debt := GREATEST(0, -COALESCE(_bal,0));

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash','pos','transfer') THEN
      IF COALESCE(_settlement_amount,0) < _debt THEN
        RAISE EXCEPTION 'Settlement amount % is less than debt %', _settlement_amount, _debt;
      END IF;
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, _settlement_amount, 'debt_cleared', _settlement_method,
        NULL, NULL, COALESCE(_settlement_notes, 'Discharge settlement')
      );
    ELSIF _settlement_method = 'waive' THEN
      IF NOT public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]) THEN
        RAISE EXCEPTION 'Only accountant/admin can waive debt';
      END IF;
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, _debt, 'debt_cleared', 'waive',
        NULL, NULL, COALESCE(_settlement_notes, 'Discharge - debt waived')
      );
    ELSIF _settlement_method = 'carry' THEN
      PERFORM public.write_audit_log(
        'debt_carried_on_discharge', 'admission', _admission_id::text,
        jsonb_build_object('patient_id', _adm.patient_id, 'debt', _debt, 'notes', _settlement_notes)
      );
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  UPDATE public.admissions
     SET status = 'discharged',
         discharged_at = now(),
         discharged_by = auth.uid(),
         discharge_notes = _notes,
         updated_at = now()
   WHERE id = _admission_id;

  IF _adm.bed_id IS NOT NULL THEN
    UPDATE public.beds SET status = 'available', updated_at = now() WHERE id = _adm.bed_id;
  END IF;

  UPDATE public.patients SET status = 'discharged', updated_at = now() WHERE id = _adm.patient_id;

  PERFORM public.write_audit_log(
    'admission_discharged', 'admission', _admission_id::text,
    jsonb_build_object('patient_id', _adm.patient_id, 'notes', _notes)
  );
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
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _adm RECORD;
  _bed RECORD;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only a nurse or admin can assign a ward/room/bed';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF _adm.status <> 'waiting_assignment' THEN
    RAISE EXCEPTION 'Admission is not waiting for a room (%)', _adm.status;
  END IF;

  SELECT * INTO _bed FROM public.beds WHERE id = _bed_id FOR UPDATE;
  IF _bed IS NULL OR NOT _bed.active THEN RAISE EXCEPTION 'Bed not found or inactive'; END IF;
  IF _bed.status <> 'available' THEN RAISE EXCEPTION 'Bed is not available'; END IF;

  UPDATE public.admissions
     SET bed_id = _bed_id,
         assigned_by_nurse = _uid,
         status = 'active',
         admitted_at = now(),
         updated_at = now()
   WHERE id = _admission_id;

  PERFORM public.write_audit_log(
    'admission_bed_assigned', 'admission', _admission_id::text,
    jsonb_build_object('patient_id', _adm.patient_id, 'bed_id', _bed_id)
  );
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

-- SOURCE: 20260730121417_b20d27f1-1604-4645-bbd2-f4d2d3718090.sql statement 1
ALTER FUNCTION public.simple_id(text, bigint) SET search_path = public;

-- SOURCE: 20260730121417_b20d27f1-1604-4645-bbd2-f4d2d3718090.sql statement 2
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args,
           pg_get_function_result(p.oid) AS ret
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon, PUBLIC;', r.proname, r.args);
    IF r.ret = 'trigger' THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM authenticated;', r.proname, r.args);
    END IF;
  END LOOP;
END $$;

-- SOURCE: 20260730123801_39619395-fa06-4b75-b765-0157e7d7dad2.sql statement 1
REVOKE EXECUTE ON FUNCTION public.anc_touch_updated_at() FROM anon, authenticated, PUBLIC;

-- SOURCE: 20260731101727_1c04e970-2ef0-4bf8-bd30-c3f0dcfab420.sql statement 1
CREATE OR REPLACE FUNCTION public.request_admission(_patient_id uuid, _reason text DEFAULT NULL, _photo_path text DEFAULT NULL, _note text DEFAULT NULL, _visit_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
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

  PERFORM public.advance_journey(
    _patient_id, 'awaiting_room', 'nurse', NULL, 'nurse', 'Awaiting Room', _visit,
    'Admission requested'
  );

  PERFORM public.write_audit_log(
    'admission_requested', 'admission', _adm::text,
    jsonb_build_object('patient_id', _patient_id, 'snap_id', _snap, 'reason', _reason)
  );
  RETURN _adm;
END;
$$;

-- SOURCE: 20260731101727_1c04e970-2ef0-4bf8-bd30-c3f0dcfab420.sql statement 2
CREATE OR REPLACE FUNCTION public.assign_admission_bed(_admission_id uuid, _bed_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _adm RECORD;
  _bed RECORD;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only a nurse or admin can assign a ward/room/bed';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF _adm.status <> 'waiting_assignment' THEN
    RAISE EXCEPTION 'Admission is not waiting for a room (%)', _adm.status;
  END IF;

  SELECT * INTO _bed FROM public.beds WHERE id = _bed_id FOR UPDATE;
  IF _bed IS NULL OR NOT _bed.active THEN RAISE EXCEPTION 'Bed not found or inactive'; END IF;
  IF _bed.status <> 'available' THEN RAISE EXCEPTION 'Bed is not available'; END IF;

  UPDATE public.admissions
     SET bed_id = _bed_id,
         assigned_by_nurse = _uid,
         status = 'active',
         admitted_at = now(),
         updated_at = now()
   WHERE id = _admission_id;

  UPDATE public.patients
     SET status = 'admitted', updated_at = now()
   WHERE id = _adm.patient_id;

  PERFORM public.advance_journey(
    _adm.patient_id, 'admitted', 'nurse', NULL, 'ward', 'Ward', _adm.visit_id,
    'Bed assigned'
  );

  PERFORM public.write_audit_log(
    'admission_bed_assigned', 'admission', _admission_id::text,
    jsonb_build_object('patient_id', _adm.patient_id, 'bed_id', _bed_id)
  );
END;
$$;

-- SOURCE: 20260731101727_1c04e970-2ef0-4bf8-bd30-c3f0dcfab420.sql statement 3
UPDATE public.patients p
   SET status = 'awaiting_room', updated_at = now()
  FROM public.admissions a
 WHERE a.patient_id = p.id
   AND a.status = 'waiting_assignment'
   AND p.status IN ('waiting','with_nurse','with_doctor');
