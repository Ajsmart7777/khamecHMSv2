-- Widen balance_transactions_transaction_type_check to include 'overpayment_credit'
ALTER TABLE public.balance_transactions DROP CONSTRAINT IF EXISTS balance_transactions_transaction_type_check;

ALTER TABLE public.balance_transactions ADD CONSTRAINT balance_transactions_transaction_type_check
  CHECK (transaction_type = ANY (ARRAY[
    'topup',
    'refund',
    'invoice_deduction',
    'staff_family_coverage',
    'staff_coverage',
    'adjustment',
    'debt_incurred',
    'debt_cleared',
    'admitted_deduction',
    'overpayment_credit'
  ]));
