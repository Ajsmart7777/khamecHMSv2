import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Stethoscope, Clock, User as UserIcon, FileImage, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface StandingOrderRow {
  id: string;
  photo_url: string;
  notes: string | null;
  status: string;
  expiry_date: string | null;
  created_at: string;
  captured_by: string | null;
  external_doctor_name: string | null;
  external_doctor: { name: string; specialty: string | null } | null;
  captured_by_email: string | null;
}

const BUCKET = 'standing-orders';

const statusColor: Record<string, string> = {
  pending_fulfillment: 'bg-warning/10 text-warning border-warning/30',
  transcribed: 'bg-info/10 text-info border-info/30',
  fulfilled: 'bg-success/10 text-success border-success/30',
  expired: 'bg-muted text-muted-foreground border-border',
};

export function PatientStandingOrders({ patientId }: { patientId: string }) {
  const [orders, setOrders] = useState<StandingOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('standing_orders')
      .select('id, photo_url, notes, status, expiry_date, created_at, captured_by, external_doctor_name, external_doctor:external_doctors(name,specialty)')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });
    const rows = (data || []) as unknown as StandingOrderRow[];
    setOrders(rows);
    // Generate signed thumbnail URLs
    const urls: Record<string, string> = {};
    await Promise.all(
      rows.map(async (r) => {
        const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(r.photo_url, 60 * 60);
        if (signed?.signedUrl) urls[r.id] = signed.signedUrl;
      })
    );
    setThumbUrls(urls);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`patient_standing_orders_${patientId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'standing_orders', filter: `patient_id=eq.${patientId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-3">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading external prescriptions…
      </div>
    );
  }

  if (orders.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-xl p-4 animate-fade-in">
      <div className="flex items-center gap-2 mb-3">
        <Stethoscope className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">External Prescriptions ({orders.length})</h3>
      </div>
      <div className="space-y-2">
        {orders.map((o) => {
          const doctorName = o.external_doctor?.name || o.external_doctor_name || 'Unknown doctor';
          const captured = new Date(o.created_at);
          return (
            <div key={o.id} className="flex gap-3 p-3 rounded-lg border border-border hover:bg-muted/40 transition-colors">
              <button
                onClick={() => thumbUrls[o.id] && setViewUrl(thumbUrls[o.id])}
                className="shrink-0 w-16 h-16 rounded-md bg-muted overflow-hidden border border-border"
              >
                {thumbUrls[o.id] ? (
                  <img src={thumbUrls[o.id]} alt="Rx" className="w-full h-full object-cover" />
                ) : (
                  <FileImage className="h-6 w-6 text-muted-foreground m-auto mt-5" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">Dr. {doctorName}</p>
                    {o.external_doctor?.specialty && (
                      <p className="text-xs text-muted-foreground truncate">{o.external_doctor.specialty}</p>
                    )}
                  </div>
                  <Badge className={`text-[10px] border ${statusColor[o.status] || ''}`}>
                    {o.status.replace(/_/g, ' ')}
                  </Badge>
                </div>
                {o.notes && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{o.notes}</p>}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {captured.toLocaleString()}
                  </span>
                  {o.captured_by && (
                    <span className="inline-flex items-center gap-1">
                      <UserIcon className="h-3 w-3" />
                      Captured by {o.captured_by.slice(0, 8)}
                    </span>
                  )}
                  {o.expiry_date && (
                    <span>Expires {new Date(o.expiry_date).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={!!viewUrl} onOpenChange={(o) => !o && setViewUrl(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader><DialogTitle>Prescription Photo</DialogTitle></DialogHeader>
          {viewUrl && <img src={viewUrl} alt="Prescription" className="w-full max-h-[75vh] object-contain rounded-md" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
