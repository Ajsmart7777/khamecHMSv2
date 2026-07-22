import { useMemo, useState } from 'react';
import { ClipboardList, Send, User2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useSnapOrders, snapPhotoUrl, SnapOrder } from '@/hooks/useSnapOrders';
import { usePatients } from '@/contexts/PatientContext';

/**
 * Nurse's inbox for treatment/injection snaps sent by doctors (target='nurse').
 * Nurse reviews the photo, then forwards to Billing (routes to pharmacy or lab).
 */
export function NurseTreatmentInbox() {
  const { orders, refresh } = useSnapOrders({ station: 'nurse', statuses: ['pending_billing'] });
  const { patients } = usePatients();
  const [selected, setSelected] = useState<SnapOrder | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const patientOf = useMemo(() => {
    const m = new Map<string, any>();
    patients.forEach((p) => m.set(p.id, p));
    return m;
  }, [patients]);

  const open = async (o: SnapOrder) => {
    setSelected(o);
    setPhotoUrl(await snapPhotoUrl(o.photo_path));
  };

  return (
    <div className="bg-card rounded-xl border p-4">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardList className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">Treatment Review (from Doctor)</h3>
        <Badge variant="outline" className="text-[10px]">{orders.length}</Badge>
      </div>

      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No treatment snaps awaiting review.
        </p>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => {
            const p = patientOf.get(o.patient_id);
            return (
              <button
                key={o.id}
                onClick={() => open(o)}
                className="w-full text-left p-3 rounded-lg border hover:border-primary transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate flex items-center gap-1.5">
                      <User2 className="h-3.5 w-3.5" />
                      {p ? `${p.first_name} ${p.last_name}` : 'Unknown'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {o.order_type} · from {o.source_role}
                    </p>
                    {o.note && <p className="text-xs text-muted-foreground truncate">Note: {o.note}</p>}
                  </div>
                  <Badge variant="warning" className="text-[10px]">Review</Badge>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <ReviewDialog
          snap={selected}
          photoUrl={photoUrl}
          patient={patientOf.get(selected.patient_id)}
          onClose={() => { setSelected(null); setPhotoUrl(null); }}
          onDone={() => { refresh(); setSelected(null); setPhotoUrl(null); }}
        />
      )}
    </div>
  );
}

function ReviewDialog({
  snap, photoUrl, patient, onClose, onDone,
}: {
  snap: SnapOrder;
  photoUrl: string | null;
  patient?: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const [target, setTarget] = useState<'pharmacy' | 'lab'>('pharmacy');
  const [busy, setBusy] = useState(false);

  const forward = async () => {
    setBusy(true);
    const { error } = await supabase
      .from('snap_orders')
      .update({ target_station: target, note: (snap.note ?? '') + ' [Nurse-reviewed]' })
      .eq('id', snap.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Forwarded to Billing → ${target}`);
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Review Treatment Snap</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {patient && (
            <p className="text-sm">
              <span className="font-medium">{patient.first_name} {patient.last_name}</span>
              <span className="text-muted-foreground"> · {patient.card_number}</span>
            </p>
          )}
          {photoUrl && (
            <div className="rounded-lg overflow-hidden bg-muted flex items-center justify-center max-h-[50vh]">
              <img src={photoUrl} alt="snap" className="max-h-[50vh] object-contain" />
            </div>
          )}
          {snap.note && <p className="text-sm text-muted-foreground">Doctor's note: {snap.note}</p>}

          <div className="space-y-2">
            <Label>Forward to Billing → destination</Label>
            <RadioGroup value={target} onValueChange={(v) => setTarget(v as any)} className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-muted">
                <RadioGroupItem value="pharmacy" /> <span className="text-sm">Pharmacy</span>
              </label>
              <label className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-muted">
                <RadioGroupItem value="lab" /> <span className="text-sm">Lab</span>
              </label>
            </RadioGroup>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={forward} disabled={busy}>
            <Send className="h-4 w-4 mr-2" />
            {busy ? 'Forwarding…' : 'Forward to Billing'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
