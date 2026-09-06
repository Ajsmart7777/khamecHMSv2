import { HOSPITAL_LOGO_URL } from '@/lib/hospital';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { supabase } from '@/integrations/supabase/client';
import type { SponsorStatement, SponsorStatementItem } from '@/hooks/useSponsorStatements';
import {
  addSponsorServiceBreakdown,
  breakdownSponsorInvoice,
  emptySponsorServiceBreakdown,
  SPONSOR_EXAM_COLUMN_KEY,
  SPONSOR_EXAM_TABLE_COLUMNS,
  sponsorExamColumnAmount,
  sponsorExamColumnLabel,
  type SponsorServiceBreakdown,
} from '@/lib/sponsorStatementCategories';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// A4 at 96 dpi is 794 x 1123 css px. Every rendered page is exactly this box,
// so canvases map 1:1 onto PDF pages without re-scaling.
const PAGE_W = 794;
const PAGE_H = 1123;
const PAGE_PAD_TOP = 44;
const PAGE_PAD_BOTTOM = 40;
const BAND_GAP = 18;

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(v: number) {
  return `₦${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function numberCell(value: number) {
  return value ? Number(value).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—';
}

function amountInWords(n: number) {
  const a = ['','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const b = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  const toWords = (num: number): string => {
    if (num < 20) return a[num];
    if (num < 100) return b[Math.floor(num / 10)] + (num % 10 ? `-${a[num % 10]}` : '');
    if (num < 1000) return `${a[Math.floor(num / 100)]} hundred` + (num % 100 ? ` ${toWords(num % 100)}` : '');
    if (num < 1_000_000) return `${toWords(Math.floor(num / 1000))} thousand` + (num % 1000 ? ` ${toWords(num % 1000)}` : '');
    return `${toWords(Math.floor(num / 1_000_000))} million` + (num % 1_000_000 ? ` ${toWords(num % 1_000_000)}` : '');
  };
  const whole = Math.floor(n);
  const kobo = Math.round((n - whole) * 100);
  const w = whole === 0 ? 'zero' : toWords(whole);
  const cap = w.charAt(0).toUpperCase() + w.slice(1);
  return `${cap} naira${kobo ? ` and ${toWords(kobo)} kobo` : ''} only`;
}

function periodLabel(year: number, month: number) {
  return `${MONTHS[month - 1]} ${year}`;
}

function formatDate(value: string | null | undefined, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) });
}

// ---------------------------------------------------------------------------
// Report row model (shared by the PDF generator and the print dialog)
// ---------------------------------------------------------------------------

export interface SponsorPatientReportRow {
  kind: 'patient';
  name: string;
  /** Printed card column: physical card number when available, else system card. */
  card_number: string | null;
  /** Underlying system card id, shown as a tooltip only. */
  card_title: string | null;
  refs: string;
  breakdown: SponsorServiceBreakdown;
  subtotal: number;
}

export interface SponsorManualReportRow {
  kind: 'manual';
  name: string;
  service_description: string;
  card_number: string | null;
  breakdown: SponsorServiceBreakdown;
  subtotal: number;
}

export type SponsorReportRow = SponsorPatientReportRow | SponsorManualReportRow;

export interface SponsorStatementReport {
  statement: SponsorStatement;
  rows: SponsorReportRow[];
  total_breakdown: SponsorServiceBreakdown;
}

export interface SponsorStatementSummaryRow {
  statement_number: string;
  period_year: number;
  period_month: number;
  patient_count: number;
  invoice_count: number;
  manual_service_count: number;
  total_amount: number;
  status: string;
  sponsor_type: string;
  period_start: string;
  period_end: string;
  generated_at: string;
  sponsor?: SponsorStatement['sponsor'];
}

interface RawStatementRow extends Record<string, unknown> {
  id: string;
  statement_number: string;
  sponsor_id: string;
  sponsor_type: string;
  period_year: number;
  period_month: number;
  period_start: string;
  period_end: string;
  total_amount: number | string;
  invoice_count: number | string;
  patient_count: number | string;
  manual_service_count: number | string;
  status: string;
  generated_at: string;
}

function normalizeStatement(raw: RawStatementRow): SponsorStatement {
  return {
    id: raw.id,
    statement_number: raw.statement_number,
    sponsor_id: raw.sponsor_id,
    sponsor_type: raw.sponsor_type as SponsorStatement['sponsor_type'],
    period_year: Number(raw.period_year),
    period_month: Number(raw.period_month),
    period_start: raw.period_start,
    period_end: raw.period_end,
    total_amount: Number(raw.total_amount || 0),
    invoice_count: Number(raw.invoice_count || 0),
    patient_count: Number(raw.patient_count || 0),
    manual_service_count: Number(raw.manual_service_count || 0),
    previous_outstanding: Number(raw.previous_outstanding || 0),
    credit_applied: Number(raw.credit_applied || 0),
    amount_due: Number(raw.amount_due || 0),
    coverage_status: (raw.coverage_status as SponsorStatement['coverage_status']) || 'unpaid',
    status: raw.status as SponsorStatement['status'],
    notes: raw.notes as string | null,
    generated_at: raw.generated_at,
    finalized_at: raw.finalized_at as string | null,
    printed_at: raw.printed_at as string | null,
    paid_at: raw.paid_at as string | null,
  };
}

async function fetchStatementRow(statementId: string): Promise<SponsorStatement> {
  const { data, error } = await supabase
    .from('sponsor_statements')
    .select('*')
    .eq('id', statementId)
    .single();
  if (error || !data) throw error || new Error(`Statement ${statementId} not found`);
  const row = data as unknown as RawStatementRow;
  const statement = normalizeStatement(row);

  const { data: sponsors } = await supabase
    .from('corporate_accounts')
    .select('id, company_name, contact_person, email, phone, address')
    .eq('id', statement.sponsor_id)
    .single();
  if (sponsors) {
    statement.sponsor = sponsors as unknown as SponsorStatement['sponsor'];
  }
  return statement;
}

interface CorporateManualStatementItem {
  id: string;
  patient_name: string;
  service_description: string;
  service_date: string;
  amount: number;
  notes: string | null;
}

async function fetchManualItems(statementId: string): Promise<CorporateManualStatementItem[]> {
  const { data: links, error: linkError } = await supabase
    .from('corporate_statement_manual_items')
    .select('manual_service_id')
    .eq('statement_id', statementId);
  if (linkError || !links?.length) return [];
  const manualIds = (links as unknown as { manual_service_id: string }[]).map(link => link.manual_service_id).filter(Boolean);
  const { data, error } = await supabase
    .from('corporate_manual_service_rows')
    .select('id,patient_name,service_description,service_date,amount,notes')
    .in('id', manualIds);
  if (error) return [];
  return ((data || []) as unknown as CorporateManualStatementItem[])
    .map(item => ({ ...item, amount: Number(item.amount) }))
    .sort((a, b) => a.service_date.localeCompare(b.service_date));
}

/** Fetch the enriched report for one statement: full row, per-patient rows with
 *  service-column breakdowns, and walk-in paper services. */
export async function loadStatementReport(statementId: string): Promise<SponsorStatementReport> {
  const [statement, rawItems, manualItems] = await Promise.all([
    fetchStatementRow(statementId),
    (async () => {
      const { data, error } = await supabase
        .from('sponsor_statement_items')
        .select('*')
        .eq('statement_id', statementId)
        .order('service_date', { ascending: true });
      if (error || !data) return [] as SponsorStatementItem[];
      const rows = data as unknown as Record<string, unknown>[];
      const patientIds = [...new Set(rows.map(row => String(row.patient_id || '')).filter(Boolean))];
      const invoiceIds = [...new Set(rows.map(row => String(row.invoice_id || '')).filter(Boolean))];
      const [{ data: patients }, { data: invoices }] = await Promise.all([
        patientIds.length ? supabase.from('patients').select('id, first_name, last_name, card_number, physical_card_number').in('id', patientIds) : Promise.resolve({ data: [] as any[] }),
        invoiceIds.length ? supabase.from('invoices').select('id, invoice_number, total_amount').in('id', invoiceIds) : Promise.resolve({ data: [] as any[] }),
      ]);
      const patientById = new Map<string, any>((patients || []).map((patient: any) => [String(patient.id), patient]));
      const invoiceById = new Map<string, any>((invoices || []).map((invoice: any) => [String(invoice.id), invoice]));
      const { data: invoiceItems } = invoiceIds.length
        ? await supabase.from('invoice_items').select('invoice_id,description,category,total').in('invoice_id', invoiceIds)
        : { data: [] as any[] };
      const itemsByInvoice: Record<string, { description: string | null; category: string | null; total: number }[]> = {};
      (invoiceItems || []).forEach((item: any) => {
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
      })) as unknown as SponsorStatementItem[];
    })(),
    fetchManualItems(statementId),
  ]);

  const grouped: Record<string, SponsorStatementItem[]> = {};
  rawItems.forEach(item => {
    (grouped[item.patient_id] ||= []).push(item);
  });

  const totalBreakdown = emptySponsorServiceBreakdown();
  const rows: SponsorReportRow[] = [];

  Object.values(grouped).forEach(list => {
    const p = list[0].patient;
    const breakdown = emptySponsorServiceBreakdown();
    list.forEach(item => addSponsorServiceBreakdown(breakdown, (item as any).service_breakdown));
    addSponsorServiceBreakdown(totalBreakdown, breakdown);
    rows.push({
      kind: 'patient',
      name: `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim() || 'Registered patient',
      card_number: p?.physical_card_number || p?.card_number || null,
      card_title: p?.card_number ? `System Patient ID: ${p.card_number}` : null,
      refs: list.map(item => item.invoice?.invoice_number).filter(Boolean).join(', '),
      breakdown,
      subtotal: list.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    });
  });

  manualItems.forEach(item => {
    const breakdown = breakdownSponsorInvoice([{ description: item.service_description, total: item.amount }], item.amount);
    addSponsorServiceBreakdown(totalBreakdown, breakdown);
    rows.push({
      kind: 'manual',
      name: item.patient_name,
      service_description: item.service_description,
      card_number: 'WALK-IN',
      breakdown,
      subtotal: Number(item.amount || 0),
    });
  });

  return { statement, rows, total_breakdown: totalBreakdown };
}

