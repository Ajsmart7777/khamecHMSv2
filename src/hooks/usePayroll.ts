import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import {
  calculatePayrollTotals,
  canonicalizePayrollValues,
  preserveNonGridDeductions,
  DEFAULT_PAYROLL_LABELS,
  type PayrollValueMap,
} from '@/lib/payroll';

export interface PayrollPeriod {
  id: string;
  month: number;
  year: number;
  status: 'draft' | 'locked' | 'paid';
  created_by: string | null;
  created_at: string;
  column_labels?: Record<string, string> | null;
  archived_at?: string | null;
}

export interface PayrollEntry {
  id: string;
  payroll_period_id: string;
  staff_id: string;
  basic_salary: number;
  allowances: Record<string, number>;
  gross_pay: number;
  deductions: PayrollValueMap;
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
  failure_reason: string | null;
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
      .is('archived_at', null)
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
    const previous = periods
      .filter(period => period.year * 100 + period.month < year * 100 + month)
      .sort((a, b) => (b.year * 100 + b.month) - (a.year * 100 + a.month))[0];
    const columnLabels = previous?.column_labels && Object.keys(previous.column_labels).length > 0
      ? previous.column_labels
      : DEFAULT_PAYROLL_LABELS;
    const { data, error } = await supabase
      .from('payroll_periods')
      .insert({ month, year, status: 'draft', column_labels: columnLabels })
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

  const updatePeriodLabels = async (id: string, labels: Record<string, string>) => {
    const { error } = await supabase
      .from('payroll_periods')
      .update({ column_labels: labels })
      .eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
    setPeriods(prev => prev.map(period => period.id === id ? { ...period, column_labels: labels } : period));
    toast({ title: 'Success', description: 'Payroll column name saved.' });
    return true;
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

  return { periods, loading, createPeriod, updatePeriodLabels, lockPeriod, unlockPeriod, markPaid, refetch: fetch };
}

export function usePayrollEntries(periodId: string | null, periods: PayrollPeriod[] = []) {
  const [entries, setEntries] = useState<PayrollEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const addingAllStaffRef = useRef(false);

  const mapEntry = useCallback((entry: Record<string, unknown>, staff: Record<string, unknown> = {}) => {
    const basicSalary = Number(entry.basic_salary ?? 0);
    const sourceDeductions = (entry.deductions || {}) as PayrollValueMap;
    const totals = calculatePayrollTotals(
      basicSalary,
      (entry.allowances || {}) as PayrollValueMap,
      sourceDeductions,
    );
    const reportDeductions = preserveNonGridDeductions(sourceDeductions, totals.deductions);
    return {
      ...entry,
      staff_name: [staff.first_name, staff.last_name].filter(Boolean).join(' ') || 'Unknown Staff',
      staff_employee_id: staff.employee_id as string,
      staff_designation: staff.designation as string,
      staff_bank_name: staff.bank_name as string,
      staff_account_number: staff.account_number as string,
      staff_payment_method: staff.payment_method as string,
      basic_salary: basicSalary,
      gross_pay: totals.grossPay,
      total_deductions: totals.totalDeductions,
      net_pay: totals.netPay,
      allowances: totals.allowances,
      deductions: reportDeductions,
    } as PayrollEntry;
  }, []);

  const fetch = useCallback(async () => {
    if (!periodId) { setEntries([]); return; }
    setLoading(true);

    const { data: entryRows, error: entryError } = await supabase
      .from('payroll_entries')
      .select('*')
      .eq('payroll_period_id', periodId)
      .order('created_at', { ascending: true });

    if (entryError) {
      console.error('Error fetching payroll entries:', entryError);
      setEntries([]);
      setLoading(false);
      return;
    }

    const rows = (entryRows || []) as Record<string, unknown>[];
    const staffIds = [...new Set(rows.map(row => String(row.staff_id)).filter(Boolean))];
    const { data: staffRows, error: staffError } = staffIds.length
      ? await supabase.from('staff').select('id, first_name, last_name, employee_id, designation, bank_name, account_number, payment_method').in('id', staffIds)
      : { data: [], error: null };

    if (staffError) {
      console.error('Error fetching payroll staff:', staffError);
      setEntries(rows.map(row => mapEntry(row)));
    } else {
      const staffById = new Map((staffRows || []).map((staff: Record<string, unknown>) => [String(staff.id), staff]));
      setEntries(rows.map(row => mapEntry(row, staffById.get(String(row.staff_id)) || {})));
    }
    setLoading(false);
  }, [periodId, mapEntry]);

  useEffect(() => { fetch(); }, [fetch]);

  const addEntry = async (staffId: string, basicSalary: number, allowances: Record<string, number> = {}, deductions: Record<string, number> = {}) => {
    if (!periodId) return null;
    const totals = calculatePayrollTotals(basicSalary, allowances, deductions);

    const { data, error } = await supabase
      .from('payroll_entries')
      .insert({
        payroll_period_id: periodId,
        staff_id: staffId,
        basic_salary: basicSalary,
        allowances: totals.allowances,
        gross_pay: totals.grossPay,
        deductions: totals.deductions,
        total_deductions: totals.totalDeductions,
        net_pay: totals.netPay,
        status: 'pending',
      })
      .select('*')
      .single();

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return null;
    }

    await fetch();
    return data;
  };

