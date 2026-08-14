import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logError } from '@/lib/errorHandler';
import { uploadFile, getFileUrl } from '@/lib/storage';

export interface EligibilityVerification {
  id: string;
  patient_id: string;
  sponsor_type: 'nhis' | 'hmo' | 'katchma' | 'corporate' | 'retainer';
  provider_id: string | null;
  provider_name: string | null;
  enrollee_id: string | null;
  plan: string | null;
  encounter_code: string | null;
  encounter_code_captured_at: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  rejection_reason: string | null;
  notes: string | null;
  requested_by: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
  prospective_patient_name: string | null;
  prospective_patient_phone: string | null;
  insurance_details: string | null;
  reception_snap_path: string | null;
  verification_snap_path: string | null;
  verified_enrollee_id: string | null;
  verified_plan: string | null;
  verified_provider_name: string | null;
  consumed_at: string | null;
  consumed_patient_id: string | null;
  member_id_data: Record<string, string> | null;
}

const BUCKET = 'visit-cards';

async function uploadSnap(prefix: string, file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `eligibility/${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await uploadFile(BUCKET, path, file, file.type || 'image/jpeg');
  return path;
}

export async function getEligibilitySnapUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  return await getFileUrl(BUCKET, path, 60 * 60);
}

export function useEligibilityVerifications() {
  const [items, setItems] = useState<EligibilityVerification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('eligibility_verifications' as any)
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setItems((data || []) as unknown as EligibilityVerification[]);
    } catch (err) {
      logError('Failed to load eligibility verifications', err);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      await fetchAll();
      if (mounted) setLoading(false);
    })();

    const ch = supabase
      .channel('eligibility-verifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'eligibility_verifications' }, () => fetchAll());
    
    const subscribe = async () => {
      try {
        await ch.subscribe();
      } catch (err) {
        logError('Eligibility subscribe error', err);
      }
    };
    
    const timeout = setTimeout(subscribe, 100);

    return () => { 
      mounted = false; 
      clearTimeout(timeout);
      if (ch) {
        supabase.removeChannel(ch); 
      }
    };
  }, [fetchAll]);

  const requestVerification = async (input: {
    patient_id: string;
    sponsor_type: EligibilityVerification['sponsor_type'];
    provider_id?: string | null;
    provider_name?: string | null;
    enrollee_id?: string | null;
    plan?: string | null;
    encounter_code?: string | null;
    notes?: string | null;
  }): Promise<string | null> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('eligibility_verifications' as any)
        .insert({
          ...input,
          encounter_code_captured_at: input.encounter_code ? new Date().toISOString() : null,
          requested_by: user?.id ?? null,
        } as any)
        .select('id')
        .single();
      if (error) throw error;
      await fetchAll();
      return (data as any)?.id ?? null;
    } catch (err) {
      logError('Failed to create eligibility verification', err);
      return null;
    }
  };

  /**
   * Pre-registration verification request: reception hasn't created a patient yet.
   * Snaps the insurance card + captures freeform details + prospective name/phone,
   * then routes it to the Claims Manager.
   */
  const requestPreRegistrationVerification = async (input: {
    prospective_patient_name: string;
    prospective_patient_phone?: string | null;
    sponsor_type: EligibilityVerification['sponsor_type'];
    insurance_details?: string | null;
    notes?: string | null;
    snap_file: File;
  }): Promise<string | null> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const snap_path = await uploadSnap('reception', input.snap_file);
      const { data, error } = await supabase
        .from('eligibility_verifications' as any)
        .insert({
          sponsor_type: input.sponsor_type,
          prospective_patient_name: input.prospective_patient_name.trim(),
          prospective_patient_phone: input.prospective_patient_phone?.trim() || null,
          insurance_details: input.insurance_details?.trim() || null,
          notes: input.notes?.trim() || null,
          reception_snap_path: snap_path,
          requested_by: user?.id ?? null,
        } as any)
        .select('id')
        .single();
      if (error) throw error;
      await fetchAll();
      return (data as any)?.id ?? null;
    } catch (err) {
      logError('Failed to create pre-registration verification', err);
      return null;
    }
  };

  const approve = async (id: string, patch: Partial<EligibilityVerification>): Promise<boolean> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('eligibility_verifications' as any)
        .update({
          ...patch,
          status: 'approved',
          verified_by: user?.id ?? null,
          verified_at: new Date().toISOString(),
        } as any)
        .eq('id', id);
      if (error) throw error;
      await fetchAll();
      return true;
    } catch (err) {
      logError('Failed to approve eligibility', err);
      return false;
    }
  };

  /**
   * Approve a verification and (optionally) upload a proof-of-verification snap
   * from the provider portal.
   */
  const approveWithSnap = async (
    id: string,
    patch: Partial<EligibilityVerification>,
    verification_snap?: File | null,
  ): Promise<boolean> => {
    try {
      let verification_snap_path: string | undefined;
      if (verification_snap) {
        verification_snap_path = await uploadSnap('verified', verification_snap);
      }
      return await approve(id, {
        ...patch,
        ...(verification_snap_path ? { verification_snap_path } : {}),
      });
    } catch (err) {
      logError('Failed to approve eligibility with snap', err);
      return false;
    }
  };

  /**
   * Mark a verification as consumed once reception finishes registering the patient.
   */
  const markConsumed = async (id: string, patient_id: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('eligibility_verifications' as any)
        .update({
          patient_id,
          consumed_patient_id: patient_id,
          consumed_at: new Date().toISOString(),
        } as any)
        .eq('id', id);
      if (error) throw error;
      await fetchAll();
      return true;
    } catch (err) {
      logError('Failed to mark verification consumed', err);
      return false;
    }
  };

  const reject = async (id: string, reason: string, notes?: string): Promise<boolean> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('eligibility_verifications' as any)
        .update({
          status: 'rejected',
          rejection_reason: reason,
          notes: notes ?? null,
          verified_by: user?.id ?? null,
          verified_at: new Date().toISOString(),
        } as any)
        .eq('id', id);
      if (error) throw error;
      await fetchAll();
      return true;
    } catch (err) {
      logError('Failed to reject eligibility', err);
      return false;
    }
  };

  const pending = items.filter((i) => i.status === 'pending');
  const approved = items.filter((i) => i.status === 'approved');
  const rejected = items.filter((i) => i.status === 'rejected');
  const readyToRegister = approved.filter((i) => !i.consumed_at && !i.patient_id);

  return {
    items, pending, approved, rejected, readyToRegister, loading,
    requestVerification, requestPreRegistrationVerification,
    approve, approveWithSnap, reject, markConsumed,
    refresh: fetchAll,
  };
}