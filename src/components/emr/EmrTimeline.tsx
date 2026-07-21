import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Activity, FileText, FlaskConical, Pill, Receipt, Camera } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';

interface Entry {
  date: string;
  type: 'vitals' | 'prescription' | 'lab' | 'invoice' | 'standing_order';
  data: Record<string, any>;
}

const icons: Record<Entry['type'], typeof Activity> = {
  vitals: Activity,
  prescription: Pill,
  lab: FlaskConical,
  invoice: Receipt,
  standing_order: Camera,
};

const colors: Record<Entry['type'], string> = {
  vitals: 'text-destructive',
  prescription: 'text-module-pharmacy',
  lab: 'text-module-lab',
  invoice: 'text-module-billing',
  standing_order: 'text-accent',
};

export function EmrTimeline({ patientId }: { patientId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const [v, p, l, i, s] = await Promise.all([
        supabase.from('vitals').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
        supabase.from('prescriptions').select('*, prescription_items(*)').eq('patient_id', patientId).order('created_at', { ascending: false }),
        supabase.from('lab_requests').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
        supabase.from('invoices').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
        supabase.from('standing_orders').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
      ]);
      const all: Entry[] = [];
      (v.data ?? []).forEach((d: any) => all.push({ date: d.created_at, type: 'vitals', data: d }));
      (p.data ?? []).forEach((d: any) => all.push({ date: d.created_at, type: 'prescription', data: d }));
      (l.data ?? []).forEach((d: any) => all.push({ date: d.created_at, type: 'lab', data: d }));
      (i.data ?? []).forEach((d: any) => all.push({ date: d.created_at, type: 'invoice', data: d }));
      (s.data ?? []).forEach((d: any) => all.push({ date: d.created_at, type: 'standing_order', data: d }));
      all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      if (active) {
        setEntries(all);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [patientId]);

  if (loading) return <p className="text-sm text-muted-foreground text-center py-8">Loading timeline...</p>;
  if (entries.length === 0)
    return (
      <div className="text-center py-12 text-muted-foreground">
        <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No history yet for this patient</p>
      </div>
    );

  return (
    <div className="relative pl-6 border-l border-border space-y-4">
      {entries.map((e, idx) => {
        const Icon = icons[e.type];
        const d = e.data;
        return (
          <div key={idx} className="relative">
            <div className={`absolute -left-[31px] top-1 w-4 h-4 rounded-full bg-background border-2 border-current ${colors[e.type]} flex items-center justify-center`}>
              <div className="w-1.5 h-1.5 rounded-full bg-current" />
            </div>
            <div className="p-3 rounded-lg border border-border bg-card">
              <div className="flex justify-between items-start gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${colors[e.type]}`} />
                  <h4 className="text-sm font-medium capitalize">{e.type.replace('_', ' ')}</h4>
                  {d.status && <Badge variant="outline" className="text-xs">{d.status}</Badge>}
                </div>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(e.date), 'MMM dd, yyyy • h:mm a')}
                </span>
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                {e.type === 'vitals' && (
                  <div className="flex flex-wrap gap-x-3">
                    {d.temperature && <span>T {d.temperature}°C</span>}
                    {d.blood_pressure && <span>BP {d.blood_pressure}</span>}
                    {d.pulse && <span>P {d.pulse}</span>}
                    {d.weight && <span>Wt {d.weight}kg</span>}
                  </div>
                )}
                {e.type === 'prescription' && (
                  <>
                    {d.diagnosis && <p>Dx: {d.diagnosis}</p>}
                    {d.prescription_items?.length > 0 && (
                      <p>Meds: {d.prescription_items.map((m: any) => m.medication).join(', ')}</p>
                    )}
                  </>
                )}
                {e.type === 'lab' && (
                  <p>Tests: {(d.tests as string[] || []).join(', ')}</p>
                )}
                {e.type === 'invoice' && (
                  <p>
                    {d.invoice_number} — ₦{Number(d.total_amount || 0).toLocaleString()} ({d.status})
                  </p>
                )}
                {e.type === 'standing_order' && (
                  <p>
                    External {d.order_type || 'order'} — {d.doctor_name || 'unknown doctor'}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
