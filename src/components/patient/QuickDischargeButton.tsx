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
  const { updatePatientStatus } = usePatients();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const discharge = async () => {
    setBusy(true);
    const ok = await updatePatientStatus(patientId, 'discharged');
    if (ok) {
      const { data: userRes } = await supabase.auth.getUser();
      try {
        await (supabase as any).rpc('write_audit_log', {
          _action: 'quick_discharge',
          _resource_type: 'patient',
          _resource_id: patientId,
          _details: { reason: reason || null, actor: userRes.user?.id ?? null },
        });
      } catch { /* audit is best-effort */ }
      toast.success('Patient discharged', {
        description: patientName ? `${patientName} has been discharged.` : undefined,
      });
      setOpen(false);
      setReason('');
      onDischarged?.();
    }
    setBusy(false);
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
            <AlertDialogTitle>Discharge patient without meds or tests?</AlertDialogTitle>
            <AlertDialogDescription>
              {patientName ? <><span className="font-medium text-foreground">{patientName}</span> will be marked <b>discharged</b> immediately.</> : 'This patient will be marked discharged immediately.'}
              {' '}No prescription or lab request will be created. Use this only when the visit ends with advice or reassurance only.
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