import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Camera, RefreshCw, X } from 'lucide-react';

interface Props {
  open: boolean;
  onCancel: () => void;
  onCapture: (file: File) => void;
}

/**
 * In-browser camera capture using getUserMedia — avoids handing off to the
 * OS camera app, which on Android WebView often kills the tab and destroys
 * React state (breaking the snap flow before crop/confirm can render).
 */
export function InAppCameraDialog({ open, onCancel, onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setReady(false);
    setError(null);

    const stopStream = () => {
      const current = streamRef.current;
      if (current) current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    // Some Android tablets reject ideal 1920x1080 constraints with
    // NotReadableError / “Cannot open video source”, even though the camera is
    // available. Try the requested camera first, then progressively relax the
    // constraints so low-end tablet cameras can still capture a usable snap.
    const constraints: MediaStreamConstraints[] = [
      { video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
      { video: { facingMode: { ideal: facing } }, audio: false },
      { video: true, audio: false },
    ];

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera is not supported on this device/browser.');
        }
        stopStream();
        let stream: MediaStream | null = null;
        let lastError: unknown = null;
        for (const requestedConstraints of constraints) {
          try {
            stream = await navigator.mediaDevices.getUserMedia(requestedConstraints);
            break;
          } catch (attemptError) {
            lastError = attemptError;
          }
        }
        if (!stream) throw lastError ?? new Error('Could not open camera');
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          if (!cancelled) setReady(true);
        }
      } catch (e: any) {
        if (!cancelled) {
          const name = String(e?.name ?? '');
          const message = name === 'NotAllowedError' || name === 'PermissionDeniedError'
            ? 'Camera permission is blocked. Allow camera access in the tablet browser settings and try again.'
            : name === 'NotReadableError' || name === 'TrackStartError'
              ? 'The camera is busy or unavailable. Close other camera apps, then try again.'
              : e?.message ?? 'Could not open camera';
          setError(message);
        }
      }
    })();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open, facing]);

  const shoot = async () => {
    const v = videoRef.current;
    if (!v || !ready) return;
    setBusy(true);
    try {
      const w = v.videoWidth;
      const h = v.videoHeight;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.drawImage(v, 0, 0, w, h);
      const blob: Blob = await new Promise((res, rej) =>
        c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', 0.92),
      );
      const file = new File([blob], `snap-${Date.now()}.jpg`, { type: 'image/jpeg' });
      onCapture(file);
    } catch (e) {
      console.error('[InAppCameraDialog] capture failed', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="sm:max-w-2xl max-h-[95vh] flex flex-col p-4 sm:p-6 gap-3">
        <DialogHeader className="shrink-0">
          <DialogTitle>Take photo</DialogTitle>
        </DialogHeader>

        <div className="relative w-full flex-1 min-h-[240px] h-[55vh] bg-black rounded-lg overflow-hidden">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            disablePictureInPicture
            className="w-full h-full object-contain bg-black"
          />
          {!ready && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-white/70 text-xs">
              Starting camera…
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-white/90 text-sm">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 shrink-0 sm:justify-between">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            <X className="h-4 w-4 mr-2" /> Cancel
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Flip
            </Button>
            <Button onClick={shoot} disabled={busy || !ready}>
              <Camera className="h-4 w-4 mr-2" />
              {busy ? 'Capturing…' : 'Capture'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}