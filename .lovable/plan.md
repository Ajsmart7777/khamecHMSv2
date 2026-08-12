# Payroll Medical Deduction Transparency

Implement a clickable "Family Med" column in the payroll table that opens a dialog showing the specific medical bills contributing to the deduction.

## User Review Required

> [!IMPORTANT]
> The current system stores the medical deduction as a snapshot value at the time the payroll entry is created. If new medical bills are added after the entry is created, the "Family Med" column will show the saved snapshot, but the drill-down view will dynamically fetch the current matching bills for that period.

- Should I add a "Refresh" button in the drill-down dialog to update the snapshot value if it differs from the current database total?

## Proposed Changes

### Database
- No schema changes required. Existing `invoices` table and `calculate_payroll_deductions` RPC provide enough data.

### Frontend

#### `src/hooks/usePayroll.ts`
- Add `useMedicalDeductionDetails(staffId, month, year)` hook to fetch detailed invoices (`invoice_number`, `paid_at`, `paid_amount`, `patient_name`) for a specific staff member and period.

#### `src/components/payroll/MedicalDeductionDetails.tsx` (New)
- Create a dialog component to display a table of medical bills.
- Show columns: Date, Patient, Invoice #, and Amount.
- Include a "Total" footer.

#### `src/components/payroll/PayrollManager.tsx`
- Modify `renderEditableCell` or the specific rendering logic for `family_medical` to make it a clickable button/link.
- Integrate the `MedicalDeductionDetails` dialog.
- Add a visual indicator (e.g., an "info" or "external-link" icon) to show it's clickable.

## Technical Details
- Drill-down query will filter `invoices` by:
    - `staff_sponsor_id = _staff_id`
    - `is_salary_deduction = true`
    - `status = 'paid'`
    - `paid_at` within the start/end of the selected month/year.
- The UI will handle cases where no bills are found (e.g., if the deduction was manually overridden).
