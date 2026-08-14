import { useCallback, useEffect, useState } from 'react';
import { createRealtimeChannel, supabase } from '@/integrations/supabase/client';
import { uploadFile, getFileUrl, deleteFile } from '@/lib/storage';
import { toast } from 'sonner';

export type VisitStation =
  | 'reception'
  | 'nurse'
  | 'doctor'
  | 'lab'
  | 'pharmacy'
  | 'billing'
  | 'cashier'
  | 'other';

export interface VisitAttachment {
  id: string;
  visit_id: string;
  patient_id: string;
  storage_path: string;
  label: string | null;
  station: VisitStation;
  mime_type: string | null;
  size_bytes: number | null;
  captured_by: string | null;
  captured_at: string;
  created_at: string;
}

/** Compress an image blob to max 1600px JPEG @0.85. */
async function compressImage(file: File | Blob, maxSize = 1600, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  const ratio = Math.min(1, maxSize / Math.max(width, height));
  width = Math.round(width * ratio);
  height = Math.round(height * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);
  return await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', quality);
  });
}

export async function uploadVisitAttachment(params: {
  visitId: string;
  patientId: string;
  file: File | Blob;
  label: string;
  station: VisitStation;
}): Promise<VisitAttachment | null> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) {
    toast.error('Not signed in');
    return null;
  }
  try {
    const compressed = await compressImage(params.file);
    const path = `${params.visitId}/${crypto.randomUUID()}.jpg`;
    await uploadFile('visit-cards', path, compressed, 'image/jpeg');

    const { data, error } = await supabase
      .from('visit_attachments')
      .insert({
        visit_id: params.visitId,
        patient_id: params.patientId,
        storage_path: path,
        label: params.label || null,
        station: params.station,
        mime_type: 'image/jpeg',
        size_bytes: compressed.size,
        captured_by: uid,
      })
      .select()
      .single();
    if (error) throw error;
    return data as VisitAttachment;
  } catch (e: any) {
    console.error(e);
    toast.error(`Upload failed: ${e.message ?? e}`);
    return null;
  }
}

export function useVisitAttachments(visitId?: string | null) {
  const [attachments, setAttachments] = useState<VisitAttachment[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!visitId) {
      setAttachments([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('visit_attachments')
      .select('*')
      .eq('visit_id', visitId)
      .order('captured_at', { ascending: false });
    setLoading(false);
    if (error) {
      toast.error('Failed to load attachments');
      return;
    }
    setAttachments((data ?? []) as VisitAttachment[]);
  }, [visitId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!visitId) return;
    const ch = createRealtimeChannel(`visit-attachments-${visitId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'visit_attachments', filter: `visit_id=eq.${visitId}` },
        () => refresh()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [visitId, refresh]);

  return { attachments, loading, refresh };
}

/** Get a readable URL for a stored attachment. */
export async function signedUrl(path: string, expiresIn = 3600): Promise<string | null> {
  return await getFileUrl('visit-cards', path, expiresIn);
}

export async function deleteVisitAttachment(att: VisitAttachment): Promise<boolean> {
  const ok = await deleteFile('visit-cards', att.storage_path);
  if (!ok) {
    toast.error('Failed to delete file');
    return false;
  }
  const { error } = await supabase.from('visit_attachments').delete().eq('id', att.id);
  if (error) {
    toast.error('Failed to delete record');
    return false;
  }
  toast.success('Attachment deleted');
  return true;
}
