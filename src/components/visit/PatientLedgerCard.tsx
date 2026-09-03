// Order-centric patient ledger.
import { useEffect, useMemo, useState } from 'react';
import { createRealtimeChannel, supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { differenceInYears } from 'date-fns';
import {
  Loader2, X, ChevronDown, ChevronUp, Wallet, Droplet, Phone, Calendar, User,
  Activity, Pill, FlaskConical, ClipboardList, Receipt, FileText, PackageCheck,
  Stethoscope, BedDouble, LogOut, Camera, ArrowUp, ArrowDown, Sparkles, Download,
  ShieldCheck, CheckCircle2, Send, AlertTriangle,
} from 'lucide-react';
import { signedUrl } from '@/hooks/useVisitAttachments';
import { snapPhotoUrl } from '@/hooks/useSnapOrders';
import { Patient } from '@/contexts/PatientContext';
import { Visit } from '@/hooks/useVisits';
import { Button } from '@/components/ui/button';
import { copayPercent, hasWallet, isSponsored, sponsorLabel, splitInvoice } from '@/lib/copay';
import { ClaimActionsBar } from '@/components/claims/ClaimActionsBar';
import { useAuth } from '@/contexts/AuthContext';
import { downloadDischargeSummaryPdf } from '@/lib/dischargeSummaryPdf';
import { toast } from '@/hooks/use-toast';
import { PatientPhotoAvatar } from '@/components/patient/PatientPhotoAvatar';

// ---------- types ----------
type RowKind =
  | 'vitals' | 'attachment' | 'snap' | 'invoice' | 'payment' | 'admission' | 'discharge' | 'note';

interface LedgerRow {
  id: string;
  visitId: string;
  at: string;
  kind: RowKind;
  station: string;         // reception, nurse, clinical_team, lab, pharmacy, billing, cashier, admin
  title: string;
  actor?: string | null;
  data?: any;              // kind-specific
  subkind?: string;        // rx | lab_request | lab_result | dispense | treatment | receipt | invoice_paid | invoice_partial ...
  changes?: { label: string; from?: string | number; to?: string | number; dir?: 'up' | 'down' | 'flat' }[];
  isNew?: boolean;         // for realtime highlight
}

interface LedgerVisit {
  visit: Visit;
  rows: LedgerRow[];
}

const STATION_TONE: Record<string, string> = {
  reception: 'bg-blue-100 text-blue-700 border-blue-200',
  nurse:     'bg-teal-100 text-teal-700 border-teal-200',
  clinical_team: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  lab:       'bg-purple-100 text-purple-700 border-purple-200',
  pharmacy:  'bg-emerald-100 text-emerald-700 border-emerald-200',
  billing:   'bg-amber-100 text-amber-700 border-amber-200',
  cashier:   'bg-orange-100 text-orange-700 border-orange-200',
  admin:     'bg-slate-200 text-slate-700 border-slate-300',
};

const naira = (n: number | null | undefined) =>
  n == null ? '' : `₦${Number(n).toLocaleString()}`;


// ---------- classification & deltas ----------
type SnapSub =
  | 'rx' | 'lab_request' | 'lab_result' | 'dispense'
  | 'treatment' | 'emergency_episode' | 'vitals_photo' | 'other_snap';

const SNAP_LABEL: Record<string, string> = {
  rx: 'Prescription (Rx)',
  lab_request: 'Lab Request',
  lab_result: 'Lab Result',
  dispense: 'Dispensed',
  treatment: 'Treatment Order',
  emergency_episode: 'Emergency Episode',
  vitals_photo: 'Vitals Snap',
  other_snap: 'Snap',
  card_photo: 'Card Photo',
  vitals_first: 'Vitals & Intake',
  vitals_update: 'Vitals Update',
  invoice_new: 'Invoice Issued',
  invoice_partial: 'Invoice · Partly Paid',
  invoice_paid: 'Invoice · Paid',
  receipt_full: 'Receipt · Paid in Full',
  receipt_partial: 'Receipt · Part Payment',
  wallet_credit: 'Wallet Credit',
  wallet_debit: 'Wallet Deduction',
  debt_recorded: 'Debt Recorded',
  admission: 'Admission',
  discharge: 'Discharge',
};

function classifySnap(s: any): SnapSub {
  const t = String(s.order_type ?? '').toLowerCase();
  const target = String(s.target_station ?? '').toLowerCase();
  const source = String(s.source_role ?? '').toLowerCase();
  if (t === 'lab_result' || (source === 'lab_tech' && target !== 'lab')) return 'lab_result';
  if (t === 'prescription' || target === 'pharmacy') {
    return s.status === 'fulfilled' || s.status === 'dispensed' ? 'dispense' : 'rx';
  }
  if (t === 'lab' || target === 'lab') return 'lab_request';
  if (t === 'treatment') return 'treatment';
  if (t === 'vitals') return 'vitals_photo';
  if (s.intent === 'typed_order') {
    if (target === 'pharmacy') return 'rx';
    if (target === 'lab') return 'lab_request';
  }
  return 'other_snap';
}

const VITAL_SPECS: { key: string; label: string; unit: string; higherIsWorse?: boolean }[] = [
  { key: 'temperature', label: 'Temp', unit: '°C', higherIsWorse: true },
  { key: 'pulse', label: 'Pulse', unit: 'bpm', higherIsWorse: true },
  { key: 'spo2', label: 'SpO₂', unit: '%' },
  { key: 'respiratory_rate', label: 'RR', unit: '/min', higherIsWorse: true },
  { key: 'weight', label: 'Wt', unit: 'kg' },
];

function vitalsDeltas(cur: any, prev: any | null) {
  if (!prev) return [];
  const out: { label: string; from?: string | number; to?: string | number; dir?: 'up' | 'down' | 'flat' }[] = [];
  for (const spec of VITAL_SPECS) {
    const a = prev[spec.key], b = cur[spec.key];
    if (a == null || b == null) continue;
    const na = Number(a), nb = Number(b);
    if (!Number.isFinite(na) || !Number.isFinite(nb) || na === nb) continue;
    out.push({
      label: spec.label,
      from: `${a}${spec.unit}`,
      to: `${b}${spec.unit}`,
      dir: nb > na ? 'up' : 'down',
    });
  }
  if (prev.blood_pressure && cur.blood_pressure && prev.blood_pressure !== cur.blood_pressure) {
    out.push({ label: 'BP', from: prev.blood_pressure, to: cur.blood_pressure, dir: 'flat' });
  }
  return out;
}

const SUB_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  rx: Pill,
  lab_request: FlaskConical,
  lab_result: ClipboardList,
  dispense: PackageCheck,
  treatment: Stethoscope,
  vitals_photo: Camera,
  vitals_first: Activity,
  vitals_update: Activity,
  other_snap: Camera,
  card_photo: Camera,
  invoice_new: FileText,
  invoice_partial: FileText,
  invoice_paid: FileText,
  receipt_full: Receipt,
  receipt_partial: Receipt,
  wallet_credit: Wallet,
  wallet_debit: ArrowDown,
  debt_recorded: AlertTriangle,
  admission: BedDouble,
  discharge: LogOut,
};

const SUB_TONE: Record<string, string> = {
  rx: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  lab_request: 'bg-purple-50 text-purple-700 border-purple-200',
  lab_result: 'bg-violet-50 text-violet-700 border-violet-200',
  dispense: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  treatment: 'bg-sky-50 text-sky-700 border-sky-200',
  vitals_photo: 'bg-teal-50 text-teal-700 border-teal-200',
  vitals_first: 'bg-teal-50 text-teal-700 border-teal-200',
  vitals_update: 'bg-teal-50 text-teal-700 border-teal-200',
  card_photo: 'bg-slate-50 text-slate-700 border-slate-200',
  other_snap: 'bg-slate-50 text-slate-700 border-slate-200',
  invoice_new: 'bg-amber-50 text-amber-700 border-amber-200',
  invoice_partial: 'bg-amber-50 text-amber-700 border-amber-200',
  invoice_paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  receipt_full: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  receipt_partial: 'bg-amber-50 text-amber-700 border-amber-200',
  wallet_credit: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  wallet_debit: 'bg-orange-50 text-orange-700 border-orange-200',
  debt_recorded: 'bg-red-50 text-red-700 border-red-200',
  admission: 'bg-blue-50 text-blue-700 border-blue-200',
  discharge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

type LinkedOrderGroup = {
  key: string;
  parent: LedgerRow;
  rows: LedgerRow[];
};

const ORDER_ROW_SUBKINDS = new Set(['rx', 'lab_request', 'lab_result', 'dispense', 'emergency_episode', 'treatment']);

function linkedOrderText(row: LedgerRow): string {
  const snap = row.data ?? {};
  if (row.kind === 'snap' && snap.ocr_text?.startsWith('LINKED_PRESCRIPTION:')) {
    return `prescription:${snap.ocr_text.slice('LINKED_PRESCRIPTION:'.length)}`;
  }
  if (row.kind === 'snap' && snap.ocr_text?.startsWith('LINKED_LAB_REQUEST:')) {
    return `lab:${snap.ocr_text.slice('LINKED_LAB_REQUEST:'.length)}`;
  }
  if (row.kind === 'snap' && snap.emergency_episode_id) {
    return `emergency:${snap.emergency_episode_id}`;
  }
  if (row.kind === 'snap' && snap.ocr_text?.startsWith('EMERGENCY_EPISODE:')) {
    return `emergency:${snap.ocr_text.slice('EMERGENCY_EPISODE:'.length)}`;
  }
  if (row.kind === 'snap' && snap.note?.startsWith('Emergency Episode ')) {
    const match = String(snap.note).match(/Emergency Episode ([0-9a-f-]{36})/i);
    if (match) return `emergency:${match[1]}`;
  }
  return '';
}

function buildLinkedOrderGroups(rows: LedgerRow[]): { groups: LinkedOrderGroup[]; standalone: LedgerRow[] } {
  const groups = new Map<string, LinkedOrderGroup>();
  const invoiceIdToKey = new Map<string, string>();
  const invoiceNumberToKey = new Map<string, string>();
  const linkedSourceToKey = new Map<string, string>();
  const standalone: LedgerRow[] = [];

  const ensureGroup = (key: string, row: LedgerRow) => {
    if (!groups.has(key)) groups.set(key, { key, parent: row, rows: [] });
    const group = groups.get(key)!;
    if (group.rows.some(existing => existing.id === row.id)) return;
    group.rows.push(row);
    const parentRank = (candidate: LedgerRow) => {
      if (candidate.subkind === 'lab_result' || candidate.subkind === 'dispense') return 2;
      if (candidate.subkind === 'rx' || candidate.subkind === 'lab_request') return 0;
      return 1;
    };
    if (parentRank(row) < parentRank(group.parent) || new Date(row.at).getTime() < new Date(group.parent.at).getTime()) {
      group.parent = row;
    }
  };

  // Source orders are always the parent rows. snap_orders.invoice_id is the
  // strongest available link for billed pharmacy/lab orders, while the
  // LINKED_* markers preserve typed prescription/lab request provenance.
  rows.forEach(row => {
    if (row.kind !== 'snap' || !ORDER_ROW_SUBKINDS.has(String(row.subkind))) return;
    const snap = row.data ?? {};
    // The Emergency Episode billing draft is already represented by the
    // episode's own group; it must not surface as an extra standalone order.
    if (snap.emergency_episode_id && (snap.intent === 'emergency_billing_draft' || String(snap.ocr_text ?? '').startsWith('EMERGENCY_EPISODE:'))) return;
    const key = snap.emergency_episode_id
      ? `order:emergency:${snap.emergency_episode_id}`
      : `order:${String(snap.parent_snap_id || snap.order_parent_id || snap.id || row.id)}`;
    ensureGroup(key, row);
    if (snap.invoice_id) invoiceIdToKey.set(String(snap.invoice_id), key);
    const sourceLink = linkedOrderText(row);
    if (sourceLink) linkedSourceToKey.set(sourceLink, key);
  });

  const invoiceRows = rows.filter(row => row.kind === 'invoice');
  invoiceRows.forEach(row => {
    const id = String(row.data?.id ?? '');
    const key = invoiceIdToKey.get(id);
    if (key) {
      ensureGroup(key, row);
      if (row.data?.invoice_number) invoiceNumberToKey.set(String(row.data.invoice_number), key);
    }
  });

  rows.filter(row => row.kind === 'payment').forEach(row => {
    const key = invoiceIdToKey.get(String(row.data?.related_invoice_id ?? row.data?.invoice_id ?? ''))
      || invoiceNumberToKey.get(String(row.data?.ref ?? ''));
    if (key) ensureGroup(key, row);
  });

  rows.forEach(row => {
    if (row.kind === 'snap' && !ORDER_ROW_SUBKINDS.has(String(row.subkind))) {
      const sourceLink = linkedOrderText(row);
      const key = sourceLink ? linkedSourceToKey.get(sourceLink) : undefined;
      if (key) ensureGroup(key, row);
    }
  });

  const groupedIds = new Set(Array.from(groups.values()).flatMap(group => group.rows.map(row => row.id)));
  rows.forEach(row => { if (!groupedIds.has(row.id)) standalone.push(row); });

  groups.forEach(group => {
    group.rows = group.rows.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    group.parent = group.rows.find(row => row.subkind === 'emergency_episode')
      ?? group.rows.find(row => row.subkind === 'rx' || row.subkind === 'lab_request')
      ?? group.rows[0];
  });

  return {
    groups: Array.from(groups.values()).sort((a, b) => new Date(a.parent.at).getTime() - new Date(b.parent.at).getTime()),
    standalone,
  };
}

// ---------------------------------------------------------------------------
// Order-centric ledger: ONE ORDER = ONE CARD.
//
// Every clinical order is presented as a single row/card:
//
//   LEFT   · Billed items · Payment · Dispensed / Result   (what happened to it)
//   CENTER · The order itself: typed text OR the original snapshot
//   RIGHT  · Date · Time · Staff · Role                    (who did it, when)
//
// Rows that do not belong to an order (vitals, admission/discharge, card
// attachments, custom bills, wallet movements) remain visible as compact
// standalone events, interleaved chronologically so the whole card reads as a
// single patient journey.
// ---------------------------------------------------------------------------

const ORDER_KIND_META: Record<string, { title: string; badge: string; accent: string }> = {
  pharmacy: { title: 'Pharmacy Order', badge: 'PHARMACY', accent: 'bg-emerald-600' },
  lab: { title: 'Laboratory Order', badge: 'LABORATORY', accent: 'bg-purple-600' },
  treatment: { title: 'Treatment Order', badge: 'TREATMENT', accent: 'bg-sky-600' },
  emergency_med: { title: 'Emergency Medication', badge: 'EMERGENCY · MED', accent: 'bg-amber-600' },
  emergency_lab: { title: 'Emergency Laboratory', badge: 'EMERGENCY · LAB', accent: 'bg-amber-600' },
  emergency_episode: { title: 'Emergency Episode', badge: 'EMERGENCY', accent: 'bg-amber-600' },
};

const ORDER_KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  pharmacy: Pill,
  lab: FlaskConical,
  treatment: Stethoscope,
  emergency_med: Pill,
  emergency_lab: FlaskConical,
  emergency_episode: AlertTriangle,
};

