-- SOURCE: 20260725114843_e8b13480-40d9-41a1-84b6-e95f9802c58b.sql statement 1
CREATE OR REPLACE FUNCTION public.advance_journey(_patient_id uuid, _to_state text, _owner_role text DEFAULT NULL::text, _owner_user_id uuid DEFAULT NULL::uuid, _department text DEFAULT NULL::text, _location text DEFAULT NULL::text, _visit_id uuid DEFAULT NULL::uuid, _reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 
AS $function$
DECLARE
  _uid uuid := public.hms_current_user_id();
  _existing public.patient_journey;
  _journey_id uuid;
  _visit uuid := _visit_id;
  _pending_station text;
  _open_visit public.visits;
BEGIN
  IF NOT public.is_authenticated_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _patient_id IS NULL OR _to_state IS NULL THEN
    RAISE EXCEPTION 'patient_id and to_state are required';
  END IF;

  IF _to_state = 'discharged' THEN
    _pending_station := public.patient_pending_workflow_station(_patient_id);
    IF _pending_station IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot discharge patient: pending workflow remains at %', _pending_station;
    END IF;

    -- NEW: refuse discharge while an open visit exists. The visit MUST be
    -- closed via Billing → Settle & Discharge (close_visit) so that insured
    -- visits auto-flip claim_status=pending and land in the Claims queue.
    SELECT * INTO _open_visit FROM public.visits
     WHERE patient_id = _patient_id
       AND status = 'open'
     ORDER BY opened_at DESC
     LIMIT 1;
    IF (_open_visit).id IS NOT NULL THEN
      RAISE EXCEPTION 'OPEN_VISIT: cannot discharge — visit % is still open. Settle it via Billing → Settle & Discharge first.', (_open_visit).visit_number;
    END IF;
  END IF;

  IF _visit IS NULL THEN
    SELECT id INTO _visit FROM public.visits
     WHERE patient_id = _patient_id AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1;
  END IF;

  SELECT * INTO _existing FROM public.patient_journey
   WHERE patient_id = _patient_id FOR UPDATE;

  IF (_existing).id IS NULL THEN
    INSERT INTO public.patient_journey
      (patient_id, visit_id, current_state, owner_role, owner_user_id, department, location)
    VALUES
      (_patient_id, _visit, _to_state, _owner_role, _owner_user_id, _department, _location)
    RETURNING id INTO _journey_id;

    INSERT INTO public.patient_journey_history
      (journey_id, patient_id, visit_id, from_state, to_state,
       from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
       department, location, actor_user_id, reason)
    VALUES
      (_journey_id, _patient_id, _visit, NULL, _to_state,
       NULL, _owner_role, NULL, _owner_user_id,
       _department, _location, _uid, _reason);
  ELSE
    _journey_id := (_existing).id;
    UPDATE public.patient_journey SET
      visit_id      = COALESCE(_visit, visit_id),
      current_state = _to_state,
      owner_role    = _owner_role,
      owner_user_id = _owner_user_id,
      department    = _department,
      location      = _location,
      updated_at    = now()
    WHERE id = _journey_id;

    INSERT INTO public.patient_journey_history
      (journey_id, patient_id, visit_id, from_state, to_state,
       from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
       department, location, actor_user_id, reason)
    VALUES
      (_journey_id, _patient_id, COALESCE(_visit, (_existing).visit_id),
       (_existing).current_state, _to_state,
       (_existing).owner_role, _owner_role,
       (_existing).owner_user_id, _owner_user_id,
       _department, _location, _uid, _reason);
  END IF;

  BEGIN
    UPDATE public.patients
       SET status = _to_state, updated_at = now()
     WHERE id = _patient_id;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN _journey_id;
END;
$function$;

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 1
CREATE SEQUENCE IF NOT EXISTS public.patients_card_seq START 1;

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 2
CREATE SEQUENCE IF NOT EXISTS public.visits_number_seq START 1;

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 3
CREATE SEQUENCE IF NOT EXISTS public.invoices_number_seq START 1;

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 4
CREATE SEQUENCE IF NOT EXISTS public.lab_requests_number_seq START 1;

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 5
CREATE OR REPLACE FUNCTION public.simple_id(_prefix text, _n bigint)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$ SELECT _prefix || '-' || lpad(_n::text, 3, '0'); $$;

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 6
CREATE OR REPLACE FUNCTION public.next_visit_number()
RETURNS text
LANGUAGE sql
SECURITY DEFINER

AS $$ SELECT public.simple_id('V', nextval('public.visits_number_seq')); $$;

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 7
CREATE OR REPLACE FUNCTION public.autofill_patient_card_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE _n bigint; _num text;
BEGIN
  IF (NEW).card_number IS NULL OR length(trim((NEW).card_number)) = 0 THEN
    _n := nextval('public.patients_card_seq');
    NEW.card_number := public.simple_id('P', _n);
    IF (NEW).mini_card_number IS NULL OR length(trim((NEW).mini_card_number)) = 0 THEN NEW.mini_card_number := lpad(_n::text, 3, '0');
    END IF;
  ELSIF (NEW).mini_card_number IS NULL OR length(trim((NEW).mini_card_number)) = 0 THEN NEW.mini_card_number := split_part((NEW).card_number, '-', 2);
    IF (NEW).mini_card_number IS NULL OR length((NEW).mini_card_number) = 0 THEN NEW.mini_card_number := (NEW).card_number;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 8
DROP TRIGGER IF EXISTS patients_autofill_card_number ON public.patients;

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 9
CREATE TRIGGER patients_autofill_card_number
BEFORE INSERT ON public.patients
FOR EACH ROW EXECUTE FUNCTION public.autofill_patient_card_number();

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 10
CREATE OR REPLACE FUNCTION public.autofill_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
BEGIN
  IF (NEW).invoice_number IS NULL OR length(trim((NEW).invoice_number)) = 0 THEN NEW.invoice_number := public.simple_id('INV', nextval('public.invoices_number_seq'));
  END IF;
  RETURN NEW;
END $$;

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 11
DROP TRIGGER IF EXISTS invoices_autofill_number ON public.invoices;

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 12
CREATE TRIGGER invoices_autofill_number
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.autofill_invoice_number();

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 13
CREATE OR REPLACE FUNCTION public.autofill_lab_request_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
BEGIN
  IF (NEW).request_number IS NULL OR length(trim((NEW).request_number)) = 0 THEN NEW.request_number := public.simple_id('LAB', nextval('public.lab_requests_number_seq'));
  END IF;
  RETURN NEW;
END $$;

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 14
DROP TRIGGER IF EXISTS lab_requests_autofill_number ON public.lab_requests;

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 15
CREATE TRIGGER lab_requests_autofill_number
BEFORE INSERT ON public.lab_requests
FOR EACH ROW EXECUTE FUNCTION public.autofill_lab_request_number();

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
  performed_by UUID REFERENCES public.auth_users(id),
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
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin','billing']::app_role[]));

-- SOURCE: 20260725174145_83d0fef0-77af-4387-b998-b96cea14b4e5.sql statement 8
CREATE POLICY "Accountants & admins can insert corporate transactions"
  ON public.corporate_transactions FOR INSERT
  TO authenticated
  WITH CHECK (public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]));

