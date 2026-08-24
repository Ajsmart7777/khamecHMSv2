import { describe, expect, it } from 'vitest';
import { splitPayrollPaymentEntries } from './payrollReports';

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: String(overrides.id || Math.random()),
  payroll_period_id: 'period',
  staff_id: 'staff',
  staff_employee_id: 'EMP-1',
  staff_name: 'Staff',
  staff_designation: 'Nurse',
  staff_payment_method: 'cash',
  staff_bank_name: null,
  staff_account_number: null,
  basic_salary: 100,
  allowances: {},
  gross_pay: 100,
  deductions: {},
  total_deductions: 0,
  net_pay: 100,
  status: 'pending',
  payment_reference: null,
  ...overrides,
}) as any;

describe('payroll report payment groups', () => {
  it('puts only complete bank records in Bank Schedule', () => {
    const groups = splitPayrollPaymentEntries([
      entry({ id: 'bank', staff_payment_method: 'bank', staff_bank_name: 'Bank', staff_account_number: '123' }),
      entry({ id: 'missing-account', staff_payment_method: 'bank', staff_bank_name: 'Bank', staff_account_number: null }),
      entry({ id: 'cash', staff_payment_method: 'cash' }),
    ]);
    expect(groups.bank.map(item => item.id)).toEqual(['bank']);
    expect(groups.cash.map(item => item.id)).toEqual(['cash']);
  });
});
