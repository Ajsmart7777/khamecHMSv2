import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, PlayCircle, RotateCw } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { findOpenVisit, openOrResumeVisit, Visit } from '@/hooks/useVisits';

interface CheckInDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  patientId: string;
  patientName: string;
  onCheckedIn?: (visitId: string) => void;
}

export function CheckInDialog({ open, onOpenChange, patientId, patientName, onCheckedIn }: CheckInDialogProps) {
  const [existing, setExisting] = useState<Visit | null>(null);
  const [complaint, setComplaint] = useState('');
  const [forceReason, setForceReason] = useState('');
  const [mode, setMode] = useState<'resume' | 'new'>('resume');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setComplaint('');
    setForceReason('');
    setMode('resume');
    findOpenVisit(patientId).then((v) => {
      setExisting(v);
      setMode(v ? 'resume' : 'new');
    });
  }, [open, patientId]);

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'new' && existing && !forceReason.trim()) {
        toast.error('Please give a reason for opening a new visit');
        setBusy(false);
        return;
      }
      const id = await openOrResumeVisit({
        patientId,
        presentingComplaint: complaint.trim() || undefined,
        forceNew: mode === 'new',
        forceNewReason: mode === 'new' ? forceReason.trim() : undefined,
      });
      toast.success(mode === 'new' ? 'New visit opened' : existing ? 'Resumed open visit' : 'Visit opened');
      onCheckedIn?.(id);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to check in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Check In · {patientName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {existing && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                This patient already has an open visit{' '}
                <span className="font-mono font-semibold">{existing.visit_number}</span> opened{' '}
                {format(new Date(existing.opened_at), 'MMM d, HH:mm')}. You can resume it or open a
                brand-new visit.
              </AlertDescription>
            </Alert>
          )}

          {existing && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={mode === 'resume' ? 'default' : 'outline'}
                onClick={() => setMode('resume')}
                className="justify-start"
              >
                <RotateCw className="h-4 w-4 mr-2" />
                Resume
              </Button>
              <Button
                variant={mode === 'new' ? 'default' : 'outline'}
                onClick={() => setMode('new')}
                className="justify-start"
              >
                <PlayCircle className="h-4 w-4 mr-2" />
                New visit
              </Button>
            </div>
          )}

          {(!existing || mode === 'new') && (
            <div className="space-y-1.5">
              <Label htmlFor="complaint">Presenting complaint (optional)</Label>
              <Textarea
                id="complaint"
                placeholder="e.g. Fever and headache for 2 days"
                value={complaint}
                onChange={(e) => setComplaint(e.target.value)}
                rows={2}
                maxLength={500}
              />
            </div>
          )}

          {existing && mode === 'new' && (
            <div className="space-y-1.5">
              <Label htmlFor="reason" className="text-destructive">Reason for new visit *</Label>
              <Input
                id="reason"
                placeholder="e.g. Separate follow-up under different sponsor"
                value={forceReason}
                onChange={(e) => setForceReason(e.target.value)}
                maxLength={200}
              />
              <p className="text-xs text-muted-foreground">This reason is logged to the audit trail.</p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Working…' : mode === 'new' ? 'Open new visit' : existing ? 'Resume visit' : 'Open visit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
