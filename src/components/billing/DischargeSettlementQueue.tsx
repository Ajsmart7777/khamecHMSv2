import { useMemo, useState } from 'react';
import { BedDouble, User2, Wallet, Banknote } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAdmissions } from '@/hooks/useAdmissions';
import { usePatients } from '@/contexts/PatientContext';
import { useAdmissionPerms } from '@/lib/admissionPermissions';
import { DischargeDialog } from '@/components/nurse/DischargeDialog';

/**
 * Cashier-side queue of admitted patients the ward has confirmed for discharge.
 * Settlement (collect / carry as debt / refund change) happens here only.
 */
export function DischargeSettlementQueue() {
  const { admissions, refresh } = useAdmissions({ statuses: ['ready_for_discharge'] });
  const { patients } = usePatients() as any;
  const can = useAdmissionPerms();
  const [target, setTarget] = useState<
    { admissionId: string; patientId: string; name: string; balance: number } | null
  >(null);

  const patientOf = useMemo(
    () => new Map((patients ?? []).map((p: any) => [p.id, p])),
    [patients],
  );

  return (
    <div className="p-4 rounded-xl border border-border bg-card mb-6">
      <div className="flex items-center gap-2 mb-3">
        <BedDouble className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">Discharge Settlements</h3>
        <Badge variant="outline" className="text-[10px]">{admissions.length}</Badge>
      </div>

      {admissions.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No patients awaiting discharge settlement.
        </p>
      ) : (
        <div className="space-y-2">
          {admissions.map((a) => {
            const p: any = patientOf.get(a.patient_id);
            const bal = Number(p?.balance ?? 0);
            const name = `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim() || 'Unknown';
            return (
              <div key={a.id} className="p-3 rounded-lg border flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate flex items-center gap-1.5">
                    <User2 className="h-3.5 w-3.5" /> {name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p?.card_number} · {p?.account_type ?? '—'}
                    {a.ready_for_discharge_at
                      ? ` · confirmed ${new Date(a.ready_for_discharge_at).toLocaleString()}`
                      : ''}
                  </p>
                </div>
                <Badge variant={bal < 0 ? 'warning' : 'success'} className="text-[10px] whitespace-nowrap">
                  <Wallet className="h-3 w-3 mr-1" />₦{bal.toLocaleString()}
                </Badge>
                {can('discharge') && (
                  <Button
                    size="sm"
                    onClick={() =>
                      setTarget({ admissionId: a.id, patientId: a.patient_id, name, balance: bal })
                    }
                  >
                    <Banknote className="h-3.5 w-3.5 mr-1.5" /> Settle
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {target && (
        <DischargeDialog
          open
          onOpenChange={(o) => !o && setTarget(null)}
          admissionId={target.admissionId}
          patientId={target.patientId}
          patientName={target.name}
          patientBalance={target.balance}
          onDischarged={refresh}
        />
      )}
    </div>
  );
}
