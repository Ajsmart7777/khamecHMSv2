import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export interface ExternalDoctor {
  id: string;
  name: string;
  phone: string | null;
  specialty: string | null;
  schedule_notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export function useExternalDoctors() {
  const [doctors, setDoctors] = useState<ExternalDoctor[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDoctors = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('external_doctors')
      .select('*')
      .order('name');
    if (error) {
      console.error('External doctors fetch error', error);
      setDoctors([]);
    } else {
      setDoctors((data || []) as ExternalDoctor[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchDoctors(); }, [fetchDoctors]);

  const createDoctor = async (input: Omit<ExternalDoctor, 'id' | 'created_at' | 'updated_at' | 'status'> & { status?: string }) => {
    const { data, error } = await supabase
      .from('external_doctors')
      .insert({ ...input, status: input.status || 'active' })
      .select()
      .single();
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return null;
    }
    toast({ title: 'External doctor added' });
    await fetchDoctors();
    return data;
  };

  const updateDoctor = async (id: string, updates: Partial<ExternalDoctor>) => {
    const { error } = await supabase.from('external_doctors').update(updates).eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
    await fetchDoctors();
    return true;
  };

  const deleteDoctor = async (id: string) => {
    const { error } = await supabase.from('external_doctors').delete().eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
    toast({ title: 'External doctor removed' });
    await fetchDoctors();
    return true;
  };

  return { doctors, loading, refetch: fetchDoctors, createDoctor, updateDoctor, deleteDoctor };
}