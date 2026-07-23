import { useRef, useState } from 'react';
import { Camera, Send, X, FlaskConical, Pill, ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useActiveVisit, openOrResumeVisit } from '@/hooks/useVisits';
import { uploadVisitAttachment, VisitStation } from '@/hooks/useVisitAttachments';
import { createSnapOrder, SnapOrderType, SnapTargetStation } from '@/hooks/useSnapOrders';
import { useAuth } from '@/contexts/AuthContext';
import { useCanSnap } from '@/hooks/useCanSnap';
import { usePatients } from '@/contexts/PatientContext';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Lock } from 'lucide-react';

interface Props {
  patientId: string;
  sourceStation: VisitStation; // 'nurse' | 'doctor'
  defaultOrderType?: SnapOrderType;
  defaultTarget?: SnapTargetStation;
  variant?: 'default' | 'outline' | 'secondary';
  size?: 'sm' | 'default' | 'lg';
  className?: string;
  label?: string;
}

/**
 * Clinical snap: capture paper Rx/Lab/Treatment → route to Billing.
 * After payment, the snap auto-flips to `paid` and appears in Pharmacy/Lab queue.
 */
export function SnapClinicalOrder({
  patientId,
  sourceStation,
  defaultOrderType = 'prescription',
  defaultTarget,
  variant = 'default',
  size = 'default',
  className,
  label = 'Snap & Send to Billing',
}: Props) {
  const { role } = useAuth();
  const { visit, refresh } = useActiveVisit(patientId);
  const { allowed, reason, loading: checking } = useCanSnap(patientId);
  const { updatePatientStatus } = usePatients();
  const { getPatientById } = usePatients();
  const patient = getPatientById(patientId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [orderType, setOrderType] = useState<SnapOrderType>(defaultOrderType);
  const [target, setTarget] = useState<SnapTargetStation>(
    defaultTarget ?? (defaultOrderType === 'lab' ? 'lab' : 'pharmacy'),
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const onOrderTypeChange = (v: SnapOrderType) => {
    setOrderType(v);
    if (v === 'lab') setTarget('lab');
    else if (v === 'prescription') setTarget('pharmacy');
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    e.target.value = '';
  };

  const close = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFile(null);
    setNote('');
    setConfirmOpen(false);
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      let visitId = visit?.id;
      if (!visitId) {
        visitId = await openOrResumeVisit({ patientId });
        await refresh();
      }
      if (!visitId) throw new Error('Could not open a visit');

      // 1. Upload image to visit-cards bucket
      const path = `${visitId}/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from('visit-cards')
        .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
      if (upErr) throw upErr;

      // 2. Attach to visit envelope (for the card timeline)
      await uploadVisitAttachment({
        visitId,
        patientId,
        file,
        label: `${orderType} → ${target}`,
        station: sourceStation,
      }).catch(() => null);

      // 3. Create snap_order row for billing queue
      const snap = await createSnapOrder({
        patientId,
        visitId,
        orderType,
        targetStation: target,
        sourceRole: role ?? sourceStation,
        photoPath: path,
        note: note.trim(),
      });
      if (!snap) throw new Error('Snap order not created');

      // Route the patient card:
      //  - target=nurse  → send patient back to nurse queue
      //  - otherwise     → queue for Billing (payment flips it to Pharmacy/Lab)
      if (target === 'nurse') {
        await updatePatientStatus(patientId, 'with_nurse').catch(() => null);
        toast.success('Sent back to Nurse', {
          description: 'Nurse will pick up the card for the next action.',
        });
      } else {
        await updatePatientStatus(patientId, 'awaiting_billing').catch(() => null);
        toast.success('Sent to Billing', {
          description: `${orderType === 'lab' ? 'Lab test' : orderType === 'prescription' ? 'Prescription' : 'Treatment'} pending billing.`,
        });
      }
      close();
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to send snap');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFile}
        className="hidden"
      />
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={allowed ? '' : 'inline-block'}>
              <Button
                variant={variant}
                size={size}
                className={className}
                onClick={() => inputRef.current?.click()}
                disabled={!allowed || checking}
                aria-disabled={!allowed}
              >
                {allowed
                  ? <Camera className="h-4 w-4 mr-2" />
                  : <Lock className="h-4 w-4 mr-2" />}
                {label}
              </Button>
            </span>
          </TooltipTrigger>
          {!allowed && reason && (
            <TooltipContent side="top" className="max-w-xs">{reason}</TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>

      <Dialog open={!!previewUrl} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send Order to Billing</DialogTitle>
          </DialogHeader>

          {previewUrl && (
            <div className="space-y-4">
              <div className="rounded-lg overflow-hidden bg-muted flex items-center justify-center max-h-[40vh]">
                <img src={previewUrl} alt="preview" className="max-h-[40vh] object-contain" />
              </div>

              <div className="space-y-2">
                <Label>Order Type</Label>
                <RadioGroup
                  value={orderType}
                  onValueChange={(v) => onOrderTypeChange(v as SnapOrderType)}
                  className="grid grid-cols-3 gap-2"
                >
                  <label className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-muted">
                    <RadioGroupItem value="prescription" />
                    <Pill className="h-4 w-4" /> <span className="text-sm">Prescription</span>
                  </label>
                  <label className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-muted">
                    <RadioGroupItem value="lab" />
                    <FlaskConical className="h-4 w-4" /> <span className="text-sm">Lab</span>
                  </label>
                  <label className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-muted">
                    <RadioGroupItem value="treatment" />
                    <ClipboardList className="h-4 w-4" /> <span className="text-sm">Treatment</span>
                  </label>
                </RadioGroup>
              </div>

              {orderType === 'treatment' && (
                <div className="space-y-2">
                  <Label>Route to</Label>
                  <RadioGroup
                    value={target}
                    onValueChange={(v) => setTarget(v as SnapTargetStation)}
                    className="grid grid-cols-3 gap-2"
                  >
                    <label className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-muted">
                      <RadioGroupItem value="pharmacy" />
                      <span className="text-sm">Pharmacy</span>
                    </label>
                    <label className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-muted">
                      <RadioGroupItem value="lab" />
                      <span className="text-sm">Lab</span>
                    </label>
                    {sourceStation === 'doctor' && (
                      <label className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-muted">
                        <RadioGroupItem value="nurse" />
                        <span className="text-sm">Nurse (review)</span>
                      </label>
                    )}
                  </RadioGroup>
                  {target === 'nurse' && (
                    <p className="text-xs text-muted-foreground">
                      Nurse will review the snap and forward it to Billing.
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="snap-note">Note for billing (optional)</Label>
                <Input
                  id="snap-note"
                  placeholder="e.g. urgent, patient waiting"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={200}
                />
              </div>

              <p className="text-xs text-muted-foreground">
                Billing will OCR the image, price it, and collect payment.
                Once paid, this order appears in <span className="font-medium capitalize">{target}</span>.
                {visit && <> · Visit: <span className="font-mono">{visit.visit_number}</span></>}
              </p>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={close} disabled={busy}>
              <X className="h-4 w-4 mr-2" /> Cancel
            </Button>
            <Button onClick={() => setConfirmOpen(true)} disabled={busy}>
              <Send className="h-4 w-4 mr-2" />
              {busy ? 'Sending…' : 'Review & Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={(o) => !busy && setConfirmOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Confirm: Snap → {target === 'pharmacy' ? 'Pharmacy' : target === 'lab' ? 'Lab' : 'Nurse'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div className="rounded-md border p-3 bg-muted/40 space-y-1">
                  <div>
                    <span className="text-muted-foreground">Patient: </span>
                    <span className="font-semibold text-foreground">
                      {patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown'}
                    </span>
                    {patient?.card_number && (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {patient.card_number}
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Order type: </span>
                    <span className="font-medium capitalize text-foreground">{orderType}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Destination: </span>
                    <span className="font-medium capitalize text-foreground">
                      {target === 'nurse' ? 'Nurse (review)' : target}
                    </span>
                  </div>
                  {note.trim() && (
                    <div>
                      <span className="text-muted-foreground">Note: </span>
                      <span className="text-foreground">{note.trim()}</span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {target === 'nurse'
                    ? 'The patient card will move back to the Nurse queue for the next action.'
                    : `Billing will price this snap; once paid it appears in ${target}.`}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Go back</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (e) => {
                e.preventDefault();
                await submit();
                setConfirmOpen(false);
              }}
            >
              {busy ? 'Sending…' : 'Confirm & Send'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
