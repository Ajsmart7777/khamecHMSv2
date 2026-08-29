import { describe, expect, it } from 'vitest';
import { PAYROLL_COLUMNS } from '@/lib/payroll';
import {
  A4_PRINTABLE_HEIGHT_MM,
  A4_PRINTABLE_WIDTH_MM,
  LEFT_MASTER_COLUMNS,
  RIGHT_MASTER_COLUMNS,
  LEFT_COLUMN_WIDTHS_MM,
  RIGHT_COLUMN_WIDTHS_MM,
  getPayrollPrintReportWidth,
  getPayrollPrintTileOffsets,
  splitPayrollPrintRows,
  splitPayrollQuadrantRows,
} from './payrollPrintLayout';

describe('payroll print layout', () => {
  it('calculates dynamic horizontal A4 tiles from the complete report width', () => {
    const reportWidth = getPayrollPrintReportWidth(PAYROLL_COLUMNS);
    const offsets = getPayrollPrintTileOffsets(reportWidth);
    expect(reportWidth).toBeGreaterThan(0);
    expect(offsets.length).toBe(Math.max(1, Math.ceil(reportWidth / A4_PRINTABLE_WIDTH_MM)));
  });

  it('keeps every vertical row group intact and preserves all entries', () => {
    const rows = Array.from({ length: 84 }, (_, index) => ({ id: index }));
    const groups = splitPayrollPrintRows(rows);
    expect(groups.flat()).toEqual(rows);
    expect(A4_PRINTABLE_HEIGHT_MM).toBe(198);
  });

  it('correctly divides 25 columns into Left (12) and Right (13) quadrants fitting A4 printable width', () => {
    expect(LEFT_MASTER_COLUMNS.length).toBe(12);
    expect(RIGHT_MASTER_COLUMNS.length).toBe(13);
    expect([...LEFT_MASTER_COLUMNS, ...RIGHT_MASTER_COLUMNS]).toEqual(PAYROLL_COLUMNS);

    const leftTotalWidth = Object.values(LEFT_COLUMN_WIDTHS_MM).reduce((sum, w) => sum + w, 0);
    const rightTotalWidth = Object.values(RIGHT_COLUMN_WIDTHS_MM).reduce((sum, w) => sum + w, 0);
    expect(leftTotalWidth).toBe(A4_PRINTABLE_WIDTH_MM);
    expect(rightTotalWidth).toBe(A4_PRINTABLE_WIDTH_MM);
    expect(A4_PRINTABLE_WIDTH_MM).toBe(285);
  });

  it('splits staff into synced Top and Bottom quadrant halves', () => {
    const staffList = Array.from({ length: 50 }, (_, i) => ({ id: `staff-${i + 1}`, name: `Staff ${i + 1}` }));
    const split = splitPayrollQuadrantRows(staffList);
    expect(split.totalCount).toBe(50);
    expect(split.midIndex).toBe(25);
    expect(split.topRows.length).toBe(25);
    expect(split.bottomRows.length).toBe(25);
    expect(split.topRows[0]).toEqual(staffList[0]);
    expect(split.topRows[24]).toEqual(staffList[24]);
    expect(split.bottomRows[0]).toEqual(staffList[25]);
    expect(split.bottomRows[24]).toEqual(staffList[49]);
  });
});

