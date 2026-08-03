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

async function fetchInvoices(visitId: string) {
  const { data } = await supabase
    .from('invoices')
    .select('*, items:invoice_items(*)')
    .eq('visit_id', visitId)
    .order('created_at', { ascending: true });
  return (data ?? []) as any[];
}

async function fetchSnaps(visitId: string) {
  const { data } = await supabase
    .from('snap_orders')
    .select('*')
    .eq('visit_id', visitId)
    .order('created_at', { ascending: true });
  return (data ?? []) as any[];
}

async function fetchAttachments(visitId: string) {
  const { data } = await supabase
    .from('visit_attachments')
    .select('*')
    .eq('visit_id', visitId)
    .order('captured_at', { ascending: true });
  return (data ?? []) as any[];
}

async function fetchAuditTrail(visitId: string) {
  const { data, error } = await supabase.rpc('get_visit_audit_trail', { _visit_id: visitId });
  if (error) return [];
  return (data ?? []) as any[];
}

async function toDataUrl(bucket: string, path: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) return null;
    return await new Promise((res) => {
      const r = new FileReader();
      r.onloadend = () => res((r.result as string) || null);
      r.onerror = () => res(null);
      r.readAsDataURL(data);
    });
  } catch {
    return null;
  }
}

/* -------------------- rendering -------------------- */

