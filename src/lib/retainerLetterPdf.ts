import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export interface RetainerLetterPatientRow {
  patient_id: string;
  patient_name: string;
  card_number: string | null;
  visits: number;
  invoices: Array<{ invoice_number: string; amount: number; service_date: string }>;
  subtotal: number;
}

export interface RetainerLetterData {
  statement_number: string;
  retainer: {
    company_name: string;
    phone?: string | null;
    address?: string | null;
    contact_person?: string | null;
    email?: string | null;
  };
  period_year: number;
  period_month: number;
  period_start: string;
  period_end: string;
  total_amount: number;
  deposit_applied: number;
  balance_outstanding: number;
  balance_after: number;
  patients: RetainerLetterPatientRow[];
  mode: 'receipt' | 'demand';
  generated_at?: string;
}

function money(v: number) {
  return `₦${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function amountInWords(n: number) {
  const a = ['','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const b = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  const toWords = (num: number): string => {
    if (num < 20) return a[num];
    if (num < 100) return b[Math.floor(num/10)] + (num%10 ? '-' + a[num%10] : '');
    if (num < 1000) return a[Math.floor(num/100)] + ' hundred' + (num%100 ? ' ' + toWords(num%100) : '');
    if (num < 1_000_000) return toWords(Math.floor(num/1000)) + ' thousand' + (num%1000 ? ' ' + toWords(num%1000) : '');
    return toWords(Math.floor(num/1_000_000)) + ' million' + (num%1_000_000 ? ' ' + toWords(num%1_000_000) : '');
  };
  const whole = Math.floor(n);
  const w = whole === 0 ? 'zero' : toWords(whole);
  return `${w.charAt(0).toUpperCase() + w.slice(1)} naira only`;
}

function letterBody(data: RetainerLetterData) {
  const isReceipt = data.mode === 'receipt';
  const title = isReceipt ? 'PAYMENT RECEIPT' : 'STATEMENT OF ACCOUNT';
  const salutation = isReceipt
    ? `We hereby acknowledge, with thanks, receipt of payment covering medical services rendered to your enrolled patients during the period stated below.`
    : `Please find below a summary of medical services rendered to your enrolled patients under our retainer agreement during the period stated. Kindly settle the outstanding balance at your earliest convenience.`;
  const closingLine = isReceipt
    ? `Thank you for your continued partnership. This document serves as the official receipt for services rendered during this period.`
    : `We kindly request settlement of the outstanding balance within <strong>30 days</strong> of receipt. Please quote reference <strong>${data.statement_number}</strong> on all payments.`;

  const patientRows = data.patients.map((p, idx) => {
    const invoiceList = p.invoices.length > 0
      ? p.invoices.map(i => i.invoice_number).join(', ')
      : '<span class="dim">—</span>';
    return `
      <tr>
        <td class="idx">${idx + 1}</td>
        <td>
          <div class="pname">${p.patient_name}</div>
          ${p.card_number ? `<div class="pcard">${p.card_number}</div>` : ''}
        </td>
        <td class="center">${p.visits}</td>
        <td class="mono small">${invoiceList}</td>
        <td class="num">${p.subtotal > 0 ? Number(p.subtotal).toLocaleString(undefined,{minimumFractionDigits:2}) : '<span class="dim">0.00</span>'}</td>
      </tr>`;
  }).join('');

  const emptyRow = data.patients.length === 0
    ? `<tr><td colspan="5" class="empty">No enrolled patients on file for this period.</td></tr>`
    : '';

  return `
  <div class="doc">
    <div class="watermark">${isReceipt ? 'PAID' : 'DUE'}</div>

    <header class="hero">
      <div class="brand">
        <div class="mark">KMC</div>
        <div>
          <h1>Khadija Medical Center</h1>
          <p class="sub">Comprehensive Healthcare · Accounts Department</p>
          <p class="sub small">Phone: +234 XXX XXX XXXX · Email: accounts@khadijamedical.ng</p>
        </div>
      </div>
      <div class="stamp ${isReceipt ? 'stamp-paid' : 'stamp-due'}">
        <span class="stamp-label">Retainer</span>
        <span class="stamp-title">${title}</span>
        <span class="stamp-num">${data.statement_number}</span>
      </div>
    </header>

    <section class="letter-head">
      <div class="date-block">
        <span class="lbl">Date issued</span>
        <p>${new Date(data.generated_at || Date.now()).toLocaleDateString('en-GB', { day:'2-digit', month:'long', year:'numeric' })}</p>
      </div>
      <div class="addr-block">
        <span class="lbl">Addressed to</span>
        <p class="who">${data.retainer.company_name}</p>
        ${data.retainer.contact_person ? `<p>Attn: ${data.retainer.contact_person}</p>` : ''}
        ${data.retainer.address ? `<p class="dim">${data.retainer.address}</p>` : ''}
        ${data.retainer.phone ? `<p class="dim">Tel: ${data.retainer.phone}</p>` : ''}
        ${data.retainer.email ? `<p class="dim">${data.retainer.email}</p>` : ''}
      </div>
    </section>

    <section class="subject">
      <div class="subj-badge">RE:</div>
      <div>
        <p class="subj-title">${isReceipt ? 'Payment received' : 'Statement of account'} — ${MONTHS[data.period_month - 1]} ${data.period_year}</p>
        <p class="subj-sub">Service period: ${new Date(data.period_start).toLocaleDateString('en-GB')} to ${new Date(data.period_end).toLocaleDateString('en-GB')}</p>
      </div>
    </section>

    <section class="salutation">
      <p>Dear Sir/Madam,</p>
      <p class="para">${salutation}</p>
    </section>

    <section class="items">
      <table>
        <thead>
          <tr>
            <th class="idx">#</th>
            <th>Enrolled Patient</th>
            <th class="center">Visits</th>
            <th>Invoice #(s)</th>
            <th class="num">Amount (₦)</th>
          </tr>
        </thead>
        <tbody>
          ${patientRows}
          ${emptyRow}
        </tbody>
      </table>
    </section>

    <section class="totals">
      <div class="totals-inner">
        <div class="line">
          <span>Total services rendered</span>
          <span class="mono">${money(data.total_amount)}</span>
        </div>
        <div class="line">
          <span>Deposit applied</span>
          <span class="mono">(${money(data.deposit_applied)})</span>
        </div>
        <div class="line grand ${isReceipt ? 'grand-paid' : 'grand-due'}">
          <span>${isReceipt ? 'Amount fully settled' : 'Balance outstanding'}</span>
          <span class="mono">${money(data.balance_outstanding)}</span>
        </div>
        <p class="in-words"><em>In words:</em> ${amountInWords(isReceipt ? data.total_amount : data.balance_outstanding)}</p>
      </div>
    </section>

    <section class="closing">
      <p class="para">${closingLine}</p>
      <p class="para">Should you have any queries regarding this ${isReceipt ? 'receipt' : 'statement'}, please do not hesitate to contact the Accounts Department at your convenience.</p>
      <p class="para">Yours faithfully,</p>
    </section>

    <section class="sigs">
      <div class="sig">
        <div class="sig-line"></div>
        <span>For Khadija Medical Center</span>
        <span class="sig-role">Accounts Department</span>
      </div>
      <div class="sig">
        <div class="sig-line"></div>
        <span>Acknowledged by</span>
        <span class="sig-role">${data.retainer.company_name}</span>
      </div>
    </section>

    <div class="doc-footer">
      <span>Khadija Medical Center · Accounts Department · Confidential</span>
      <span>${data.statement_number}</span>
    </div>
  </div>`;
}

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; background: #fff; }
  .doc {
    position: relative;
    width: 794px;
    padding: 46px 56px 40px;
    background: #fff;
    overflow: hidden;
  }
  .watermark {
    position: absolute;
    right: -30px; top: 320px;
    font-size: 220px;
    font-weight: 900;
    color: rgba(15, 60, 100, 0.05);
    letter-spacing: 16px;
    transform: rotate(-22deg);
    pointer-events: none;
  }
  .hero {
    display: flex; justify-content: space-between; align-items: flex-start;
    padding-bottom: 18px;
    border-bottom: 3px double #0f3c64;
  }
  .brand { display: flex; gap: 14px; align-items: center; }
  .brand .mark {
    width: 56px; height: 56px;
    background: linear-gradient(135deg,#0f3c64,#1e5a8f);
    color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 18px; letter-spacing: 1px;
    border-radius: 10px;
    box-shadow: 0 4px 8px rgba(15,60,100,0.15);
  }
  .brand h1 { font-size: 20px; font-weight: 700; letter-spacing: -0.3px; color: #0f3c64; }
  .brand .sub { font-size: 11px; color: #6b7280; margin-top: 2px; }
  .brand .sub.small { font-size: 10px; }
  .stamp { text-align: right; padding-left: 14px; border-left: 3px solid; }
  .stamp-paid { border-left-color: #16a34a; }
  .stamp-due { border-left-color: #b8860b; }
  .stamp-label {
    display: block; font-size: 9px; letter-spacing: 3px; text-transform: uppercase;
    color: #6b7280; font-weight: 700;
  }
  .stamp-title {
    display: block; font-size: 18px; font-weight: 700; color: #0f3c64;
    margin-top: 3px; letter-spacing: 1px;
  }
  .stamp-num {
    display: block; font-family: 'Courier New', monospace;
    font-size: 11px; color: #444; margin-top: 4px;
  }

  .letter-head {
    display: grid; grid-template-columns: 1fr 1.4fr; gap: 24px;
    margin-top: 24px;
  }
  .lbl {
    display: block; font-size: 9px; letter-spacing: 2px;
    text-transform: uppercase; color: #64748b; font-weight: 700; margin-bottom: 4px;
  }
  .date-block p { font-size: 12px; color: #0f172a; font-weight: 500; }
  .addr-block .who { font-size: 14px; font-weight: 700; color: #0f172a; margin-bottom: 2px; }
  .addr-block p { font-size: 11px; margin-top: 1px; }
  .addr-block p.dim { color: #64748b; }

  .subject {
    display: flex; gap: 12px; align-items: center;
    margin-top: 20px; padding: 12px 14px;
    background: #f8fafc; border-left: 4px solid #b8860b; border-radius: 4px;
  }
  .subj-badge {
    background: #b8860b; color: #fff;
    padding: 4px 10px; border-radius: 4px;
    font-size: 11px; font-weight: 700; letter-spacing: 1px;
  }
  .subj-title { font-size: 13px; font-weight: 700; color: #0f172a; }
  .subj-sub { font-size: 10.5px; color: #475569; margin-top: 2px; }

  .salutation { margin-top: 18px; }
  .salutation p { font-size: 11.5px; color: #1e293b; }
  .salutation .para { margin-top: 8px; line-height: 1.6; text-align: justify; }

  .items { margin-top: 18px; }
  .items table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .items thead th {
    background: #0f3c64; color: #fff;
    text-align: left; padding: 9px 10px;
    font-size: 10px; letter-spacing: 1px; text-transform: uppercase; font-weight: 600;
  }
  .items thead th.num { text-align: right; }
  .items thead th.center, .items thead th.idx { text-align: center; }
  .items td { padding: 8px 10px; border-bottom: 1px solid #eef2f7; vertical-align: middle; }
  .items td.num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 500; }
  .items td.mono { font-family: 'Courier New', monospace; color: #334155; }
  .items td.small { font-size: 10px; }
  .items td.center, .items td.idx { text-align: center; }
  .items td.idx { color: #94a3b8; font-weight: 600; }
  .pname { font-weight: 600; color: #0f172a; }
  .pcard { font-size: 10px; color: #64748b; font-family: 'Courier New', monospace; margin-top: 1px; }
  .dim { color: #94a3b8; }
  .items tr td.empty { text-align: center; padding: 24px; color: #94a3b8; font-style: italic; }

  .totals { margin-top: 16px; display: flex; justify-content: flex-end; }
  .totals-inner {
    min-width: 340px;
    padding: 14px 18px;
    background: #f8fafc;
    border: 1px solid #e2e8f0; border-radius: 6px;
  }
  .totals-inner .line {
    display: flex; justify-content: space-between;
    padding: 5px 0; font-size: 12px; color: #334155;
  }
  .totals-inner .line .mono { font-family: 'Courier New', monospace; font-weight: 500; }
  .totals-inner .grand {
    margin-top: 6px; padding-top: 10px;
    border-top: 2px solid;
    font-size: 14px; font-weight: 700;
  }
  .totals-inner .grand-paid { border-top-color: #16a34a; color: #166534; }
  .totals-inner .grand-due  { border-top-color: #b8860b; color: #713f12; }
  .in-words {
    margin-top: 10px; padding-top: 8px;
    border-top: 1px dashed #cbd5e1;
    font-size: 10.5px; color: #475569; font-style: italic;
  }

  .closing { margin-top: 20px; }
  .closing .para { font-size: 11.5px; color: #1e293b; line-height: 1.6; margin-top: 8px; text-align: justify; }

  .sigs {
    display: grid; grid-template-columns: 1fr 1fr; gap: 60px;
    margin-top: 40px;
  }
  .sig-line { border-top: 1.5px solid #0f172a; margin-bottom: 6px; }
  .sig span { display: block; font-size: 10px; color: #475569; }
  .sig .sig-role { font-size: 9px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-top: 1px; }

  .doc-footer {
    display: flex; justify-content: space-between;
    margin-top: 28px; padding-top: 10px;
    border-top: 1px solid #e2e8f0;
    font-size: 9px; color: #94a3b8; letter-spacing: 1px;
  }
`;

async function renderCanvas(data: RetainerLetterData): Promise<HTMLCanvasElement> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;';
  host.innerHTML = `<style>${CSS}</style>${letterBody(data)}`;
  document.body.appendChild(host);
  try {
    const target = host.querySelector('.doc') as HTMLElement;
    return await html2canvas(target, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  } finally {
    document.body.removeChild(host);
  }
}

export async function downloadRetainerLetter(data: RetainerLetterData) {
  const canvas = await renderCanvas(data);
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const availW = pageW - margin * 2;
  const availH = pageH - margin * 2;
  const ratio = canvas.width / canvas.height;
  let w = availW;
  let h = w / ratio;
  if (h > availH) { h = availH; w = h * ratio; }
  const x = (pageW - w) / 2;
  const y = (pageH - h) / 2;
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.94), 'JPEG', x, y, w, h, undefined, 'FAST');
  const label = data.mode === 'receipt' ? 'Receipt' : 'Statement';
  pdf.save(`Retainer-${label}-${data.retainer.company_name.replace(/[^a-z0-9]+/gi,'-')}-${data.period_year}-${String(data.period_month).padStart(2,'0')}.pdf`);
}