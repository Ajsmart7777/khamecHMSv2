import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { differenceInYears } from 'date-fns';
import { Loader2, X, ChevronDown, ChevronUp, Wallet, Droplet, Phone, Calendar, User } from 'lucide-react';
import { signedUrl } from '@/hooks/useVisitAttachments';
import { snapPhotoUrl } from '@/hooks/useSnapOrders';
import { Patient } from '@/contexts/PatientContext';
import { Visit } from '@/hooks/useVisits';
import { Button } from '@/components/ui/button';

// ---------- types ----------
type RowKind =
  | 'vitals' | 'attachment' | 'snap' | 'invoice' | 'payment' | 'admission' | 'discharge' | 'note';

interface LedgerRow {
  id: string;
  visitId: string;
  at: string;
  kind: RowKind;
  station: string;         // reception, nurse, doctor, lab, pharmacy, billing, cashier, admin
  title: string;
  actor?: string | null;
  data?: any;              // kind-specific
}

interface LedgerVisit {
  visit: Visit;
  rows: LedgerRow[];
}

const STATION_TONE: Record<string, string> = {
  reception: 'bg-blue-100 text-blue-700 border-blue-200',
  nurse:     'bg-teal-100 text-teal-700 border-teal-200',
  doctor:    'bg-indigo-100 text-indigo-700 border-indigo-200',
  lab:       'bg-purple-100 text-purple-700 border-purple-200',
  pharmacy:  'bg-emerald-100 text-emerald-700 border-emerald-200',
  billing:   'bg-amber-100 text-amber-700 border-amber-200',
  cashier:   'bg-orange-100 text-orange-700 border-orange-200',
  admin:     'bg-slate-200 text-slate-700 border-slate-300',
};

