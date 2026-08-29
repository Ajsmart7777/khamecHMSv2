import { PAYROLL_COLUMNS, type PayrollColumnDefinition, isPayrollTextField } from '@/lib/payroll';
import type { PayrollEntry } from '@/hooks/usePayroll';

export type ExcelReportType = 'master' | 'bank_schedule' | 'cash_schedule' | 'paye' | 'pension' | 'family_deductions' | 'family_med_manual';

interface ExcelExportOptions {
  reportType: ExcelReportType;
  periodLabel: string;
  entries: PayrollEntry[];
  bankEntries: PayrollEntry[];
  cashEntries: PayrollEntry[];
  payrollLabels: Record<string, string>;
  hospitalName?: string;
}

const EXCEL_STYLES = `
  <style>
    body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #1e293b; }
    table { border-collapse: collapse; width: 100%; }
    .title-main  { font-size: 16pt; font-weight: bold; color: #0f172a; height: 35px; }
    .title-sub   { font-size: 12pt; font-weight: bold; color: #334155; height: 25px; }
    .title-period{ font-size: 11pt; font-style: italic; color: #64748b;  height: 22px; }
    .hdr    { background:#1e293b; color:#fff; font-weight:bold; font-size:10pt; text-align:center; border:1px solid #0f172a; padding:6px 8px; white-space:nowrap; }
    .hdr-d  { background:#991b1b; color:#fff; font-weight:bold; font-size:10pt; text-align:center; border:1px solid #7f1d1d; padding:6px 8px; white-space:nowrap; }
    .hdr-n  { background:#047857; color:#fff; font-weight:bold; font-size:10.5pt; text-align:center; border:1px solid #065f46; padding:6px 8px; white-space:nowrap; }
    .even   { background:#ffffff; height:24px; }
    .odd    { background:#f8fafc; height:24px; }
    .ct     { mso-number-format:"\\@"; text-align:left;   border:1px solid #cbd5e1; padding:4px 6px; vertical-align:middle; }
    .cc     { mso-number-format:"\\@"; text-align:center; border:1px solid #cbd5e1; padding:4px 6px; vertical-align:middle; }
    .cn     { mso-number-format:"#,##0.00"; text-align:right;  border:1px solid #cbd5e1; padding:4px 6px; vertical-align:middle; }
    .cb     { font-weight:bold; }
    .ch     { background:#f1f5f9; font-weight:bold; }
    .cdr    { mso-number-format:"#,##0.00"; text-align:right; border:1px solid #cbd5e1; padding:4px 6px; color:#991b1b; vertical-align:middle; }
    .trow   { background:#e2e8f0; font-weight:bold; height:30px; border-top:2px solid #0f172a; }
    .tc     { font-weight:bold; text-align:left;  border:1px solid #94a3b8; padding:4px 6px; }
    .tn     { mso-number-format:"#,##0.00"; font-weight:bold; text-align:right; border:1px solid #94a3b8; padding:4px 6px; }
    .tnd    { mso-number-format:"#,##0.00"; font-weight:bold; text-align:right; border:1px solid #94a3b8; padding:4px 6px; color:#991b1b; }
    .sig-t  { font-weight:bold; font-size:11pt; color:#0f172a; padding-top:20px; }
    .sig-l  { border-bottom:1.5px solid #0f172a; height:30px; }
    .sig-s  { color:#64748b; font-size:9pt; }
  </style>
`;

function getMasterVal(entry: PayrollEntry, col: PayrollColumnDefinition): string | number {
  if (col.key === 'id') return entry.staff_employee_id || '';
  if (col.key === 'staff_name') return entry.staff_name || '';
  if (col.key === 'designation') return entry.staff_designation || '';
  if (col.key === 'basic_salary') return entry.basic_salary || 0;
  if (col.key === 'gross_pay') return entry.gross_pay || 0;
  if (col.key === 'total_deductions') return entry.total_deductions || 0;
  if (col.key === 'net_pay') return entry.net_pay || 0;
  if (isPayrollTextField(col.key)) return String(entry.allowances?.[col.key] || '');
  return col.kind === 'deduction' ? Number(entry.deductions?.[col.key] || 0) : Number(entry.allowances?.[col.key] || 0);
}

