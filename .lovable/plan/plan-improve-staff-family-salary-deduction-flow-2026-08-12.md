# Plan: Improve Staff Family Salary Deduction Flow

The goal is to enhance the Cashier experience for "Staff Family" patients. When selecting "Deduct from salary", the system will now default to deducting the full remaining 50% copay, but also allow the user to easily split the payment (e.g., partial salary deduction and partial cash/POS/transfer).

## Proposed Changes

### 1. UI Enhancements in CashierPanel.tsx
- Update the **Salary Deduction** section in the payment dialog.
- Default the deduction amount to the full outstanding copay when enabled.
- Add an information badge/note explaining that for Staff Family, the 50% copay can be settled via salary deduction.
- Ensure the "Summary" section correctly reflects mixed payments (Salary Deduction + Cash/POS/Balance).
- Update the logic to allow proceeding when a combination of salary deduction and other methods covers the full copay.

### 2. Business Logic updates
- Refine `isSalaryDeduction` toggle behavior to handle the split between cash and deduction more intuitively.
- Update the `submit` function's validation to ensure that `salaryDeductionAmount + cash + bal` equals the `outstanding` copay for sponsored patients.

### 3. UX improvements
- Improve visual feedback for Staff Family members in the queue, clearly showing their 50% copay status.
- Add a quick-toggle or clear indicator for "Deduct 50% from Salary".

## Technical Details

- **File**: `src/components/billing/CashierPanel.tsx`
- **Logic**: 
    - `outstanding`: The amount the patient is responsible for (50% for Staff Family).
    - `applied`: `cash + balanceAmount + salaryDeductionAmount`.
    - Validation: For Staff Family, `applied` must equal `outstanding` to proceed (sponsored rule).
- **Database**: No schema changes required as `settle_invoice_atomic` and `payment_received` audit logs already support `is_salary_deduction` and `salary_deduction_amount`.
