import { HOSPITAL_LOGO_URL } from '@/lib/hospital';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { supabase } from '@/integrations/supabase/client';
import type { Visit } from '@/hooks/useVisits';

/* -------------------- data helpers -------------------- */

async function fetchPatient(id: string) {
  const { data } = await supabase.from('patients').select('*').eq('id', id).maybeSingle();
  return data as any;
}
async function fetchSponsor(id: string | null) {
  if (!id) return null;
  const { data } = await supabase.from('corporate_accounts').select('*').eq('id', id).maybeSingle();
  return data as any;
}
async function fetchVitals(patientId: string, visitId: string) {
  const { data } = await supabase
    .from('vitals').select('*')
    .eq('patient_id', patientId).eq('visit_id', visitId)
    .order('created_at', { ascending: true });
  return (data ?? []) as any[];
}
async function fetchPrescriptions(visitId: string) {
  const { data, error } = await supabase
    .from('prescriptions')
    .select('*')
    .eq('visit_id', visitId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  const prescriptions = data as any[];
  const prescriptionIds = prescriptions.map(row => row.id).filter(Boolean);
  const { data: itemRows } = prescriptionIds.length
    ? await supabase.from('prescription_items').select('*').in('prescription_id', prescriptionIds)
    : { data: [] };
  const itemsByPrescription = new Map<string, any[]>();
  for (const item of itemRows || []) {
    const key = String((item as any).prescription_id || '');
    itemsByPrescription.set(key, [...(itemsByPrescription.get(key) || []), item]);
  }
  return prescriptions.map(prescription => ({
    ...prescription,
    items: itemsByPrescription.get(String(prescription.id)) || [],
  }));
}
async function fetchLabs(visitId: string) {
  const { data } = await supabase
    .from('lab_requests').select('*')
    .eq('visit_id', visitId)
    .order('requested_at', { ascending: true });
  return (data ?? []) as any[];
}
async function fetchInvoices(visitId: string) {
  const { data } = await supabase
    .from('invoices').select('*')
    .eq('visit_id', visitId)
    .order('created_at', { ascending: true });
  return (data ?? []) as any[];
}
async function fetchAdmission(visitId: string) {
  const { data } = await supabase
    .from('admissions').select('*')
    .eq('visit_id', visitId).maybeSingle();
  return data as any;
}
async function fetchJourney(visitId: string) {
  const { data } = await supabase
    .from('patient_journey_history').select('*')
    .eq('visit_id', visitId)
    .order('created_at', { ascending: true });
  return (data ?? []) as any[];
}

/* -------------------- format -------------------- */

function money(v: number | string) {
  return `₦${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function dt(v: string | null | undefined) { return v ? new Date(v).toLocaleString() : '—'; }
function d(v: string | null | undefined) { return v ? new Date(v).toLocaleDateString() : '—'; }
function age(dob: string | null | undefined) {
  if (!dob) return '—';
  const b = new Date(dob); const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
  return `${a} yr`;
}

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; }
  .doc { width: 794px; padding: 40px 48px; background: #fff; }
  .hero { display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:14px; border-bottom:3px double #0f3c64; }
  .brand { display:flex; gap:12px; align-items:center; }
  .mark img { width:100%; height:100%; object-fit:contain; display:block; }
  .mark:has(img) { background:#fff !important; border:1px solid #e5e7eb; padding:4px; }
  .mark { width:48px; height:48px; background:#0f3c64; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; border-radius:8px; }
  .brand h1 { font-size:18px; color:#0f3c64; font-weight:700; }
  .brand .sub { font-size:10px; color:#6b7280; }
  .stamp { text-align:right; border-left:3px solid #b8860b; padding-left:12px; }
  .stamp-label { font-size:9px; letter-spacing:3px; text-transform:uppercase; color:#b8860b; font-weight:700; }
  .stamp-title { display:block; font-size:16px; font-weight:700; color:#0f3c64; margin-top:2px; }
  .stamp-num { display:block; font-family:'Courier New', monospace; font-size:11px; color:#444; margin-top:3px; }
  h2 { font-size:12px; color:#0f3c64; letter-spacing:2px; text-transform:uppercase; margin:22px 0 8px; border-bottom:1px solid #cbd5e1; padding-bottom:4px; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .grid3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; }
  .card { border:1px solid #e2e8f0; border-left:4px solid #0f3c64; padding:10px 14px; border-radius:4px; background:#f8fafc; }
  .card.gold { border-left-color:#b8860b; }
  .card p { font-size:11px; margin:2px 0; }
  .card .lbl { font-size:9px; letter-spacing:1.5px; text-transform:uppercase; color:#64748b; font-weight:700; }
  .card .val { font-size:13px; font-weight:700; color:#0f172a; }
  table { width:100%; border-collapse:collapse; font-size:10.5px; }
  th { background:#0f3c64; color:#fff; padding:6px 8px; font-size:9px; letter-spacing:1px; text-transform:uppercase; text-align:left; }
  th.num, td.num { text-align:right; font-variant-numeric:tabular-nums; }
  td { padding:5px 8px; border-bottom:1px solid #eef2f7; vertical-align:top; }
  tr.total td { background:#0f3c64; color:#fff; font-weight:700; text-transform:uppercase; letter-spacing:1px; }
  .mono { font-family:'Courier New', monospace; }
  .chip { display:inline-block; padding:2px 8px; border-radius:999px; font-size:9px; letter-spacing:1px; text-transform:uppercase; font-weight:700; }
  .chip.paid { background:#dcfce7; color:#166534; }
  .chip.partial { background:#fef3c7; color:#92400e; }
  .chip.pending { background:#fee2e2; color:#991b1b; }
  .empty { text-align:center; padding:12px; color:#94a3b8; font-style:italic; font-size:10px; }
  .sigs { display:grid; grid-template-columns:1fr 1fr; gap:40px; margin-top:36px; }
  .sig-line { border-top:1px solid #0f172a; margin-bottom:5px; }
  .sig span { font-size:9px; color:#64748b; text-transform:uppercase; letter-spacing:1px; }
  .foot { display:flex; justify-content:space-between; margin-top:20px; padding-top:8px; border-top:1px solid #e2e8f0; font-size:8px; color:#94a3b8; letter-spacing:1px; }
  .notes { font-size:11px; line-height:1.5; padding:8px 12px; background:#fffbeb; border-left:3px solid #b8860b; border-radius:3px; }
`;

function invStatusChip(inv: any) {
  const paid = Number(inv.paid_amount || 0);
  const total = Number(inv.total_amount || 0);
  if (paid >= total && total > 0) return `<span class="chip paid">Paid</span>`;
  if (paid > 0) return `<span class="chip partial">Partial</span>`;
  return `<span class="chip pending">Unpaid</span>`;
}

function summaryHtml(args: {
  visit: Visit; patient: any; sponsor: any;
  vitals: any[]; prescriptions: any[]; labs: any[];
  invoices: any[]; admission: any | null; journey: any[];
  summaryNumber: string;
}) {
  const { visit, patient, sponsor, vitals, prescriptions, labs, invoices, admission, journey, summaryNumber } = args;

  const totalCharged = invoices.reduce((s, i) => s + Number(i.total_amount || 0), 0);
  const totalPaid = invoices.reduce((s, i) => s + Number(i.paid_amount || 0), 0);
  const outstanding = totalCharged - totalPaid;

  const firstVitals = vitals[0];
  const lastVitals = vitals[vitals.length - 1];

  const vitalsRows = vitals.length === 0
    ? `<tr><td colspan="7" class="empty">No vitals recorded.</td></tr>`
    : vitals.map(v => `
        <tr>
          <td class="mono">${dt(v.created_at)}</td>
          <td>${v.temperature ?? '—'}</td>
          <td>${v.blood_pressure ?? '—'}</td>
          <td>${v.pulse ?? '—'}</td>
          <td>${v.respiratory_rate ?? '—'}</td>
          <td>${v.weight ?? '—'}</td>
          <td>${v.height ?? '—'}</td>
        </tr>`).join('');

  const medRows = prescriptions.length === 0
    ? `<tr><td colspan="5" class="empty">No medications prescribed.</td></tr>`
    : prescriptions.flatMap((p: any) => {
        const items = (p.items ?? []) as any[];
        if (items.length === 0) return [`<tr><td colspan="5" class="empty">Prescription ${dt(p.created_at)} — no items.</td></tr>`];
        return items.map(it => `
          <tr>
            <td><b>${it.medication}</b>${p.diagnosis ? `<br/><span style="color:#64748b;font-size:9px;">Dx: ${p.diagnosis}</span>` : ''}</td>
            <td>${it.dosage}</td>
            <td>${it.frequency}</td>
            <td>${it.duration}</td>
            <td class="num">${it.quantity}</td>
          </tr>`);
      }).join('');

  const labRows = labs.length === 0
    ? `<tr><td colspan="4" class="empty">No lab tests requested.</td></tr>`
    : labs.map((l: any) => {
        const tests = Array.isArray(l.tests) ? l.tests.join(', ') : (l.tests ?? '—');
        const results = l.results
          ? Object.entries(l.results).slice(0, 6).map(([k, v]) => `${k}: ${v}`).join(' · ')
          : '';
        return `<tr>
          <td class="mono">${l.request_number ?? '—'}</td>
          <td>${tests}</td>
          <td><span class="chip ${l.status === 'completed' ? 'paid' : 'pending'}">${l.status}</span></td>
          <td>${results || (l.diagnosis ?? '—')}</td>
        </tr>`;
      }).join('');

  const invRows = invoices.length === 0
    ? `<tr><td colspan="4" class="empty">No invoices.</td></tr>`
    : invoices.map(inv => `
        <tr>
          <td class="mono">${inv.invoice_number}</td>
          <td>${d(inv.created_at)}</td>
          <td>${invStatusChip(inv)}</td>
          <td class="num">${money(inv.total_amount)}</td>
        </tr>`).join('');

  const journeyRows = journey.length === 0
    ? `<tr><td colspan="3" class="empty">No workflow events.</td></tr>`
    : journey.slice(-14).map((j: any) => `
        <tr>
          <td class="mono">${dt(j.created_at)}</td>
          <td><b>${j.to_state}</b>${j.from_state ? ` <span style="color:#94a3b8;">← ${j.from_state}</span>` : ''}</td>
          <td>${j.department ?? j.to_owner_role ?? ''}${j.reason ? ` · <em>${j.reason}</em>` : ''}</td>
        </tr>`).join('');

  const admissionBlock = admission ? `
    <h2>Admission</h2>
    <div class="grid2">
      <div class="card">
        <span class="lbl">Admitted</span>
        <p class="val">${dt(admission.admitted_at)}</p>
        ${admission.reason ? `<p>Reason: ${admission.reason}</p>` : ''}
        ${admission.admission_note ? `<p>${admission.admission_note}</p>` : ''}
      </div>
      <div class="card gold">
        <span class="lbl">Discharged</span>
        <p class="val">${dt(admission.discharged_at)}</p>
        ${admission.discharge_notes ? `<p class="notes">${admission.discharge_notes}</p>` : ''}
      </div>
    </div>
  ` : '';

  return `
  <div class="doc">
    <header class="hero">
      <div class="brand">
        <div class="mark">${HOSPITAL_LOGO_URL ? `<img src="${HOSPITAL_LOGO_URL}" alt="logo" onerror="this.remove();this.parentNode.textContent='KMC'" />` : 'KMC'}</div>
        <div>
          <h1>Khadija Medical Center</h1>
          <p class="sub">No: 53, Katsina Road, P.O. Box 121, Funtua, Katsina State, Nigeria</p>
          <p class="sub small">RC: 43552 · khamecfuntua@gmail.com · 08033928843</p>
          <p class="sub small">Discharge Summary · Confidential clinical record</p>
        </div>
      </div>
      <div class="stamp">
        <span class="stamp-label">Discharge Summary</span>
        <span class="stamp-title">${visit.visit_number}</span>
        <span class="stamp-num">${summaryNumber}</span>
      </div>
    </header>

    <h2>Patient</h2>
    <div class="grid2">
      <div class="card">
        <span class="lbl">Patient</span>
        <p class="val">${patient?.first_name ?? ''} ${patient?.last_name ?? ''}</p>
        <p>Card <span class="mono">${patient?.card_number ?? '—'}</span> · ${patient?.gender ?? ''} · ${age(patient?.date_of_birth)}</p>
        <p>Tel ${patient?.phone ?? '—'}</p>
        ${patient?.address ? `<p>${patient.address}</p>` : ''}
        ${patient?.blood_group ? `<p>Blood group: <b>${patient.blood_group}</b></p>` : ''}
        ${patient?.allergies?.length ? `<p style="color:#991b1b;">Allergies: ${(patient.allergies as any[]).join(', ')}</p>` : ''}
      </div>
      <div class="card gold">
        <span class="lbl">Visit</span>
        <p class="val mono">${visit.visit_number}</p>
        <p>Opened: ${dt(visit.opened_at)}</p>
        <p>Discharged: ${dt(visit.closed_at)}</p>
        ${visit.presenting_complaint ? `<p>Complaint: <b>${visit.presenting_complaint}</b></p>` : ''}
        <p>Sponsor: <b>${(visit.sponsor_type ?? 'self-pay').toString().replace('_',' ').toUpperCase()}</b>${sponsor?.company_name ? ` · ${sponsor.company_name}` : ''}${visit.insurance_plan ? ` · ${visit.insurance_plan}` : ''}</p>
      </div>
    </div>

    ${firstVitals || lastVitals ? `
      <h2>Vitals summary</h2>
      <div class="grid3">
        <div class="card"><span class="lbl">Admission vitals</span>
          <p>Temp <b>${firstVitals?.temperature ?? '—'}</b> · BP <b>${firstVitals?.blood_pressure ?? '—'}</b></p>
          <p>Pulse <b>${firstVitals?.pulse ?? '—'}</b> · RR <b>${firstVitals?.respiratory_rate ?? '—'}</b></p>
          <p>Wt <b>${firstVitals?.weight ?? '—'}</b> · Ht <b>${firstVitals?.height ?? '—'}</b></p>
        </div>
        <div class="card gold"><span class="lbl">Discharge vitals</span>
          <p>Temp <b>${lastVitals?.temperature ?? '—'}</b> · BP <b>${lastVitals?.blood_pressure ?? '—'}</b></p>
          <p>Pulse <b>${lastVitals?.pulse ?? '—'}</b> · RR <b>${lastVitals?.respiratory_rate ?? '—'}</b></p>
          <p>Wt <b>${lastVitals?.weight ?? '—'}</b> · Ht <b>${lastVitals?.height ?? '—'}</b></p>
        </div>
        <div class="card"><span class="lbl">Readings</span>
          <p class="val">${vitals.length}</p>
          <p>recorded during this visit</p>
        </div>
      </div>

      <table style="margin-top:8px;">
        <thead><tr><th>When</th><th>Temp</th><th>BP</th><th>Pulse</th><th>RR</th><th>Wt</th><th>Ht</th></tr></thead>
        <tbody>${vitalsRows}</tbody>
      </table>
    ` : ''}

    ${admissionBlock}

    <h2>Diagnosis &amp; medications</h2>
    <table>
      <thead><tr><th>Medication</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th class="num">Qty</th></tr></thead>
      <tbody>${medRows}</tbody>
    </table>

    <h2>Lab tests</h2>
    <table>
      <thead><tr><th>Request #</th><th>Tests</th><th>Status</th><th>Notes / Results</th></tr></thead>
      <tbody>${labRows}</tbody>
    </table>

    <h2>Financial summary</h2>
    <div class="grid3">
      <div class="card"><span class="lbl">Total charged</span><p class="val">${money(totalCharged)}</p></div>
      <div class="card"><span class="lbl">Total paid</span><p class="val" style="color:#166534;">${money(totalPaid)}</p></div>
      <div class="card gold"><span class="lbl">Outstanding</span><p class="val" style="color:${outstanding > 0 ? '#991b1b' : '#166534'};">${money(outstanding)}</p></div>
    </div>
    <table style="margin-top:8px;">
      <thead><tr><th>Invoice #</th><th>Date</th><th>Status</th><th class="num">Amount</th></tr></thead>
      <tbody>${invRows}
        <tr class="total"><td colspan="3">Grand Total</td><td class="num">${money(totalCharged)}</td></tr>
      </tbody>
    </table>

    <h2>Workflow timeline</h2>
    <table>
      <thead><tr><th style="width:150px;">When</th><th style="width:220px;">State</th><th>Owner / Reason</th></tr></thead>
      <tbody>${journeyRows}</tbody>
    </table>

    <div class="sigs">
      <div><div class="sig-line"></div><span>Attending Physician</span></div>
      <div><div class="sig-line"></div><span>Patient / Guardian</span></div>
    </div>

    <div class="foot">
      <span>Khadija Medical Center · Medical Records</span>
      <span>${summaryNumber} · Generated ${new Date().toLocaleString()}</span>
    </div>
  </div>`;
}

async function renderCanvas(html: string): Promise<HTMLCanvasElement> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;';
  host.innerHTML = `<style>${CSS}</style>${html}`;
  document.body.appendChild(host);
  try {
    const target = host.querySelector('.doc') as HTMLElement;
    return await html2canvas(target, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  } finally {
    document.body.removeChild(host);
  }
}

function addCanvasPaged(pdf: jsPDF, canvas: HTMLCanvasElement, first: boolean) {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 6;
  const availW = pageW - margin * 2;
  const pxPerMm = canvas.width / availW;
  const pageChunkPx = (pageH - margin * 2) * pxPerMm;

  let rendered = 0;
  let pageIndex = 0;
  while (rendered < canvas.height) {
    const chunkH = Math.min(pageChunkPx, canvas.height - rendered);
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = chunkH;
    const ctx = slice.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, rendered, canvas.width, chunkH, 0, 0, canvas.width, chunkH);
    if (!(first && pageIndex === 0)) pdf.addPage();
    pdf.addImage(slice.toDataURL('image/jpeg', 0.9), 'JPEG', margin, margin, availW, chunkH / pxPerMm, undefined, 'FAST');
    rendered += chunkH;
    pageIndex++;
  }
}

async function buildSummary(visit: Visit) {
  const summaryNumber = `DIS-${visit.visit_number}`;
  const [patient, vitals, prescriptions, labs, invoices, admission, journey] = await Promise.all([
    fetchPatient(visit.patient_id),
    fetchVitals(visit.patient_id, visit.id),
    fetchPrescriptions(visit.id),
    fetchLabs(visit.id),
    fetchInvoices(visit.id),
    fetchAdmission(visit.id),
    fetchJourney(visit.id),
  ]);
  const sponsor = await fetchSponsor(visit.corporate_id ?? null);
  return { visit, patient, sponsor, vitals, prescriptions, labs, invoices, admission, journey, summaryNumber };
}

export async function downloadDischargeSummaryPdf(visit: Visit) {
  const data = await buildSummary(visit);
  const canvas = await renderCanvas(summaryHtml(data));
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  addCanvasPaged(pdf, canvas, true);
  pdf.save(`${data.summaryNumber}.pdf`);
}