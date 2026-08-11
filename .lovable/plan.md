# Plan - Fix Opening Credit Initialization Error

The user reported an error "patient created but credit initialization failed" when registering an "Old Patient" with an opening credit. Investigation reveals that the `adjust_patient_balance` RPC is called with `_transaction_type: 'correction'`. The database constraint `balance_transactions_transaction_type_check` only allows specific types, and `'correction'` is not one of them.

## Proposed Changes

### Frontend (Reception)
- In `src/pages/Reception.tsx`, change the transaction type from `'correction'` to `'topup'` when initializing opening credit. The allowed types in the database are: `topup`, `refund`, `invoice_deduction`, `staff_family_coverage`, `staff_coverage`, `adjustment`, `debt_incurred`, `debt_cleared`, `admitted_deduction`, and `overpayment_credit`.
- Using `'topup'` is the most appropriate for adding an initial balance credit.

## Technical Details
- File: `src/pages/Reception.tsx`
- Location: `NewPatientForm` -> `handleSubmit`
- Change: `_transaction_type: 'correction'` -> `_transaction_type: 'topup'`

## Verification Plan
1. Register an existing patient with an opening credit (e.g., 5000).
2. Verify that the success message appears without errors.
3. Check the patient's wallet balance to ensure it reflects the credit.