// ---------------------------------------------------------------------------
// HTML building — one source of truth shared by the PDF and the print dialog
// ---------------------------------------------------------------------------

function buildCellAmounts(breakdown: SponsorServiceBreakdown) {
  return SPONSOR_EXAM_TABLE_COLUMNS.map(key => {
    const value = key === SPONSOR_EXAM_COLUMN_KEY ? sponsorExamColumnAmount(breakdown) : breakdown[key];
    return `<td class="num">${numberCell(value)}</td>`;
  }).join('');
}

function buildPreHtml(statement: SponsorStatement) {
  const accountLabel = statement.sponsor_type === 'retainer' ? 'Retainer' : 'Corporate';
  return `
    <div class="st-pre">
      <header class="st-letterhead">
        <div class="st-logo">${HOSPITAL_LOGO_URL ? `<img src="${HOSPITAL_LOGO_URL}" alt="" onerror="this.remove();this.parentNode.textContent='KMC'" />` : 'KMC'}</div>
        <div class="st-org">
          <h1>Khadija Medical Center</h1>
          <p>No. 53, Katsina Road, P.O. Box 121, Funtua, Katsina State, Nigeria</p>
          <p>RC 43552 &middot; khamecfuntua@gmail.com &middot; 08033928843</p>
        </div>
        <div class="st-docno">
          <span class="st-kind">${accountLabel} Monthly Statement</span>
          <span class="st-ref">No: ${escapeHtml(statement.statement_number)}</span>
        </div>
      </header>

      <div class="st-meta">
        <div class="st-mcol">
          <span class="st-label">Billed to</span>
          <p class="st-strong">${escapeHtml(statement.sponsor?.company_name || '')}</p>
          ${statement.sponsor?.contact_person ? `<p>Attn: ${escapeHtml(statement.sponsor.contact_person)}</p>` : ''}
          ${statement.sponsor?.address ? `<p>${escapeHtml(statement.sponsor.address)}</p>` : ''}
          ${statement.sponsor?.phone ? `<p>Tel: ${escapeHtml(statement.sponsor.phone)}</p>` : ''}
          ${statement.sponsor?.email ? `<p>${escapeHtml(statement.sponsor.email)}</p>` : ''}
        </div>
        <div class="st-mcol st-right">
          <span class="st-label">Statement period</span>
          <p class="st-strong">${periodLabel(statement.period_year, statement.period_month)}</p>
          <p>${formatDate(statement.period_start)} — ${formatDate(statement.period_end)}</p>
          <p>Issued: ${formatDate(statement.generated_at)}</p>
          <p>
            ${Number(statement.patient_count || 0)} patients &middot; ${Number(statement.invoice_count || 0)} invoices
            ${Number(statement.manual_service_count || 0) ? `&middot; ${Number(statement.manual_service_count || 0)} walk-in services` : ''}
          </p>
        </div>
      </div>
    </div>`;
}

