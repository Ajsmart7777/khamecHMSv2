import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { usePatients } from '@/contexts/PatientContext';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  patientId: string;
  patientName?: string;
  onDischarged?: () => void;
  variant?: 'default' | 'outline' | 'secondary' | 'destructive' | 'ghost';
  className?: string;
  label?: string;
}

/** Instant discharge — no meds / no tests. Nurse & Doctor only. */
export function QuickDischargeButton({
  patientId, patientName, onDischarged, variant = 'outline', className, label = 'Discharge (No Meds/Tests)',
}: Props) {
  const { refreshPatients } = usePatients();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const discharge = async () => {
    setBusy(true);
    const { error } = await (supabase as any).rpc('discharge_patient', {
      _patient_id: patientId,
      _reason: reason.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message ?? 'Failed to discharge patient');
      return;
    }
    await refreshPatients?.();
    toast.success('Patient discharged', {
      description: patientName ? `${patientName} — visit closed.` : 'Visit closed.',
    });
    setOpen(false);
    setReason('');
    onDischarged?.();
  };

  return (
    <>
      <Button variant={variant} className={className} onClick={() => setOpen(true)}>
        <LogOut className="h-4 w-4 mr-2" />
        {label}
      </Button>

      <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discharge patient?</AlertDialogTitle>
            <AlertDialogDescription>
              {patientName ? <><span className="font-medium text-foreground">{patientName}</span> will be marked <b>discharged</b> immediately.</> : 'This patient will be marked discharged immediately.'}
              {' '}The current visit will be closed. For sponsored/insurance patients, any unpaid amount is routed to the claim automatically. Cash patients must have settled their invoice at the cashier first.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label className="text-xs">Reason (optional)</Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Reassurance given, no treatment needed" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => { e.preventDefault(); discharge(); }}
            >
              {busy ? 'Discharging…' : 'Confirm Discharge'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}