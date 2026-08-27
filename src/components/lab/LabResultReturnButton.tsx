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
import { labResultTargetStation, normalizeClinicalRole, ownerRoleForLabReturn, shouldPreserveWardLocation } from '@/lib/clinicWorkflowRouting';

interface Props {
  parentSnap: SnapOrder;
  onDone?: () => void;
}

type EntryMode = 'snap' | 'typed';

function withTimeout<T>(promise: PromiseLike<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    Promise.resolve(promise).then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Laboratory results are returned as photographed paper snaps and delivered to
 * the shared Nurse, Doctor 1, and Doctor 2 clinical queues.
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

      // Preserve the original requester only as audit/history metadata. Queue
      // visibility is shared and never depends on the requester.
      const requesterId = parentSnap.created_by || parentSnap.returned_to;
      // original_sender_role is the durable ownership marker. source_role is
      // retained for older rows, so keep it as the compatibility fallback.
      const senderRole = normalizeClinicalRole(parentSnap.original_sender_role || parentSnap.source_role) ?? 'clinical_team';
      const targetStation = labResultTargetStation(senderRole);

      const { error } = await supabase.from('snap_orders').insert({
        patient_id: parentSnap.patient_id,
        visit_id: parentSnap.visit_id,
        // CockroachDB mirrors the primary schema constraint: returned lab results
        // remain lab orders, with the result carried in result_text/photo_path.
        order_type: 'lab',
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

      // Mark the original lab snap and its linked lab request as completed so
      // both the Laboratory queue and the canonical lab_requests record move
      // forward together after a result is returned.
      const completedAt = new Date().toISOString();
      try {
        const { data: userData2 } = await supabase.auth.getUser();
        const { error: fulfillError } = await supabase
          .from('snap_orders')
          .update({
            status: 'fulfilled',
            fulfilled_by: userData2.user?.id ?? null,
            fulfilled_at: completedAt,
          } as any)
          .eq('id', parentSnap.id);
        if (fulfillError) throw fulfillError;
      } catch (fulfillErr) {
        console.warn('Could not mark parent lab snap fulfilled', fulfillErr);
      }

      // Typed lab requests are linked through the source snap's marker. Keep
      // lab_requests in sync for EMR, reports, and any legacy lab views that
      // read the canonical request table instead of snap_orders.
      const linkedLabRequestId = String(parentSnap.ocr_text ?? '').startsWith('LINKED_LAB_REQUEST:')
        ? String(parentSnap.ocr_text).slice('LINKED_LAB_REQUEST:'.length)
        : null;
      if (linkedLabRequestId) {
        const { error: labRequestError } = await supabase
          .from('lab_requests')
          .update({
            status: 'completed',
            completed_at: completedAt,
            results: {
              result_text: entryMode === 'typed' ? trimmedResult : null,
              photo_path: path,
              note: note.trim() || null,
            },
          } as any)
          .eq('id', linkedLabRequestId);
        if (labRequestError) throw labRequestError;

        // Emergency lab requests use the same standard Lab queue, but retain
        // their episode link for ledger/audit continuity. Close only the linked
        // episode item; ordinary paid lab requests have no matching row.
        const { error: emergencyItemError } = await supabase
          .from('emergency_episode_items')
          .update({ status: 'completed', updated_at: completedAt } as any)
          .eq('lab_request_id', linkedLabRequestId);
        if (emergencyItemError) throw emergencyItemError;
      }

      // Return the result to the shared clinical team through the workflow
      // engine. Admitted patients remain in the ward; their result is still
      // visible to Nurse, Doctor 1, and Doctor 2.
      let routingWarning: string | null = null;
      try {
        // Every completed lab result returns to the shared clinical team.
        // Nurse, Doctor 1, and Doctor 2 see the same patient simultaneously;
        // any next action moves the patient out of this shared queue.
        const [{ data: patientRow, error: patientReadError }, { data: activeAdmission, error: admissionReadError }] = await Promise.all([
          supabase
            .from('patients')
            .select('status, assigned_doctor')
            .eq('id', parentSnap.patient_id)
            .maybeSingle(),
          supabase
            .from('admissions')
            .select('id')
            .eq('patient_id', parentSnap.patient_id)
            .in('status', ['active', 'ready_for_discharge', 'waiting_assignment'])
            .maybeSingle(),
        ]);
        if (patientReadError) throw patientReadError;
        if (admissionReadError) throw admissionReadError;

        const newStatus = 'with_clinical_team' as const;
        if (!shouldPreserveWardLocation(patientRow?.status, Boolean(activeAdmission)) && patientRow?.status !== 'discharged') {
          const ownerRole = ownerRoleForLabReturn({ targetStation, senderRole, assignedDoctor: patientRow?.assigned_doctor });
          const { error: journeyError } = await withTimeout(
            supabase.rpc('advance_journey', {
              _patient_id: parentSnap.patient_id,
              _to_state: newStatus,
              _owner_role: ownerRole,
              _owner_user_id: null,
              _department: 'clinical',
              _location: 'clinical_team',
              _visit_id: parentSnap.visit_id,
              _reason: 'Laboratory result returned to the shared clinical team',
            }),
            12000,
            'Laboratory result saved, but workflow routing timed out.',
          );
          if (journeyError) throw journeyError;

          // The Cockroach workflow function updates patient_journey and mirrors
          // patients.status. Verify the legacy status explicitly because the
          // mirror is intentionally compatibility-safe and older rows/triggers
          // may leave it unchanged without failing the journey write.
          const { data: routedPatient, error: routedReadError } = await supabase
            .from('patients')
            .select('status')
            .eq('id', parentSnap.patient_id)
            .maybeSingle();
          if (routedReadError) throw routedReadError;
          if (routedPatient?.status !== newStatus) {
            const { error: statusWriteError } = await supabase
              .from('patients')
              .update({ status: newStatus, last_visit: new Date().toISOString() })
              .eq('id', parentSnap.patient_id);
            if (statusWriteError) throw statusWriteError;
            const { data: confirmedPatient, error: confirmError } = await supabase
              .from('patients')
              .select('status')
              .eq('id', parentSnap.patient_id)
              .maybeSingle();
            if (confirmError) throw confirmError;
            if (confirmedPatient?.status !== newStatus) {
              throw new Error(`Patient status did not reach ${newStatus}`);
            }
          } else {
            await supabase
              .from('patients')
              .update({ last_visit: new Date().toISOString() })
              .eq('id', parentSnap.patient_id);
          }

          // Refresh any open workspace in this browser immediately. Nurse
          // workspaces on another tablet are covered by the queue polling path.
          window.dispatchEvent(new CustomEvent('hms:patient-status-changed', {
            detail: { patientId: parentSnap.patient_id, status: newStatus },
          }));
        }
      } catch (statusErr) {
        console.warn('Could not route patient after lab return', statusErr);
        routingWarning = 'The result was saved, but queue routing needs attention.';
      }

      toast.success(entryMode === 'typed' ? 'Typed result sent back' : 'Result snap sent back', {
        description: routingWarning ?? (
          'Delivered to Nurse, Doctor 1, and Doctor 2 queues.'
        ),
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
        </div>
      </TooltipProvider>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open && !busy) close(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send Lab Result Snap</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {previewUrl && (
              <div className="rounded-lg overflow-hidden bg-muted flex items-center justify-center max-h-[40vh]">
                <img src={previewUrl} alt="Lab result preview" className="max-h-[40vh] object-contain" />
              </div>
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
              This result snap will be delivered to Nurse, Doctor 1, and Doctor 2 together.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={close} disabled={busy}>
              <X className="h-4 w-4 mr-1" /> Cancel
            </Button>
            <Button onClick={submit} disabled={busy || !file}>
              <Send className="h-4 w-4 mr-1" />
              {busy ? 'Sending…' : 'Send Result Snap'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
