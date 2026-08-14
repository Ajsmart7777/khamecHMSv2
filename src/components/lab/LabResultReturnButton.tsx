import { useRef, useState } from 'react';
import { Camera, FileText, PenLine, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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

type EntryMode = 'snap' | 'typed';

/**
 * Lab tech can return the result as a photographed paper or as typed text.
 * Both paths create the same lab_result snap and route it back to the original
 * requester, so Doctor, Nurse, and patient-ledger views remain consistent.
 */
export function LabResultReturnButton({ parentSnap, onDone }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { allowed, reason, loading: checking } = useCanSnap(parentSnap.patient_id);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [entryMode, setEntryMode] = useState<EntryMode>('snap');
  const [typedResult, setTypedResult] = useState('');
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
    setEntryMode('snap');
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
    setCameraOpen(false);
    setDialogOpen(false);
    setEntryMode('snap');
    setTypedResult('');
    setNote('');
  };

  const openSnapEntry = () => {
    setEntryMode('snap');
    if (hasCam) setCameraOpen(true);
    else inputRef.current?.click();
  };

  const openTypedEntry = () => {
    setEntryMode('typed');
    setDialogOpen(true);
  };

  const submit = async () => {
    const trimmedResult = typedResult.trim();
    if (entryMode === 'typed' && trimmedResult.length < 3) {
      toast.error('Type the laboratory result before sending');
      return;
    }
    if (entryMode === 'snap' && !file) return;

    setBusy(true);
    try {
      let path: string | null = null;
      if (entryMode === 'snap' && file) {
        path = `${parentSnap.visit_id ?? parentSnap.patient_id}/lab-result-${crypto.randomUUID()}.jpg`;
        await uploadFile('visit-cards', path, file, file.type || 'image/jpeg');
      }

      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;

      // Identify the target user (the one who requested the lab) and their
      // role to determine the routing station.
      const requesterId = parentSnap.created_by || parentSnap.returned_to;
      const senderRole = parentSnap.source_role || 'doctor';
      const targetStation = senderRole.startsWith('doctor')
        ? 'doctor'
        : (senderRole === 'nurse' ? 'nurse' : 'doctor');

      const { error } = await supabase.from('snap_orders').insert({
        patient_id: parentSnap.patient_id,
        visit_id: parentSnap.visit_id,
        order_type: 'lab_result',
        target_station: targetStation as any,
        source_role: 'lab',
        original_sender_role: senderRole,
        parent_snap_id: parentSnap.id,
        photo_path: path,
        result_text: entryMode === 'typed' ? trimmedResult : null,
        note: note.trim() || null,
        status: 'returned',
        returned_to: requesterId,
        returned_at: new Date().toISOString(),
        created_by: uid,
      } as any);
      if (error) throw error;

      // Mark the original lab request as fulfilled so it disappears from the
      // Lab workspace immediately after the result is sent.
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

      // Return patient to the sender's queue. Admitted patients stay in the
      // ward and are not moved to an outpatient station by a lab result.
      try {
        const newStatus = targetStation === 'nurse' ? 'with_nurse' : 'with_doctor';
        const { data: activeAdmission } = await supabase
          .from('admissions')
          .select('id')
          .eq('patient_id', parentSnap.patient_id)
          .in('status', ['active', 'ready_for_discharge', 'waiting_assignment'])
          .maybeSingle();
        if (!activeAdmission) {
          await supabase
            .from('patients')
            .update({ status: newStatus, last_visit: new Date().toISOString() })
            .eq('id', parentSnap.patient_id);
        }
      } catch (statusErr) {
        console.warn('Could not update patient status after lab return', statusErr);
      }

      toast.success(entryMode === 'typed' ? 'Typed result sent back' : 'Result snap sent back', {
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
      <input ref={inputRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
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
            setDialogOpen(true);
          }}
        />
      )}

      <TooltipProvider>
        <div className="flex flex-wrap justify-end gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-block">
                <Button
                  size="sm"
                  onClick={openSnapEntry}
                  disabled={!allowed || checking}
                  aria-disabled={!allowed}
                >
                  {allowed ? <Camera className="h-4 w-4 mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
                  Snap Result
                </Button>
              </span>
            </TooltipTrigger>
            {!allowed && reason && <TooltipContent side="top" className="max-w-xs">{reason}</TooltipContent>}
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-block">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={openTypedEntry}
                  disabled={!allowed || checking}
                  aria-disabled={!allowed}
                >
                  {allowed ? <PenLine className="h-4 w-4 mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
                  Type Result
                </Button>
              </span>
            </TooltipTrigger>
            {!allowed && reason && <TooltipContent side="top" className="max-w-xs">{reason}</TooltipContent>}
          </Tooltip>
        </div>
      </TooltipProvider>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open && !busy) close(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{entryMode === 'typed' ? 'Type Lab Result' : 'Send Lab Result Snap'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-muted/40 p-1">
              <Button
                type="button"
                size="sm"
                variant={entryMode === 'typed' ? 'default' : 'ghost'}
                className="flex-1"
                onClick={() => setEntryMode('typed')}
                disabled={busy}
              >
                <FileText className="h-4 w-4 mr-1" /> Type
              </Button>
              <Button
                type="button"
                size="sm"
                variant={entryMode === 'snap' ? 'default' : 'ghost'}
                className="flex-1"
                onClick={openSnapEntry}
                disabled={busy}
              >
                <Camera className="h-4 w-4 mr-1" /> Snap
              </Button>
            </div>

            {entryMode === 'typed' ? (
              <div className="space-y-2">
                <Label htmlFor={`typed-lab-result-${parentSnap.id}`}>Laboratory result</Label>
                <Textarea
                  id={`typed-lab-result-${parentSnap.id}`}
                  value={typedResult}
                  onChange={(e) => setTypedResult(e.target.value)}
                  placeholder="Enter the test result, measurements, reference range, and interpretation…"
                  className="min-h-[220px] resize-y"
                  maxLength={10000}
                  disabled={busy}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Type the complete result clearly. It will be delivered to the requesting {parentSnap.source_role || 'clinical'} workspace and shown in the patient record.
                </p>
              </div>
            ) : (
              previewUrl && (
                <div className="rounded-lg overflow-hidden bg-muted flex items-center justify-center max-h-[40vh]">
                  <img src={previewUrl} alt="Lab result preview" className="max-h-[40vh] object-contain" />
                </div>
              )
            )}

            <div>
              <Label htmlFor={`lab-result-note-${parentSnap.id}`}>Note (optional)</Label>
              <Input
                id={`lab-result-note-${parentSnap.id}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                placeholder="e.g. urgent finding or additional interpretation"
                disabled={busy}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              This result will be delivered back to the requesting <span className="font-medium">{parentSnap.source_role || 'clinical'}</span> workspace.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={close} disabled={busy}>
              <X className="h-4 w-4 mr-1" /> Cancel
            </Button>
            <Button onClick={submit} disabled={busy || (entryMode === 'typed' && typedResult.trim().length < 3) || (entryMode === 'snap' && !file)}>
              <Send className="h-4 w-4 mr-1" />
              {busy ? 'Sending…' : entryMode === 'typed' ? 'Send Typed Result' : 'Send Result Snap'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
