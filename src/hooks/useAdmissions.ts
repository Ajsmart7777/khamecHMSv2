import { useCallback, useEffect, useId, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { isPermissionError, permissionErrorMessage } from '@/lib/permissionError';
import { getCurrentRole, type AdmissionAction } from '@/lib/admissionPermissions';

/** Surface a server-side rejection with the missing role permission spelled out. */
function reportActionError(action: AdmissionAction, error: { code?: string; message?: string }) {
  if (isPermissionError(error)) {
    const { title, description } = permissionErrorMessage(action, getCurrentRole(), error.message);
    toast.error(title, { description });
    return;
  }
  toast.error(error.message ?? 'Action failed');
}

export type AdmissionStatus =
  | 'waiting_assignment'
  | 'active'
  | 'ready_for_discharge'
  | 'discharged'
  | 'cancelled';

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
  admission_snap_path?: string | null;
  admission_note?: string | null;
  ready_for_discharge_at?: string | null;
  ready_for_discharge_by?: string | null;
  discharge_order_snap_id?: string | null;
  created_at: string;
  updated_at: string;
}

export function useAdmissions(filter: { statuses?: AdmissionStatus[]; patientId?: string } = {}) {
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [loading, setLoading] = useState(false);
  const channelId = useId();

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

  // Local fallback so a newly created admission shows up immediately in panels
  // mounted in the same tab, even before the realtime event lands.
  useEffect(() => {
    const h = () => refresh();
    window.addEventListener('admissions:changed', h);
    return () => window.removeEventListener('admissions:changed', h);
  }, [refresh]);

  useEffect(() => {
    // Unique topic per hook instance: several panels use this hook on the same
    // page, and a shared topic name makes one panel's unmount tear down the
    // subscription for the others.
    const ch = supabase
      .channel(`admissions-realtime-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admissions' }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refresh, channelId]);

  return { admissions, loading, refresh };
}

export async function requestAdmission(input: {
  patientId: string;
  visitId?: string | null;
  reason?: string;
  photoPath: string;
  note?: string;
}): Promise<string | null> {
  const { data, error } = await supabase.rpc('request_admission', {
    _patient_id: input.patientId,
    _reason: input.reason ?? null,
    _photo_path: input.photoPath,
    _note: input.note ?? null,
    _visit_id: input.visitId ?? null,
  });
  if (error) {
    reportActionError('admit', error);
    return null;
  }
  window.dispatchEvent(new Event('admissions:changed'));
  toast.success('Admission opened — sent to Nurse for bed assignment');
  return data as string;
}


export async function forwardSnapToBilling(sourceSnapId: string, target: 'pharmacy' | 'lab', note?: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('forward_snap_to_billing', {
    _source_snap_id: sourceSnapId,
    _target_station: target,
    _note: note ?? null,
  });
  if (error) { reportActionError('forwardSnap', error); return null; }
  toast.success(`Forwarded to Billing → ${target === 'lab' ? 'Lab' : 'Pharmacy'}`);
  return data as string;
}

export async function assignBed(admissionId: string, bedId: string): Promise<boolean> {
  const { error } = await supabase.rpc('assign_admission_bed', {
    _admission_id: admissionId,
    _bed_id: bedId,
  });
  if (error) { reportActionError('assignBed', error); return false; }
  window.dispatchEvent(new Event('admissions:changed'));
  toast.success('Bed assigned. Patient admitted.');
  return true;
}

/** Ward step: confirm the patient can leave — settlement happens at the Cashier. */
export async function sendAdmissionToCashier(admissionId: string, note?: string): Promise<boolean> {
  const { error } = await supabase.rpc('send_admission_to_cashier', {
    _admission_id: admissionId,
    _note: note ?? null,
  });
  if (error) { reportActionError('requestDischarge', error); return false; }
  window.dispatchEvent(new Event('admissions:changed'));
  toast.success('Discharge confirmed — patient sent to Cashier for settlement');
  return true;
}

