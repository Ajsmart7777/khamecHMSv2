import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Activity, Camera, Pill, FlaskConical, Receipt, Send, CheckCircle2,
  XCircle, Wallet, ClipboardList, Image as ImageIcon, Filter,
} from 'lucide-react';
import { signedUrl } from '@/hooks/useVisitAttachments';
import { snapPhotoUrl } from '@/hooks/useSnapOrders';

type EventKind =
  | 'vitals' | 'attachment' | 'snap_created' | 'snap_billed' | 'snap_paid'
  | 'snap_fulfilled' | 'snap_rejected' | 'prescription' | 'lab_request'
  | 'invoice_created' | 'invoice_paid';

interface TimelineEvent {
  id: string;
  kind: EventKind;
  at: string;                          // ISO timestamp
  station: string;                     // reception, nurse, doctor, lab, pharmacy, billing, cashier
  title: string;
  subtitle?: string;
  meta?: string;
  photoPath?: string | null;
  photoBucket?: 'visit-cards';
  amount?: number | null;
}

const STATION_TONE: Record<string, string> = {
  reception: 'bg-blue-500/15 text-blue-700 border-blue-500/30',
  nurse:     'bg-teal-500/15 text-teal-700 border-teal-500/30',
  doctor:    'bg-indigo-500/15 text-indigo-700 border-indigo-500/30',
  lab:       'bg-purple-500/15 text-purple-700 border-purple-500/30',
  pharmacy:  'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  billing:   'bg-amber-500/15 text-amber-700 border-amber-500/30',
  cashier:   'bg-orange-500/15 text-orange-700 border-orange-500/30',
  system:    'bg-muted text-muted-foreground border-border',
};

const KIND_ICON: Record<EventKind, any> = {
  vitals: Activity,
  attachment: ImageIcon,
  snap_created: Camera,
  snap_billed: Send,
  snap_paid: Wallet,
  snap_fulfilled: CheckCircle2,
  snap_rejected: XCircle,
  prescription: Pill,
  lab_request: FlaskConical,
  invoice_created: ClipboardList,
  invoice_paid: Receipt,
};

const fmt = (n: number | null | undefined) =>
  n == null ? '' : `₦${Number(n).toLocaleString()}`;

interface Props {
  visitId: string;
}

