import { useCallback, useState } from 'react';
import Cropper, { Area } from 'react-easy-crop';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { RotateCw, Check, X } from 'lucide-react';

interface Props {
  open: boolean;
  imageUrl: string;
  originalFile: File;
  onCancel: () => void;
  onConfirm: (croppedFile: File, croppedUrl: string) => void;
}

/** Crop a snapped photo before it is uploaded/sent. */
export function SnapCropDialog({ open, imageUrl, originalFile, onCancel, onConfirm }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pixels, setPixels] = useState<Area | null>(null);
  const [imgReady, setImgReady] = useState(false);
  const [busy, setBusy] = useState(false);

  const onComplete = useCallback((_: Area, px: Area) => setPixels(px), []);

  // Prime a "whole image" crop area so the Confirm button works even if the
  // user never drags — critical on mobile where onCropComplete can be slow to
  // fire after the dialog first mounts.
  const onMediaLoaded = useCallback((size: { naturalWidth: number; naturalHeight: number }) => {
    setImgReady(true);
    setPixels((prev) => prev ?? {
      x: 0,
      y: 0,
      width: size.naturalWidth,
      height: size.naturalHeight,
    });
  }, []);

  const confirm = async () => {
    if (!pixels) return;
    setBusy(true);
    try {
      const { blob, url } = await cropImage(imageUrl, pixels, rotation);
      const safeName = (originalFile.name || 'snap').replace(/\.[^.]+$/, '') + '-cropped.jpg';
      const cropped = new File([blob], safeName, { type: 'image/jpeg' });
      onConfirm(cropped, url);
    } catch (err) {
      console.error('[SnapCropDialog] crop failed', err);
      // Fallback: send the original file so the flow doesn't get stuck on mobile.
      try {
        onConfirm(originalFile, imageUrl);
      } catch {}
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="sm:max-w-2xl max-h-[95vh] flex flex-col p-4 sm:p-6 gap-3">
        <DialogHeader className="shrink-0">
          <DialogTitle>Crop photo</DialogTitle>
        </DialogHeader>

        <div className="relative w-full flex-1 min-h-[220px] h-[45vh] sm:h-[55vh] bg-black rounded-lg overflow-hidden touch-none">
          <Cropper
            image={imageUrl}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={undefined /* free-form */}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onRotationChange={setRotation}
            onCropComplete={onComplete}
            onMediaLoaded={onMediaLoaded}
            restrictPosition={false}
          />
          {!imgReady && (
            <div className="absolute inset-0 flex items-center justify-center text-white/70 text-xs pointer-events-none">
              Loading photo…
            </div>
          )}
        </div>

        <div className="space-y-3 pt-1 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xs w-14 text-muted-foreground">Zoom</span>
            <Slider
              value={[zoom]}
              min={1}
              max={4}
              step={0.05}
              onValueChange={(v) => setZoom(v[0])}
              className="flex-1"
            />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Drag to reposition · pinch or use slider to zoom.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRotation((r) => (r + 90) % 360)}
              disabled={busy}
            >
              <RotateCw className="h-3.5 w-3.5 mr-1" /> Rotate
            </Button>
          </div>
        </div>

        <DialogFooter className="gap-2 shrink-0">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            <X className="h-4 w-4 mr-2" /> Cancel
          </Button>
          <Button onClick={confirm} disabled={busy || !pixels}>
            <Check className="h-4 w-4 mr-2" />
            {busy ? 'Cropping…' : 'Use this crop'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function cropImage(src: string, area: Area, rotation: number): Promise<{ blob: Blob; url: string }> {
  const img = await loadImage(src);
  const rad = (rotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const bW = img.width * cos + img.height * sin;
  const bH = img.width * sin + img.height * cos;

  // iOS Safari has a hard canvas cap (~4096px per side / 16.7M px total).
  // Downscale the working canvas so drawImage doesn't silently produce a
  // blank image or fail to return a blob.
  const IOS_CAP = 4096;
  const scale = Math.min(1, IOS_CAP / Math.max(bW, bH));
  const sW = Math.round(bW * scale);
  const sH = Math.round(bH * scale);

  const src2 = document.createElement('canvas');
  src2.width = sW;
  src2.height = sH;
  const sctx = src2.getContext('2d');
  if (!sctx) throw new Error('Canvas 2D unavailable');
  sctx.translate(sW / 2, sH / 2);
  sctx.rotate(rad);
  sctx.drawImage(
    img,
    (-img.width * scale) / 2,
    (-img.height * scale) / 2,
    img.width * scale,
    img.height * scale,
  );

  const outW = Math.max(1, Math.round(area.width * scale));
  const outH = Math.max(1, Math.round(area.height * scale));
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('Canvas 2D unavailable');
  octx.drawImage(
    src2,
    area.x * scale,
    area.y * scale,
    area.width * scale,
    area.height * scale,
    0,
    0,
    outW,
    outH,
  );

  const blob: Blob = await new Promise((res, rej) => {
    try {
      out.toBlob(
        (b) => (b ? res(b) : rej(new Error('toBlob returned null'))),
        'image/jpeg',
        0.9,
      );
    } catch (e) {
      rej(e);
    }
  });
  return { blob, url: URL.createObjectURL(blob) };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}