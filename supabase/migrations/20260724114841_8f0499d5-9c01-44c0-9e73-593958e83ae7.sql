
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT i.id, i.invoice_number, i.paid_amount, i.payment_method
    FROM invoices i JOIN patients p ON p.id=i.patient_id
    WHERE i.invoice_number IN ('INV-MRYSJHBG-EQRO','INV-MRYTKMKU-3NL2','INV-MRYTRICH-VO5O','INV-MRYU34VI-KZR1','INV-MRYVAZXF-0NZR')
      AND lower(coalesce(p.account_type,'')) NOT IN ('','normal','cash')
  LOOP
    UPDATE invoices
       SET paid_amount = 0,
           status = 'pending',
           payment_method = 'sponsor_claim',
           paid_at = NULL,
           notes = coalesce(notes,'') || ' | reconciled: sponsor 100% cover, wallet not applicable'
     WHERE id = r.id;

    INSERT INTO audit_logs(action, resource_type, resource_id, details, status, actor_role)
    VALUES ('invoice_reconciled_to_sponsor','invoice', r.id::text,
            jsonb_build_object('invoice_number', r.invoice_number,
                               'previous_paid_amount', r.paid_amount,
                               'previous_payment_method', r.payment_method,
                               'reason','legacy HMO invoice wrongly recorded as patient payment'),
            'success','system');
  END LOOP;
END $$;
