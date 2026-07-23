import { useRef, useState } from 'react';
import { Camera, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useActiveVisit, openOrResumeVisit } from '@/hooks/useVisits';
import { uploadVisitAttachment, VisitStation } from '@/hooks/useVisitAttachments';
import { InAppCameraDialog } from './InAppCameraDialog';
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
}: SnapToCardProps) {
  const { visit, refresh } = useActiveVisit(patientId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState(defaultLabel);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const hasCam = hasInAppCamera();

  const handlePick = () => {
    if (hasCam) setCameraOpen(true);
    else inputRef.current?.click();
  };

  const acceptFile = (f: File) => {
    if (!f.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setLabel(defaultLabel);
    setCameraOpen(false);
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) { e.target.value = ''; return; }
    acceptFile(f);
    requestAnimationFrame(() => { try { e.target.value = ''; } catch {} });
  };

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFile(null);
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
      <Button variant={variant} size={size} onClick={handlePick} className={className}>
        <Camera className="h-4 w-4 mr-2" />
        Snap to Card
      </Button>

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