  const addAllStaff = async () => {
    if (!periodId || addingAllStaffRef.current) return;
    addingAllStaffRef.current = true;
    
    // 1) Fetch active staff
    const { data: staffList, error: staffErr } = await supabase
      .from('staff')
      .select('id, salary, first_name, last_name, employee_id, designation, bank_name, account_number, payment_method')
      .eq('status', 'active');

    if (staffErr || !staffList) {
      addingAllStaffRef.current = false;
      toast({ title: 'Error', description: 'Could not fetch staff.', variant: 'destructive' });
      return;
    }

    const existingIds = new Set(entries.map(e => e.staff_id));
    const newStaff = staffList.filter(s => !existingIds.has(s.id));
    
    if (newStaff.length === 0) {
      addingAllStaffRef.current = false;
      toast({ title: 'Info', description: 'All active staff already added.' });
      return;
    }

    const currentPeriod = periods.find(period => period.id === periodId);
    const previousPeriod = periods
      .filter(period => currentPeriod && (period.year * 100 + period.month) < (currentPeriod.year * 100 + currentPeriod.month))
      .sort((a, b) => (b.year * 100 + b.month) - (a.year * 100 + a.month))[0];
    const previousRows = previousPeriod
      ? await supabase
        .from('payroll_entries')
        .select('staff_id,basic_salary,allowances,deductions')
        .eq('payroll_period_id', previousPeriod.id)
        .in('staff_id', newStaff.map(staff => staff.id))
      : { data: [], error: null };
    if (previousRows.error) {
      addingAllStaffRef.current = false;
      toast({ title: 'Error', description: 'Could not copy the previous payroll values.', variant: 'destructive' });
      return;
    }
    const previousByStaff = new Map((previousRows.data || []).map((row: Record<string, unknown>) => [
      String(row.staff_id), row,
    ]));

    const rows = newStaff.map(s => {
      const previous = previousByStaff.get(String(s.id));
      const basicSalary = Number(previous?.basic_salary ?? s.salary) || 0;
      const totals = calculatePayrollTotals(
        basicSalary,
        (previous?.allowances || {}) as PayrollValueMap,
        (previous?.deductions || {}) as PayrollValueMap,
      );
      return {
        payroll_period_id: periodId,
        staff_id: s.id,
        basic_salary: basicSalary,
        allowances: totals.allowances,
        gross_pay: totals.grossPay,
        deductions: preserveNonGridDeductions((previous?.deductions || {}) as PayrollValueMap, totals.deductions),
        total_deductions: totals.totalDeductions,
        net_pay: totals.netPay,
        status: 'pending',
      };
    });

    const { data: insertedRows, error } = await supabase
      .from('payroll_entries')
      .insert(rows)
      .select('*');
    if (error) {
      addingAllStaffRef.current = false;
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }

    const staffById = new Map(newStaff.map((staff: Record<string, unknown>) => [String(staff.id), staff]));
    const immediateEntries = ((insertedRows || rows) as Record<string, unknown>[])
      .map(row => mapEntry(row, staffById.get(String(row.staff_id)) || {}));
    setEntries(prev => [...prev, ...immediateEntries]);
    addingAllStaffRef.current = false;
    toast({ title: 'Success', description: `${immediateEntries.length} staff added to payroll.` });
  };