function masterTable(hospital: string, period: string, entries: PayrollEntry[], labels: Record<string, string>): string {
  const colCount = PAYROLL_COLUMNS.length + 1;

  const hdrs = [
    `<th class="hdr">S/N</th>`,
    ...PAYROLL_COLUMNS.map(c => {
      const cls = c.key === 'net_pay' ? 'hdr-n' : (c.kind === 'deduction' || c.kind === 'computed-deduction') ? 'hdr-d' : 'hdr';
      return `<th class="${cls}">${labels[c.key] || c.label}</th>`;
    }),
  ].join('');

  const rows = entries.map((e, i) => {
    const rowCls = i % 2 === 0 ? 'even' : 'odd';
    const cells = [
      `<td class="cc cb">${i + 1}</td>`,
      ...PAYROLL_COLUMNS.map(c => {
        const v = getMasterVal(e, c);
        const isText = typeof v === 'string' && (c.kind === 'identity' || isPayrollTextField(c.key));
        if (isText) return `<td class="${c.key === 'staff_name' ? 'ct cb' : 'ct'}">${String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</td>`;
        const hi = ['gross_pay','total_deductions','net_pay'].includes(c.key);
        const dr = c.kind === 'deduction' || c.kind === 'computed-deduction';
        return `<td class="cn ${hi ? 'ch' : ''} ${dr ? 'cdr' : ''}">${v}</td>`;
      }),
    ].join('');
    return `<tr class="${rowCls}">${cells}</tr>`;
  }).join('');

  // Grand totals row
  const totals = [
    `<td class="tc cc">—</td>`,
    `<td class="tc" colspan="4">GRAND TOTAL</td>`,
    `<td class="tc"></td>`,
    ...PAYROLL_COLUMNS.slice(5).map(c => {
      if (isPayrollTextField(c.key)) return `<td class="tc"></td>`;
      const sum = entries.reduce((acc, e) => acc + Number(getMasterVal(e, c) || 0), 0);
      return `<td class="tn">${sum}</td>`;
    }),
  ].join('');

  return `
    <table>
      <tr><td colspan="${colCount}" class="title-main">${hospital}</td></tr>
      <tr><td colspan="${colCount}" class="title-sub">STAFF MONTHLY MASTER PAYROLL REPORT</td></tr>
      <tr><td colspan="${colCount}" class="title-period">For the Payroll Period: ${period}</td></tr>
      <tr><td colspan="${colCount}" style="height:10px"></td></tr>
      <thead><tr>${hdrs}</tr></thead>
      <tbody>${rows}<tr class="trow">${totals}</tr></tbody>
    </table>
    <br><br>
    <table>
      <tr>
        <td colspan="5" class="sig-t">Prepared by Accounts:</td>
        <td colspan="3"></td>
        <td colspan="5" class="sig-t">Approved by:</td>
      </tr>
      <tr>
        <td colspan="5" class="sig-l"></td>
        <td colspan="3"></td>
        <td colspan="5" class="sig-l"></td>
      </tr>
      <tr>
        <td colspan="5" class="sig-s">Signature &amp; Date</td>
        <td colspan="3"></td>
        <td colspan="5" class="sig-s">Signature &amp; Date</td>
      </tr>
    </table>`;
}

function bankTable(hospital: string, period: string, entries: PayrollEntry[]): string {
  const total = entries.reduce((s, e) => s + (e.net_pay || 0), 0);
  const rows = entries.map((e, i) => `
    <tr class="${i % 2 === 0 ? 'even' : 'odd'}">
      <td class="cc cb">${i + 1}</td>
      <td class="cc">${e.staff_employee_id || '—'}</td>
      <td class="ct cb">${e.staff_name}</td>
      <td class="ct">${e.staff_designation || '—'}</td>
      <td class="ct">${e.staff_bank_name || '—'}</td>
      <td class="cc" style="mso-number-format:'\\@';">${e.staff_account_number || '—'}</td>
      <td class="cn ch">${e.net_pay || 0}</td>
    </tr>`).join('');
  return `
    <table>
      <tr><td colspan="7" class="title-main">${hospital}</td></tr>
      <tr><td colspan="7" class="title-sub">BANK SALARY SCHEDULE</td></tr>
      <tr><td colspan="7" class="title-period">Period: ${period} | Staff: ${entries.length}</td></tr>
      <tr><td colspan="7" style="height:10px"></td></tr>
      <thead><tr>
        <th class="hdr">S/N</th><th class="hdr">Staff ID</th><th class="hdr">Staff Name</th>
        <th class="hdr">Designation</th><th class="hdr">Bank Name</th>
        <th class="hdr">Account Number</th><th class="hdr-n">Net Pay (₦)</th>
      </tr></thead>
      <tbody>${rows}
        <tr class="trow"><td colspan="6" class="tc">TOTAL BANK TRANSFERS</td><td class="tn">${total}</td></tr>
      </tbody>
    </table>`;
}

