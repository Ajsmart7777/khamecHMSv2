import { useState, useMemo } from 'react';
import { Wallet, Search, Banknote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useInvoices, Invoice } from '@/hooks/useInvoices';
import { usePatients } from '@/contexts/PatientContext';
import { paymentAuditLogger } from '@/lib/auditLogger';

export function CashierPanel() {
  const { getPendingInvoices, recordPayment } = useInvoices();
  const { patients, updatePatientStatus } = usePatients();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<string>('cash');
  const [busy, setBusy] = useState(false);

  const pending = getPendingInvoices();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pending
      .map((inv) => {
        const patient = patients.find((p) => p.id === inv.patient_id);
        return { inv, patient };
      })
      .filter(({ inv, patient }) => {
        if (!q) return true;
        return (
          inv.invoice_number.toLowerCase().includes(q) ||
          patient?.first_name?.toLowerCase().includes(q) ||
          patient?.last_name?.toLowerCase().includes(q) ||
          patient?.card_number?.toLowerCase().includes(q)
        );
      });
  }, [pending, patients, query]);

  const openPayment = (inv: Invoice) => {
    setSelected(inv);
    const outstanding = Number(inv.total_amount) - Number(inv.paid_amount);
    setAmount(String(outstanding));
    setMethod('cash');
  };

  const submit = async () => {
    if (!selected) return;
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    const outstanding = Number(selected.total_amount) - Number(selected.paid_amount);
    if (amt > outstanding) {
      toast.error('Amount exceeds outstanding balance');
      return;
    }
    setBusy(true);
    const ok = await recordPayment(selected.id, amt, method);
    setBusy(false);
    if (!ok) {
      toast.error('Failed to record payment');
      return;
    }
    const patient = patients.find((p) => p.id === selected.patient_id);
    await paymentAuditLogger('payment_received', selected.invoice_number, {
      patient_id: selected.patient_id,
      patient_name: patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown',
      action: 'payment_recorded',
      amount: amt,
      method,
    });
    // Move to pharmacy if fully paid
    if (amt >= outstanding) {
      await updatePatientStatus(selected.patient_id, 'at_pharmacy');
    }
    toast.success('Payment recorded', {
      description: `₦${amt.toLocaleString()} via ${method} · ${selected.invoice_number}`,
    });
    setSelected(null);
    setAmount('');
  };

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <Wallet className="h-4 w-4 text-module-billing" />
          Cashier · Record Payment
        </h3>
        <Badge variant="warning">{pending.length}</Badge>
      </div>

      <div className="relative mb-3">
        <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search invoice # or patient…"
          className="h-8 pl-7 text-sm"
        />
      </div>

      <div className="space-y-2 max-h-[360px] overflow-y-auto">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">
            No unpaid invoices
          </p>
        )}
        {rows.map(({ inv, patient }) => {
          const outstanding = Number(inv.total_amount) - Number(inv.paid_amount);
          return (
            <div
              key={inv.id}
              className="p-3 rounded-lg border border-border hover:border-module-billing/50 transition-all"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {inv.invoice_number}
                </span>
                <Badge
                  variant={inv.status === 'partial' ? 'warning' : 'outline'}
                  className="text-[10px]"
                >
                  {inv.status}
                </Badge>
              </div>
              <p className="font-medium text-sm truncate">
                {patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown patient'}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {patient?.card_number}
              </p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="text-xs">
                  <span className="text-muted-foreground">Owing </span>
                  <span className="font-bold text-destructive">
                    ₦{outstanding.toLocaleString()}
                  </span>
                </div>
                <Button size="sm" onClick={() => openPayment(inv)} className="h-7">
                  <Banknote className="h-3.5 w-3.5 mr-1" />
                  Record
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              {selected?.invoice_number} · Outstanding ₦
              {selected
                ? (Number(selected.total_amount) - Number(selected.paid_amount)).toLocaleString()
                : 0}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label>Amount (₦)</Label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <Label>Payment Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="pos">POS / Card</SelectItem>
                  <SelectItem value="transfer">Bank Transfer</SelectItem>
                  <SelectItem value="balance">Patient Balance</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setSelected(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? 'Recording…' : 'Confirm Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