const naira = (n: number | null | undefined) =>
  n == null ? '' : `₦${Number(n).toLocaleString()}`;

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
  const [loading, setLoading] = useState(true);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const age = patient.date_of_birth
    ? differenceInYears(new Date(), new Date(patient.date_of_birth)) : null;

  // Load everything
  const load = useMemo(() => async (showSpinner = false) => {
    if (showSpinner) setLoading(true);

    const { data: visitList } = await supabase
      .from('visits')
      .select('*')
      .eq('patient_id', patient.id)
      .order('opened_at', { ascending: false });

    const vs = (visitList ?? []) as Visit[];
    const visitIds = vs.map(v => v.id);

    const [vt, att, snaps, invs, adms] = await Promise.all([
      visitIds.length
        ? supabase.from('vitals').select('*').in('visit_id', visitIds)
        : Promise.resolve({ data: [] as any[] }),
      visitIds.length
        ? supabase.from('visit_attachments').select('*').in('visit_id', visitIds)
        : Promise.resolve({ data: [] as any[] }),
      supabase.from('snap_orders').select('*').eq('patient_id', patient.id),
      visitIds.length
        ? supabase.from('invoices').select('*, invoice_items(*)').in('visit_id', visitIds)
        : Promise.resolve({ data: [] as any[] }),
      supabase.from('admissions').select('*, wards(name), beds(bed_number), rooms(room_number)')
        .eq('patient_id', patient.id),
    ]);

    const byVisit = new Map<string, LedgerRow[]>();
    const push = (vid: string | null, row: LedgerRow) => {
      const key = vid ?? '__none__';
      if (!byVisit.has(key)) byVisit.set(key, []);
      byVisit.get(key)!.push(row);
    };

    (vt.data ?? []).forEach((v: any) => push(v.visit_id, {
      id: `vt-${v.id}`, visitId: v.visit_id, at: v.created_at, kind: 'vitals',
      station: 'nurse', title: 'Vitals & Intake', data: v,
    }));

    (att.data ?? []).forEach((a: any) => push(a.visit_id, {
      id: `att-${a.id}`, visitId: a.visit_id, at: a.captured_at ?? a.created_at,
      kind: 'attachment', station: a.station ?? 'other',
      title: a.label || `${a.station ?? 'Card'} photo`,
      data: { path: a.storage_path, bucket: 'attachment' },
    }));

    (snaps.data ?? []).forEach((s: any) => push(s.visit_id, {
      id: `snap-${s.id}`, visitId: s.visit_id, at: s.created_at, kind: 'snap',
      station: s.source_role ?? 'doctor',
      title: `${(s.order_type ?? 'order').replace('_', ' ')} → ${s.target_station}`,
      data: s,
    }));

    (invs.data ?? []).forEach((i: any) => {
      push(i.visit_id, {
        id: `inv-${i.id}`, visitId: i.visit_id, at: i.created_at, kind: 'invoice',
        station: 'billing', title: `Invoice ${i.invoice_number}`, data: i,
      });
      if (Number(i.paid_amount) > 0) push(i.visit_id, {
        id: `pay-${i.id}`, visitId: i.visit_id, at: i.updated_at ?? i.created_at,
        kind: 'payment', station: 'cashier',
        title: `Payment · ${i.payment_method ?? 'received'}`,
        data: { amount: i.paid_amount, method: i.payment_method, ref: i.invoice_number },
      });
    });

    (adms.data ?? []).forEach((a: any) => {
      const vid = a.visit_id ?? vs.find(v => v.status === 'open')?.id ?? vs[0]?.id ?? null;
      push(vid, {
        id: `adm-${a.id}`, visitId: vid ?? '', at: a.admitted_at ?? a.created_at, kind: 'admission',
        station: 'nurse',
        title: `Admitted · ${a.wards?.name ?? 'Ward'}${a.beds?.bed_number ? ` · Bed ${a.beds.bed_number}` : ''}`,
        data: a,
      });
      if (a.discharged_at) push(vid, {
        id: `dis-${a.id}`, visitId: vid ?? '', at: a.discharged_at, kind: 'discharge',
        station: 'nurse', title: 'Discharged', data: a,
      });
    });

    const built: LedgerVisit[] = vs.map(v => {
      const rows = (byVisit.get(v.id) ?? []).sort(
        (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
      );
      return { visit: v, rows };
    });

    setVisits(built);
    setLoading(false);
  }, [patient.id]);

  useEffect(() => {
    load(true);
  }, [load]);

  // Realtime — refresh on any change to related tables for this patient/visits
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => load(false), 250);
    };

    const patientFilter = `patient_id=eq.${patient.id}`;
    const ch = supabase
      .channel(`ledger-${patient.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'snap_orders', filter: patientFilter }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visits', filter: patientFilter }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admissions', filter: patientFilter }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices', filter: patientFilter }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vitals', filter: patientFilter }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visit_attachments', filter: patientFilter }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoice_items' }, bump)
      .subscribe();
    return () => {
      if (debounce) clearTimeout(debounce);
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
        if (r.kind === 'attachment' && r.data?.path && !thumbs[r.data.path])
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

  const outstanding = Number(patient.balance ?? 0);

  return (
    <div className="w-full">
      <div className="max-w-5xl mx-auto bg-[hsl(var(--card))] border-2 border-border shadow-[8px_8px_0_0_hsl(var(--border)/0.4)] rounded-sm overflow-hidden">
        {/* Patient Header */}
        <div className="p-4 md:p-6 border-b-4 border-double border-border flex flex-col md:flex-row justify-between items-start gap-4 bg-background">
          <div className="space-y-3 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <User className="h-6 w-6" />
              </div>
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
            </div>
          </div>
          <div className="text-right flex items-start gap-3">
            <div>
              <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-1 justify-end">
                <Wallet className="h-3 w-3" /> Account Balance
              </div>
              <div className={`text-2xl md:text-3xl font-bold font-mono ${outstanding < 0 ? 'text-destructive' : 'text-foreground'}`}>
                ₦{outstanding.toLocaleString()}
              </div>
              <div className="text-[10px] text-muted-foreground font-medium">
                Updated {format(new Date(), 'dd MMM yyyy')}
              </div>
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
        ) : visits.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground text-sm">
            No visits yet — the card will fill as the patient moves through the hospital.
          </div>
        ) : (
          <div>
            {visits.map((lv, vi) => {
              const isCollapsed = collapsed[lv.visit.id];
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

                  {/* Rows */}
                  {!isCollapsed && (
                    <div className="divide-y divide-border">
                      {lv.rows.length === 0 && (
                        <div className="px-4 py-6 text-center text-xs text-muted-foreground italic">
                          No events recorded for this visit yet.
                        </div>
                      )}
                      {lv.rows.map(row => (
                        <LedgerRowView
                          key={row.id} row={row} thumbs={thumbs}
                          onOpenImage={setLightbox}
                        />
                      ))}
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

function LedgerRowView({
  row, thumbs, onOpenImage,
}: {
  row: LedgerRow;
  thumbs: Record<string, string>;
  onOpenImage: (url: string) => void;
}) {
  const tone = STATION_TONE[row.station] ?? STATION_TONE.admin;

  return (
    <div className="flex">
      {/* Date cell */}
      <div className="w-24 md:w-32 shrink-0 bg-muted/40 p-3 md:p-4 border-r border-border text-center">
        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
          {format(new Date(row.at), 'dd MMM')}
        </div>
        <div className="text-sm md:text-lg font-mono font-bold text-foreground">
          {format(new Date(row.at), 'HH:mm')}
        </div>
        <div className={`mt-2 text-[9px] px-1.5 py-0.5 rounded border capitalize font-bold uppercase tracking-tight ${tone}`}>
          {row.station}
        </div>
      </div>

      {/* Content cell */}
      <div className="flex-1 p-3 md:p-4 min-w-0">
        <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-widest">{row.title}</span>
          {row.actor && <span className="text-[10px] text-muted-foreground">by {row.actor}</span>}
        </div>

        {row.kind === 'vitals' && <VitalsRow v={row.data} />}
        {row.kind === 'attachment' && (
          <SnapPhoto url={thumbs[row.data?.path]} label={row.title} onOpen={onOpenImage} />
        )}
        {row.kind === 'snap' && (
          <SnapRow snap={row.data} thumb={thumbs[row.data?.photo_path]} onOpen={onOpenImage} />
        )}
        {row.kind === 'invoice' && <InvoiceRow inv={row.data} />}
        {row.kind === 'payment' && (
          <div className="text-sm">
            <span className="font-bold font-mono text-emerald-600">+{naira(row.data.amount)}</span>{' '}
            <span className="text-muted-foreground">via {row.data.method ?? 'cash'} · {row.data.ref}</span>
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
  const status = snap.status as string;
  const statusTone =
    status === 'fulfilled' || status === 'paid' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
    status === 'rejected' ? 'bg-red-100 text-red-700 border-red-200' :
    status === 'awaiting_payment' ? 'bg-amber-100 text-amber-700 border-amber-200' :
    'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <div className="flex gap-3">
      <SnapPhoto url={thumb} label={snap.order_type} onOpen={onOpen} />
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold uppercase ${statusTone}`}>
            {status?.replace(/_/g, ' ')}
          </span>
          <span className="text-[10px] text-muted-foreground uppercase font-bold">→ {snap.target_station}</span>
        </div>
        {snap.note && <p className="text-xs text-foreground italic">"{snap.note}"</p>}
        {Array.isArray(snap.matched_items) && snap.matched_items.length > 0 && (
          <ul className="text-[11px] text-muted-foreground list-disc pl-4">
            {snap.matched_items.slice(0, 4).map((m: any, i: number) => (
              <li key={i}>{m.name} × {m.qty} — {naira(m.unit_price * m.qty)}</li>
            ))}
            {snap.matched_items.length > 4 && <li>+{snap.matched_items.length - 4} more…</li>}
          </ul>
        )}
      </div>
    </div>
  );
}

function InvoiceRow({ inv }: { inv: any }) {
  const items = (inv.invoice_items ?? []) as any[];
  return (
    <div>
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
            <td className="pt-2 text-right font-bold">{naira(inv.total_amount)}</td>
          </tr>
          {Number(inv.paid_amount) > 0 && (
            <tr>
              <td className="text-xs text-emerald-600">Paid</td>
              <td className="text-right text-xs font-bold text-emerald-600">{naira(inv.paid_amount)}</td>
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}
