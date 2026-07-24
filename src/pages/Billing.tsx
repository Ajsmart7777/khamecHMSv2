import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { UniversalPatientHeader } from '@/components/patient/UniversalPatientHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Receipt, 
  Send, 
  Printer,
  User,
  Plus,
  Trash2,
  Wifi,
  WifiOff,
  FileText,
  CheckCircle,
  Clock,
  AlertCircle,
  Building2,
  RefreshCw
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePatients } from '@/contexts/PatientContext';
import { PatientStatusIndicator } from '@/components/patients/PatientStatusIndicator';
import { PrintableBillingInvoiceDialog } from '@/components/receipts/PrintableBillingInvoiceDialog';
import { paymentAuditLogger } from '@/lib/auditLogger';
import { useInvoices } from '@/hooks/useInvoices';
import { usePrescriptions } from '@/hooks/usePrescriptions';
import { useCorporateAccounts, CorporateAccount } from '@/hooks/useCorporateAccounts';
import { supabase } from '@/integrations/supabase/client';
import { BalanceRequestsPanel } from '@/components/billing/BalanceRequestsPanel';
import { SnapToCard } from '@/components/visit/SnapToCard';
import { SettleDischargeDialog } from '@/components/billing/SettleDischargeDialog';
import { BillingSnapInbox } from '@/components/billing/BillingSnapInbox';
// CashierPanel moved to /cashier (dedicated Cashier role)
import { useActiveVisit } from '@/hooks/useVisits';
import { CheckCircle2 } from 'lucide-react';

