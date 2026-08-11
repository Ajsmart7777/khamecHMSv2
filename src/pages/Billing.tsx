import { useSelectedPatientParam } from '@/hooks/useSelectedPatientParam';
import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { UniversalPatientHeader } from '@/components/patient/UniversalPatientHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Receipt, 
  Send, 
  Printer,
  Plus,
  Trash2,
  Wifi,
  FileText,
  Building2,
  RefreshCw,
  PlusCircle
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePatients } from '@/contexts/PatientContext';
import { PrintableBillingInvoiceDialog } from '@/components/receipts/PrintableBillingInvoiceDialog';
import { paymentAuditLogger } from '@/lib/auditLogger';
import { useInvoices } from '@/hooks/useInvoices';
import { useCorporateAccounts, CorporateAccount } from '@/hooks/useCorporateAccounts';
import { supabase } from '@/integrations/supabase/client';
import { nextStationForInvoice } from '@/lib/workflowRouting';
import { SnapToCard } from '@/components/visit/SnapToCard';
import { SettleDischargeDialog } from '@/components/billing/SettleDischargeDialog';
import { BillingSnapInbox } from '@/components/billing/BillingSnapInbox';
import { useActiveVisit } from '@/hooks/useVisits';
import { CheckCircle2 } from 'lucide-react';

