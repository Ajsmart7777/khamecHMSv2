import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { closeVisit, Visit } from '@/hooks/useVisits';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  visit: Visit | null;
  onSettled?: () => void;
}

export function SettleDischargeDialog({ open, onOpenChange, visit, onSettled }: Props) {
  const [busy, setBusy] = useState(false);
  if (!visit) return null;

  const outstanding = Number(visit.total_charged) - Number(visit.total_paid);
  const isSponsored = !!visit.sponsor_type && visit.sponsor_type !== 'normal';
  const blockCash = !isSponsored && outstanding > 0;

  const settle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await closeVisit(visit.id);
      toast.success(
        isSponsored
          ? 'Visit settled — sent to Claims queue'
          : 'Visit settled and patient discharged'
      );
      onSettled?.();
      onOpenChange(false);
    } catch (e: any) {
      console.error('Settle error:', e);
      toast.error(e.message ?? 'Failed to settle visit');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settle & Discharge · {visit.visit_number}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 rounded-lg border border-border">
              <p className="text-xs text-muted-foreground">Charged</p>
              <p className="font-semibold">₦{Number(visit.total_charged).toLocaleString()}</p>
            </div>
            <div className="p-3 rounded-lg border border-border">
              <p className="text-xs text-muted-foreground">Paid</p>
              <p className="font-semibold">₦{Number(visit.total_paid).toLocaleString()}</p>
            </div>
          </div>

          <div className="p-3 rounded-lg border border-border">
            <p className="text-xs text-muted-foreground">Outstanding</p>
            <p className={`text-lg font-bold ${outstanding > 0 ? 'text-destructive' : 'text-emerald-600'}`}>
              ₦{outstanding.toLocaleString()}
            </p>
          </div>

          {blockCash && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Cash patient still owes ₦{outstanding.toLocaleString()}. Collect full payment before discharge.
              </AlertDescription>
            </Alert>
          )}

          {isSponsored && (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Sponsored visit ({visit.sponsor_type}). Confirm the patient share is paid.
                On settle, this visit will be sent to the Claims queue automatically.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={settle} disabled={busy || blockCash}>
            {busy ? 'Settling…' : 'Settle & Discharge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
