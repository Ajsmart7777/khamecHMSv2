import { useEffect, useRef, useState } from 'react';
import { Camera, Upload, User, Loader2, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { usePatients, Patient } from '@/contexts/PatientContext';
import { InAppCameraDialog } from '@/components/visit/InAppCameraDialog';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

const BUCKET = 'patient-photos';

async function signedPhotoUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

interface Props {
  patient: Patient;
  size?: number;
  editable?: boolean;
  className?: string;
}

/**
 * Circular avatar for a patient. Shows uploaded photo when available; falls
 * back to a User icon. When `editable`, clicking opens a menu to capture
 * with the camera, upload from file, or remove the current photo.
 */
export function PatientPhotoAvatar({
  patient, size = 64, editable = true, className = '',
}: Props) {
  const { updatePatient } = usePatients();
  const { hasRole } = useAuth();
  const canEdit = editable && hasRole(['receptionist', 'admin']);
  const photoPath = (patient as any).photo_path as string | null | undefined;
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (!photoPath) { setUrl(null); return; }
    signedPhotoUrl(photoPath).then((u) => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [photoPath]);

  const uploadFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error('Image too large (max 8 MB)');
      return;
    }
    setBusy(true);
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${patient.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;

      // Best-effort cleanup of previous photo
      if (photoPath) {
        await supabase.storage.from(BUCKET).remove([photoPath]).catch(() => {});
      }
      const ok = await updatePatient(patient.id, { photo_path: path } as Partial<Patient>);
      if (!ok) throw new Error('Failed to save photo');
      toast.success('Patient photo updated');
    } catch (e: any) {
      toast.error('Failed to upload photo', { description: e?.message });
    } finally {
      setBusy(false);
    }
  };

  const removePhoto = async () => {
    if (!photoPath) return;
    setBusy(true);
    try {
      await supabase.storage.from(BUCKET).remove([photoPath]).catch(() => {});
      await updatePatient(patient.id, { photo_path: null } as unknown as Partial<Patient>);
      toast.success('Photo removed');
    } finally {
      setBusy(false);
    }
  };

  const avatarInner = url ? (
    <img
      src={url}
      alt={`${patient.first_name} ${patient.last_name}`}
      className="w-full h-full object-cover"
    />
  ) : (
    <User className="text-primary" style={{ width: size * 0.5, height: size * 0.5 }} />
  );

  const wrapperClass =
    `relative rounded-full overflow-hidden bg-gradient-to-br from-primary/20 to-primary/5 ` +
    `flex items-center justify-center shadow-lg shrink-0 ${className}`;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) uploadFile(f);
        }}
      />

      {canEdit ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={`${wrapperClass} group cursor-pointer`}
              style={{ width: size, height: size }}
              disabled={busy}
              title="Change patient photo"
            >
              {avatarInner}
              <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                {busy ? (
                  <Loader2 className="h-5 w-5 text-white animate-spin" />
                ) : (
                  <Camera className="h-5 w-5 text-white" />
                )}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => setCameraOpen(true)}>
              <Camera className="h-4 w-4 mr-2" /> Take photo
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" /> Upload from device
            </DropdownMenuItem>
            {photoPath && (
              <DropdownMenuItem onClick={removePhoto} className="text-destructive">
                <Trash2 className="h-4 w-4 mr-2" /> Remove photo
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className={wrapperClass} style={{ width: size, height: size }}>
          {avatarInner}
        </div>
      )}

      <InAppCameraDialog
        open={cameraOpen}
        onCancel={() => setCameraOpen(false)}
        onCapture={(file) => {
          setCameraOpen(false);
          uploadFile(file);
        }}
      />
    </>
  );
}