import { useEffect, useMemo, useState } from 'react';
import { BedDouble, Camera, LogOut, User2, Wallet, ScrollText, Beaker, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAdmissions } from '@/hooks/useAdmissions';
import { usePatients } from '@/contexts/PatientContext';
import { AdmittedSnapDialog } from './AdmittedSnapDialog';
import { SnapToCard } from './SnapToCard';

import { DischargeDialog } from '@/components/nurse/DischargeDialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

import { useWardsRoomsBeds } from '@/hooks/useWardsRooms';
import { LabResultsViewer } from '@/components/doctor/LabResultsViewer';
import { SnapLabResults } from '@/components/doctor/SnapLabResults';
import { useAdmissionPerms } from '@/lib/admissionPermissions';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

interface Props {
  sourceStation: 'nurse' | 'doctor';
  title?: string;
  assignedDoctor?: 'doctor1' | 'doctor2';
}

/**
 * Panel of currently-admitted patients. The patient card stays with Nurse
 * throughout admission — this panel only creates tasks (forward existing
 * snaps to Pharmacy/Lab via Billing, sign a discharge order, or discharge).
 */
export function AdmittedPatientsPanel({ sourceStation, title = 'Admitted Patients', assignedDoctor }: Props) {
  const { admissions } = useAdmissions({ statuses: ['active', 'ready_for_discharge'] });
  const { patients } = usePatients();
  const [orderFor, setOrderFor] = useState<{
    id: string; name: string; balance: number;
    mode: 'items' | 'snap';
    orderType: 'prescription' | 'lab' | 'treatment';
    accountType?: string | null; plan?: string | null;
  } | null>(null);
  const [dischargeFor, setDischargeFor] = useState<{ admissionId: string; patientId: string; name: string; balance: number } | null>(null);

  
  const [resultsFor, setResultsFor] = useState<{ patientId: string; name: string } | null>(null);
  const { rooms, beds } = useWardsRoomsBeds();
  const can = useAdmissionPerms();
  const { user } = useAuth();
  const userId = user?.id;

  // New (un-archived) lab result photos per admitted patient
  const [newResults, setNewResults] = useState<Record<string, number>>({});
  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data } = await supabase
        .from('snap_orders')
        .select('patient_id')
        .eq('order_type', 'lab_result')
        .eq('status', 'returned');
      if (!active) return;
      const counts: Record<string, number> = {};
      (data ?? []).forEach((r: any) => { counts[r.patient_id] = (counts[r.patient_id] ?? 0) + 1; });
      setNewResults(counts);
    };
    load();
    const ch = supabase
      .channel(`admitted-lab-results-${Math.random().toString(36).slice(2)}`)
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

  // Every admitted patient in the hospital is visible in every doctor console,
  // regardless of who admitted them or who they are assigned to.
  const scoped = admissions;


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
            const name = `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim();
            const bed = a.bed_id ? bedInfo.get(a.bed_id) : undefined;
            const days = a.admitted_at
              ? Math.max(1, Math.ceil((Date.now() - new Date(a.admitted_at).getTime()) / 86_400_000))
              : 0;
            const accrued = bed ? days * bed.rate : 0;
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
                    {bed && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {bed.label} · {days} day{days === 1 ? '' : 's'} · bed charge ₦{accrued.toLocaleString()}
                      </p>
                    )}
                  </div>
                  {isReady ? (
                    <Badge variant="info" className="text-[10px]">Ready for Discharge</Badge>
                  ) : (
                    <Badge variant={low ? 'warning' : 'success'} className="text-[10px]">
                      <Wallet className="h-3 w-3 mr-1" />
                      ₦{bal.toLocaleString()}
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {can('admittedSnap') && (
                    <Button
                      size="sm"
                      onClick={() => setOrderFor({ id: a.patient_id, name, balance: bal, mode: 'items', orderType: 'prescription', accountType: p?.account_type, plan: p?.insurance_plan })}
                    >
                      <ScrollText className="h-3.5 w-3.5 mr-1.5" /> Add Items · Pharmacy
                    </Button>
                  )}
                  {can('admittedSnap') && (
                    <Button
                      size="sm"
                      onClick={() => setOrderFor({ id: a.patient_id, name, balance: bal, mode: 'items', orderType: 'lab', accountType: p?.account_type, plan: p?.insurance_plan })}
                    >
                      <Beaker className="h-3.5 w-3.5 mr-1.5" /> Add Lab Tests
                    </Button>
                  )}
                  {can('admittedSnap') && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setOrderFor({ id: a.patient_id, name, balance: bal, mode: 'snap', orderType: 'prescription', accountType: p?.account_type, plan: p?.insurance_plan })}
                    >
                      <Camera className="h-3.5 w-3.5 mr-1.5" /> Snap → Pharmacy
                    </Button>
                  )}
                  {can('admittedSnap') && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setOrderFor({ id: a.patient_id, name, balance: bal, mode: 'snap', orderType: 'lab', accountType: p?.account_type, plan: p?.insurance_plan })}
                    >
                      <Camera className="h-3.5 w-3.5 mr-1.5" /> Snap → Lab
                    </Button>
                  )}
                  <SnapToCard
                    patientId={a.patient_id}
                    station={sourceStation}
                    defaultLabel="Ward note"
                    className="w-full"
                  />
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

                  {can('discharge') && (
                    <Button
                      size="sm"
                      variant={isReady ? 'default' : 'secondary'}
                      onClick={() => setDischargeFor({ admissionId: a.id, patientId: a.patient_id, name, balance: bal })}
                    >
                      <LogOut className="h-3.5 w-3.5 mr-1.5" /> Discharge
                    </Button>
                  )}
                </div>

              </div>
            );
          })}
        </div>
      )}

      {orderFor && (
        <AdmittedSnapDialog
          open
          onOpenChange={(o) => !o && setOrderFor(null)}
          patientId={orderFor.id}
          patientName={orderFor.name}
          patientBalance={orderFor.balance}
          sourceStation={sourceStation}
          mode={orderFor.mode}
          orderType={orderFor.orderType}
          accountType={orderFor.accountType}
          insurancePlan={orderFor.plan}
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





      {resultsFor && (
        <Dialog open onOpenChange={(o) => !o && setResultsFor(null)}>
          <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Lab Results · {resultsFor.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <SnapLabResults patientId={resultsFor.patientId} />
              <LabResultsViewer patientId={resultsFor.patientId} />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setResultsFor(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}




