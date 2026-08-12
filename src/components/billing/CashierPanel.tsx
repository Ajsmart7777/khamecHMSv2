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
import { copayPercent, hasWallet, isSponsored, sponsorLabel, splitInvoice } from '@/lib/copay';
import { PrintableReceiptDialog } from '@/components/receipts/PrintableReceiptDialog';
import { nextStationForInvoice, workflowStationLabel } from '@/lib/workflowRouting';

// Wallet-enabled accounts (walk-in cash + staff_family) can carry a shortfall
// on their own balance. Sponsored/insured/staff settle via the sponsor.
const DEBT_ELIGIBLE = new Set(['normal', 'cash', '', 'staff_family']);

async function settleInvoiceAsPaid(
  invoiceId: string,
  paidAmount: number,
  paymentMethod: string,
  notes?: string,
) {
  // Sponsor full-cover path: no wallet/debt changes, just close the invoice.
  const updatePayload: Record<string, any> = {
    paid_amount: paidAmount,
    status: 'paid',
    payment_method: paymentMethod,
    paid_at: new Date().toISOString(),
  };
  if (notes) updatePayload.notes = notes;

  const { error } = await supabase
    .from('invoices')
    .update(updatePayload)
    .eq('id', invoiceId);

  if (error) throw new Error(`Failed to settle invoice: ${error.message}`);
}

async function settleInvoiceAtomic(params: {
  invoiceId: string;
  cashAmount: number;
  balanceAmount: number;
  debtAmount: number;
  paymentMethod: string;
  notes?: string;
  sponsored: boolean;
  isSalaryDeduction?: boolean;
}) {
  const { data, error } = await supabase.rpc('settle_invoice_atomic', {
    _invoice_id: params.invoiceId,
    _cash_amount: params.cashAmount,
    _balance_amount: params.balanceAmount,
    _debt_amount: params.debtAmount,
    _payment_method: params.paymentMethod,
    _notes: params.notes ?? null,
    _sponsored: params.sponsored,
    _is_salary_deduction: params.isSalaryDeduction ?? false,
  });
  if (error) throw new Error(`Failed to settle invoice: ${error.message}`);
  return data as any;
}

