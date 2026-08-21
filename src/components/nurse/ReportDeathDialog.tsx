import { useState } from 'react';
import { AlertTriangle, HeartPulse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { reportAdmissionDeath } from '@/hooks/useAdmissions';

interface Props {
  admissionId: string;
  patientName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReported?: () => void;
}

const localDateTime = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function ReportDeathDialog({ admissionId, patientName, open, onOpenChange, onReported }: Props) {
  const [deathAt, setDeathAt] = useState(localDateTime);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    const when = new Date(deathAt);
    if (Number.isNaN(when.getTime())) {
      toast.error('Enter the date and time of death');
      return;
    }
    if (when.getTime() > Date.now()) {
      toast.error('Death time cannot be in the future');
      return;
    }
    setBusy(true);
    const ok = await reportAdmissionDeath(admissionId, when.toISOString(), notes.trim() || null);
    setBusy(false);
    if (!ok) return;
    toast.success('Death reported', {
      description: 'The patient remains in the ward until Cashier completes final settlement.',
    });
    onReported?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <HeartPulse className="h-5 w-5" /> Report Patient Death
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-medium flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {patientName}</p>
            <p className="mt-1 text-muted-foreground">
              This records the death report only. The bed will remain occupied and the case will go to Cashier for final settlement, refund, or debt clearance.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="death-at">Date and time of death</Label>
            <Input id="death-at" type="datetime-local" value={deathAt} max={localDateTime()} onChange={(e) => setDeathAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="death-notes">Notes (optional)</Label>
            <Textarea id="death-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Enter a brief clinical or administrative note" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : 'Confirm Report Death'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
