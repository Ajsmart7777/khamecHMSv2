# Plan: Payroll Family Deductions Integration

The objective is to ensure that medical bills marked as "Salary Deduction" for staff family members are automatically captured in the monthly payroll cycle. This includes automatic calculation when adding staff to a payroll period and ensuring these deductions are visible in the payroll management interface.

## User Review Required

> [!IMPORTANT]
> - The system will now automatically look for paid invoices marked as "Salary Deduction" within the specific month and year of the payroll period.
> - A new column "Family Med" is added to the payroll table to track these specific deductions.

## Technical Details

### Database Changes
- Implement `public.calculate_payroll_deductions` function to sum up `is_salary_deduction` invoices for a staff member within a specific date range.

### Frontend Changes
- **src/hooks/usePayroll.ts**:
    - Update `addAllStaff` to call `calculate_payroll_deductions` for the selected period's date range.
    - Automatically populate the `family_medical` deduction key in the payroll entry.
- **src/components/payroll/PayrollManager.tsx**:
    - Add `family_medical` to the `DEFAULT_DEDUCTION_KEYS` so it appears as a dedicated column in the payroll table.
- **src/components/account/StaffFamilyDeductions.tsx**:
    - (Optional/Refinement) Ensure clarity that these records flow into payroll.

### Verification Plan
- Create a payroll period for a specific month.
- Record a salary deduction for a staff member's family in that same month.
- Click "Add All Staff" in the payroll manager and verify the "Family Med" column matches the deduction amount.