const Billing = () => {
  const { patients, loading, updatePatientStatus, getPatientsByStatus, refreshPatients } = usePatients();
  const { createInvoice, invoices, getInvoicesForPatient, getPendingInvoices, refreshInvoices } = useInvoices();
  const { prescriptions, getPrescriptionsForPatient } = usePrescriptions();
  const { deductBalance } = useCorporateAccounts();
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<{ id: number; description: string; qty: number; price: number; category: string }[]>([
    { id: 1, description: 'Consultation Fee', qty: 1, price: 5000, category: 'consultation' },
  ]);
  const [invoiceData, setInvoiceData] = useState<{
    open: boolean;
    invoiceNumber: string;
    date: Date;
    items: { description: string; quantity: number; unitPrice: number; total: number }[];
  } | null>(null);

  // Corporate account state
  const [corporateAccount, setCorporateAccount] = useState<CorporateAccount | null>(null);
  const [loadingCorporate, setLoadingCorporate] = useState(false);

  // Get patients in billing workflow
  const billingPatients = getPatientsByStatus(['awaiting_billing', 'awaiting_payment']);

  // Fetch corporate account when a corporate patient is selected
  useEffect(() => {
    const fetchCorporate = async () => {
      if (!selectedPatientId) {
        setCorporateAccount(null);
        return;
      }
      const patient = patients.find(p => p.id === selectedPatientId);
      if (patient?.account_type === 'corporate' && patient?.corporate_id) {
        setLoadingCorporate(true);
        const { data, error } = await supabase
          .from('corporate_accounts')
          .select('*')
          .eq('id', patient.corporate_id)
          .single();
        if (!error && data) {
          setCorporateAccount({
            ...data,
            treatment_limit: Number(data.treatment_limit),
            balance: Number(data.balance),
            discount_percentage: Number(data.discount_percentage),
          } as CorporateAccount);
        } else {
          setCorporateAccount(null);
        }
        setLoadingCorporate(false);
      } else {
        setCorporateAccount(null);
      }
    };
    fetchCorporate();
  }, [selectedPatientId, patients]);

  // Auto-populate invoice items from prescriptions when patient is selected
  useEffect(() => {
    if (selectedPatientId) {
      const patientPrescriptions = getPrescriptionsForPatient(selectedPatientId);
      const dispensedPrescriptions = patientPrescriptions.filter(p => p.status === 'dispensed' || p.status === 'pending');
      
      const existingInvoices = getInvoicesForPatient(selectedPatientId);
      const hasRecentInvoice = existingInvoices.some(inv => {
        const createdAt = new Date(inv.created_at);
        const now = new Date();
        const hoursDiff = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
        return hoursDiff < 24 && (inv.status === 'pending' || inv.status === 'partial');
      });

      if (hasRecentInvoice) return;

      const items: typeof invoiceItems = [
        { id: 1, description: 'Consultation Fee', qty: 1, price: 5000, category: 'consultation' },
      ];

      let nextId = 2;
      dispensedPrescriptions.forEach(prescription => {
        prescription.items?.forEach(item => {
          items.push({
            id: nextId++,
            description: `${item.medication} (${item.dosage}, ${item.frequency}, ${item.duration})`,
            qty: item.quantity,
            price: 500,
            category: 'medication',
          });
        });
      });

      setInvoiceItems(items);
    }
  }, [selectedPatientId, prescriptions]);

  const addItem = () => {
    const newItem = { id: Date.now(), description: '', qty: 1, price: 0, category: 'general' };
    setInvoiceItems([...invoiceItems, newItem]);
  };

  const removeItem = (id: number) => {
    if (invoiceItems.length > 1) {
      setInvoiceItems(invoiceItems.filter(item => item.id !== id));
    }
  };

  const updateItem = (id: number, field: string, value: string | number) => {
    setInvoiceItems(invoiceItems.map(item => 
      item.id === id ? { ...item, [field]: value } : item
    ));
  };

  const subtotal = invoiceItems.reduce((sum, item) => sum + (item.qty * item.price), 0);
  const discountPercent = corporateAccount?.discount_percentage || 0;
  const discountAmount = Math.round(subtotal * discountPercent / 100);
  const total = subtotal - discountAmount;

  const handlePrintPreview = () => {
    const items = invoiceItems.filter(i => i.description).map(item => ({
      description: item.description,
      quantity: item.qty,
      unitPrice: item.price,
      total: item.qty * item.price,
    }));

    if (items.length === 0) {
      toast.error('Empty Invoice', { description: 'Please add items to the invoice.' });
      return;
    }

    setInvoiceData({
      open: true,
      invoiceNumber: `INV-${Date.now().toString(36).toUpperCase()}`,
      date: new Date(),
      items,
    });
  };

  const handleGenerateInvoice = async (payViaCorporate = false) => {
    const validItems = invoiceItems.filter(item => item.description);
    if (validItems.length === 0) {
      toast.error('Empty Invoice', { description: 'Please add items to the invoice before generating.' });
      return;
    }

    if (!selectedPatientId) {
      toast.error('No Patient', { description: 'Please select a patient first.' });
      return;
    }

    const patient = patients.find(p => p.id === selectedPatientId);

    // Corporate payment checks
    if (payViaCorporate && corporateAccount) {
      if (corporateAccount.status !== 'active') {
        toast.error('Account Suspended', { description: `${corporateAccount.company_name} account is suspended.` });
        return;
      }
      if (corporateAccount.balance < total) {
        toast.error('Insufficient Corporate Balance', {
          description: `Balance: ₦${corporateAccount.balance.toLocaleString()} — Invoice: ₦${total.toLocaleString()}`
        });
        return;
      }
      if (corporateAccount.treatment_limit > 0 && total > corporateAccount.treatment_limit) {
        toast.error('Treatment Limit Exceeded', {
          description: `This invoice (₦${total.toLocaleString()}) exceeds the per-treatment limit of ₦${corporateAccount.treatment_limit.toLocaleString()}.`
        });
        return;
      }
    }

    // Build items with discount applied proportionally
    const invoiceItemsMapped = validItems.map(item => ({
      description: item.description,
      quantity: item.qty,
      unitPrice: discountPercent > 0 ? Math.round(item.price * (1 - discountPercent / 100)) : item.price,
      category: item.category,
    }));
    
    const invoice = await createInvoice(
      selectedPatientId,
      invoiceItemsMapped,
      corporateAccount && discountPercent > 0 ? `Corporate discount: ${discountPercent}% (${corporateAccount.company_name})` : undefined
    );

    if (invoice) {
      // If paying via corporate, deduct balance and mark as paid
      if (payViaCorporate && corporateAccount) {
        const deducted = await deductBalance(corporateAccount.id, total);
        if (deducted) {
          // Mark invoice as paid with corporate method
          await supabase
            .from('invoices')
            .update({
              paid_amount: total,
              status: 'paid',
              payment_method: 'corporate',
              paid_at: new Date().toISOString(),
              notes: `Paid via corporate account: ${corporateAccount.company_name}`,
            })
            .eq('id', invoice.id);

          toast.success('Corporate Payment Processed', {
            description: `₦${total.toLocaleString()} deducted from ${corporateAccount.company_name} account.`
          });
        }
      }

      await updatePatientStatus(selectedPatientId, payViaCorporate ? 'at_pharmacy' : 'awaiting_payment');

      await paymentAuditLogger(
        'payment_received',
        invoice.invoice_number,
        { 
          patient_id: selectedPatientId,
          patient_name: patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown',
          action: payViaCorporate ? 'corporate_payment' : 'invoice_generated',
          total_amount: total,
          discount_applied: discountAmount,
          corporate_account: corporateAccount?.company_name || null,
          items_count: validItems.length,
        }
      );

      setInvoiceData({
        open: true,
        invoiceNumber: invoice.invoice_number,
        date: new Date(),
        items: validItems.map(item => ({
          description: item.description,
          quantity: item.qty,
          unitPrice: item.price,
          total: item.qty * item.price,
        })),
      });

      toast.success('Invoice Generated', {
        description: `Invoice of ₦${total.toLocaleString()} for ${patient?.first_name} ${patient?.last_name}${payViaCorporate ? ' (Corporate)' : ''}`
      });

      setInvoiceItems([{ id: 1, description: 'Consultation Fee', qty: 1, price: 5000, category: 'consultation' }]);
      setSelectedPatientId(null);
    } else {
      toast.error('Error', { description: 'Failed to generate invoice. Please try again.' });
    }
  };

  const selectedPatient = patients.find(p => p.id === selectedPatientId);

  const getPatientInvoiceStatus = (patientId: string) => {
    const patientInvoices = getInvoicesForPatient(patientId);
    const pending = patientInvoices.filter(i => i.status === 'pending');
    const partial = patientInvoices.filter(i => i.status === 'partial');
    const paid = patientInvoices.filter(i => i.status === 'paid');
    
    if (pending.length > 0) return { status: 'pending' as const, amount: pending[0].total_amount, invoice: pending[0] };
    if (partial.length > 0) return { status: 'partial' as const, amount: partial[0].total_amount - partial[0].paid_amount, invoice: partial[0] };
    if (paid.length > 0) return { status: 'paid' as const, amount: 0, invoice: paid[0] };
    return { status: 'none' as const, amount: 0, invoice: null };
  };

  return (
    <MainLayout title="Billing" subtitle="Invoice generation and payment tracking">
      {/* Connection Status */}
      <div className="mb-4 flex items-center gap-2">
        {loading ? (
          <Badge variant="outline" className="flex items-center gap-1">
            <WifiOff className="h-3 w-3" />
            Loading...
          </Badge>
        ) : (
          <Badge variant="success" className="flex items-center gap-1">
            <Wifi className="h-3 w-3" />
            Real-time Connected
          </Badge>
        )}
        <span className="text-sm text-muted-foreground">
          {billingPatients.length} patient(s) in billing
        </span>
        <span className="text-sm text-muted-foreground">
          • {getPendingInvoices().length} unpaid invoice(s)
        </span>
        <Button variant="ghost" size="sm" onClick={() => { refreshPatients(); refreshInvoices(); }} className="h-7 px-2 ml-auto">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Invoices */}
        <div className="lg:col-span-1 space-y-4">
          {/* Recent Invoices */}
          <div className="bg-card rounded-xl border border-border p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4 text-module-billing" />
              Recent Invoices
            </h3>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {invoices.slice(0, 10).map(invoice => {
                const patient = patients.find(p => p.id === invoice.patient_id);
                return (
                  <div key={invoice.id} className="p-2 rounded-lg border border-border text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-muted-foreground">{invoice.invoice_number}</span>
                      <Badge 
                        variant={invoice.status === 'paid' ? 'success' : invoice.status === 'partial' ? 'warning' : 'outline'}
                        className="text-[10px]"
                      >
                        {invoice.status}
                      </Badge>
                    </div>
                    <p className="font-medium">{patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown'}</p>
                    <div className="flex justify-between mt-1">
                      <span className="text-muted-foreground">₦{invoice.total_amount.toLocaleString()}</span>
                      {invoice.payment_method === 'corporate' && (
                        <Badge variant="outline" className="text-[9px]">Corporate</Badge>
                      )}
                      {invoice.paid_amount > 0 && (
                        <span className="text-success">Paid: ₦{invoice.paid_amount.toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                );
              })}
              {invoices.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No invoices yet</p>
              )}
            </div>
          </div>
        </div>

        {/* Snap Inbox */}
        <div className="lg:col-span-5 mt-2">
          <BillingSnapInbox />
        </div>
      </div>

      {/* Printable Billing Invoice Dialog */}
      {invoiceData && (
        <PrintableBillingInvoiceDialog
          open={invoiceData.open}
          onOpenChange={(open) => setInvoiceData(open ? invoiceData : null)}
          patientName={selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name}` : 'Walk-in Patient'}
          cardNumber={selectedPatient?.card_number || 'N/A'}
          invoiceNumber={invoiceData.invoiceNumber}
          date={invoiceData.date}
          items={invoiceData.items}
          totalAmount={total}
          amountPaid={0}
          balance={total}
          paymentMethod="Pending"
        />
      )}
    </MainLayout>
  );
};

/** Small bar rendered above invoice generator showing active visit + Snap + Settle. */
function VisitCardBar({ patientId }: { patientId: string }) {
  const { visit, refresh } = useActiveVisit(patientId);
  const [settleOpen, setSettleOpen] = useState(false);

  if (!visit) {
    return (
      <div className="mt-3 p-2 rounded-md border border-dashed border-border text-xs text-muted-foreground">
        No open visit card for this patient. Reception opens one at check-in.
      </div>
    );
  }

  const outstanding = Number(visit.total_charged) - Number(visit.total_paid);

  return (
    <div className="mt-3 flex items-center justify-between gap-2 p-2 rounded-md border border-primary/30 bg-primary/5 flex-wrap">
      <div className="text-xs">
        <span className="font-mono font-semibold">{visit.visit_number}</span>
        <span className="text-muted-foreground"> · charged ₦{Number(visit.total_charged).toLocaleString()}</span>
        {outstanding > 0 && <span className="text-destructive"> · owing ₦{outstanding.toLocaleString()}</span>}
      </div>
      <div className="flex items-center gap-2">
        <SnapToCard patientId={patientId} station="billing" defaultLabel="Billing receipt" />
        <Button size="sm" variant="hero" onClick={() => setSettleOpen(true)}>
          <CheckCircle2 className="h-4 w-4 mr-1" />
          Settle & Discharge
        </Button>
      </div>
      <SettleDischargeDialog open={settleOpen} onOpenChange={setSettleOpen} visit={visit} onSettled={refresh} />
    </div>
  );
}

export default Billing;

