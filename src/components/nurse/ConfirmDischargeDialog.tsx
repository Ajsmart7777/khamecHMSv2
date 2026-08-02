import { useState } from 'react';
import { LogOut, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { sendAdmissionToCashier } from '@/hooks/useAdmissions';

interface Props {
  admissionId: string;
  patientName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmed?: () => void;
}

/**
 * Ward-side discharge confirmation. No money is handled here — the patient is
 * queued for the Cashier, and the bed stays occupied until settlement.
 */
export function ConfirmDischargeDialog({
  admissionId, patientName, open, onOpenChange, onConfirmed,
}: Props) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const ok = await sendAdmissionToCashier(admissionId, notes.trim() || undefined);
    setBusy(false);
    if (!ok) return;
    onConfirmed?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm Discharge · {patientName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="p-3 rounded-lg border bg-muted/40 flex gap-2">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              This only confirms the patient is clinically ready to go. The bill (bed nights,
              drugs, tests) is calculated and settled by the <strong>Cashier</strong>. The bed
              stays occupied until the Cashier completes the discharge.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Discharge notes (optional)</Label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. stable, follow-up in 1 week"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            <LogOut className="h-4 w-4 mr-2" />
            {busy ? 'Sending…' : 'Confirm & Send to Cashier'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
