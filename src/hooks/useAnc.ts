import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logError } from '@/lib/errorHandler';

export interface AncProgram {
  id: string;
  patient_id: string;
  anc_number: string;
  status: 'active' | 'completed' | 'archived';
  registration_date: string;
  lmp: string | null;
  edd: string | null;
  gravida: number | null;
  para: number | null;
  height: number | null;
  weight: number | null;
  religion: string | null;
  tribe: string | null;
  occupation: string | null;
  husband_occupation: string | null;
  previous_pregnancies: any[];
  remarks: string | null;
  pelvic_assessment: string | null;
  special_considerations: string | null;
  high_risk: boolean;
  created_by: string | null;
  closed_at: string | null;
  delivery_data: any | null;
  created_at: string;
  updated_at: string;
}

export interface AncVisit {
  id: string;
  anc_program_id: string;
  visit_date: string;
  week_of_pregnancy: number | null;
  weight: number | null;
  blood_pressure: string | null;
  urine: string | null;
  hb: string | null;
  oedema: string | null;
  fundal_height: string | null;
  presentation: string | null;
  fetal_heart_rate: string | null;
  comment: string | null;
  next_visit: string | null;
  staff_id: string | null;
  created_at: string;
}

export function calculateEdd(lmp: string | Date): string {
  const d = new Date(lmp);
  d.setDate(d.getDate() + 280);
  return d.toISOString().slice(0, 10);
}

export function calculateWeeks(lmp: string | Date): number {
  const d = new Date(lmp);
  const diff = Date.now() - d.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24 * 7)));
}

export function useAnc() {
  const [programs, setPrograms] = useState<AncProgram[]>([]);
  const [visits, setVisits] = useState<AncVisit[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const [{ data: p }, { data: v }] = await Promise.all([
        supabase.from('anc_programs' as any).select('*').order('created_at', { ascending: false }),
        supabase.from('anc_visits' as any).select('*').order('visit_date', { ascending: false }),
      ]);
      setPrograms((p || []) as unknown as AncProgram[]);
      setVisits((v || []) as unknown as AncVisit[]);
    } catch (err) {
      logError('Error fetching ANC data', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const ch = supabase
      .channel('anc-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'anc_programs' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'anc_visits' }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchAll]);

  const enroll = useCallback(async (patientId: string, data: Partial<AncProgram>): Promise<AncProgram | null> => {
    try {
      const { data: numRes, error: numErr } = await supabase.rpc('generate_anc_number' as any);
      if (numErr) throw numErr;
      const { data: user } = await supabase.auth.getUser();
      const insertData: any = {
        ...data,
        patient_id: patientId,
        anc_number: numRes,
        status: 'active',
        created_by: user?.user?.id || null,
      };
      const { data: inserted, error } = await supabase
        .from('anc_programs' as any).insert([insertData]).select().single();
      if (error) throw error;
      toast.success('Enrolled into ANC', { description: numRes as string });
      return inserted as unknown as AncProgram;
    } catch (err: any) {
      logError('ANC enroll failed', err);
      toast.error('Enrollment failed', { description: err?.message });
      return null;
    }
  }, []);

  const addVisit = useCallback(async (programId: string, visit: Partial<AncVisit>): Promise<boolean> => {
    try {
      const { data: user } = await supabase.auth.getUser();
      const { error } = await supabase.from('anc_visits' as any).insert([{
        ...visit, anc_program_id: programId, staff_id: user?.user?.id || null,
      }]);
      if (error) throw error;
      toast.success('Visit recorded');
      return true;
    } catch (err: any) {
      logError('ANC visit failed', err);
      toast.error('Failed to record visit', { description: err?.message });
      return false;
    }
  }, []);

  const completeProgram = useCallback(async (programId: string, delivery: any): Promise<boolean> => {
    try {
      const { error } = await supabase.from('anc_programs' as any).update({
        status: 'completed',
        delivery_data: delivery,
        closed_at: new Date().toISOString(),
      }).eq('id', programId);
      if (error) throw error;
      toast.success('Delivery recorded — ANC completed');
      return true;
    } catch (err: any) {
      logError('ANC complete failed', err);
      toast.error('Failed to complete', { description: err?.message });
      return false;
    }
  }, []);

  const getActiveForPatient = (patientId: string) =>
    programs.find(p => p.patient_id === patientId && p.status === 'active');
  const getProgramsForPatient = (patientId: string) =>
    programs.filter(p => p.patient_id === patientId);
  const getVisitsForProgram = (programId: string) =>
    visits.filter(v => v.anc_program_id === programId).sort((a, b) =>
      new Date(a.visit_date).getTime() - new Date(b.visit_date).getTime());

  return {
    programs, visits, loading,
    enroll, addVisit, completeProgram,
    getActiveForPatient, getProgramsForPatient, getVisitsForProgram,
    refresh: fetchAll,
  };
}
