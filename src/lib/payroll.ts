export type PayrollValueMap = Record<string, number | string>;

export type PayrollColumnKind = 'identity' | 'input' | 'earning' | 'computed-earning' | 'deduction' | 'computed-deduction' | 'computed-net';

export interface PayrollColumnDefinition {
  key: string;
  label: string;
  kind: PayrollColumnKind;
}

/** The only columns shown in the payroll grid, in the approved order. */
export const PAYROLL_COLUMNS: PayrollColumnDefinition[] = [
  { key: 'id', label: 'ID', kind: 'identity' },
  { key: 'staff_name', label: 'Staff Name', kind: 'identity' },
  { key: 'designation', label: 'Designation', kind: 'identity' },
  { key: 'first_app', label: '1st APP', kind: 'input' },
  { key: 'gl', label: 'GL', kind: 'input' },
  { key: 'basic_salary', label: 'Basic', kind: 'earning' },
  { key: 'house', label: 'House', kind: 'earning' },
  { key: 'transport', label: 'Transport', kind: 'earning' },
  { key: 'ls', label: 'LS', kind: 'earning' },
  { key: 'del', label: 'DEL', kind: 'earning' },
  { key: 'call', label: 'CALL', kind: 'earning' },
  { key: 'resp', label: 'RESP', kind: 'earning' },
  { key: 'ot', label: 'OT', kind: 'earning' },
  { key: 'leave', label: 'LEAVE', kind: 'earning' },
  { key: 'enter', label: 'ENTER', kind: 'earning' },
  { key: 'na', label: 'NA', kind: 'earning' },
  { key: 'hazard', label: 'HAZARD', kind: 'earning' },
  { key: 'gross_pay', label: 'GROSS PAY', kind: 'computed-earning' },
  { key: 'plty', label: 'PLTY', kind: 'deduction' },
  { key: 'paye', label: 'PAYE', kind: 'deduction' },
  { key: 'contribution', label: 'CONTRIBUTION', kind: 'deduction' },
  { key: 'advce', label: 'ADVCE', kind: 'deduction' },
  { key: 'personal_loan', label: 'PERSONAL LOAN', kind: 'deduction' },
  { key: 'total_deductions', label: 'TOTAL DEDUCTIONS', kind: 'computed-deduction' },
  { key: 'net_pay', label: 'NET PAY', kind: 'computed-net' },
];

export const DEFAULT_PAYROLL_LABELS = Object.fromEntries(
  PAYROLL_COLUMNS.map(column => [column.key, column.label]),
) as Record<string, string>;

export const PAYROLL_ALLOWANCE_KEYS = PAYROLL_COLUMNS
  .filter(column => column.kind === 'input' || column.kind === 'earning')
  .map(column => column.key);

export const PAYROLL_DEDUCTION_KEYS = PAYROLL_COLUMNS
  .filter(column => column.kind === 'deduction')
  .map(column => column.key);

const ALLOWANCE_ALIASES: Record<string, string[]> = {
  first_app: ['first_app', 'first_appointment'],
  gl: ['gl', 'hours'],
  house: ['house', 'housing'],
  transport: ['transport'],
  ls: ['ls', 'sl'],
  del: ['del', 'la'],
  call: ['call'],
  resp: ['resp', 'responsibility'],
  ot: ['ot'],
  leave: ['leave'],
  enter: ['enter', 'dh'],
  na: ['na', 'no'],
  hazard: ['hazard', 'extra'],
};

const TEXT_ALLOWANCE_KEYS = new Set(['first_app', 'gl']);

const DEDUCTION_ALIASES: Record<string, string[]> = {
  plty: ['plty'],
  paye: ['paye'],
  contribution: ['contribution', 'pension'],
  advce: ['advce', 'advance'],
  personal_loan: ['personal_loan', 'loan'],
};

function asAmount(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function canonicalize(source: PayrollValueMap | null | undefined, aliases: Record<string, string[]>): PayrollValueMap {
  const values = source ?? {};
  return Object.fromEntries(Object.entries(aliases).map(([key, candidates]) => {
    const present = candidates.find(candidate => Object.prototype.hasOwnProperty.call(values, candidate));
    const raw = present ? values[present] : undefined;
    return [key, TEXT_ALLOWANCE_KEYS.has(key) ? String(raw ?? '') : asAmount(raw)];
  }));
}

export function canonicalizePayrollValues(
  allowances: PayrollValueMap | null | undefined,
  deductions: PayrollValueMap | null | undefined,
) {
  return {
    allowances: canonicalize(allowances, ALLOWANCE_ALIASES),
    deductions: canonicalize(deductions, DEDUCTION_ALIASES),
  };
}

export const NON_GRID_DEDUCTION_KEYS = ['family_medical'];

export function preserveNonGridDeductions(source: PayrollValueMap | null | undefined, canonical: PayrollValueMap): PayrollValueMap {
  return {
    ...canonical,
    ...Object.fromEntries(NON_GRID_DEDUCTION_KEYS
      .filter(key => source && Object.prototype.hasOwnProperty.call(source, key))
      .map(key => [key, asAmount(source?.[key])])),
  };
}

export function isPayrollTextField(field: string): boolean {
  return TEXT_ALLOWANCE_KEYS.has(field);
}

export function calculatePayrollTotals(
  basicSalary: number,
  allowances: PayrollValueMap | null | undefined,
  deductions: PayrollValueMap | null | undefined,
) {
  const normalized = canonicalizePayrollValues(allowances, deductions);
  const earnings = PAYROLL_ALLOWANCE_KEYS
    .filter(key => key !== 'first_app' && key !== 'gl')
    .reduce((sum, key) => sum + asAmount(normalized.allowances[key]), 0);
  const grossPay = asAmount(basicSalary) + earnings;
  const totalDeductions = PAYROLL_DEDUCTION_KEYS
    .reduce((sum, key) => sum + asAmount(normalized.deductions[key]), 0);
  return {
    allowances: normalized.allowances,
    deductions: normalized.deductions,
    grossPay,
    totalDeductions,
    netPay: grossPay - totalDeductions,
  };
}

export function getPayrollEntryTotals(entry: {
  basic_salary: number;
  allowances?: PayrollValueMap | null;
  deductions?: PayrollValueMap | null;
}) {
  return calculatePayrollTotals(entry.basic_salary, entry.allowances, entry.deductions);
}

export function previousPeriodKey(year: number, month: number): number {
  return year * 100 + month;
}
