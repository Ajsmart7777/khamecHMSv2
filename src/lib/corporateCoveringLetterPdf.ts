import { HOSPITAL_LOGO_URL } from '@/lib/hospital';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface CorporateCoveringLetterStatement {
  id: string;
  statement_number: string;
  period_year: number;
  period_month: number;
  period_start: string;
  period_end: string;
  total_amount: number;
  paid_amount: number;
  balance: number;
  invoice_count: number;
  patient_count: number;
  manual_service_count: number;
  status: string;
}

export interface CorporateCoveringLetterPayment {
  id: string;
  statement_id: string;
  statement_number: string;
  period_year: number;
  period_month: number;
  payment_date: string;
  amount: number;
  payment_method: string;
  bank_reference: string | null;
  notes: string | null;
}

export interface CorporateCoveringLetterInvoiceLine {
  service_date: string;
  amount: number;
  patient_name: string;
  card_number?: string | null;
  invoice_number?: string | null;
}

export interface CorporateCoveringLetterManualService {
  id: string;
  patient_name: string;
  service_description: string;
  service_date: string;
  amount: number;
  notes?: string | null;
}

export interface CorporateCoveringLetterData {
  reference: string;
  generated_at?: string;
  as_of_year: number;
  as_of_month: number;
  sponsor: {
    company_name: string;
    contact_person?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  statements: CorporateCoveringLetterStatement[];
  payments: CorporateCoveringLetterPayment[];
  current_invoice_items: CorporateCoveringLetterInvoiceLine[];
  current_manual_services: CorporateCoveringLetterManualService[];
  summary: {
    total_billed: number;
    total_paid: number;
    net_balance_due: number;
    credit_amount: number;
  };
}

function money(value: number) {
  return `₦${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function periodLabel(year: number, month: number) {
  return `${MONTHS[month - 1]} ${year}`;
}

function formatDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function statementRows(statements: CorporateCoveringLetterStatement[]) {
  const rows = statements
    .filter(s => s.period_year !== statements.at(-1)?.period_year || s.period_month !== statements.at(-1)?.period_month)
    .filter(s => Number(s.balance) > 0.004)
    .map((s, index) => `
      <tr>
        <td class="center">${index + 1}</td>
        <td><strong>${escapeHtml(s.statement_number)}</strong><br><span class="dim">${periodLabel(s.period_year, s.period_month)}</span></td>
        <td class="num">${money(s.total_amount)}</td>
        <td class="num">${money(s.paid_amount)}</td>
        <td class="num due">${money(s.balance)}</td>
      </tr>`)
    .join('');

  return rows || '<tr><td colspan="5" class="empty">No unpaid previous-month claims as at this statement date.</td></tr>';
}

function currentClaimRows(data: CorporateCoveringLetterData) {
  const invoiceRows = data.current_invoice_items.map((item, index) => `
    <tr>
      <td class="center">${index + 1}</td>
      <td>${formatDate(item.service_date)}</td>
      <td><strong>${escapeHtml(item.patient_name)}</strong>${item.card_number ? `<br><span class="dim mono">${escapeHtml(item.card_number)}</span>` : ''}</td>
      <td class="mono">${escapeHtml(item.invoice_number || '—')}</td>
      <td class="num">${money(item.amount)}</td>
    </tr>`).join('');

  const manualRows = data.current_manual_services.map((item, index) => `
    <tr class="manual-row">
      <td class="center">M${index + 1}</td>
      <td>${formatDate(item.service_date)}</td>
      <td><strong>${escapeHtml(item.patient_name)}</strong><br><span class="tag">Walk-in paper service</span></td>
      <td>${escapeHtml(item.service_description)}</td>
      <td class="num">${money(item.amount)}</td>
    </tr>`).join('');

  return invoiceRows || manualRows ? `${invoiceRows}${manualRows}` : '<tr><td colspan="5" class="empty">No billable services are included in the selected month.</td></tr>';
}

function paymentRows(payments: CorporateCoveringLetterPayment[]) {
  const rows = payments.map((payment, index) => `
    <tr>
      <td class="center">${index + 1}</td>
      <td>${formatDate(payment.payment_date)}</td>
      <td><strong>${escapeHtml(payment.statement_number)}</strong><br><span class="dim">${periodLabel(payment.period_year, payment.period_month)}</span></td>
      <td>${escapeHtml(payment.payment_method.replaceAll('_', ' '))}${payment.bank_reference ? `<br><span class="mono dim">${escapeHtml(payment.bank_reference)}</span>` : ''}</td>
      <td class="num paid">${money(payment.amount)}</td>
    </tr>`).join('');
  return rows || '<tr><td colspan="5" class="empty">No recorded payment has been applied to the statements in this period.</td></tr>';
}

function letterHtml(data: CorporateCoveringLetterData) {
  const current = data.statements.find(s => s.period_year === data.as_of_year && s.period_month === data.as_of_month);
  const currentAmount = Number(current?.total_amount || 0);
  const previousArrears = data.statements
    .filter(s => (s.period_year < data.as_of_year || (s.period_year === data.as_of_year && s.period_month < data.as_of_month)) && Number(s.balance) > 0.004)
    .reduce((total, item) => total + Number(item.balance), 0);
  const status = data.summary.net_balance_due > 0 ? 'BALANCE DUE' : data.summary.credit_amount > 0 ? 'CREDIT BALANCE' : 'SETTLED';
  const reference = escapeHtml(data.reference);

  return `
    <div class="doc">
      <div class="watermark">${status === 'BALANCE DUE' ? 'DUE' : status === 'CREDIT BALANCE' ? 'CREDIT' : 'SETTLED'}</div>
      <header class="hero">
        <div class="brand">
          <div class="mark">${HOSPITAL_LOGO_URL ? `<img src="${HOSPITAL_LOGO_URL}" alt="Khadija Medical Center logo" onerror="this.remove();this.parentNode.textContent='KMC'" />` : 'KMC'}</div>
          <div>
            <h1>Khadija Medical Center</h1>
            <p class="sub">No. 53, Katsina Road, P.O. Box 121, Funtua, Katsina State, Nigeria</p>
            <p class="sub">RC: 43552 · khamecfuntua@gmail.com · 08033928843</p>
          </div>
        </div>
        <div class="stamp">
          <span class="stamp-label">Corporate account</span>
          <span class="stamp-title">Covering Letter</span>
          <span class="stamp-num">${reference}</span>
        </div>
      </header>

      <section class="address-grid">
        <div>
          <span class="label">Date issued</span>
          <p class="date">${new Date(data.generated_at || Date.now()).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
          <span class="label period-label">Account position as at</span>
          <p class="date">${periodLabel(data.as_of_year, data.as_of_month)}</p>
        </div>
        <div class="address">
          <span class="label">Addressed to</span>
          <p class="company">${escapeHtml(data.sponsor.company_name)}</p>
          ${data.sponsor.contact_person ? `<p>Attn: ${escapeHtml(data.sponsor.contact_person)}</p>` : ''}
          ${data.sponsor.address ? `<p class="dim">${escapeHtml(data.sponsor.address)}</p>` : ''}
          ${data.sponsor.phone ? `<p class="dim">Tel: ${escapeHtml(data.sponsor.phone)}</p>` : ''}
          ${data.sponsor.email ? `<p class="dim">${escapeHtml(data.sponsor.email)}</p>` : ''}
        </div>
      </section>

      <section class="subject">
        <span>RE:</span>
        <div>
          <strong>Account statement and covering letter — ${periodLabel(data.as_of_year, data.as_of_month)}</strong>
          <p>Reference: ${reference}</p>
        </div>
      </section>

      <section class="intro">
        <p>Dear Sir/Madam,</p>
        <p>Please find below the reconciled position of your corporate account. This covering letter combines the current monthly claim, outstanding claims from previous months, payments received, and any resulting credit or balance due.</p>
      </section>

      <section>
        <h2><span>1</span> Current month claim</h2>
        <p class="section-note">Services rendered during ${periodLabel(data.as_of_year, data.as_of_month)}. Rows marked <strong>Walk-in paper service</strong> were provided to company-referred patients who were not registered in the HMS.</p>
        <table>
          <thead><tr><th class="center">#</th><th>Date</th><th>Patient / recipient</th><th>Invoice or service</th><th class="num">Amount (₦)</th></tr></thead>
          <tbody>
            ${currentClaimRows(data)}
            <tr class="subtotal"><td colspan="4">Current month claim${current ? ` · ${escapeHtml(current.statement_number)}` : ''}</td><td class="num">${money(currentAmount)}</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2><span>2</span> Outstanding previous-month claims (arrears)</h2>
        <table>
          <thead><tr><th class="center">#</th><th>Statement / period</th><th class="num">Billed (₦)</th><th class="num">Received (₦)</th><th class="num">Balance (₦)</th></tr></thead>
          <tbody>
            ${statementRows(data.statements)}
            <tr class="subtotal"><td colspan="4">Total previous-month arrears</td><td class="num">${money(previousArrears)}</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2><span>3</span> Payment history</h2>
        <table>
          <thead><tr><th class="center">#</th><th>Payment date</th><th>Applied statement</th><th>Method / reference</th><th class="num">Amount (₦)</th></tr></thead>
          <tbody>${paymentRows(data.payments)}</tbody>
        </table>
      </section>

      <section class="summary">
        <h2><span>4</span> Reconciliation summary</h2>
        <div class="summary-box">
          <div><span>Total billed to date</span><strong>${money(data.summary.total_billed)}</strong></div>
          <div><span>Total payments received</span><strong>${money(data.summary.total_paid)}</strong></div>
          <div class="result ${status === 'BALANCE DUE' ? 'due' : 'paid'}"><span>${status === 'CREDIT BALANCE' ? 'Overpayment / credit' : status === 'SETTLED' ? 'Net balance' : 'Net balance due'}</span><strong>${money(status === 'CREDIT BALANCE' ? data.summary.credit_amount : data.summary.net_balance_due)}</strong></div>
        </div>
      </section>

      <section class="closing">
        ${status === 'BALANCE DUE'
          ? `<p>We kindly request settlement of the net balance due of <strong>${money(data.summary.net_balance_due)}</strong>. Please quote reference <strong>${reference}</strong> on all payments so that the account can be reconciled promptly.</p>`
          : status === 'CREDIT BALANCE'
            ? `<p>The account currently has a credit of <strong>${money(data.summary.credit_amount)}</strong>, arising from payments received in excess of the billed position. The credit is shown here for reconciliation and can be applied according to your written instruction.</p>`
            : '<p>The account is fully reconciled as at the period shown above. Thank you for your continued partnership.</p>'}
        <p>Should you require clarification on any line item, please contact the Accounts Department.</p>
        <p>Yours faithfully,</p>
      </section>

      <footer class="signatures">
        <div><div class="line"></div><span>Prepared by</span><small>Accounts Department, Khadija Medical Center</small></div>
        <div><div class="line"></div><span>Acknowledged by</span><small>${escapeHtml(data.sponsor.company_name)}</small></div>
      </footer>
      <div class="footer"><span>Khadija Medical Center · Accounts Department · Confidential</span><span>${reference}</span></div>
    </div>`;
}

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1e293b; background: #fff; }
  .doc { position: relative; width: 794px; min-height: 1123px; padding: 46px 54px 40px; overflow: hidden; background: #fff; }
  .watermark { position: absolute; right: -42px; top: 370px; color: rgba(15,60,100,.04); transform: rotate(-20deg); font-size: 150px; font-weight: 900; letter-spacing: 12px; pointer-events: none; }
  .hero { display: flex; justify-content: space-between; gap: 20px; padding-bottom: 18px; border-bottom: 3px double #0f3c64; }
  .brand { display: flex; align-items: center; gap: 13px; }
  .mark { display: flex; width: 54px; height: 54px; border-radius: 8px; align-items: center; justify-content: center; background: #0f3c64; color: #fff; font-weight: 800; letter-spacing: 1px; overflow: hidden; }
  .mark img { display: block; width: 100%; height: 100%; padding: 3px; object-fit: contain; background: #fff; }
  h1 { color: #0f3c64; font-size: 20px; letter-spacing: -.3px; }
  .sub { margin-top: 2px; color: #64748b; font-size: 10.5px; }
  .stamp { min-width: 152px; padding-left: 13px; border-left: 3px solid #b8860b; text-align: right; }
  .stamp-label, .label { display: block; color: #64748b; font-size: 9px; font-weight: 700; letter-spacing: 1.8px; text-transform: uppercase; }
  .stamp-title { display: block; margin-top: 2px; color: #0f3c64; font-size: 17px; font-weight: 700; }
  .stamp-num { display: block; margin-top: 5px; color: #475569; font-family: 'Courier New', monospace; font-size: 10px; }
  .address-grid { display: grid; grid-template-columns: 1fr 1.45fr; gap: 22px; margin-top: 20px; }
  .period-label { margin-top: 14px; }
  .date { margin-top: 4px; color: #0f172a; font-size: 12px; font-weight: 600; }
  .address { padding-left: 16px; border-left: 3px solid #0f3c64; }
  .address .company { margin-top: 4px; color: #0f172a; font-size: 14px; font-weight: 700; }
  .address p { margin-top: 2px; font-size: 10.5px; }
  .dim { color: #64748b; }
  .subject { display: flex; gap: 12px; align-items: center; margin-top: 20px; padding: 11px 13px; border-left: 4px solid #b8860b; border-radius: 3px; background: #f8fafc; }
  .subject > span { padding: 4px 8px; border-radius: 3px; background: #b8860b; color: #fff; font-size: 10px; font-weight: 700; }
  .subject strong { color: #0f172a; font-size: 12px; }
  .subject p { margin-top: 2px; color: #64748b; font-size: 10px; }
  .intro, .closing { margin-top: 17px; font-size: 11px; line-height: 1.55; }
  .intro p + p, .closing p + p { margin-top: 7px; }
  section > h2 { display: flex; align-items: center; gap: 7px; margin-top: 20px; color: #0f3c64; font-size: 12.5px; }
  h2 span { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background: #0f3c64; color: #fff; font-size: 10px; }
  .section-note { margin: 5px 0 8px; color: #64748b; font-size: 10px; line-height: 1.4; }
  table { position: relative; z-index: 1; width: 100%; border-collapse: collapse; font-size: 10px; }
  th { padding: 8px 8px; background: #0f3c64; color: #fff; font-size: 8.8px; letter-spacing: .5px; text-align: left; text-transform: uppercase; }
  th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td { padding: 6px 8px; border-bottom: 1px solid #e8eef5; vertical-align: top; }
  td.center, th.center { text-align: center; }
  td.mono, .mono { font-family: 'Courier New', monospace; }
  tr.manual-row td { background: #fffbeb; }
  .tag { color: #92400e; font-size: 8.5px; font-weight: 700; text-transform: uppercase; }
  .paid { color: #166534; font-weight: 700; }
  .due { color: #9a3412; font-weight: 700; }
  tr.subtotal td { border-top: 1px solid #cbd5e1; background: #f8fafc; color: #0f172a; font-weight: 700; }
  td.empty { padding: 15px; color: #94a3b8; font-style: italic; text-align: center; }
  .summary-box { display: grid; grid-template-columns: 1fr; margin-top: 9px; border: 1px solid #d9e3ee; border-radius: 5px; overflow: hidden; }
  .summary-box div { display: flex; justify-content: space-between; gap: 20px; padding: 8px 11px; border-top: 1px solid #e8eef5; font-size: 11px; }
  .summary-box div:first-child { border-top: 0; }
  .summary-box strong { font-family: 'Courier New', monospace; }
  .summary-box .result { background: #fff7ed; border-top: 2px solid #b8860b; color: #7c2d12; font-size: 12px; font-weight: 700; }
  .summary-box .result.paid { background: #f0fdf4; border-top-color: #16a34a; color: #166534; }
  .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 38px; }
  .signatures .line { margin-bottom: 6px; border-top: 1px solid #0f172a; }
  .signatures span, .signatures small { display: block; color: #475569; font-size: 9.5px; }
  .signatures small { margin-top: 2px; color: #94a3b8; font-size: 8.5px; }
  .footer { display: flex; justify-content: space-between; margin-top: 26px; padding-top: 9px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 8px; letter-spacing: .7px; }
`;

async function renderCanvas(data: CorporateCoveringLetterData) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;';
  host.innerHTML = `<style>${CSS}</style>${letterHtml(data)}`;
  document.body.appendChild(host);
  try {
    const target = host.querySelector('.doc') as HTMLElement;
    return await html2canvas(target, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  } finally {
    document.body.removeChild(host);
  }
}

function addCanvasPages(pdf: jsPDF, canvas: HTMLCanvasElement) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const displayWidth = pageWidth - margin * 2;
  const displayHeight = pageHeight - margin * 2;
  const sourceHeightPerPage = Math.floor(canvas.width * (displayHeight / displayWidth));

  for (let sourceY = 0, page = 0; sourceY < canvas.height; sourceY += sourceHeightPerPage, page += 1) {
    const cropHeight = Math.min(sourceHeightPerPage, canvas.height - sourceY);
    const crop = document.createElement('canvas');
    crop.width = canvas.width;
    crop.height = cropHeight;
    crop.getContext('2d')?.drawImage(canvas, 0, sourceY, canvas.width, cropHeight, 0, 0, canvas.width, cropHeight);
    if (page > 0) pdf.addPage();
    const displayedHeight = cropHeight * (displayWidth / canvas.width);
    pdf.addImage(crop.toDataURL('image/jpeg', 0.94), 'JPEG', margin, margin, displayWidth, displayedHeight, undefined, 'FAST');
  }
}

export async function downloadCorporateCoveringLetter(data: CorporateCoveringLetterData) {
  const canvas = await renderCanvas(data);
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  addCanvasPages(pdf, canvas);
  const safeSponsor = data.sponsor.company_name.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
  pdf.save(`${safeSponsor || 'Corporate'}_${data.reference}_Covering_Letter.pdf`);
}