function buildBandHtml(statement: SponsorStatement) {
  const accountLabel = statement.sponsor_type === 'retainer' ? 'Retainer' : 'Corporate';
  return `
    <div class="st-band">
      <span>Khadija Medical Center</span>
      <span>${accountLabel} Monthly Statement — No: ${escapeHtml(statement.statement_number)}</span>
      <span>${periodLabel(statement.period_year, statement.period_month)} — continued</span>
    </div>`;
}

function buildHeadHtml() {
  return `
    <tr>
      <th class="sn">S/N</th>
      <th class="name">Name</th>
      <th class="card">Card #</th>
      ${SPONSOR_EXAM_TABLE_COLUMNS.map(key => `<th class="num">${sponsorExamColumnLabel(key)} (₦)</th>`).join('')}
      <th class="num total">Total (₦)</th>
    </tr>`;
}

function buildRowHtml(row: SponsorReportRow, patientNo: number) {
  const detail = row.kind === 'manual'
    ? `<span class="detail">${escapeHtml(row.service_description)}</span>`
    : row.refs
      ? `<span class="detail">${escapeHtml(row.refs)}</span>`
      : '';
  const cardTitle = row.kind === 'patient' && row.card_title ? ` title="${escapeHtml(row.card_title)}"` : '';
  const sn = row.kind === 'patient' ? String(patientNo) : '—';
  return `
    <tr class="st-row">
      <td class="sn">${sn}</td>
      <td class="name"><strong>${escapeHtml(row.name)}</strong>${detail ? `<br>${detail}` : ''}</td>
      <td class="card mono"${cardTitle}>${escapeHtml(row.card_number || '—')}</td>
      ${buildCellAmounts(row.breakdown)}
      <td class="num total-cell">${numberCell(row.subtotal)}</td>
    </tr>`;
}

