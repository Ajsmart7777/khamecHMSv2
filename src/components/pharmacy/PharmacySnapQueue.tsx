import { useEffect, useMemo, useState } from 'react';
import { useSnapOrders, SnapOrder, snapPhotoUrl, markSnapFulfilled } from '@/hooks/useSnapOrders';
import { usePatients } from '@/contexts/PatientContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { CheckCircle, Pill } from 'lucide-react';

const fmt = (n: number) => `₦${n.toLocaleString()}`;

export function PharmacySnapQueue() {
  const { orders, loading } = useSnapOrders({ station: 'pharmacy', statuses: ['paid'] });
  const { patients } = usePatients();
  const [selected, setSelected] = useState<SnapOrder | null>(null);

  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    patients.forEach(p => m.set(p.id, `${p.first_name} ${p.last_name}`));
    return m;
  }, [patients]);

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-3">
        <Pill className="h-5 w-5 text-module-pharmacy" />
        <h3 className="font-semibold">Paid Prescriptions — Ready to Dispense</h3>
        <Badge variant="outline" className="text-[10px]">{orders.length}</Badge>
      </div>

      {loading && orders.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
      ) : orders.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No paid prescriptions in queue.</p>
      ) : (
        <div className="space-y-2">
          {orders.map(o => {
            const total = (o.matched_items ?? []).reduce((s, it) => s + it.unit_price * it.qty, 0);
            return (
              <button
                key={o.id}
                onClick={() => setSelected(o)}
                className="w-full text-left p-3 rounded-lg border hover:border-module-pharmacy transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{nameOf.get(o.patient_id) ?? 'Unknown'}</p>
                    <p className="text-xs text-muted-foreground">
                      {(o.matched_items ?? []).length} item(s) · {fmt(total)}
                      {o.note && <> · {o.note}</>}
                    </p>
                  </div>
                  <Badge variant="success" className="text-[10px]">Paid</Badge>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <SnapFulfillDialog snap={selected} onClose={() => setSelected(null)} patientName={nameOf.get(selected.patient_id) ?? ''} kind="pharmacy" />
      )}
    </div>
  );
}

export function SnapFulfillDialog({
  snap, onClose, patientName, kind,
}: { snap: SnapOrder; onClose: () => void; patientName: string; kind: 'pharmacy' | 'lab' }) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    snapPhotoUrl(snap.photo_path).then(url => { if (!cancelled) setImgUrl(url); });
    return () => { cancelled = true; };
  }, [snap.photo_path]);

  const fulfill = async () => {
    setBusy(true);
    const ok = await markSnapFulfilled(snap.id);
    setBusy(false);
    if (ok) onClose();
  };

  const total = (snap.matched_items ?? []).reduce((s, it) => s + it.unit_price * it.qty, 0);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{kind === 'pharmacy' ? 'Dispense' : 'Process'} · {patientName}</DialogTitle>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-lg overflow-hidden bg-muted flex items-center justify-center min-h-[200px]">
            {imgUrl
              ? <img src={imgUrl} alt="snap" className="max-h-[380px] object-contain" />
              : <p className="text-xs text-muted-foreground p-4">Loading…</p>}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium">Paid items to {kind === 'pharmacy' ? 'dispense' : 'process'}:</p>
            <div className="border rounded-lg divide-y">
              {(snap.matched_items ?? []).length === 0 && (
                <p className="p-3 text-xs text-muted-foreground text-center">No matched items — refer to photo.</p>
              )}
              {(snap.matched_items ?? []).map((it, idx) => (
                <div key={idx} className="p-2 flex items-center justify-between text-sm">
                  <div className="min-w-0">
                    <p className="truncate">{it.name}{it.size ? ` ${it.size}` : ''}</p>
                    <p className="text-[10px] text-muted-foreground">{it.category}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono">×{it.qty}</p>
                    <p className="text-[10px] text-muted-foreground">{fmt(it.unit_price * it.qty)}</p>
                  </div>
                </div>
              ))}
              <div className="p-2 flex items-center justify-between bg-muted/50">
                <span className="text-sm font-medium">Total paid</span>
                <span className="font-mono font-bold">{fmt(total)}</span>
              </div>
            </div>
            {snap.note && <p className="text-xs text-muted-foreground">Note: {snap.note}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>
          <Button onClick={fulfill} disabled={busy}>
            <CheckCircle className="h-4 w-4 mr-2" />
            {busy ? 'Saving…' : `Mark ${kind === 'pharmacy' ? 'Dispensed' : 'Processed'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
