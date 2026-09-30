import { useState, useEffect, useCallback, useRef } from 'react';
import { createRealtimeChannel, supabase } from '@/integrations/supabase/client';
import { logError } from '@/lib/errorHandler';

// Shared invoice cache: every Cashier/Billing instance subscribes to one
// fetched dataset instead of each mounting its own invoices+items query pair.
const listeners = new Set<(items: Invoice[]) => void>();
let cachedInvoices: Invoice[] | null = null;
let inFlightLoad: Promise<Invoice[]> | null = null;
let lastFetchAt = 0;
let refreshTimer: number | null = null;

function publish(items: Invoice[]) {
  cachedInvoices = items;
  lastFetchAt = Date.now();
  listeners.forEach(listener => listener(items));
}

async function fetchInvoicesShared(): Promise<Invoice[]> {
  if (inFlightLoad) return inFlightLoad;
  inFlightLoad = (async () => {
    // The old code fetched invoices, waited, then fetched ALL items — a serial
    // waterfall on every mount and after every realtime blip. Both reads run
    // in parallel now and items are grouped in memory.
    const [invoiceRes, itemsRes] = await Promise.all([
      (supabase as any).from('invoices').select('*').order('created_at', { ascending: false }),
      (supabase as any).from('invoice_items').select('*'),
    ]);
    if (invoiceRes.error) {
      logError('Error fetching invoices', invoiceRes.error);
      throw invoiceRes.error;
    }
    if (itemsRes.error) {
      logError('Error fetching invoice items', itemsRes.error);
      throw itemsRes.error;
    }

    const itemsByInvoice = new Map<string, any[]>();
    for (const item of itemsRes.data || []) {
      const list = itemsByInvoice.get(item.invoice_id);
      if (list) list.push(item);
      else itemsByInvoice.set(item.invoice_id, [item]);
    }
    const merged = ((invoiceRes.data || []) as any[]).map(invoice => ({
      ...invoice,
      items: itemsByInvoice.get(invoice.id) ?? [],
    })) as Invoice[];
    publish(merged);
    return merged;
  })();
  try {
    return await inFlightLoad;
  } finally {
    inFlightLoad = null;
  }
}

/** Debounced + rate-limited refetch for realtime blips and polling. */
function scheduleInvoiceRefresh() {
  if (refreshTimer !== null) return;
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    if (Date.now() - lastFetchAt < 2_000) return;
    void fetchInvoicesShared().catch(() => undefined);
  }, 300);
}

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
  const [invoices, setInvoices] = useState<Invoice[]>(() => cachedInvoices ?? []);
  const [loading, setLoading] = useState(() => !cachedInvoices);

  const fetchInvoices = useCallback(async () => {
    try {
      setInvoices(await fetchInvoicesShared());
    } catch (error) {
      logError('Error in fetchInvoices', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const listener: (items: Invoice[]) => void = (next) => setInvoices(next);
    listeners.add(listener);
    void fetchInvoices();

    // Realtime blips (when the deployment provides them) coalesce into one
    // debounced refetch. Cockroach has no realtime socket, so a TTL poll also
    // keeps separate Cashier/Billing workspaces current without a query storm.
    const channel = createRealtimeChannel('invoices-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, scheduleInvoiceRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoice_items' }, scheduleInvoiceRefresh);

    const poll = window.setInterval(scheduleInvoiceRefresh, 30_000);
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
      window.clearInterval(poll);
      listeners.delete(listener);
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
        publish([
          { ...invoice, items: (createdItems || []) as InvoiceItem[] },
          ...(cachedInvoices ?? []).filter(i => i.id !== invoice.id),
        ]);
      } else {
        publish([
          { ...invoice, items: [] as InvoiceItem[] },
          ...(cachedInvoices ?? []).filter(i => i.id !== invoice.id),
        ]);
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

      // Reflect the confirmed write immediately across every subscribed
      // workspace. A later background refresh can reconcile any server-side
      // trigger changes without delaying the action.
      const paidAt = newStatus === 'paid' ? new Date().toISOString() : null;
      publish((cachedInvoices ?? []).map(item => item.id === invoiceId
        ? { ...item, paid_amount: newPaidAmount, status: newStatus, payment_method: paymentMethod, paid_at: paidAt }
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