function money(v: number | string) {
  return `₦${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function dt(v: string | null | undefined) {
  return v ? new Date(v).toLocaleString() : '—';
}
function d(v: string | null | undefined) {
  return v ? new Date(v).toLocaleDateString() : '—';
}

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; }
  .doc { width: 794px; padding: 40px 48px; background: #fff; }
  .hero { display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:16px; border-bottom:3px double #0f3c64; }
  .brand { display:flex; gap:12px; align-items:center; }
  .mark img { width:100%; height:100%; object-fit:contain; display:block; }
  .mark:has(img) { background:#fff !important; border:1px solid #e5e7eb; padding:4px; }
  .mark { width:48px; height:48px; background:#0f3c64; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; border-radius:8px; }
  .brand h1 { font-size:18px; color:#0f3c64; font-weight:700; }
  .brand .sub { font-size:10px; color:#6b7280; }
  .stamp { text-align:right; border-left:3px solid #b8860b; padding-left:12px; }
  .stamp-label { font-size:9px; letter-spacing:3px; text-transform:uppercase; color:#b8860b; font-weight:700; }
  .stamp-title { display:block; font-size:18px; font-weight:700; color:#0f3c64; margin-top:2px; }
  .stamp-num { display:block; font-family:'Courier New', monospace; font-size:11px; color:#444; margin-top:3px; }
  h2 { font-size:12px; color:#0f3c64; letter-spacing:2px; text-transform:uppercase; margin:22px 0 8px; border-bottom:1px solid #cbd5e1; padding-bottom:4px; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .card { border:1px solid #e2e8f0; border-left:4px solid #0f3c64; padding:10px 14px; border-radius:4px; background:#f8fafc; }
  .card.gold { border-left-color:#b8860b; }
  .card p { font-size:11px; margin:2px 0; }
  .card .lbl { font-size:9px; letter-spacing:1.5px; text-transform:uppercase; color:#64748b; font-weight:700; }
  .card .val { font-size:13px; font-weight:700; color:#0f172a; }
  table { width:100%; border-collapse:collapse; font-size:10.5px; }
  th { background:#0f3c64; color:#fff; padding:7px 8px; font-size:9px; letter-spacing:1px; text-transform:uppercase; text-align:left; }
  th.num, td.num { text-align:right; font-variant-numeric:tabular-nums; }
  td { padding:6px 8px; border-bottom:1px solid #eef2f7; vertical-align:top; }
  tr.sub td { background:#f8fafc; font-style:italic; color:#475569; }
  tr.total td { background:#0f3c64; color:#fff; font-weight:700; text-transform:uppercase; letter-spacing:1px; padding:9px 8px; }
  .mono { font-family:'Courier New', monospace; }
  .chip { display:inline-block; padding:2px 8px; border-radius:999px; font-size:9px; letter-spacing:1px; text-transform:uppercase; font-weight:700; }
  .chip.paid { background:#dcfce7; color:#166534; }
  .chip.partial { background:#fef3c7; color:#92400e; }
  .chip.pending { background:#fee2e2; color:#991b1b; }
  .snap-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .snap { border:1px solid #e2e8f0; border-radius:6px; overflow:hidden; }
  .snap img { width:100%; height:180px; object-fit:cover; display:block; background:#f1f5f9; }
  .snap .meta { padding:8px 10px; font-size:10px; color:#334155; }
  .snap .meta b { color:#0f3c64; }
  .audit { font-size:10px; }
  .audit td { padding:5px 8px; }
  .empty { text-align:center; padding:16px; color:#94a3b8; font-style:italic; font-size:10px; }
  .sigs { display:grid; grid-template-columns:1fr 1fr; gap:40px; margin-top:36px; }
  .sig-line { border-top:1px solid #0f172a; margin-bottom:5px; }
  .sig span { font-size:9px; color:#64748b; text-transform:uppercase; letter-spacing:1px; }
  .foot { display:flex; justify-content:space-between; margin-top:20px; padding-top:8px; border-top:1px solid #e2e8f0; font-size:8px; color:#94a3b8; letter-spacing:1px; }
`;

function invoiceStatusChip(inv: any) {
  const paid = Number(inv.paid_amount || 0);
  const total = Number(inv.total_amount || 0);
  if (paid >= total && total > 0) return `<span class="chip paid">Paid</span>`;
  if (paid > 0) return `<span class="chip partial">Partial</span>`;
  return `<span class="chip pending">Unpaid</span>`;
}

function packetHtml(args: {
  visit: Visit;
  patient: any;
  sponsor: any;
  invoices: any[];
  snaps: Array<any & { dataUrl: string | null }>;
  attachments: Array<any & { dataUrl: string | null }>;
  audit: any[];
  packetNumber: string;
}) {
  const { visit, patient, sponsor, invoices, snaps, attachments, audit, packetNumber } = args;

  const totalCharged = invoices.reduce((s, i) => s + Number(i.total_amount || 0), 0);
  const totalPaid = invoices.reduce((s, i) => s + Number(i.paid_amount || 0), 0);
  const sponsorPortion = totalCharged - totalPaid;

  const invoiceBlocks = invoices.length === 0
    ? `<tr><td colspan="4" class="empty">No invoices linked to this visit.</td></tr>`
    : invoices.map((inv) => {
        const items = (inv.items ?? []) as any[];
        return `
          <tr>
            <td colspan="4" style="background:#eef2ff;padding:6px 8px;">
              <b class="mono">${inv.invoice_number}</b> · ${d(inv.created_at)} · ${invoiceStatusChip(inv)}
              <span style="float:right;">Total ${money(inv.total_amount)} · Paid ${money(inv.paid_amount)}</span>
            </td>
          </tr>
          ${items.length === 0
            ? `<tr><td colspan="4" class="empty">No line items.</td></tr>`
            : items.map((it) => `
                <tr>
                  <td>${it.description}</td>
                  <td class="num">${it.quantity}</td>
                  <td class="num">${money(it.unit_price)}</td>
                  <td class="num">${money(it.total)}</td>
                </tr>`).join('')}`;
      }).join('');

  const allPhotos = [
    ...snaps.map((s) => ({
      dataUrl: s.dataUrl,
      title: `${s.order_type.toUpperCase()} → ${s.target_station}`,
      sub: `${dt(s.created_at)} · status: ${s.status}`,
      note: s.note ?? '',
    })),
    ...attachments.map((a) => ({
      dataUrl: a.dataUrl,
      title: `${a.station.toUpperCase()} · ${a.label ?? 'attachment'}`,
      sub: dt(a.captured_at),
      note: '',
    })),
  ];

  const photosHtml = allPhotos.length === 0
    ? `<p class="empty">No photos or snaps captured for this visit.</p>`
    : `<div class="snap-grid">${allPhotos.map((p) => `
        <div class="snap">
          ${p.dataUrl ? `<img src="${p.dataUrl}" />` : `<div style="height:180px;display:flex;align-items:center;justify-content:center;background:#f1f5f9;color:#94a3b8;font-size:10px;">Image unavailable</div>`}
          <div class="meta"><b>${p.title}</b><br/>${p.sub}${p.note ? `<br/><em>${p.note}</em>` : ''}</div>
        </div>`).join('')}</div>`;

  const auditRows = audit.length === 0
    ? `<tr><td colspan="3" class="empty">No audit events recorded.</td></tr>`
    : audit.map((a) => {
        const det = a.details ? Object.entries(a.details).slice(0, 4).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : '';
        return `<tr>
          <td class="mono">${dt(a.created_at)}</td>
          <td><b>${a.action}</b><br/><span style="color:#64748b;">${a.resource_type}</span></td>
          <td>${det}</td>
        </tr>`;
      }).join('');

  return `
  <div class="doc">
    <header class="hero">
      <div class="brand">
        <div class="mark">${HOSPITAL_LOGO_URL ? `<img src="${HOSPITAL_LOGO_URL}" alt="logo" onerror="this.remove();this.parentNode.textContent='KMC'" />` : 'KMC'}</div>
        <div>
          <h1>Khadija Medical Center</h1>
          <p class="sub">No: 53, Katsina Road, P.O. Box 121, Funtua, Katsina State, Nigeria</p>
          <p class="sub small">RC: 43552 · khamecfuntua@gmail.com · 08033928843</p>
          <p class="sub small">Claims &amp; sponsor billing · Confidential</p>
        </div>
      </div>
      <div class="stamp">
        <span class="stamp-label">Claims Packet</span>
        <span class="stamp-title">${(visit.sponsor_type ?? '').toUpperCase()}</span>
        <span class="stamp-num">${packetNumber}</span>
      </div>
    </header>

    <h2>Patient &amp; Visit</h2>
    <div class="grid2">
      <div class="card">
        <span class="lbl">Patient</span>
        <p class="val">${patient?.first_name ?? ''} ${patient?.last_name ?? ''}</p>
        <p>Card <span class="mono">${patient?.card_number ?? '—'}</span> · ${patient?.gender ?? ''} · DOB ${d(patient?.date_of_birth)}</p>
        <p>Tel ${patient?.phone ?? '—'}</p>
        ${patient?.blood_group ? `<p>Blood group: <b>${patient.blood_group}</b></p>` : ''}
        ${patient?.allergies ? `<p style="color:#991b1b;">Allergies: ${patient.allergies}</p>` : ''}
      </div>
      <div class="card gold">
        <span class="lbl">Visit</span>
        <p class="val mono">${visit.visit_number}</p>
        <p>Opened: ${dt(visit.opened_at)}</p>
        <p>Discharged: ${dt(visit.closed_at)}</p>
        ${visit.presenting_complaint ? `<p>Complaint: ${visit.presenting_complaint}</p>` : ''}
      </div>
    </div>

    <h2>Sponsor</h2>
    <div class="grid2">
      <div class="card">
        <span class="lbl">${(visit.sponsor_type ?? 'sponsor').toString().replace('_',' ')}</span>
        <p class="val">${sponsor?.company_name ?? (visit.sponsor_type === 'staff' ? 'Hospital staff self-cover' : (visit.insurance_plan ?? '—'))}</p>
        ${sponsor?.contact_person ? `<p>Attn: ${sponsor.contact_person}</p>` : ''}
        ${sponsor?.phone ? `<p>Tel ${sponsor.phone}</p>` : ''}
        ${sponsor?.email ? `<p>${sponsor.email}</p>` : ''}
        ${visit.insurance_plan ? `<p>Plan: <b>${visit.insurance_plan}</b></p>` : ''}
      </div>
      <div class="card gold">
        <span class="lbl">Financial summary</span>
        <p>Total charged: <b>${money(totalCharged)}</b></p>
        <p>Patient paid: <b>${money(totalPaid)}</b></p>
        <p>Sponsor liability: <b style="color:#0f3c64;">${money(sponsorPortion)}</b></p>
        <p>Invoices: ${invoices.length}</p>
      </div>
    </div>

    <h2>Invoices &amp; line items</h2>
    <table>
      <thead>
        <tr><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Total</th></tr>
      </thead>
      <tbody>
        ${invoiceBlocks}
        <tr class="total"><td colspan="3">Grand Total</td><td class="num">${money(totalCharged)}</td></tr>
      </tbody>
    </table>

    <h2>Attached photos &amp; snaps</h2>
    ${photosHtml}

    <h2>Payment &amp; audit trail</h2>
    <table class="audit">
      <thead><tr><th style="width:150px;">When</th><th style="width:180px;">Event</th><th>Details</th></tr></thead>
      <tbody>${auditRows}</tbody>
    </table>

    <div class="sigs">
      <div><div class="sig-line"></div><span>Claims Manager</span></div>
      <div><div class="sig-line"></div><span>Sponsor Representative</span></div>
    </div>

    <div class="foot">
      <span>Khadija Medical Center · Claims Department</span>
      <span>${packetNumber} · Generated ${new Date().toLocaleString()}</span>
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

async function buildPacket(visit: Visit) {
  const packetNumber = `CLM-${visit.visit_number}`;
  const [patient, invoices, rawSnaps, rawAttachments, audit] = await Promise.all([
    fetchPatient(visit.patient_id),
    fetchInvoices(visit.id),
    fetchSnaps(visit.id),
    fetchAttachments(visit.id),
    fetchAuditTrail(visit.id),
  ]);
  const sponsor = await fetchSponsor(visit.corporate_id);
  const snaps = await Promise.all(rawSnaps.map(async (s) => ({ ...s, dataUrl: await toDataUrl('visit-cards', s.photo_path) })));
  const attachments = await Promise.all(rawAttachments.map(async (a) => ({ ...a, dataUrl: await toDataUrl('visit-cards', a.storage_path) })));
  return { visit, patient, sponsor, invoices, snaps, attachments, audit, packetNumber };
}

export async function downloadClaimsPacketPdf(visit: Visit) {
  const data = await buildPacket(visit);
  const canvas = await renderCanvas(packetHtml(data));
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  addCanvasPaged(pdf, canvas, true);
  pdf.save(`${data.packetNumber}.pdf`);
}

export async function downloadBulkClaimsPacketsPdf(
  visits: Visit[],
  label: string,
  onProgress?: (done: number, total: number) => void,
) {
  if (visits.length === 0) return;
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  for (let i = 0; i < visits.length; i++) {
    const data = await buildPacket(visits[i]);
    const canvas = await renderCanvas(packetHtml(data));
    addCanvasPaged(pdf, canvas, i === 0);
    onProgress?.(i + 1, visits.length);
  }
  pdf.save(`${label}.pdf`);
}
