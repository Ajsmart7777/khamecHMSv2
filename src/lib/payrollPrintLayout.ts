import type { PayrollColumnDefinition } from '@/lib/payroll';

export const A4_PORTRAIT_WIDTH_MM = 210;
export const A4_PORTRAIT_HEIGHT_MM = 297;
export const PRINT_MARGIN_MM = 8;
export const A4_PRINTABLE_WIDTH_MM = A4_PORTRAIT_WIDTH_MM - PRINT_MARGIN_MM * 2;
export const A4_PRINTABLE_HEIGHT_MM = A4_PORTRAIT_HEIGHT_MM - PRINT_MARGIN_MM * 2;
export const PRINT_ROW_HEIGHT_MM = 5.2;
export const PRINT_STATIC_HEIGHT_MM = 58;
export const PRINT_ROWS_PER_PAGE = Math.max(1, Math.floor((A4_PRINTABLE_HEIGHT_MM - PRINT_STATIC_HEIGHT_MM) / PRINT_ROW_HEIGHT_MM));

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
