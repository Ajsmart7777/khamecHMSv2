import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type VisitStatus = 'open' | 'settled' | 'cancelled';

export interface Visit {
  id: string;
  visit_number: string;
  patient_id: string;
  status: VisitStatus;
  presenting_complaint: string | null;
  sponsor_type: string | null;
  corporate_id: string | null;
  insurance_plan: string | null;
  total_charged: number;
  total_paid: number;
  opened_at: string;
  opened_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
  cancel_reason: string | null;
  force_new_reason: string | null;
  created_at: string;
  updated_at: string;
  claim_status?: 'pending' | 'settled' | 'not_applicable';
  claim_settled_at?: string | null;
  claim_settled_by?: string | null;
  claim_notes?: string | null;
}

/** Find the currently open visit for a patient (or null). */
export async function findOpenVisit(patientId: string): Promise<Visit | null> {
  const { data, error } = await supabase
    .from('visits')
    .select('*')
    .eq('patient_id', patientId)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Visit) ?? null;
}

/** Open (or resume) a visit. Returns the visit id. */
export async function openOrResumeVisit(params: {
  patientId: string;
  presentingComplaint?: string;
  forceNew?: boolean;
  forceNewReason?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('open_visit_for_patient', {
    _patient_id: params.patientId,
    _presenting_complaint: params.presentingComplaint ?? null,
    _force_new: params.forceNew ?? false,
    _force_new_reason: params.forceNewReason ?? null,
  });
  if (error) throw error;
  return data as string;
}

/** Settle (close) an open visit. */
export async function closeVisit(visitId: string): Promise<void> {
  const { error } = await supabase.rpc('close_visit', { _visit_id: visitId });
  if (error) throw error;
}

/** Live-updating open visit for a patient. */
export function useActiveVisit(patientId?: string | null) {
  const [visit, setVisit] = useState<Visit | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!patientId) {
      setVisit(null);
      return;
    }
    setLoading(true);
    try {
      setVisit(await findOpenVisit(patientId));
    } catch (e) {
      console.error('useActiveVisit', e);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!patientId) return;
    const ch = supabase
      .channel(`visits-${patientId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'visits', filter: `patient_id=eq.${patientId}` },
        () => refresh()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [patientId, refresh]);

  return { visit, loading, refresh };
}

/** All visits for a patient (any status). */
export function usePatientVisits(patientId?: string | null) {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!patientId) {
      setVisits([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('visits')
      .select('*')
      .eq('patient_id', patientId)
      .order('opened_at', { ascending: false });
    setLoading(false);
    if (error) {
      toast.error('Failed to load visits');
      return;
    }
    setVisits((data ?? []) as Visit[]);
  }, [patientId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!patientId) return;
    const ch = supabase
      .channel(`patient-visits-${patientId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'visits', filter: `patient_id=eq.${patientId}` },
        () => refresh()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [patientId, refresh]);

  return { visits, loading, refresh };
}

/** Settled sponsored visits (for the Claims queue). */
export function useClaimsQueue(filters?: {
  sponsorType?: string | null;
  from?: string;
  to?: string;
  claimStatus?: 'pending' | 'settled';
  sponsors?: string[];
}) {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const defaultSponsors = ['nhia', 'hmo', 'katchma', 'staff', 'staff_family'];
    let q = supabase
      .from('visits')
      .select('*')
      .eq('status', 'settled')
      .in('sponsor_type', filters?.sponsors ?? defaultSponsors)
      .order('closed_at', { ascending: false });
    if (filters?.claimStatus) q = q.eq('claim_status', filters.claimStatus);
    if (filters?.sponsorType) q = q.eq('sponsor_type', filters.sponsorType);
    if (filters?.from) q = q.gte('closed_at', filters.from);
    if (filters?.to) q = q.lte('closed_at', filters.to);
    const { data, error } = await q;
    setLoading(false);
    if (error) {
      toast.error('Failed to load claims queue');
      return;
    }
    setVisits((data ?? []) as Visit[]);
  }, [filters?.sponsorType, filters?.from, filters?.to, filters?.claimStatus, filters?.sponsors?.join(',')]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const ch = supabase
      .channel('claims-queue-visits')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visits' }, () => refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [refresh]);

  return { visits, loading, refresh };
}

/** Mark an insured visit's claim as settled (claims_manager / admin). */
export async function markClaimSettled(visitId: string, notes?: string): Promise<void> {
  const { error } = await supabase.rpc('mark_claim_settled', {
    _visit_id: visitId,
    _notes: notes ?? null,
  });
  if (error) throw error;
}

/** Reopen a settled claim (admin only). */
export async function reopenClaim(visitId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('reopen_claim', {
    _visit_id: visitId,
    _reason: reason,
  });
  if (error) throw error;
}
