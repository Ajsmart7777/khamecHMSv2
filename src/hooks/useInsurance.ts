import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logError } from '@/lib/errorHandler';

export interface InsuranceProvider {
  id: string;
  name: string;
  type: string;
  code: string | null;
  hmo_code: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  coverage_percentage: number;
  max_coverage_amount: number;
  plans: any[];
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsuranceClaim {
  id: string;
  claim_number: string;
  patient_id: string;
  invoice_id: string;
  provider_id: string;
  total_amount: number;
  covered_amount: number;
  patient_copay: number;
  status: string;
  submitted_at: string;
  approved_at: string | null;
  paid_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function useInsurance() {
  const [providers, setProviders] = useState<InsuranceProvider[]>([]);
  const [claims, setClaims] = useState<InsuranceClaim[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProviders = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('insurance_providers')
        .select('*')
        .order('name');
      if (error) throw error;
      setProviders((data || []) as unknown as InsuranceProvider[]);
    } catch (err) { logError('Error fetching insurance providers', err); }
  }, []);

  const fetchClaims = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('insurance_claims')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setClaims((data || []) as unknown as InsuranceClaim[]);
    } catch (err) { logError('Error fetching insurance claims', err); }
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchProviders(), fetchClaims()]);
      setLoading(false);
    };
    load();

    const channel = supabase
      .channel('insurance-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'insurance_providers' }, () => fetchProviders())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'insurance_claims' }, () => fetchClaims())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchProviders, fetchClaims]);

  const addProvider = async (provider: Partial<InsuranceProvider>): Promise<boolean> => {
    try {
      const { error } = await supabase.from('insurance_providers').insert([provider as any]);
      if (error) throw error;
      await fetchProviders();
      return true;
    } catch (err) { logError('Error adding insurance provider', err); return false; }
  };

  const updateProvider = async (id: string, updates: Partial<InsuranceProvider>): Promise<boolean> => {
    try {
      const { error } = await supabase.from('insurance_providers')
        .update({ ...updates, updated_at: new Date().toISOString() } as any)
        .eq('id', id);
      if (error) throw error;
      await fetchProviders();
      return true;
    } catch (err) { logError('Error updating provider', err); return false; }
  };

  const deleteProvider = async (id: string): Promise<boolean> => {
    try {
      const { error } = await supabase.from('insurance_providers').delete().eq('id', id);
      if (error) throw error;
      await fetchProviders();
      return true;
    } catch (err) { logError('Error deleting provider', err); return false; }
  };

  const addClaim = async (claim: Partial<InsuranceClaim>): Promise<boolean> => {
    try {
      const { error } = await supabase.from('insurance_claims').insert([claim as any]);
      if (error) throw error;
      await fetchClaims();
      return true;
    } catch (err) { logError('Error adding claim', err); return false; }
  };

  const updateClaim = async (id: string, updates: Partial<InsuranceClaim>): Promise<boolean> => {
    try {
      const { error } = await supabase.from('insurance_claims')
        .update({ ...updates, updated_at: new Date().toISOString() } as any)
        .eq('id', id);
      if (error) throw error;
      await fetchClaims();
      return true;
    } catch (err) { logError('Error updating claim', err); return false; }
  };

  const getActiveProviders = () => providers.filter(p => p.status === 'active');
  const getNHISProviders = () => providers.filter(p => p.type === 'nhis');
  const getPendingClaims = () => claims.filter(c => c.status === 'submitted');
  const getProviderById = (id: string) => providers.find(p => p.id === id);

  return {
    providers, claims, loading,
    addProvider, updateProvider, deleteProvider,
    addClaim, updateClaim,
    getActiveProviders, getNHISProviders, getPendingClaims, getProviderById,
    refresh: async () => { await Promise.all([fetchProviders(), fetchClaims()]); },
  };
}
