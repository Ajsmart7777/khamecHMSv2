import { useRef, useState } from 'react';
import { Camera, Send, Lock, Crop } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useActiveVisit, openOrResumeVisit } from '@/hooks/useVisits';
import { uploadVisitAttachment, VisitStation } from '@/hooks/useVisitAttachments';
import { createSnapOrder, SnapOrderType, SnapTargetStation } from '@/hooks/useSnapOrders';
import { useAuth } from '@/contexts/AuthContext';
import { useCanSnap } from '@/hooks/useCanSnap';
import { usePatients } from '@/contexts/PatientContext';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SnapCropDialog } from './SnapCropDialog';

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
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [orderType] = useState<SnapOrderType>(defaultOrderType);
  const [target] = useState<SnapTargetStation>(
    defaultTarget ?? (defaultOrderType === 'lab' ? 'lab' : 'pharmacy'),
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    // Reset the input immediately so re-selecting the same photo re-fires change.
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    try {
      const url = URL.createObjectURL(f);
      // Clean up any lingering blob from a previous aborted snap.
      if (rawUrl) URL.revokeObjectURL(rawUrl);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setFile(null);
      setRawFile(f);
      setRawUrl(url);
      setCropOpen(true);
    } catch (err) {
      console.error('[SnapClinicalOrder] failed to open captured photo', err);
      toast.error('Could not open the photo — please try again');
    }
  };

  const close = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (rawUrl) URL.revokeObjectURL(rawUrl);
    setPreviewUrl(null);
    setFile(null);
    setRawUrl(null);
    setRawFile(null);
    setCropOpen(false);
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

      {rawUrl && rawFile && (
        <SnapCropDialog
          open={cropOpen}
          imageUrl={rawUrl}
          originalFile={rawFile}
          onCancel={() => {
            // Cancelling crop aborts the snap.
            close();
          }}
          onConfirm={(croppedFile, croppedUrl) => {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setFile(croppedFile);
            setPreviewUrl(croppedUrl);
            setCropOpen(false);
            // Radix locks body pointer-events while a Dialog is open. On mobile,
            // opening a second dialog on the same tick can leave the lock stuck.
            // Defer the confirm dialog until the crop dialog has fully unmounted.
            setTimeout(() => {
              // Safety net: force-clear any leftover pointer-events lock.
              if (typeof document !== 'undefined') {
                document.body.style.pointerEvents = '';
              }
              setConfirmOpen(true);
            }, 150);
          }}
        />
      )}

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (busy) return;
          if (!o) close();
        }}
      >
        <AlertDialogContent className="sm:max-w-lg max-h-[95vh] overflow-y-auto p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Confirm: Snap → {target === 'pharmacy' ? 'Pharmacy' : target === 'lab' ? 'Lab' : 'Nurse'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {previewUrl && (
                  <div className="rounded-lg overflow-hidden bg-muted flex items-center justify-center max-h-[35vh]">
                    <img
                      src={previewUrl}
                      alt="cropped snap"
                      className="max-h-[35vh] object-contain"
                    />
                  </div>
                )}
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
                  {visit && (
                    <div>
                      <span className="text-muted-foreground">Visit: </span>
                      <span className="font-mono text-xs text-foreground">
                        {visit.visit_number}
                      </span>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="snap-note-confirm" className="text-xs">
                    Note (optional)
                  </Label>
                  <Input
                    id="snap-note-confirm"
                    placeholder="e.g. urgent, patient waiting"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={200}
                    disabled={busy}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {target === 'nurse'
                    ? 'The patient card will move back to the Nurse queue for the next action.'
                    : `Billing will price this snap; once paid it appears in ${target}.`}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setConfirmOpen(false);
                setCropOpen(true);
              }}
              disabled={busy || !rawUrl}
            >
              <Crop className="h-3.5 w-3.5 mr-1" /> Re-crop
            </Button>
            <AlertDialogCancel disabled={busy} onClick={close}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (e) => {
                e.preventDefault();
                await submit();
              }}
            >
              <Send className="h-3.5 w-3.5 mr-1" />
              {busy ? 'Sending…' : 'Confirm & Send'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
