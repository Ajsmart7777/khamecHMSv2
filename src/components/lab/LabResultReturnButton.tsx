import { useRef, useState } from 'react';
import { Camera, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { uploadFile } from '@/lib/storage';
import { SnapOrder } from '@/hooks/useSnapOrders';
import { useCanSnap } from '@/hooks/useCanSnap';
import { Lock } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { InAppCameraDialog } from '@/components/visit/InAppCameraDialog';
import { SnapCropDialog } from '@/components/visit/SnapCropDialog';
import { hasInAppCamera } from '@/lib/isMobile';

interface Props {
  parentSnap: SnapOrder;
  onDone?: () => void;
}

/**
 * Lab tech snaps the result paper. The snap is routed back to the original
 * sender (doctor1 / doctor2 / nurse) as a `lab_result` snap.
 */
export function LabResultReturnButton({ parentSnap, onDone }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { allowed, reason, loading: checking } = useCanSnap(parentSnap.patient_id);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const hasCam = hasInAppCamera();

  const acceptFile = (f: File) => {
    if (!f.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    if (rawUrl) URL.revokeObjectURL(rawUrl);
    setRawFile(f);
    setRawUrl(URL.createObjectURL(f));
    setCameraOpen(false);
    setCropOpen(true);
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) { e.target.value = ''; return; }
    acceptFile(f);
    requestAnimationFrame(() => { try { e.target.value = ''; } catch {} });
  };

  const close = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (rawUrl) URL.revokeObjectURL(rawUrl);
    setPreviewUrl(null);
    setFile(null);
    setRawFile(null);
    setRawUrl(null);
    setCropOpen(false);
    setNote('');
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const path = `${parentSnap.visit_id ?? parentSnap.patient_id}/lab-result-${crypto.randomUUID()}.jpg`;
      await uploadFile('visit-cards', path, file, file.type || 'image/jpeg');

      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;

      // Identify the target user (the one who requested the lab)
      // and their specific role to determine the routing station.
      const requesterId = parentSnap.created_by || parentSnap.returned_to;
      const senderRole = parentSnap.source_role || 'doctor';
      const targetStation = senderRole.startsWith('doctor') ? 'doctor' : (senderRole === 'nurse' ? 'nurse' : 'doctor');

      const { error } = await supabase.from('snap_orders').insert({
        patient_id: parentSnap.patient_id,
        visit_id: parentSnap.visit_id,
        order_type: 'lab_result',
        target_station: targetStation as any,
        source_role: 'lab',
        original_sender_role: senderRole,
        parent_snap_id: parentSnap.id,
        photo_path: path,
        note: note.trim() || null,
        status: 'returned',
        returned_to: requesterId,
        returned_at: new Date().toISOString(),
        created_by: uid,
      } as any);
      if (error) throw error;

      // Mark the original lab request as fulfilled so it disappears
      // from the lab workspace queue immediately after the result is sent.
      try {
        const { data: userData2 } = await supabase.auth.getUser();
        await supabase
          .from('snap_orders')
          .update({
            status: 'fulfilled',
            fulfilled_by: userData2.user?.id ?? null,
            fulfilled_at: new Date().toISOString(),
          } as any)
          .eq('id', parentSnap.id);
      } catch (fulfillErr) {
        console.warn('Could not mark parent lab snap fulfilled', fulfillErr);
      }

      // Return patient to sender's queue so they can take the next action
      // (e.g., nurse may need to send another lab request, Rx, or route to doctor)
      try {
        const newStatus = targetStation === 'nurse' ? 'with_nurse' : 'with_doctor';
        // Admitted patients stay in the ward — never move them to an
        // outpatient station just because a lab result came back.
        const { data: activeAdmission } = await supabase
          .from('admissions')
          .select('id')
          .eq('patient_id', parentSnap.patient_id)
          .in('status', ['active', 'ready_for_discharge', 'waiting_assignment'])
          .maybeSingle();
        if (!activeAdmission) {
          // IMPORTANT: Re-set status to original sender's station status so they return to the main queue
          const senderStationStatus = targetStation === 'nurse' ? 'with_nurse' : 'with_doctor';
          await supabase
            .from('patients')
            .update({ status: senderStationStatus, last_visit: new Date().toISOString() })
            .eq('id', parentSnap.patient_id);
        }
      } catch (statusErr) {
        console.warn('Could not update patient status after lab return', statusErr);
      }

      toast.success('Result sent back', {
        description: `Delivered to ${senderRole}.`,
      });
      close();
      onDone?.();
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to return result');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*"
        onChange={onFile} className="hidden" />
      <InAppCameraDialog
        open={cameraOpen}
        onCancel={() => setCameraOpen(false)}
        onCapture={acceptFile}
      />
      {rawUrl && rawFile && (
        <SnapCropDialog
          open={cropOpen}
          imageUrl={rawUrl}
          originalFile={rawFile}
          onCancel={close}
          onConfirm={(croppedFile, croppedUrl) => {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setFile(croppedFile);
            setPreviewUrl(croppedUrl);
            setCropOpen(false);
          }}
        />
      )}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-block">
              <Button
                size="sm"
                onClick={() => {
                  if (hasCam) setCameraOpen(true);
                  else inputRef.current?.click();
                }}
                disabled={!allowed || checking}
                aria-disabled={!allowed}
              >
                {allowed ? <Camera className="h-4 w-4 mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
                Snap & Send Result
              </Button>
            </span>
          </TooltipTrigger>
          {!allowed && reason && (
            <TooltipContent side="top" className="max-w-xs">{reason}</TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>

      <Dialog open={!!previewUrl} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Send Lab Result</DialogTitle></DialogHeader>
          {previewUrl && (
            <div className="space-y-3">
              <div className="rounded-lg overflow-hidden bg-muted flex items-center justify-center max-h-[40vh]">
                <img src={previewUrl} alt="preview" className="max-h-[40vh] object-contain" />
              </div>
              <div>
                <Label>Note (optional)</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200}
                  placeholder="e.g. critical value, see red highlight" />
              </div>
              <p className="text-xs text-muted-foreground">
                This result will be delivered back to the requesting <span className="font-medium">{parentSnap.source_role}</span>.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={close} disabled={busy}>
              <X className="h-4 w-4 mr-1" /> Cancel
            </Button>
            <Button onClick={submit} disabled={busy}>
              <Send className="h-4 w-4 mr-1" /> {busy ? 'Sending…' : 'Send to Sender'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
