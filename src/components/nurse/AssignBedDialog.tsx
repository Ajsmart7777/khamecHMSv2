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
  const [category, setCategory] = useState<'normal' | 'vip' | ''>('');
  const [wardId, setWardId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [busy, setBusy] = useState(false);

  const categoryWards = wards.filter((w) => w.active && w.ward_type === category);
  const bedOfRoom = (rid: string) =>
    beds.find((b) => b.room_id === rid && b.active && b.status === 'available');
  const availableRooms = rooms.filter((r) => r.ward_id === wardId && r.active && bedOfRoom(r.id));
  const bedId = roomId ? bedOfRoom(roomId)?.id ?? '' : '';

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
            <Label>Room type *</Label>
            <Select
              value={category}
              onValueChange={(v) => { setCategory(v as 'normal' | 'vip'); setWardId(''); setRoomId(''); }}
            >
              <SelectTrigger><SelectValue placeholder="Select room type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal Room</SelectItem>
                <SelectItem value="vip">VIP Room</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Ward *</Label>
            <Select value={wardId} onValueChange={(v) => { setWardId(v); setRoomId(''); }} disabled={!category}>
              <SelectTrigger><SelectValue placeholder="Select ward" /></SelectTrigger>
              <SelectContent>
                {categoryWards.length === 0 ? (
                  <div className="p-2 text-xs text-muted-foreground">No wards in this category</div>
                ) : categoryWards.map((w) => (
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
            <Select value={roomId} onValueChange={setRoomId} disabled={!wardId}>
              <SelectTrigger><SelectValue placeholder="Select room" /></SelectTrigger>
              <SelectContent>
                {availableRooms.length === 0 ? (
                  <div className="p-2 text-xs text-muted-foreground">No free rooms in this ward</div>
                ) : availableRooms.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    Room {r.room_number} · {fmtNaira(r.daily_rate)}/day
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">
              Each room holds one bed — it is assigned automatically.
            </p>
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