function buildEmptyRowHtml() {
  return `<tr class="st-empty"><td colspan="13">No billable invoices or walk-in paper services were recorded in this period.</td></tr>`;
}

function buildGrandRowHtml(totalBreakdown: SponsorServiceBreakdown, total: number) {
  return `
    <tr class="st-grand">
      <td colspan="3">Grand Total</td>
      ${buildCellAmounts(totalBreakdown)}
      <td class="num">${money(total)}</td>
    </tr>`;
}

function buildTailHtml(statement: SponsorStatement, totalBreakdown: SponsorServiceBreakdown) {
  const hasItems = Number(statement.total_amount || 0) > 0;
  return `
    <div class="st-tail">
      ${hasItems ? `<p class="st-words"><span>Amount in words:</span> <strong>${amountInWords(statement.total_amount)}</strong></p>` : ''}
      <div class="st-terms">
        <div>
          <span class="st-label">Payment terms</span>
          <p>Kindly settle the amount above within <strong>30 days</strong> of the issue date. Quote statement
          number <strong>${escapeHtml(statement.statement_number)}</strong> on every payment.</p>
        </div>
        <div>
          <span class="st-label">Prepared by</span>
          <p>Accounts Department, Khadija Medical Center</p>
        </div>
      </div>
      <div class="st-sigs">
        <div>
          <div class="st-sig-line"></div>
          <span>Prepared by (Accountant)</span>
          <small>Name, signature and date</small>
        </div>
        <div>
          <div class="st-sig-line"></div>
          <span>Received by (${escapeHtml(statement.sponsor?.company_name || 'Sponsor')})</span>
          <small>Name, signature, stamp and date</small>
        </div>
      </div>
      <div class="st-footer">
        <span>Khadija Medical Center &middot; Accounts Department &middot; This is a computer-generated statement.</span>
        <span>${escapeHtml(statement.statement_number)}</span>
      </div>
    </div>`;
}

