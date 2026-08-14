-- Safely remove unused sponsor setup records while preserving audited Corporate and Retainer history.
-- Financially active sponsors are suspended instead of deleted.

CREATE OR REPLACE FUNCTION public.delete_unused_sponsor_account(
  p_sponsor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account public.corporate_accounts%ROWTYPE;
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
  IF NOT public.has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]) THEN
    RAISE EXCEPTION 'Only billing staff and administrators can remove sponsor accounts.';
  END IF;

  SELECT *
  INTO v_account
  FROM public.corporate_accounts
  WHERE id = p_sponsor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sponsor account not found.';
  END IF;

  v_account_label := CASE
    WHEN v_account.account_type = 'retainer' THEN 'Retainer'
    ELSE 'Corporate'
  END;

  SELECT count(*)
  INTO v_linked_patient_count
  FROM public.patients
  WHERE corporate_id = p_sponsor_id;

  SELECT count(*)
  INTO v_invoice_count
  FROM public.invoices
  WHERE corporate_account_id = p_sponsor_id;

  SELECT count(*)
  INTO v_claim_count
  FROM public.insurance_claims
  WHERE corporate_account_id = p_sponsor_id;

  SELECT count(*)
  INTO v_transaction_count
  FROM public.corporate_transactions
  WHERE sponsor_id = p_sponsor_id;

  SELECT count(*)
  INTO v_statement_item_count
  FROM public.sponsor_statement_items ssi
  JOIN public.sponsor_statements ss ON ss.id = ssi.statement_id
  WHERE ss.sponsor_id = p_sponsor_id;

  SELECT count(*)
  INTO v_manual_item_count
  FROM public.corporate_statement_manual_items csmi
  JOIN public.sponsor_statements ss ON ss.id = csmi.statement_id
  WHERE ss.sponsor_id = p_sponsor_id;

  SELECT count(*)
  INTO v_manual_service_count
  FROM public.corporate_manual_service_rows
  WHERE sponsor_id = p_sponsor_id;

  SELECT count(*)
  INTO v_statement_payment_count
  FROM public.corporate_statement_payments
  WHERE sponsor_id = p_sponsor_id;

  SELECT count(*)
  INTO v_nonzero_statement_count
  FROM public.sponsor_statements
  WHERE sponsor_id = p_sponsor_id
    AND total_amount <> 0;

  IF v_linked_patient_count > 0
     OR v_invoice_count > 0
     OR v_claim_count > 0
     OR v_transaction_count > 0
     OR v_statement_item_count > 0
     OR v_manual_item_count > 0
     OR v_manual_service_count > 0
     OR v_statement_payment_count > 0
     OR v_nonzero_statement_count > 0
     OR v_account.balance <> 0 THEN
    UPDATE public.corporate_accounts
    SET status = 'suspended',
        updated_at = now()
    WHERE id = p_sponsor_id
      AND status <> 'suspended';

    RETURN jsonb_build_object(
      'action', 'suspended',
      'account_type', v_account.account_type,
      'message', format(
        '%s account was not deleted because it has linked patients, balance, or financial history. It has been suspended so no new patients or services should be assigned to it; its records remain available for audit.',
        v_account_label
      ),
      'linked_patient_count', v_linked_patient_count,
      'invoice_count', v_invoice_count,
      'statement_count', v_nonzero_statement_count,
      'transaction_count', v_transaction_count,
      'manual_service_count', v_manual_service_count,
      'remaining_balance', v_account.balance
    );
  END IF;

  -- Any remaining statements are demonstrably empty setup records with no invoice,
  -- manual-service, or payment history. Remove them before deleting the sponsor row.
  DELETE FROM public.sponsor_statements
  WHERE sponsor_id = p_sponsor_id;

  DELETE FROM public.corporate_accounts
  WHERE id = p_sponsor_id;

  RETURN jsonb_build_object(
    'action', 'deleted',
    'account_type', v_account.account_type,
    'message', format('%s account and its empty setup reports were deleted.', v_account_label)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_unused_sponsor_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_unused_sponsor_account(uuid) TO authenticated;

COMMENT ON FUNCTION public.delete_unused_sponsor_account(uuid) IS
  'Deletes sponsor accounts only when no patients, financial history, balance, manual services, or payments remain; otherwise suspends the account to preserve the audit trail.';
