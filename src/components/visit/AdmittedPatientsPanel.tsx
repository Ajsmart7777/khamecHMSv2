import { useEffect, useMemo, useState } from 'react';
import { BedDouble, Camera, FileImage, FileText, HeartPulse, LogOut, User2, Wallet, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAdmissions } from '@/hooks/useAdmissions';
import { usePatients } from '@/contexts/PatientContext';
import { AdmittedSnapDialog } from './AdmittedSnapDialog';
import { EmergencyEpisodeDialog } from './EmergencyEpisodeDialog';
import { SnapToCard } from './SnapToCard';
import { AdmissionSnapDialog } from './AdmissionSnapDialog';

import { ConfirmDischargeDialog } from '@/components/nurse/ConfirmDischargeDialog';
import { ReportDeathDialog } from '@/components/nurse/ReportDeathDialog';
import { createRealtimeChannel, supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

import { useWardsRoomsBeds } from '@/hooks/useWardsRooms';
import { PatientLabResultsDialog } from '@/components/patient/PatientLabResultsDialog';
import { useAdmissionPerms } from '@/lib/admissionPermissions';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

interface Props {
  sourceStation: 'nurse' | 'doctor1' | 'doctor2';
  title?: string;
  assignedDoctor?: 'doctor1' | 'doctor2';
}

/**
 * Panel of currently-admitted patients. The patient card stays with Nurse
 * throughout admission — this panel only creates tasks (forward existing
 * snaps to Pharmacy/Lab via Billing, sign a discharge order, or discharge).
 */
export function AdmittedPatientsPanel({ sourceStation, title = 'Admitted Patients', assignedDoctor }: Props) {
  const { admissions, refresh } = useAdmissions({ statuses: ['active', 'ready_for_discharge'] });
  const { patients } = usePatients();
  const [orderFor, setOrderFor] = useState<{
    id: string; name: string; balance: number;
    mode: 'items' | 'snap';
    orderType: 'prescription' | 'lab' | 'treatment';
    emergencyEpisodeId?: string | null;
    accountType?: string | null; plan?: string | null;
  } | null>(null);
  const [dischargeFor, setDischargeFor] = useState<{ admissionId: string; patientId: string; name: string; balance: number } | null>(null);
  const [emergencyFor, setEmergencyFor] = useState<{ patientId: string; patientName: string; visitId: string | null; admissionId: string } | null>(null);
  const [openEmergencyEpisodes, setOpenEmergencyEpisodes] = useState<Record<string, string>>({});
  const [deathFor, setDeathFor] = useState<{ admissionId: string; name: string } | null>(null);

  
  const [resultsFor, setResultsFor] = useState<{ patientId: string; name: string } | null>(null);
  const [admissionSnapFor, setAdmissionSnapFor] = useState<{ patientId: string; name: string; path: string | null } | null>(null);
  const { rooms, beds } = useWardsRoomsBeds();
  const can = useAdmissionPerms();
  const { user } = useAuth();
  const userId = user?.id;

  useEffect(() => {
    let active = true;
    const loadEmergencyEpisodes = async () => {
      const { data } = await supabase.from('emergency_episodes').select('id, patient_id').eq('status', 'open');
      if (!active) return;
      const next: Record<string, string> = {};
      (data ?? []).forEach((row: any) => { if (row.patient_id && row.id) next[row.patient_id] = row.id; });
      setOpenEmergencyEpisodes(next);
    };
    void loadEmergencyEpisodes();
    const timer = window.setInterval(() => void loadEmergencyEpisodes(), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  // New (un-archived) lab result photos per admitted patient
  const [newResults, setNewResults] = useState<Record<string, number>>({});
  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data } = await supabase
        .from('snap_orders')
        .select('patient_id')
        .in('order_type', ['lab', 'lab_result'])
        .eq('status', 'returned');
      if (!active) return;
      const counts: Record<string, number> = {};
      (data ?? []).forEach((r: any) => { counts[r.patient_id] = (counts[r.patient_id] ?? 0) + 1; });
      setNewResults(counts);
    };
    load();
    const ch = createRealtimeChannel(`admitted-lab-results-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'snap_orders' }, () => load())
      .subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }, []);

  const bedInfo = useMemo(() => {
    const roomOf = new Map(rooms.map((r) => [r.id, r]));
    const m = new Map<string, { label: string; rate: number }>();
    beds.forEach((b) => {
      const r = roomOf.get(b.room_id);
      m.set(b.id, { label: r ? `Room ${r.room_number} · Bed ${b.bed_label}` : `Bed ${b.bed_label}`, rate: Number(r?.daily_rate ?? 0) });
    });
    return m;
  }, [rooms, beds]);


  const patientOf = useMemo(() => {
    const m = new Map<string, any>();
    patients.forEach((p) => m.set(p.id, p));
    return m;
  }, [patients]);

  // Both Nurse and Doctor stations now see ALL admitted patients across the hospital.
  const scoped = useMemo(() => {
    return admissions;
  }, [admissions]);


  return (
    <div className="bg-card rounded-xl border p-4">
      <div className="flex items-center gap-2 mb-3">
        <BedDouble className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">{title}</h3>
        <Badge variant="outline" className="text-[10px]">{scoped.length}</Badge>
      </div>

      {scoped.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No admitted patients.</p>
      ) : (
        <div className="space-y-2">
          {scoped.map((a) => {
            const p = patientOf.get(a.patient_id);
            const bal = Number(p?.balance ?? 0);
            const low = bal <= 0;
            const isReady = a.status === 'ready_for_discharge';
            const deathReported = Boolean(a.death_reported_at);
            const name = `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim();
            const bed = a.bed_id ? bedInfo.get(a.bed_id) : undefined;
            const startedAt = a.admitted_at ?? a.created_at ?? null;
            // Calendar nights: admission date -> today (min 1), matches server billing
            const nights = startedAt
              ? Math.max(
                  1,
                  Math.round(
                    (new Date(new Date().toDateString()).getTime() -
                      new Date(new Date(startedAt).toDateString()).getTime()) / 86_400_000,
                  ),
                )
              : 0;
            const days = nights;
            const accrued = bed ? nights * bed.rate : 0;
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
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {bed ? `${bed.label} · ` : ''}
                      {startedAt ? `since ${new Date(startedAt).toLocaleDateString()}` : 'not yet admitted'}
                      {bed ? ` · bed charge ₦${accrued.toLocaleString()} (₦${bed.rate.toLocaleString()}/night)` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {days > 0 && (
                      <Badge variant="outline" className="text-[10px] whitespace-nowrap">
                        Day {days} · {nights} night{nights === 1 ? '' : 's'}
                      </Badge>
                    )}
                    {deathReported ? (
                      <Badge variant="destructive" className="text-[10px]">Death Reported</Badge>
                    ) : isReady ? (
                      <Badge variant="info" className="text-[10px]">Ready for Discharge</Badge>
                    ) : (
                      <Badge variant={low ? 'warning' : 'success'} className="text-[10px]">
                        <Wallet className="h-3 w-3 mr-1" />
                        ₦{bal.toLocaleString()}
                      </Badge>
                    )}
                  </div>
                </div>

                {deathReported && (
                  <div className="mb-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs text-muted-foreground">
                    <p className="font-medium text-destructive flex items-center gap-1.5"><HeartPulse className="h-3.5 w-3.5" /> Death reported</p>
                    <p>Awaiting Cashier final settlement. The bed remains occupied until settlement is complete.</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  {!deathReported && can('admittedSnap') && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEmergencyFor({ patientId: a.patient_id, patientName: name, visitId: a.visit_id ?? null, admissionId: a.id })}
                    >
                      <HeartPulse className="h-3.5 w-3.5 mr-1.5 text-amber-600" /> Emergency Care
                    </Button>
                  )}
                  {!deathReported && can('admittedSnap') && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setOrderFor({ id: a.patient_id, name, balance: bal, mode: 'snap', orderType: 'prescription', emergencyEpisodeId: openEmergencyEpisodes[a.patient_id] ?? null, accountType: p?.account_type, plan: p?.insurance_plan })}
                    >
                      <Camera className="h-3.5 w-3.5 mr-1.5" /> Snap to Pharmacy
                    </Button>
                  )}
                  {!deathReported && can('admittedSnap') && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setOrderFor({ id: a.patient_id, name, balance: bal, mode: 'snap', orderType: 'lab', emergencyEpisodeId: openEmergencyEpisodes[a.patient_id] ?? null, accountType: p?.account_type, plan: p?.insurance_plan })}
                    >
                      <Camera className="h-3.5 w-3.5 mr-1.5" /> Snap to Lab
                    </Button>
                  )}
                  {!deathReported && can('admittedSnap') && (
                    <Button
                      size="sm"
                      onClick={() => setOrderFor({ id: a.patient_id, name, balance: bal, mode: 'items', orderType: 'prescription', emergencyEpisodeId: openEmergencyEpisodes[a.patient_id] ?? null, accountType: p?.account_type, plan: p?.insurance_plan })}
                    >
                      <FileText className="h-3.5 w-3.5 mr-1.5" /> Type to Pharmacy
                    </Button>
                  )}
                  {!deathReported && can('admittedSnap') && (
                    <Button
                      size="sm"
                      onClick={() => setOrderFor({ id: a.patient_id, name, balance: bal, mode: 'items', orderType: 'lab', emergencyEpisodeId: openEmergencyEpisodes[a.patient_id] ?? null, accountType: p?.account_type, plan: p?.insurance_plan })}
                    >
                      <FileText className="h-3.5 w-3.5 mr-1.5" /> Type to Lab
                    </Button>
                  )}
                  {!deathReported && <SnapToCard
                    patientId={a.patient_id}
                    station={sourceStation}
                    defaultLabel="Doctor review"
                    allowTyped
                    singleAction
                    className="w-full"
                  />}
                  <Button
                    size="sm"
                    variant={newResults[a.patient_id] ? 'default' : 'outline'}
                    onClick={() => setResultsFor({ patientId: a.patient_id, name })}
                  >
                    <FlaskConical className="h-3.5 w-3.5 mr-1.5" /> Lab Results
                    {newResults[a.patient_id] ? (
                      <Badge variant="success" className="ml-1.5 text-[10px]">
                        {newResults[a.patient_id]} new
                      </Badge>
                    ) : null}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAdmissionSnapFor({ patientId: a.patient_id, name, path: a.admission_snap_path ?? null })}
                  >
                    <FileImage className="h-3.5 w-3.5 mr-1.5" /> Admission Snap
                  </Button>


                  {deathReported ? (
                    <Button size="sm" variant="destructive" disabled>
                      <HeartPulse className="h-3.5 w-3.5 mr-1.5" /> Final Settlement at Cashier
                    </Button>
                  ) : can('reportDeath') ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setDeathFor({ admissionId: a.id, name })}
                    >
                      <HeartPulse className="h-3.5 w-3.5 mr-1.5" /> Report Death
                    </Button>
                  ) : null}
                  {!deathReported && can('requestDischarge') && (
                    <Button
                      size="sm"
                      variant={isReady ? 'outline' : 'secondary'}
                      disabled={isReady}
                      onClick={() => setDischargeFor({ admissionId: a.id, patientId: a.patient_id, name, balance: bal })}
                    >
                      <LogOut className="h-3.5 w-3.5 mr-1.5" />
                      {isReady ? 'At Cashier' : 'Confirm Discharge'}
                    </Button>
                  )}
                </div>

              </div>
            );
          })}
        </div>
      )}

      {emergencyFor && (
        <EmergencyEpisodeDialog
          open
          onOpenChange={(o) => !o && setEmergencyFor(null)}
          patientId={emergencyFor.patientId}
          patientName={emergencyFor.patientName}
          visitId={emergencyFor.visitId}
          admissionId={emergencyFor.admissionId}
          onSaved={refresh}
        />
      )}

      {orderFor && (
        <AdmittedSnapDialog
          open
          onOpenChange={(o) => !o && setOrderFor(null)}
          patientId={orderFor.id}
          patientName={orderFor.name}
          patientBalance={orderFor.balance}
          sourceStation={sourceStation}
          emergencyEpisodeId={orderFor.emergencyEpisodeId}
          mode={orderFor.mode}
          orderType={orderFor.orderType}
          accountType={orderFor.accountType}
          insurancePlan={orderFor.plan}
        />
      )}

      {deathFor && (
        <ReportDeathDialog
          open
          onOpenChange={(o) => !o && setDeathFor(null)}
          admissionId={deathFor.admissionId}
          patientName={deathFor.name}
          onReported={refresh}
        />
      )}

      {dischargeFor && (
        <ConfirmDischargeDialog
          open
          onOpenChange={(o) => !o && setDischargeFor(null)}
          admissionId={dischargeFor.admissionId}
          patientName={dischargeFor.name}
        />
      )}





      {admissionSnapFor && (
        <AdmissionSnapDialog
          open
          onOpenChange={(o) => !o && setAdmissionSnapFor(null)}
          patientId={admissionSnapFor.patientId}
          patientName={admissionSnapFor.name}
          fallbackPath={admissionSnapFor.path}
        />
      )}

      {resultsFor && (
        <PatientLabResultsDialog
          open
          onOpenChange={(o) => !o && setResultsFor(null)}
          patientId={resultsFor.patientId}
          patientName={resultsFor.name}
        />
      )}
    </div>
  );
}




