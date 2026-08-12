import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, FileText } from 'lucide-react';
import { PayrollPeriod, PayrollEntry } from '@/hooks/usePayroll';
import { toast } from '@/hooks/use-toast';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type ReportType = 'master' | 'bank_schedule' | 'cash_schedule' | 'paye' | 'pension' | 'family_deductions';

interface Props {
  periods: PayrollPeriod[];
  selectedPeriod: PayrollPeriod | null;
  onSelectPeriod: (p: PayrollPeriod) => void;
  entries: PayrollEntry[];
}

export function PayrollReports({ periods, selectedPeriod, onSelectPeriod, entries }: Props) {
  const [reportType, setReportType] = useState<ReportType>('master');

  const bankEntries = entries.filter(e => e.staff_payment_method === 'bank' && e.staff_account_number);
  const cashEntries = entries.filter(e => e.staff_payment_method !== 'bank' || !e.staff_account_number);

  const totalGross = entries.reduce((s, e) => s + e.gross_pay, 0);
  const totalNet = entries.reduce((s, e) => s + e.net_pay, 0);

  const exportCSV = () => {
    let csv = '';
    let rows: string[][] = [];
    const periodLabel = selectedPeriod ? `${MONTHS[selectedPeriod.month - 1]} ${selectedPeriod.year}` : '';

    if (reportType === 'master') {
      csv = 'S/N,Staff ID,Name,Basic,Allowances,Gross Pay,Deductions,Net Pay\n';
      rows = entries.map((e, i) => [
        String(i + 1), e.staff_employee_id || '', e.staff_name || '',
        String(e.basic_salary), String(Object.values(e.allowances).reduce((a, b) => a + b, 0)),
        String(e.gross_pay), String(e.total_deductions), String(e.net_pay),
      ]);
    } else if (reportType === 'bank_schedule') {
      csv = 'S/N,Staff ID,Name,Bank,Account,Amount\n';
      rows = bankEntries.map((e, i) => [
        String(i + 1), e.staff_employee_id || '', e.staff_name || '',
        e.staff_bank_name || '', e.staff_account_number || '', String(e.net_pay),
      ]);
    } else if (reportType === 'cash_schedule') {
      csv = 'S/N,Staff ID,Name,Amount\n';
      rows = cashEntries.map((e, i) => [
        String(i + 1), e.staff_employee_id || '', e.staff_name || '', String(e.net_pay),
      ]);
    } else if (reportType === 'paye') {
      csv = 'S/N,Staff ID,Name,Gross Pay,Tax Deduction\n';
      rows = entries.map((e, i) => [
        String(i + 1), e.staff_employee_id || '', e.staff_name || '',
        String(e.gross_pay), String(e.deductions?.tax || 0),
      ]);
    } else if (reportType === 'pension') {
      csv = 'S/N,Staff ID,Name,Basic Salary,Pension Deduction\n';
      rows = entries.map((e, i) => [
        String(i + 1), e.staff_employee_id || '', e.staff_name || '',
        String(e.basic_salary), String(e.deductions?.pension || 0),
      ]);
    }

    csv += rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${reportType}_${periodLabel.replace(' ', '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Downloaded', description: `${reportType} report exported.` });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <Select
          value={selectedPeriod?.id || ''}
          onValueChange={v => {
            const p = periods.find(pp => pp.id === v);
            if (p) onSelectPeriod(p);
          }}
        >
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent>
            {periods.map(p => (
              <SelectItem key={p.id} value={p.id}>
                {MONTHS[p.month - 1]} {p.year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={reportType} onValueChange={v => setReportType(v as ReportType)}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="master">Master Payroll</SelectItem>
            <SelectItem value="bank_schedule">Bank Schedule</SelectItem>
            <SelectItem value="cash_schedule">Cash Schedule</SelectItem>
            <SelectItem value="paye">PAYE Schedule</SelectItem>
            <SelectItem value="pension">Pension Schedule</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" onClick={exportCSV} className="ml-auto" disabled={entries.length === 0}>
          <Download className="h-4 w-4 mr-2" /> Export CSV
        </Button>
      </div>

      {/* Summary */}
      {selectedPeriod && entries.length > 0 && (
        <div className="flex gap-4 text-sm">
          <span className="text-muted-foreground">Entries: <strong>{entries.length}</strong></span>
          <span className="text-muted-foreground">Gross: <strong>₦{totalGross.toLocaleString()}</strong></span>
          <span className="text-muted-foreground">Net: <strong>₦{totalNet.toLocaleString()}</strong></span>
        </div>
      )}

      {/* Report Tables */}
      {selectedPeriod && entries.length > 0 && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            {reportType === 'master' && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>S/N</TableHead>
                    <TableHead>Staff ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Basic</TableHead>
                    <TableHead>Allowances</TableHead>
                    <TableHead>Gross</TableHead>
                    <TableHead>Deductions</TableHead>
                    <TableHead>Net Pay</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e, i) => (
                    <TableRow key={e.id}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell className="font-mono text-xs">{e.staff_employee_id}</TableCell>
                      <TableCell>{e.staff_name}</TableCell>
                      <TableCell>₦{e.basic_salary.toLocaleString()}</TableCell>
                      <TableCell>₦{Object.values(e.allowances).reduce((a, b) => a + b, 0).toLocaleString()}</TableCell>
                      <TableCell>₦{e.gross_pay.toLocaleString()}</TableCell>
                      <TableCell>₦{e.total_deductions.toLocaleString()}</TableCell>
                      <TableCell className="font-bold">₦{e.net_pay.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {reportType === 'bank_schedule' && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>S/N</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Bank</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bankEntries.map((e, i) => (
                    <TableRow key={e.id}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell>{e.staff_name}</TableCell>
                      <TableCell>{e.staff_bank_name}</TableCell>
                      <TableCell className="font-mono">{e.staff_account_number}</TableCell>
                      <TableCell className="font-bold">₦{e.net_pay.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {reportType === 'cash_schedule' && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>S/N</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Signature</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cashEntries.map((e, i) => (
                    <TableRow key={e.id}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell>{e.staff_name}</TableCell>
                      <TableCell className="font-bold">₦{e.net_pay.toLocaleString()}</TableCell>
                      <TableCell className="border-b border-muted-foreground w-32"></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {reportType === 'paye' && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>S/N</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Gross Pay</TableHead>
                    <TableHead>Tax</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e, i) => (
                    <TableRow key={e.id}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell>{e.staff_name}</TableCell>
                      <TableCell>₦{e.gross_pay.toLocaleString()}</TableCell>
                      <TableCell>₦{(e.deductions?.tax || 0).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {reportType === 'pension' && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>S/N</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Basic Salary</TableHead>
                    <TableHead>Pension</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e, i) => (
                    <TableRow key={e.id}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell>{e.staff_name}</TableCell>
                      <TableCell>₦{e.basic_salary.toLocaleString()}</TableCell>
                      <TableCell>₦{(e.deductions?.pension || 0).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      )}

      {(!selectedPeriod || entries.length === 0) && (
        <div className="text-center py-12 text-muted-foreground flex flex-col items-center gap-2">
          <FileText className="h-8 w-8" />
          {selectedPeriod ? 'No entries for this period.' : 'Select a payroll period to view reports.'}
        </div>
      )}
    </div>
  );
}