/** Render a row list, numbering only patient rows sequentially. */
function buildRowsHtml(rows: SponsorReportRow[]): string {
  let patientNo = 0;
  return rows.map(row => {
    if (row.kind === 'patient') patientNo += 1;
    return buildRowHtml(row, patientNo);
  }).join('');
}

/** Continuous statement document — used for the on-screen/print preview. */
export function buildStatementHtml(report: SponsorStatementReport): string {
  const { statement, rows, total_breakdown: totalBreakdown } = report;
  const rowHtml = rows.length
    ? buildRowsHtml(rows)
    : buildEmptyRowHtml();
  return `
    <div class="st-doc">
      ${buildPreHtml(statement)}
      <table class="st-items">
        <thead>${buildHeadHtml()}</thead>
        <tbody>
          ${rowHtml}
          ${buildGrandRowHtml(totalBreakdown, Number(statement.total_amount || 0))}
        </tbody>
      </table>
      ${buildTailHtml(statement, totalBreakdown)}
    </div>`;
}

export const STATEMENT_CSS = `
  .st-doc, .st-page { font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif; }
  .st-doc, .st-doc *, .st-page, .st-page * { box-sizing: border-box; margin: 0; padding: 0; }
  .st-doc { width: ${PAGE_W}px; padding: ${PAGE_PAD_TOP}px 48px ${PAGE_PAD_BOTTOM}px; background: #fff; color: #16202b; }
  .st-page { width: ${PAGE_W}px; height: ${PAGE_H}px; padding: ${PAGE_PAD_TOP}px 48px ${PAGE_PAD_BOTTOM}px; background: #fff; color: #16202b; overflow: hidden; }
  .st-letterhead { display: flex; align-items: flex-start; gap: 14px; }
  .st-logo { width: 52px; height: 52px; flex: 0 0 auto; border: 1px solid #d5dbe2; border-radius: 50%; overflow: hidden; display: flex; align-items: center; justify-content: center; background: #fff; }
  .st-logo img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .st-logo:empty::after { content: 'KMC'; font-weight: 700; color: #16324f; }
  .st-org { flex: 1 1 auto; }
  .st-org h1 { font-size: 21px; font-weight: 700; letter-spacing: .2px; color: #16324f; line-height: 1.1; }
  .st-org p { font-size: 9.5px; color: #4b5563; margin-top: 3px; line-height: 1.35; }
  .st-docno { text-align: right; flex: 0 0 auto; }
  .st-kind { display: block; font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #16324f; }
  .st-ref { display: block; font-size: 11px; font-weight: 700; color: #111827; margin-top: 4px; font-variant-numeric: tabular-nums; }
  .st-org h1, .st-docno, .st-ref { page-break-after: avoid; }

  .st-pre { padding-bottom: 16px; border-bottom: 2px solid #16324f; }
  .st-meta { display: grid; grid-template-columns: 1.15fr 1fr; gap: 26px; margin-top: 14px; }
  .st-mcol p { font-size: 10.5px; color: #374151; margin-top: 3px; line-height: 1.4; }
  .st-mcol .st-strong { font-weight: 700; color: #111827; }
  .st-mcol.st-right { text-align: right; }
  .st-label { display: block; font-size: 7.5px; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase; color: #6b7280; }

  .st-items { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 14px; }
  .st-items thead { display: table-header-group; }
  .st-items thead th {
    background: #16324f; color: #fff; text-align: left; padding: 6px 5px;
    font-size: 7px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase;
    border: none;
  }
  .st-items thead th.sn { width: 24px; text-align: center; }
  .st-items thead th.name { width: 128px; }
  .st-items thead th.card { width: 62px; }
  .st-items thead th.total { width: 72px; }
  .st-items th.num, .st-items td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .st-items td { padding: 5px 5px; border-bottom: 1px solid #e3e8ee; vertical-align: top; font-size: 8.5px; color: #1f2937; }
  .st-items td.num { font-size: 8px; white-space: nowrap; }
  .st-items td.sn { text-align: center; color: #6b7280; font-size: 8px; }
  .st-items td.mono { font-family: 'Courier New', monospace; font-size: 7.8px; color: #374151; }
  .st-items .detail { display: block; color: #6b7280; font-size: 7.3px; line-height: 1.3; margin-top: 1px; }
  .st-items td.name strong { font-weight: 700; }
  .st-items .total-cell { font-weight: 700; color: #16324f; }
  .st-items td.empty, .st-items .st-empty td { padding: 18px 8px; text-align: center; color: #94a3b8; font-style: italic; border-bottom: 1px solid #e3e8ee; }
  .st-grand td {
    background: #f1f5f9; font-weight: 700; color: #111827; font-size: 9px; letter-spacing: .6px;
    text-transform: uppercase; padding: 8px 5px; border-top: 2px solid #16324f; border-bottom: 2px solid #16324f;
  }
  .st-grand td.num { font-size: 11px; text-transform: none; }
  .st-items tr { page-break-inside: avoid; }

  .st-tail { margin-top: 14px; }
  .st-words { background: #f8fafc; border-left: 3px solid #16324f; padding: 8px 10px; font-size: 9.5px; color: #1f2937; }
  .st-words span { text-transform: uppercase; letter-spacing: .5px; font-size: 7.5px; color: #6b7280; }
  .st-terms { display: grid; grid-template-columns: 1.4fr 1fr; gap: 26px; margin-top: 16px; }
  .st-terms p { font-size: 9px; color: #374151; margin-top: 3px; line-height: 1.5; }
  .st-sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 54px; }
  .st-sig-line { border-top: 1px solid #111827; margin-bottom: 5px; }
  .st-sigs span { font-size: 9px; font-weight: 700; color: #1f2937; text-transform: uppercase; letter-spacing: .4px; }
  .st-sigs small { display: block; color: #6b7280; font-size: 8px; margin-top: 2px; text-transform: none; letter-spacing: 0; }
  .st-footer { display: flex; justify-content: space-between; margin-top: 20px; padding-top: 8px; border-top: 1px solid #dde3ea; color: #9aa4b0; font-size: 7.5px; letter-spacing: .4px; }
  .st-band { display: flex; justify-content: space-between; gap: 16px; padding: 8px 0 10px; border-bottom: 1px solid #16324f; font-size: 9px; color: #4b5563; }
  .st-band span:first-child { font-weight: 700; color: #16324f; }
`;

