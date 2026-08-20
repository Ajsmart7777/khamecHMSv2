import { HOSPITAL_LOGO_URL } from '@/lib/hospital';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { supabase } from '@/integrations/supabase/client';
import type { SponsorStatement, SponsorStatementItem } from '@/hooks/useSponsorStatements';
import {
  addSponsorServiceBreakdown,
  breakdownSponsorInvoice,
  emptySponsorServiceBreakdown,
  type SponsorServiceBreakdown,
} from '@/lib/sponsorStatementCategories';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

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
  const kobo = Math.round((n - whole) * 100);
  const w = whole === 0 ? 'zero' : toWords(whole);
  const cap = w.charAt(0).toUpperCase() + w.slice(1);
  return `${cap} naira${kobo ? ` and ${toWords(kobo)} kobo` : ''} only`;
}

interface CorporateManualStatementItem {
  id: string;
  patient_name: string;
  service_description: string;
  service_date: string;
  amount: number;
  notes: string | null;
}

type SponsorStatementReportItem = SponsorStatementItem & {
  service_breakdown: SponsorServiceBreakdown;
};

async function fetchItems(statementId: string): Promise<SponsorStatementReportItem[]> {
  const { data, error } = await supabase
    .from('sponsor_statement_items')
    .select('*')
    .eq('statement_id', statementId)
    .order('service_date', { ascending: true });
  if (error || !data) return [];
  const rows = data as unknown as Record<string, unknown>[];
  const patientIds = [...new Set(rows.map(row => String(row.patient_id || '')).filter(Boolean))];
  const invoiceIds = [...new Set(rows.map(row => String(row.invoice_id || '')).filter(Boolean))];
  const [{ data: patients }, { data: invoices }] = await Promise.all([
    patientIds.length ? supabase.from('patients').select('id, first_name, last_name, card_number').in('id', patientIds) : Promise.resolve({ data: [] as any[] }),
    invoiceIds.length ? supabase.from('invoices').select('id, invoice_number, total_amount').in('id', invoiceIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const patientById = new Map((patients || []).map((patient: any) => [String(patient.id), patient]));
  const invoiceById = new Map((invoices || []).map((invoice: any) => [String(invoice.id), invoice]));
  const { data: invoiceItems } = invoiceIds.length
    ? await supabase.from('invoice_items').select('invoice_id,description,category,total').in('invoice_id', invoiceIds)
    : { data: [] };
  const itemsByInvoice: Record<string, { description: string | null; category: string | null; total: number }[]> = {};
  (invoiceItems || []).forEach(item => {
    (itemsByInvoice[item.invoice_id] ||= []).push({
      description: item.description,
      category: item.category,
      total: Number(item.total || 0),
    });
  });

  return rows.map(row => ({
    ...(row as unknown as SponsorStatementItem),
    amount: Number(row.amount || 0),
    patient: patientById.get(String(row.patient_id || '')) || null,
    invoice: invoiceById.get(String(row.invoice_id || '')) || null,
    service_breakdown: breakdownSponsorInvoice(itemsByInvoice[String(row.invoice_id || '')] || [], Number(row.amount || 0)),
  }));
}

async function fetchManualItems(statementId: string): Promise<CorporateManualStatementItem[]> {
  const { data: links, error: linkError } = await supabase
    .from('corporate_statement_manual_items')
    .select('manual_service_id')
    .eq('statement_id', statementId);
  if (linkError || !links?.length) return [];
  const manualIds = links.map((link: any) => link.manual_service_id).filter(Boolean);
  const { data, error } = await supabase
    .from('corporate_manual_service_rows')
    .select('id,patient_name,service_description,service_date,amount,notes')
    .in('id', manualIds);
  if (error) return [];
  return ((data || []) as unknown as CorporateManualStatementItem[])
    .map(item => ({ ...item, amount: Number(item.amount) }))
    .sort((a, b) => a.service_date.localeCompare(b.service_date));
}

function categoryCell(value: number) {
  return value ? Number(value).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—';
}

function statementHtml(statement: SponsorStatement, items: SponsorStatementReportItem[], manualItems: CorporateManualStatementItem[]) {
  const grouped: Record<string, SponsorStatementReportItem[]> = {};
  items.forEach(it => { (grouped[it.patient_id] ||= []).push(it); });
  const totalBreakdown = emptySponsorServiceBreakdown();

  const rows = Object.entries(grouped).map(([, list]) => {
    const p = list[0].patient;
    const breakdown = emptySponsorServiceBreakdown();
    list.forEach(item => addSponsorServiceBreakdown(breakdown, item.service_breakdown));
    addSponsorServiceBreakdown(totalBreakdown, breakdown);
    const invoiceRefs = list.map(item => item.invoice?.invoice_number).filter(Boolean).join(', ');
    const subtotal = list.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return `<tr class="row">
      <td><strong>${p?.first_name ?? ''} ${p?.last_name ?? ''}</strong><br><span class="detail">${invoiceRefs || 'Registered service'}</span></td>
      <td class="mono">${p?.card_number ?? '—'}</td>
      <td class="num">${categoryCell(breakdown.medication)}</td>
      <td class="num">${categoryCell(breakdown.lab_test)}</td>
      <td class="num">${categoryCell(breakdown.delivery)}</td>
      <td class="num">${categoryCell(breakdown.bed)}</td>
      <td class="num">${categoryCell(breakdown.others)}</td>
      <td class="num total-cell">${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
    </tr>`;
  }).join('');

  const manualRows = manualItems.map(item => {
    const breakdown = breakdownSponsorInvoice([{ description: item.service_description, total: item.amount }], item.amount);
    addSponsorServiceBreakdown(totalBreakdown, breakdown);
    return `<tr class="manual-row">
      <td><strong>${item.patient_name}</strong><br><span class="detail">${item.service_description}</span></td>
      <td class="mono">WALK-IN</td>
      <td class="num">${categoryCell(breakdown.medication)}</td>
      <td class="num">${categoryCell(breakdown.lab_test)}</td>
      <td class="num">${categoryCell(breakdown.delivery)}</td>
      <td class="num">${categoryCell(breakdown.bed)}</td>
      <td class="num">${categoryCell(breakdown.others)}</td>
      <td class="num total-cell">${Number(item.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
    </tr>`;
  }).join('');

  const empty = items.length === 0 && manualItems.length === 0
    ? `<tr><td colspan="8" class="empty">No billable invoices or walk-in paper services in this period.</td></tr>`
    : '';

  return `
  <div class="doc">
    <div class="watermark">${statement.sponsor_type.toUpperCase()}</div>

    <header class="hero">
      <div class="brand">
        <div class="mark">${HOSPITAL_LOGO_URL ? `<img src="${HOSPITAL_LOGO_URL}" alt="logo" onerror="this.remove();this.parentNode.textContent='KMC'" />` : 'KMC'}</div>
        <div>
          <h1>Khadija Medical Center</h1>
          <p class="sub">No: 53, Katsina Road, P.O. Box 121, Funtua, Katsina State, Nigeria</p>
          <p class="sub small">RC: 43552 · khamecfuntua@gmail.com · 08033928843</p>
        </div>
      </div>
      <div class="stamp">
        <span class="stamp-label">${statement.sponsor_type === 'retainer' ? 'Retainer' : 'Corporate'}</span>
        <span class="stamp-title">Monthly Statement</span>
        <span class="stamp-num">${statement.statement_number}</span>
      </div>
    </header>

    <section class="meta">
      <div class="meta-card">
        <span class="meta-label">Billed to</span>
        <p class="meta-title">${statement.sponsor?.company_name ?? ''}</p>
        ${statement.sponsor?.contact_person ? `<p>Attn: ${statement.sponsor.contact_person}</p>` : ''}
        ${statement.sponsor?.address ? `<p class="dim">${statement.sponsor.address}</p>` : ''}
        ${statement.sponsor?.phone ? `<p class="dim">Tel: ${statement.sponsor.phone}</p>` : ''}
        ${statement.sponsor?.email ? `<p class="dim">${statement.sponsor.email}</p>` : ''}
      </div>
      <div class="meta-card period">
        <span class="meta-label">Statement period</span>
        <p class="meta-title">${MONTHS[statement.period_month - 1]} ${statement.period_year}</p>
        <p class="dim">${new Date(statement.period_start).toLocaleDateString()} — ${new Date(statement.period_end).toLocaleDateString()}</p>
        <div class="chips">
          <span class="chip"><b>${statement.patient_count}</b> patients</span>
          <span class="chip"><b>${statement.invoice_count}</b> invoices</span>
          ${statement.manual_service_count ? `<span class="chip"><b>${statement.manual_service_count}</b> walk-in services</span>` : ''}
          <span class="chip status status-${statement.status}">${statement.status}</span>
        </div>
      </div>
    </section>

    <section class="stats" aria-label="Statement summary">
      <div class="stat"><span class="stat-label">Total billed</span><strong class="stat-value">${money(statement.total_amount)}</strong></div>
      <div class="stat"><span class="stat-label">Registered patients</span><strong class="stat-value count">${Number(statement.patient_count || 0).toLocaleString()}</strong></div>
      <div class="stat"><span class="stat-label">Invoices</span><strong class="stat-value count">${Number(statement.invoice_count || 0).toLocaleString()}</strong></div>
      <div class="stat count-stat"><span class="stat-label">Walk-in services</span><strong class="stat-value count">${Number(statement.manual_service_count || 0).toLocaleString()}</strong></div>
    </section>

    <section class="items">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Card #</th>
            <th class="num">Medication (₦)</th>
            <th class="num">Lab Test (₦)</th>
            <th class="num">Delivery (₦)</th>
            <th class="num">Bed (₦)</th>
            <th class="num">Others (₦)</th>
            <th class="num">Total (₦)</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          ${manualRows}
          ${empty}
          <tr class="grand">
            <td colspan="2">Grand Total</td>
            <td class="num">${categoryCell(totalBreakdown.medication)}</td>
            <td class="num">${categoryCell(totalBreakdown.lab_test)}</td>
            <td class="num">${categoryCell(totalBreakdown.delivery)}</td>
            <td class="num">${categoryCell(totalBreakdown.bed)}</td>
            <td class="num">${categoryCell(totalBreakdown.others)}</td>
            <td class="num">${money(statement.total_amount)}</td>
          </tr>
        </tbody>
      </table>
      ${items.length > 0 || manualItems.length > 0 ? `<p class="in-words"><em>Amount in words:</em> <strong>${amountInWords(statement.total_amount)}</strong></p>` : ''}
    </section>

    <section class="terms">
      <div>
        <span class="term-label">Payment terms</span>
        <p>Kindly settle the above amount within <strong>30 days</strong> of receipt. Reference statement <strong>${statement.statement_number}</strong> on all payments.</p>
      </div>
      <div>
        <span class="term-label">Generated</span>
        <p>${new Date(statement.generated_at).toLocaleString()}</p>
      </div>
    </section>

    <footer class="sigs">
      <div class="sig">
        <div class="sig-line"></div>
        <span>Prepared by (Accountant)</span>
      </div>
      <div class="sig">
        <div class="sig-line"></div>
        <span>Received by (${statement.sponsor?.company_name ?? 'Sponsor'})</span>
      </div>
    </footer>

    <div class="doc-footer">
      <span>Khadija Medical Center · Accounts Department</span>
      <span>${statement.statement_number}</span>
    </div>
  </div>`;
}

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; background: #fff; }
  .doc {
    position: relative;
    width: 794px;
    padding: 48px 56px 40px;
    background: #fff;
    overflow: hidden;
  }
  .watermark {
    position: absolute;
    right: -60px; top: 260px;
    font-size: 180px;
    font-weight: 800;
    color: rgba(15, 60, 100, 0.04);
    letter-spacing: 12px;
    transform: rotate(-18deg);
    pointer-events: none;
  }
  .hero {
    display: flex; justify-content: space-between; align-items: flex-start;
    padding-bottom: 20px;
    border-bottom: 3px double #0f3c64;
  }
  .brand { display: flex; gap: 14px; align-items: center; }
  .brand .mark img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .brand .mark:has(img) { background: #fff !important; border: 1px solid #e5e7eb; padding: 4px; }
  .brand .mark {
    width: 54px; height: 54px;
    background: #0f3c64; color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 18px; letter-spacing: 1px;
    border-radius: 8px;
  }
  .brand h1 { font-size: 20px; font-weight: 700; letter-spacing: -0.3px; color: #0f3c64; }
  .brand .sub { font-size: 11px; color: #6b7280; margin-top: 2px; }
  .stamp {
    text-align: right;
    border-left: 3px solid #b8860b;
    padding-left: 14px;
  }
  .stamp-label {
    display: block;
    font-size: 9px; letter-spacing: 3px; text-transform: uppercase;
    color: #b8860b; font-weight: 700;
  }
  .stamp-title {
    display: block;
    font-size: 20px; font-weight: 700; color: #0f3c64;
    margin-top: 2px;
  }
  .stamp-num {
    display: block;
    font-family: 'Courier New', monospace;
    font-size: 11px; color: #444;
    margin-top: 4px;
  }
  .meta {
    display: grid; grid-template-columns: 1.2fr 1fr; gap: 16px;
    margin-top: 22px;
  }
  .meta-card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-left: 4px solid #0f3c64;
    padding: 14px 16px;
    border-radius: 4px;
  }
  .meta-card.period { border-left-color: #b8860b; }
  .meta-label {
    font-size: 9px; letter-spacing: 2px; text-transform: uppercase;
    color: #64748b; font-weight: 700;
  }
  .meta-title { font-size: 15px; font-weight: 700; color: #0f172a; margin-top: 4px; }
  .meta-card p { font-size: 11px; margin-top: 2px; }
  .meta-card p.dim { color: #64748b; }
  .chips { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
  .chip {
    font-size: 10px; padding: 3px 8px;
    background: #fff; border: 1px solid #cbd5e1; border-radius: 999px;
    color: #334155;
  }
  .chip b { color: #0f3c64; }
  .chip.status { text-transform: uppercase; font-weight: 700; letter-spacing: 1px; border: 0; }
  .status-draft { background: #f1f5f9; color: #475569; }
  .status-finalized { background: #fef3c7; color: #92400e; }
  .status-printed { background: #dbeafe; color: #1e40af; }
  .status-paid { background: #dcfce7; color: #166534; }
  .status-void { background: #fee2e2; color: #991b1b; }

  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 18px; }
  .stat { min-height: 58px; padding: 10px 11px; border: 1px solid #dce5ef; border-radius: 5px; background: #f8fafc; }
  .stat.count-stat { background: #fffbeb; border-color: #ead8a3; }
  .stat-label { display: block; color: #64748b; font-size: 8.5px; font-weight: 700; letter-spacing: 1.3px; text-transform: uppercase; }
  .stat-value { display: block; margin-top: 5px; color: #0f3c64; font-size: 14px; font-variant-numeric: tabular-nums; }
  .stat.count-stat .stat-value { color: #92400e; }
  .stat-value.count { font-size: 16px; }

  .items { margin-top: 22px; }
  .items table { width: 100%; border-collapse: collapse; font-size: 9.5px; table-layout: fixed; }
  .items thead th {
    background: #0f3c64; color: #fff;
    text-align: left; padding: 7px 5px;
    font-size: 8px; letter-spacing: .7px; text-transform: uppercase; font-weight: 600;
  }
  .items thead th:first-child { width: 22%; }
  .items thead th:nth-child(2) { width: 12%; }
  .items thead th.num { text-align: right; }
  .items td { padding: 7px 5px; border-bottom: 1px solid #eef2f7; vertical-align: top; }
  .items td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .items td.mono { font-family: 'Courier New', monospace; font-size: 8.5px; color: #334155; }
  .items td.total-cell { font-weight: 700; color: #0f3c64; }
  .items .detail { color: #64748b; font-size: 7.5px; }
  .items tr.subtotal td {
    background: #f8fafc; font-style: italic; color: #475569;
    border-bottom: 1px solid #cbd5e1; text-align: right;
  }
  .items tr.subtotal td.num { font-style: normal; font-weight: 700; color: #0f172a; }
  .items tr.manual-row td { background: #fffbeb; }
  .items tr.manual-row td:nth-child(3) { color: #92400e; font-size: 9px; font-weight: 700; }
  .items tr.grand td {
    background: #0f3c64; color: #fff;
    font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px;
    padding: 12px 10px; font-size: 12px;
  }
  .items tr.grand td.num { font-size: 15px; letter-spacing: 0; }
  .items tr td.empty { text-align: center; padding: 24px; color: #94a3b8; font-style: italic; }
  .in-words {
    margin-top: 10px; padding: 8px 12px;
    background: #fffbeb; border-left: 3px solid #b8860b;
    font-size: 11px; color: #713f12;
  }

  .terms {
    display: grid; grid-template-columns: 2fr 1fr; gap: 20px;
    margin-top: 22px; padding-top: 16px;
    border-top: 1px solid #e2e8f0;
  }
  .term-label {
    font-size: 9px; letter-spacing: 2px; text-transform: uppercase;
    color: #64748b; font-weight: 700;
  }
  .terms p { font-size: 10.5px; color: #334155; margin-top: 3px; line-height: 1.5; }

  .sigs {
    display: grid; grid-template-columns: 1fr 1fr; gap: 40px;
    margin-top: 48px;
  }
  .sig-line { border-top: 1px solid #0f172a; margin-bottom: 6px; }
  .sig span { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; }

  .doc-footer {
    display: flex; justify-content: space-between;
    margin-top: 30px; padding-top: 10px;
    border-top: 1px solid #e2e8f0;
    font-size: 9px; color: #94a3b8; letter-spacing: 1px;
  }
`;

async function renderPage(statement: SponsorStatement, items: SponsorStatementItem[], manualItems: CorporateManualStatementItem[]): Promise<HTMLCanvasElement> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;';
  host.innerHTML = `<style>${CSS}</style>${statementHtml(statement, items, manualItems)}`;
  document.body.appendChild(host);
  try {
    const target = host.querySelector('.doc') as HTMLElement;
    return await html2canvas(target, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  } finally {
    document.body.removeChild(host);
  }
}

function addCanvasToPdf(pdf: jsPDF, canvas: HTMLCanvasElement, isFirstPage: boolean) {
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
  if (!isFirstPage) pdf.addPage();
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.94), 'JPEG', x, y, w, h, undefined, 'FAST');
}

export async function downloadStatementPdf(statement: SponsorStatement, _existingItems?: SponsorStatementItem[]) {
  // Always fetch the enriched report rows; the panel’s cached statement items
  // contain invoice totals but not the invoice_items needed for service columns.
  const items = await fetchItems(statement.id);
  const manualItems = await fetchManualItems(statement.id);
  const canvas = await renderPage(statement, items, manualItems);
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  addCanvasToPdf(pdf, canvas, true);
  pdf.save(`${statement.statement_number}.pdf`);
}

export async function downloadBulkStatementsPdf(
  statements: SponsorStatement[],
  label: string,
  onProgress?: (done: number, total: number) => void,
) {
  if (statements.length === 0) return;
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  for (let i = 0; i < statements.length; i++) {
    const s = statements[i];
    const items = await fetchItems(s.id);
    const manualItems = await fetchManualItems(s.id);
    const canvas = await renderPage(s, items, manualItems);
    addCanvasToPdf(pdf, canvas, i === 0);
    onProgress?.(i + 1, statements.length);
  }
  pdf.save(`${label}.pdf`);
}
