import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Wallet } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { assignBed, Admission } from '@/hooks/useAdmissions';
import { useWardsRoomsBeds } from '@/hooks/useWardsRooms';
import { copayPercent, sponsorLabel } from '@/lib/copay';

const fmtNaira = (n: number) => `₦${Number(n || 0).toLocaleString()}`;

interface Props {
  admission: Admission;
  patient?: any;
  onClose: () => void;
}

/** Nurse picks ward → room → bed. Once assigned the patient becomes admitted. */
export function AssignBedDialog({ admission, patient, onClose }: Props) {
  const { wards, rooms, beds } = useWardsRoomsBeds();
  const [wardId, setWardId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [bedId, setBedId] = useState('');
  const [busy, setBusy] = useState(false);

  const availableRooms = rooms.filter((r) => r.ward_id === wardId && r.active);
  const availableBeds = beds.filter((b) => b.room_id === roomId && b.status === 'available' && b.active);

  const pct = copayPercent({ account_type: patient?.account_type, insurance_plan: patient?.insurance_plan });
  const selectedWard = wards.find((w) => w.id === wardId);
  const requiredMin = Number(selectedWard?.min_admission_deposit ?? 0);
  const balance = Number(patient?.balance ?? 0);
  const depositShort = pct > 0 && requiredMin > 0 && balance < requiredMin;

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
          <DialogTitle>Assign Ward &amp; Room</DialogTitle>
          <DialogDescription>
            Once a bed is assigned the patient moves to Admitted Patients and bed-days start counting.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {patient && (
            <div className="p-3 rounded-lg bg-muted/50 space-y-1">
              <p className="text-sm font-medium">{patient.first_name} {patient.last_name}</p>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">{sponsorLabel({ account_type: patient.account_type, insurance_plan: patient.insurance_plan })}</Badge>
                <Badge variant={pct === 0 ? 'success' : balance > 0 ? 'success' : 'warning'}>
                  <Wallet className="h-3 w-3 mr-1" /> Balance: {fmtNaira(balance)}
                </Badge>
                <Badge variant="outline">Copay {pct}%</Badge>
              </div>
              {pct === 0 ? (
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  ✓ Fully covered by sponsor — no deposit required.
                </p>
              ) : depositShort ? (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  ⚠ Deposit short by {fmtNaira(requiredMin - balance)} for {selectedWard?.name}. Patient can top up at Reception → Cashier, or you can assign anyway.
                </p>
              ) : null}
            </div>
          )}

          <div>
            <Label>Ward *</Label>
            <Select value={wardId} onValueChange={(v) => { setWardId(v); setRoomId(''); setBedId(''); }}>
              <SelectTrigger><SelectValue placeholder="Select ward" /></SelectTrigger>
              <SelectContent>
                {wards.filter((w) => w.active).map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
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
            <Label>Available bed *</Label>
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
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !bedId}>
            {busy ? 'Assigning…' : depositShort ? 'Assign anyway (deposit short)' : 'Assign bed & admit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}