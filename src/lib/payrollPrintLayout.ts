import { PAYROLL_COLUMNS, type PayrollColumnDefinition } from '@/lib/payroll';

export const A4_PORTRAIT_WIDTH_MM = 210;
export const A4_PORTRAIT_HEIGHT_MM = 297;
export const PRINT_MARGIN_MM = 8;
export const A4_PRINTABLE_WIDTH_MM = A4_PORTRAIT_WIDTH_MM - PRINT_MARGIN_MM * 2; // 194mm
export const A4_PRINTABLE_HEIGHT_MM = A4_PORTRAIT_HEIGHT_MM - PRINT_MARGIN_MM * 2; // 281mm
export const PRINT_ROW_HEIGHT_MM = 5.2;
export const PRINT_STATIC_HEIGHT_MM = 58;
export const PRINT_ROWS_PER_PAGE = Math.max(1, Math.floor((A4_PRINTABLE_HEIGHT_MM - PRINT_STATIC_HEIGHT_MM) / PRINT_ROW_HEIGHT_MM));

/**
 * 4-Quadrant Poster Master Payroll Split:
 * - Left side (Pages 1 & 3): 12 columns (ID, Staff Name, Designation, 1st APP, GL, Basic, House, Transport, LS, DEL, CALL, RESP)
 * - Right side (Pages 2 & 4): 13 columns (OT, LEAVE, ENTER, NA, HAZARD, GROSS PAY, PLTY, PAYE, CONTRIBUTION, ADVCE, PERSONAL LOAN, TOTAL DEDUCTIONS, NET PAY)
 */
export const LEFT_MASTER_COLUMNS: PayrollColumnDefinition[] = PAYROLL_COLUMNS.slice(0, 12);
export const RIGHT_MASTER_COLUMNS: PayrollColumnDefinition[] = PAYROLL_COLUMNS.slice(12);

export const LEFT_COLUMN_WIDTHS_MM: Record<string, number> = {
  id: 11,
  staff_name: 34,
  designation: 27,
  first_app: 13,
  gl: 10,
  basic_salary: 17,
  house: 14,
  transport: 14,
  ls: 11,
  del: 11,
  call: 14,
  resp: 18,
};

export const RIGHT_COLUMN_WIDTHS_MM: Record<string, number> = {
  ot: 11,
  leave: 11,
  enter: 11,
  na: 10,
  hazard: 12,
  gross_pay: 20,
  plty: 11,
  paye: 16,
  contribution: 16,
  advce: 14,
  personal_loan: 16,
  total_deductions: 22,
  net_pay: 24,
};

export interface PayrollQuadrantSplit<T> {
  topRows: T[];
  bottomRows: T[];
  midIndex: number;
  totalCount: number;
}

export function splitPayrollQuadrantRows<T>(rows: T[]): PayrollQuadrantSplit<T> {
  const totalCount = rows.length;
  const midIndex = Math.max(1, Math.ceil(totalCount / 2));
  return {
    topRows: rows.slice(0, midIndex),
    bottomRows: rows.slice(midIndex),
    midIndex,
    totalCount,
  };
}

const IDENTITY_WIDTHS: Record<string, number> = {
  id: 22,
  staff_name: 38,
  designation: 32,
};

export function getPayrollPrintColumnWidth(column: PayrollColumnDefinition, longestTextLength = 0): number {
  if (IDENTITY_WIDTHS[column.key]) {
    const contentWidth = longestTextLength > 0 ? longestTextLength * 1.9 + 6 : 0;
    return Math.max(IDENTITY_WIDTHS[column.key], contentWidth);
  }
  if (column.kind === 'computed-earning' || column.kind === 'computed-deduction' || column.kind === 'computed-net') return 30;
  if (column.kind === 'input') return 22;
  return 19;
}

export function getPayrollPrintColumnWidths(columns: PayrollColumnDefinition[], longestTextByKey: Record<string, number> = {}): number[] {
  return columns.map(column => getPayrollPrintColumnWidth(column, longestTextByKey[column.key] || 0));
}

export function getPayrollPrintReportWidth(columns: PayrollColumnDefinition[], longestTextByKey: Record<string, number> = {}): number {
  return getPayrollPrintColumnWidths(columns, longestTextByKey).reduce((total, width) => total + width, 0);
}

export function getPayrollPrintTileOffsets(reportWidth: number, printableWidth = A4_PRINTABLE_WIDTH_MM): number[] {
  const tileCount = Math.max(1, Math.ceil(reportWidth / printableWidth));
  return Array.from({ length: tileCount }, (_, index) => index * printableWidth);
}

export function splitPayrollPrintRows<T>(rows: T[], rowsPerPage = PRINT_ROWS_PER_PAGE): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < rows.length; index += rowsPerPage) groups.push(rows.slice(index, index + rowsPerPage));
  return groups.length ? groups : [[]];
}
