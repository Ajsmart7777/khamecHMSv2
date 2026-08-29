import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, FileText, Loader2, Printer } from 'lucide-react';
import { PayrollPeriod, PayrollEntry } from '@/hooks/usePayroll';
import { toast } from '@/hooks/use-toast';
import hospitalLogo from '@/assets/hospital-logo.png';
import { downloadPayrollReportPdf } from '@/lib/payrollReportPdf';
import { splitPayrollPaymentEntries } from '@/lib/payrollReports';
import { PAYROLL_COLUMNS, DEFAULT_PAYROLL_LABELS, isPayrollTextField, type PayrollColumnDefinition } from '@/lib/payroll';
import { A4_PRINTABLE_HEIGHT_MM, A4_PRINTABLE_WIDTH_MM, PRINT_MARGIN_MM, PRINT_ROW_HEIGHT_MM, PRINT_ROWS_PER_PAGE, getPayrollPrintColumnWidths, getPayrollPrintReportWidth, getPayrollPrintTileOffsets, splitPayrollPrintRows } from '@/lib/payrollPrintLayout';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
type ReportType = 'master' | 'bank_schedule' | 'cash_schedule' | 'paye' | 'pension' | 'family_deductions' | 'family_med_manual';

interface Props {
  periods: PayrollPeriod[];
  selectedPeriod: PayrollPeriod | null;
  onSelectPeriod: (p: PayrollPeriod) => void;
  entries: PayrollEntry[];
}

