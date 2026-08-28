import { describe, expect, it } from 'vitest';
import { PAYROLL_COLUMNS } from '@/lib/payroll';
import {
  A4_PRINTABLE_HEIGHT_MM,
  A4_PRINTABLE_WIDTH_MM,
  getPayrollPrintReportWidth,
  getPayrollPrintTileOffsets,
  splitPayrollPrintRows,
} from './payrollPrintLayout';

describe('payroll print layout', () => {
  it('calculates dynamic horizontal A4 tiles from the complete report width', () => {
    const reportWidth = getPayrollPrintReportWidth(PAYROLL_COLUMNS);
    const offsets = getPayrollPrintTileOffsets(reportWidth);
    expect(reportWidth).toBeGreaterThan(A4_PRINTABLE_WIDTH_MM);
    expect(offsets.length).toBe(Math.ceil(reportWidth / A4_PRINTABLE_WIDTH_MM));
    expect(offsets.every((offset, index) => offset === index * A4_PRINTABLE_WIDTH_MM)).toBe(true);
  });

  it('keeps every vertical row group intact and preserves all entries', () => {
    const rows = Array.from({ length: 29 }, (_, index) => ({ id: index }));
    const groups = splitPayrollPrintRows(rows, 13);
    expect(groups.map(group => group.length)).toEqual([13, 13, 3]);
    expect(groups.flat()).toEqual(rows);
    expect(A4_PRINTABLE_HEIGHT_MM).toBe(194);
  });
});