function cashTable(hospital: string, period: string, entries: PayrollEntry[]): string {
  const total = entries.reduce((s, e) => s + (e.net_pay || 0), 0);
  const rows = entries.map((e, i) => `
    <tr class="${i % 2 === 0 ? 'even' : 'odd'}">
      <td class="cc cb">${i + 1}</td>
      <td class="cc">${e.staff_employee_id || '—'}</td>
      <td class="ct cb">${e.staff_name}</td>
      <td class="ct">${e.staff_designation || '—'}</td>
      <td class="cn ch">${e.net_pay || 0}</td>
      <td class="ct" style="width:160px"></td>
    </tr>`).join('');
  return `
    <table>
      <tr><td colspan="6" class="title-main">${hospital}</td></tr>
      <tr><td colspan="6" class="title-sub">CASH PAYMENT SCHEDULE</td></tr>
      <tr><td colspan="6" class="title-period">Period: ${period} | Staff: ${entries.length}</td></tr>
      <tr><td colspan="6" style="height:10px"></td></tr>
      <thead><tr>
        <th class="hdr">S/N</th><th class="hdr">Staff ID</th><th class="hdr">Staff Name</th>
        <th class="hdr">Designation</th><th class="hdr-n">Cash Amount (₦)</th><th class="hdr">Staff Signature</th>
      </tr></thead>
      <tbody>${rows}
        <tr class="trow"><td colspan="4" class="tc">TOTAL CASH</td><td class="tn">${total}</td><td class="tc"></td></tr>
      </tbody>
    </table>`;
}

function payeTable(hospital: string, period: string, entries: PayrollEntry[]): string {
  const tg = entries.reduce((s, e) => s + (e.gross_pay || 0), 0);
  const tp = entries.reduce((s, e) => s + Number(e.deductions?.paye || e.deductions?.tax || 0), 0);
  const rows = entries.map((e, i) => `
    <tr class="${i % 2 === 0 ? 'even' : 'odd'}">
      <td class="cc cb">${i + 1}</td>
      <td class="cc">${e.staff_employee_id || '—'}</td>
      <td class="ct cb">${e.staff_name}</td>
      <td class="cn">${e.gross_pay || 0}</td>
      <td class="cdr ch">${Number(e.deductions?.paye || e.deductions?.tax || 0)}</td>
    </tr>`).join('');
  return `
    <table>
      <tr><td colspan="5" class="title-main">${hospital}</td></tr>
      <tr><td colspan="5" class="title-sub">PAYE (TAX) DEDUCTIONS SCHEDULE</td></tr>
      <tr><td colspan="5" class="title-period">Period: ${period}</td></tr>
      <tr><td colspan="5" style="height:10px"></td></tr>
      <thead><tr>
        <th class="hdr">S/N</th><th class="hdr">Staff ID</th><th class="hdr">Staff Name</th>
        <th class="hdr">Gross Pay (₦)</th><th class="hdr-d">PAYE Tax (₦)</th>
      </tr></thead>
      <tbody>${rows}
        <tr class="trow"><td colspan="3" class="tc">TOTAL PAYE</td><td class="tn">${tg}</td><td class="tnd">${tp}</td></tr>
      </tbody>
    </table>`;
}

