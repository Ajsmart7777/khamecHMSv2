import { useMemo, useState } from 'react';
import { BedDouble, Camera, LogOut, User2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAdmissions } from '@/hooks/useAdmissions';
import { usePatients } from '@/contexts/PatientContext';
import { AdmittedSnapDialog } from './AdmittedSnapDialog';
import { DischargeDialog } from '@/components/nurse/DischargeDialog';

interface Props {
  sourceStation: 'nurse' | 'doctor';
  title?: string;
}

/**
 * Panel of currently-admitted patients. Nurse/Doctor can create in-ward snaps
 * that bypass billing and deduct from the patient's balance directly.
 */
export function AdmittedPatientsPanel({ sourceStation, title = 'Admitted Patients' }: Props) {
  const { admissions } = useAdmissions({ statuses: ['active'] });
  const { patients } = usePatients();
  const [snapFor, setSnapFor] = useState<{ id: string; name: string; balance: number } | null>(null);
  const [dischargeFor, setDischargeFor] = useState<{ admissionId: string; patientId: string; name: string; balance: number } | null>(null);

  const patientOf = useMemo(() => {
    const m = new Map<string, any>();
    patients.forEach((p) => m.set(p.id, p));
    return m;
  }, [patients]);

  return (
    <div className="bg-card rounded-xl border p-4">
      <div className="flex items-center gap-2 mb-3">
        <BedDouble className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">{title}</h3>
        <Badge variant="outline" className="text-[10px]">{admissions.length}</Badge>
      </div>

      {admissions.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No admitted patients.</p>
      ) : (
        <div className="space-y-2">
          {admissions.map((a) => {
            const p = patientOf.get(a.patient_id);
            const bal = Number(p?.balance ?? 0);
            const low = bal <= 0;
            return (
              <div key={a.id} className="p-3 rounded-lg border">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate flex items-center gap-1.5">
                      <User2 className="h-3.5 w-3.5" />
                      {p ? `${p.first_name} ${p.last_name}` : 'Unknown'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p?.card_number} · {p?.account_type ?? '—'}
                    </p>
                  </div>
                  <Badge variant={low ? 'warning' : 'success'} className="text-[10px]">
                    <Wallet className="h-3 w-3 mr-1" />
                    ₦{bal.toLocaleString()}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSnapFor({ id: a.patient_id, name: `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim(), balance: bal })}
                  >
                    <Camera className="h-3.5 w-3.5 mr-1.5" /> In-Ward Snap
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setDischargeFor({ admissionId: a.id, patientId: a.patient_id, name: `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim(), balance: bal })}
                  >
                    <LogOut className="h-3.5 w-3.5 mr-1.5" /> Discharge
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {snapFor && (
        <AdmittedSnapDialog
          open
          onOpenChange={(o) => !o && setSnapFor(null)}
          patientId={snapFor.id}
          patientName={snapFor.name}
          patientBalance={snapFor.balance}
          sourceStation={sourceStation}
        />
      )}

      {dischargeFor && (
        <DischargeDialog
          open
          onOpenChange={(o) => !o && setDischargeFor(null)}
          admissionId={dischargeFor.admissionId}
          patientId={dischargeFor.patientId}
          patientName={dischargeFor.name}
          patientBalance={dischargeFor.balance}
        />
      )}
    </div>
  );
}