function kindForOrderRow(row: LedgerRow): string {
  const snap = row.data ?? {};
  const sub = String(row.subkind ?? '');
  const target = String(snap.target_station ?? '').toLowerCase();
  const orderType = String(snap.order_type ?? '').toLowerCase();
  const emergency = !!(snap.emergency_episode_id || snap.order_parent_id?.startsWith('order:emergency:') || row.id.startsWith('emergency-item-'));
  if (emergency) {
    const isLab = sub === 'lab_request' || target === 'lab' || orderType === 'lab';
    return isLab ? 'emergency_lab' : 'emergency_med';
  }
  if (sub === 'lab_request' || target === 'lab' || orderType === 'lab' || orderType === 'lab_result') return 'lab';
  if (sub === 'dispense') return 'pharmacy';
  if (sub === 'rx' || target === 'pharmacy' || orderType === 'prescription') return 'pharmacy';
  if (sub === 'treatment' || orderType === 'treatment') return 'treatment';
  if (row.kind === 'invoice') return 'other';
  return 'treatment';
}

function friendlyRole(raw: string | null | undefined): string {
  const r = String(raw ?? '').replace(/[_-]/g, ' ').trim().toLowerCase();
  if (!r) return 'Clinical Staff';
  const map: Record<string, string> = {
    reception: 'Receptionist', receptionist: 'Receptionist',
    nurse: 'Nurse',
    doctor: 'Doctor', doctor1: 'Doctor', doctor2: 'Doctor', clinical_team: 'Clinical Team',
    lab: 'Laboratory Staff', lab_tech: 'Laboratory Staff',
    pharmacy: 'Pharmacist', pharmacist: 'Pharmacist',
    billing: 'Billing Officer', cashier: 'Cashier', accountant: 'Accountant',
    admin: 'Admin',
  };
  return map[r] ?? (String(raw).replace(/[_-]/g, ' ') || 'Clinical Staff');
}

// Tiny module-level staff cache keyed by auth user id (name + friendly role).
// The staff table is only readable by admin/billing accounts; viewers without
// access simply fall back to the role label carried by the event itself.
const staffCache = new Map<string, { name: string; role: string } | null>();
let staffFetch: Promise<void> | null = null;
function preloadStaffNames() {
  if (staffFetch) return staffFetch;
  staffFetch = (async () => {
    try {
      const { data } = await supabase.from('staff').select('auth_user_id, first_name, last_name, role');
      (data ?? []).forEach((s: any) => {
        if (!s.auth_user_id) return;
        staffCache.set(String(s.auth_user_id), {
          name: [s.first_name, s.last_name].filter(Boolean).join(' '),
          role: friendlyRole(s.role),
        });
      });
    } catch {
      // staff is unreadable for this role — role labels still show
    }
  })();
  return staffFetch;
}
function staffInfo(userId: string | null | undefined): { name: string | null; role: string | null } {
  if (!userId) return { name: null, role: null };
  const info = staffCache.get(String(userId));
  return info ? { name: info.name, role: info.role } : { name: null, role: null };
}

function extractInvoiceItems(inv: any): any[] {
  const all = Array.isArray(inv.invoice_items) ? inv.invoice_items : [];
  return all.filter((it: any) =>
    it.dispensing_status !== 'unavailable' &&
    it.dispensing_status !== 'refund_requested' &&
    it.dispensing_status !== 'refund_pending' &&
    it.dispensing_status !== 'refunded' &&
    it.dispensing_status !== 'not_given',
  );
}

function orderFinances(group: LinkedOrderGroup) {
  const invoices = group.rows.filter(r => r.kind === 'invoice');
  const payments = group.rows.filter(r => r.kind === 'payment');
  const parentData = group.parent?.data ?? {};
  const snapInvoiceId = parentData.invoice_id;
  const matched = Array.isArray(parentData.matched_items) ? parentData.matched_items.filter((m: any) => Number(m.qty || 1) > 0) : [];
  const invoice = snapInvoiceId
    ? invoices.find(i => String(i.data?.id) === String(snapInvoiceId)) ?? invoices[0]
    : invoices[0];
  const billed = !!invoice || (Array.isArray(parentData.matched_items) && parentData.matched_items.length > 0);
  const paidAmount = invoice ? Number(invoice.data?.paid_amount ?? 0) : 0;
  const totalAmount = invoice ? Number(invoice.data?.total_amount ?? 0) : 0;
  const paid = paidAmount > 0 || ['paid', 'settled'].includes(String(invoice?.data?.status ?? '')) || payments.some(p => String(p.subkind) === 'receipt_full');
  return { invoices, payments, invoice, billed, paid, paidAmount, totalAmount, matched };
}

function orderCompletions(group: LinkedOrderGroup) {
  const parentData = group.parent?.data ?? {};
  const snapStatus = String(parentData.status ?? '');
  // Pharmacy
  const dispenseRows = group.rows.filter(r => String(r.subkind) === 'dispense');
  const invoiceDispensed = (group.rows.filter(r => r.kind === 'invoice')
    .flatMap(r => extractInvoiceItems(r.data ?? {}))
    .some((it: any) => String(it.dispensing_status ?? '') === 'dispensed'));
  const dispensed =
    snapStatus === 'fulfilled' || snapStatus === 'dispensed' ||
    dispenseRows.length > 0 || invoiceDispensed;
  const dispensedAt = dispenseRows[0]?.at ?? parentData.fulfilled_at ?? parentData.updated_at ?? null;
  // Laboratory results. Besides dedicated lab_result rows, the laboratory
  // returns results as snap rows that reuse order_type 'lab' with status
  // 'returned' and link back to the original order through parent_snap_id.
  // Both shapes must count as the order's result or the card stays stuck on
  // "Result pending" after the result was actually returned.
  const resultRows = group.rows.filter(r =>
    String(r.subkind) === 'lab_result' ||
    (r.kind === 'snap' && String(r.data?.order_type ?? '').toLowerCase() === 'lab_result') ||
    (r.kind === 'snap' &&
      String(r.data?.status ?? '').toLowerCase() === 'returned' &&
      (r.data?.result_text || r.data?.photo_path)),
  );
  let resultText = resultRows.map(r => r.data?.result_text ?? r.data?.note ?? '').filter(Boolean)[0] ?? null;
  let resultPhoto = resultRows.map(r => r.data?.photo_path ?? null).find(Boolean) ?? null;
  // Fallback rows can carry the lab request's results JSON serialised as plain
  // text (photo results in particular). Unpack it so the Result lane shows the
  // captured image with the typed text instead of a raw JSON blob.
  if (resultPhoto == null && resultText && String(resultText).trim().startsWith('{')) {
    try {
      const parsed: any = JSON.parse(resultText);
      if (parsed && typeof parsed === 'object') {
        resultText = String(parsed.result_text || parsed.note || '') || null;
        resultPhoto = parsed.photo_path ?? null;
      }
    } catch {
      // Not JSON — keep the original text as-is.
    }
  }
  const resultAt = resultRows[0]?.at ?? null;
  const hasResult = resultRows.length > 0;
  return { dispensed, dispensedAt, resultRows, resultText, resultPhoto, resultAt, hasResult };
}

function CardMeta({ row, label }: { row: LedgerRow; label?: string }) {
  const snap = row.data ?? {};
  const createdBy = snap.created_by ?? snap.billed_by ?? snap.fulfilled_by ?? null;
  const info = staffInfo(createdBy);
  const role = info.role ?? friendlyRole(snap.original_sender_role ?? snap.source_role ?? row.station);
  void label;
  return (
    <div className="flex md:flex-col items-center md:items-end gap-x-3 gap-y-1 md:gap-y-1.5 md:text-right flex-wrap justify-between md:justify-start">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Date / Staff</div>
      <div className="flex items-baseline gap-2 md:gap-1.5 md:flex-col md:items-end">
        <span className="text-sm font-bold uppercase tracking-wide">
          {format(new Date(row.at), 'dd MMM yyyy')}
        </span>
        <span className="text-xs font-mono text-muted-foreground">
          {format(new Date(row.at), 'HH:mm')}
        </span>
      </div>
      {info.name ? (
        <span className="text-xs font-semibold text-foreground">{info.name}</span>
      ) : null}
      <span className="px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wide bg-muted/50 text-muted-foreground capitalize">
        {role}
      </span>
    </div>
  );
}

function LaneLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
      {children}
    </div>
  );
}

function BilledLane({ group, patient }: { group: LinkedOrderGroup; patient: Patient }) {
  const { invoice, matched, invoices } = orderFinances(group);
  const items = invoice ? extractInvoiceItems(invoice.data ?? {}) : [];
  const total = invoice ? Number(invoice.data?.total_amount ?? 0) : 0;
  const display = items.length > 0 ? items : matched;
  if (!invoice && display.length === 0) {
    return (
      <div>
        <LaneLabel>Billed</LaneLabel>
        <p className="text-[11px] italic text-muted-foreground">Not billed yet</p>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <LaneLabel>Billed</LaneLabel>
        {invoice && (
          <span className="text-[9px] font-mono text-muted-foreground">#{invoice.data?.invoice_number}</span>
        )}
      </div>
      {display.length === 0 && <p className="text-[11px] italic text-muted-foreground">Invoice issued</p>}
      <ul className="space-y-0.5">
        {display.slice(0, 4).map((it: any, i: number) => (
          <li key={i} className="flex justify-between gap-2 text-[11px] leading-tight">
            <span className="min-w-0 truncate text-foreground">
              {it.description ?? it.name}{it.qty > 1 ? ` ×${it.qty}` : ''}
            </span>
            <span className="font-mono font-semibold shrink-0">{naira(it.total != null && it.total !== '' ? Number(it.total) : Number(it.unit_price ?? 0) * Number(it.qty ?? 1))}</span>
          </li>
        ))}
        {display.length > 4 && <li className="text-[10px] text-muted-foreground italic">+{display.length - 4} more…</li>}
      </ul>
      {invoice && (
        <div className="mt-1 pt-1 border-t border-border/60 flex justify-between text-[11px]">
          <span className="font-bold uppercase tracking-wide text-muted-foreground">Total</span>
          <span className="font-mono font-bold">{naira(total)}</span>
        </div>
      )}
      {invoices.length > 0 && <InvoiceDetailToggle inv={invoice ?? invoices[0]} patient={patient} />}
    </div>
  );
}

function InvoiceDetailToggle({ inv, patient }: { inv: any; patient: Patient }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-[10px] font-bold uppercase tracking-wide text-primary hover:underline flex items-center gap-1"
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Invoice details
      </button>
      {open && (
        <div className="mt-2 rounded-md border border-border bg-background p-2">
          <InvoiceRow inv={inv} patient={patient} />
        </div>
      )}
    </div>
  );
}