// ---------------------------------------------------------------------------
// PDF rendering: each fragment is an exact A4 box, placed 1:1 on the page.
// ---------------------------------------------------------------------------

function appendHtml(host: HTMLElement, css: string, html: string) {
  host.innerHTML = `<style>${css}</style>${html}`;
  return host.querySelector('.st-page') || host.querySelector('.st-doc');
}

async function renderFragment(html: string): Promise<HTMLCanvasElement> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;z-index:-1;';
  const target = appendHtml(host, STATEMENT_CSS, html) as HTMLElement;
  document.body.appendChild(host);
  try {
    return await html2canvas(target, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  } finally {
    document.body.removeChild(host);
  }
}

function buildPagesHtml(report: SponsorStatementReport): string[] {
  const { statement, rows, total_breakdown: totalBreakdown } = report;
  const grandRowHtml = buildGrandRowHtml(totalBreakdown, Number(statement.total_amount || 0));
  const tailHtml = buildTailHtml(statement, totalBreakdown);

  if (rows.length === 0) {
    // Empty statement: a single page with the empty note and a zero grand total.
    return [`
      <div class="st-page">
        ${buildPreHtml(statement)}
        <table class="st-items"><thead>${buildHeadHtml()}</thead><tbody>${buildEmptyRowHtml()}${grandRowHtml}</tbody></table>
        ${tailHtml}
      </div>`];
  }

  // Measure the real layout once (hidden, natural flow) so rows are paginated
  // without ever splitting a table row across pages. The measured document
  // mirrors the final last-page layout: rows, grand total row, then tail.
  const measureHtml = `
    <div class="st-page">
      ${buildPreHtml(statement)}
      <table class="st-items">
        <thead>${buildHeadHtml()}</thead>
        <tbody>${buildRowsHtml(rows)}${grandRowHtml}</tbody>
      </table>
      ${tailHtml}
    </div>`;
  const measureHost = document.createElement('div');
  measureHost.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;';
  appendHtml(measureHost, STATEMENT_CSS, measureHtml);
  document.body.appendChild(measureHost);
  let rowHeights: number[] = [];
  let base1H = 0;
  let baseNH = 0;
  let closingBlockH = 0;
  try {
    const pageEl = measureHost.querySelector('.st-page') as HTMLElement;
    const pageTop = pageEl.getBoundingClientRect().top;
    const rowsEls = Array.from(pageEl.querySelectorAll('tbody tr.st-row')) as HTMLElement[];
    rowHeights = rowsEls.map(tr => tr.getBoundingClientRect().height);
    const theadEl = pageEl.querySelector('.st-items thead') as HTMLElement;
    const tailEl = pageEl.querySelector('.st-tail') as HTMLElement;
    const grandEl = pageEl.querySelector('tbody tr.st-grand') as HTMLElement;
    const theadH = theadEl.getBoundingClientRect().height;
    base1H = theadEl.getBoundingClientRect().top - pageTop + theadH;

    const bandProbe = document.createElement('div');
    bandProbe.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;';
    bandProbe.innerHTML = `<style>${STATEMENT_CSS}</style>${buildBandHtml(statement)}`;
    document.body.appendChild(bandProbe);
    try {
      const bandH = (bandProbe.querySelector('.st-band') as HTMLElement).getBoundingClientRect().height;
      baseNH = PAGE_PAD_TOP + bandH + BAND_GAP + theadH;
    } finally {
      document.body.removeChild(bandProbe);
    }

    const lastRowBottom = rowsEls[rowsEls.length - 1].getBoundingClientRect().bottom;
    // Closing block: grand-total row, the gap after the table, and the tail.
    closingBlockH = tailEl.getBoundingClientRect().bottom - lastRowBottom;
    if (!(closingBlockH > 0) && grandEl) {
      closingBlockH = grandEl.getBoundingClientRect().height + tailEl.getBoundingClientRect().height;
    }
  } finally {
    document.body.removeChild(measureHost);
  }

  const contentLimit = PAGE_H - PAGE_PAD_TOP - PAGE_PAD_BOTTOM;
  const capacityFirst = Math.max(120, contentLimit - base1H);
  const capacityNext = Math.max(120, contentLimit - baseNH);

  // Greedy row packing: the first page carries the letterhead, later pages a band.
  const chunks: number[][] = [];
  let current: number[] = [];
  let used = 0;
  let firstPage = true;
  rows.forEach((_, index) => {
    const h = rowHeights[index] || 24;
    const capacity = firstPage ? capacityFirst : capacityNext;
    if (used + h > capacity && current.length > 0) {
      chunks.push(current);
      current = [];
      used = 0;
      firstPage = false;
    }
    current.push(index);
    used += h;
  });
  if (current.length) chunks.push(current);

  const pages: string[] = [];
  chunks.forEach((chunk, chunkIndex) => {
    const isFirstPage = chunkIndex === 0;
    const isLastChunk = chunkIndex === chunks.length - 1;
    const head = isFirstPage ? buildPreHtml(statement) : buildBandHtml(statement);
    const chunkRows = chunk.map(index => rows[index]);
    const usedRows = buildRowsHtml(chunkRows);

    if (!isLastChunk) {
      pages.push(`
        <div class="st-page">
          ${head}
          <table class="st-items">
            <thead>${buildHeadHtml()}</thead>
            <tbody>${usedRows}</tbody>
          </table>
        </div>`);
      return;
    }

    // Last chunk: keep the grand-total row and closing text together, either
    // directly below the rows or on a dedicated final page.
    const rowsH = chunk.reduce((sum, index) => sum + (rowHeights[index] || 24), 0);
    const headH = isFirstPage ? base1H : baseNH;
    const closingFits = contentLimit - headH - rowsH >= closingBlockH;

    if (closingFits) {
      pages.push(`
        <div class="st-page">
          ${head}
          <table class="st-items">
            <thead>${buildHeadHtml()}</thead>
            <tbody>${usedRows}${grandRowHtml}</tbody>
          </table>
          ${tailHtml}
        </div>`);
    } else {
      pages.push(`
        <div class="st-page">
          ${head}
          <table class="st-items">
            <thead>${buildHeadHtml()}</thead>
            <tbody>${usedRows}</tbody>
          </table>
        </div>`);
      // Dedicated closing page keeps the header row so column widths match.
      pages.push(`
        <div class="st-page">
          ${buildBandHtml(statement)}
          <table class="st-items">
            <thead>${buildHeadHtml()}</thead>
            <tbody>${grandRowHtml}</tbody>
          </table>
          ${tailHtml}
        </div>`);
    }
  });

  return pages;
}

function addPageToPdf(pdf: jsPDF, canvas: HTMLCanvasElement) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  if (pdf.getNumberOfPages() > 0) pdf.addPage();
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.93), 'JPEG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Download the monthly statement as a formal, paginated A4 PDF. The statement
 *  is always re-fetched by id, so any caller may pass a partial row. */
export async function downloadStatementPdf(statement: SponsorStatement | { id: string }, _existingItems?: SponsorStatementItem[]) {
  const report = await loadStatementReport(statement.id);
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  for (const pageHtml of buildPagesHtml(report)) {
    addPageToPdf(pdf, await renderFragment(pageHtml));
  }
  pdf.save(`${report.statement.statement_number}.pdf`);
}

export async function downloadBulkStatementsPdf(
  statements: SponsorStatement[],
  label: string,
  onProgress?: (done: number, total: number) => void,
) {
  if (statements.length === 0) return;
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  for (let i = 0; i < statements.length; i++) {
    const report = await loadStatementReport(statements[i].id);
    for (const pageHtml of buildPagesHtml(report)) {
      addPageToPdf(pdf, await renderFragment(pageHtml));
    }
    onProgress?.(i + 1, statements.length);
  }
  pdf.save(`${label}.pdf`);
}