const naira = (value: number) => `₦${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const amount = (entry: PayrollEntry, key: string) => Number(entry.allowances?.[key] || 0);
const totalEarnings = (entry: PayrollEntry) => entry.gross_pay - entry.basic_salary;

function reportTitle(type: ReportType) {
  switch (type) {
    case 'master': return 'Master Payroll Report';
    case 'bank_schedule': return 'Bank Payment Schedule';
    case 'cash_schedule': return 'Cash Payment Schedule';
    case 'paye': return 'PAYE Schedule';
    case 'pension': return 'Contribution Schedule';
    case 'family_deductions': return 'Family Medical Deductions';
    case 'family_med_manual': return 'Family Medical Manual Schedule';
  }
}

function ReportBrandHeader({ title, periodLabel }: { title: string; periodLabel: string }) {
  return (
    <div className="mb-5 flex items-center gap-4 border-b-2 border-primary pb-4">
      <img src={hospitalLogo} alt="Khadija Medical Center" className="h-16 w-16 object-contain" />
      <div className="flex-1">
        <h1 className="text-xl font-extrabold tracking-wide text-primary">KHADIJA MEDICAL CENTER</h1>
        <p className="text-xs text-muted-foreground">Comprehensive healthcare services</p>
        <p className="mt-2 text-base font-bold uppercase tracking-wider text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">Payroll period: {periodLabel}</p>
      </div>
      <div className="text-right text-[10px] text-muted-foreground">
        <p>Prepared by Accounts</p>
        <p>Generated: {new Date().toLocaleDateString()}</p>
      </div>
    </div>
  );
}

function FloatingHorizontalScrollbar({ containerRef, enabled }: { containerRef: { current: HTMLDivElement | null }; enabled: boolean }) {
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const [needsScroll, setNeedsScroll] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    const scrollbar = scrollbarRef.current;
    if (!container || !scrollbar) return;

    const measure = () => {
      const width = container.scrollWidth;
      setContentWidth(width);
      setNeedsScroll(width > container.clientWidth + 1);
      scrollbar.scrollLeft = container.scrollLeft;
    };
    const fromTable = () => {
      if (Math.abs(scrollbar.scrollLeft - container.scrollLeft) > 1) scrollbar.scrollLeft = container.scrollLeft;
    };
    const fromScrollbar = () => {
      if (Math.abs(container.scrollLeft - scrollbar.scrollLeft) > 1) container.scrollLeft = scrollbar.scrollLeft;
    };

    measure();
    container.addEventListener('scroll', fromTable, { passive: true });
    scrollbar.addEventListener('scroll', fromScrollbar, { passive: true });
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(container);
    return () => {
      container.removeEventListener('scroll', fromTable);
      scrollbar.removeEventListener('scroll', fromScrollbar);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [containerRef, enabled]);

  return <div
    ref={scrollbarRef}
    aria-label="Payroll table horizontal scrolling"
    className="fixed bottom-3 left-[clamp(1rem,18vw,17rem)] right-4 z-40 overflow-x-auto rounded-lg border border-slate-300 bg-white/95 px-1 py-1 shadow-lg backdrop-blur print:hidden"
    style={{ visibility: enabled && needsScroll ? 'visible' : 'hidden', pointerEvents: enabled && needsScroll ? 'auto' : 'none' }}
  >
    <div aria-hidden="true" style={{ width: `${contentWidth}px`, height: '1px' }} />
  </div>;
}

function ReportFooter() {
  return (
    <div className="mt-8 grid grid-cols-2 gap-12 border-t pt-5 text-center text-xs text-muted-foreground">
      <div><p className="mb-6 border-b border-muted-foreground pb-1">&nbsp;</p><p>Prepared by Accounts</p></div>
      <div><p className="mb-6 border-b border-muted-foreground pb-1">&nbsp;</p><p>Authorised Signature</p></div>
    </div>
  );
}

export function PayrollReports({ periods, selectedPeriod, onSelectPeriod, entries }: Props) {
  const [reportType, setReportType] = useState<ReportType>('master');
  const masterScrollRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  const paymentGroups = useMemo(() => splitPayrollPaymentEntries(entries), [entries]);
  const bankEntries = paymentGroups.bank;
  const cashEntries = paymentGroups.cash;
  const periodLabel = selectedPeriod ? `${MONTHS[selectedPeriod.month - 1]} ${selectedPeriod.year}` : 'Unselected period';
  const title = reportTitle(reportType);
  const totalGross = entries.reduce((sum, entry) => sum + entry.gross_pay, 0);
  const totalDeductions = entries.reduce((sum, entry) => sum + entry.total_deductions, 0);
  const totalNet = entries.reduce((sum, entry) => sum + entry.net_pay, 0);
  const payrollLabels = { ...DEFAULT_PAYROLL_LABELS, ...(selectedPeriod?.column_labels || {}) };
  const getMasterValue = (entry: PayrollEntry, column: PayrollColumnDefinition): string | number => {
    if (column.key === 'id') return entry.staff_employee_id || '—';
    if (column.key === 'staff_name') return entry.staff_name || 'Unknown Staff';
    if (column.key === 'designation') return entry.staff_designation || '—';
    if (column.key === 'basic_salary') return entry.basic_salary;
    if (column.key === 'gross_pay') return entry.gross_pay;
    if (column.key === 'total_deductions') return entry.total_deductions;
    if (column.key === 'net_pay') return entry.net_pay;
    if (isPayrollTextField(column.key)) return String(entry.allowances?.[column.key] || '');
    return column.kind === 'deduction'
      ? Number(entry.deductions?.[column.key] || 0)
      : Number(entry.allowances?.[column.key] || 0);
  };
  const getMasterTotal = (column: PayrollColumnDefinition): number | null => {
    if (['id', 'staff_name', 'designation'].includes(column.key) || isPayrollTextField(column.key)) return null;
    return entries.reduce((sum, entry) => sum + Number(getMasterValue(entry, column) || 0), 0);
  };
  const reportRows = reportType === 'bank_schedule' ? bankEntries : reportType === 'cash_schedule' ? cashEntries : entries;
  const hasRows = reportType === 'family_deductions' || reportType === 'family_med_manual'
    ? entries.some(entry => Number(entry.deductions?.family_medical || 0) > 0)
    : reportRows.length > 0;

  const handleDownload = async () => {
    const element = document.getElementById('payroll-report-document');
    if (!element || !selectedPeriod) return;
    setDownloading(true);
    try {
      await downloadPayrollReportPdf(element, `${reportType}_${periodLabel.replace(/\s+/g, '_')}.pdf`, reportType === 'master', 'a4', reportType === 'master');
      toast({ title: 'PDF downloaded', description: `${title} is ready to print or share.` });
    } catch (error) {
      toast({ title: 'Download failed', description: error instanceof Error ? error.message : 'Could not create the PDF.', variant: 'destructive' });
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = () => {
    if (!selectedPeriod) return;
    window.print();
  };

  return (
    <div className="space-y-4">
      <style>{`@page { size: A4 portrait; margin: ${PRINT_MARGIN_MM}mm; } @media print { html, body { width: ${A4_PRINTABLE_WIDTH_MM}mm; margin: 0; background: #fff; } body * { visibility: hidden; } #payroll-report-document.master-screen-report { display: none !important; } #payroll-report-print-tiles, #payroll-report-print-tiles * { visibility: visible; } #payroll-report-print-tiles { display: block !important; position: static; width: ${A4_PRINTABLE_WIDTH_MM}mm; } .payroll-print-page { box-sizing: border-box; display: block; width: ${A4_PRINTABLE_WIDTH_MM}mm; height: ${A4_PRINTABLE_HEIGHT_MM}mm; overflow: hidden; position: relative; break-after: page; page-break-after: always; } .payroll-print-page:last-child { break-after: auto; page-break-after: auto; } .payroll-print-canvas { box-sizing: border-box; position: absolute; top: 0; width: var(--payroll-report-width); min-width: var(--payroll-report-width); } .payroll-print-canvas table { width: var(--payroll-report-width); min-width: var(--payroll-report-width); table-layout: fixed; border-collapse: collapse; font-size: 6.5px; line-height: 1.15; white-space: nowrap; } .payroll-print-canvas th, .payroll-print-canvas td { box-sizing: border-box; border: 1px solid #9ca3af; padding: 2px 3px; vertical-align: middle; overflow: visible; } .payroll-print-canvas th { font-weight: 700; } .payroll-print-canvas tbody tr { height: ${PRINT_ROW_HEIGHT_MM}mm; break-inside: avoid; page-break-inside: avoid; } } @media screen { #payroll-report-print-tiles { display: none; } }`}</style>
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center print:hidden">
        <Select value={selectedPeriod?.id || ''} onValueChange={value => { const period = periods.find(item => item.id === value); if (period) onSelectPeriod(period); }}>
          <SelectTrigger className="w-full sm:w-64"><SelectValue placeholder="Select period" /></SelectTrigger>
          <SelectContent>{periods.map(period => <SelectItem key={period.id} value={period.id}>{MONTHS[period.month - 1]} {period.year}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={reportType} onValueChange={value => setReportType(value as ReportType)}>
          <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="master">Master Report</SelectItem>
            <SelectItem value="bank_schedule">Bank Schedule</SelectItem>
            <SelectItem value="cash_schedule">Cash Schedule</SelectItem>
            <SelectItem value="paye">PAYE Schedule</SelectItem>
            <SelectItem value="pension">Contribution Schedule</SelectItem>
            <SelectItem value="family_deductions">Family Medical Deductions</SelectItem>
            <SelectItem value="family_med_manual">Family Medical Manual Schedule</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={handlePrint} disabled={!hasRows}><Printer className="mr-2 h-4 w-4" /> Print</Button>
          <Button onClick={() => void handleDownload()} disabled={!hasRows || downloading}>
            {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Download PDF
          </Button>
        </div>
      </div>

      {selectedPeriod && entries.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm print:hidden">
          <span className="text-muted-foreground">All staff: <strong>{entries.length}</strong></span>
          <span className="text-muted-foreground">Bank staff: <strong>{bankEntries.length}</strong></span>
          <span className="text-muted-foreground">Cash staff: <strong>{cashEntries.length}</strong></span>
          <span className="text-muted-foreground">Gross: <strong>{naira(totalGross)}</strong></span>
          <span className="text-muted-foreground">Deductions: <strong>{naira(totalDeductions)}</strong></span>
          <span className="text-muted-foreground">Net: <strong>{naira(totalNet)}</strong></span>
        </div>
      )}

      {selectedPeriod && hasRows ? (
        <>
        <div id="payroll-report-document" className={`rounded-xl border border-border bg-white p-5 text-black shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none ${reportType === 'master' ? 'master-screen-report' : ''}`}>
          <ReportBrandHeader title={title} periodLabel={periodLabel} />
          {reportType === 'master' && (
            <div ref={masterScrollRef} className="overflow-x-auto print:overflow-visible">
              <Table className="min-w-[2480px] table-fixed border-collapse text-[10px] print:min-w-[2480px]">
                <TableHeader className="sticky top-16 z-30 bg-white shadow-sm md:top-20 print:static print:shadow-none"><TableRow className="border-b-2 border-primary bg-primary/10">
                  {PAYROLL_COLUMNS.map(column => <TableHead key={column.key} className={`whitespace-normal break-words px-2 py-2 text-center text-[9px] leading-tight font-bold ${column.kind === 'deduction' || column.kind === 'computed-deduction' ? 'text-destructive' : ''} ${column.key === 'id' ? 'w-24' : column.key === 'staff_name' ? 'w-48' : column.key === 'designation' ? 'w-40' : column.kind === 'computed-earning' || column.kind === 'computed-deduction' || column.kind === 'computed-net' ? 'w-32' : column.kind === 'identity' ? 'w-32' : 'w-24'}`}>{payrollLabels[column.key] || column.label}</TableHead>)}
                </TableRow></TableHeader>
                <TableBody>
                  {entries.map(entry => <TableRow key={entry.id} className="border-b">
                    {PAYROLL_COLUMNS.map(column => {
                      const value = getMasterValue(entry, column);
                      const isText = typeof value === 'string' && (column.key === 'id' || column.key === 'staff_name' || column.key === 'designation' || isPayrollTextField(column.key));
                      return <TableCell key={column.key} className={`px-2 py-2 ${isText ? 'whitespace-normal break-words' : 'text-right'} ${['gross_pay', 'total_deductions', 'net_pay'].includes(column.key) ? 'font-bold bg-primary/5' : ''}`}>{isText ? value : naira(Number(value))}</TableCell>;
                    })}
                  </TableRow>)}
                  <TableRow className="border-t-2 border-primary/30 bg-primary/10 font-bold">
                    {PAYROLL_COLUMNS.map(column => {
                      const total = getMasterTotal(column);
                      return <TableCell key={column.key} className={`px-2 py-3 ${column.key === 'id' ? 'text-left' : ['staff_name', 'designation'].includes(column.key) ? 'text-left' : 'text-right'} ${column.key === 'total_deductions' ? 'text-destructive' : ''}`}>{column.key === 'id' ? 'TOTAL' : total === null ? '' : naira(total)}</TableCell>;
                    })}
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
          {reportType === 'bank_schedule' && (
            <Table className="border-collapse text-xs"><TableHeader><TableRow className="border-b-2 border-primary bg-primary/10"><TableHead>S/N</TableHead><TableHead>Staff ID</TableHead><TableHead>Staff Name</TableHead><TableHead>Designation</TableHead><TableHead>Bank</TableHead><TableHead>Account Number</TableHead><TableHead className="text-right">Net Pay</TableHead></TableRow></TableHeader><TableBody>{bankEntries.map((entry, index) => <TableRow key={entry.id} className="border-b"><TableCell>{index + 1}</TableCell><TableCell>{entry.staff_employee_id || '—'}</TableCell><TableCell className="font-medium">{entry.staff_name}</TableCell><TableCell>{entry.staff_designation || '—'}</TableCell><TableCell>{entry.staff_bank_name}</TableCell><TableCell className="font-mono">{entry.staff_account_number}</TableCell><TableCell className="text-right font-bold">{naira(entry.net_pay)}</TableCell></TableRow>)}<ScheduleTotalRow colSpan={6} label="TOTAL" value={naira(bankEntries.reduce((sum, entry) => sum + entry.net_pay, 0))} /></TableBody></Table>
          )}
          {reportType === 'cash_schedule' && (
            <Table className="border-collapse text-xs"><TableHeader><TableRow className="border-b-2 border-primary bg-primary/10"><TableHead>S/N</TableHead><TableHead>Staff ID</TableHead><TableHead>Staff Name</TableHead><TableHead>Designation</TableHead><TableHead className="text-right">Cash Amount</TableHead><TableHead>Signature</TableHead></TableRow></TableHeader><TableBody>{cashEntries.map((entry, index) => <TableRow key={entry.id} className="h-12 border-b"><TableCell>{index + 1}</TableCell><TableCell>{entry.staff_employee_id || '—'}</TableCell><TableCell className="font-medium">{entry.staff_name}</TableCell><TableCell>{entry.staff_designation || '—'}</TableCell><TableCell className="text-right font-bold">{naira(entry.net_pay)}</TableCell><TableCell className="min-w-32 border-b border-muted-foreground" /></TableRow>)}<ScheduleTotalRow colSpan={5} label="TOTAL" value={naira(cashEntries.reduce((sum, entry) => sum + entry.net_pay, 0))} /></TableBody></Table>
          )}
          {reportType === 'paye' && <SimpleTable headers={['S/N', 'Staff ID', 'Staff Name', 'Gross Pay', 'PAYE']} rows={entries.map((entry, index) => [index + 1, entry.staff_employee_id || '—', entry.staff_name, naira(entry.gross_pay), naira(Number(entry.deductions?.paye || entry.deductions?.tax || 0))])} totals={['TOTAL', '', '', naira(totalGross), naira(entries.reduce((sum, entry) => sum + Number(entry.deductions?.paye || entry.deductions?.tax || 0), 0))]} />}
          {reportType === 'pension' && <SimpleTable headers={['S/N', 'Staff ID', 'Staff Name', 'Basic Salary', 'Contribution']} rows={entries.map((entry, index) => [index + 1, entry.staff_employee_id || '—', entry.staff_name, naira(entry.basic_salary), naira(Number(entry.deductions?.contribution || entry.deductions?.pension || 0))])} totals={['TOTAL', '', '', naira(entries.reduce((sum, entry) => sum + entry.basic_salary, 0)), naira(entries.reduce((sum, entry) => sum + Number(entry.deductions?.contribution || entry.deductions?.pension || 0), 0))]} />}
          {(reportType === 'family_deductions' || reportType === 'family_med_manual') && <SimpleTable headers={['S/N', 'Staff ID', 'Staff Name', 'Designation', 'Family Medical Amount', ...(reportType === 'family_med_manual' ? ['Notes / Signature'] : ['Status'])]} rows={entries.filter(entry => Number(entry.deductions?.family_medical || 0) > 0).map((entry, index) => [index + 1, entry.staff_employee_id || '—', entry.staff_name, entry.staff_designation || '—', naira(Number(entry.deductions?.family_medical || 0)), reportType === 'family_med_manual' ? ' ' : entry.status || 'pending'])} totals={['TOTAL', '', '', '', naira(entries.reduce((sum, entry) => sum + Number(entry.deductions?.family_medical || 0), 0)), '']} />}
          <ReportFooter />
        </div>
        {reportType === 'master' && <MasterPrintTiles entries={entries} periodLabel={periodLabel} payrollLabels={payrollLabels} />}
        <FloatingHorizontalScrollbar containerRef={masterScrollRef} enabled={reportType === 'master' && hasRows} />
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground print:hidden"><FileText className="h-8 w-8" />{selectedPeriod ? 'No staff entries match this report.' : 'Select a payroll period to view reports.'}</div>
      )}
    </div>
  );
}

function MasterPrintTiles({ entries, periodLabel, payrollLabels }: { entries: PayrollEntry[]; periodLabel: string; payrollLabels: Record<string, string> }) {
  const longestTextByKey = Object.fromEntries(PAYROLL_COLUMNS.filter(column => column.kind === 'identity' || isPayrollTextField(column.key)).map(column => {
    const lengths = entries.map(entry => {
      if (column.key === 'id') return String(entry.staff_employee_id || '—').length;
      if (column.key === 'staff_name') return String(entry.staff_name || 'Unknown Staff').length;
      if (column.key === 'designation') return String(entry.staff_designation || '—').length;
      return String(entry.allowances?.[column.key] || '').length;
    });
    return [column.key, Math.max(column.label.length, ...lengths)];
  }));
  const columnWidths = getPayrollPrintColumnWidths(PAYROLL_COLUMNS, longestTextByKey);
  const reportWidth = getPayrollPrintReportWidth(PAYROLL_COLUMNS, longestTextByKey);
  const tileOffsets = getPayrollPrintTileOffsets(reportWidth);
  const rowGroups = splitPayrollPrintRows(entries);
  const getValue = (entry: PayrollEntry, column: PayrollColumnDefinition): string | number => {
    if (column.key === 'id') return entry.staff_employee_id || '—';
    if (column.key === 'staff_name') return entry.staff_name || 'Unknown Staff';
    if (column.key === 'designation') return entry.staff_designation || '—';
    if (column.key === 'basic_salary') return entry.basic_salary;
    if (column.key === 'gross_pay') return entry.gross_pay;
    if (column.key === 'total_deductions') return entry.total_deductions;
    if (column.key === 'net_pay') return entry.net_pay;
    if (isPayrollTextField(column.key)) return String(entry.allowances?.[column.key] || '');
    return column.kind === 'deduction' ? Number(entry.deductions?.[column.key] || 0) : Number(entry.allowances?.[column.key] || 0);
  };
  const formatValue = (value: string | number, column: PayrollColumnDefinition) => typeof value === 'string' && (column.kind === 'identity' || isPayrollTextField(column.key)) ? value : naira(Number(value));
  return <div id="payroll-report-print-tiles" aria-hidden="true">
    {rowGroups.flatMap((rowGroup, rowIndex) => tileOffsets.map((offset, tileIndex) => (
      <section className="payroll-print-page" key={`${rowIndex}-${tileIndex}`}>
        <div className="payroll-print-canvas" style={{ '--payroll-report-width': `${reportWidth}mm`, width: `${reportWidth}mm`, left: `-${offset}mm` } as CSSProperties}>
          <ReportBrandHeader title={`Master Payroll Report — A4 Part ${tileIndex + 1} of ${tileOffsets.length}`} periodLabel={`${periodLabel} | Staff ${rowIndex * PRINT_ROWS_PER_PAGE + 1}–${Math.min(entries.length, (rowIndex + 1) * PRINT_ROWS_PER_PAGE)} of ${entries.length}`} />
          <table>
            <colgroup>{columnWidths.map((width, index) => <col key={PAYROLL_COLUMNS[index].key} style={{ width: `${width}mm` }} />)}</colgroup>
            <thead><tr>{PAYROLL_COLUMNS.map(column => <th key={column.key}>{payrollLabels[column.key] || column.label}</th>)}</tr></thead>
            <tbody>
              {rowGroup.map(entry => <tr key={entry.id}>{PAYROLL_COLUMNS.map(column => <td key={column.key} style={{ textAlign: typeof getValue(entry, column) === 'string' ? 'left' : 'right' }}>{formatValue(getValue(entry, column), column)}</td>)}</tr>)}
              <tr><th>TOTAL</th>{PAYROLL_COLUMNS.slice(1).map(column => {
                if (column.kind === 'identity' || isPayrollTextField(column.key)) return <th key={column.key} />;
                const total = rowGroup.reduce((sum, entry) => sum + Number(getValue(entry, column) || 0), 0);
                return <th key={column.key} style={{ textAlign: 'right' }}>{naira(total)}</th>;
              })}</tr>
            </tbody>
          </table>
          <p style={{ marginTop: '6px', fontSize: '7px', color: '#6b7280' }}>A4 tile {tileIndex + 1} of {tileOffsets.length}; vertical staff page {rowIndex + 1} of {rowGroups.length}. Align tiles at the table borders.</p>
        </div>
      </section>
    ))) }
  </div>;
}

function ScheduleTotalRow({ colSpan, label, value }: { colSpan: number; label: string; value: string }) {
  return <TableRow className="border-t-2 border-primary/30 bg-primary/10 font-bold"><TableCell colSpan={colSpan}>{label}</TableCell><TableCell className="text-right">{value}</TableCell></TableRow>;
}

function SimpleTable({ headers, rows, totals }: { headers: string[]; rows: Array<Array<string | number>>; totals?: Array<string | number> }) {
  return <Table className="border-collapse text-xs"><TableHeader><TableRow className="border-b-2 border-primary bg-primary/10">{headers.map(header => <TableHead key={header}>{header}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row, index) => <TableRow key={index} className="border-b">{row.map((cell, cellIndex) => <TableCell key={cellIndex}>{cell}</TableCell>)}</TableRow>)}{totals && <TableRow className="border-t-2 border-primary/30 bg-primary/10 font-bold">{totals.map((cell, index) => <TableCell key={index} className={index === totals.length - 1 || (typeof cell === 'string' && cell.startsWith('₦')) ? 'text-right' : ''}>{cell}</TableCell>)}</TableRow>}</TableBody></Table>;
}
