import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logError } from '@/lib/errorHandler';

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'eligibility_verifications' }, () => fetchAll())
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
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

  return {
    items, pending, approved, rejected, loading,
    requestVerification, approve, reject, refresh: fetchAll,
  };
}