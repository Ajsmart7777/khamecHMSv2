import { useState } from 'react';
import { LogOut, AlertTriangle, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';
import { usePatients } from '@/contexts/PatientContext';
import { supabase } from '@/integrations/supabase/client';
import { useEffect } from 'react';
import { getPendingWorkflowStation, workflowStationLabel, PendingWorkflowStation } from '@/lib/workflowRouting';
import { useNavigate } from 'react-router-dom';

interface Props {
  patientId: string;
  patientName?: string;
  onDischarged?: () => void;
  variant?: 'default' | 'outline' | 'secondary' | 'destructive' | 'ghost';
  className?: string;
  label?: string;
}

const stationRoute: Record<PendingWorkflowStation, string> = {
  awaiting_billing: '/billing',
  awaiting_payment: '/cashier',
  in_lab: '/laboratory',
  at_pharmacy: '/pharmacy',
};

const stationNextStep: Record<PendingWorkflowStation, string> = {
  awaiting_billing: 'Billing must generate an invoice from the pending order before discharge.',
  awaiting_payment: 'Cashier must collect payment (or copay) on the outstanding invoice before discharge.',
  in_lab: 'Lab must complete and return the test results before discharge.',
  at_pharmacy: 'Pharmacy must dispense the pending medication before discharge.',
};

/** Instant discharge — no meds / no tests. Nurse & Doctor only. */
export function QuickDischargeButton({
  patientId, patientName, onDischarged, variant = 'outline', className, label = 'Discharge (No Meds/Tests)',
}: Props) {
  const { updatePatientStatus } = usePatients();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [blockedAt, setBlockedAt] = useState<PendingWorkflowStation | null>(null);

  useEffect(() => {
    if (!open) { setBlockedAt(null); return; }
    let cancelled = false;
    setChecking(true);
    getPendingWorkflowStation(patientId)
      .then((s) => { if (!cancelled) setBlockedAt(s); })
      .catch(() => { /* silent — surfaces on submit */ })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [open, patientId]);

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
    } else {
      // updatePatientStatus already toasted; refresh the blocker so the dialog explains why
      try {
        const s = await getPendingWorkflowStation(patientId);
        setBlockedAt(s);
      } catch { /* ignore */ }
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

          {checking && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking pending workflow…
            </div>
          )}

          {!checking && blockedAt && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Cannot discharge — pending {workflowStationLabel(blockedAt)} step</AlertTitle>
              <AlertDescription className="space-y-2">
                <p className="text-xs">
                  This patient still has an open task at <b>{workflowStationLabel(blockedAt)}</b>
                  {blockedAt === 'awaiting_payment' && ' (outstanding invoice not yet paid)'}.
                  {' '}The workflow engine blocks discharge until it clears.
                </p>
                <p className="text-xs"><b>Next step:</b> {stationNextStep[blockedAt]}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1"
                  onClick={() => { setOpen(false); navigate(stationRoute[blockedAt]); }}
                >
                  Go to {workflowStationLabel(blockedAt)} <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label className="text-xs">Reason (optional)</Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Reassurance given, no treatment needed" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || checking || !!blockedAt}
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