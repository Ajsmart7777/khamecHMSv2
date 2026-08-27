import { useMemo, useState } from 'react';
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
      await downloadPayrollReportPdf(element, `${reportType}_${periodLabel.replace(/\s+/g, '_')}.pdf`, reportType === 'master', reportType === 'master' ? 'a3' : 'a4');
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
      <style>{`@page { size: A3 landscape; margin: 8mm; } @media print { body * { visibility: hidden; } #payroll-report-document, #payroll-report-document * { visibility: visible; } #payroll-report-document { position: absolute; left: 0; top: 0; width: 2480px; margin: 0; } #payroll-report-document table { min-width: 2480px; } }`}</style>
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
        <div id="payroll-report-document" className="rounded-xl border border-border bg-white p-5 text-black shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
          <ReportBrandHeader title={title} periodLabel={periodLabel} />
          {reportType === 'master' && (
            <div className="overflow-x-auto print:overflow-visible">
              <Table className="min-w-[2480px] table-fixed border-collapse text-[10px] print:min-w-[2480px]">
                <TableHeader><TableRow className="border-b-2 border-primary bg-primary/10">
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
            <Table className="border-collapse text-xs"><TableHeader><TableRow className="border-b-2 border-primary bg-primary/10"><TableHead>S/N</TableHead><TableHead>Staff ID</TableHead><TableHead>Staff Name</TableHead><TableHead>Designation</TableHead><TableHead>Bank</TableHead><TableHead>Account Number</TableHead><TableHead className="text-right">Net Pay</TableHead></TableRow></TableHeader><TableBody>{bankEntries.map((entry, index) => <TableRow key={entry.id} className="border-b"><TableCell>{index + 1}</TableCell><TableCell>{entry.staff_employee_id || '—'}</TableCell><TableCell className="font-medium">{entry.staff_name}</TableCell><TableCell>{entry.staff_designation || '—'}</TableCell><TableCell>{entry.staff_bank_name}</TableCell><TableCell className="font-mono">{entry.staff_account_number}</TableCell><TableCell className="text-right font-bold">{naira(entry.net_pay)}</TableCell></TableRow>)}</TableBody></Table>
          )}
          {reportType === 'cash_schedule' && (
            <Table className="border-collapse text-xs"><TableHeader><TableRow className="border-b-2 border-primary bg-primary/10"><TableHead>S/N</TableHead><TableHead>Staff ID</TableHead><TableHead>Staff Name</TableHead><TableHead>Designation</TableHead><TableHead className="text-right">Cash Amount</TableHead><TableHead>Signature</TableHead></TableRow></TableHeader><TableBody>{cashEntries.map((entry, index) => <TableRow key={entry.id} className="h-12 border-b"><TableCell>{index + 1}</TableCell><TableCell>{entry.staff_employee_id || '—'}</TableCell><TableCell className="font-medium">{entry.staff_name}</TableCell><TableCell>{entry.staff_designation || '—'}</TableCell><TableCell className="text-right font-bold">{naira(entry.net_pay)}</TableCell><TableCell className="min-w-32 border-b border-muted-foreground" /></TableRow>)}</TableBody></Table>
          )}
          {reportType === 'paye' && <SimpleTable headers={['S/N', 'Staff ID', 'Staff Name', 'Gross Pay', 'PAYE']} rows={entries.map((entry, index) => [index + 1, entry.staff_employee_id || '—', entry.staff_name, naira(entry.gross_pay), naira(Number(entry.deductions?.paye || entry.deductions?.tax || 0))])} />}
          {reportType === 'pension' && <SimpleTable headers={['S/N', 'Staff ID', 'Staff Name', 'Basic Salary', 'Contribution']} rows={entries.map((entry, index) => [index + 1, entry.staff_employee_id || '—', entry.staff_name, naira(entry.basic_salary), naira(Number(entry.deductions?.contribution || entry.deductions?.pension || 0))])} />}
          {(reportType === 'family_deductions' || reportType === 'family_med_manual') && <SimpleTable headers={['S/N', 'Staff ID', 'Staff Name', 'Designation', 'Family Medical Amount', ...(reportType === 'family_med_manual' ? ['Notes / Signature'] : ['Status'])]} rows={entries.filter(entry => Number(entry.deductions?.family_medical || 0) > 0).map((entry, index) => [index + 1, entry.staff_employee_id || '—', entry.staff_name, entry.staff_designation || '—', naira(Number(entry.deductions?.family_medical || 0)), reportType === 'family_med_manual' ? ' ' : entry.status || 'pending'])} />}
          <ReportFooter />
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground print:hidden"><FileText className="h-8 w-8" />{selectedPeriod ? 'No staff entries match this report.' : 'Select a payroll period to view reports.'}</div>
      )}
    </div>
  );
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: Array<Array<string | number>> }) {
  return <Table className="border-collapse text-xs"><TableHeader><TableRow className="border-b-2 border-primary bg-primary/10">{headers.map(header => <TableHead key={header}>{header}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row, index) => <TableRow key={index} className="border-b">{row.map((cell, cellIndex) => <TableCell key={cellIndex}>{cell}</TableCell>)}</TableRow>)}</TableBody></Table>;
}