export function CashierPanel() {
  const { getPendingInvoices, refreshInvoices, invoices } = useInvoices();
  const { patients, updatePatientStatus, refreshPatients, updatePatient } = usePatients() as any;

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'copay' | 'covered'>('all');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [cashAmount, setCashAmount] = useState('');
  const [method, setMethod] = useState<string>('cash');
  const [useBalance, setUseBalance] = useState(false);
  const [balanceAmount, setBalanceAmount] = useState('');
  const [isSalaryDeduction, setIsSalaryDeduction] = useState(false);
  const [salaryDeductionAmount, setSalaryDeductionAmount] = useState('');
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
      owedAfter?: number;
    };
  } | null>(null);

  const pending = getPendingInvoices();
  const [refundItem, setRefundItem] = useState<{ item: any; invoice: Invoice } | null>(null);

  const unavailableItems = useMemo(() => {
    // Automatically identify unavailable medication items for exclusion from sponsor totals
    // ensuring only eligible amounts are reclaimed or credited
    const allItems = invoices.flatMap(inv => (inv.items || []).map(it => ({ ...it, invoice: inv })));
    return allItems.filter(it => it.dispensing_status === 'unavailable' || it.dispensing_status === 'refund_requested');
  }, [invoices]);

  const handleRefund = async (method: 'balance' | 'cash') => {
    if (!refundItem) return;
    setBusy(true);
    try {
      // Safeguard: verify the item is not already refunded
      const { data: item } = await supabase.from('invoice_items').select('dispensing_status').eq('id', refundItem.item.id).single();
      if (item?.dispensing_status === 'refunded') {
        toast.error('Item has already been refunded');
        setRefundItem(null);
        return;
      }

      const { data, error } = await supabase.rpc('refund_invoice_item', {
        _item_id: refundItem.item.id,
        _payment_method: method
      });

      if (error) throw error;
      
      const res = data as any;
      if (res.new_balance !== undefined && typeof updatePatient === 'function') {
        updatePatient(refundItem.invoice.patient_id, { balance: res.new_balance });
      }

      await refreshInvoices();
      toast.success(res.is_sponsored ? 'Item voided from claim' : `Refunded ₦${res.amount.toLocaleString()} to ${method}`);
      setRefundItem(null);
    } catch (err: any) {
      toast.error('Refund failed: ' + err.message);
    } finally {
      setBusy(false);
    }
  };



  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pending
      .map((inv) => {
        const patient = patients.find((p: any) => p.id === inv.patient_id);
        const spon = patient ? isSponsored(patient) : false;
        const fullyCovered = spon && splitInvoice(Number(inv.total_amount), patient).copayAmount === 0;
        return { inv, patient, fullyCovered };
      })
      .filter(({ fullyCovered }) => {
        if (filter === 'copay') return !fullyCovered;
        if (filter === 'covered') return fullyCovered;
        return true;
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
  }, [pending, patients, query, filter]);

  // Every pending invoice a sponsor covers 100% (HMO, corporate, retainer,
  // staff, KATCHMA basic…) — the patient pays nothing at the cashier.
  const coveredRows = useMemo(
    () =>
      pending
        .map((inv) => ({ inv, patient: patients.find((p: any) => p.id === inv.patient_id) }))
        .filter(
          ({ inv, patient }) =>
            patient &&
            isSponsored(patient) &&
            splitInvoice(Number(inv.total_amount), patient).copayAmount === 0,
        ),
    [pending, patients],
  );

  /** Acknowledge every fully covered invoice in one pass — no money changes hands. */
  const clearFullyCovered = async () => {
    if (coveredRows.length === 0) return;
    setBulkBusy(true);
    let done = 0;
    try {
      for (const { inv, patient } of coveredRows) {
        try {
          await settleInvoiceAsPaid(
            inv.id,
            Number(inv.paid_amount),
            'sponsor_claim',
            `Sponsor fully covered · ${sponsorLabel(patient)}`,
          );
          await paymentAuditLogger('payment_received', inv.invoice_number, {
            patient_id: inv.patient_id,
            patient_name: `${patient.first_name} ${patient.last_name ?? ''}`.trim(),
            action: 'sponsor_fully_covered_bulk',
            sponsor: sponsorLabel(patient),
            covered_amount: Number(inv.total_amount) - Number(inv.paid_amount),
            copay_amount: 0,
          });
          const nextStation = await nextStationForInvoice(inv.id, inv.patient_id);
          await updatePatientStatus(inv.patient_id, nextStation);
          done += 1;
        } catch (e) {
          // keep going — one bad invoice must not block the rest
        }
      }
      await refreshInvoices();
      await refreshPatients?.();
      toast.success(`${done} fully covered invoice${done === 1 ? '' : 's'} sent to Claims`);
    } finally {
      setBulkBusy(false);
    }
  };

  const selectedPatient = selected
    ? patients.find((p: any) => p.id === selected.patient_id)
    : null;
  // Wallet only exists for cash patients — sponsored/insured never touch it.
  const walletEligible = selectedPatient ? hasWallet(selectedPatient) : false;
  const patientBalance = walletEligible ? Number(selectedPatient?.balance ?? 0) : 0;
  const availableBalance = Math.max(patientBalance, 0);
  const debtEligible =
    !!selectedPatient && walletEligible &&
    DEBT_ELIGIBLE.has(String(selectedPatient.account_type ?? '').toLowerCase());
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
  const salDed = isSalaryDeduction ? Math.max(Number(salaryDeductionAmount) || 0, 0) : 0;
  const applied = cash + bal + salDed;
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
    setIsSalaryDeduction(false);
    setSalaryDeductionAmount('');
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
        await settleInvoiceAsPaid(
          selected.id,
          alreadyPaid, // nothing new collected from patient — sponsor fully covers
          'sponsor_claim',
          `Sponsor fully covered · ${sponsorLabel(selectedPatient)}`,
        );
        await refreshInvoices();
        await paymentAuditLogger('payment_received', selected.invoice_number, {
          patient_id: selected.patient_id,
          patient_name: `${selectedPatient.first_name} ${selectedPatient.last_name}`,
          action: 'sponsor_fully_covered',
          sponsor: sponsorLabel(selectedPatient),
          covered_amount: remaining,
          copay_amount: 0,
        });
        const nextStation = await nextStationForInvoice(selected.id, selected.patient_id);
        await updatePatientStatus(selected.patient_id, nextStation);
        toast.success('Acknowledged — sent to Claims', {
          description: `${selected.invoice_number} · Sponsor covers ₦${remaining.toLocaleString()} · ${
            `Patient routed to ${workflowStationLabel(nextStation)}`
          }`,
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

    if (applied < 0) {
      toast.error('Invalid amount entered');
      return;
    }
    if (overpay > 0 && sponsored) {
      // Overpayment is credited to wallet for cash patients, 
      // but for sponsored patients we only ever collect up to the copay.
      toast.error('Total exceeds patient copay');
      return;
    }
    if (bal > 0 && balExceedsAvail) {
      toast.error(`Only ₦${availableBalance.toLocaleString()} available on balance`);
      return;
    }
    if (!sponsored && shortfall > 0 && !debtEligible) {
      toast.error('This account type must be paid in full');
      return;
    }
    if (sponsored && shortfall > 0) {
      toast.error(`Collect the full copay of ₦${split.copayAmount.toLocaleString()} before sending to Claims`);
      return;
    }

    if (busy) return;
    setBusy(true);
    try {
      // Wallet deduction, debt recording, and invoice close all run in a single
      // server-side transaction — no partial states if any step fails.
      const paymentMethod = applied === 0
        ? 'credit'
        : salDed > 0 && cash === 0 && bal === 0
        ? 'salary_deduction'
        : sponsored
        ? 'sponsor_claim'
        : bal > 0 && cash === 0
        ? 'balance'
        : method;
      const notes = salDed > 0
        ? `Salary deduction of ₦${salDed.toLocaleString()} recorded · ${sponsorLabel(selectedPatient)}`
        : sponsored
        ? `Copay collected; sponsor claim routed to Claims · ${sponsorLabel(selectedPatient)}`
        : shortfall > 0
          ? (applied === 0 
              ? `Patient bought on credit (₦${shortfall.toLocaleString()} added to debt)`
              : `Short payment — ₦${shortfall.toLocaleString()} moved to patient debt`)
          : undefined;
      const debt = !sponsored && shortfall > 0 ? shortfall : 0;
      const result = await settleInvoiceAtomic({
        invoiceId: selected.id,
        cashAmount: cash,
        balanceAmount: bal,
        debtAmount: debt,
        paymentMethod,
        notes,
        sponsored,
        isSalaryDeduction: salDed > 0,
      });

      // Update patient balance in context immediately for instant UI feedback
      if (result?.new_wallet_balance !== undefined && typeof updatePatient === 'function') {
        updatePatient(selected.patient_id, { balance: result.new_wallet_balance });
      }

      await refreshInvoices();

      await paymentAuditLogger('payment_received', selected.invoice_number, {
        patient_id: selected.patient_id,
        patient_name: `${selectedPatient.first_name} ${selectedPatient.last_name}`,
        action: salDed > 0
          ? 'salary_deduction_recorded'
          : sponsored
          ? 'copay_recorded_sponsor_billed'
          : shortfall > 0
          ? 'payment_recorded_with_debt'
          : 'payment_recorded',
        sponsor: (sponsored || isSalaryDeduction) ? sponsorLabel(selectedPatient) : null,
        cash_amount: cash,
        balance_amount: bal,
        is_salary_deduction: salDed > 0,
        salary_deduction_amount: salDed,
        copay_amount: sponsored ? (salDed + cash + bal) : undefined,
        covered_amount: sponsored ? Math.max(invoiceTotal - split.copayAmount, 0) : undefined,
        method,
        shortfall: sponsored ? 0 : shortfall,
      });

      // Route the patient to the correct next station based on what was billed
      // (lab tests → back to Lab; meds/other → Pharmacy).
      // If it's a custom bill (no linked snaps), nextStation will be null, and we do NOT update status.
      const nextStation = await nextStationForInvoice(selected.id, selected.patient_id);
      if (nextStation) {
        await updatePatientStatus(selected.patient_id, nextStation);
      }

      const parts: string[] = [];
      if (cash > 0) parts.push(`₦${cash.toLocaleString()} ${method}`);
      if (bal > 0) parts.push(`₦${bal.toLocaleString()} balance`);
      if (salDed > 0) parts.push(`₦${salDed.toLocaleString()} salary deduction`);
      if (!sponsored && shortfall > 0) parts.push(`₦${shortfall.toLocaleString()} owed on balance`);
      if (!sponsored && overpay > 0) parts.push(`₦${overpay.toLocaleString()} credited to wallet`);
      if (sponsored) parts.push(`sponsor ₦${(invoiceTotal - split.copayAmount).toLocaleString()} → Claims`);

      const successMessage = salDed > 0 && cash === 0 && bal === 0
        ? 'Salary deduction recorded'
        : sponsored
        ? 'Copay collected — sent to Claims'
        : overpay > 0 
        ? 'Payment recorded with change to wallet' 
        : shortfall > 0 
        ? (applied === 0 ? 'Recorded as debt (Credit)' : 'Partial payment recorded')
        : 'Payment recorded';

      toast.success(successMessage,
        { description: `${selected.invoice_number} · ${parts.join(' + ')} · routed to ${workflowStationLabel(nextStation)}` }
      );

      // Open printable receipt with a clean breakdown.
      setReceipt({
        patient: selectedPatient,
        amount: cash + bal,
        paymentMethod: applied === 0 ? 'credit' : (salDed > 0 && cash === 0 && bal === 0 ? 'salary_deduction' : (bal > 0 && cash === 0 ? 'balance' : method)),
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
          owedAfter: !sponsored && shortfall > 0 ? shortfall : 0,
        },
      });

      setSelected(null);
      setCashAmount('');
      setBalanceAmount('');
      setUseBalance(false);
      setSalaryDeductionAmount('');
      setIsSalaryDeduction(false);
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

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {([
          { k: 'all', label: `All (${pending.length})` },
          { k: 'copay', label: `Copay due (${pending.length - coveredRows.length})` },
          { k: 'covered', label: `Fully covered (${coveredRows.length})` },
        ] as const).map(({ k, label }) => (
          <Button
            key={k}
            size="sm"
            variant={filter === k ? 'default' : 'outline'}
            className="h-7 text-xs"
            onClick={() => setFilter(k)}
          >
            {label}
          </Button>
        ))}
        {coveredRows.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            className="h-7 text-xs ml-auto"
            disabled={bulkBusy}
            onClick={clearFullyCovered}
          >
            <Send className="h-3.5 w-3.5 mr-1" />
            {bulkBusy ? 'Clearing…' : 'Clear fully covered'}
          </Button>
        )}
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
                {patient?.card_number}
                {patient && hasWallet(patient) && (
                  <>
                    {' · Balance '}
                    <span className={bal < 0 ? 'text-destructive font-semibold' : bal > 0 ? 'text-success font-semibold' : ''}>
                      ₦{bal.toLocaleString()}
                    </span>
                  </>
                )}
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
              {selectedPatient && walletEligible && (
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
              {selectedPatient && !walletEligible && (
                <span className="block text-xs mt-1">
                  {selectedPatient.first_name} {selectedPatient.last_name} ·{' '}
                  <span className="capitalize">{selectedPatient.account_type?.replace('_',' ')}</span>
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

            {/* Use patient balance — cash patients only */}
            {!fullCover && walletEligible && availableBalance > 0 && (
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

            {selectedPatient?.account_type === 'staff_family' && (
              <div className="flex items-start justify-between p-3 rounded-lg border border-warning/30 bg-warning/5">
                <div className="space-y-2 w-full">
                  <div className="flex items-start justify-between">
                    <div className="pr-3">
                      <Label className="text-sm font-medium">Deduct from sponsor's salary</Label>
                      <p className="text-[10px] text-muted-foreground">
                        Record a portion or the full remaining 50% (₦{outstanding.toLocaleString()}) to be deducted from the sponsor's salary.
                      </p>
                    </div>
                    <Checkbox
                      checked={isSalaryDeduction}
                      onCheckedChange={(v) => {
                        setIsSalaryDeduction(!!v);
                        if (v) {
                          setSalaryDeductionAmount(String(outstanding));
                          setCashAmount('0');
                          setUseBalance(false);
                          setBalanceAmount('0');
                        } else {
                          setSalaryDeductionAmount('');
                          setCashAmount(String(outstanding));
                        }
                      }}
                    />
                  </div>
                  {isSalaryDeduction && (
                    <div className="pt-1">
                      <Label className="text-xs">Deduction amount (₦)</Label>
                      <Input
                        type="number"
                        value={salaryDeductionAmount}
                        onChange={(e) => setSalaryDeductionAmount(e.target.value)}
                        max={outstanding}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Summary */}
            {!fullCover && (
            <div className="rounded-lg bg-muted/40 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{sponsored ? 'Copay due' : 'Outstanding'}</span>
                <span className="font-semibold">₦{outstanding.toLocaleString()}</span>
              </div>
              {salDed > 0 ? (
                <div className="flex justify-between text-warning">
                  <span>Salary Deduction</span>
                  <span>− ₦{salDed.toLocaleString()}</span>
                </div>
              ) : null}
              {!isSalaryDeduction || (salDed < outstanding) ? (
                <>
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
                </>
              ) : null}
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
                  <p className="text-[11px] text-muted-foreground italic">
                    Confirm to accept ₦{applied.toLocaleString()} now and record ₦
                    {shortfall.toLocaleString()} as owed on the patient's balance.
                  </p>
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
                (!fullCover && applied < 0) ||
                (sponsored && overpay > 0) ||
                balExceedsAvail ||
                (sponsored && !fullCover && shortfall > 0) ||
                (!sponsored && shortfall > 0 && !debtEligible)
              }
            >
              {busy
                ? 'Recording…'
                : fullCover
                ? 'Acknowledge & Send to Claims'
                : salDed > 0 && salDed === outstanding
                ? 'Confirm Salary Deduction'
                : salDed > 0
                ? 'Confirm Mixed Payment'
                : sponsored
                ? 'Collect Copay & Send to Claims'
                : shortfall > 0
                ? applied === 0 
                  ? 'Confirm ₦0 (Buy on Credit)'
                  : `Confirm ₦${applied.toLocaleString()} Partial Payment`
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
      {refundItem && (
        <Dialog open onOpenChange={(o) => !o && setRefundItem(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Process Refund</DialogTitle>
              <DialogDescription>
                Refund ₦{(Number(refundItem.item.total) || 0).toLocaleString()} for "{refundItem.item.description}" 
                to {patients.find((p: any) => p.id === refundItem.invoice.patient_id)?.first_name}.
              </DialogDescription>
            </DialogHeader>
            <div className="p-4 bg-muted rounded-lg text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Original Invoice:</span>
                <span className="font-mono font-medium">{refundItem.invoice.invoice_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Unavailable Reason:</span>
                <span className="italic text-red-600">{refundItem.item.dispensing_notes || 'Not specified'}</span>
              </div>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="ghost" className="w-full sm:w-auto" onClick={() => setRefundItem(null)} disabled={busy}>Cancel</Button>
              {isSponsored(patients.find((p: any) => p.id === refundItem.invoice.patient_id) || {}) ? (
                <Button variant="destructive" className="w-full sm:flex-1" onClick={() => handleRefund('cash')} disabled={busy}>
                  {busy ? 'Processing...' : 'Void from Claim'}
                </Button>
              ) : (
                <>
                  <Button variant="outline" className="w-full sm:w-auto" onClick={() => handleRefund('cash')} disabled={busy}>
                    Refund as Cash
                  </Button>
                  <Button className="w-full sm:flex-1" onClick={() => handleRefund('balance')} disabled={busy}>
                    {busy ? 'Processing...' : 'Add to Wallet Balance'}
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

