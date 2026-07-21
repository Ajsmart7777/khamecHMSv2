import { useMemo, useState } from 'react';
import { useSnapOrders, SnapOrder } from '@/hooks/useSnapOrders';
import { usePatients } from '@/contexts/PatientContext';
import { Badge } from '@/components/ui/badge';
import { FlaskConical } from 'lucide-react';
import { SnapFulfillDialog } from '@/components/pharmacy/PharmacySnapQueue';

const fmt = (n: number) => `₦${n.toLocaleString()}`;

export function LabSnapQueue() {
  const { orders, loading } = useSnapOrders({ station: 'lab', statuses: ['paid'] });
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
              <button
                key={o.id}
                onClick={() => setSelected(o)}
                className="w-full text-left p-3 rounded-lg border hover:border-module-laboratory transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{nameOf.get(o.patient_id) ?? 'Unknown'}</p>
                    <p className="text-xs text-muted-foreground">
                      {(o.matched_items ?? []).length} test(s) · {fmt(total)}
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
        <SnapFulfillDialog
          snap={selected}
          onClose={() => setSelected(null)}
          patientName={nameOf.get(selected.patient_id) ?? ''}
          kind="lab"
        />
      )}
    </div>
  );
}
