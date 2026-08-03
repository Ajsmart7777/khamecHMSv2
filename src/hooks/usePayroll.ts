import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export interface PayrollPeriod {
  id: string;
  month: number;
  year: number;
  status: 'draft' | 'locked' | 'paid';
  created_by: string | null;
  created_at: string;
}

export interface PayrollEntry {
  id: string;
  payroll_period_id: string;
  staff_id: string;
  basic_salary: number;
  allowances: Record<string, number>;
  gross_pay: number;
  deductions: Record<string, number>;
  total_deductions: number;
  net_pay: number;
  status: string;
  payment_reference: string | null;
  // joined
  staff_name?: string;
  staff_employee_id?: string;
  staff_designation?: string;
  staff_bank_name?: string;
  staff_account_number?: string;
  staff_payment_method?: string;
}

export interface PayrollPayment {
  id: string;
  payroll_period_id: string;
  payroll_entry_id: string;
  staff_id: string;
  amount: number;
  status: string;
  provider_transfer_code: string | null;
  provider_reference: string | null;
  provider_recipient_code: string | null;
  paid_at: string | null;
  created_at: string;
  // joined
  staff_name?: string;
  staff_bank_name?: string;
  staff_account_number?: string;
}

export function usePayrollPeriods() {
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('payroll_periods')
      .select('*')
      .order('year', { ascending: false })
      .order('month', { ascending: false });

    if (error) {
      console.error('Error fetching payroll periods:', error);
    } else {
      setPeriods((data || []) as PayrollPeriod[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const createPeriod = async (month: number, year: number) => {
    const { data, error } = await supabase
      .from('payroll_periods')
      .insert({ month, year, status: 'draft' })
      .select()
      .single();

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return null;
    }
    setPeriods(prev => [data as PayrollPeriod, ...prev]);
    toast({ title: 'Success', description: 'Payroll period created.' });
    return data as PayrollPeriod;
  };

  const lockPeriod = async (id: string) => {
    const { error } = await supabase
      .from('payroll_periods')
      .update({ status: 'locked' })
      .eq('id', id);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
    setPeriods(prev => prev.map(p => p.id === id ? { ...p, status: 'locked' } : p));
    toast({ title: 'Payroll Locked', description: 'No further edits allowed.' });
    return true;
  };

  const unlockPeriod = async (id: string) => {
    const { error } = await supabase
      .from('payroll_periods')
      .update({ status: 'draft' })
      .eq('id', id);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
    setPeriods(prev => prev.map(p => p.id === id ? { ...p, status: 'draft' } : p));
    toast({ title: 'Payroll Unlocked', description: 'Period is now editable again.' });
    return true;
  };

  const markPaid = async (id: string) => {
    const { error } = await supabase
      .from('payroll_periods')
      .update({ status: 'paid' })
      .eq('id', id);

    if (error) return false;
    setPeriods(prev => prev.map(p => p.id === id ? { ...p, status: 'paid' } : p));
    return true;
  };

  return { periods, loading, createPeriod, lockPeriod, unlockPeriod, markPaid, refetch: fetch };
}

export function usePayrollEntries(periodId: string | null) {
  const [entries, setEntries] = useState<PayrollEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (!periodId) { setEntries([]); return; }
    setLoading(true);

    const { data, error } = await supabase
      .from('payroll_entries')
      .select('*, staff!inner(first_name, last_name, employee_id, designation, bank_name, account_number, payment_method)')
      .eq('payroll_period_id', periodId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching payroll entries:', error);
      setEntries([]);
    } else {
      const mapped = (data || []).map((e: Record<string, unknown>) => {
        const staff = e.staff as Record<string, unknown>;
        return {
          ...e,
          staff_name: `${staff.first_name} ${staff.last_name}`,
          staff_employee_id: staff.employee_id as string,
          staff_designation: staff.designation as string,
          staff_bank_name: staff.bank_name as string,
          staff_account_number: staff.account_number as string,
          staff_payment_method: staff.payment_method as string,
          basic_salary: Number(e.basic_salary),
          gross_pay: Number(e.gross_pay),
          total_deductions: Number(e.total_deductions),
          net_pay: Number(e.net_pay),
          allowances: (e.allowances || {}) as Record<string, number>,
          deductions: (e.deductions || {}) as Record<string, number>,
        } as PayrollEntry;
      });
      setEntries(mapped);
    }
    setLoading(false);
  }, [periodId]);

  useEffect(() => { fetch(); }, [fetch]);

  const addEntry = async (staffId: string, basicSalary: number, allowances: Record<string, number> = {}, deductions: Record<string, number> = {}) => {
    if (!periodId) return null;
    const grossPay = basicSalary + Object.values(allowances).reduce((a, b) => a + b, 0);
    const totalDeductions = Object.values(deductions).reduce((a, b) => a + b, 0);
    const netPay = grossPay - totalDeductions;

    const { data, error } = await supabase
      .from('payroll_entries')
      .insert({
        payroll_period_id: periodId,
        staff_id: staffId,
        basic_salary: basicSalary,
        allowances,
        gross_pay: grossPay,
        deductions,
        total_deductions: totalDeductions,
        net_pay: netPay,
        status: 'pending',
      })
      .select('*, staff!inner(first_name, last_name, employee_id, designation, bank_name, account_number, payment_method)')
      .single();

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return null;
    }

    await fetch();
    return data;
  };

  const addAllStaff = async () => {
    if (!periodId) return;
    const { data: staffList, error: staffErr } = await supabase
      .from('staff')
      .select('id, salary')
      .eq('status', 'active');

    if (staffErr || !staffList) {
      toast({ title: 'Error', description: 'Could not fetch staff.', variant: 'destructive' });
      return;
    }

    const existingIds = new Set(entries.map(e => e.staff_id));
    const newStaff = staffList.filter(s => !existingIds.has(s.id));
    if (newStaff.length === 0) {
      toast({ title: 'Info', description: 'All active staff already added.' });
      return;
    }

    const rows = newStaff.map(s => ({
      payroll_period_id: periodId,
      staff_id: s.id,
      basic_salary: Number(s.salary),
      allowances: {},
      gross_pay: Number(s.salary),
      deductions: {},
      total_deductions: 0,
      net_pay: Number(s.salary),
      status: 'pending',
    }));

    const { error } = await supabase.from('payroll_entries').insert(rows);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }

    toast({ title: 'Success', description: `${newStaff.length} staff added to payroll.` });
    await fetch();
  };

  const updateEntry = async (id: string, updates: Partial<PayrollEntry>) => {
    const allowances = updates.allowances || {};
    const deductions = updates.deductions || {};
    const basicSalary = updates.basic_salary ?? 0;
    const grossPay = basicSalary + Object.values(allowances).reduce((a, b) => a + b, 0);
    const totalDeductions = Object.values(deductions).reduce((a, b) => a + b, 0);
    const netPay = grossPay - totalDeductions;

    const { error } = await supabase
      .from('payroll_entries')
      .update({
        basic_salary: basicSalary,
        allowances,
        gross_pay: grossPay,
        deductions,
        total_deductions: totalDeductions,
        net_pay: netPay,
      })
      .eq('id', id);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }

    await fetch();
    return true;
  };

  const removeEntry = async (id: string) => {
    const { error } = await supabase.from('payroll_entries').delete().eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
    setEntries(prev => prev.filter(e => e.id !== id));
    return true;
  };

  return { entries, loading, addEntry, addAllStaff, updateEntry, removeEntry, refetch: fetch };
}

export type PaymentProvider = 'flutterwave' | 'paystack';

function createProviderActions(functionName: string) {
  const invoke = async (action: string, params: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke(functionName, {
      body: { action, ...params },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const getBalance = () => invoke('get_balance');
  const listBanks = () => invoke('list_banks');
  const resolveAccount = (account_number: string, account_bank: string) =>
    invoke('resolve_account', { account_number, account_bank });
  const initiateTransfer = (params: {
    amount: number;
    account_bank: string;
    account_number: string;
    beneficiary_name: string;
    narration: string;
    reference: string;
  }) => invoke('initiate_transfer', params);
  const bulkTransfer = (transfers: Array<{
    amount: number;
    account_bank: string;
    account_number: string;
    beneficiary_name?: string;
    narration?: string;
    reference?: string;
  }>) => invoke('bulk_transfer', { transfers });
  const verifyTransfer = (transfer_id: string) => invoke('verify_transfer', { transfer_id });

  return { getBalance, listBanks, resolveAccount, initiateTransfer, bulkTransfer, verifyTransfer };
}

  return provider === 'paystack' ? createProviderActions('payroll-payment-paystack') : createProviderActions('payroll-payment');
}