function PaymentLane({ group }: { group: LinkedOrderGroup }) {
  const { invoice, paid, paidAmount, payments } = orderFinances(group);
  const total = invoice ? Number(invoice.data?.total_amount ?? 0) : 0;
  if (!invoice && payments.length === 0) {
    return (
      <div>
        <LaneLabel>Payment</LaneLabel>
        <p className="text-[11px] italic text-muted-foreground">Awaiting payment</p>
      </div>
    );
  }
  return (
    <div>
      <LaneLabel>Payment</LaneLabel>
      {paid ? (
        <p className="text-[11px] font-bold text-emerald-700 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {paidAmount >= total ? 'Paid' : 'Partly paid'} {naira(paidAmount)}
        </p>
      ) : (
        <p className="text-[11px] font-semibold text-amber-700">Pending · {naira(total)}</p>
      )}
      {payments.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {payments.slice(0, 2).map((p, i) => (
            <li key={i} className="text-[10px] text-muted-foreground">
              {format(new Date(p.at), 'dd MMM')} · {String(p.data?.method ?? 'cash').replace(/_/g, ' ')} · {naira(Number(p.data?.amount ?? 0))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultPhotoView({
  photoPath, thumbs, onOpenImage,
}: {
  photoPath: string;
  thumbs: Record<string, string>;
  onOpenImage: (url: string) => void;
}) {
  const thumb = thumbs[photoPath];
  if (thumb) return <SnapPhoto url={thumb} label="Result image" onOpen={onOpenImage} />;
  return (
    <button
      type="button"
      onClick={async () => {
        const url = await snapPhotoUrl(photoPath);
        if (url) onOpenImage(url);
      }}
      className="text-[11px] font-semibold text-primary underline-offset-2 hover:underline flex items-center gap-1"
    >
      <FileText className="h-3 w-3" /> View result image
    </button>
  );
}

function CompletionLane({ group, thumbs, onOpenImage }: {
  group: LinkedOrderGroup;
  thumbs: Record<string, string>;
  onOpenImage: (url: string) => void;
}) {
  const kind = kindForOrderRow(group.parent);
  const { dispensed, dispensedAt, resultRows, resultText, resultPhoto, resultAt, hasResult } = orderCompletions(group);
  const isLab = kind === 'lab' || kind === 'emergency_lab';
  if (isLab) {
    const photoThumb = resultPhoto ? thumbs[resultPhoto] : undefined;
    return (
      <div>
        <LaneLabel>Result</LaneLabel>
        {hasResult ? (
          <>
            {resultPhoto ? (
              photoThumb ? (
                <SnapPhoto url={photoThumb} label="Result image" onOpen={onOpenImage} />
              ) : (
                <button
                  type="button"
                  onClick={async () => {
                    const url = await snapPhotoUrl(resultPhoto);
                    if (url) onOpenImage(url);
                  }}
                  className="text-[11px] font-semibold text-primary underline-offset-2 hover:underline flex items-center gap-1"
                >
                  <FileText className="h-3 w-3" /> View result image
                </button>
              )
            ) : null}
            {resultText && !resultPhoto ? (
              <p className="text-[11px] leading-snug whitespace-pre-wrap max-h-24 overflow-y-auto rounded border border-violet-200 bg-violet-50/60 p-1.5 text-foreground">
                {resultText}
              </p>
            ) : null}
            {resultAt && <p className="text-[10px] text-muted-foreground mt-0.5">Result {format(new Date(resultAt), 'dd MMM · HH:mm')}</p>}
          </>
        ) : (
          <p className="text-[11px] italic text-muted-foreground">Result pending</p>
        )}
      </div>
    );
  }
  return (
    <div>
      <LaneLabel>Dispensed</LaneLabel>
      {dispensed ? (
        <p className="text-[11px] font-bold text-emerald-700 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> Dispensed
        </p>
      ) : (
        <p className="text-[11px] italic text-muted-foreground">Not dispensed</p>
      )}
      {dispensedAt && <p className="text-[10px] text-muted-foreground mt-0.5">{format(new Date(dispensedAt), 'dd MMM · HH:mm')}</p>}
    </div>
  );
}

function OrderContentBox({ row, thumb, onOpenImage }: {
  row: LedgerRow;
  thumb?: string;
  onOpenImage: (url: string) => void;
}) {
  const snap = row.data ?? {};
  const photo = snap.photo_path;
  const typed =
    snap.intent === 'typed_order' ||
    String(snap.ocr_text ?? '').startsWith('LINKED_') ||
    !photo;
  const note = String(snap.note ?? '').trim();
  if (photo && thumb && !typed) {
    return (
      <div>
        <div className="rounded-lg overflow-hidden border border-border bg-muted flex items-center justify-center">
          <button type="button" className="block w-full cursor-zoom-in" onClick={() => thumb && onOpenImage(thumb)} title="Click to enlarge the original order">
            <img src={thumb} alt="Original order snapshot" className="max-h-64 w-full object-contain" />
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
            <Camera className="h-3 w-3" /> Original order snapshot
          </span>
          <span className="text-[9px] text-muted-foreground">Click to enlarge</span>
        </div>
        {note && <p className="mt-1.5 text-[11px] italic text-muted-foreground whitespace-pre-wrap">"{note}"</p>}
      </div>
    );
  }
  return (
    <div className="rounded-lg border-2 border-primary/25 bg-primary/5 p-3 min-h-[96px]">
      <div className="flex items-center gap-1.5 mb-1.5 text-[9px] font-bold uppercase tracking-widest text-primary">
        <Sparkles className="h-3.5 w-3.5" />
        {photo ? 'Typed Order' : 'Order content'}
      </div>
      {note ? (
        <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words text-foreground">{note}</p>
      ) : (
        <p className="text-xs italic text-muted-foreground">No written note attached to this order.</p>
      )}
      {snap.emergency_episode_id && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-800 text-[9px] font-bold uppercase tracking-wide">
            Emergency — authorized before billing
          </span>
          {String(snap.status ?? '').toLowerCase() === 'billed' && (
            <span className="px-1.5 py-0.5 rounded border border-indigo-300 bg-indigo-50 text-indigo-800 text-[9px] font-bold uppercase tracking-wide">
              Finalized & billed
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function PipelineChips({ group }: { group: LinkedOrderGroup }) {
  const kind = kindForOrderRow(group.parent);
  const fin = orderFinances(group);
  const comp = orderCompletions(group);
  const snap = group.parent?.data ?? {};
  const snapStatus = String(snap.status ?? '');
  const emergency = kind === 'emergency_med' || kind === 'emergency_lab';
  const steps: { label: string; done: boolean }[] = emergency
    ? [
        { label: 'Authorized', done: true },
        ...(kind === 'emergency_med'
          ? [{ label: 'Provided', done: snap.administered_now || snapStatus === 'dispensed' || snapStatus === 'fulfilled' || comp.dispensed }]
          : []),
        { label: 'Billed', done: fin.billed },
        { label: 'Paid', done: fin.paid },
      ]
    : kind === 'lab'
    ? [
        { label: 'Billed', done: fin.billed },
        { label: 'Paid', done: fin.paid },
        { label: 'Result', done: comp.hasResult },
      ]
    : [
        { label: 'Billed', done: fin.billed },
        { label: 'Paid', done: fin.paid },
        { label: 'Dispensed', done: comp.dispensed },
      ];
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {steps.map((s, i) => (
        <span key={s.label} className="flex items-center gap-1">
          {i > 0 && <span className="text-[9px] text-muted-foreground">→</span>}
          <span
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-wide ${
              s.done
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : 'border-border bg-muted/40 text-muted-foreground'
            }`}
          >
            {s.done && <CheckCircle2 className="h-2.5 w-2.5" />}
            {s.label}
          </span>
        </span>
      ))}
    </div>
  );
}

function OrderCardView({
  group, thumbs, onOpenImage, patient,
}: {
  group: LinkedOrderGroup;
  thumbs: Record<string, string>;
  onOpenImage: (url: string) => void;
  patient: Patient;
}) {
  const parent = group.parent;
  const kind = kindForOrderRow(parent);
  const meta = ORDER_KIND_META[kind] ?? ORDER_KIND_META.treatment;
  const Icon = ORDER_KIND_ICON[kind] ?? Stethoscope;
  const snap = parent.data ?? {};
  const photo = snap.photo_path;
  const thumb = photo ? thumbs[photo] : undefined;
  const isEpisode = String(parent.subkind) === 'emergency_episode';

  // Episode groups carry the individual medication/lab authorizations inside.
  if (isEpisode) {
    return (
      <EmergencyEpisodeCard
        group={group} thumbs={thumbs} onOpenImage={onOpenImage} patient={patient}
      />
    );
  }

  return (
    <div className={`rounded-xl border border-border overflow-hidden shadow-sm bg-card ${parent.isNew ? 'ring-2 ring-primary/40' : ''}`}>
      {/* Header strip */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/40 flex-wrap">
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border text-[10px] font-bold uppercase tracking-wide ${String(parent.subkind) === 'emergency_med' || String(parent.subkind) === 'emergency_lab' ? 'bg-amber-50 text-amber-800' : 'bg-primary/10 text-primary'}`}>
          <Icon className="h-3 w-3" />
          {meta.title}
        </span>
        <PipelineChips group={group} />
        {parent.isNew && (
          <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-primary text-primary-foreground animate-pulse">New</span>
        )}
        <span className="ml-auto text-[9px] text-muted-foreground uppercase font-mono">
          #{group.key.slice(-8)}
        </span>
      </div>

      {/* Mobile quick meta (role + time) so it is never lost on small screens */}
      <div className="md:hidden px-3 py-1.5 border-b border-border/60 bg-background flex items-center gap-2 text-[10px] text-muted-foreground">
        <Calendar className="h-3 w-3" />
        {format(new Date(parent.at), 'dd MMM yyyy · HH:mm')}
        <span className="ml-auto">{friendlyRole(snap.original_sender_role ?? snap.source_role ?? parent.station)}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[190px_1fr_150px]">
        {/* LEFT — what happened to this order */}
        <div className="md:border-r border-b md:border-b-0 border-border bg-muted/10 px-3 py-2.5 space-y-3 min-w-0">
          <BilledLane group={group} patient={patient} />
          <PaymentLane group={group} />
          <CompletionLane group={group} thumbs={thumbs} onOpenImage={onOpenImage} />
        </div>
        {/* CENTER — the order itself */}
        <div className="px-3 py-2.5 min-w-0 border-b md:border-b-0 border-border">
          <OrderContentBox row={parent} thumb={thumb} onOpenImage={onOpenImage} />
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wide ${String(snap.status ?? '').replace(/_/g, ' ').toLowerCase().includes('paid') ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-muted/50 text-muted-foreground border-border'}`}>
              {snapStatusLabel(snap.status)}
            </span>
            {snap.target_station && (
              <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                → {friendlyStation(snap.target_station)}
              </span>
            )}
          </div>
        </div>
        {/* RIGHT — who & when */}
        <div className="px-3 py-2.5 border-l-0 md:border-l border-t md:border-t-0 border-border bg-muted/10">
          <CardMeta row={parent} />
        </div>
      </div>
    </div>
  );
}

function snapStatusLabel(status: string | null | undefined): string {
  const s = String(status ?? '').replace(/_/g, ' ');
  if (!s) return 'Ordered';
  const map: Record<string, string> = {
    'pending billing': 'Awaiting billing',
    'awaiting payment': 'Awaiting payment',
    paid: 'Paid',
    fulfilled: 'Dispensed',
    dispensed: 'Dispensed',
    returned: 'Result returned',
    acknowledged: 'Acknowledged',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
    pending: 'Pending',
  };
  return map[s.toLowerCase()] ?? s.charAt(0).toUpperCase() + s.slice(1);
}

function friendlyStation(station: string | null | undefined): string {
  const s = String(station ?? '').replace(/[_-]/g, ' ');
  const map: Record<string, string> = { pharmacy: 'Pharmacy', lab: 'Laboratory', billing: 'Billing', 'clinical team': 'Clinical Team', nurse: 'Nurse' };
  return map[s.toLowerCase()] ?? s;
}

function EmergencyEpisodeCard({
  group, thumbs, onOpenImage, patient,
}: {
  group: LinkedOrderGroup;
  thumbs: Record<string, string>;
  onOpenImage: (url: string) => void;
  patient: Patient;
}) {
  const parent = group.parent;
  const snap = parent.data ?? {};
  const episodeStatus = String(snap.status ?? '');
  const items = group.rows.filter(r =>
    r.kind === 'snap' &&
    (String(r.subkind) === 'rx' || String(r.subkind) === 'lab_request') &&
    (r.id.startsWith('emergency-item-') || r.data?.emergency_episode_id || String(r.data?.order_parent_id ?? '').startsWith('order:emergency:')),
  );
  const episodePhase =
    episodeStatus === 'reconciled' ? 'Finalized & billed'
    : episodeStatus === 'finalized' ? 'Finalized — draft sent to billing'
    : episodeStatus === 'open' ? 'Open — care in progress'
    : episodeStatus;

  return (
    <div className={`rounded-xl border-2 border-amber-300/70 overflow-hidden shadow-sm bg-card ${parent.isNew ? 'ring-2 ring-amber-400/60' : ''}`}>
      <div className="px-3 py-2 border-b border-amber-300/60 bg-amber-50/70 flex items-center gap-2 flex-wrap">
        <AlertTriangle className="h-4 w-4 text-amber-700" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-amber-900">Emergency Episode</span>
        <span className="px-1.5 py-0.5 rounded border border-amber-300 bg-amber-100 text-amber-800 text-[9px] font-bold uppercase tracking-wide">
          {episodePhase}
        </span>
        <span className="ml-auto text-[10px] text-amber-800/70 flex items-center gap-1">
          <Calendar className="h-3 w-3" />
          {format(new Date(parent.at), 'dd MMM yyyy · HH:mm')}
        </span>
      </div>
      {snap.note && snap.note !== 'Urgent care recorded before billing' && (
        <div className="px-3 py-2 bg-amber-50/40 border-b border-amber-200/50 text-xs italic text-amber-900/80">
          {snap.note}
        </div>
      )}
      <div className="divide-y divide-border">
        {items.length === 0 && <p className="px-3 py-3 text-xs italic text-muted-foreground">No items recorded for this episode.</p>}
        {items.map(item => (
          <EmergencyItemCard
            key={item.id} item={item} episodeKey={group.key} groupRows={group.rows}
            thumbs={thumbs} onOpenImage={onOpenImage} patient={patient}
          />
        ))}
      </div>
    </div>
  );
}

function EmergencyItemCard({
  item, episodeKey, groupRows, thumbs, onOpenImage, patient,
}: {
  item: LedgerRow;
  episodeKey: string;
  groupRows: LedgerRow[];
  thumbs: Record<string, string>;
  onOpenImage: (url: string) => void;
  patient: Patient;
}) {
  const snap = item.data ?? {};
  const itemId = String(snap.id ?? '');
  const isLab = String(item.subkind) === 'lab_request' || String(snap.target_station ?? '').toLowerCase() === 'lab';
  const invoiceRows = groupRows.filter(r => r.kind === 'invoice');
  const myLines: any[] = [];
  invoiceRows.forEach(inv => {
    const items = Array.isArray(inv.data?.invoice_items) ? inv.data.invoice_items : [];
    items.forEach((it: any) => {
      if (it.emergency_episode_item_id && String(it.emergency_episode_item_id) === itemId) myLines.push(it);
    });
  });
  const myInvoice = invoiceRows.find(inv =>
    (Array.isArray(inv.data?.invoice_items) ? inv.data.invoice_items : [])
      .some((it: any) => it.emergency_episode_item_id && String(it.emergency_episode_item_id) === itemId),
  );
  const invoicePaid = myInvoice ? Number(myInvoice.data?.paid_amount ?? 0) > 0 : false;
  const invoiceTotal = myInvoice ? Number(myInvoice.data?.total_amount ?? 0) : 0;
  const results = groupRows.filter(r =>
    (String(r.subkind) === 'lab_result' || String(r.data?.order_type ?? '').toLowerCase() === 'lab_result') &&
    (String(r.data?.order_parent_id ?? '') === episodeKey || r.id.startsWith('emergency-lab-result-')),
  );
  let resultText = results.map(r => r.data?.result_text ?? r.data?.note ?? '').filter(Boolean)[0] ?? null;
  let resultPhoto = results.map(r => r.data?.photo_path ?? null).find(Boolean) ?? null;
  // Unpack a serialised results JSON (photo results) so the text stays clean.
  if (resultPhoto == null && resultText && String(resultText).trim().startsWith('{')) {
    try {
      const parsed: any = JSON.parse(resultText);
      if (parsed && typeof parsed === 'object') {
        resultText = String(parsed.result_text || parsed.note || '') || null;
        resultPhoto = parsed.photo_path ?? null;
      }
    } catch {
      // Not JSON — keep as-is.
    }
  }
  const itemStatus = String(snap.status ?? '');
  const provided = !!snap.administered_now || itemStatus === 'completed' || (isLab ? results.length > 0 : false);
  const billed = myLines.length > 0 || myInvoice != null;
  const meta = kindForOrderRow(item) === 'emergency_lab'
    ? ORDER_KIND_META.emergency_lab : ORDER_KIND_META.emergency_med;
  const noteParts = [
    snap.description ? snap.description : snap.name ? snap.name : (myLines[0]?.description ?? ''),
    snap.strength ? snap.strength : '',
  ].filter(Boolean);
  const detail = String(snap.note ?? '').trim();

  return (
    <div className="px-3 py-2.5 flex flex-col sm:flex-row gap-3">
      {/* Left mini-lane: status of this item */}
      <div className="sm:w-44 shrink-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <span className={`px-1.5 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-wide ${provided ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-amber-300 bg-amber-50 text-amber-800'}`}>
            {provided ? (isLab ? 'Result ready' : 'Provided') : 'Authorized'}
          </span>
          {billed && (
            <span className="px-1.5 py-0.5 rounded-full border border-indigo-300 bg-indigo-50 text-indigo-800 text-[9px] font-bold uppercase tracking-wide">Billed</span>
          )}
          {invoicePaid && (
            <span className="px-1.5 py-0.5 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700 text-[9px] font-bold uppercase tracking-wide">Paid</span>
          )}
        </div>
        {billed && (
          <div className="text-[10px]">
            {myLines.length > 0 ? (
              <ul className="space-y-0.5">
                {myLines.slice(0, 3).map((l, i) => (
                  <li key={i} className="flex justify-between gap-1">
                    <span className="truncate">{l.description}{l.quantity > 1 ? ` ×${l.quantity}` : ''}</span>
                    <span className="font-mono font-semibold">{naira(Number(l.total ?? 0))}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="italic text-muted-foreground">Invoice issued</p>
            )}
            <div className="mt-0.5 pt-0.5 border-t border-border/60 flex justify-between">
              <span className="text-[9px] uppercase font-bold text-muted-foreground">Total</span>
              <span className="font-mono font-bold">{naira(invoiceTotal)}</span>
            </div>
          </div>
        )}
        {!billed && (
          <p className="text-[10px] italic text-muted-foreground">
            Emergency care given first — billing happens after the episode is finalized.
          </p>
        )}
      </div>
      {/* Center: the item itself */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-foreground">
            {noteParts[0] || (isLab ? 'Laboratory test' : 'Medication')}
          </span>
          {noteParts[1] && <span className="text-xs font-mono text-muted-foreground">{noteParts[1]}</span>}
          <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wide ${isLab ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
            {isLab ? 'Lab test' : 'Medication'}
          </span>
          {snap.administered_now && (
            <span className="px-1.5 py-0.5 rounded border border-sky-300 bg-sky-50 text-sky-800 text-[9px] font-bold uppercase tracking-wide">
              Given during emergency
            </span>
          )}
        </div>
        {detail && <p className="mt-1 text-[11px] text-muted-foreground whitespace-pre-wrap">{detail}</p>}
        {!isLab && results.length === 0 && (
          <div className="mt-1 text-[10px] text-muted-foreground">
            {snap.requires_pharmacy === false || snap.administered_now
              ? 'No pharmacy re-dispense needed — already given.'
              : String(snap.target_station ?? '') === 'pharmacy'
              ? 'Awaiting pharmacy dispensing after payment.'
              : ''}
          </div>
        )}
        {isLab && results.length > 0 && (
          <div className="mt-1.5">
            <LaneLabel>Result</LaneLabel>
            {resultPhoto ? (
              <ResultPhotoView photoPath={resultPhoto} thumbs={thumbs} onOpenImage={onOpenImage} />
            ) : null}
            {resultText && (
              <p className="text-[11px] leading-snug whitespace-pre-wrap max-h-20 overflow-y-auto rounded border border-violet-200 bg-violet-50/60 p-1.5">
                {resultText}
              </p>
            )}
          </div>
        )}
      </div>
      {/* Right: staff & time of this authorization */}
      <div className="sm:w-36 shrink-0 sm:text-right text-[10px] text-muted-foreground space-y-0.5">
        <div className="font-mono">{format(new Date(item.at), 'dd MMM yyyy')}</div>
        <div className="font-mono">{format(new Date(item.at), 'HH:mm')}</div>
        <div className="capitalize font-semibold text-foreground">{friendlyRole(snap.source_role ?? item.station)}</div>
      </div>
    </div>
  );
}

function OrderCentricRows({
  rows, thumbs, attachmentText, onOpenImage, patient,
}: {
  rows: LedgerRow[];
  thumbs: Record<string, string>;
  attachmentText: Record<string, string>;
  onOpenImage: (url: string) => void;
  patient: Patient;
}) {
      void attachmentText;
  const { groups, standalone } = useMemo(() => buildLinkedOrderGroups(rows), [rows]);

  // A parent snap whose only role is carrying a photo/lab-result is simply an
  // event, not an order with lanes. Keep those as compact event rows.
  const eventGroups = groups.filter(g =>
    String(g.parent.subkind) === 'lab_result' ||
    (String(g.parent.subkind) === 'dispense' && !(g.parent.data?.note || String(g.parent.data?.ocr_text ?? '').startsWith('LINKED_'))),
  );
  const cardGroups = groups.filter(g => !eventGroups.includes(g));
  const eventRows = [
    ...standalone.filter(r => {
      // The Emergency billing draft has no separate visual meaning once its
      // episode card shows billing; skip it as an isolated event.
      const s = r.data ?? {};
      if (s.emergency_episode_id && (s.intent === 'emergency_billing_draft' || String(s.ocr_text ?? '').startsWith('EMERGENCY_EPISODE:'))) return false;
      return true;
    }),
    ...eventGroups.flatMap(g => g.rows),
  ];

  const entries = [
    ...cardGroups.map(g => ({ at: g.parent.at, type: 'card' as const, group: g })),
    ...eventRows.map(r => ({ at: r.at, type: 'row' as const, row: r })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <div className="p-3 space-y-3">
      {entries.length === 0 && (
        <p className="text-center text-xs text-muted-foreground italic py-4">No events recorded yet.</p>
      )}
      {entries.map(entry => entry.type === 'card' ? (
        <OrderCardView
          key={entry.group.key}
          group={entry.group}
          thumbs={thumbs}
          onOpenImage={onOpenImage}
          patient={patient}
        />
      ) : (
        <div key={entry.row.id} className="rounded-lg border border-border/70 overflow-hidden bg-background shadow-sm">
          <LedgerRowView
            row={entry.row}
            thumbs={thumbs}
            attachmentText={attachmentText}
            onOpenImage={onOpenImage}
            patient={patient}
          />
        </div>
      ))}
    </div>
  );
}

function NarrativeLedgerRows(props: Parameters<typeof OrderCentricRows>[0]) {
  return <OrderCentricRows {...props} />;
}

// ---------- component ----------
export function PatientLedgerCard({
  patient,
  onClose,
  compact = false,
}: {
  patient: Patient;
  onClose?: () => void;
  compact?: boolean;
}) {
  const [visits, setVisits] = useState<LedgerVisit[]>([]);
  const [unassignedRows, setUnassignedRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [attachmentText, setAttachmentText] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [stationFilter, setStationFilter] = useState<Set<string>>(new Set());
  // Bumped once staff display names finish preloading so Date/Staff lanes can
  // re-render with real names instead of waiting for the next poll cycle.
  const [, setStaffTick] = useState(0);


  const age = patient.date_of_birth
    ? differenceInYears(new Date(), new Date(patient.date_of_birth)) : null;

  // Load everything
  const load = useMemo(() => async (showSpinner = false) => {
    if (showSpinner) {
      setLoading(true);
      setLoadError(null);
    }

    const { data: visitList } = await supabase
      .from('visits')
      .select('*')
      .eq('patient_id', patient.id)
      .order('opened_at', { ascending: false });

    const vs = (visitList ?? []) as any[] as Visit[];
    const visitIds = vs.map(v => v.id);
    // A typed order can be submitted while the active-visit hook is still loading.
    // Keep patient-scoped clinical events visible by attaching an orphaned row to
    // the current open visit (or the most recent visit) when one exists.
    const fallbackVisitId = vs.find(v => v.status === 'open')?.id ?? vs[0]?.id ?? null;
    const visitIdForLedger = (visitId: string | null | undefined) =>
      visitId && visitIds.includes(visitId) ? visitId : fallbackVisitId;

    const [vt, att, snaps, invs, adms, labReqs, prescriptions, balanceTxs, emergencyEpisodes, emergencyItems] = await Promise.all([
      visitIds.length
        ? supabase.from('vitals').select('*').in('visit_id', visitIds)
        : Promise.resolve({ data: [] as any[] }),
      visitIds.length
        ? supabase.from('visit_attachments').select('*').in('visit_id', visitIds)
        : Promise.resolve({ data: [] as any[] }),
      supabase.from('snap_orders').select('*').eq('patient_id', patient.id),
      // CockroachDB uses a compatibility gateway rather than PostgREST, so
      // relational selects such as invoice_items(*) are not valid SQL here.
      // Load invoice rows flat, then attach their items below.
      // Query by patient_id so custom bills remain visible even when a legacy
      // workflow omitted or later corrected the visit linkage.
      supabase.from('invoices').select('*').eq('patient_id', patient.id),
      // Admission details are loaded flat; ward/bed labels are optional and are
      // not required to retain the admission/discharge event in the ledger.
      supabase.from('admissions').select('*').eq('patient_id', patient.id),
      // Keep the source lab request in the ledger as a fallback for typed orders
      // and for legacy workflows that materialise lab_requests separately.
      supabase.from('lab_requests').select('*').eq('patient_id', patient.id),
      // Typed Pharmacy orders are stored in prescriptions and may also have a
      // linked snap_orders row. Load the source table flat and attach items below.
      supabase.from('prescriptions').select('*').eq('patient_id', patient.id),
      // Wallet/debt/credit movements are separate from the cumulative invoice paid_amount.
      // Load them so every financial movement is visible in the patient story.
      supabase.from('balance_transactions').select('*').eq('patient_id', patient.id),
      supabase.from('emergency_episodes').select('*').eq('patient_id', patient.id),
      supabase.from('emergency_episode_items').select('*'),
    ]);

    // The gateway intentionally supports flat SQL projections only. Recreate
    // the two one-to-many relations in memory so ledger consumers retain the
    // same shape they receive from Supabase.
    const invoiceRows = (invs.data ?? []) as any[];
    const invoiceIds = invoiceRows.map((invoice: any) => invoice.id).filter(Boolean);
    const prescriptionRows = (prescriptions.data ?? []) as any[];
    const prescriptionIds = prescriptionRows.map((prescription: any) => prescription.id).filter(Boolean);
    const [invoiceItemsResult, prescriptionItemsResult] = await Promise.all([
      invoiceIds.length
        ? supabase.from('invoice_items').select('*').in('invoice_id', invoiceIds)
        : Promise.resolve({ data: [] as any[] }),
      prescriptionIds.length
        ? supabase.from('prescription_items').select('*').in('prescription_id', prescriptionIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const invoiceItems = (invoiceItemsResult.data ?? []) as any[];
    const prescriptionItems = (prescriptionItemsResult.data ?? []) as any[];
    const invoicesWithItems = invoiceRows.map((invoice: any) => ({
      ...invoice,
      invoice_items: invoiceItems.filter((item: any) => String(item.invoice_id) === String(invoice.id)),
    }));
    const prescriptionsWithItems = prescriptionRows.map((prescription: any) => ({
      ...prescription,
      prescription_items: prescriptionItems.filter((item: any) => String(item.prescription_id) === String(prescription.id)),
    }));

    const byVisit = new Map<string, LedgerRow[]>();
    const push = (vid: string | null, row: LedgerRow) => {
      const key = vid ?? '__none__';
      if (!byVisit.has(key)) byVisit.set(key, []);
      byVisit.get(key)!.push(row);
    };

    // Vitals — compute deltas vs prior reading
    const vitalsSorted = [...(vt.data ?? [])].sort(
      (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    vitalsSorted.forEach((v: any, idx: number) => {
      const prev = idx > 0 ? vitalsSorted[idx - 1] : null;
      push(v.visit_id, {
        id: `vt-${v.id}`, visitId: v.visit_id, at: v.created_at, kind: 'vitals',
        station: 'nurse', title: 'Vitals & Intake', data: v,
        subkind: prev ? 'vitals_update' : 'vitals_first',
        changes: vitalsDeltas(v, prev),
      });
    });

    (att.data ?? []).forEach((a: any) => push(a.visit_id, {
      id: `att-${a.id}`, visitId: a.visit_id, at: a.captured_at ?? a.created_at,
      kind: 'attachment', station: a.station ?? 'other',
      title: a.label || `${a.station ?? 'Card'} photo`,
      data: {
        path: a.storage_path,
        bucket: 'attachment',
        mime_type: a.mime_type,
      },
      subkind: 'card_photo',
    }));

    const linkedLabRequestIds = new Set(
      (snaps.data ?? [])
        .map((s: any) => String(s.ocr_text ?? ''))
        .filter((text: string) => text.startsWith('LINKED_LAB_REQUEST:'))
        .map((text: string) => text.slice('LINKED_LAB_REQUEST:'.length)),
    );
    const linkedPrescriptionIds = new Set(
      (snaps.data ?? [])
        .map((s: any) => String(s.ocr_text ?? ''))
        .filter((text: string) => text.startsWith('LINKED_PRESCRIPTION:'))
        .map((text: string) => text.slice('LINKED_PRESCRIPTION:'.length)),
    );

    (snaps.data ?? []).forEach((s: any) => {
      const sub = classifySnap(s);
      const ledgerVisitId = visitIdForLedger(s.visit_id);
      push(ledgerVisitId, {
        id: `snap-${s.id}`, visitId: ledgerVisitId ?? '', at: s.created_at, kind: 'snap',
        station: s.source_role ?? 'clinical_team',
        title: SNAP_LABEL[sub] ?? (s.order_type ?? 'Snap'),
        data: s,
        subkind: sub,
      });
      // Emit a "dispense" event separately when the pharmacy has fulfilled it
      if (sub !== 'dispense' && s.status === 'fulfilled' && s.order_type === 'prescription') {
        push(ledgerVisitId, {
          id: `disp-${s.id}`, visitId: ledgerVisitId ?? '',
          at: s.updated_at ?? s.created_at, kind: 'snap',
          station: 'pharmacy', title: 'Dispensed', data: s, subkind: 'dispense',
        });
      }
    });

    const emergencyEpisodeRows = (emergencyEpisodes.data ?? []) as any[];
    const emergencyItemRows = (emergencyItems.data ?? []) as any[];
    emergencyEpisodeRows.forEach((episode: any) => {
      const ledgerVisitId = visitIdForLedger(episode.visit_id);
      const episodeKey = `order:emergency:${episode.id}`;
      const episodeItems = emergencyItemRows.filter((item: any) => String(item.episode_id) === String(episode.id));
      push(ledgerVisitId, {
        id: `emergency-episode-${episode.id}`,
        visitId: ledgerVisitId ?? '',
        at: episode.created_at,
        kind: 'snap',
        station: 'nurse',
        title: 'Emergency Episode',
        data: {
          id: episode.id,
          patient_id: episode.patient_id,
          visit_id: ledgerVisitId,
          invoice_id: episode.invoice_id ?? null,
          order_type: 'treatment',
          target_station: 'clinical_team',
          source_role: 'nurse',
          order_parent_id: episodeKey,
          ocr_text: `EMERGENCY_EPISODE:${episode.id}`,
          note: episode.notes || 'Urgent care recorded before billing',
          status: episode.status,
          matched_items: episodeItems.map((item: any) => ({ name: item.description, qty: item.quantity, unit_price: Number(item.unit_price || 0), category: item.item_type })),
        },
        subkind: 'emergency_episode',
      });
      emergencyItemRows.filter((item: any) => String(item.episode_id) === String(episode.id)).forEach((item: any) => {
        const itemVisitId = ledgerVisitId;
        const isLab = item.item_type === 'lab';
        const itemStatus = String(item.status || '');
        const itemTitle = isLab
          ? `${item.description} · ${itemStatus === 'completed' ? 'Result completed' : 'Emergency lab authorized'}`
          : `${item.description}${item.strength ? ` ${item.strength}` : ''} · ${item.administered_now ? 'Given now' : 'Pending pharmacy'}`;
        push(itemVisitId, {
          id: `emergency-item-${item.id}`,
          visitId: itemVisitId ?? '',
          at: item.administered_at ?? item.created_at,
          kind: 'snap',
          station: isLab ? 'lab' : 'nurse',
          title: itemTitle,
          data: {
            id: item.id,
            patient_id: episode.patient_id,
            visit_id: itemVisitId,
            order_parent_id: episodeKey,
            order_type: isLab ? 'lab' : 'prescription',
            target_station: isLab ? 'lab' : 'pharmacy',
            source_role: 'nurse',
            note: [item.route ? `Route: ${item.route}` : '', item.notes || '', item.administered_now ? 'Administered during emergency; do not re-dispense.' : 'Requires pharmacy dispensing after payment.'].filter(Boolean).join(' · '),
            status: itemStatus,
            matched_items: [{ name: item.description, qty: item.quantity, unit_price: Number(item.unit_price || 0), category: isLab ? 'lab' : 'drug' }],
          },
          subkind: isLab ? 'lab_request' : 'rx',
        });
        if (isLab && item.lab_request_id) {
          const lab = (labReqs.data ?? []).find((candidate: any) => String(candidate.id) === String(item.lab_request_id));
          if (lab?.status === 'completed' && lab.results != null) {
            const resultText = typeof lab.results === 'string' ? lab.results : JSON.stringify(lab.results, null, 2);
            push(itemVisitId, {
              id: `emergency-lab-result-${item.id}`,
              visitId: itemVisitId ?? '',
              at: lab.completed_at ?? lab.updated_at ?? item.updated_at ?? item.created_at,
              kind: 'snap', station: 'lab', title: 'Emergency Lab Result',
              data: { id: `emergency-lab-result-${item.id}`, patient_id: episode.patient_id, visit_id: itemVisitId, order_parent_id: episodeKey, order_type: 'lab_result', target_station: 'clinical_team', source_role: 'lab_tech', note: resultText, result_text: resultText, status: 'returned', matched_items: [] },
              subkind: 'lab_result',
            });
          }
        }
      });
      // Emergency invoice/order linkage is carried on the emitted row data and
      // resolved later by buildLinkedOrderGroups(), where its maps are scoped.
      // Do not write to that helper's local maps from this loader.
    });

    // Typed Pharmacy orders are written to prescriptions and normally also to
    // snap_orders. Keep the source order visible if a legacy or restricted snap
    // query does not return its linked row.
    prescriptionsWithItems.forEach((rx: any) => {
      if (linkedPrescriptionIds.has(String(rx.id))) return;
      const ledgerVisitId = visitIdForLedger(rx.visit_id);
      const items = Array.isArray(rx.prescription_items) ? rx.prescription_items : [];
      const itemText = items
        .map((item: any) => [
          item.medication,
          item.dosage && item.dosage !== '-' ? item.dosage : '',
          item.frequency && item.frequency !== '-' ? item.frequency : '',
          item.duration && item.duration !== '-' ? item.duration : '',
          item.quantity ? `×${item.quantity}` : '',
        ].filter(Boolean).join(' '))
        .filter(Boolean)
        .join('; ');
      const note = [rx.diagnosis ? `Diagnosis: ${rx.diagnosis}` : '', rx.notes || '', itemText]
        .filter(Boolean)
        .join(' · ');
      const rxStatus = ['fulfilled', 'dispensed', 'completed'].includes(String(rx.status).toLowerCase())
        ? 'fulfilled'
        : 'pending_billing';
      push(ledgerVisitId, {
        id: `rx-${rx.id}`,
        visitId: ledgerVisitId ?? '',
        at: rx.created_at,
        kind: 'snap',
          station: 'clinical_team',
          title: 'Prescription Order',
        data: {
          id: rx.id,
          patient_id: rx.patient_id,
          visit_id: ledgerVisitId,
          order_type: 'prescription',
          target_station: 'pharmacy',
          source_role: 'clinical_team',
          photo_path: null,
          note,
          ocr_text: `LINKED_PRESCRIPTION:${rx.id}`,
          intent: 'typed_order',
          status: rxStatus,
          matched_items: [],
        },
        subkind: rxStatus === 'fulfilled' ? 'dispense' : 'rx',
      });
    });

    // Typed lab requests are written to both lab_requests and snap_orders in one
    // transaction. The snap row is the primary visual event, while this fallback
    // keeps the order visible if the link is absent or a legacy row has no snap.
    (labReqs.data ?? []).forEach((lab: any) => {
      const ledgerVisitId = visitIdForLedger(lab.visit_id);
      const linkedParent = (snaps.data ?? []).find((snap: any) => snap.ocr_text === `LINKED_LAB_REQUEST:${lab.id}`);
      const isLinked = linkedLabRequestIds.has(String(lab.id));
      const tests = Array.isArray(lab.tests) ? lab.tests.filter(Boolean) : [];
      const note = [
        lab.diagnosis ? `Diagnosis: ${lab.diagnosis}` : '',
        tests.length ? tests.join(', ') : '',
      ].filter(Boolean).join(' · ');

      if (!isLinked) {
        push(ledgerVisitId, {
          id: `lab-${lab.id}`,
          visitId: ledgerVisitId ?? '',
          at: lab.requested_at ?? lab.created_at,
          kind: 'snap',
          station: 'nurse',
          title: 'Lab Request',
          data: {
            id: lab.id,
            patient_id: lab.patient_id,
            visit_id: ledgerVisitId,
            order_type: 'lab',
            target_station: 'lab',
            source_role: 'nurse',
            photo_path: null,
            note,
            ocr_text: `LINKED_LAB_REQUEST:${lab.id}`,
            intent: 'typed_order',
            status: lab.status === 'completed' ? 'fulfilled' : 'pending_billing',
            matched_items: [],
          },
          subkind: 'lab_request',
        });
      }

      const hasResult = lab.status === 'completed' && lab.results != null;
      if (hasResult) {
        const resultText = typeof lab.results === 'string' ? lab.results : JSON.stringify(lab.results, null, 2);
        push(ledgerVisitId, {
          id: `lab-result-${lab.id}`,
          visitId: ledgerVisitId ?? '',
          at: lab.completed_at ?? lab.updated_at ?? lab.created_at,
          kind: 'snap',
          station: 'lab',
          title: 'Lab Result',
          data: {
            id: `lab-result-${lab.id}`,
            patient_id: lab.patient_id,
            visit_id: ledgerVisitId,
            order_type: 'lab_result',
            target_station: 'clinical_team',
            source_role: 'lab_tech',
            parent_snap_id: linkedParent?.id ?? null,
            order_parent_id: linkedParent ? null : lab.id,
            photo_path: null,
            note: resultText,
            result_text: resultText,
            status: 'returned',
            matched_items: [],
          },
          subkind: 'lab_result',
        });
      }
    });

    invoicesWithItems.forEach((i: any) => {
      const paid = Number(i.paid_amount ?? 0);
      const total = Number(i.total_amount ?? 0);
      const invSub = paid <= 0 ? 'invoice_new' : paid < total ? 'invoice_partial' : 'invoice_paid';
      
      // Automatically exclude unavailable medication items from the ledger/claim totals
      // ensuring only eligible amounts are reclaimed or credited.
      // Sponsored patients (Insurance/Corporate/Retainer) see these items removed from claim.
      const activeItems = (i.invoice_items ?? []).filter((it: any) => 
        it.dispensing_status !== 'unavailable' && it.dispensing_status !== 'refund_requested' && it.dispensing_status !== 'refund_pending' && it.dispensing_status !== 'not_given' && it.dispensing_status !== 'refunded'
      );
      
      const displayTotal = activeItems.reduce((s: number, it: any) => s + Number(it.total || 0), 0);

      const ledgerVisitId = visitIdForLedger(i.visit_id);
      push(ledgerVisitId, {
        id: `inv-${i.id}`, visitId: ledgerVisitId ?? '', at: i.created_at, kind: 'invoice',
        station: 'billing', title: `Invoice ${i.invoice_number}`, data: { ...i, items: activeItems, displayTotal }, subkind: invSub,
      });

      if (paid > 0 || ['paid', 'settled'].includes(String(i.status).toLowerCase())) push(ledgerVisitId, {
        id: `pay-${i.id}`, visitId: ledgerVisitId ?? '', at: i.paid_at ?? i.updated_at ?? i.created_at,
        kind: 'payment', station: 'cashier',
        title: paid >= total ? 'Receipt · Paid in Full' : paid > 0 ? 'Receipt · Part Payment' : 'Settlement · No Cash Collected',
        data: { invoice_id: i.id, amount: paid, method: i.payment_method, ref: i.invoice_number, total },
        subkind: paid >= total ? 'receipt_full' : 'receipt_partial',
      });
      
      // Add refund/unavailable events
      (i.invoice_items ?? []).filter((it: any) => ['refunded', 'unavailable', 'refund_requested', 'refund_pending', 'not_given'].includes(it.dispensing_status)).forEach((it: any) => {
        const isRefunded = it.dispensing_status === 'refunded';
        const isPending = ['unavailable', 'refund_requested', 'refund_pending', 'not_given'].includes(it.dispensing_status);
        
        push(ledgerVisitId, {
          id: `ref-${it.id}`, visitId: ledgerVisitId ?? '', at: it.dispensing_updated_at ?? i.updated_at,
          kind: 'payment', station: 'cashier',
          title: isRefunded ? `Refunded · ${it.description}` : `Not Given · ${it.description}`,
          data: { 
            invoice_id: i.id,
            amount: Number(it.total), 
            method: isRefunded ? 'refund' : 'pending_refund', 
            ref: i.invoice_number, 
            total: Number(it.total),
            status: it.dispensing_status,
            notes: it.dispensing_notes
          },
          subkind: isRefunded ? 'receipt_full' : 'receipt_partial',
        });
      });
    });


    // Balance transactions provide event-level financial history that invoices alone cannot show.
    // A settlement can consume wallet credit, create debt, issue overpayment credit, or refund money
    // while the invoice's paid_amount remains cumulative.
    const invoiceById = new Map(invoicesWithItems.map((invoice: any) => [String(invoice.id), invoice]));
    (balanceTxs.data ?? []).forEach((tx: any) => {
      const delta = Number(tx.amount ?? 0);
      const absoluteAmount = Math.abs(delta);
      const transactionType = String(tx.transaction_type ?? '').toLowerCase();
      const relatedInvoice = tx.related_invoice_id ? invoiceById.get(String(tx.related_invoice_id)) : null;
      const invoiceRef = relatedInvoice?.invoice_number ?? tx.related_invoice_id ?? tx.id;
      const positive = delta >= 0;
      const title = transactionType === 'debt_incurred'
        ? `Debt Recorded · ${naira(absoluteAmount)}`
        : transactionType === 'overpayment_credit'
        ? `Wallet Credit · ${naira(absoluteAmount)}`
        : transactionType === 'topup'
        ? `Wallet Top-up · ${naira(absoluteAmount)}`
        : transactionType === 'refund'
        ? `Refund to Wallet · ${naira(absoluteAmount)}`
        : transactionType === 'admitted_deduction'
        ? `Admitted Charge · ${naira(absoluteAmount)}`
        : transactionType === 'invoice_deduction'
        ? `Wallet Applied · ${naira(absoluteAmount)}`
        : `Balance Update · ${naira(absoluteAmount)}`;
      const subkind = transactionType === 'debt_incurred'
        ? 'debt_recorded'
        : positive ? 'wallet_credit' : 'wallet_debit';
      const ledgerVisitId = relatedInvoice?.visit_id ?? fallbackVisitId;
      push(ledgerVisitId, {
        id: `balance-${tx.id}`,
        visitId: ledgerVisitId ?? '',
        at: tx.created_at ?? tx.updated_at ?? new Date().toISOString(),
        kind: 'payment',
        station: relatedInvoice ? 'cashier' : 'admin',
        title,
        actor: tx.performed_by ?? null,
        data: {
          ...tx,
          amount: absoluteAmount,
          delta,
          direction: positive ? 'credit' : 'debit',
          method: tx.payment_method,
          ref: invoiceRef,
          total: relatedInvoice?.total_amount,
        },
        subkind,
      });
    });

    (adms.data ?? []).forEach((a: any) => {
      const vid = a.visit_id ?? vs.find(v => v.status === 'open')?.id ?? vs[0]?.id ?? null;
      push(vid, {
        id: `adm-${a.id}`, visitId: vid ?? '', at: a.admitted_at ?? a.created_at, kind: 'admission',
        station: 'nurse',
        title: `Admitted · ${a.wards?.name ?? 'Ward'}${a.beds?.bed_number ? ` · Bed ${a.beds.bed_number}` : ''}`,
        data: a, subkind: 'admission',
      });
      if (a.discharged_at) push(vid, {
        id: `dis-${a.id}`, visitId: vid ?? '', at: a.discharged_at, kind: 'discharge',
        station: 'nurse', title: 'Discharged', data: a, subkind: 'discharge',
      });
    });

    const built: LedgerVisit[] = vs.map(v => {
      const rows = (byVisit.get(v.id) ?? []).sort(
        (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
      );
      // Mark rows added in the last 20s as "new" to highlight recent changes
      const now = Date.now();
      rows.forEach(r => {
        if (now - new Date(r.at).getTime() < 20_000) r.isNew = true;
      });
      return { visit: v, rows };
    });

    const orphaned = (byVisit.get('__none__') ?? []).sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
    );
    setUnassignedRows(orphaned);
    setVisits(built);
    setLoadError(null);
    setLoading(false);
  }, [patient.id]);

  useEffect(() => {
    let active = true;
    void load(true).catch((error: any) => {
      if (!active) return;
      console.error('Patient ledger card load failed', error);
      setLoadError(error?.message || 'The patient ledger could not be loaded. Please retry.');
      setLoading(false);
    });
    // Preload staff display names so the Date/Staff lanes can show who created
    // each order. Unreadable roles silently fall back to the event's own label.
    void preloadStaffNames().then(() => {
      if (active) setStaffTick(tick => tick + 1);
    });
    return () => { active = false; };
  }, [load]);

  // Realtime — refresh on any change to related tables for this patient/visits
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        void load(false).catch((error: any) => console.error('Patient ledger refresh failed', error));
      }, 250);
    };

    const patientFilter = `patient_id=eq.${patient.id}`;
    const ch = createRealtimeChannel(`ledger-${patient.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'snap_orders', filter: patientFilter }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lab_requests', filter: patientFilter }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prescriptions', filter: patientFilter }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prescription_items' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visits', filter: patientFilter }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admissions', filter: patientFilter }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices', filter: patientFilter }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vitals', filter: patientFilter }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visit_attachments', filter: patientFilter }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoice_items' }, () => bump())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'balance_transactions', filter: patientFilter }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emergency_episodes', filter: patientFilter }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emergency_episode_items' }, bump)
      .subscribe();

    // CockroachDB uses a no-op realtime adapter. Poll while the card is open so
    // actions from another workspace appear without requiring a manual refresh.
    const poll = window.setInterval(() => load(false), 3_000);
    return () => {
      if (debounce) clearTimeout(debounce);
      window.clearInterval(poll);
      supabase.removeChannel(ch);
    };
  }, [patient.id, load]);


  // Signed URLs for thumbs
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const paths: { path: string; kind: 'snap' | 'att' }[] = [];
      visits.forEach(v => v.rows.forEach(r => {
        if (r.kind === 'snap' && r.data?.photo_path && !thumbs[r.data.photo_path])
          paths.push({ path: r.data.photo_path, kind: 'snap' });
        if (r.kind === 'attachment' && r.data?.path && !r.data?.mime_type?.startsWith('text/') && !thumbs[r.data.path])
          paths.push({ path: r.data.path, kind: 'att' });
      }));
      const uniq = Array.from(new Map(paths.map(p => [p.path, p])).values());
      const res = await Promise.all(uniq.map(async p => [p.path, await (p.kind === 'snap' ? snapPhotoUrl(p.path) : signedUrl(p.path))] as const));
      if (!cancelled) {
        setThumbs(prev => {
          const next = { ...prev };
          for (const [p, u] of res) if (u) next[p] = u;
          return next;
        });
      }
    })();
    return () => { cancelled = true; };
  }, [visits]); // eslint-disable-line

  // Typed Snap-to-Card reviews are stored as plain text files in the same
  // visit-card bucket. Load their exact contents for the patient narrative.
  useEffect(() => {
    let cancelled = false;
    const textRows = visits
      .flatMap(v => v.rows)
      .filter(r => r.kind === 'attachment' && r.data?.mime_type?.startsWith('text/') && r.data?.path && !attachmentText[r.data.path]);
    if (textRows.length === 0) return;
    (async () => {
      const pairs = await Promise.all(textRows.map(async row => {
        const path = row.data.path as string;
        const url = await signedUrl(path);
        if (!url) return null;
        try {
          const response = await fetch(url);
          if (!response.ok) return null;
          return [path, await response.text()] as const;
        } catch {
          return null;
        }
      }));
      if (!cancelled) {
        setAttachmentText(prev => {
          const next = { ...prev };
          pairs.forEach(pair => { if (pair) next[pair[0]] = pair[1]; });
          return next;
        });
      }
    })();
    return () => { cancelled = true; };
  }, [visits, attachmentText]);

  const outstanding = Number(patient.balance ?? 0);
  const showWallet = hasWallet(patient);

  return (
    <div className="w-full">
      <div className="max-w-5xl mx-auto bg-[hsl(var(--card))] border-2 border-border shadow-[8px_8px_0_0_hsl(var(--border)/0.4)] rounded-sm overflow-hidden">
        {/* Patient Header */}
        <div className="p-4 md:p-6 border-b-4 border-double border-border flex flex-col md:flex-row justify-between items-start gap-4 bg-background">
          <div className="space-y-3 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <PatientPhotoAvatar patient={patient} size={48} className="rounded-2xl" />
              <div>
                <h1 className="text-xl md:text-2xl font-bold tracking-tight uppercase">
                  {patient.first_name} {patient.last_name}
                </h1>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="px-2 py-0.5 bg-primary/10 text-primary border border-primary/30 text-[10px] font-bold uppercase tracking-widest rounded">
                    {patient.status?.replace(/_/g, ' ')}
                  </span>
                  <span className="px-2 py-0.5 bg-muted border border-border text-[10px] font-bold uppercase tracking-widest rounded capitalize">
                    {patient.account_type?.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip mono>ID: {patient.card_number}</Chip>
              {patient.date_of_birth && (
                <Chip icon={<Calendar className="h-3 w-3" />}>
                  DOB: {format(new Date(patient.date_of_birth), 'dd-MMM-yyyy')}
                  {age !== null && ` · ${age}Y`}
                </Chip>
              )}
              {patient.blood_group && (
                <Chip icon={<Droplet className="h-3 w-3 text-destructive" />}>
                  BLOOD: {patient.blood_group}
                </Chip>
              )}
              {patient.phone && (
                <Chip icon={<Phone className="h-3 w-3" />}>{patient.phone}</Chip>
              )}
              {(() => {
                const isInsurance = ['nhis', 'hmo', 'katchma'].includes(patient.account_type as string);
                if (!isInsurance) return null;
                const provider = (patient.insurance_provider || '').trim();
                const memberData = ((patient as any).member_id_data || {}) as Record<string, string>;
                const memberEntries = Object.entries(memberData).filter(
                  ([k, v]) => k !== 'provider_name' && (v ?? '').toString().trim() !== '',
                );
                const fallbackId =
                  (patient as any).enrollee_id || patient.insurance_policy_number || '';
                return (
                  <>
                    {provider && (
                      <Chip icon={<ShieldCheck className="h-3 w-3 text-primary" />}>
                        {provider}
                      </Chip>
                    )}
                    {memberEntries.length > 0
                      ? memberEntries.map(([k, v]) => (
                          <Chip key={k} mono>
                            {k.replace(/_/g, ' ').toUpperCase()}: {v}
                          </Chip>
                        ))
                      : fallbackId && <Chip mono>ID: {fallbackId}</Chip>}
                  </>
                );
              })()}
            </div>
          </div>
          <div className="text-right flex items-start gap-3">
            <div>
              {showWallet ? (
                <>
                  <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-1 justify-end">
                    <Wallet className="h-3 w-3" /> Account Balance
                  </div>
                  <div className={`text-2xl md:text-3xl font-bold font-mono ${outstanding < 0 ? 'text-destructive' : 'text-foreground'}`}>
                    ₦{outstanding.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-medium">
                    Updated {format(new Date(), 'dd MMM yyyy')}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-1 justify-end">
                    Sponsor
                  </div>
                  <div className="text-lg md:text-xl font-bold text-primary">
                    {sponsorLabel(patient)}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-medium">
                    Settled via sponsor · no wallet
                  </div>
                </>
              )}
            </div>
            {onClose && (
              <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Ledger body */}
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading card…
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <p className="text-sm text-destructive">{loadError}</p>
            <Button variant="outline" size="sm" onClick={() => {
              setLoadError(null);
              setLoading(true);
              void load(true).catch((error: any) => {
                console.error('Patient ledger retry failed', error);
                setLoadError(error?.message || 'The patient ledger could not be loaded. Please retry.');
                setLoading(false);
              });
            }}>Retry loading card</Button>
          </div>
        ) : visits.length === 0 && unassignedRows.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground text-sm">
            No visits yet — the card will fill as the patient moves through the hospital.
          </div>
        ) : (
          <div>
            <LatestVitalsPanel visits={visits} />
            {unassignedRows.length > 0 && (() => {
              const filteredUnassigned = stationFilter.size === 0
                ? unassignedRows
                : unassignedRows.filter(row => stationFilter.has(row.station));
              if (filteredUnassigned.length === 0) return null;
              return (
                <div className="border-b-2 border-border">
                  <div className="bg-slate-900 text-white p-3 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Clinical events</div>
                      <div className="text-xs text-slate-100">Patient-level orders awaiting visit linkage</div>
                    </div>
                    <span className="text-[10px] font-mono text-slate-300">{filteredUnassigned.length} event{filteredUnassigned.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="divide-y divide-border">
                    <NarrativeLedgerRows
                      rows={filteredUnassigned}
                      thumbs={thumbs}
                      attachmentText={attachmentText}
                      onOpenImage={setLightbox}
                      patient={patient}
                    />
                  </div>
                </div>
              );
            })()}
            <StationFilterBar
              visits={visits}
              selected={stationFilter}
              onToggle={(s) => setStationFilter(prev => {
                const next = new Set(prev);
                if (s === '__all__') return new Set();
                next.has(s) ? next.delete(s) : next.add(s);
                return next;
              })}
            />
            {visits.map((lv, vi) => {
              const isCollapsed = collapsed[lv.visit.id];
              const filteredRows = stationFilter.size === 0
                ? lv.rows
                : lv.rows.filter(r => stationFilter.has(r.station));
              if (stationFilter.size > 0 && filteredRows.length === 0) return null;
              return (
                <div key={lv.visit.id}>
                  {/* Visit divider */}
                  <div className="bg-slate-900 text-white flex items-stretch">
                    <div className="w-24 md:w-32 shrink-0 p-3 border-r border-slate-700 text-center">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Visit</div>
                      <div className="text-sm font-mono font-bold">#{vi + 1}</div>
                    </div>
                    <div className="flex-1 p-3 flex items-center justify-between gap-2 flex-wrap">
                      <div className="text-xs md:text-sm font-medium uppercase tracking-wide">
                        <span className="font-mono">{lv.visit.visit_number}</span>
                        <span className="text-slate-500 mx-2">|</span>
                        {format(new Date(lv.visit.opened_at), 'dd MMM yyyy · HH:mm')}
                        {lv.visit.closed_at && (
                          <>
                            <span className="text-slate-500 mx-2">→</span>
                            {format(new Date(lv.visit.closed_at), 'dd MMM · HH:mm')}
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <LastActivityBadge rows={lv.rows} />
                        <span className="text-[10px] font-mono text-slate-300 uppercase">
                          {lv.visit.status} · Charged {naira(lv.visit.total_charged)}
                        </span>

                        {lv.visit.closed_at && (
                          <Button
                            variant="ghost" size="sm"
                            className="h-6 text-amber-300 hover:text-white hover:bg-slate-800"
                            title="Download Discharge Summary PDF"
                            onClick={async () => {
                              try {
                                await downloadDischargeSummaryPdf(lv.visit);
                                toast({ title: 'Discharge summary downloaded', description: lv.visit.visit_number });
                              } catch (e) {
                                toast({ title: 'PDF failed', description: (e as Error).message, variant: 'destructive' });
                              }
                            }}
                          >
                            <Download className="h-3.5 w-3.5 mr-1" />
                            <span className="text-[10px] uppercase tracking-wider">Summary</span>
                          </Button>
                        )}

                        <Button
                          variant="ghost" size="sm"
                          className="h-6 text-slate-300 hover:text-white hover:bg-slate-800"
                          onClick={() => setCollapsed(c => ({ ...c, [lv.visit.id]: !c[lv.visit.id] }))}
                        >
                          {isCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <ClaimActionsBar visit={lv.visit} patient={patient} />

                  {/* Rows */}
                  {!isCollapsed && (
                    <div className="divide-y divide-border">
                      {filteredRows.length === 0 && (
                        <div className="px-4 py-6 text-center text-xs text-muted-foreground italic">
                          {stationFilter.size > 0 ? 'No matching events for the selected stations.' : 'No events recorded for this visit yet.'}
                        </div>
                      )}
                      {filteredRows.length > 0 && (
                        <NarrativeLedgerRows
                          rows={filteredRows}
                          thumbs={thumbs}
                          attachmentText={attachmentText}
                          onOpenImage={setLightbox}
                          patient={patient}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}

          </div>
        )}

        {/* Footer */}
        <div className="bg-muted/40 p-3 border-t-2 border-border flex justify-between items-center">
          <div className="text-[10px] font-bold tracking-[0.2em] text-muted-foreground uppercase italic">
            Patient Ledger · KMC Hospital
          </div>
          <div className="text-[10px] font-mono text-muted-foreground">
            CONFIDENTIAL · {patient.card_number}
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="preview" className="max-h-full max-w-full rounded shadow-2xl" />
          <Button
            variant="secondary" size="icon"
            className="absolute top-4 right-4"
            onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------- helpers ----------
function Chip({ children, mono, icon }: { children: React.ReactNode; mono?: boolean; icon?: React.ReactNode }) {
  return (
    <div className={`px-2 py-1 bg-muted/60 border border-border text-[10px] text-foreground font-medium flex items-center gap-1 ${mono ? 'font-mono font-bold' : ''}`}>
      {icon}{children}
    </div>
  );
}

const FILTER_STATIONS = ['nurse', 'clinical_team', 'lab', 'pharmacy', 'billing', 'cashier'] as const;

function StationFilterBar({
  visits, selected, onToggle,
}: {
  visits: LedgerVisit[];
  selected: Set<string>;
  onToggle: (station: string) => void;
}) {
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    visits.forEach(v => v.rows.forEach(r => { c[r.station] = (c[r.station] ?? 0) + 1; }));
    return c;
  }, [visits]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const active = selected.size > 0;

  return (
    <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mr-1">
        Filter
      </span>
      <button
        onClick={() => onToggle('__all__')}
        className={`px-2 py-1 text-[10px] font-bold uppercase tracking-tight rounded border transition ${
          !active
            ? 'bg-foreground text-background border-foreground'
            : 'bg-background text-foreground border-border hover:bg-muted'
        }`}
      >
        All · {total}
      </button>
      {FILTER_STATIONS.map(s => {
        const isOn = selected.has(s);
        const count = counts[s] ?? 0;
        const tone = STATION_TONE[s] ?? STATION_TONE.admin;
        return (
          <button
            key={s}
            onClick={() => onToggle(s)}
            disabled={count === 0 && !isOn}
            className={`px-2 py-1 text-[10px] font-bold uppercase tracking-tight rounded border capitalize transition ${
              isOn ? tone + ' ring-2 ring-offset-1 ring-current' : 'bg-background text-muted-foreground border-border hover:bg-muted'
            } ${count === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {s} · {count}
          </button>
        );
      })}
    </div>
  );
}


function LastActivityBadge({ rows }: { rows: LedgerRow[] }) {
  const last = rows.length ? rows[rows.length - 1] : null;
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force(n => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!last) return null;
  const ageMs = Date.now() - new Date(last.at).getTime();
  const fresh = ageMs < 60_000;
  const tone = STATION_TONE[last.station] ?? STATION_TONE.admin;
  const rel = ageMs < 60_000
    ? 'just now'
    : ageMs < 3_600_000
    ? `${Math.floor(ageMs / 60_000)}m ago`
    : ageMs < 86_400_000
    ? `${Math.floor(ageMs / 3_600_000)}h ago`
    : `${Math.floor(ageMs / 86_400_000)}d ago`;
  return (
    <div className={`flex items-center gap-1.5 px-2 py-0.5 border rounded text-[10px] font-bold uppercase tracking-tight ${tone}`}>
      <span className="relative flex h-2 w-2">
        {fresh && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-60" />
        )}
        <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
      </span>
      <span className="capitalize">{last.station}</span>
      <span className="opacity-70 font-mono normal-case font-medium">· {rel}</span>
    </div>
  );
}


function LedgerRowView({
  row, thumbs, attachmentText, onOpenImage,
  patient, nestedOrder = false,
}: {
  row: LedgerRow;
  thumbs: Record<string, string>;
  attachmentText: Record<string, string>;
  onOpenImage: (url: string) => void;
  patient: Patient;
  nestedOrder?: boolean;
}) {
  const tone = STATION_TONE[row.station] ?? STATION_TONE.admin;
  const subTone = row.subkind ? SUB_TONE[row.subkind] : null;
  const SubIcon = row.subkind ? SUB_ICON[row.subkind] ?? Sparkles : null;
  const subLabel = row.subkind ? SNAP_LABEL[row.subkind] : null;

  return (
    <div className={`flex transition-colors ${row.isNew ? 'bg-primary/5 animate-in fade-in' : ''}`}>
      {/* Date cell */}
      <div className={`w-24 md:w-32 shrink-0 p-3 md:p-4 border-r border-border text-center ${nestedOrder ? 'bg-background/70' : 'bg-muted/40'}`}>
        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
          {format(new Date(row.at), 'dd MMM')}
        </div>
        <div className="text-sm md:text-lg font-mono font-bold text-foreground">
          {format(new Date(row.at), 'HH:mm')}
        </div>
        {!nestedOrder && (
          <div className={`mt-2 text-[9px] px-1.5 py-0.5 rounded border capitalize font-bold uppercase tracking-tight ${tone}`}>
            {row.station}
          </div>
        )}
      </div>

      {/* Content cell */}
      <div className={`flex-1 p-3 md:p-4 min-w-0 ${nestedOrder ? 'bg-background' : ''}`}>
        <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            {SubIcon && subTone && (
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase tracking-tight ${subTone}`}>
                <SubIcon className="h-3 w-3" />
                {subLabel}
              </span>
            )}
            <span className="text-xs font-bold uppercase tracking-widest">{row.title}</span>
            {row.isNew && (
              <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-primary text-primary-foreground animate-pulse">
                New
              </span>
            )}
          </div>
          {row.actor && <span className="text-[10px] text-muted-foreground">by {row.actor}</span>}
        </div>

        {row.changes && row.changes.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {row.changes.map((c, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-800 text-[10px] font-mono"
              >
                {c.dir === 'up' && <ArrowUp className="h-3 w-3" />}
                {c.dir === 'down' && <ArrowDown className="h-3 w-3" />}
                <span className="font-bold uppercase">{c.label}</span>
                <span className="opacity-60">{c.from}</span>
                <span>→</span>
                <span className="font-bold">{c.to}</span>
              </span>
            ))}
          </div>
        )}

        {row.kind === 'vitals' && <VitalsRow v={row.data} />}
        {row.kind === 'attachment' && row.data?.mime_type?.startsWith('text/') ? (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4">
            <div className="flex items-center gap-2 text-indigo-700 mb-2">
              <FileText className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-wide">Typed card review</span>
            </div>
            <p className="text-sm whitespace-pre-wrap leading-relaxed text-foreground">
              {attachmentText[row.data?.path] ?? 'Loading review…'}
            </p>
          </div>
        ) : row.kind === 'attachment' ? (
          <SnapPhoto url={thumbs[row.data?.path]} label={row.title} onOpen={onOpenImage} />
        ) : null}
        {row.kind === 'snap' && (
          <SnapRow snap={row.data} thumb={thumbs[row.data?.photo_path]} onOpen={onOpenImage} />
        )}
        {row.kind === 'invoice' && <InvoiceRow inv={row.data} patient={patient} />}
        {row.kind === 'payment' && (
          <div className="text-sm">
            {row.data.transaction_type ? (
              <>
                <span className={`font-bold font-mono ${Number(row.data.delta ?? 0) >= 0 ? 'text-emerald-600' : 'text-orange-600'}`}>
                  {Number(row.data.delta ?? 0) >= 0 ? '+' : '-'}{naira(Math.abs(Number(row.data.delta ?? 0)))}
                </span>{' '}
                <span className="text-muted-foreground">
                  {String(row.data.transaction_type).replace(/_/g, ' ')} · {row.data.ref}
                  {row.data.balance_after != null ? ` · balance ${naira(Number(row.data.balance_after))}` : ''}
                </span>
                {row.data.notes && (
                  <div className="mt-1 text-xs text-muted-foreground italic">{row.data.notes}</div>
                )}
              </>
            ) : row.data.method === 'sponsor_claim' ? (
              <>
                <span className="font-bold font-mono text-indigo-600">
                  Sponsor claim · {naira(row.data.amount)}
                </span>{' '}
                <span className="text-muted-foreground">
                  posted to Claims queue · {row.data.ref}
                </span>
              </>
            ) : (
              <>
                <span className="font-bold font-mono text-emerald-600">+{naira(row.data.amount)}</span>{' '}
                <span className="text-muted-foreground">
                  via {row.data.method ?? 'cash'} · {row.data.ref}
                  {row.data.total ? ` · of ${naira(row.data.total)}` : ''}
                </span>
              </>
            )}
          </div>
        )}
        {row.kind === 'admission' && (
          <div className="text-sm italic">{row.title}</div>
        )}
        {row.kind === 'discharge' && (
          <div className="text-sm font-bold text-emerald-700">Discharged from ward</div>
        )}
      </div>
    </div>
  );
}

function VitalsRow({ v }: { v: any }) {
  const items = [
    v.blood_pressure && ['BP', v.blood_pressure, 'mmHg'],
    v.temperature != null && ['Temp', v.temperature, '°C'],
    v.pulse != null && ['Pulse', v.pulse, 'bpm'],
    v.spo2 != null && ['SpO₂', v.spo2, '%'],
    v.weight != null && ['Weight', v.weight, 'kg'],
    v.respiratory_rate != null && ['RR', v.respiratory_rate, '/min'],
  ].filter(Boolean) as [string, string | number, string][];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {items.map(([k, val, u]) => (
        <div key={k} className="border-l-2 border-blue-400 pl-3 py-1">
          <div className="text-[10px] text-muted-foreground uppercase">{k}</div>
          <div className="text-sm font-bold font-mono">{val} <span className="text-[10px] font-normal text-muted-foreground italic">{u}</span></div>
        </div>
      ))}
    </div>
  );
}

function LatestVitalsPanel({ visits }: { visits: LedgerVisit[] }) {
  const latest = useMemo(() => {
    let best: { v: any; at: string; visitNo: number } | null = null;
    visits.forEach((lv, idx) => {
      lv.rows.forEach(r => {
        if (r.kind !== 'vitals') return;
        if (!best || new Date(r.at).getTime() > new Date(best.at).getTime()) {
          best = { v: r.data, at: r.at, visitNo: visits.length - idx };
        }
      });
    });
    return best;
  }, [visits]);

  if (!latest) return null;

  return (
    <div className="px-4 py-3 border-b-2 border-border bg-teal-50/50">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-teal-700" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-teal-900">
            Latest Vitals
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">
            · {format(new Date(latest.at), 'dd MMM · HH:mm')}
          </span>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Replaces on next reading
        </span>
      </div>
      <VitalsRow v={latest.v} />
    </div>
  );
}

function SnapPhoto({ url, label, onOpen }: { url?: string; label: string; onOpen: (u: string) => void }) {
  return (
    <div
      className="relative group w-28 h-28 border-2 border-dashed border-border rounded flex items-center justify-center bg-background overflow-hidden cursor-pointer hover:border-primary transition-colors"
      onClick={() => url && onOpen(url)}
    >
      {url ? (
        <img src={url} alt={label} className="w-full h-full object-cover" />
      ) : (
        <span className="text-[10px] font-bold text-muted-foreground uppercase text-center px-2">{label}</span>
      )}
    </div>
  );
}

function SnapRow({ snap, thumb, onOpen }: { snap: any; thumb?: string; onOpen: (u: string) => void }) {
  const [linkedData, setLinkedData] = useState<any>(null);
  const status = snap.status as string;
  const statusTone =
    status === 'fulfilled' || status === 'paid' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
    status === 'rejected' ? 'bg-red-100 text-red-700 border-red-200' :
    status === 'awaiting_payment' ? 'bg-amber-100 text-amber-700 border-amber-200' :
    'bg-slate-100 text-slate-700 border-slate-200';

  useEffect(() => {
    if (!snap.ocr_text) return;
    const fetchLinked = async () => {
      if (snap.ocr_text?.startsWith('LINKED_PRESCRIPTION:')) {
        const id = snap.ocr_text.split(':')[1];
        const { data } = await supabase.from('prescriptions').select('*, prescription_items(*)').eq('id', id).single();
        if (data) setLinkedData({ type: 'rx', items: data.prescription_items });
      } else if (snap.ocr_text?.startsWith('LINKED_LAB_REQUEST:')) {
        const id = snap.ocr_text.split(':')[1];
        const { data } = await supabase.from('lab_requests').select('*').eq('id', id).single();
        if (data) setLinkedData({ type: 'lab', items: data.tests.map((t: string) => ({ test_name: t })) });
      }
    };
    fetchLinked();
  }, [snap.ocr_text, snap.note]);

  const isTyped = snap.intent === 'typed_order' || snap.ocr_text?.startsWith('LINKED_');

  return (
    <div className="flex gap-3">
      {isTyped ? (
        <div className="w-28 h-28 border-2 border-dashed border-primary/30 rounded flex flex-col items-center justify-center bg-primary/5 text-primary text-center p-2 shrink-0">
          <Sparkles className="h-6 w-6 mb-1 opacity-50" />
          <span className="text-[10px] font-bold uppercase leading-tight">Typed<br/>Order</span>
        </div>
      ) : (
        <SnapPhoto url={thumb} label={snap.order_type} onOpen={onOpen} />
      )}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold uppercase ${statusTone}`}>
            {status?.replace(/_/g, ' ')}
          </span>
          <span className="text-[10px] text-muted-foreground uppercase font-bold">→ {snap.target_station}</span>
        </div>
        {snap.note && !isTyped && <p className="text-xs text-foreground italic">"{snap.note}"</p>}
        
        {/* Linked items or notes for typed orders */}
        {linkedData?.items && (
          <div className="mt-1">
            {linkedData.items.length === 1 && (linkedData.items[0].medication_name === 'Typed Prescription (See Notes)' || linkedData.items[0].test_name === snap.note || linkedData.items[0].test_name === snap.note?.replace('Typed Lab Order: ', '')) ? (
              <div className="text-[11px] text-foreground font-medium whitespace-pre-wrap font-mono bg-muted/30 p-2 rounded border border-border/50">
                {snap.note}
              </div>
            ) : (
              <ul className="text-[11px] text-foreground font-medium list-none space-y-1">
                {linkedData.items.map((it: any, i: number) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="text-primary mt-0.5">•</span>
                    <span>
                      {it.medication_name || it.test_name}
                      {it.dosage && it.dosage !== '-' && <span className="text-muted-foreground ml-1">({it.dosage} {it.frequency} × {it.duration})</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Matched items from pricelist (when billed/dispensed) */}
        {Array.isArray(snap.matched_items) && snap.matched_items.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <div className="text-[9px] font-bold uppercase text-muted-foreground mb-1">Billed Items</div>
            <ul className="text-[11px] text-muted-foreground list-disc pl-4">
              {snap.matched_items.slice(0, 4).map((m: any, i: number) => (
                <li key={i}>{m.name} × {m.qty} — {naira(m.unit_price * m.qty)}</li>
              ))}
              {snap.matched_items.length > 4 && <li>+{snap.matched_items.length - 4} more…</li>}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function InvoiceRow({ inv, patient }: { inv: any; patient: Patient }) {
  const items = (inv.invoice_items ?? []) as any[];
  const total = Number(inv.total_amount ?? 0);
  const paid = Number(inv.paid_amount ?? 0);
  const sponsored = isSponsored(patient);
  const split = splitInvoice(total, patient);
  const claimPosted = sponsored && paid >= total; // sponsor_claim payment closed it
  const copayCollected = sponsored ? Math.min(paid, split.copayAmount) : 0;
  const copayDue = sponsored ? Math.max(split.copayAmount - copayCollected, 0) : 0;
  const { hasRole } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [submittedAt, setSubmittedAt] = useState<string | null>(inv.claim_submitted_at ?? null);
  const [settledPaid, setSettledPaid] = useState<number | null>(null);
  const effectivePaid = settledPaid ?? paid;
  const isInsurance = ['nhis', 'hmo', 'katchma'].includes(String(patient.account_type));
  const canManageClaims = hasRole(['claims_manager', 'admin']);
  const showClaimAction = sponsored && isInsurance && effectivePaid >= total;
  const showSettleAction =
    sponsored && isInsurance && canManageClaims && effectivePaid < total && inv.status !== 'cancelled';

  const settleInvoice = async () => {
    setSubmitting(true);
    const { error } = await supabase.rpc('mark_invoice_claim_settled', {
      _invoice_id: inv.id,
      _notes: null,
    });
    setSubmitting(false);
    if (error) {
      toast({ title: 'Failed to mark invoice settled', description: error.message, variant: 'destructive' });
      return;
    }
    setSettledPaid(total);
    setSubmittedAt((prev) => prev ?? new Date().toISOString());
    toast({ title: 'Invoice settled', description: `Invoice ${inv.invoice_number} recorded as settled by the sponsor.` });
  };

  const submitClaim = async () => {
    setSubmitting(true);
    const { error } = await supabase.rpc('mark_invoice_claim_submitted', {
      _invoice_id: inv.id,
      _notes: null,
    });
    setSubmitting(false);
    if (error) {
      toast({ title: 'Failed to mark claim submitted', description: error.message, variant: 'destructive' });
      return;
    }
    setSubmittedAt(new Date().toISOString());
    toast({ title: 'Claim marked as submitted', description: `Invoice ${inv.invoice_number} recorded as sent to provider.` });
  };
  const undoClaim = async () => {
    setSubmitting(true);
    const { error } = await supabase.rpc('unmark_invoice_claim_submitted', { _invoice_id: inv.id });
    setSubmitting(false);
    if (error) {
      toast({ title: 'Failed to undo', description: error.message, variant: 'destructive' });
      return;
    }
    setSubmittedAt(null);
  };
  return (
    <div>
      {sponsored && (
        <div className="mb-2 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-2 text-[11px] flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-indigo-800 font-semibold uppercase tracking-wide">
            <FileText className="h-3 w-3" />
            {sponsorLabel(patient)} · Copay {split.copayPct}%
          </div>
          <span
            className={`px-1.5 py-0.5 rounded border font-bold uppercase tracking-wide ${
              claimPosted
                ? 'bg-indigo-600 text-white border-indigo-700'
                : copayDue > 0
                ? 'bg-amber-100 text-amber-800 border-amber-300'
                : 'bg-emerald-100 text-emerald-800 border-emerald-300'
            }`}
          >
            {claimPosted
              ? 'Claim: pending sponsor'
              : copayDue > 0
              ? `Awaiting copay ₦${copayDue.toLocaleString()}`
              : 'Copay collected'}
          </span>
        </div>
      )}
      <table className="w-full text-sm font-mono">
        <tbody className="divide-y divide-border/60">
          {items.slice(0, 6).map((it, i) => (
            <tr key={i}>
              <td className="py-1 text-muted-foreground">{it.description ?? it.item_name}</td>
              <td className="py-1 text-right font-bold">{naira(Number(it.total ?? it.amount ?? it.unit_price * (it.quantity ?? 1)))}</td>
            </tr>
          ))}
          {items.length > 6 && (
            <tr><td colSpan={2} className="py-1 text-center text-[10px] text-muted-foreground italic">+{items.length - 6} more items</td></tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border">
            <td className="pt-2 font-bold uppercase text-xs">Total Charged</td>
            <td className="pt-2 text-right font-bold">{naira(total)}</td>
          </tr>
          {sponsored && (
            <>
              <tr>
                <td className="text-xs text-indigo-700">Sponsor covers ({100 - split.copayPct}%)</td>
                <td className="text-right text-xs font-bold text-indigo-700">{naira(split.coveredAmount)}</td>
              </tr>
              <tr>
                <td className="text-xs text-foreground">Patient copay ({split.copayPct}%)</td>
                <td className="text-right text-xs font-bold">{naira(split.copayAmount)}</td>
              </tr>
            </>
          )}
          {paid > 0 && (
            <tr>
              <td className="text-xs text-emerald-600">Paid to date</td>
              <td className="text-right text-xs font-bold text-emerald-600">{naira(paid)}</td>
            </tr>
          )}
        </tfoot>
      </table>
      {showClaimAction && (
        <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
          {submittedAt ? (
            <>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                Claim submitted to provider · {format(new Date(submittedAt), 'dd MMM yyyy, HH:mm')}
              </span>
              <Button size="sm" variant="ghost" disabled={submitting} onClick={undoClaim} className="h-7 text-xs">
                Undo
              </Button>
            </>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">
                Submit this invoice as a claim on the provider's portal, then mark it here.
              </span>
              <Button size="sm" disabled={submitting} onClick={submitClaim} className="h-7 text-xs gap-1.5">
                <Send className="h-3.5 w-3.5" />
                {submitting ? 'Saving…' : 'Mark claim submitted'}
              </Button>
            </>
          )}
        </div>
      )}
      {showSettleAction && (
        <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
          <span className="text-xs text-muted-foreground">
            Sponsor paid this invoice? Mark it settled to close it out.
          </span>
          <Button size="sm" variant="outline" disabled={submitting} onClick={settleInvoice} className="h-7 text-xs gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {submitting ? 'Saving…' : 'Mark invoice settled'}
          </Button>
        </div>
      )}
    </div>
  );
}
