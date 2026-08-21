import { useRef, useState } from 'react';
import { Camera, FileText, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useActiveVisit, openOrResumeVisit } from '@/hooks/useVisits';
import { uploadVisitAttachment, uploadVisitTextAttachment, VisitStation } from '@/hooks/useVisitAttachments';
import { InAppCameraDialog } from './InAppCameraDialog';
import { SnapCropDialog } from './SnapCropDialog';
import { hasInAppCamera } from '@/lib/isMobile';

interface SnapToCardProps {
  patientId: string;
  station: VisitStation;
  defaultLabel?: string;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'sm' | 'default' | 'lg';
  className?: string;
  /** If no open visit exists, auto-open one before uploading. */
  autoOpenVisit?: boolean;
  /** Also offer a written, non-order review that is stored on the visit card. */
  allowTyped?: boolean;
  /** Keep photo/review choices behind one action button. */
  singleAction?: boolean;
}

/**
 * Universal "Snap to Card" button.
 * Opens camera → preview → label → uploads to the patient's open visit.
 */
export function SnapToCard({
  patientId,
  station,
  defaultLabel = '',
  variant = 'outline',
  size = 'sm',
  className,
  autoOpenVisit = true,
  allowTyped = false,
  singleAction = false,
}: SnapToCardProps) {
  const { visit, refresh } = useActiveVisit(patientId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [label, setLabel] = useState(defaultLabel);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [typedOpen, setTypedOpen] = useState(false);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [typedReview, setTypedReview] = useState('');
  const hasCam = hasInAppCamera();

  const handlePick = () => {
    if (hasCam) setCameraOpen(true);
    else inputRef.current?.click();
  };

  const acceptFile = (f: File) => {
    if (!f.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    if (rawUrl) URL.revokeObjectURL(rawUrl);
    setRawFile(f);
    setRawUrl(URL.createObjectURL(f));
    setLabel(defaultLabel);
    setCameraOpen(false);
    setCropOpen(true);
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) { e.target.value = ''; return; }
    acceptFile(f);
    requestAnimationFrame(() => { try { e.target.value = ''; } catch {} });
  };

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (rawUrl) URL.revokeObjectURL(rawUrl);
    setPreviewUrl(null);
    setFile(null);
    setRawFile(null);
    setRawUrl(null);
    setCropOpen(false);
  };

  const attach = async () => {
    if (!file) return;
    setBusy(true);
    try {
      let visitId = visit?.id;
      if (!visitId) {
        if (!autoOpenVisit) {
          toast.error('No open visit for this patient. Check them in first.');
          setBusy(false);
          return;
        }
        visitId = await openOrResumeVisit({ patientId });
        await refresh();
      }
      const saved = await uploadVisitAttachment({
        visitId,
        patientId,
        file,
        label: label.trim(),
        station,
      });
      if (saved) {
        toast.success('Attached to visit card');
        closePreview();
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to attach');
    } finally {
      setBusy(false);
    }
  };

  const saveTypedReview = async () => {
    const review = typedReview.trim();
    if (!review) {
      toast.error('Write the doctor review before saving');
      return;
    }
    setBusy(true);
    try {
      let visitId = visit?.id;
      if (!visitId) {
        if (!autoOpenVisit) {
          toast.error('No open visit for this patient. Check them in first.');
          return;
        }
        visitId = await openOrResumeVisit({ patientId });
        await refresh();
      }
      const saved = await uploadVisitTextAttachment({
        visitId,
        patientId,
        text: review,
        label: label.trim() || 'Doctor review',
        station,
      });
      if (saved) {
        toast.success('Review added to visit card');
        setTypedReview('');
        setLabel(defaultLabel);
        setTypedOpen(false);
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to save review');
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
        onChange={onFile}
        className="hidden"
      />
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
          onCancel={closePreview}
          onConfirm={(croppedFile, croppedUrl) => {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setFile(croppedFile);
            setPreviewUrl(croppedUrl);
            setCropOpen(false);
          }}
        />
      )}
      <div className="flex items-center gap-1">
        <Button
          variant={variant}
          size={size}
          onClick={() => (allowTyped && singleAction ? setChoiceOpen(true) : handlePick())}
          className={className}
        >
          <Camera className="h-4 w-4 mr-2" />
          Snap to Card
        </Button>
        {allowTyped && !singleAction && (
          <Button variant="ghost" size={size} onClick={() => setTypedOpen(true)} title="Write a review to the visit card">
            <FileText className="h-4 w-4 mr-2" />
            Type Review
          </Button>
        )}
      </div>

      {allowTyped && singleAction && (
        <Dialog open={choiceOpen} onOpenChange={(open) => !busy && setChoiceOpen(open)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Add to Patient Card</DialogTitle>
            </DialogHeader>
            <div className="grid gap-2">
              <Button onClick={() => { setChoiceOpen(false); handlePick(); }} disabled={busy}>
                <Camera className="h-4 w-4 mr-2" /> Snap a Photo
              </Button>
              <Button variant="outline" onClick={() => { setChoiceOpen(false); setTypedOpen(true); }} disabled={busy}>
                <FileText className="h-4 w-4 mr-2" /> Write a Review
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {allowTyped && (
        <Dialog open={typedOpen} onOpenChange={(open) => !busy && setTypedOpen(open)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Write Review to Patient Card</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="typed-card-label">Label (optional)</Label>
                <Input
                  id="typed-card-label"
                  placeholder="e.g. Doctor review, Treatment note"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={120}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="typed-card-review">Review</Label>
                <Textarea
                  id="typed-card-review"
                  placeholder="Write the review or clinical note to appear in the patient ledger…"
                  value={typedReview}
                  onChange={(e) => setTypedReview(e.target.value)}
                  rows={8}
                  maxLength={10000}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">This is a card review, not a Pharmacy or Lab order.</p>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => setTypedOpen(false)} disabled={busy}>Cancel</Button>
              <Button onClick={saveTypedReview} disabled={busy || !typedReview.trim()}>
                <Upload className="h-4 w-4 mr-2" />
                {busy ? 'Saving…' : 'Save to Card'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={!!previewUrl} onOpenChange={(o) => !o && closePreview()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Attach to Visit Card</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            <div className="space-y-3">
              <div className="rounded-lg overflow-hidden bg-muted flex items-center justify-center max-h-[50vh]">
                <img src={previewUrl} alt="preview" className="max-h-[50vh] object-contain" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="attach-label">Label (optional)</Label>
                <Input
                  id="attach-label"
                  placeholder="e.g. Doctor's prescription, Lab result page 1"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={120}
                />
                <p className="text-xs text-muted-foreground">
                  Station: <span className="font-medium capitalize">{station}</span>
                  {visit && (
                    <>
                      {' · '}Visit: <span className="font-mono">{visit.visit_number}</span>
                    </>
                  )}
                </p>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={closePreview} disabled={busy}>
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button onClick={attach} disabled={busy}>
              <Upload className="h-4 w-4 mr-2" />
              {busy ? 'Attaching…' : 'Attach to Card'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