export function VisitTimeline({ visitId }: Props) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'photos' | 'clinical' | 'billing'>('all');
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [vRes, aRes, sRes, rxRes, lRes, iRes] = await Promise.all([
        supabase.from('vitals').select('*').eq('visit_id', visitId),
        supabase.from('visit_attachments').select('*').eq('visit_id', visitId),
        supabase.from('snap_orders').select('*').eq('visit_id', visitId),
        supabase.from('prescriptions').select('*, prescription_items(medication, dosage)').eq('visit_id', visitId),
        supabase.from('lab_requests').select('*').eq('visit_id', visitId),
        supabase.from('invoices').select('*').eq('visit_id', visitId),
      ]);

      const list: TimelineEvent[] = [];

      (vRes.data ?? []).forEach((v: any) => list.push({
        id: `vit-${v.id}`, kind: 'vitals', at: v.created_at, station: 'nurse',
        title: 'Vitals recorded',
        subtitle: [
          v.blood_pressure && `BP ${v.blood_pressure}`,
          v.temperature != null && `T ${v.temperature}°C`,
          v.pulse != null && `P ${v.pulse}`,
          v.spo2 != null && `SpO₂ ${v.spo2}%`,
        ].filter(Boolean).join(' · '),
      }));

      (aRes.data ?? []).forEach((a: any) => list.push({
        id: `att-${a.id}`, kind: 'attachment', at: a.captured_at ?? a.created_at,
        station: a.station ?? 'other',
        title: a.label || `${(a.station ?? 'other')} photo`,
        photoPath: a.storage_path,
        photoBucket: 'visit-cards',
      }));

      (sRes.data ?? []).forEach((s: any) => {
        const target = s.target_station as string;
        const t = s.order_type as string;
        // Created (source role)
        list.push({
          id: `snap-c-${s.id}`, kind: 'snap_created', at: s.created_at,
          station: s.source_role ?? 'nurse',
          title: `${t[0].toUpperCase()}${t.slice(1)} snap sent to billing`,
          subtitle: s.note || `Destination: ${target}`,
          meta: 'awaiting OCR review',
          photoPath: s.photo_path, photoBucket: 'visit-cards',
        });
        if (s.billed_at) list.push({
          id: `snap-b-${s.id}`, kind: 'snap_billed', at: s.billed_at, station: 'billing',
          title: 'Snap invoiced', subtitle: s.invoice_id ? 'Invoice created' : undefined,
          photoPath: s.photo_path, photoBucket: 'visit-cards',
        });
        if (s.paid_at) list.push({
          id: `snap-p-${s.id}`, kind: 'snap_paid', at: s.paid_at, station: 'cashier',
          title: `Payment received — released to ${target}`,
          photoPath: s.photo_path, photoBucket: 'visit-cards',
        });
        if (s.fulfilled_at) list.push({
          id: `snap-f-${s.id}`, kind: 'snap_fulfilled', at: s.fulfilled_at, station: target,
          title: target === 'pharmacy' ? 'Medicines dispensed' : 'Lab work completed',
          photoPath: s.photo_path, photoBucket: 'visit-cards',
        });
        if (s.status === 'rejected') list.push({
          id: `snap-r-${s.id}`, kind: 'snap_rejected', at: s.updated_at ?? s.created_at, station: 'billing',
          title: 'Snap rejected', subtitle: s.rejection_reason ?? undefined,
          photoPath: s.photo_path, photoBucket: 'visit-cards',
        });
      });

      (rxRes.data ?? []).forEach((r: any) => list.push({
        id: `rx-${r.id}`, kind: 'prescription', at: r.created_at, station: 'doctor',
        title: r.diagnosis || 'Prescription written',
        subtitle: (r.prescription_items ?? []).map((m: any) => m.medication).filter(Boolean).join(', ') || undefined,
        meta: r.status,
      }));

      (lRes.data ?? []).forEach((l: any) => list.push({
        id: `lab-${l.id}`, kind: 'lab_request', at: l.created_at, station: 'doctor',
        title: 'Lab requested',
        subtitle: Array.isArray(l.tests) ? l.tests.join(', ') : undefined,
        meta: l.status,
      }));

      (iRes.data ?? []).forEach((i: any) => {
        list.push({
          id: `inv-${i.id}`, kind: 'invoice_created', at: i.created_at, station: 'billing',
          title: `Invoice ${i.invoice_number}`,
          subtitle: i.payment_method ? `Method: ${i.payment_method}` : undefined,
          amount: Number(i.total_amount),
          meta: i.status,
        });
        if (Number(i.paid_amount) > 0 && i.updated_at) list.push({
          id: `inv-p-${i.id}`, kind: 'invoice_paid', at: i.updated_at, station: 'cashier',
          title: `Payment on ${i.invoice_number}`,
          subtitle: `Paid ${fmt(Number(i.paid_amount))} of ${fmt(Number(i.total_amount))}`,
        });
      });

      list.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
      if (!cancelled) setEvents(list);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [visitId]);

  // Signed URL fetch for thumbnails
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const need = events.filter(e => e.photoPath && !thumbs[e.photoPath]);
      const uniquePaths = Array.from(new Set(need.map(e => e.photoPath!)));
      const results = await Promise.all(uniquePaths.map(async (p) => {
        const url = e_isSnap(p) ? await snapPhotoUrl(p) : await signedUrl(p);
        return [p, url] as const;
      }));
      if (cancelled) return;
      setThumbs(prev => {
        const next = { ...prev };
        for (const [p, url] of results) if (url) next[p] = url;
        return next;
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  const filtered = useMemo(() => {
    switch (filter) {
      case 'photos':   return events.filter(e => !!e.photoPath);
      case 'clinical': return events.filter(e => ['vitals','prescription','lab_request','snap_fulfilled'].includes(e.kind));
      case 'billing':  return events.filter(e => ['snap_billed','snap_paid','invoice_created','invoice_paid','snap_rejected'].includes(e.kind));
      default:         return events;
    }
  }, [events, filter]);

  return (
    <div>
      <div className="flex items-center gap-1 mb-3 flex-wrap">
        <Filter className="h-3.5 w-3.5 text-muted-foreground mr-1" />
        {(['all', 'photos', 'clinical', 'billing'] as const).map(f => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'default' : 'outline'}
            className="h-7 text-xs capitalize"
            onClick={() => setFilter(f)}
          >
            {f}
          </Button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} event{filtered.length === 1 ? '' : 's'}</span>
      </div>

      {loading && events.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">Loading timeline…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No events yet for this visit.</p>
      ) : (
        <ol className="relative border-l-2 border-border pl-5 space-y-3">
          {filtered.map((e) => {
            const Icon = KIND_ICON[e.kind];
            const tone = STATION_TONE[e.station] ?? STATION_TONE.system;
            const thumb = e.photoPath ? thumbs[e.photoPath] : undefined;
            return (
              <li key={e.id} className="relative">
                <span className={`absolute -left-[30px] top-1 w-6 h-6 rounded-full border-2 border-background flex items-center justify-center ${tone}`}>
                  <Icon className="h-3 w-3" />
                </span>
                <div className="rounded-lg border border-border p-3 bg-card">
                  <div className="flex items-start gap-3">
                    {thumb && (
                      <a href={thumb} target="_blank" rel="noreferrer" className="shrink-0">
                        <img src={thumb} alt="snap" className="w-14 h-14 rounded object-cover border" />
                      </a>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize ${tone}`}>{e.station}</span>
                        <p className="text-sm font-medium truncate">{e.title}</p>
                        {e.amount != null && (
                          <Badge variant="outline" className="text-[10px] font-mono">{fmt(e.amount)}</Badge>
                        )}
                        {e.meta && <Badge variant="secondary" className="text-[10px] capitalize">{e.meta}</Badge>}
                      </div>
                      {e.subtitle && (
                        <p className="text-xs text-muted-foreground mt-0.5 break-words">{e.subtitle}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {format(new Date(e.at), 'MMM d, yyyy · HH:mm')}
                      </p>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// Heuristic: snap_orders paths live under `<visitId>/...jpg` too, same bucket as visit-cards
// so we can just use one signed-url helper — kept function for clarity/future split.
function e_isSnap(_path: string) { return false; }
