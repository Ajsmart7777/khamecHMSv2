import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logError } from '@/lib/errorHandler';
import { toast } from 'sonner';
import { createNotification } from '@/hooks/useNotifications';

export interface BalanceRequest {
  id: string;
  patient_id: string;
  request_type: 'topup' | 'refund';
  amount: number | null;
  status: 'pending' | 'confirmed' | 'rejected' | 'expired' | 'cancelled';
  payment_method: string | null;
  requested_by: string | null;
  confirmed_by: string | null;
  notes: string | null;
  rejection_reason: string | null;
  expires_at: string;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BalanceTransaction {
  id: string;
  patient_id: string;
  transaction_type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  payment_method: string | null;
  related_request_id: string | null;
  related_invoice_id: string | null;
  performed_by: string | null;
  notes: string | null;
  created_at: string;
}

export function useBalanceRequests() {
  const [requests, setRequests] = useState<BalanceRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('balance_requests')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setRequests((data || []) as BalanceRequest[]);
    } catch (err) {
      logError('fetchBalanceRequests', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
    const channel = supabase
      .channel('balance-requests-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'balance_requests' }, () => fetchRequests());
    
    // Subscribe in a separate step and handle cleanup
    // channel.subscribe();
    setTimeout(() => {
      channel.subscribe();
    }, 100);

    return () => { 
      supabase.removeChannel(channel); 
    };
  }, [fetchRequests]);

  // Auto-mark expired on client (visual only; server timestamps drive truth)
  const now = new Date();
  const withExpiry = requests.map(r =>
    r.status === 'pending' && new Date(r.expires_at) < now ? { ...r, status: 'expired' as const } : r
  );

  const createRequest = async (
    patientId: string,
    type: 'topup' | 'refund',
    patientName: string,
    notes?: string,
  ): Promise<boolean> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('balance_requests').insert({
        patient_id: patientId,
        request_type: type,
        requested_by: user?.id,
        notes: notes || null,
      });
      if (error) throw error;

      createNotification({
        title: type === 'topup' ? 'Top-Up Request' : 'Refund Request',
        message: `${patientName} — awaiting cashier`,
        type: 'billing',
        target_role: 'billing',
        link: '/billing',
        resource_id: patientId,
      });

      toast.success(`${type === 'topup' ? 'Top-up' : 'Refund'} request sent to cashier`);
      return true;
    } catch (err) {
      logError('createBalanceRequest', err);
      toast.error('Failed to send request');
      return false;
    }
  };

  const confirmRequest = async (
    request: BalanceRequest,
    amount: number,
    paymentMethod: string,
    patientName: string,
  ): Promise<boolean> => {
    try {
      if (amount <= 0) {
        toast.error('Amount must be greater than zero');
        return false;
      }
      const delta = request.request_type === 'topup' ? amount : -amount;
      const { data: { user } } = await supabase.auth.getUser();

      const { error: rpcError } = await supabase.rpc('adjust_patient_balance', {
        _patient_id: request.patient_id,
        _delta: delta,
        _transaction_type: request.request_type,
        _payment_method: paymentMethod,
        _related_request_id: request.id,
        _related_invoice_id: null,
        _notes: request.notes,
      });
      if (rpcError) throw rpcError;

      // Update local patient context for instant balance appearance
      const { data: patient } = await supabase.from('patients').select('balance').eq('id', request.patient_id).single();
      if (patient) {
        // We'll rely on the subscription usually, but we could add an event bus or direct context call if available
      }

      const { error: updErr } = await supabase
        .from('balance_requests')
        .update({
          status: 'confirmed',
          amount,
          payment_method: paymentMethod,
          confirmed_by: user?.id,
          confirmed_at: new Date().toISOString(),
        })
        .eq('id', request.id);
      if (updErr) throw updErr;

      // Notify accountant in realtime
      createNotification({
        title: request.request_type === 'topup' ? 'Deposit Received' : 'Refund Paid Out',
        message: `${patientName} — ₦${amount.toLocaleString()} (${paymentMethod})`,
        type: 'success',
        target_role: 'accountant',
        link: '/account',
        resource_id: request.patient_id,
      });

      toast.success(
        request.request_type === 'topup'
          ? `₦${amount.toLocaleString()} added to balance`
          : `₦${amount.toLocaleString()} refunded from balance`
      );
      return true;
    } catch (err: any) {
      logError('confirmBalanceRequest', err);
      toast.error(err?.message || 'Failed to confirm request');
      return false;
    }
  };

  const rejectRequest = async (id: string, reason: string): Promise<boolean> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('balance_requests')
        .update({
          status: 'rejected',
          rejection_reason: reason,
          confirmed_by: user?.id,
          confirmed_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
      toast.success('Request rejected');
      return true;
    } catch (err) {
      logError('rejectBalanceRequest', err);
      toast.error('Failed to reject request');
      return false;
    }
  };

  const getPendingByType = (type: 'topup' | 'refund') =>
    withExpiry.filter(r => r.request_type === type && r.status === 'pending');

  const getForPatient = (patientId: string) =>
    withExpiry.filter(r => r.patient_id === patientId);

  return {
    requests: withExpiry,
    loading,
    createRequest,
    confirmRequest,
    rejectRequest,
    getPendingByType,
    getForPatient,
    refresh: fetchRequests,
  };
}