  const updateEntry = async (id: string, updates: Partial<PayrollEntry>) => {
    const allowances = updates.allowances || {};
    const deductions = updates.deductions || {};
    const basicSalary = updates.basic_salary ?? 0;
    const totals = calculatePayrollTotals(basicSalary, allowances, deductions);
    const persistedDeductions = preserveNonGridDeductions(deductions, totals.deductions);

    const { error } = await supabase
      .from('payroll_entries')
      .update({
        basic_salary: basicSalary,
        allowances: totals.allowances,
        gross_pay: totals.grossPay,
        deductions: persistedDeductions,
        total_deductions: totals.totalDeductions,
        net_pay: totals.netPay,
      })
      .eq('id', id);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }

    setEntries(prev => prev.map(entry => entry.id === id ? {
      ...entry,
      basic_salary: basicSalary,
      allowances: totals.allowances,
      gross_pay: totals.grossPay,
      deductions: persistedDeductions,
      total_deductions: totals.totalDeductions,
      net_pay: totals.netPay,
    } : entry));
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


export function useMedicalDeductionDetails(staffId: string | null, month: number | null, year: number | null) {
  const [details, setDetails] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (!staffId || !month || !year) return;
    setLoading(true);

    const startDate = new Date(year, month - 1, 1).toISOString().split('T')[0];
    const endDate = new Date(year, month, 0).toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('invoices')
      .select('id, invoice_number, paid_amount, paid_at, patient_id')
      .eq('staff_sponsor_id', staffId)
      .eq('is_salary_deduction', true)
      .eq('status', 'paid')
      .gte('paid_at', `${startDate} 00:00:00`)
      .lte('paid_at', `${endDate} 23:59:59`)
      .order('paid_at', { ascending: false });

    if (error) {
      console.error('Error fetching medical deduction details:', error);
      toast({ title: 'Error', description: 'Could not fetch bill details.', variant: 'destructive' });
    } else {
      const rows = (data || []) as unknown as Record<string, unknown>[];
      const patientIds = [...new Set(rows.map(row => String(row.patient_id || '')).filter(Boolean))];
      const { data: patients } = patientIds.length
        ? await supabase.from('patients').select('id, first_name, last_name').in('id', patientIds)
        : { data: [] };
      const patientById = new Map((patients || []).map((patient: any) => [String(patient.id), patient]));
      setDetails(rows.map(row => ({
        ...row,
        patient: patientById.get(String(row.patient_id || '')) || null,
      })));
    }
    setLoading(false);
  }, [staffId, month, year]);

  useEffect(() => { fetch(); }, [fetch]);

  return { details, loading, refetch: fetch };
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
  const resolveBank = (bank_name: string) => invoke('resolve_bank', { bank_name });
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

  return { getBalance, listBanks, resolveBank, resolveAccount, initiateTransfer, bulkTransfer, verifyTransfer };
}

export function useProviderActions(provider: PaymentProvider) {
  return provider === 'paystack' ? createProviderActions('payroll-payment-paystack') : createProviderActions('payroll-payment');
}
