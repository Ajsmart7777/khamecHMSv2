import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

export type ArchiveLedgerPdfInput = {
  patient: any;
  visits: any[];
  vitals: any[];
  visitAttachments: any[];
  snapOrders: any[];
  invoices: any[];
  admissions: any[];
  imageUrls?: Record<string, string>;
  archiveReference: string;
  generatedAt?: Date;
};

type ArchiveRowKind = 'vitals' | 'attachment' | 'snap' | 'invoice' | 'payment' | 'admission' | 'discharge';
type StoryStage = 'checkin' | 'admission' | 'orders' | 'ward' | 'discharge';

type ArchiveRow = {
  id: string;
  visitId: string;
  at: string;
  kind: ArchiveRowKind;
  station: string;
  title: string;
  data: any;
  subkind: string;
};

const STORY_STAGES: { key: StoryStage; number: string; title: string; description: string }[] = [
  { key: 'checkin', number: '01', title: 'Check-in & consultation', description: 'Registration, initial assessment, and consultation charges' },
  { key: 'admission', number: '02', title: 'Clinical decision & admission', description: 'Treatment decision and movement to the ward' },
  { key: 'orders', number: '03', title: 'Orders, pharmacy & laboratory', description: 'Clinical orders, fulfilment, and linked billing' },
  { key: 'ward', number: '04', title: 'Ward stay & clinical notes', description: 'Observations, notes, and supporting evidence' },
  { key: 'discharge', number: '05', title: 'Discharge & final settlement', description: 'Final ward charges, payment, and discharge outcome' },
];

const stationTone: Record<string, string> = {
  reception: 'background:#dbeafe;color:#1d4ed8;border-color:#bfdbfe',
  nurse: 'background:#ccfbf1;color:#0f766e;border-color:#99f6e4',
  doctor: 'background:#e0e7ff;color:#4338ca;border-color:#c7d2fe',
  lab: 'background:#f3e8ff;color:#7e22ce;border-color:#e9d5ff',
  pharmacy: 'background:#d1fae5;color:#047857;border-color:#a7f3d0',
  billing: 'background:#fef3c7;color:#b45309;border-color:#fde68a',
  cashier: 'background:#ffedd5;color:#c2410c;border-color:#fed7aa',
  admin: 'background:#e2e8f0;color:#334155;border-color:#cbd5e1',
};

const subTone: Record<string, string> = {
  rx: 'background:#eef2ff;color:#4338ca;border-color:#c7d2fe',
  lab_request: 'background:#f3e8ff;color:#7e22ce;border-color:#e9d5ff',
  lab_result: 'background:#f5f3ff;color:#6d28d9;border-color:#ddd6fe',
  dispense: 'background:#ecfdf5;color:#047857;border-color:#a7f3d0',
  treatment: 'background:#f0f9ff;color:#0369a1;border-color:#bae6fd',
  vitals_first: 'background:#f0fdfa;color:#0f766e;border-color:#99f6e4',
  vitals_update: 'background:#f0fdfa;color:#0f766e;border-color:#99f6e4',
  card_photo: 'background:#f8fafc;color:#475569;border-color:#e2e8f0',
  other_snap: 'background:#f8fafc;color:#475569;border-color:#e2e8f0',
  invoice_new: 'background:#fffbeb;color:#b45309;border-color:#fde68a',
  invoice_partial: 'background:#fffbeb;color:#b45309;border-color:#fde68a',
  invoice_paid: 'background:#ecfdf5;color:#047857;border-color:#a7f3d0',
  receipt_full: 'background:#ecfdf5;color:#047857;border-color:#a7f3d0',
  receipt_partial: 'background:#fffbeb;color:#b45309;border-color:#fde68a',
  admission: 'background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe',
  discharge: 'background:#ecfdf5;color:#047857;border-color:#a7f3d0',
};

