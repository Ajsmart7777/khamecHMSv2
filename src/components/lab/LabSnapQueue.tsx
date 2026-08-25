import { useMemo, useState, useEffect } from 'react';
import { useSnapOrders, SnapOrder, snapPhotoUrl } from '@/hooks/useSnapOrders';
import { usePatients } from '@/contexts/PatientContext';
import { Badge } from '@/components/ui/badge';
import { FlaskConical, Search } from 'lucide-react';
import { SnapFulfillDialog } from '@/components/pharmacy/PharmacySnapQueue';
import { LabResultReturnButton } from '@/components/lab/LabResultReturnButton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const fmt = (n: number) => `₦${n.toLocaleString()}`;

export function LabSnapQueue() {
  const { orders, loading } = useSnapOrders({ station: 'lab', statuses: ['paid'] });
  const { patients } = usePatients();
  const [selected, setSelected] = useState<SnapOrder | null>(null);
  const [viewingPreview, setViewingPreview] = useState<SnapOrder | null>(null);

  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    patients.forEach(p => m.set(p.id, `${p.first_name} ${p.last_name}`));
    return m;
  }, [patients]);

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-3">
        <FlaskConical className="h-5 w-5 text-module-laboratory" />
        <h3 className="font-semibold">Paid Lab Requests — Ready to Process</h3>
        <Badge variant="outline" className="text-[10px]">{orders.length}</Badge>
      </div>

      {loading && orders.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
      ) : orders.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No paid lab requests in queue.</p>
      ) : (
        <div className="space-y-2">
          {orders.map(o => {
            const total = (o.matched_items ?? []).reduce((s, it) => s + it.unit_price * it.qty, 0);
            return (
              <div
                key={o.id}
                className="p-3 rounded-lg border hover:border-module-laboratory transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <button onClick={() => setSelected(o)} className="flex-1 min-w-0 text-left">
                    <p className="text-sm font-medium truncate">{nameOf.get(o.patient_id) ?? 'Unknown'}</p>
                    <p className="text-xs text-muted-foreground">
                      {(o.matched_items ?? []).length} test(s) · {fmt(total)}
                      {o.note && <> · {o.note}</>}
                    </p>
                  </button>
                  <div className="flex flex-col items-end gap-2">
                    <Badge variant="success" className="text-[10px]">Paid</Badge>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-7 px-2 text-xs"
                      onClick={() => setViewingPreview(o)}
                    >
                      <Search className="h-3.5 w-3.5 mr-1" />
                      Preview
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex justify-end">
                  <LabResultReturnButton parentSnap={o} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <SnapFulfillDialog
          snap={selected}
          onClose={() => setSelected(null)}
          patientName={nameOf.get(selected.patient_id) ?? ''}
          kind="lab"
        />
      )}
      
      {viewingPreview && (
        <LabOrderPreviewDialog 
          snap={viewingPreview} 
          onClose={() => setViewingPreview(null)} 
          patientName={nameOf.get(viewingPreview.patient_id) ?? ''} 
        />
      )}
    </div>
  );
}

function LabOrderPreviewDialog({ snap, onClose, patientName }: { snap: SnapOrder; onClose: () => void; patientName: string }) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (snap.photo_path) {
      snapPhotoUrl(snap.photo_path).then(url => { if (!cancelled) setImgUrl(url); });
    }
    return () => { cancelled = true; };
  }, [snap.photo_path]);

  const total = (snap.matched_items ?? []).reduce((s, it) => s + it.unit_price * it.qty, 0);
  const isTyped = snap.ocr_text && (snap.ocr_text.startsWith('LINKED_PRESCRIPTION:') || snap.ocr_text.startsWith('LINKED_LAB_REQUEST:'));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Order Preview · {patientName}</DialogTitle>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-lg overflow-hidden bg-muted flex items-center justify-center min-h-[200px]">
            {imgUrl
              ? <img src={imgUrl} alt="Order snap" className="max-h-[380px] object-contain" />
              : <p className="text-xs text-muted-foreground p-4">
                  {snap.photo_path ? 'Loading image...' : 'No image available'}
                </p>
            }
          </div>

          <div className="space-y-4">
            {isTyped && (
              <div className="bg-module-laboratory/10 border border-module-laboratory/20 rounded-lg p-3">
                <p className="text-xs font-bold text-module-laboratory uppercase mb-2 tracking-wider">Clinical Details (Typed Order)</p>
                <div className="text-xs space-y-2 whitespace-pre-wrap font-medium">
                  {snap.note}
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                <FlaskConical className="h-3.5 w-3.5 text-module-laboratory" />
                Paid Lab Items:
              </p>
              <div className="border rounded-lg divide-y bg-muted/20">
                {(snap.matched_items ?? []).length === 0 && (
                  <p className="p-3 text-xs text-muted-foreground text-center italic">Refer to photo for item details</p>
                )}
                {(snap.matched_items ?? []).map((it, idx) => (
                  <div key={idx} className="p-2 flex items-center justify-between text-xs">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{it.name}{it.size ? ` ${it.size}` : ''}</p>
                      <p className="text-[9px] text-muted-foreground">{it.category}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono">×{it.qty}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {snap.note && !isTyped && (
              <div className="bg-muted/50 p-2 rounded text-[11px]">
                <span className="font-semibold block mb-0.5">Note:</span>
                {snap.note}
              </div>
            ) }

            <div className="flex items-center justify-between text-xs border-t pt-2">
              <span className="text-muted-foreground">Original Sender:</span>
              <Badge variant="outline" className="text-[10px] capitalize">{snap.original_sender_role || snap.source_role || 'Unknown'}</Badge>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close Preview</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
