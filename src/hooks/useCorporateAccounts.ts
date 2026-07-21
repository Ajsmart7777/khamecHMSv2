import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export type SponsorAccountType = 'corporate' | 'retainer';

export interface CorporateAccount {
  account_type: SponsorAccountType;
  id: string;
  company_name: string;
  contact_person: string;
  email: string;
  phone: string;
  address: string;
  treatment_limit: number;
  balance: number;
  discount_percentage: number;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // computed
  linked_patients_count?: number;
}

export function useCorporateAccounts() {
  const [accounts, setAccounts] = useState<CorporateAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('corporate_accounts')
      .select('*')
      .order('company_name', { ascending: true });

    if (error) {
      console.error('Error fetching corporate accounts:', error);
      setAccounts([]);
    } else {
      // Get patient counts per corporate_id
      const { data: patients } = await supabase
        .from('patients')
        .select('corporate_id')
        .eq('account_type', 'corporate');

      const countMap: Record<string, number> = {};
      (patients || []).forEach((p: { corporate_id: string | null }) => {
        if (p.corporate_id) {
          countMap[p.corporate_id] = (countMap[p.corporate_id] || 0) + 1;
        }
      });

      const mapped = (data || []).map(a => ({
        ...a,
        treatment_limit: Number(a.treatment_limit),
        balance: Number(a.balance),
        discount_percentage: Number(a.discount_percentage),
        linked_patients_count: countMap[a.id] || 0,
      })) as CorporateAccount[];

      setAccounts(mapped);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const createAccount = async (account: Omit<CorporateAccount, 'id' | 'created_at' | 'updated_at' | 'linked_patients_count'>) => {
    const { data, error } = await supabase
      .from('corporate_accounts')
      .insert({
        company_name: account.company_name,
        contact_person: account.contact_person,
        email: account.email,
        phone: account.phone,
        address: account.address,
        treatment_limit: account.treatment_limit,
        balance: account.balance,
        discount_percentage: account.discount_percentage,
        status: account.status,
        notes: account.notes,
      })
      .select()
      .single();

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return null;
    }
    toast({ title: 'Success', description: 'Corporate account created.' });
    await fetchAccounts();
    return data;
  };

  const updateAccount = async (id: string, updates: Partial<CorporateAccount>) => {
    const { error } = await supabase
      .from('corporate_accounts')
      .update({
        ...(updates.company_name !== undefined && { company_name: updates.company_name }),
        ...(updates.contact_person !== undefined && { contact_person: updates.contact_person }),
        ...(updates.email !== undefined && { email: updates.email }),
        ...(updates.phone !== undefined && { phone: updates.phone }),
        ...(updates.address !== undefined && { address: updates.address }),
        ...(updates.treatment_limit !== undefined && { treatment_limit: updates.treatment_limit }),
        ...(updates.balance !== undefined && { balance: updates.balance }),
        ...(updates.discount_percentage !== undefined && { discount_percentage: updates.discount_percentage }),
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.notes !== undefined && { notes: updates.notes }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
    toast({ title: 'Updated', description: 'Corporate account updated.' });
    await fetchAccounts();
    return true;
  };

  const deleteAccount = async (id: string) => {
    const { error } = await supabase
      .from('corporate_accounts')
      .delete()
      .eq('id', id);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
    toast({ title: 'Deleted', description: 'Corporate account removed.' });
    setAccounts(prev => prev.filter(a => a.id !== id));
    return true;
  };

  const topUpBalance = async (id: string, amount: number) => {
    const account = accounts.find(a => a.id === id);
    if (!account) return false;
    return updateAccount(id, { balance: account.balance + amount });
  };

  const deductBalance = async (id: string, amount: number) => {
    const account = accounts.find(a => a.id === id);
    if (!account) return false;
    if (account.balance < amount) {
      toast({ title: 'Insufficient Balance', description: `Corporate account balance (₦${account.balance.toLocaleString()}) is less than ₦${amount.toLocaleString()}.`, variant: 'destructive' });
      return false;
    }
    return updateAccount(id, { balance: account.balance - amount });
  };

  const getAccountById = async (id: string) => {
    const { data, error } = await supabase
      .from('corporate_accounts')
      .select('*')
      .eq('id', id)
      .single();
    if (error) return null;
    return {
      ...data,
      treatment_limit: Number(data.treatment_limit),
      balance: Number(data.balance),
      discount_percentage: Number(data.discount_percentage),
    } as CorporateAccount;
  };

  const getCorporateTransactions = async (corporateId: string) => {
    const { data: corpPatients } = await supabase
      .from('patients')
      .select('id, first_name, last_name')
      .eq('account_type', 'corporate')
      .eq('corporate_id', corporateId);

    if (!corpPatients || corpPatients.length === 0) return [];

    const patientIds = corpPatients.map(p => p.id);
    const { data: invoiceData } = await supabase
      .from('invoices')
      .select('*')
      .in('patient_id', patientIds)
      .order('created_at', { ascending: false })
      .limit(50);

    return (invoiceData || []).map(inv => ({
      ...inv,
      patient_name: corpPatients.find(p => p.id === inv.patient_id)
        ? `${corpPatients.find(p => p.id === inv.patient_id)!.first_name} ${corpPatients.find(p => p.id === inv.patient_id)!.last_name}`
        : 'Unknown',
    }));
  };

  const getLinkedPatients = async (corporateId: string) => {
    const { data, error } = await supabase
      .from('patients')
      .select('id, first_name, last_name, card_number, phone, balance, status')
      .eq('account_type', 'corporate')
      .eq('corporate_id', corporateId);

    if (error) {
      console.error('Error fetching linked patients:', error);
      return [];
    }
    return data || [];
  };

  return {
    accounts,
    loading,
    createAccount,
    updateAccount,
    deleteAccount,
    topUpBalance,
    deductBalance,
    getLinkedPatients,
    getAccountById,
    getCorporateTransactions,
    refetch: fetchAccounts,
  };
}