const subLabel: Record<string, string> = {
  rx: 'Prescription (Rx)',
  lab_request: 'Lab Request',
  lab_result: 'Lab Result',
  dispense: 'Dispensed',
  treatment: 'Treatment Order',
  vitals_first: 'Vitals & Intake',
  vitals_update: 'Vitals Update',
  card_photo: 'Card Photo',
  other_snap: 'Snap',
  invoice_new: 'Invoice Issued',
  invoice_partial: 'Invoice · Partly Paid',
  invoice_paid: 'Invoice · Paid',
  receipt_full: 'Receipt · Paid in Full',
  receipt_partial: 'Receipt · Part Payment',
  admission: 'Admission',
  discharge: 'Discharge',
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function money(value: unknown): string {
  const amount = Number(value ?? 0);
  return `₦${Number.isFinite(amount) ? amount.toLocaleString() : '0'}`;
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateDay(value: unknown): string {
  const date = asDate(value);
  return date ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(date).toUpperCase() : '—';
}

function time(value: unknown): string {
  const date = asDate(value);
  return date ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date) : '—';
}

function dateTime(value: unknown): string {
  const date = asDate(value);
  return date
    ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
    : '—';
}

function patientAge(dob: unknown): string | null {
  const birth = asDate(dob);
  if (!birth) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age -= 1;
  return `${age}Y`;
}

function classifySnap(snap: any): string {
  const orderType = String(snap.order_type ?? '').toLowerCase();
  const target = String(snap.target_station ?? '').toLowerCase();
  const source = String(snap.source_role ?? '').toLowerCase();
  if (orderType === 'lab_result' || (source === 'lab_tech' && target !== 'lab')) return 'lab_result';
  if (orderType === 'prescription' || target === 'pharmacy') return snap.status === 'fulfilled' || snap.status === 'dispensed' ? 'dispense' : 'rx';
  if (orderType === 'lab' || target === 'lab') return 'lab_request';
  if (orderType === 'treatment') return 'treatment';
  return 'other_snap';
}

function invoiceStoryStage(row: ArchiveRow): StoryStage {
  const text = [row.title, ...((row.data?.items ?? []).map((item: any) => item.description ?? item.item_name ?? ''))]
    .join(' ')
    .toLowerCase();
  if (/(registration|consultation)/.test(text)) return 'checkin';
  if (/(bed charge|bed day|ward|admission fee|room charge)/.test(text)) return 'discharge';
  return 'orders';
}

function storyStageForRow(row: ArchiveRow, invoiceStages: Map<string, StoryStage>): StoryStage {
  if (row.kind === 'invoice') return invoiceStoryStage(row);
  if (row.kind === 'payment') return invoiceStages.get(String(row.data?.ref ?? '')) ?? 'orders';
  if (row.kind === 'discharge' || row.subkind === 'discharge') return 'discharge';
  if (row.kind === 'admission' || row.subkind === 'admission' || row.subkind === 'treatment') return 'admission';
  if (['rx', 'lab_request', 'lab_result', 'dispense'].includes(row.subkind)) return 'orders';
  if (row.subkind === 'vitals_first') return 'checkin';
  return 'ward';
}

function narrativeSections(rows: ArchiveRow[]) {
  const invoiceStages = new Map<string, StoryStage>();
  rows.forEach((row) => {
    if (row.kind === 'invoice') invoiceStages.set(String(row.data?.invoice_number ?? ''), invoiceStoryStage(row));
  });
  return STORY_STAGES.map((stage) => ({
    stage,
    rows: rows.filter((row) => storyStageForRow(row, invoiceStages) === stage.key)
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
  })).filter((section) => section.rows.length > 0);
}

function buildRows(input: ArchiveLedgerPdfInput): Map<string, ArchiveRow[]> {
  const rowsByVisit = new Map<string, ArchiveRow[]>();
  const visitIds = new Set(input.visits.map((visit) => visit.id));
  const push = (visitId: string | null | undefined, row: ArchiveRow) => {
    const key = visitId && visitIds.has(visitId) ? visitId : '__unlinked__';
    const current = rowsByVisit.get(key) ?? [];
    current.push(row);
    rowsByVisit.set(key, current);
  };

  const vitals = [...(input.vitals ?? [])].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  vitals.forEach((vital, index) => push(vital.visit_id, {
    id: `vital-${vital.id}`,
    visitId: vital.visit_id,
    at: vital.created_at,
    kind: 'vitals',
    station: 'nurse',
    title: 'Vitals & Intake',
    data: vital,
    subkind: index === 0 ? 'vitals_first' : 'vitals_update',
  }));

  (input.visitAttachments ?? []).forEach((attachment) => push(attachment.visit_id, {
    id: `attachment-${attachment.id}`,
    visitId: attachment.visit_id,
    at: attachment.captured_at ?? attachment.created_at,
    kind: 'attachment',
    station: attachment.station ?? 'admin',
    title: attachment.label || `${attachment.station ?? 'Card'} photo`,
    data: attachment,
    subkind: 'card_photo',
  }));

  (input.snapOrders ?? []).forEach((snap) => {
    const kind = classifySnap(snap);
    push(snap.visit_id, {
      id: `snap-${snap.id}`,
      visitId: snap.visit_id,
      at: snap.created_at,
      kind: 'snap',
      station: snap.source_role ?? 'doctor',
      title: subLabel[kind] ?? snap.order_type ?? 'Snap',
      data: snap,
      subkind: kind,
    });
    if (kind !== 'dispense' && snap.status === 'fulfilled' && snap.order_type === 'prescription') {
      push(snap.visit_id, {
        id: `dispense-${snap.id}`,
        visitId: snap.visit_id,
        at: snap.updated_at ?? snap.created_at,
        kind: 'snap',
        station: 'pharmacy',
        title: 'Dispensed',
        data: snap,
        subkind: 'dispense',
      });
    }
  });

  (input.invoices ?? []).forEach((invoice) => {
    const paid = Number(invoice.paid_amount ?? 0);
    const total = Number(invoice.total_amount ?? 0);
    const status = paid <= 0 ? 'invoice_new' : paid < total ? 'invoice_partial' : 'invoice_paid';
    const items = (invoice.invoice_items ?? []).filter((item: any) => !['unavailable', 'refund_requested', 'refund_pending', 'not_given', 'refunded'].includes(item.dispensing_status));
    push(invoice.visit_id, {
      id: `invoice-${invoice.id}`,
      visitId: invoice.visit_id,
      at: invoice.created_at,
      kind: 'invoice',
      station: 'billing',
      title: `Invoice ${invoice.invoice_number ?? ''}`.trim(),
      data: { ...invoice, items },
      subkind: status,
    });
    if (paid > 0) push(invoice.visit_id, {
      id: `payment-${invoice.id}`,
      visitId: invoice.visit_id,
      at: invoice.updated_at ?? invoice.created_at,
      kind: 'payment',
      station: 'cashier',
      title: paid >= total ? 'Receipt · Paid in Full' : 'Receipt · Part Payment',
      data: { amount: paid, method: invoice.payment_method, ref: invoice.invoice_number, total },
      subkind: paid >= total ? 'receipt_full' : 'receipt_partial',
    });
  });

  (input.admissions ?? []).forEach((admission) => {
    const visitId = admission.visit_id ?? input.visits[0]?.id;
    const room = admission.beds?.rooms;
    const wardName = room?.wards?.name ?? admission.ward_name ?? 'Ward';
    const roomNumber = room?.room_number ? `Room ${room.room_number}` : null;
    const bedLabel = admission.beds?.bed_label ?? admission.beds?.bed_number ?? admission.bed_number;
    const place = [wardName, roomNumber, bedLabel ? `Bed ${bedLabel}` : null].filter(Boolean).join(' · ');
    push(visitId, {
      id: `admission-${admission.id}`,
      visitId: visitId ?? '',
      at: admission.admitted_at ?? admission.created_at,
      kind: 'admission',
      station: 'nurse',
      title: `Admitted · ${place}`,
      data: admission,
      subkind: 'admission',
    });
    if (admission.discharged_at) push(visitId, {
      id: `discharge-${admission.id}`,
      visitId: visitId ?? '',
      at: admission.discharged_at,
      kind: 'discharge',
      station: 'nurse',
      title: 'Discharged',
      data: admission,
      subkind: 'discharge',
    });
  });

  return rowsByVisit;
}

function renderVitals(vital: any): string {
  const items = [
    ['Temp', vital.temperature, '°C'],
    ['BP', vital.blood_pressure, ''],
    ['Pulse', vital.pulse, 'bpm'],
    ['SpO₂', vital.spo2, '%'],
    ['RR', vital.respiratory_rate, '/min'],
    ['Weight', vital.weight, 'kg'],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (!items.length) return '<p class="muted">No vitals values were recorded.</p>';
  return `<div class="vitals">${items.map(([label, value, unit]) => `<div class="vital"><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}${escapeHtml(unit)}</b></div>`).join('')}</div>`;
}

function renderMedia(row: ArchiveRow, imageUrls: Record<string, string>): string {
  const snap = row.data;
  const path = row.kind === 'attachment' ? snap.storage_path : snap.photo_path;
  const imageUrl = path ? imageUrls[path] : undefined;
  const isTyped = row.kind === 'snap' && (snap.intent === 'typed_order' || String(snap.ocr_text ?? '').startsWith('LINKED_'));
  const visual = isTyped
    ? '<div class="photo-box placeholder typed"><span>Typed<br/>Order</span></div>'
    : imageUrl
      ? `<div class="photo-box"><img crossorigin="anonymous" src="${escapeHtml(imageUrl)}" alt="Clinical attachment" /></div>`
      : `<div class="photo-box placeholder"><span>${escapeHtml(row.kind === 'attachment' ? row.title : snap.order_type ?? 'Clinical snap')}</span></div>`;

  if (row.kind === 'attachment') return `<div class="media-row">${visual}<div class="media-copy"><p class="muted">Stored clinical attachment</p></div></div>`;

  const status = String(snap.status ?? 'recorded').replace(/_/g, ' ');
  const statusStyle = ['fulfilled', 'paid', 'completed'].includes(String(snap.status))
    ? 'background:#ecfdf5;color:#047857;border-color:#a7f3d0'
    : String(snap.status) === 'awaiting_payment'
      ? 'background:#fef3c7;color:#b45309;border-color:#fde68a'
      : 'background:#f1f5f9;color:#475569;border-color:#cbd5e1';
  const note = snap.note && !isTyped ? `<p class="note">“${escapeHtml(snap.note)}”</p>` : '';
  const typedNote = isTyped && snap.note ? `<p class="typed-note">${escapeHtml(snap.note)}</p>` : '';
  const matched = Array.isArray(snap.matched_items) && snap.matched_items.length
    ? `<div class="billed"><small>BILLED ITEMS</small><ul>${snap.matched_items.slice(0, 8).map((item: any) => `<li>${escapeHtml(item.name ?? item.item_name ?? 'Item')} × ${escapeHtml(item.qty ?? item.quantity ?? 1)} — ${money(Number(item.unit_price ?? item.price ?? 0) * Number(item.qty ?? item.quantity ?? 1))}</li>`).join('')}</ul></div>`
    : '';
  return `<div class="media-row">${visual}<div class="media-copy"><div class="status-line"><span class="badge status" style="${statusStyle}">${escapeHtml(status)}</span><span class="target">→ ${escapeHtml(snap.target_station ?? 'clinical record')}</span></div>${note}${typedNote}${matched}</div></div>`;
}

function renderInvoice(row: ArchiveRow): string {
  const invoice = row.data;
  const items = invoice.items ?? [];
  const total = Number(invoice.total_amount ?? 0);
  const paid = Number(invoice.paid_amount ?? 0);
  const itemRows = items.length
    ? items.slice(0, 10).map((item: any) => `<tr><td>${escapeHtml(item.description ?? item.item_name ?? 'Billed item')}</td><td>${money(item.total ?? item.amount ?? Number(item.unit_price ?? 0) * Number(item.quantity ?? 1))}</td></tr>`).join('')
    : '<tr><td class="muted">No line items stored</td><td>—</td></tr>';
  const more = items.length > 10 ? `<tr><td colspan="2" class="more">+${items.length - 10} additional item(s)</td></tr>` : '';
  return `<table class="invoice-table"><tbody>${itemRows}${more}</tbody><tfoot><tr class="total-row"><td>TOTAL CHARGED</td><td>${money(total)}</td></tr>${paid > 0 ? `<tr class="paid-row"><td>Paid to date</td><td>${money(paid)}</td></tr>` : ''}</tfoot></table>`;
}

function renderRow(row: ArchiveRow, imageUrls: Record<string, string>): string {
  const station = String(row.station ?? 'admin').toLowerCase();
  const stationStyle = stationTone[station] ?? stationTone.admin;
  const badgeStyle = subTone[row.subkind] ?? subTone.other_snap;
  let body = '';
  if (row.kind === 'vitals') body = renderVitals(row.data);
  else if (row.kind === 'attachment' || row.kind === 'snap') body = renderMedia(row, imageUrls);
  else if (row.kind === 'invoice') body = renderInvoice(row);
  else if (row.kind === 'payment') {
    const isClaim = row.data.method === 'sponsor_claim';
    body = `<div class="payment"><strong class="${isClaim ? 'claim' : ''}">${isClaim ? 'Sponsor claim' : '+'}${isClaim ? ' · ' : ''}${money(row.data.amount)}</strong><span>${isClaim ? 'posted to Claims queue' : `via ${escapeHtml(row.data.method ?? 'cash')}`} · ${escapeHtml(row.data.ref ?? '—')}${row.data.total ? ` · of ${money(row.data.total)}` : ''}</span></div>`;
  } else if (row.kind === 'discharge') body = '<p class="discharged">Discharged from ward</p>';
  else body = `<p class="plain-event">${escapeHtml(row.title)}</p>`;

  return `<article class="ledger-row"><div class="date-cell"><div class="date-day">${dateDay(row.at)}</div><div class="date-time">${time(row.at)}</div><span class="badge station-badge" style="${stationStyle}">${escapeHtml(station)}</span></div><div class="event-cell"><div class="event-head"><div class="event-left"><span class="badge sub-badge" style="${badgeStyle}">${escapeHtml(subLabel[row.subkind] ?? row.subkind.replace(/_/g, ' '))}</span><span class="event-title">${escapeHtml(row.title)}</span></div></div>${body}</div></article>`;
}

function createLedgerHtml(input: ArchiveLedgerPdfInput): string {
  const patient = input.patient ?? {};
  const rowsByVisit = buildRows(input);
  const generatedAt = input.generatedAt ?? new Date();
  const initials = `${patient.first_name?.[0] ?? ''}${patient.last_name?.[0] ?? ''}`.toUpperCase() || 'PT';
  const totalRows = [...rowsByVisit.values()].reduce((count, rows) => count + rows.length, 0);
  const patientName = `${patient.first_name ?? ''} ${patient.last_name ?? ''}`.trim() || 'Unknown patient';
  const visits = [...(input.visits ?? [])].sort((a, b) => new Date(a.opened_at).getTime() - new Date(b.opened_at).getTime());
  const visitBlocks = visits.map((visit, index) => {
    const rows = rowsByVisit.get(visit.id) ?? [];
    const sections = narrativeSections(rows);
    const sectionHtml = sections.length
      ? sections.map(({ stage, rows: stageRows }) => `<div class="story-divider"><span>${stage.number}</span><div><b>${escapeHtml(stage.title)}</b><small>${escapeHtml(stage.description)}</small></div></div>${stageRows.map((row) => renderRow(row, input.imageUrls ?? {})).join('')}`).join('')
      : '<div class="empty-row">No detailed ledger events were stored for this visit.</div>';
    return `<section class="visit-block"><div class="visit-divider"><div class="visit-number"><small>VISIT</small><b>#${index + 1}</b></div><div class="visit-meta"><span><b>${escapeHtml(visit.visit_number ?? '—')}</b><i>|</i>${dateTime(visit.opened_at)}${visit.closed_at ? `<i>→</i>${dateTime(visit.closed_at)}` : ''}</span><span class="visit-status">${escapeHtml(visit.status ?? 'closed')} · CHARGED ${money(visit.total_charged)}</span></div></div><div class="claim-bar">CLOSED VISIT · VERIFIED ARCHIVE PDF COPY</div>${sectionHtml}</section>`;
  }).join('');

  const unlinkedRows = rowsByVisit.get('__unlinked__') ?? [];
  const unlinked = unlinkedRows.length ? `<section class="visit-block"><div class="visit-divider"><div class="visit-number"><small>HISTORY</small><b>—</b></div><div class="visit-meta"><span><b>UNLINKED CASE RECORDS</b></span><span class="visit-status">${unlinkedRows.length} EVENT(S)</span></div></div>${narrativeSections(unlinkedRows).map(({ stage, rows }) => `<div class="story-divider"><span>${stage.number}</span><div><b>${escapeHtml(stage.title)}</b><small>${escapeHtml(stage.description)}</small></div></div>${rows.map((row) => renderRow(row, input.imageUrls ?? {})).join('')}`).join('')}</section>` : '';

  const chips = [
    `<span class="badge chip primary">${escapeHtml(patient.status ?? 'discharged')}</span>`,
    `<span class="badge chip">${escapeHtml(String(patient.account_type ?? 'normal').replace(/_/g, ' '))}</span>`,
    patient.card_number ? `<span class="chip">ID: ${escapeHtml(patient.card_number)}</span>` : '',
    patient.date_of_birth ? `<span class="chip">DOB: ${escapeHtml(String(patient.date_of_birth))}${patientAge(patient.date_of_birth) ? ` · ${patientAge(patient.date_of_birth)}` : ''}</span>` : '',
    patient.blood_group ? `<span class="chip">BLOOD: ${escapeHtml(patient.blood_group)}</span>` : '',
    patient.phone ? `<span class="chip">${escapeHtml(patient.phone)}</span>` : '',
  ].filter(Boolean).join('');

  const stationCounts = [...rowsByVisit.values()].flat().reduce<Record<string, number>>((counts, row) => {
    const key = String(row.station ?? 'admin').toUpperCase();
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const filterHtml = ['ALL', ...['NURSE', 'DOCTOR', 'LAB', 'PHARMACY', 'BILLING', 'CASHIER']]
    .map((station, index) => `<span class="filter ${index === 0 ? 'active' : ''}">${station} · ${station === 'ALL' ? totalRows : stationCounts[station] ?? 0}</span>`)
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#172033;background:#f8fafc;font-size:10px}.ledger{width:794px;background:#fff;border:2px solid #dce3e8;border-radius:2px;overflow:hidden;box-shadow:7px 7px 0 rgba(212,220,228,.8)}.header{padding:18px;border-bottom:4px double #dce3e8;display:flex;justify-content:space-between;gap:15px;background:#fbfcfd}.identity{min-width:0}.person{display:flex;gap:11px;align-items:center}.avatar{width:45px;height:45px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-weight:800;color:#0f766e;background:#ccfbf1;border:1px solid #99f6e4;font-size:15px}h1{margin:0;font-size:20px;line-height:1.1;letter-spacing:-.3px}.chips{margin-top:9px;display:flex;flex-wrap:wrap;gap:5px}.chip{display:inline-block;border:1px solid #dce3e8;background:#f1f5f9;padding:4px 6px;font-size:8px;font-weight:700;letter-spacing:.6px}.chip.primary{color:#0f766e;background:#ecfdf5;border-color:#99f6e4}.head-right{text-align:right;min-width:140px}.balance-label{font-size:8px;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:1px}.balance{margin-top:3px;font-size:25px;font-family:monospace;font-weight:800}.updated{font-size:8px;color:#64748b;margin-top:3px}.filter-bar{padding:9px 15px;border-bottom:1px solid #dce3e8;background:#f6f8fa;display:flex;flex-wrap:wrap;gap:5px;align-items:center}.filter-label{color:#64748b;font-size:8px;font-weight:800;letter-spacing:1px;margin-right:2px}.filter{font-size:8px;font-weight:800;padding:4px 6px;border:1px solid #dce3e8;background:#fff;color:#64748b;border-radius:3px}.filter.active{background:#172033;color:#fff;border-color:#172033}.visit-divider{display:flex;background:#0f172a;color:#fff;break-after:avoid}.story-divider{display:flex;align-items:center;gap:9px;padding:8px 14px;border-bottom:1px solid #dce3e8;background:#f1f5f9;break-after:avoid}.story-divider>span{width:24px;height:24px;display:flex;align-items:center;justify-content:center;border:1px solid #cbd5e1;color:#334155;background:#fff;font:800 9px monospace}.story-divider b{display:block;color:#172033;font-size:8px;letter-spacing:1px}.story-divider small{display:block;margin-top:2px;color:#64748b;font-size:7px;font-weight:700;letter-spacing:.2px}.visit-number{width:85px;text-align:center;padding:10px;border-right:1px solid #334155}.visit-number small{display:block;font-size:8px;color:#94a3b8;font-weight:800;letter-spacing:1px}.visit-number b{display:block;font-family:monospace;font-size:12px;margin-top:2px}.visit-meta{padding:11px;flex:1;display:flex;justify-content:space-between;gap:10px;align-items:center;font-size:9px;text-transform:uppercase;letter-spacing:.4px}.visit-meta i{color:#64748b;margin:0 6px;font-style:normal}.visit-status{color:#cbd5e1;font-family:monospace;font-size:8px}.claim-bar{padding:5px 14px;font-size:7px;letter-spacing:1px;font-weight:800;color:#64748b;background:#f8fafc;border-bottom:1px solid #dce3e8}.ledger-row{display:flex;break-inside:avoid;border-bottom:1px solid #dce3e8}.date-cell{flex:0 0 85px;width:85px;padding:11px 7px;text-align:center;background:#f8fafc;border-right:1px solid #dce3e8}.date-day{font-size:8px;color:#64748b;font-weight:800;letter-spacing:1px}.date-time{margin-top:2px;font:700 13px monospace}.badge{display:inline-block;border:1px solid;border-radius:3px;padding:3px 5px;font-size:7px;font-weight:800;letter-spacing:.3px}.station-badge{margin-top:7px;text-transform:uppercase}.event-cell{flex:1;min-width:0;padding:11px 14px}.event-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:7px}.event-left{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.sub-badge{text-transform:uppercase}.event-title{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1px}.invoice-table{width:100%;border-collapse:collapse;font-family:monospace;font-size:9px}.invoice-table td{padding:3px 0;border-bottom:1px solid #edf0f3}.invoice-table td:last-child{text-align:right;font-weight:800}.invoice-table .total-row td{padding-top:6px;border-top:2px solid #dce3e8;border-bottom:0;font:800 8px Arial,sans-serif}.invoice-table .paid-row td{color:#047857;border-bottom:0;font-size:8px}.invoice-table .more td{text-align:center;color:#64748b;font-size:8px;font-style:italic}.payment strong{color:#047857;font:800 13px monospace}.payment strong.claim{color:#4338ca}.payment span{color:#64748b;margin-left:5px;font-size:9px}.media-row{display:flex;gap:10px;align-items:flex-start}.photo-box{width:92px;height:92px;flex:0 0 92px;border:2px dashed #dce3e8;border-radius:4px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#fff}.photo-box img{width:100%;height:100%;object-fit:cover}.photo-box.placeholder{padding:8px;text-align:center;color:#64748b;font-size:8px;font-weight:700;text-transform:uppercase}.photo-box.typed{background:#f0fdfa;color:#0f766e;border-color:#99f6e4}.media-copy{flex:1;min-width:0}.status{text-transform:uppercase}.target{color:#64748b;font-weight:800;font-size:8px;text-transform:uppercase;margin-left:4px}.note{margin:7px 0;font-style:italic;font-size:9px}.typed-note{margin:7px 0;padding:6px;background:#f8fafc;border:1px solid #e2e8f0;font:8px monospace;white-space:pre-wrap}.billed{margin-top:7px;padding-top:7px;border-top:1px solid #e2e8f0}.billed small{display:block;color:#64748b;font-size:7px;font-weight:800;letter-spacing:.8px}.billed ul{margin:3px 0 0;padding-left:14px;color:#64748b;font-size:8px}.muted{margin:1px 0 4px;color:#64748b;font-size:8px}.plain-event{margin:0;font-style:italic;font-size:10px}.discharged{margin:0;color:#047857;font-size:10px;font-weight:800}.vitals{display:flex;flex-wrap:wrap;gap:12px}.vital{border-left:2px solid #38bdf8;padding-left:7px;min-width:75px}.vital small{display:block;font-size:7px;color:#64748b;text-transform:uppercase}.vital b{font:800 10px monospace}.footer{padding:9px 13px;border-top:2px solid #dce3e8;display:flex;justify-content:space-between;background:#f8fafc;color:#64748b;font-size:8px;font-weight:800;letter-spacing:1.5px;font-style:italic}.footer-right{font-family:monospace;letter-spacing:0;font-style:normal}.empty-row{padding:18px;text-align:center;color:#64748b;font-size:9px;font-style:italic}@media print{body{background:#fff}.ledger{box-shadow:none}}
  </style></head><body><main class="ledger"><header class="header"><div class="identity"><div class="person"><div class="avatar">${escapeHtml(initials)}</div><div><h1>${escapeHtml(patientName).toUpperCase()}</h1><div class="chips"><span class="badge chip primary">ARCHIVE COPY</span><span class="badge chip">${escapeHtml(String(patient.account_type ?? 'normal').replace(/_/g, ' '))}</span></div></div></div><div class="chips">${chips}</div></div><div class="head-right"><div class="balance-label">ACCOUNT BALANCE AT ARCHIVE</div><div class="balance">${money(patient.balance)}</div><div class="updated">Prepared ${escapeHtml(dateTime(generatedAt))}</div></div></header><div class="filter-bar"><span class="filter-label">FILTER</span>${filterHtml}</div>${visitBlocks}${unlinked}<footer class="footer"><span>PATIENT LEDGER · KHAMEC HOSPITAL · ARCHIVE ${escapeHtml(input.archiveReference)}</span><span class="footer-right">CONFIDENTIAL · ${escapeHtml(patient.card_number ?? '—')}</span></footer></main></body></html>`;
}

async function waitForImages(container: HTMLElement): Promise<void> {
  const images = Array.from(container.querySelectorAll('img'));
  await Promise.all(images.map((image) => new Promise<void>((resolve) => {
    if (image.complete) { resolve(); return; }
    image.addEventListener('load', () => resolve(), { once: true });
    image.addEventListener('error', () => resolve(), { once: true });
  })));
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') || 'patient';
}

export async function createArchiveLedgerPdf(input: ArchiveLedgerPdfInput): Promise<{ blob: Blob; filename: string }> {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-100000px';
  container.style.top = '0';
  container.style.width = '814px';
  container.style.padding = '10px';
  container.style.background = '#f8fafc';
  container.innerHTML = createLedgerHtml(input);
  document.body.appendChild(container);

  try {
    await waitForImages(container);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const ledger = container.querySelector('.ledger') as HTMLElement | null;
    if (!ledger) throw new Error('Archive ledger layout could not be created');

    const canvas = await html2canvas(ledger, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      allowTaint: false,
      logging: false,
      windowWidth: 814,
    });
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
    const pageWidth = 210;
    const pageHeight = 297;
    const imageHeight = (canvas.height * pageWidth) / canvas.width;
    const image = canvas.toDataURL('image/jpeg', 0.92);
    let position = 0;
    let remaining = imageHeight;

    pdf.addImage(image, 'JPEG', 0, position, pageWidth, imageHeight, undefined, 'FAST');
    remaining -= pageHeight;
    while (remaining > 0) {
      position -= pageHeight;
      pdf.addPage();
      pdf.addImage(image, 'JPEG', 0, position, pageWidth, imageHeight, undefined, 'FAST');
      remaining -= pageHeight;
    }

    const patientName = safeFilePart(`${input.patient?.first_name ?? ''}_${input.patient?.last_name ?? ''}`);
    const cardNumber = safeFilePart(String(input.patient?.card_number ?? 'patient'));
    return { blob: pdf.output('blob'), filename: `${patientName}_${cardNumber}_Ledger_Card.pdf` };
  } finally {
    container.remove();
  }
}

export function archiveLedgerFileName(patient: any): string {
  const name = safeFilePart(`${patient?.first_name ?? ''}_${patient?.last_name ?? ''}`);
  const card = safeFilePart(String(patient?.card_number ?? 'patient'));
  return `${name}_${card}_Ledger_Card.pdf`;
}