-- SOURCE: 20260725174145_83d0fef0-77af-4387-b998-b96cea14b4e5.sql statement 9
CREATE INDEX IF NOT EXISTS idx_corporate_transactions_sponsor ON public.corporate_transactions(sponsor_id, created_at DESC);

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

AS $$
DECLARE
  _uid UUID := public.hms_current_user_id();
  _sponsor public.corporate_accounts;
  _stmt_id UUID;
  _stmt public.sponsor_statements;
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
  IF (_sponsor).id IS NULL THEN RAISE EXCEPTION 'Sponsor not found'; END IF;
  IF (_sponsor).account_type <> 'retainer' THEN
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
  IF (_stmt).status IN ('paid','void') THEN
    RAISE EXCEPTION 'Statement is already % — nothing to close', (_stmt).status;
  END IF;

  _bal_before := (_sponsor).balance;

  IF _bal_before >= (_stmt).total_amount THEN
    _deduct := (_stmt).total_amount;
    _outstanding := 0;
    _final_status := 'paid';
  ELSIF _bal_before > 0 THEN
    _deduct := _bal_before;
    _outstanding := (_stmt).total_amount - _bal_before;
    _final_status := 'finalized';
  ELSE
    _deduct := 0;
    _outstanding := (_stmt).total_amount;
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

  SELECT public.write_audit_log('retainer_month_closed', 'sponsor_statement', _stmt_id::text, jsonb_build_object(
      'sponsor_id', _sponsor_id,
      'sponsor_name', (_sponsor).company_name,
      'year', _year, 'month', _month,
      'total_amount', (_stmt).total_amount,
      'deducted', _deduct,
      'outstanding', _outstanding,
      'final_status', _final_status
    )
  , 'success');

  RETURN jsonb_build_object(
    'statement_id', _stmt_id,
    'total_amount', (_stmt).total_amount,
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

AS $$
DECLARE
  _uid UUID := public.hms_current_user_id();
  _sponsor public.corporate_accounts;
  _new_bal NUMERIC(14,2);
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  SELECT * INTO _sponsor FROM public.corporate_accounts WHERE id = _sponsor_id FOR UPDATE;
  IF (_sponsor).id IS NULL THEN RAISE EXCEPTION 'Sponsor not found'; END IF;

  _new_bal := (_sponsor).balance + _amount;

  UPDATE public.corporate_accounts
     SET balance = _new_bal, updated_at = now()
   WHERE id = _sponsor_id;

  INSERT INTO public.corporate_transactions
    (sponsor_id, transaction_type, amount, balance_before, balance_after, notes, performed_by)
  VALUES
    (_sponsor_id, 'deposit', _amount, (_sponsor).balance, _new_bal, _notes, _uid);

  SELECT public.write_audit_log('sponsor_deposit', 'corporate_account', _sponsor_id::text, jsonb_build_object('amount', _amount, 'new_balance', _new_bal, 'notes', _notes)
  , 'success');

  RETURN _new_bal;
END;
$$;

-- SOURCE: 20260726101151_e2ee403a-be45-4bf1-b8f4-0be36af388b1.sql statement 1
SELECT 1;

-- SOURCE: 20260727075202_a46f35f7-1c22-4377-999d-a3b1a3bb577e.sql statement 1
UPDATE public.patients SET account_type = 'nhis' WHERE account_type = 'insurance';

-- SOURCE: 20260727081705_fd9b41c5-2d30-4a60-82c7-9e9ee72a6009.sql statement 1
CREATE OR REPLACE FUNCTION public.reset_patient_history()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
BEGIN
  IF NOT public.has_role(public.hms_current_user_id(), 'admin'::app_role) THEN
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
  -- DELETE FROM public.anc_visits;
  -- DELETE FROM public.anc_programs;
  DELETE FROM public.visits;

  UPDATE public.patients
     SET status = 'registered',
         last_visit = NULL,
         balance = 0;

  UPDATE public.corporate_accounts SET balance = 0;

  SELECT public.write_audit_log('reset_patient_history', 'patients', NULL, NULL, 'success');
END;
$$;

-- SOURCE: 20260727081705_fd9b41c5-2d30-4a60-82c7-9e9ee72a6009.sql statement 2
GRANT EXECUTE ON FUNCTION public.reset_patient_history() TO authenticated;

-- SOURCE: 20260727093011_870cb265-c493-4dc6-a874-e047abb75553.sql statement 1
CREATE OR REPLACE FUNCTION public.discharge_patient(_patient_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _uid uuid := public.hms_current_user_id();
  _v public.visits;
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

  IF (_v).id IS NOT NULL THEN
    SELECT public.recalc_visit_totals((_v).id);
    SELECT * INTO _v FROM public.visits WHERE id = (_v).id;

    _is_sponsored := (_v).sponsor_type IS NOT NULL
                     AND lower((_v).sponsor_type) IN ('katchma','nhis','nhia','hmo','corporate','retainer','staff','staff_family');
    _outstanding := COALESCE((_v).total_charged,0) - COALESCE((_v).total_paid,0);

    IF NOT _is_sponsored AND _outstanding > 0 THEN
      RAISE EXCEPTION 'Cash patient still owes ₦% — collect payment at Cashier before discharge', _outstanding;
    END IF;

    _new_claim := (_v).claim_status;
    IF (_v).claim_status = 'not_applicable'
       AND COALESCE((_v).total_charged,0) > 0
       AND _is_sponsored
       AND lower((_v).sponsor_type) IN ('katchma','nhis','nhia','hmo','corporate','retainer')
    THEN
      _new_claim := 'pending';
    END IF;

    UPDATE public.visits
       SET status = 'settled',
           closed_at = now(),
           closed_by = _uid,
           claim_status = _new_claim,
           claim_last_action_at = CASE WHEN _new_claim <> (_v).claim_status THEN now() ELSE claim_last_action_at END,
           claim_last_action_by = CASE WHEN _new_claim <> (_v).claim_status THEN _uid ELSE claim_last_action_by END,
           updated_at = now()
     WHERE id = (_v).id;

    _closed_visit_id := (_v).id;

    SELECT public.write_audit_log(
      'visit_settled_on_discharge', 'visit', (_v).id::text,
      jsonb_build_object(
        'visit_number', (_v).visit_number,
        'patient_id', (_v).patient_id,
        'sponsor_type', (_v).sponsor_type,
        'total_charged', (_v).total_charged,
        'total_paid', (_v).total_paid,
        'outstanding', _outstanding,
        'claim_status', _new_claim,
        'reason', _reason
      ), 'success'
    );
  END IF;

  UPDATE public.patients
     SET status = 'discharged', updated_at = now()
   WHERE id = _patient_id;

  SELECT public.advance_journey(
    _patient_id, 'discharged', NULL, _uid, NULL, NULL, _closed_visit_id, _reason
  );

  SELECT public.write_audit_log(
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
  USING (has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260728094016_1373792c-cea5-45d0-8cba-82d24f516d92.sql statement 3
DROP POLICY "Uploader or admin update EMR attachments" ON public.emr_attachments;

-- SOURCE: 20260728094016_1373792c-cea5-45d0-8cba-82d24f516d92.sql statement 4
CREATE POLICY "Uploader or admin update EMR attachments" ON public.emr_attachments
  FOR UPDATE TO authenticated
  USING ((uploaded_by = public.hms_current_user_id()) OR has_role(public.hms_current_user_id(), 'admin'::app_role))
  WITH CHECK ((uploaded_by = public.hms_current_user_id()) OR has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260728094016_1373792c-cea5-45d0-8cba-82d24f516d92.sql statement 5
DROP POLICY "Fulfillers update only paid snap orders" ON public.snap_orders;

-- SOURCE: 20260728094016_1373792c-cea5-45d0-8cba-82d24f516d92.sql statement 6
CREATE POLICY "Fulfillers update only paid snap orders" ON public.snap_orders
  FOR UPDATE TO authenticated
  USING ((status = 'paid'::text) AND (((target_station = 'pharmacy'::text) AND has_role(public.hms_current_user_id(), 'pharmacist'::app_role)) OR ((target_station = 'lab'::text) AND has_role(public.hms_current_user_id(), 'lab_tech'::app_role))))
  WITH CHECK ((status = ANY (ARRAY['paid'::text, 'fulfilled'::text, 'rejected'::text])) AND (((target_station = 'pharmacy'::text) AND has_role(public.hms_current_user_id(), 'pharmacist'::app_role)) OR ((target_station = 'lab'::text) AND has_role(public.hms_current_user_id(), 'lab_tech'::app_role))));

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

AS $$
DECLARE
  v_invoice public.invoices;
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
  IF (v_invoice).id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF (v_invoice).status = 'paid' THEN
    RAISE EXCEPTION 'Invoice already settled';
  END IF;

  -- Deduct from wallet balance (with concurrency-safe check).
  IF _balance_amount > 0 THEN
    SELECT balance INTO v_available
    FROM public.patients
    WHERE id = (v_invoice).patient_id
    FOR UPDATE;

    IF v_available IS NULL OR v_available < _balance_amount THEN
      RAISE EXCEPTION 'Insufficient wallet balance (available: %, requested: %)',
        COALESCE(v_available, 0), _balance_amount;
    END IF;

    SELECT public.adjust_patient_balance(
      (v_invoice).patient_id,
      -_balance_amount,
      'invoice_deduction',
      'balance',
      NULL,
      _invoice_id,
      COALESCE(_notes, format('Applied to invoice %s', (v_invoice).invoice_number))
    );
  END IF;

  -- Record shortfall as patient debt for cash accounts.
  IF _debt_amount > 0 THEN
    SELECT public.adjust_patient_balance(
      (v_invoice).patient_id,
      -_debt_amount,
      'debt_incurred',
      _payment_method,
      NULL,
      _invoice_id,
      format('Shortfall on invoice %s', (v_invoice).invoice_number)
    );
  END IF;

  v_collected := COALESCE((v_invoice).paid_amount, 0) + _cash_amount + _balance_amount;

  UPDATE public.invoices
  SET paid_amount    = v_collected,
      status         = 'paid',
      payment_method = _payment_method,
      paid_at        = now(),
      notes          = COALESCE(_notes, notes),
      updated_at     = now()
  WHERE id = _invoice_id;

  SELECT balance INTO v_new_balance FROM public.patients WHERE id = (v_invoice).patient_id;

  RETURN jsonb_build_object(
    'invoice_id',       _invoice_id,
    'invoice_number',   (v_invoice).invoice_number,
    'patient_id',       (v_invoice).patient_id,
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

AS $$
DECLARE
  v_snap public.snap_orders;
  v_uid  uuid := public.hms_current_user_id();
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
  IF (v_snap).id IS NULL THEN
    RAISE EXCEPTION 'Snap order % not found', _snap_id;
  END IF;
  IF (v_snap).target_station <> 'pharmacy' OR (v_snap).order_type <> 'prescription' THEN
    RAISE EXCEPTION 'Snap % is not a pharmacy prescription snap', _snap_id;
  END IF;
  IF (v_snap).status NOT IN ('paid','fulfilled') THEN
    RAISE EXCEPTION 'Snap % must be paid before creating a prescription (status=%)', _snap_id, (v_snap).status;
  END IF;

  INSERT INTO public.prescriptions (patient_id, visit_id, diagnosis, notes, status, created_by)
  VALUES ((v_snap).patient_id, (v_snap).visit_id, _diagnosis, _notes, 'dispensed', v_uid::text)
  RETURNING id INTO v_prescription_id;
  INSERT INTO public.prescription_items
    (prescription_id, medication, dosage, frequency, duration, quantity, dispensed)
  SELECT
    v_prescription_id,
    COALESCE(item.value->>'medication', item.value->>'name', 'Unknown'),
    COALESCE(item.value->>'dosage', ''),
    COALESCE(item.value->>'frequency', ''),
    COALESCE(item.value->>'duration', ''),
    COALESCE((item.value->>'quantity')::int, (item.value->>'qty')::int, 1),
    true
  FROM jsonb_array_elements(COALESCE(_items, '[]'::jsonb)) AS item(value);

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

AS $$
DECLARE
  v_snap public.snap_orders;
  v_uid  uuid := public.hms_current_user_id();
  v_lab_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_any_role(v_uid, ARRAY['lab_tech','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only lab technicians can materialise lab requests from snaps';
  END IF;

  SELECT * INTO v_snap FROM public.snap_orders WHERE id = _snap_id FOR UPDATE;
  IF (v_snap).id IS NULL THEN
    RAISE EXCEPTION 'Snap order % not found', _snap_id;
  END IF;
  IF (v_snap).target_station <> 'lab' OR (v_snap).order_type NOT IN ('lab','lab_result') THEN
    RAISE EXCEPTION 'Snap % is not a lab snap', _snap_id;
  END IF;
  IF (v_snap).status NOT IN ('paid','fulfilled') THEN
    RAISE EXCEPTION 'Snap % must be paid before creating a lab request (status=%)', _snap_id, (v_snap).status;
  END IF;
  IF _tests IS NULL OR array_length(_tests, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one test is required';
  END IF;

  INSERT INTO public.lab_requests
    (patient_id, visit_id, tests, diagnosis, status, requested_by, requested_at, printed)
  VALUES (
    (v_snap).patient_id, (v_snap).visit_id, _tests, _diagnosis,
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

AS $$
BEGIN
  -- Advance the linked snap to "paid" as soon as the invoice is marked paid,
  -- regardless of whether the money came from the patient or a sponsor claim.
  IF (NEW).status = 'paid'
     AND (TG_OP = 'INSERT' OR COALESCE((OLD).status, '') <> 'paid') THEN
    UPDATE public.snap_orders
       SET status = 'paid', paid_at = now(), updated_at = now()
     WHERE invoice_id = (NEW).id
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
AS $$
DECLARE
  healed_snaps int := 0;
  healed_patients int := 0;
BEGIN
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

  WITH candidates AS (
    SELECT p.id, public.patient_pending_workflow_station(p.id) AS next_station
      FROM public.patients p
     WHERE p.status = 'awaiting_payment'
       AND NOT EXISTS (
         SELECT 1 FROM public.invoices i
          WHERE i.patient_id = p.id
            AND i.status IN ('pending','partial')
       )
  ), updated AS (
    UPDATE public.patients p
       SET status = COALESCE(c.next_station, 'discharged'), updated_at = now()
      FROM candidates c
     WHERE p.id = c.id
       AND c.next_station IS DISTINCT FROM 'awaiting_payment'
    RETURNING p.id
  )
  SELECT count(*) INTO healed_patients FROM updated;

  RETURN jsonb_build_object(
    'healed_snaps', healed_snaps,
    'healed_patients', healed_patients,
    'ran_at', now()
  );
END;
$$;

-- SOURCE: 20260728115107_66ef34e1-f8ce-4524-a2ca-2c732f5822f1.sql statement 2
GRANT EXECUTE ON FUNCTION public.reconcile_paid_snap_orders() TO authenticated, service_role;

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

AS $$
DECLARE
  _uid uuid := public.hms_current_user_id();
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

AS $$
DECLARE
  _uid uuid := public.hms_current_user_id();
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

AS $$
DECLARE
  _result jsonb := '{}'::jsonb;
  _n bigint;
  _has text[] := _modules;
BEGIN
  IF NOT public.has_role(public.hms_current_user_id(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can purge clinical data';
  END IF;

  -- Order: dependents first
  IF 'tasks' = ANY(_has) THEN
    SELECT count(*) INTO _n FROM public.task_claims;
    DELETE FROM public.task_claims;
    _result := _result || jsonb_build_object('task_claims', _n);
  END IF;

  IF 'notifications' = ANY(_has) THEN
    SELECT count(*) INTO _n FROM public.notifications;
    DELETE FROM public.notifications;
    _result := _result || jsonb_build_object('notifications', _n);
  END IF;

  IF 'errors' = ANY(_has) THEN
    SELECT count(*) INTO _n FROM public.error_logs;
    DELETE FROM public.error_logs;
    _result := _result || jsonb_build_object('error_logs', _n);
  END IF;

  IF 'audit' = ANY(_has) THEN
    SELECT count(*) INTO _n FROM public.audit_logs;
    DELETE FROM public.audit_logs;
    _result := _result || jsonb_build_object('audit_logs', _n);
  END IF;

  IF 'lab' = ANY(_has) THEN
    SELECT count(*) INTO _n FROM public.lab_requests;
    DELETE FROM public.lab_requests;
    _result := _result || jsonb_build_object('lab_requests', _n);
  END IF;

  IF 'prescriptions' = ANY(_has) THEN
    SELECT count(*) INTO _n FROM public.prescription_items;
    DELETE FROM public.prescription_items;
    _result := _result || jsonb_build_object('prescription_items', _n);
    SELECT count(*) INTO _n FROM public.prescriptions;
    DELETE FROM public.prescriptions;
    _result := _result || jsonb_build_object('prescriptions', _n);
  END IF;

  IF 'billing' = ANY(_has) THEN
    SELECT count(*) INTO _n FROM public.invoice_items;
    DELETE FROM public.invoice_items;
    _result := _result || jsonb_build_object('invoice_items', _n);
    SELECT count(*) INTO _n FROM public.sponsor_statement_items;
    DELETE FROM public.sponsor_statement_items;
    _result := _result || jsonb_build_object('sponsor_statement_items', _n);
    SELECT count(*) INTO _n FROM public.sponsor_statements;
    DELETE FROM public.sponsor_statements;
    _result := _result || jsonb_build_object('sponsor_statements', _n);
    SELECT count(*) INTO _n FROM public.insurance_claims;
    DELETE FROM public.insurance_claims;
    _result := _result || jsonb_build_object('insurance_claims', _n);
    SELECT count(*) INTO _n FROM public.corporate_transactions;
    DELETE FROM public.corporate_transactions;
    _result := _result || jsonb_build_object('corporate_transactions', _n);
    SELECT count(*) INTO _n FROM public.balance_transactions;
    DELETE FROM public.balance_transactions;
    _result := _result || jsonb_build_object('balance_transactions', _n);
    SELECT count(*) INTO _n FROM public.balance_requests;
    DELETE FROM public.balance_requests;
    _result := _result || jsonb_build_object('balance_requests', _n);
    SELECT count(*) INTO _n FROM public.invoices;
    DELETE FROM public.invoices;
    _result := _result || jsonb_build_object('invoices', _n);
  END IF;

  IF 'snaps' = ANY(_has) THEN
    SELECT count(*) INTO _n FROM public.snap_orders;
    DELETE FROM public.snap_orders;
    _result := _result || jsonb_build_object('snap_orders', _n);
  END IF;

  IF 'admissions' = ANY(_has) THEN
    SELECT count(*) INTO _n FROM public.admissions;
    DELETE FROM public.admissions;
    _result := _result || jsonb_build_object('admissions', _n);
    SELECT count(*) INTO _n FROM public.beds WHERE status <> 'available';
    UPDATE public.beds SET status = 'available' WHERE status <> 'available';
    _result := _result || jsonb_build_object('beds_reset', _n);
  END IF;

  IF 'anc' = ANY(_has) THEN
    -- DELETE FROM public.anc_visits; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('anc_visits', _n);
    -- DELETE FROM public.anc_programs; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('anc_programs', _n);
  END IF;

  IF 'visits' = ANY(_has) THEN
    SELECT count(*) INTO _n FROM public.visit_attachments;
    DELETE FROM public.visit_attachments;
    _result := _result || jsonb_build_object('visit_attachments', _n);
    SELECT count(*) INTO _n FROM public.emr_attachments;
    DELETE FROM public.emr_attachments;
    _result := _result || jsonb_build_object('emr_attachments', _n);
    SELECT count(*) INTO _n FROM public.vitals;
    DELETE FROM public.vitals;
    _result := _result || jsonb_build_object('vitals', _n);
    SELECT count(*) INTO _n FROM public.patient_journey_history;
    DELETE FROM public.patient_journey_history;
    _result := _result || jsonb_build_object('patient_journey_history', _n);
    SELECT count(*) INTO _n FROM public.patient_journey;
    DELETE FROM public.patient_journey;
    _result := _result || jsonb_build_object('patient_journey', _n);
    SELECT count(*) INTO _n FROM public.visits;
    DELETE FROM public.visits;
    _result := _result || jsonb_build_object('visits', _n);
  END IF;

  IF 'patients' = ANY(_has) THEN
    SELECT count(*) INTO _n FROM public.patients;
    DELETE FROM public.patients;
    _result := _result || jsonb_build_object('patients', _n);
  END IF;

  RETURN _result;
END;
$$;

-- SOURCE: 20260729001714_737ee12c-4f53-47c9-9deb-a742d2ee977f.sql statement 2
REVOKE ALL ON FUNCTION public.purge_clinical_data(text[]) FROM PUBLIC, anon;
