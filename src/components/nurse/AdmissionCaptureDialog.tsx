import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Camera, BedDouble } from 'lucide-react';
import { toast } from 'sonner';
import { uploadFile } from '@/lib/storage';
import { InAppCameraDialog } from '@/components/visit/InAppCameraDialog';
import { SnapCropDialog } from '@/components/visit/SnapCropDialog';
import { hasInAppCamera } from '@/lib/isMobile';
import { requestAdmission, requestAdmissionDirect } from '@/hooks/useAdmissions';
import { openOrResumeVisit } from '@/hooks/useVisits';
import { useAdmissionPerms } from '@/lib/admissionPermissions';

interface Props {
  patientId: string;
  patientName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdmitted?: (admissionId: string) => void;
}

/**
 * Snap-first admission: doctor/nurse uploads the handwritten admission order,
 * crops, then submits. Creates an admission with the required order snap.
 */
export function AdmissionCaptureDialog({ patientId, patientName, open, onOpenChange, onAdmitted }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const can = useAdmissionPerms();
  const canAdmit = can('admit');

  const reset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (rawUrl) URL.revokeObjectURL(rawUrl);
    setPreviewUrl(null); setFile(null); setRawUrl(null); setRawFile(null);
    setCropOpen(false); setCameraOpen(false); setReason(''); setNote('');
  };
  const close = () => { reset(); onOpenChange(false); };

  const accept = (f: File) => {
    const url = URL.createObjectURL(f);
    if (rawUrl) URL.revokeObjectURL(rawUrl);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null); setPreviewUrl(null);
    setRawFile(f); setRawUrl(url);
    setCameraOpen(false); setCropOpen(true);
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast.error('Please select an image'); return; }
    accept(f);
  };

  const submitDirect = async () => {
    if (!canAdmit) { toast.error('Only a nurse or doctor can admit a patient'); return; }
    setBusy(true);
    try {
      const visitId = await openOrResumeVisit({ patientId });
      const id = await requestAdmissionDirect({ patientId, visitId });
      if (!id) return;
      onAdmitted?.(id);
      close();
    } catch (e: any) {
      toast.error(e.message ?? 'Admission failed');
    } finally { setBusy(false); }
  };

  const submit = async () => {
    if (!canAdmit) { toast.error('Only a nurse or doctor can admit a patient'); return; }
    if (!file) { toast.error('Snap the admission order first'); return; }
    setBusy(true);
    try {
      const visitId = await openOrResumeVisit({ patientId });
      const path = `${visitId}/admission-${crypto.randomUUID()}.jpg`;
      await uploadFile('visit-cards', path, file, file.type || 'image/jpeg');
      const id = await requestAdmission({
        patientId, visitId, photoPath: path,
        reason: reason.trim() || undefined,
        note: note.trim() || undefined,
      });
      if (!id) return;
      onAdmitted?.(id);
      close();
    } catch (e: any) {
      toast.error(e.message ?? 'Admission failed');
    } finally { setBusy(false); }
  };

  const openCapture = () => {
    if (hasInAppCamera()) setCameraOpen(true);
    else inputRef.current?.click();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (busy) return; if (!o) close(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BedDouble className="h-5 w-5" /> Admit · {patientName}
            </DialogTitle>
            <DialogDescription>
              Snap the handwritten admission order. This becomes the legal record of admission.
            </DialogDescription>
          </DialogHeader>
          <input ref={inputRef} type="file" accept="image/*" onChange={onFile} className="hidden" />

          <div className="space-y-3">
            {previewUrl ? (
              <div className="rounded-lg overflow-hidden bg-muted">
                <img src={previewUrl} alt="admission snap" className="w-full max-h-64 object-contain" />
                <div className="p-2 flex justify-end">
                  <Button variant="ghost" size="sm" onClick={openCapture}>Retake</Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" className="w-full h-24 border-dashed" onClick={openCapture}>
                <Camera className="h-5 w-5 mr-2" /> Snap Admission Order
              </Button>
            )}

            <div className="space-y-1.5">
              <Label>Admission reason</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. severe malaria, observation" maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label>Extra note (optional)</Label>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. NPO, prep for OT" />
            </div>
          </div>

          <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between gap-2">
            <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={submitDirect} disabled={busy || !canAdmit}>
                {busy ? 'Admitting…' : 'Admit directly'}
              </Button>
              <Button onClick={submit} disabled={busy || !file || !canAdmit}>
                {busy ? 'Admitting…' : canAdmit ? 'Confirm snap admission' : 'Not permitted for your role'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InAppCameraDialog open={cameraOpen} onCancel={() => setCameraOpen(false)} onCapture={accept} />
      {rawUrl && rawFile && (
        <SnapCropDialog
          open={cropOpen}
          imageUrl={rawUrl}
          originalFile={rawFile}
          onCancel={() => setCropOpen(false)}
          onConfirm={(cf, cu) => {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setFile(cf); setPreviewUrl(cu); setCropOpen(false);
          }}
        />
      )}
    </>
  );
}