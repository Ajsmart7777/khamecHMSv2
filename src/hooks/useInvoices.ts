import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
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
      const { data: invoiceData, error: invoiceError } = await supabase
        .from('invoices')
        .select('*')
        .order('created_at', { ascending: false });

      if (invoiceError) {
        logError('Error fetching invoices', invoiceError);
        return;
      }

      const { data: itemsData, error: itemsError } = await supabase
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

    const channel = supabase
      .channel('invoices-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => fetchInvoices())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoice_items' }, () => fetchInvoices())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchInvoices]);

  const createInvoice = async (
    patientId: string,
    items: { description: string; quantity: number; unitPrice: number; category?: string }[],
    notes?: string
  ): Promise<Invoice | null> => {
    try {
      const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

      // Auto-tag invoice with sponsor info from patient so corporate/retainer
      // claims surface immediately in the Accountant module.
      const { data: patient } = await supabase
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
      
      const { data: invoice, error: invoiceError } = await supabase
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

        const { error: itemsError } = await supabase
          .from('invoice_items')
          .insert(itemsToInsert);

        if (itemsError) {
          logError('Error creating invoice items', itemsError);
        }
      }

      await fetchInvoices();
      return { ...invoice, items: [] };
    } catch (error) {
      logError('Error in createInvoice', error);
      return null;
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

      const { error } = await supabase
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

      await fetchInvoices();
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
    recordPayment,
    getInvoicesForPatient,
    getPendingInvoices,
    refreshInvoices: fetchInvoices,
  };
}
