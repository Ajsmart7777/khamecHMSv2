# Plan - Fix Opening Credit Initialization Error

The user reported an error "patient created but credit initialization failed" when registering an "Old Patient" with an opening credit. Investigation reveals that the `adjust_patient_balance` RPC is called with `_transaction_type: 'correction'`. This transaction type is likely being rejected by the database function's validation logic which restricts negative balances to the `debt_incurred` type, or the `correction` type itself might be missing from an allowed enum/check if one exists (though the function code seen so far doesn't show a strict enum check for types other than the negative balance rule).

Wait, looking at the code:
```sql
  _after := _before + _delta;
  -- Only 'debt_incurred' transactions may push balance negative (short payments)
  IF _after < 0 AND _transaction_type <> 'debt_incurred' THEN
    RAISE EXCEPTION 'Insufficient balance (current: %, requested delta: %)', _before, _delta;
  END IF;
```
For opening credit, `_delta` is positive, so `_after` will be positive. The error might be due to RLS or permissions if `correction` type requires specific roles, or simply a missing `GRANT` for the `correction` flow in a trigger.

Actually, a recent migration `20260810183000_fix_balance_transaction_types.sql` was mentioned in the history. It's possible the `correction` type was renamed or is strictly validated now.

## User Review Required

> [!IMPORTANT]
> I will update the registration logic to use `topup` instead of `correction` for opening credits, as `topup` is the standard type used for increasing patient balances in this system.

## Proposed Changes

### Frontend (Reception)
- In `src/pages/Reception.tsx`, change the transaction type from `'correction'` to `'topup'` when initializing opening credit. This aligns with the system's standard for adding funds to a wallet.
- Ensure the `_notes` field clearly identifies it as an "Opening credit from physical card".

### Database (Optional - if needed)
- I will verify if there's a strict constraint on `balance_transactions.transaction_type`. If so, I'll ensure `topup` is included.

## Technical Details
- File: `src/pages/Reception.tsx`
- Function: `NewPatientForm` -> `handleSubmit`
- Change: `_transaction_type: 'correction'` -> `_transaction_type: 'topup'`