function pensionTable(hospital: string, period: string, entries: PayrollEntry[]): string {
  const tb = entries.reduce((s, e) => s + (e.basic_salary || 0), 0);
  const tc = entries.reduce((s, e) => s + Number(e.deductions?.contribution || e.deductions?.pension || 0), 0);
  const rows = entries.map((e, i) => `
    <tr class="${i % 2 === 0 ? 'even' : 'odd'}">
      <td class="cc cb">${i + 1}</td>
      <td class="cc">${e.staff_employee_id || '—'}</td>
      <td class="ct cb">${e.staff_name}</td>
      <td class="cn">${e.basic_salary || 0}</td>
      <td class="cdr ch">${Number(e.deductions?.contribution || e.deductions?.pension || 0)}</td>
    </tr>`).join('');
  return `
    <table>
      <tr><td colspan="5" class="title-main">${hospital}</td></tr>
      <tr><td colspan="5" class="title-sub">STAFF CONTRIBUTION / PENSION SCHEDULE</td></tr>
      <tr><td colspan="5" class="title-period">Period: ${period}</td></tr>
      <tr><td colspan="5" style="height:10px"></td></tr>
      <thead><tr>
        <th class="hdr">S/N</th><th class="hdr">Staff ID</th><th class="hdr">Staff Name</th>
        <th class="hdr">Basic Salary (₦)</th><th class="hdr-d">Contribution (₦)</th>
      </tr></thead>
      <tbody>${rows}
        <tr class="trow"><td colspan="3" class="tc">TOTAL CONTRIBUTIONS</td><td class="tn">${tb}</td><td class="tnd">${tc}</td></tr>
      </tbody>
    </table>`;
}

function familyMedTable(hospital: string, period: string, entries: PayrollEntry[]): string {
  const filtered = entries.filter(e => Number(e.deductions?.family_medical || 0) > 0);
  const total = filtered.reduce((s, e) => s + Number(e.deductions?.family_medical || 0), 0);
  const rows = filtered.map((e, i) => `
    <tr class="${i % 2 === 0 ? 'even' : 'odd'}">
      <td class="cc cb">${i + 1}</td>
      <td class="cc">${e.staff_employee_id || '—'}</td>
      <td class="ct cb">${e.staff_name}</td>
      <td class="ct">${e.staff_designation || '—'}</td>
      <td class="cdr ch">${Number(e.deductions?.family_medical || 0)}</td>
      <td class="cc">${e.status || 'Active'}</td>
    </tr>`).join('');
  return `
    <table>
      <tr><td colspan="6" class="title-main">${hospital}</td></tr>
      <tr><td colspan="6" class="title-sub">FAMILY MEDICAL DEDUCTIONS SCHEDULE</td></tr>
      <tr><td colspan="6" class="title-period">Period: ${period}</td></tr>
      <tr><td colspan="6" style="height:10px"></td></tr>
      <thead><tr>
        <th class="hdr">S/N</th><th class="hdr">Staff ID</th><th class="hdr">Staff Name</th>
        <th class="hdr">Designation</th><th class="hdr-d">Family Medical (₦)</th><th class="hdr">Status</th>
      </tr></thead>
      <tbody>${rows}
        <tr class="trow"><td colspan="4" class="tc">TOTAL FAMILY MEDICAL</td><td class="tnd">${total}</td><td class="tc"></td></tr>
      </tbody>
    </table>`;
}

export function exportPayrollToExcel({
  reportType,
  periodLabel,
  entries,
  bankEntries,
  cashEntries,
  payrollLabels,
  hospitalName = 'KHADIJA MEDICAL CENTRE',
}: ExcelExportOptions): void {
  const safe = periodLabel.replace(/\s+/g, '_');
  let tableHtml = '';
  let filename = `Payroll_${safe}.xls`;

  switch (reportType) {
    case 'master':
      tableHtml = masterTable(hospitalName, periodLabel, entries, payrollLabels);
      filename = `Payroll_Master_${safe}.xls`;
      break;
    case 'bank_schedule':
      tableHtml = bankTable(hospitalName, periodLabel, bankEntries);
      filename = `Payroll_Bank_Schedule_${safe}.xls`;
      break;
    case 'cash_schedule':
      tableHtml = cashTable(hospitalName, periodLabel, cashEntries);
      filename = `Payroll_Cash_Schedule_${safe}.xls`;
      break;
    case 'paye':
      tableHtml = payeTable(hospitalName, periodLabel, entries);
      filename = `Payroll_PAYE_${safe}.xls`;
      break;
    case 'pension':
      tableHtml = pensionTable(hospitalName, periodLabel, entries);
      filename = `Payroll_Contribution_${safe}.xls`;
      break;
    case 'family_deductions':
    case 'family_med_manual':
      tableHtml = familyMedTable(hospitalName, periodLabel, entries);
      filename = `Payroll_FamilyMedical_${safe}.xls`;
      break;
  }

  const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>Payroll Report</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
${EXCEL_STYLES}
</head><body>${tableHtml}</body></html>`;

  const blob = new Blob([doc], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
