import { useState } from 'react';
import { BedDouble, ArrowRight, Stethoscope } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { usePatients } from '@/contexts/PatientContext';
import { formatDistanceToNow } from 'date-fns';

/**
 * Awaiting Room — patients the doctor has admitted for observation / short-stay.
 * They live under the Nurse station so vitals & monitoring continue until the
 * doctor recalls them or discharges.
 */
export function AwaitingRoomPanel() {
  const { getPatientsByStatus, updatePatientStatus } = usePatients();
  const [busyId, setBusyId] = useState<string | null>(null);
  const patients = getPatientsByStatus(['awaiting_room']);

  const sendBackToDoctor = async (id: string, name: string) => {
    setBusyId(id);
    const ok = await updatePatientStatus(id, 'with_doctor');
    setBusyId(null);
    if (ok) toast.success(`${name} sent back to Doctor`);
  };

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <BedDouble className="h-4 w-4 text-module-nurse" />
          Awaiting Room
        </h3>
        <Badge variant="info">{patients.length}</Badge>
      </div>

      {patients.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground">
          <BedDouble className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-xs">No patients admitted for observation</p>
        </div>
      ) : (
        <div className="space-y-2">
          {patients.map((p) => (
            <div
              key={p.id}
              className="p-3 rounded-lg border border-border hover:border-module-nurse/50 transition-all"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">
                    {p.first_name} {p.last_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p.card_number} · admitted{' '}
                    {p.updated_at
                      ? formatDistanceToNow(new Date(p.updated_at), { addSuffix: true })
                      : ''}
                  </p>
                  {p.assigned_doctor && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Under {p.assigned_doctor === 'doctor1' ? 'Doctor 1' : 'Doctor 2'}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === p.id}
                  onClick={() =>
                    sendBackToDoctor(p.id, `${p.first_name} ${p.last_name}`)
                  }
                >
                  <Stethoscope className="h-3.5 w-3.5 mr-1" />
                  To Doctor
                  <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}