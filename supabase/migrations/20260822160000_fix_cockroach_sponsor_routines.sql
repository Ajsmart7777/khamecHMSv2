-- CockroachDB compatibility repair for active Corporate/Retainer finance workflows.
-- The Supabase source functions use auth.uid(); the clone uses hms_current_user_id().
-- This migration is intentionally scoped to the CockroachDB clone.

CREATE OR REPLACE FUNCTION public.delete_unused_sponsor_account(
  p_sponsor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_account_id uuid;
  v_account_type text;
  v_balance numeric;
  v_linked_patient_count integer := 0;
  v_invoice_count integer := 0;
  v_claim_count integer := 0;
  v_transaction_count integer := 0;
  v_statement_item_count integer := 0;
  v_manual_item_count integer := 0;
  v_manual_service_count integer := 0;
  v_statement_payment_count integer := 0;
  v_nonzero_statement_count integer := 0;
  v_account_label text;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['billing','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only billing staff and administrators can remove sponsor accounts.';
  END IF;

  SELECT ca.id, ca.account_type, ca.balance
  INTO v_account_id, v_account_type, v_balance
  FROM public.corporate_accounts ca
  WHERE ca.id = p_sponsor_id
  FOR UPDATE;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Sponsor account not found.';
  END IF;

  v_account_label := CASE WHEN v_account_type = 'retainer' THEN 'Retainer' ELSE 'Corporate' END;

  SELECT count(*) INTO v_linked_patient_count
  FROM public.patients WHERE corporate_id = p_sponsor_id::text;

  SELECT count(*) INTO v_invoice_count
  FROM public.invoices WHERE corporate_account_id = p_sponsor_id;

  SELECT count(*) INTO v_claim_count
  FROM public.insurance_claims WHERE corporate_account_id = p_sponsor_id;

  SELECT count(*) INTO v_transaction_count
  FROM public.corporate_transactions WHERE sponsor_id = p_sponsor_id;

  SELECT count(*) INTO v_statement_item_count
  FROM public.sponsor_statement_items ssi
  JOIN public.sponsor_statements ss ON ss.id = ssi.statement_id
  WHERE ss.sponsor_id = p_sponsor_id;

  SELECT count(*) INTO v_manual_item_count
  FROM public.corporate_statement_manual_items csmi
  JOIN public.sponsor_statements ss ON ss.id = csmi.statement_id
  WHERE ss.sponsor_id = p_sponsor_id;

  SELECT count(*) INTO v_manual_service_count
  FROM public.corporate_manual_service_rows
  WHERE sponsor_id = p_sponsor_id;

  SELECT count(*) INTO v_statement_payment_count
  FROM public.corporate_statement_payments
  WHERE sponsor_id = p_sponsor_id;

  SELECT count(*) INTO v_nonzero_statement_count
  FROM public.sponsor_statements
  WHERE sponsor_id = p_sponsor_id AND total_amount <> 0;

  IF v_linked_patient_count > 0
     OR v_invoice_count > 0
     OR v_claim_count > 0
     OR v_transaction_count > 0
     OR v_statement_item_count > 0
     OR v_manual_item_count > 0
     OR v_manual_service_count > 0
     OR v_statement_payment_count > 0
     OR v_nonzero_statement_count > 0
     OR v_balance <> 0 THEN
    UPDATE public.corporate_accounts
    SET status = 'suspended', updated_at = now()
    WHERE id = p_sponsor_id AND status <> 'suspended';

    SELECT public.write_audit_log(
      'sponsor_account_suspended'::text,
      jsonb_build_object(
        'account_type', v_account_type,
        'linked_patient_count', v_linked_patient_count,
        'invoice_count', v_invoice_count,
        'claim_count', v_claim_count,
        'transaction_count', v_transaction_count,
        'statement_count', v_nonzero_statement_count,
        'remaining_balance', v_balance
      )::jsonb,
      p_sponsor_id::uuid,
      'corporate_account'::text,
      'success'::text
    );

    RETURN jsonb_build_object(
      'action', 'suspended',
      'account_type', v_account_type,
      'message', format('%s account was not deleted because it has linked patients, balance, or financial history. It has been suspended so no new patients or services should be assigned to it; its records remain available for audit.', v_account_label),
      'linked_patient_count', v_linked_patient_count,
      'invoice_count', v_invoice_count,
      'statement_count', v_nonzero_statement_count,
      'transaction_count', v_transaction_count,
      'manual_service_count', v_manual_service_count,
      'remaining_balance', v_balance
    );
  END IF;

  DELETE FROM public.sponsor_statements WHERE sponsor_id = p_sponsor_id;
  DELETE FROM public.corporate_accounts WHERE id = p_sponsor_id;

  SELECT public.write_audit_log(
    'sponsor_account_deleted'::text,
    jsonb_build_object('account_type', v_account_type)::jsonb,
    p_sponsor_id::uuid,
    'corporate_account'::text,
    'success'::text
  );

  RETURN jsonb_build_object(
    'action', 'deleted',
    'account_type', v_account_type,
    'message', format('%s account and its empty setup reports were deleted.', v_account_label)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_unused_sponsor_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_unused_sponsor_account(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.retainer_deposit(
  _sponsor_id uuid,
  _amount numeric,
  _notes text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid uuid := public.hms_current_user_id();
  v_sponsor_id uuid;
  v_sponsor_type text;
  v_balance numeric(14,2);
  v_new_balance numeric(14,2);
BEGIN
  IF NOT public.has_any_role(v_uid, ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  SELECT ca.id, ca.account_type, ca.balance
  INTO v_sponsor_id, v_sponsor_type, v_balance
  FROM public.corporate_accounts ca
  WHERE ca.id = _sponsor_id
  FOR UPDATE;

  IF v_sponsor_id IS NULL THEN
    RAISE EXCEPTION 'Sponsor not found';
  END IF;
  IF v_sponsor_type <> 'retainer' THEN
    RAISE EXCEPTION 'Retainer deposits only apply to retainer sponsors';
  END IF;

  v_new_balance := v_balance + _amount;

  UPDATE public.corporate_accounts
  SET balance = v_new_balance, updated_at = now()
  WHERE id = _sponsor_id;

  INSERT INTO public.corporate_transactions (
    sponsor_id, transaction_type, amount, balance_before, balance_after,
    transaction_date, payment_method, bank_reference, notes, performed_by
  ) VALUES (
    _sponsor_id, 'deposit', _amount, v_balance, v_new_balance,
    CURRENT_DATE, 'bank_transfer', NULL, _notes, v_uid
  );

  SELECT public.write_audit_log(
    'sponsor_deposit'::text,
    jsonb_build_object('amount', _amount, 'new_balance', v_new_balance, 'notes', _notes)::jsonb,
    _sponsor_id::uuid,
    'corporate_account'::text,
    'success'::text
  );

  RETURN v_new_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.retainer_deposit(uuid, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.settle_retainer_statement(
  _statement_id uuid,
  _amount_received numeric,
  _payment_date date,
  _payment_method text DEFAULT 'bank_transfer',
  _bank_reference text DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid uuid := public.hms_current_user_id();
  v_statement_id uuid;
  v_sponsor_id uuid;
  v_statement_number text;
  v_statement_total numeric(14,2);
  v_statement_status text;
  v_account_type text;
  v_sponsor_balance numeric(14,2);
  v_balance_before numeric(14,2);
  v_balance_after_receipt numeric(14,2);
  v_balance_after_application numeric(14,2);
  v_already_applied numeric(14,2) := 0;
  v_outstanding_before numeric(14,2) := 0;
  v_applied_now numeric(14,2) := 0;
  v_outstanding_after numeric(14,2) := 0;
  v_final_status text;
BEGIN
  IF NOT public.has_any_role(v_uid, ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _amount_received IS NULL OR _amount_received < 0 THEN
    RAISE EXCEPTION 'Received amount cannot be negative';
  END IF;
  IF _payment_date IS NULL THEN
    RAISE EXCEPTION 'Payment date is required';
  END IF;

  SELECT ss.id, ss.sponsor_id, ss.statement_number, ss.total_amount, ss.status,
         ca.account_type, ca.balance
  INTO v_statement_id, v_sponsor_id, v_statement_number, v_statement_total, v_statement_status,
       v_account_type, v_sponsor_balance
  FROM public.sponsor_statements ss
  JOIN public.corporate_accounts ca ON ca.id = ss.sponsor_id
  WHERE ss.id = _statement_id
  FOR UPDATE;

  IF v_statement_id IS NULL THEN
    RAISE EXCEPTION 'Statement not found';
  END IF;
  IF v_account_type <> 'retainer' THEN
    RAISE EXCEPTION 'This settlement workflow only applies to retainer statements';
  END IF;
  IF v_statement_status IN ('paid', 'void') THEN
    RAISE EXCEPTION 'Statement is already % — no further settlement can be applied', v_statement_status;
  END IF;

  SELECT COALESCE(SUM(-ct.amount), 0)
  INTO v_already_applied
  FROM public.corporate_transactions ct
  WHERE ct.related_statement_id = _statement_id
    AND ct.transaction_type = 'monthly_deduction';

  v_outstanding_before := GREATEST(v_statement_total - v_already_applied, 0);
  v_balance_before := v_sponsor_balance;
  v_balance_after_receipt := v_balance_before;

  IF _amount_received > 0 THEN
    v_balance_after_receipt := v_balance_before + _amount_received;

    UPDATE public.corporate_accounts
    SET balance = v_balance_after_receipt, updated_at = now()
    WHERE id = v_sponsor_id;

    INSERT INTO public.corporate_transactions (
      sponsor_id, transaction_type, amount, balance_before, balance_after,
      related_statement_id, transaction_date, payment_method, bank_reference, notes, performed_by
    ) VALUES (
      v_sponsor_id, 'deposit', _amount_received, v_balance_before, v_balance_after_receipt,
      _statement_id, _payment_date, COALESCE(NULLIF(_payment_method, ''), 'bank_transfer'),
      NULLIF(_bank_reference, ''), NULLIF(_notes, ''), v_uid
    );
  END IF;

  v_applied_now := LEAST(v_balance_after_receipt, v_outstanding_before);
  v_balance_after_application := v_balance_after_receipt - v_applied_now;
  v_outstanding_after := v_outstanding_before - v_applied_now;
  v_final_status := CASE WHEN v_outstanding_after = 0 THEN 'paid' ELSE 'finalized' END;

  IF v_applied_now > 0 THEN
    UPDATE public.corporate_accounts
    SET balance = v_balance_after_application, updated_at = now()
    WHERE id = v_sponsor_id;

    INSERT INTO public.corporate_transactions (
      sponsor_id, transaction_type, amount, balance_before, balance_after,
      related_statement_id, transaction_date, payment_method, bank_reference, notes, performed_by
    ) VALUES (
      v_sponsor_id, 'monthly_deduction', -v_applied_now,
      v_balance_after_receipt, v_balance_after_application,
      _statement_id, _payment_date, NULL, NULL,
      COALESCE(NULLIF(_notes, ''), 'Retainer funding applied to statement ' || v_statement_number), v_uid
    );
  END IF;

  UPDATE public.sponsor_statements
  SET status = v_final_status,
      finalized_at = COALESCE(finalized_at, now()),
      paid_at = CASE WHEN v_final_status = 'paid' THEN now() ELSE paid_at END,
      updated_at = now()
  WHERE id = _statement_id;

  SELECT public.write_audit_log(
    'retainer_statement_settled'::text,
    jsonb_build_object(
      'sponsor_id', v_sponsor_id,
      'statement_number', v_statement_number,
      'amount_received', _amount_received,
      'applied_now', v_applied_now,
      'outstanding_after', v_outstanding_after,
      'available_deposit_balance', v_balance_after_application,
      'payment_date', _payment_date,
      'payment_method', _payment_method,
      'bank_reference', NULLIF(_bank_reference, '')
    )::jsonb,
    _statement_id::uuid,
    'sponsor_statement'::text,
    'success'::text
  );

  RETURN jsonb_build_object(
    'statement_id', _statement_id,
    'received', _amount_received,
    'applied', v_applied_now,
    'outstanding', v_outstanding_after,
    'available_deposit_balance', v_balance_after_application,
    'credit', GREATEST(v_balance_after_application, 0),
    'status', v_final_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_retainer_statement(uuid, numeric, date, text, text, text) TO authenticated;

