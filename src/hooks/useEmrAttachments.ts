import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface EmrAttachment {
  id: string;
  patient_id: string;
  uploaded_by: string;
  file_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  category: string;
  description: string | null;
  created_at: string;
}

export function useEmrAttachments(patientId?: string) {
  const [attachments, setAttachments] = useState<EmrAttachment[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAttachments = useCallback(async () => {
    if (!patientId) {
      setAttachments([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('emr_attachments')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });
    if (error) {
      toast.error('Failed to load attachments');
    } else {
      setAttachments((data ?? []) as EmrAttachment[]);
    }
    setLoading(false);
  }, [patientId]);

  useEffect(() => {
    fetchAttachments();
  }, [fetchAttachments]);

  useEffect(() => {
    if (!patientId) return;
    const channel = supabase
      .channel(`emr-attachments-${patientId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'emr_attachments', filter: `patient_id=eq.${patientId}` },
        () => fetchAttachments(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [patientId, fetchAttachments]);

  const uploadAttachment = useCallback(
    async (file: File, category: string, description: string) => {
      if (!patientId) return null;
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) {
        toast.error('You must be signed in');
        return null;
      }
      const path = `${patientId}/${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, '_')}`;
      const { error: upErr } = await supabase.storage
        .from('emr-attachments')
        .upload(path, file, { contentType: file.type });
      if (upErr) {
        toast.error(upErr.message || 'Upload failed');
        return null;
      }
      const { data, error } = await supabase
        .from('emr_attachments')
        .insert([
          {
            patient_id: patientId,
            uploaded_by: uid,
            file_path: path,
            file_name: file.name,
            mime_type: file.type || null,
            size_bytes: file.size,
            category,
            description: description || null,
          },
        ])
        .select()
        .single();
      if (error) {
        toast.error(error.message || 'Failed to save attachment');
        return null;
      }
      toast.success('File uploaded');
      return data as EmrAttachment;
    },
    [patientId],
  );

  const getSignedUrl = useCallback(async (path: string) => {
    const { data, error } = await supabase.storage
      .from('emr-attachments')
      .createSignedUrl(path, 60 * 10);
    if (error) return null;
    return data.signedUrl;
  }, []);

  return { attachments, loading, refresh: fetchAttachments, uploadAttachment, getSignedUrl };
}