const Billing = () => {
  const { patients, loading, updatePatientStatus, refreshPatients } = usePatients();
  const { createInvoice, invoices, getInvoicesForPatient, getPendingInvoices, refreshInvoices } = useInvoices();
  const { deductBalance } = useCorporateAccounts();
  const [selectedPatientId, setSelectedPatientId] = useSelectedPatientParam();
  const [invoiceItems, setInvoiceItems] = useState<{ id: number; description: string; qty: number; price: number; category: string }[]>([
    { id: 1, description: '', qty: 1, price: 0, category: 'general' },
  ]);
  const [invoiceData, setInvoiceData] = useState<{
    open: boolean;
    invoiceNumber: string;
    date: Date;
    items: { description: string; quantity: number; unitPrice: number; total: number }[];
  } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const [corporateAccount, setCorporateAccount] = useState<CorporateAccount | null>(null);
  
  const selectedPatient = selectedPatientId ? patients.find(p => p.id === selectedPatientId) : null;

  useEffect(() => {
    const fetchCorporate = async () => {
      if (!selectedPatientId || !selectedPatient) {
        setCorporateAccount(null);
        return;
      }
      if (selectedPatient.account_type === 'corporate' && selectedPatient.corporate_id) {
        const { data, error } = await supabase
          .from('corporate_accounts')
          .select('*')
          .eq('id', selectedPatient.corporate_id)
          .single();
        if (!error && data) {
          setCorporateAccount({
            ...data,
            treatment_limit: Number(data.treatment_limit),
            balance: Number(data.balance),
            discount_percentage: Number(data.discount_percentage),
          } as CorporateAccount);
        }
      } else {
        setCorporateAccount(null);
      }
    };
    fetchCorporate();
  }, [selectedPatientId, selectedPatient]);

  const addItem = () => {
    const newItem = { id: Date.now(), description: '', qty: 1, price: 0, category: 'general' };
    setInvoiceItems([...invoiceItems, newItem]);
  };

  const removeItem = (id: number) => {
    if (invoiceItems.length > 1) {
      setInvoiceItems(invoiceItems.filter(item => item.id !== id));
    } else {
      setInvoiceItems([{ id: Date.now(), description: '', qty: 1, price: 0, category: 'general' }]);
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
    const items = invoiceItems.filter(i => i.description.trim()).map(item => ({
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
      invoiceNumber: `INV-PREVIEW`,
      date: new Date(),
      items,
    });
  };

  const handleGenerateInvoice = async (payViaCorporate = false) => {
    if (isGenerating) return;
    setIsGenerating(true);
    
    try {
      const validItems = invoiceItems.filter(item => item.description.trim());
      if (validItems.length === 0) {
        toast.error('Empty Invoice', { description: 'Please add items to the invoice before generating.' });
        return;
      }

      if (!selectedPatientId) {
        toast.error('No Patient', { description: 'Please select a patient first.' });
        return;
      }

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
        if (payViaCorporate && corporateAccount) {
          const deducted = await deductBalance(corporateAccount.id, total);
          if (deducted) {
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
          }
        }

        // For custom bills generated here, we only update status if it was 'awaiting_payment'
        // and we want to check if they have other clinical work.
        // But based on the requirement, custom bills should not move patients at all.
        // We will only call updatePatientStatus if there's clinical work pending.
        const nextStatus = payViaCorporate
          ? await nextStationForInvoice(invoice.id, selectedPatientId)
          : null;
        
        if (nextStatus) {
          await updatePatientStatus(selectedPatientId, nextStatus);
        }

        await paymentAuditLogger(
          'payment_received',
          invoice.invoice_number,
          { 
            patient_id: selectedPatientId,
            patient_name: selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name}` : 'Unknown',
            action: payViaCorporate ? 'corporate_payment' : 'invoice_generated',
            total_amount: total,
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

        toast.success('Invoice Generated');
        setInvoiceItems([{ id: Date.now(), description: '', qty: 1, price: 0, category: 'general' }]);
        setSelectedPatientId(null);
      }
    } catch (error) {
      console.error('Error generating invoice:', error);
      toast.error('Failed to generate invoice');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <MainLayout title="Billing" subtitle="Invoice generation and payment tracking">
      <div className="mb-4 flex items-center gap-2">
        {loading ? (
          <Badge variant="outline" className="flex items-center gap-1">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Loading...
          </Badge>
        ) : (
          <Badge variant="success" className="flex items-center gap-1">
            <Wifi className="h-3 w-3" />
            Connected
          </Badge>
        )}
        <Button variant="ghost" size="sm" onClick={() => { refreshPatients(); refreshInvoices(); }} className="h-7 px-2 ml-auto">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-card rounded-xl border border-border p-5 shadow-sm">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" />
              Create Custom Bill
            </h3>

            <div className="space-y-6">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1 space-y-2">
                  <label className="text-sm font-medium">Select Patient</label>
                  <Select value={selectedPatientId || ''} onValueChange={setSelectedPatientId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Search patient..." />
                    </SelectTrigger>
                    <SelectContent>
                      {patients.map(p => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.first_name} {p.last_name} ({p.card_number})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 space-y-2">
                  <label className="text-sm font-medium">Account Info</label>
                  <div className="h-10 px-3 flex items-center rounded-md border bg-muted/30 text-sm">
                    {selectedPatient ? (
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{selectedPatient.account_type.replace('_', ' ')}</Badge>
                        <span className="font-mono text-xs">₦{selectedPatient.balance.toLocaleString()}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground italic">Select patient to view balance</span>
                    )}
                  </div>
                </div>
              </div>

              {selectedPatient && <VisitCardBar patientId={selectedPatient.id} />}

              <div className="space-y-4 border-t pt-6">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Invoice Items</h4>
                  <Button variant="outline" size="sm" onClick={addItem} className="h-8">
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Item
                  </Button>
                </div>

                <div className="space-y-3">
                  {invoiceItems.map((item) => (
                    <div key={item.id} className="flex flex-col md:flex-row gap-3 items-start">
                      <div className="flex-1 w-full">
                        <Input
                          placeholder="Item description..."
                          value={item.description}
                          onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                        />
                      </div>
                      <div className="w-full md:w-24">
                        <Input
                          type="number"
                          placeholder="Qty"
                          min="1"
                          value={item.qty}
                          onChange={(e) => updateItem(item.id, 'qty', parseInt(e.target.value) || 1)}
                        />
                      </div>
                      <div className="w-full md:w-32">
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₦</span>
                          <Input
                            type="number"
                            placeholder="Price"
                            className="pl-7"
                            value={item.price}
                            onChange={(e) => updateItem(item.id, 'price', parseInt(e.target.value) || 0)}
                          />
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        onClick={() => removeItem(item.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="bg-muted/30 rounded-lg p-4 border border-border flex flex-col md:flex-row justify-between items-center gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest">Grand Total</p>
                    <p className="text-3xl font-black text-primary">₦{total.toLocaleString()}</p>
                  </div>
                  <div className="flex gap-2 w-full md:w-auto">
                    <Button variant="outline" onClick={handlePrintPreview}>
                      <Printer className="h-4 w-4 mr-2" /> Preview
                    </Button>
                    {corporateAccount ? (
                      <Button variant="hero" onClick={() => handleGenerateInvoice(true)}>
                        <Building2 className="h-4 w-4 mr-2" /> Pay via Corporate
                      </Button>
                    ) : (
                      <Button variant="hero" onClick={() => handleGenerateInvoice(false)}>
                        <Send className="h-4 w-4 mr-2" /> Generate Invoice
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <BillingSnapInbox />
        </div>

        <div className="lg:col-span-4 space-y-6">
          <div className="bg-card rounded-xl border border-border p-4 shadow-sm">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              Recent Invoices
            </h3>
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
              {invoices.slice(0, 20).map(invoice => {
                const p = patients.find(pat => pat.id === invoice.patient_id);
                return (
                  <div key={invoice.id} className="p-2 rounded-lg border text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs">{invoice.invoice_number}</span>
                      <Badge variant={invoice.status === 'paid' ? 'success' : 'outline'} className="text-[10px]">
                        {invoice.status}
                      </Badge>
                    </div>
                    <p className="font-medium truncate">{p ? `${p.first_name} ${p.last_name}` : 'Unknown'}</p>
                    <p className="text-muted-foreground">₦{invoice.total_amount.toLocaleString()}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

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

function VisitCardBar({ patientId }: { patientId: string }) {
  const { visit, refresh } = useActiveVisit(patientId);
  const [settleOpen, setSettleOpen] = useState(false);

  if (!visit) return null;

  const outstanding = Number(visit.total_charged) - Number(visit.total_paid);

  return (
    <div className="mt-3 flex items-center justify-between gap-2 p-3 rounded-md border border-primary/30 bg-primary/5">
      <div className="text-xs">
        <span className="font-mono font-semibold">{visit.visit_number}</span>
        <span className="text-muted-foreground"> · owing ₦{outstanding.toLocaleString()}</span>
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
