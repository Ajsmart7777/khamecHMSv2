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
  const [busy, setBusy] = useState(false);

  const onComplete = useCallback((_: Area, px: Area) => setPixels(px), []);

  const confirm = async () => {
    if (!pixels) return;
    setBusy(true);
    try {
      const { blob, url } = await cropImage(imageUrl, pixels, rotation);
      const cropped = new File([blob], originalFile.name.replace(/\.[^.]+$/, '') + '-cropped.jpg', {
        type: 'image/jpeg',
      });
      onConfirm(cropped, url);
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
            restrictPosition={false}
          />
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

  // Render rotated source to an offscreen canvas first
  const src2 = document.createElement('canvas');
  src2.width = bW;
  src2.height = bH;
  const sctx = src2.getContext('2d')!;
  sctx.translate(bW / 2, bH / 2);
  sctx.rotate(rad);
  sctx.drawImage(img, -img.width / 2, -img.height / 2);

  // Crop from the rotated canvas
  const out = document.createElement('canvas');
  out.width = area.width;
  out.height = area.height;
  const octx = out.getContext('2d')!;
  octx.drawImage(src2, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);

  const blob: Blob = await new Promise((res) =>
    out.toBlob((b) => res(b as Blob), 'image/jpeg', 0.92),
  );
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