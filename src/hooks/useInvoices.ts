import { useState, useEffect, useCallback, useRef } from 'react';
import { createRealtimeChannel, supabase } from '@/integrations/supabase/client';
import { logError } from '@/lib/errorHandler';

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  category: string;
  created_at: string;
  dispensing_status?: string;
  dispensing_notes?: string;
  dispensing_updated_at?: string;
  dispensing_updated_by?: string;
}


export interface Invoice {
  id: string;
  patient_id: string;
  invoice_number: string;
  total_amount: number;
  paid_amount: number;
  status: string;
  payment_method: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  items?: InvoiceItem[];
}

export function useInvoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const { data: invoiceData, error: invoiceError } = await (supabase as any)
        .from('invoices')
        .select('*')
        .order('created_at', { ascending: false });

      if (invoiceError) {
        logError('Error fetching invoices', invoiceError);
        return;
      }

      const { data: itemsData, error: itemsError } = await (supabase as any)
        .from('invoice_items')
        .select('*');

      if (itemsError) {
        logError('Error fetching invoice items', itemsError);
        return;
      }

      const invoicesWithItems = (invoiceData || []).map(invoice => ({
        ...invoice,
        items: (itemsData || []).filter(item => item.invoice_id === invoice.id),
      }));

      setInvoices(invoicesWithItems);
    } catch (error) {
      logError('Error in fetchInvoices', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInvoices();

    const channel = createRealtimeChannel('invoices-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => fetchInvoices())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoice_items' }, () => fetchInvoices());
    
    const subscribe = async () => {
      try {
        await channel.subscribe();
      } catch (err) {
        logError('Invoices subscribe error', err);
      }
    };
    
    const timeout = setTimeout(subscribe, 100);

    return () => {
      clearTimeout(timeout);
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [fetchInvoices]);

  const [isCreating, setIsCreating] = useState(false);
  const createLockRef = useRef(false);

  const createInvoice = async (
    patientId: string,
    items: { description: string; quantity: number; unitPrice: number; category?: string }[],
    notes?: string
  ): Promise<Invoice | null> => {
    if (createLockRef.current || isCreating) return null;
    createLockRef.current = true;
    setIsCreating(true);
    try {
      const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

      // Do not allow ordinary Billing actions to bypass an Emergency Episode
      // draft. The approved complete_emergency_billing_draft RPC is the only
      // path that may create the invoice while the draft is pending.
      const { data: pendingEmergencyDraft, error: emergencyGateError } = await (supabase as any)
        .from('snap_orders')
        .select('id')
        .eq('patient_id', patientId)
        .eq('intent', 'emergency_billing_draft')
        .eq('status', 'pending_billing')
        .limit(1)
        .maybeSingle();
      if (emergencyGateError) {
        logError('Emergency Billing gate check failed', emergencyGateError);
        return null;
      }
      if (pendingEmergencyDraft) {
        logError('Invoice creation blocked by pending Emergency Billing draft', { patientId, draftId: pendingEmergencyDraft.id });
        return null;
      }

      // Auto-tag invoice with sponsor info from patient so corporate/retainer
      // claims surface immediately in the Accountant module.
      const { data: patient } = await (supabase as any)
        .from('patients')
        .select('account_type, corporate_id, insurance_provider, insurance_plan')
        .eq('id', patientId)
        .maybeSingle();

      const acct = (patient?.account_type || '').toLowerCase();
      let sponsorType: string | null = null;
      let corporateAccountId: string | null = null;
      if (acct === 'corporate') {
        sponsorType = 'corporate';
        corporateAccountId = patient?.corporate_id ?? null;
      } else if (acct === 'retainer') {
        sponsorType = 'retainer';
        corporateAccountId = patient?.corporate_id ?? null;
      } else if (acct === 'insurance' || patient?.insurance_provider) {
        sponsorType = 'insurance';
      } else if (acct && acct !== 'cash' && acct !== 'normal') {
        sponsorType = acct;
      }
      
      const { data: invoice, error: invoiceError } = await (supabase as any)
        .from('invoices')
        .insert({
          patient_id: patientId,
          invoice_number: '',
          total_amount: totalAmount,
          status: 'pending',
          notes: notes || null,
          sponsor_type: sponsorType,
          corporate_account_id: corporateAccountId,
        })
        .select()
        .single();
 
      if (invoiceError || !invoice) {
        logError('Error creating invoice', invoiceError);
        return null;
      }

      if (items.length > 0) {
        const itemsToInsert = items.map(item => ({
          invoice_id: invoice.id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          total: item.quantity * item.unitPrice,
          category: item.category || 'general',
        }));

        const { data: createdItems, error: itemsError } = await (supabase as any)
          .from('invoice_items')
          .insert(itemsToInsert);

        if (itemsError) {
          logError('Error creating invoice items', itemsError);
        }

        // The clone returns inserted rows directly; keep them available for
        // the immediate local update instead of waiting for a full refetch.
        setInvoices(prev => [{ ...invoice, items: (createdItems || []) as InvoiceItem[] }, ...prev.filter(i => i.id !== invoice.id)]);
      } else {
        setInvoices(prev => [{ ...invoice, items: [] }, ...prev.filter(i => i.id !== invoice.id)]);
      }

      return { ...invoice, items: [] };
    } catch (error) {
      logError('Error in createInvoice', error);
      return null;
    } finally {
      createLockRef.current = false;
      setIsCreating(false);
    }
  };

  const recordPayment = async (
    invoiceId: string,
    amount: number,
    paymentMethod: string
  ): Promise<boolean> => {
    try {
      const invoice = invoices.find(i => i.id === invoiceId);
      if (!invoice) return false;

      const newPaidAmount = invoice.paid_amount + amount;
      const newStatus = newPaidAmount >= invoice.total_amount ? 'paid' : 'partial';

      const { error } = await (supabase as any)
        .from('invoices')
        .update({
          paid_amount: newPaidAmount,
          status: newStatus,
          payment_method: paymentMethod,
          paid_at: newStatus === 'paid' ? new Date().toISOString() : null,
        })
        .eq('id', invoiceId);

      if (error) {
        logError('Error recording payment', error);
        return false;
      }

      // Reflect the confirmed write immediately. A later background refresh can
      // reconcile any server-side trigger changes without delaying the action.
      setInvoices(prev => prev.map(item => item.id === invoiceId
        ? { ...item, paid_amount: newPaidAmount, status: newStatus, payment_method: paymentMethod, paid_at: newStatus === 'paid' ? new Date().toISOString() : null }
        : item));
      return true;
    } catch (error) {
      logError('Error in recordPayment', error);
      return false;
    }
  };

  const getInvoicesForPatient = (patientId: string): Invoice[] => {
    return invoices.filter(i => i.patient_id === patientId);
  };

  const getPendingInvoices = (): Invoice[] => {
    // Only bills that still need money collected. Cancelled or paid invoices
    // (including those auto-cancelled with their visit) must not clutter the
    // Cashier queue.
    return invoices.filter(i => i.status === 'pending' || i.status === 'partial');
  };

  return {
    invoices,
    loading,
    createInvoice,
    isCreating,
    recordPayment,
    getInvoicesForPatient,
    getPendingInvoices,
    refreshInvoices: fetchInvoices,
  };
}
