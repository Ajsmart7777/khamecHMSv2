import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Wallet, ArrowDownCircle, Send } from 'lucide-react';
import { Patient } from '@/contexts/PatientContext';
import { useBalanceRequests } from '@/hooks/useBalanceRequests';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient;
  type: 'topup' | 'refund';
}

export function BalanceRequestDialog({ open, onOpenChange, patient, type }: Props) {
  const { createRequest } = useBalanceRequests();
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isTopup = type === 'topup';
  const patientName = `${patient.first_name} ${patient.last_name}`;

  const handleSubmit = async () => {
    setSubmitting(true);
    const ok = await createRequest(patient.id, type, patientName, notes.trim() || undefined);
    setSubmitting(false);
    if (ok) {
      setNotes('');
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isTopup ? <Wallet className="h-5 w-5 text-primary" /> : <ArrowDownCircle className="h-5 w-5 text-warning" />}
            {isTopup ? 'Send Top-Up Request' : 'Send Refund Request'}
          </DialogTitle>
          <DialogDescription>
            Forward this request to the cashier at the billing desk. The patient will finalise the amount with the cashier.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="font-medium">{patientName}</p>
            <p className="text-xs text-muted-foreground font-mono">{patient.card_number}</p>
            <p className="text-xs mt-1">Current balance: <span className="font-semibold">₦{Number(patient.balance).toLocaleString()}</span></p>
          </div>

          {!isTopup && Number(patient.balance) <= 0 && (
            <div className="text-sm text-destructive">
              Patient has no balance available to refund.
            </div>
          )}

          <div>
            <label className="text-sm font-medium mb-1.5 block">Notes (optional)</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={isTopup ? 'Any note for the cashier…' : 'Reason for refund…'}
              rows={3}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="hero"
            onClick={handleSubmit}
            disabled={submitting || (!isTopup && Number(patient.balance) <= 0)}
          >
            <Send className="h-4 w-4 mr-2" />
            Send to Cashier
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
