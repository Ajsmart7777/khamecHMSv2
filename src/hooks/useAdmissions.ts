import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type AdmissionStatus = 'waiting_assignment' | 'active' | 'discharged' | 'cancelled';

export interface Admission {
  id: string;
  patient_id: string;
  visit_id: string | null;
  bed_id: string | null;
  admitting_doctor: string | null;
  assigned_by_nurse: string | null;
  reason: string | null;
  status: AdmissionStatus;
  admitted_at: string | null;
  discharged_at: string | null;
  discharge_notes: string | null;
  discharged_by: string | null;
  created_at: string;
  updated_at: string;
}

export function useAdmissions(filter: { statuses?: AdmissionStatus[]; patientId?: string } = {}) {
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('admissions').select('*').order('created_at', { ascending: false });
    if (filter.statuses?.length) q = q.in('status', filter.statuses);
    if (filter.patientId) q = q.eq('patient_id', filter.patientId);
    const { data, error } = await q;
    setLoading(false);
    if (error) { toast.error('Failed to load admissions'); return; }
    setAdmissions((data ?? []) as Admission[]);
  }, [filter.statuses?.join(','), filter.patientId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const ch = supabase
      .channel('admissions-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admissions' }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refresh]);

  return { admissions, loading, refresh };
}

export async function requestAdmission(input: { patientId: string; visitId?: string | null; reason?: string }): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('admissions')
    .insert({
      patient_id: input.patientId,
      visit_id: input.visitId ?? null,
      admitting_doctor: userData.user?.id ?? null,
      reason: input.reason ?? null,
      status: 'waiting_assignment',
    })
    .select('id')
    .single();
  if (error) { toast.error(`Admission failed: ${error.message}`); return null; }
  toast.success('Patient sent to Nurse for bed assignment');
  return data.id;
}

export async function assignBed(admissionId: string, bedId: string): Promise<boolean> {
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('admissions')
    .update({
      bed_id: bedId,
      assigned_by_nurse: userData.user?.id ?? null,
      status: 'active',
      admitted_at: new Date().toISOString(),
    })
    .eq('id', admissionId);
  if (error) { toast.error(error.message); return false; }
  toast.success('Bed assigned. Patient admitted.');
  return true;
}

export async function dischargeAdmission(admissionId: string, notes?: string): Promise<boolean> {
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('admissions')
    .update({
      status: 'discharged',
      discharged_at: new Date().toISOString(),
      discharged_by: userData.user?.id ?? null,
      discharge_notes: notes ?? null,
    })
    .eq('id', admissionId);
  if (error) { toast.error(error.message); return false; }
  toast.success('Patient discharged');
  return true;
}
