import { describe, expect, it } from 'vitest';
import { calculatePayrollTotals, canonicalizePayrollValues, DEFAULT_PAYROLL_LABELS, PAYROLL_COLUMNS, preserveNonGridDeductions } from './payroll';

describe('payroll contract', () => {
  it('keeps 1st APP and GL as recorded values without adding them to gross', () => {
    const result = calculatePayrollTotals(
      100000,
      { first_appointment: 'APP-05', hours: 'GL-04', housing: 20000, transport: 10000 },
      {},
    );
    expect(result.allowances.first_app).toBe('APP-05');
    expect(result.allowances.gl).toBe('GL-04');
    expect(result.grossPay).toBe(130000);
    expect(Number(result.allowances.first_app)).toBeNaN();
    expect(Number(result.allowances.gl)).toBeNaN();
  });

  it('maps legacy allowance and deduction keys into the requested columns', () => {
    const result = canonicalizePayrollValues(
      { sl: 1000, la: 2000, dh: 3000, no: 4000, extra: 5000 },
      { loan: 6000, pension: 7000 },
    );
    expect(result.allowances).toMatchObject({ ls: 1000, del: 2000, enter: 3000, na: 4000, hazard: 5000 });
    expect(result.deductions).toMatchObject({ personal_loan: 6000, contribution: 7000 });
  });

  it('calculates total deductions and net pay from the approved columns only', () => {
    const result = calculatePayrollTotals(100000, { house: 20000, hazard: 5000 }, { paye: 10000, advce: 5000, plty: 1000 });
    expect(result.grossPay).toBe(125000);
    expect(result.totalDeductions).toBe(16000);
    expect(result.netPay).toBe(109000);
  });

  it('preserves non-grid reporting deductions without adding them to payroll totals', () => {
    const totals = calculatePayrollTotals(100000, {}, { family_medical: 5000 });
    const deductions = preserveNonGridDeductions({ family_medical: 5000 }, totals.deductions);
    expect(deductions.family_medical).toBe(5000);
    expect(totals.totalDeductions).toBe(0);
    expect(totals.netPay).toBe(100000);
  });

  it('defines the exact requested order and defaults', () => {
    expect(PAYROLL_COLUMNS.map(column => column.key)).toEqual([
      'id', 'staff_name', 'designation', 'first_app', 'gl', 'basic_salary', 'house', 'transport',
      'ls', 'del', 'call', 'resp', 'ot', 'leave', 'enter', 'na', 'hazard', 'gross_pay',
      'plty', 'paye', 'contribution', 'advce', 'personal_loan', 'total_deductions', 'net_pay',
    ]);
    expect(DEFAULT_PAYROLL_LABELS['gross_pay']).toBe('GROSS PAY');
  });
});
