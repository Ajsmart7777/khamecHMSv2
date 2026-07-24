import { useState, useMemo, useEffect } from 'react';
import { Wallet, Search, Banknote, AlertTriangle, PiggyBank, Shield, Send } from 'lucide-react';
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
import { copayPercent, isSponsored, sponsorLabel, splitInvoice } from '@/lib/copay';
import { PrintableReceiptDialog } from '@/components/receipts/PrintableReceiptDialog';

const DEBT_ELIGIBLE = new Set(['normal', 'staff', 'staff_family']);

export function CashierPanel() {
  const { getPendingInvoices, recordPayment, refreshInvoices } = useInvoices();
  const { patients, updatePatientStatus, refreshPatients } = usePatients() as any;
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [cashAmount, setCashAmount] = useState('');
  const [method, setMethod] = useState<string>('cash');
  const [useBalance, setUseBalance] = useState(false);
  const [balanceAmount, setBalanceAmount] = useState('');
  const [markDebt, setMarkDebt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{
    patient: any;
    amount: number;
    paymentMethod: string;
    receiptNumber: string;
    date: Date;
    newBalance: number;
    breakdown: {
      invoiceNumber: string;
      invoiceTotal: number;
      sponsorCovered: number;
      patientCopay: number;
      sponsorLabel: string | null;
      copayPct: number;
    };
  } | null>(null);

  const pending = getPendingInvoices();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pending
      .map((inv) => {
        const patient = patients.find((p: any) => p.id === inv.patient_id);
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
    ? patients.find((p: any) => p.id === selected.patient_id)
    : null;
  const patientBalance = Number(selectedPatient?.balance ?? 0);
  const availableBalance = Math.max(patientBalance, 0);
  const debtEligible =
    !!selectedPatient && DEBT_ELIGIBLE.has(selectedPatient.account_type as string);
  const invoiceTotal = selected ? Number(selected.total_amount) : 0;
  const alreadyPaid = selected ? Number(selected.paid_amount) : 0;

  // Sponsor split — only meaningful when the patient is insured/sponsored.
  const sponsored = selectedPatient ? isSponsored(selectedPatient) : false;
  const split = selectedPatient
    ? splitInvoice(invoiceTotal, selectedPatient)
    : { copayPct: 100, copayAmount: invoiceTotal, coveredAmount: 0 };

  // For sponsored patients the cashier only ever collects the copay portion;
  // the sponsor share is auto-settled and routed to the Claims queue.
  const outstanding = sponsored
    ? Math.max(split.copayAmount - alreadyPaid, 0)
    : Math.max(invoiceTotal - alreadyPaid, 0);
  const fullCover = sponsored && split.copayAmount === 0;

  const cash = Math.max(Number(cashAmount) || 0, 0);
  const bal = useBalance ? Math.max(Number(balanceAmount) || 0, 0) : 0;
  const applied = cash + bal;
  const shortfall = Math.max(outstanding - applied, 0);
  const overpay = Math.max(applied - outstanding, 0);
  const balExceedsAvail = bal > availableBalance;

  const openPayment = (inv: Invoice) => {
    setSelected(inv);
    const p = patients.find((pp: any) => pp.id === inv.patient_id);
    const spon = p ? isSponsored(p) : false;
    const s = p
      ? splitInvoice(Number(inv.total_amount), p)
      : { copayAmount: Number(inv.total_amount) - Number(inv.paid_amount) };
    const out = spon
      ? Math.max(s.copayAmount - Number(inv.paid_amount), 0)
      : Number(inv.total_amount) - Number(inv.paid_amount);
    setCashAmount(String(out));
    setMethod('cash');
    setUseBalance(false);
    setBalanceAmount('');
    setMarkDebt(false);
  };

  // When user toggles "use balance", auto-suggest amounts
  useEffect(() => {
    if (!selected) return;
    if (useBalance) {
      const useFromBal = Math.min(availableBalance, outstanding);
      setBalanceAmount(String(useFromBal));
      setCashAmount(String(Math.max(outstanding - useFromBal, 0)));
    } else {
      setBalanceAmount('');
      setCashAmount(String(outstanding));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useBalance, selected?.id]);

  const submit = async () => {
    if (!selected || !selectedPatient) return;

    // Full-cover sponsored invoice — nothing to collect, just settle & send.
    if (fullCover) {
      setBusy(true);
      try {
        const remaining = invoiceTotal - alreadyPaid;
        if (remaining > 0) {
          const ok = await recordPayment(selected.id, remaining, 'sponsor_claim');
          if (!ok) throw new Error('Failed to settle sponsor claim');
        }
        await refreshInvoices();
        await paymentAuditLogger('payment_received', selected.invoice_number, {
          patient_id: selected.patient_id,
          patient_name: `${selectedPatient.first_name} ${selectedPatient.last_name}`,
          action: 'sponsor_fully_covered',
          sponsor: sponsorLabel(selectedPatient),
          covered_amount: remaining,
          copay_amount: 0,
        });
        await updatePatientStatus(selected.patient_id, 'at_pharmacy');
        toast.success('Acknowledged — sent to Claims', {
          description: `${selected.invoice_number} · Sponsor covers ₦${remaining.toLocaleString()}`,
        });
        setReceipt({
          patient: selectedPatient,
          amount: 0,
          paymentMethod: 'sponsor_claim',
          receiptNumber: selected.invoice_number,
          date: new Date(),
          newBalance: patientBalance,
          breakdown: {
            invoiceNumber: selected.invoice_number,
            invoiceTotal,
            sponsorCovered: invoiceTotal,
            patientCopay: 0,
            sponsorLabel: sponsorLabel(selectedPatient),
            copayPct: 0,
          },
        });
        setSelected(null);
      } catch (err: any) {
        toast.error(err?.message || 'Failed to acknowledge');
      } finally { setBusy(false); }
      return;
    }

    if (applied <= 0) {
      toast.error('Enter an amount to record');
      return;
    }
    if (overpay > 0) {
      toast.error(sponsored ? 'Total exceeds patient copay' : 'Total exceeds outstanding balance');
      return;
    }
    if (bal > 0 && balExceedsAvail) {
      toast.error(`Only ₦${availableBalance.toLocaleString()} available on balance`);
      return;
    }
    if (!sponsored && shortfall > 0 && !markDebt) {
      toast.error('Short payment — tick "Mark remainder as debt" to proceed');
      return;
    }
    if (!sponsored && shortfall > 0 && !debtEligible) {
      toast.error('This account type cannot carry debt');
      return;
    }
    if (sponsored && shortfall > 0) {
      toast.error(`Collect the full copay of ₦${split.copayAmount.toLocaleString()} before sending to Claims`);
      return;
    }

    setBusy(true);
    try {
      // 1. Deduct from patient balance first (if any)
      if (bal > 0) {
        const { error: balErr } = await supabase.rpc('adjust_patient_balance', {
          _patient_id: selected.patient_id,
          _delta: -bal,
          _transaction_type: 'invoice_deduction',
          _payment_method: 'balance',
          _related_invoice_id: selected.id,
          _notes: `Applied to invoice ${selected.invoice_number}`,
        });
        if (balErr) throw new Error(`Balance deduction failed: ${balErr.message}`);

        const ok = await recordPayment(selected.id, bal, 'balance');
        if (!ok) throw new Error('Failed to record balance payment on invoice');
      }

      // 2. Record cash/POS/transfer portion
      if (cash > 0) {
        const ok = await recordPayment(selected.id, cash, method);
        if (!ok) throw new Error('Failed to record cash payment');
      }

      // 3. Handle debt shortfall
      if (!sponsored && shortfall > 0) {
        const { error: closeErr } = await supabase
          .from('invoices')
          .update({
            paid_amount: Number(selected.total_amount),
            status: 'paid',
            paid_at: new Date().toISOString(),
            notes: `Short payment — ₦${shortfall.toLocaleString()} moved to patient debt`,
          })
          .eq('id', selected.id);
        if (closeErr) throw new Error(`Failed to close invoice: ${closeErr.message}`);

        const { error: debtErr } = await supabase.rpc('adjust_patient_balance', {
          _patient_id: selected.patient_id,
          _delta: -shortfall,
          _transaction_type: 'debt_incurred',
          _payment_method: method,
          _related_invoice_id: selected.id,
          _notes: `Shortfall on invoice ${selected.invoice_number}`,
        });
        if (debtErr) throw new Error(`Failed to record debt: ${debtErr.message}`);
      }

      // Sponsored: after copay is collected, book the sponsor portion so the
      // invoice becomes fully paid and flows to the Claims queue.
      if (sponsored) {
        const coveredRemaining = invoiceTotal - alreadyPaid - bal - cash;
        if (coveredRemaining > 0) {
          const ok = await recordPayment(selected.id, coveredRemaining, 'sponsor_claim');
          if (!ok) throw new Error('Failed to settle sponsor portion');
        }
      }

      await refreshInvoices();
      if (typeof refreshPatients === 'function') await refreshPatients();

      await paymentAuditLogger('payment_received', selected.invoice_number, {
        patient_id: selected.patient_id,
        patient_name: `${selectedPatient.first_name} ${selectedPatient.last_name}`,
        action: sponsored
          ? 'copay_recorded_sponsor_billed'
          : shortfall > 0
          ? 'payment_recorded_with_debt'
          : 'payment_recorded',
        sponsor: sponsored ? sponsorLabel(selectedPatient) : null,
        cash_amount: cash,
        balance_amount: bal,
        copay_amount: sponsored ? cash + bal : undefined,
        covered_amount: sponsored ? Math.max(invoiceTotal - split.copayAmount, 0) : undefined,
        method,
        shortfall: sponsored ? 0 : shortfall,
      });

      // Move to pharmacy — invoice is fully settled (paid + balance + debt = outstanding)
      await updatePatientStatus(selected.patient_id, 'at_pharmacy');

      const parts: string[] = [];
      if (cash > 0) parts.push(`₦${cash.toLocaleString()} ${method}`);
      if (bal > 0) parts.push(`₦${bal.toLocaleString()} balance`);
      if (!sponsored && shortfall > 0) parts.push(`₦${shortfall.toLocaleString()} owed on balance`);
      if (sponsored) parts.push(`sponsor ₦${(invoiceTotal - split.copayAmount).toLocaleString()} → Claims`);

      toast.success(
        sponsored
          ? 'Copay collected — sent to Claims'
          : shortfall > 0 ? 'Partial payment recorded' : 'Payment recorded',
        { description: `${selected.invoice_number} · ${parts.join(' + ')}` }
      );

      // Open printable receipt with a clean breakdown.
      setReceipt({
        patient: selectedPatient,
        amount: cash + bal,
        paymentMethod: bal > 0 && cash === 0 ? 'balance' : method,
        receiptNumber: selected.invoice_number,
        date: new Date(),
        newBalance: Number(patientBalance) - bal - (!sponsored && shortfall > 0 ? shortfall : 0),
        breakdown: {
          invoiceNumber: selected.invoice_number,
          invoiceTotal,
          sponsorCovered: sponsored ? split.coveredAmount : 0,
          patientCopay: sponsored ? split.copayAmount : invoiceTotal,
          sponsorLabel: sponsored ? sponsorLabel(selectedPatient) : null,
          copayPct: sponsored ? split.copayPct : 100,
        },
      });

      setSelected(null);
      setCashAmount('');
      setBalanceAmount('');
      setUseBalance(false);
      setMarkDebt(false);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to record payment');
    } finally {
      setBusy(false);
    }
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
          const spon = patient ? isSponsored(patient) : false;
          const s = patient
            ? splitInvoice(Number(inv.total_amount), patient)
            : { copayPct: 100, copayAmount: Number(inv.total_amount), coveredAmount: 0 };
          const rowOut = spon
            ? Math.max(s.copayAmount - Number(inv.paid_amount), 0)
            : Number(inv.total_amount) - Number(inv.paid_amount);
          const bal = Number(patient?.balance ?? 0);
          const rowFull = spon && s.copayAmount === 0;
          return (
            <div
              key={inv.id}
              className="p-3 rounded-lg border border-border hover:border-module-billing/50 transition-all"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {inv.invoice_number}
                </span>
                <div className="flex items-center gap-1">
                  {spon && (
                    <Badge variant="info" className="text-[10px]">
                      <Shield className="h-2.5 w-2.5 mr-0.5" />
                      {sponsorLabel(patient)} · {s.copayPct}%
                    </Badge>
                  )}
                  <Badge
                    variant={inv.status === 'partial' ? 'warning' : 'outline'}
                    className="text-[10px]"
                  >
                    {inv.status}
                  </Badge>
                </div>
              </div>
              <p className="font-medium text-sm truncate">
                {patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown patient'}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {patient?.card_number} · Balance{' '}
                <span className={bal < 0 ? 'text-destructive font-semibold' : bal > 0 ? 'text-success font-semibold' : ''}>
                  ₦{bal.toLocaleString()}
                </span>
              </p>
              {spon ? (
                <div className="mt-1.5 grid grid-cols-3 gap-1 text-[10px] rounded-md border border-border/60 bg-muted/40 p-1.5">
                  <div>
                    <div className="text-muted-foreground">Total</div>
                    <div className="font-semibold">₦{Number(inv.total_amount).toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Sponsor</div>
                    <div className="font-semibold text-primary">₦{s.coveredAmount.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Copay ({s.copayPct}%)</div>
                    <div className="font-semibold">₦{s.copayAmount.toLocaleString()}</div>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Total ₦{Number(inv.total_amount).toLocaleString()}
                </p>
              )}
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="text-xs">
                  <span className="text-muted-foreground">
                    {spon ? (rowFull ? 'Copay' : 'Copay due') : 'Owing'}{' '}
                  </span>
                  <span className={`font-bold ${rowFull ? 'text-success' : 'text-destructive'}`}>
                    {rowFull ? '₦0 (full cover)' : `₦${rowOut.toLocaleString()}`}
                  </span>
                </div>
                <Button size="sm" onClick={() => openPayment(inv)} className="h-7">
                  {rowFull ? <Send className="h-3.5 w-3.5 mr-1" /> : <Banknote className="h-3.5 w-3.5 mr-1" />}
                  {rowFull ? 'Acknowledge' : 'Record'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {fullCover ? 'Acknowledge Sponsored Invoice' : 'Record Payment'}
            </DialogTitle>
            <DialogDescription>
              {selected?.invoice_number} ·{' '}
              {sponsored ? (
                <>
                  Copay due{' '}
                  <span className="font-semibold text-destructive">
                    ₦{outstanding.toLocaleString()}
                  </span>{' '}
                  <span className="text-muted-foreground">
                    (of ₦{invoiceTotal.toLocaleString()} total)
                  </span>
                </>
              ) : (
                <>
                  Outstanding{' '}
                  <span className="font-semibold text-destructive">
                    ₦{outstanding.toLocaleString()}
                  </span>
                </>
              )}
              {selectedPatient && (
                <span className="block text-xs mt-1">
                  {selectedPatient.first_name} {selectedPatient.last_name} ·{' '}
                  <span className="capitalize">{selectedPatient.account_type}</span> ·
                  Balance{' '}
                  <span
                    className={
                      patientBalance < 0
                        ? 'text-destructive font-semibold'
                        : patientBalance > 0
                        ? 'text-success font-semibold'
                        : ''
                    }
                  >
                    ₦{patientBalance.toLocaleString()}
                  </span>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {sponsored && (
              <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-primary">
                  <Shield className="h-3.5 w-3.5" />
                  {sponsorLabel(selectedPatient)} · Copay {split.copayPct}%
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Invoice total</span>
                  <span className="font-semibold">₦{invoiceTotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Sponsor covers ({100 - split.copayPct}%)</span>
                  <span className="font-semibold text-primary">₦{split.coveredAmount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between border-t border-primary/20 pt-1">
                  <span className="text-muted-foreground">Patient copay ({split.copayPct}%)</span>
                  <span className="font-bold">₦{split.copayAmount.toLocaleString()}</span>
                </div>
                <p className="pt-1 text-[11px] text-muted-foreground">
                  {fullCover
                    ? 'No cash to collect. Acknowledge to send the invoice to the Claims queue.'
                    : 'Collect only the copay. The sponsor portion is auto-routed to Claims after settle.'}
                </p>
              </div>
            )}

            {/* Use patient balance */}
            {!fullCover && availableBalance > 0 && (
              <div className="rounded-lg border border-success/40 bg-success/5 p-3 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <Checkbox
                    checked={useBalance}
                    onCheckedChange={(v) => setUseBalance(!!v)}
                  />
                  <PiggyBank className="h-4 w-4 text-success" />
                  <span>
                    Deduct from patient balance{' '}
                    <span className="text-muted-foreground">
                      (available ₦{availableBalance.toLocaleString()})
                    </span>
                  </span>
                </label>
                {useBalance && (
                  <div>
                    <Label className="text-xs">Amount from balance (₦)</Label>
                    <Input
                      type="number"
                      value={balanceAmount}
                      onChange={(e) => setBalanceAmount(e.target.value)}
                      max={Math.min(availableBalance, outstanding)}
                    />
                    {balExceedsAvail && (
                      <p className="text-[11px] text-destructive mt-1">
                        Exceeds available balance
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {!fullCover && (
              <div>
                <Label>Cash / POS / Transfer received (₦)</Label>
                <Input
                  type="number"
                  value={cashAmount}
                  onChange={(e) => setCashAmount(e.target.value)}
                  autoFocus
                />
              </div>
            )}

            {!fullCover && cash > 0 && (
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
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Summary */}
            {!fullCover && (
            <div className="rounded-lg bg-muted/40 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{sponsored ? 'Copay due' : 'Outstanding'}</span>
                <span className="font-semibold">₦{outstanding.toLocaleString()}</span>
              </div>
              {bal > 0 && (
                <div className="flex justify-between text-success">
                  <span>From balance</span>
                  <span>− ₦{bal.toLocaleString()}</span>
                </div>
              )}
              {cash > 0 && (
                <div className="flex justify-between">
                  <span className="capitalize text-muted-foreground">{method}</span>
                  <span>− ₦{cash.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between pt-1 border-t border-border">
                <span className="font-semibold">
                  {shortfall > 0
                    ? sponsored
                      ? 'Copay short by'
                      : 'Owed after this payment'
                    : overpay > 0
                    ? 'Overpayment'
                    : 'Settled'}
                </span>
                <span
                  className={`font-bold ${
                    shortfall > 0
                      ? 'text-destructive'
                      : overpay > 0
                      ? 'text-warning'
                      : 'text-success'
                  }`}
                >
                  ₦{(shortfall || overpay).toLocaleString()}
                </span>
              </div>
            </div>
            )}

            {!sponsored && shortfall > 0 && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning mt-0.5" />
                  <div className="text-xs">
                    <p className="font-semibold text-warning-foreground">
                      Partial payment · ₦{applied.toLocaleString()} of ₦{outstanding.toLocaleString()}
                    </p>
                    {debtEligible ? (
                      <p className="text-muted-foreground mt-0.5">
                        The remaining <span className="font-semibold">₦{shortfall.toLocaleString()}</span> will sit
                        on the patient's balance as amount owed. New balance after this: ₦
                        {(patientBalance - bal - shortfall).toLocaleString()}. Any future top-up clears it automatically.
                      </p>
                    ) : (
                      <p className="text-destructive mt-0.5">
                        This account type cannot carry a balance owed — collect the full amount.
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
                    <span>
                      Accept ₦{applied.toLocaleString()} now — record ₦{shortfall.toLocaleString()} as owed on balance
                    </span>
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
              disabled={
                busy ||
                (!fullCover && applied <= 0) ||
                overpay > 0 ||
                balExceedsAvail ||
                (sponsored && !fullCover && shortfall > 0) ||
                (!sponsored && shortfall > 0 && (!debtEligible || !markDebt))
              }
            >
              {busy
                ? 'Recording…'
                : fullCover
                ? 'Acknowledge & Send to Claims'
                : sponsored
                ? 'Collect Copay & Send to Claims'
                : shortfall > 0
                ? `Confirm ₦${applied.toLocaleString()} Partial Payment`
                : 'Confirm Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {receipt && (
        <PrintableReceiptDialog
          open={!!receipt}
          onOpenChange={(o) => !o && setReceipt(null)}
          patient={receipt.patient}
          amount={receipt.amount}
          paymentMethod={receipt.paymentMethod}
          receiptNumber={receipt.receiptNumber}
          date={receipt.date}
          newBalance={receipt.newBalance}
          breakdown={receipt.breakdown}
        />
      )}
    </div>
  );
}
