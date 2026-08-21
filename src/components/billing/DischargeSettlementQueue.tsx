import { useMemo, useState } from 'react';
import { BedDouble, User2, Wallet, Banknote, HeartPulse } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAdmissions, Admission } from '@/hooks/useAdmissions';
import { usePatients } from '@/contexts/PatientContext';
import { useAdmissionPerms } from '@/lib/admissionPermissions';
import { DischargeDialog } from '@/components/nurse/DischargeDialog';

/** Cashier-side queues for ordinary discharge and deceased-patient final settlement. */
export function DischargeSettlementQueue() {
  const { admissions, refresh } = useAdmissions({ statuses: ['ready_for_discharge', 'active'] });
  const { patients } = usePatients() as any;
  const can = useAdmissionPerms();
  const [target, setTarget] = useState<{
    admissionId: string;
    patientId: string;
    name: string;
    balance: number;
    deceased: boolean;
  } | null>(null);

  const patientOf = useMemo(
    () => new Map((patients ?? []).map((p: any) => [p.id, p])),
    [patients],
  );
  const deceasedAdmissions = admissions.filter((a) => Boolean(a.death_reported_at));
  const ordinaryAdmissions = admissions.filter((a) => !a.death_reported_at && a.status === 'ready_for_discharge');

  const row = (a: Admission, deceased: boolean) => {
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
            {deceased && a.death_reported_at
              ? ` · death reported ${new Date(a.death_reported_at).toLocaleString()}`
              : a.ready_for_discharge_at
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
            variant={deceased ? 'destructive' : 'default'}
            onClick={() => setTarget({ admissionId: a.id, patientId: a.patient_id, name, balance: bal, deceased })}
          >
            {deceased ? <HeartPulse className="h-3.5 w-3.5 mr-1.5" /> : <Banknote className="h-3.5 w-3.5 mr-1.5" />}
            {deceased ? 'Final Settlement' : 'Settle'}
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className="p-4 rounded-xl border border-border bg-card mb-6 space-y-6">
      <section>
        <div className="flex items-center gap-2 mb-3">
          <BedDouble className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Discharge Settlements</h3>
          <Badge variant="outline" className="text-[10px]">{ordinaryAdmissions.length}</Badge>
        </div>
        {ordinaryAdmissions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No patients awaiting discharge settlement.</p>
        ) : (
          <div className="space-y-2">{ordinaryAdmissions.map((a) => row(a, false))}</div>
        )}
      </section>

      <section className="border-t pt-5">
        <div className="flex items-center gap-2 mb-3">
          <HeartPulse className="h-5 w-5 text-destructive" />
          <h3 className="font-semibold">Deceased Patient Final Settlement</h3>
          <Badge variant="destructive" className="text-[10px]">{deceasedAdmissions.length}</Badge>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Complete all billing, clear any debt, and refund any remaining wallet credit before the bed is released.
        </p>
        {deceasedAdmissions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No deceased patients awaiting final settlement.</p>
        ) : (
          <div className="space-y-2">{deceasedAdmissions.map((a) => row(a, true))}</div>
        )}
      </section>

      {target && (
        <DischargeDialog
          open
          onOpenChange={(o) => !o && setTarget(null)}
          admissionId={target.admissionId}
          patientId={target.patientId}
          patientName={target.name}
          patientBalance={target.balance}
          deceased={target.deceased}
          onDischarged={refresh}
        />
      )}
    </div>
  );
}
