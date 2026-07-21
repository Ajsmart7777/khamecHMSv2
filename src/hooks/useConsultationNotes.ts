import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ConsultationNote {
  id: string;
  patient_id: string;
  doctor_id: string;
  visit_date: string;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  icd10_code: string | null;
  follow_up_date: string | null;
  prescription_id: string | null;
  created_at: string;
  updated_at: string;
}

export function useConsultationNotes(patientId?: string) {
  const [notes, setNotes] = useState<ConsultationNote[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchNotes = useCallback(async () => {
    if (!patientId) {
      setNotes([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('consultation_notes')
      .select('*')
      .eq('patient_id', patientId)
      .order('visit_date', { ascending: false });
    if (error) {
      toast.error('Failed to load consultation notes');
    } else {
      setNotes((data ?? []) as ConsultationNote[]);
    }
    setLoading(false);
  }, [patientId]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  useEffect(() => {
    if (!patientId) return;
    const channel = supabase
      .channel(`consultation-notes-${patientId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'consultation_notes', filter: `patient_id=eq.${patientId}` },
        () => fetchNotes(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [patientId, fetchNotes]);

  const createNote = useCallback(async (payload: Omit<ConsultationNote, 'id' | 'created_at' | 'updated_at' | 'doctor_id'>) => {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) {
      toast.error('You must be signed in');
      return null;
    }
    const { data, error } = await supabase
      .from('consultation_notes')
      .insert([{ ...payload, doctor_id: uid }])
      .select()
      .single();
    if (error) {
      toast.error(error.message || 'Failed to save note');
      return null;
    }
    toast.success('Consultation note saved');
    return data as ConsultationNote;
  }, []);

  return { notes, loading, refresh: fetchNotes, createNote };
}
