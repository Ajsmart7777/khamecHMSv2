import { useState, useMemo } from 'react';
import { Wallet, Search, Banknote, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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
import { supabase } from '@/integrations/supabase/client';

const DEBT_ELIGIBLE = new Set(['normal', 'staff', 'staff_family']);

export function CashierPanel() {
  const { getPendingInvoices, recordPayment, refreshInvoices } = useInvoices();
  const { patients, updatePatientStatus } = usePatients();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<string>('cash');
  const [markDebt, setMarkDebt] = useState(false);
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

  const selectedPatient = selected
    ? patients.find((p) => p.id === selected.patient_id)
    : null;
  const debtEligible =
    !!selectedPatient && DEBT_ELIGIBLE.has(selectedPatient.account_type as string);
  const outstanding = selected
    ? Number(selected.total_amount) - Number(selected.paid_amount)
    : 0;
  const paying = Number(amount) || 0;
  const shortfall = Math.max(outstanding - paying, 0);

  const openPayment = (inv: Invoice) => {
    setSelected(inv);
    const out = Number(inv.total_amount) - Number(inv.paid_amount);
    setAmount(String(out));
    setMethod('cash');
    setMarkDebt(false);
  };

  const submit = async () => {
    if (!selected || !selectedPatient) return;
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    if (amt > outstanding) {
      toast.error('Amount exceeds outstanding balance');
      return;
    }
    const short = outstanding - amt;
    if (short > 0 && !markDebt) {
      toast.error('Short payment — tick "Mark remainder as debt" to proceed');
      return;
    }
    if (short > 0 && !debtEligible) {
      toast.error('This account type cannot carry debt');
      return;
    }

    setBusy(true);
    // 1. Record the actual cash received
    const ok = await recordPayment(selected.id, amt, method);
    if (!ok) {
      setBusy(false);
      toast.error('Failed to record payment');
      return;
    }

    // 2. If short-paid with debt approval: close invoice + push shortfall to patient debt
    if (short > 0) {
      const { error: closeErr } = await supabase
        .from('invoices')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          notes: `Short payment — ₦${short.toLocaleString()} moved to patient debt`,
        })
        .eq('id', selected.id);
      if (closeErr) {
        setBusy(false);
        toast.error('Failed to close invoice');
        return;
      }

      const { error: debtErr } = await supabase.rpc('adjust_patient_balance', {
        _patient_id: selected.patient_id,
        _delta: -short,
        _transaction_type: 'debt_incurred',
        _payment_method: method,
        _related_invoice_id: selected.id,
        _notes: `Shortfall on invoice ${selected.invoice_number}`,
      });
      if (debtErr) {
        setBusy(false);
        toast.error(`Failed to record debt: ${debtErr.message}`);
        return;
      }
      await refreshInvoices();
    }

    setBusy(false);
    await paymentAuditLogger('payment_received', selected.invoice_number, {
      patient_id: selected.patient_id,
      patient_name: `${selectedPatient.first_name} ${selectedPatient.last_name}`,
      action: short > 0 ? 'payment_recorded_with_debt' : 'payment_recorded',
      amount: amt,
      method,
      shortfall: short,
    });

    // Move to pharmacy (invoice is settled either fully or via debt)
    await updatePatientStatus(selected.patient_id, 'at_pharmacy');

    toast.success(
      short > 0 ? 'Payment recorded with debt' : 'Payment recorded',
      {
        description:
          short > 0
            ? `₦${amt.toLocaleString()} received · ₦${short.toLocaleString()} added as debt`
            : `₦${amt.toLocaleString()} via ${method} · ${selected.invoice_number}`,
      }
    );
    setSelected(null);
    setAmount('');
    setMarkDebt(false);
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
          const out = Number(inv.total_amount) - Number(inv.paid_amount);
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
                    ₦{out.toLocaleString()}
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
              {selected?.invoice_number} · Outstanding ₦{outstanding.toLocaleString()}
              {selectedPatient && (
                <span className="block text-xs mt-1">
                  {selectedPatient.first_name} {selectedPatient.last_name} ·{' '}
                  <span className="capitalize">{selectedPatient.account_type}</span> ·
                  Balance ₦{Number(selectedPatient.balance ?? 0).toLocaleString()}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label>Amount Received (₦)</Label>
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

            {shortfall > 0 && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning mt-0.5" />
                  <div className="text-xs">
                    <p className="font-semibold text-warning-foreground">
                      Short by ₦{shortfall.toLocaleString()}
                    </p>
                    {debtEligible ? (
                      <p className="text-muted-foreground mt-0.5">
                        This will be added as debt on the patient's balance.
                        New balance will be ₦
                        {(
                          Number(selectedPatient?.balance ?? 0) - shortfall
                        ).toLocaleString()}
                        . Next top-up clears it automatically.
                      </p>
                    ) : (
                      <p className="text-destructive mt-0.5">
                        Debt not allowed for this account type — collect full amount.
                      </p>
                    )}
                  </div>
                </div>
                {debtEligible && (
                  <label className="flex items-center gap-2 cursor-pointer text-xs">
                    <Checkbox
                      checked={markDebt}
                      onCheckedChange={(v) => setMarkDebt(!!v)}
                    />
                    <span>Mark ₦{shortfall.toLocaleString()} as debt on patient balance</span>
                  </label>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setSelected(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={busy || (shortfall > 0 && (!debtEligible || !markDebt))}
            >
              {busy ? 'Recording…' : shortfall > 0 ? 'Confirm & Record Debt' : 'Confirm Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
