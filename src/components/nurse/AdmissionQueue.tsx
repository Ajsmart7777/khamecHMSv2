import { useMemo, useState } from 'react';
import { BedDouble, User2, Wallet, LogOut, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAdmissions, assignBed, Admission } from '@/hooks/useAdmissions';
import { useWardsRoomsBeds } from '@/hooks/useWardsRooms';
import { usePatients } from '@/contexts/PatientContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DischargeDialog } from '@/components/nurse/DischargeDialog';
import { snapPhotoUrl } from '@/hooks/useSnapOrders';
import { useEffect } from 'react';

const fmtNaira = (n: number) => `₦${Number(n || 0).toLocaleString()}`;

const SPONSORED = ['corporate', 'nhis', 'hmo', 'katchma', 'retainer', 'staff', 'staff_family'];

export function AdmissionQueue() {
  const { admissions } = useAdmissions({
    statuses: ['waiting_assignment', 'active', 'ready_for_discharge', 'discharged'],
  });
  const { patients } = usePatients();
  const [selected, setSelected] = useState<Admission | null>(null);
  const [dischargeFor, setDischargeFor] = useState<Admission | null>(null);
  const [imgFor, setImgFor] = useState<Admission | null>(null);

  const patientOf = useMemo(() => {
    const m = new Map<string, any>();
    patients.forEach((p) => m.set(p.id, p));
    return m;
  }, [patients]);

  // Split into workflow sections
  const waiting = admissions.filter((a) => a.status === 'waiting_assignment');
  const awaitingDeposit = waiting.filter((a) => {
    const p = patientOf.get(a.patient_id);
    return p && !SPONSORED.includes(p.account_type) && Number(p.balance || 0) <= 0;
  });
  const awaitingRoom = waiting.filter((a) => !awaitingDeposit.includes(a));
  const active = admissions.filter((a) => a.status === 'active');
  const ready = admissions.filter((a) => a.status === 'ready_for_discharge');
  const completed = admissions.filter((a) => a.status === 'discharged').slice(0, 20);

  const renderRow = (a: Admission, actions: React.ReactNode, tone: 'warn' | 'ok' | 'ready' | 'done' = 'ok') => {
    const p = patientOf.get(a.patient_id);
    return (
      <div key={a.id} className="p-3 rounded-lg border flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate flex items-center gap-1.5">
            <User2 className="h-3.5 w-3.5" />
            {p ? `${p.first_name} ${p.last_name}` : 'Unknown'}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {p?.account_type ?? '—'}
            {p?.balance != null && <> · <Wallet className="h-3 w-3 inline" /> {fmtNaira(p.balance)}</>}
            {a.reason && <> · {a.reason}</>}
          </p>
        </div>
        {a.admission_snap_path && (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setImgFor(a)} title="View admission snap">
            <ImageIcon className="h-3.5 w-3.5" />
          </Button>
        )}
        {actions}
      </div>
    );
  };

  return (
    <div className="bg-card rounded-xl border p-4">
      <div className="flex items-center gap-2 mb-3">
        <BedDouble className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">Admission Queue</h3>
        <Badge variant="outline" className="text-[10px]">{admissions.length}</Badge>
      </div>

      <Tabs defaultValue="deposit">
        <TabsList className="grid grid-cols-5 h-auto">
          <TabsTrigger value="deposit" className="text-[11px]">Deposit ({awaitingDeposit.length})</TabsTrigger>
          <TabsTrigger value="room" className="text-[11px]">Room ({awaitingRoom.length})</TabsTrigger>
          <TabsTrigger value="active" className="text-[11px]">Admitted ({active.length})</TabsTrigger>
          <TabsTrigger value="ready" className="text-[11px]">Ready ({ready.length})</TabsTrigger>
          <TabsTrigger value="done" className="text-[11px]">Done ({completed.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="deposit" className="space-y-2 mt-3">
          {awaitingDeposit.length === 0 ? <Empty text="No patients awaiting deposit" /> :
            awaitingDeposit.map((a) => renderRow(a,
              <Badge variant="warning" className="text-[10px]">Deposit at Reception</Badge>, 'warn'))}
        </TabsContent>

        <TabsContent value="room" className="space-y-2 mt-3">
          {awaitingRoom.length === 0 ? <Empty text="No patients awaiting a room" /> :
            awaitingRoom.map((a) => renderRow(a,
              <Button size="sm" onClick={() => setSelected(a)}>Assign Bed</Button>, 'ok'))}
        </TabsContent>

        <TabsContent value="active" className="space-y-2 mt-3">
          {active.length === 0 ? <Empty text="No admitted patients" /> :
            active.map((a) => renderRow(a,
              <Badge variant="success" className="text-[10px]">Admitted</Badge>, 'ok'))}
        </TabsContent>

        <TabsContent value="ready" className="space-y-2 mt-3">
          {ready.length === 0 ? <Empty text="No discharge orders yet" /> :
            ready.map((a) => renderRow(a,
              <Button size="sm" variant="secondary" onClick={() => setDischargeFor(a)}>
                <LogOut className="h-3.5 w-3.5 mr-1" /> Complete Discharge
              </Button>, 'ready'))}
        </TabsContent>

        <TabsContent value="done" className="space-y-2 mt-3">
          {completed.length === 0 ? <Empty text="No recent discharges" /> :
            completed.map((a) => renderRow(a,
              <Badge variant="outline" className="text-[10px]">Discharged</Badge>, 'done'))}
        </TabsContent>
      </Tabs>

      {imgFor && <AdmissionSnapViewer admission={imgFor} onClose={() => setImgFor(null)} />}
      {dischargeFor && (() => {
        const p = patientOf.get(dischargeFor.patient_id);
        return (
          <DischargeDialog
            open
            onOpenChange={(o) => !o && setDischargeFor(null)}
            admissionId={dischargeFor.id}
            patientId={dischargeFor.patient_id}
            patientName={p ? `${p.first_name} ${p.last_name}` : 'Patient'}
            patientBalance={Number(p?.balance ?? 0)}
          />
        );
      })()}

      {selected && (
        <AssignBedDialog
          admission={selected}
          patient={patientOf.get(selected.patient_id)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground text-center py-6">{text}</p>;
}

function AdmissionSnapViewer({ admission, onClose }: { admission: Admission; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (admission.admission_snap_path) {
      snapPhotoUrl(admission.admission_snap_path).then((u) => { if (alive) setUrl(u); });
    }
    return () => { alive = false; };
  }, [admission.admission_snap_path]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Admission Order Snap</DialogTitle></DialogHeader>
        {url ? <img src={url} alt="admission order" className="w-full max-h-[70vh] object-contain rounded" />
             : <p className="text-sm text-muted-foreground">Loading…</p>}
        {admission.admission_note && (
          <p className="text-sm bg-muted/50 p-2 rounded">{admission.admission_note}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AssignBedDialog({ admission, patient, onClose }: {
  admission: Admission;
  patient?: any;
  onClose: () => void;
}) {
  const { wards, rooms, beds } = useWardsRoomsBeds();
  const [wardId, setWardId] = useState<string>('');
  const [roomId, setRoomId] = useState<string>('');
  const [bedId, setBedId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState('');

  const availableRooms = rooms.filter((r) => r.ward_id === wardId && r.active);
  const availableBeds = beds.filter((b) => b.room_id === roomId && b.status === 'available' && b.active);

  const sponsored = ['corporate', 'nhis', 'hmo', 'katchma', 'retainer', 'staff', 'staff_family'].includes(patient?.account_type);
  const selectedWard = wards.find((w) => w.id === wardId);
  const requiredMin = Number(selectedWard?.min_admission_deposit ?? 0);
  const patientBalance = Number(patient?.balance ?? 0);
  const depositShort = !sponsored && requiredMin > 0 && patientBalance < requiredMin;

  const submit = async () => {
    if (!bedId) return;
    setBusy(true);
    const ok = await assignBed(admission.id, bedId);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign Ward & Bed</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {patient && (
            <div className="p-3 rounded-lg bg-muted/50 space-y-1">
              <p className="text-sm font-medium">{patient.first_name} {patient.last_name}</p>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">{patient.account_type}</Badge>
                <Badge variant={sponsored ? 'success' : (patient.balance > 0 ? 'success' : 'warning')}>
                  <Wallet className="h-3 w-3 mr-1" />
                  Balance: {fmtNaira(patient.balance)}
                </Badge>
              </div>
              {!sponsored && patientBalance <= 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  ⚠ Send patient to Reception to deposit before bed can be assigned.
                </p>
              )}
              {!sponsored && depositShort && patientBalance > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  ⚠ Deposit short by {fmtNaira(requiredMin - patientBalance)} for {selectedWard?.name}. Top up at Reception.
                </p>
              )}
              {sponsored && (
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  ✓ Sponsored / insured — proceed to assign bed. Invoice will be issued on discharge.
                </p>
              )}
            </div>
          )}

          <div>
            <Label>Ward *</Label>
            <Select value={wardId} onValueChange={(v) => { setWardId(v); setRoomId(''); setBedId(''); }}>
              <SelectTrigger><SelectValue placeholder="Select ward" /></SelectTrigger>
              <SelectContent>
                {wards.filter((w) => w.active).map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name} · {w.gender}
                    {w.min_admission_deposit > 0 && ` · min ${fmtNaira(w.min_admission_deposit)}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Room *</Label>
            <Select value={roomId} onValueChange={(v) => { setRoomId(v); setBedId(''); }} disabled={!wardId}>
              <SelectTrigger><SelectValue placeholder="Select room" /></SelectTrigger>
              <SelectContent>
                {availableRooms.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    Room {r.room_number} · {r.room_class} · {fmtNaira(r.daily_rate)}/day
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Available Bed *</Label>
            <Select value={bedId} onValueChange={setBedId} disabled={!roomId}>
              <SelectTrigger><SelectValue placeholder="Select bed" /></SelectTrigger>
              <SelectContent>
                {availableBeds.length === 0 ? (
                  <div className="p-2 text-xs text-muted-foreground">No beds available in this room</div>
                ) : availableBeds.map((b) => (
                  <SelectItem key={b.id} value={b.id}>Bed {b.bed_label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !bedId}>
            {busy ? 'Assigning…' : depositShort ? 'Assign Anyway (deposit short)' : 'Assign Bed & Admit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
