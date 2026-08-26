import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Wallet, Send, Loader2, RefreshCw, Banknote, CheckSquare } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { PayrollPeriod, PayrollEntry, PaymentProvider, useProviderActions } from '@/hooks/usePayroll';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const READINESS_TIMEOUT_MS = 15000;
const READINESS_CONCURRENCY = 3;
const READINESS_ATTEMPTS = 3;

type ReadinessResult = {
  entryId: string;
  staffName: string;
  bankName: string;
  ok: boolean;
  message: string;
};

function normalizeBankName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = READINESS_TIMEOUT_MS): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function isTransientProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP (429|500|502|503|504)\b/i.test(message) || /Could not reach Flutterwave/i.test(message) || /timed out after/i.test(message);
}

async function resolveAccountWithRetry(resolveAccount: (accountNumber: string, bankCode: string) => Promise<any>, accountNumber: string, bankCode: string, staffName: string) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= READINESS_ATTEMPTS; attempt += 1) {
    try {
      return await withTimeout(resolveAccount(accountNumber, bankCode), `${staffName} account check`);
    } catch (error) {
      lastError = error;
      if (!isTransientProviderError(error) || attempt === READINESS_ATTEMPTS) throw error;
      await new Promise(resolve => setTimeout(resolve, 450 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('account validation failed');
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const runWorker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runWorker()));
  return results;
}

interface Props {
  periods: PayrollPeriod[];
  selectedPeriod: PayrollPeriod | null;
  onSelectPeriod: (p: PayrollPeriod) => void;
  entries: PayrollEntry[];
  onRefreshEntries: () => Promise<void>;
}

export function PayrollPayments({ periods, selectedPeriod, onSelectPeriod, entries, onRefreshEntries }: Props) {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [payingAll, setPayingAll] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [provider, setProvider] = useState<PaymentProvider>('flutterwave');
  const [validatingReadiness, setValidatingReadiness] = useState(false);
  const [readinessSummary, setReadinessSummary] = useState<string | null>(null);
  const [readinessResults, setReadinessResults] = useState<ReadinessResult[]>([]);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());
  const [creatingBatch, setCreatingBatch] = useState(false);
  const [pendingBatchEntries, setPendingBatchEntries] = useState<PayrollEntry[]>([]);
  const { getBalance, listBanks, resolveBank, resolveAccount, initiateTransfer } = useProviderActions(provider);

  const bankEntries = entries.filter(e => e.staff_payment_method === 'bank' && e.staff_bank_name && e.staff_account_number);
  const cashEntries = entries.filter(e => e.staff_payment_method !== 'bank' || !e.staff_account_number);
  const retryableBankEntries = bankEntries.filter(e => e.status === 'pending' || e.status === 'failed');
  const selectedRetryableEntries = retryableBankEntries.filter(entry => selectedEntryIds.has(entry.id));
  const allRetryableSelected = retryableBankEntries.length > 0 && selectedRetryableEntries.length === retryableBankEntries.length;

  const canPay = selectedPeriod?.status === 'locked';

  const fetchBalance = async () => {
    setLoadingBalance(true);
    try {
      setBalanceError(null);
      const data = await getBalance();
      const raw = Array.isArray(data?.balance) ? data.balance[0] : data?.balance;
      const value = typeof raw === 'number'
        ? raw
        : Number(raw?.available_balance ?? raw?.balance ?? data?.available_balance);
      if (!Number.isFinite(value)) throw new Error('Flutterwave returned no readable NGN balance');
      setBalance(value);
    } catch (err) {
      const candidate = err as { message?: unknown; error?: unknown; context?: { body?: unknown } } | null;
      const contextBody = candidate?.context?.body;
      let contextMessage = '';
      if (typeof contextBody === 'string') {
        try {
          const parsed = JSON.parse(contextBody) as { error?: unknown };
          contextMessage = typeof parsed.error === 'string' ? parsed.error : '';
        } catch {
          contextMessage = contextBody;
        }
      }
      const message = err instanceof Error
        ? err.message
        : typeof candidate?.message === 'string'
          ? candidate.message
          : typeof candidate?.error === 'string'
            ? candidate.error
            : contextMessage || 'Could not fetch balance';
      setBalance(null);
      setBalanceError(message);
      toast({ title: 'Flutterwave balance unavailable', description: message, variant: 'destructive' });
    }
    setLoadingBalance(false);
  };

  useEffect(() => { if (canPay) fetchBalance(); }, [canPay, provider]);

  const validatePayrollReadiness = async () => {
    if (!selectedPeriod || bankEntries.length === 0) return;
    setValidatingReadiness(true);
    setReadinessSummary(null);
    setReadinessResults([]);
    try {
      await withTimeout(getBalance(), `${providerLabel} balance check`);
      const bankResponse = await withTimeout(listBanks(), `${providerLabel} bank-list check`);
      const providerBanks = (Array.isArray(bankResponse?.banks) ? bankResponse.banks : []) as Array<Record<string, unknown>>;
      if (providerBanks.length === 0) throw new Error(`${providerLabel} returned no Nigerian banks`);

      const results = await mapWithConcurrency(bankEntries, READINESS_CONCURRENCY, async (entry): Promise<ReadinessResult> => {
        try {
          const requestedName = normalizeBankName(entry.staff_bank_name || '');
          const bank = providerBanks.find(candidate => {
            const candidateName = normalizeBankName(String(candidate.name ?? ''));
            return candidateName === requestedName
              || candidateName.includes(requestedName)
              || requestedName.includes(candidateName);
          });
          const bankCode = String(bank?.code ?? bank?.bank_code ?? bank?.id ?? '').trim();
          if (!bankCode) throw new Error('bank is not in Flutterwave current bank list');
          const accountResult = await resolveAccountWithRetry(
            resolveAccount,
            entry.staff_account_number!,
            bankCode,
            entry.staff_name,
          );
          const accountName = String(accountResult?.account?.account_name ?? '').trim();
          if (!accountName) throw new Error('account could not be resolved');
          return { entryId: entry.id, staffName: entry.staff_name, bankName: entry.staff_bank_name!, ok: true, message: `Resolved as ${accountName}` };
        } catch (error) {
          return { entryId: entry.id, staffName: entry.staff_name, bankName: entry.staff_bank_name!, ok: false, message: error instanceof Error ? error.message : 'validation failed' };
        }
      });
      const ready = results.filter(result => result.ok).length;
      const issues = results.filter(result => !result.ok);
      setReadinessResults(results);
      const summary = issues.length === 0
        ? `${ready} bank account(s) passed readiness checks. No money was transferred.`
        : `${ready} account(s) passed; ${issues.length} need attention. No money was transferred.`;
      setReadinessSummary(summary);
      toast({
        title: issues.length === 0 ? 'Payroll Readiness Passed' : 'Payroll Readiness Needs Attention',
        description: issues.length === 0 ? summary : `${summary} ${issues[0].staffName}: ${issues[0].message}`,
        variant: issues.length === 0 ? 'default' : 'destructive',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Provider readiness check failed';
      setReadinessSummary(message);
      toast({ title: 'Readiness Check Failed', description: message, variant: 'destructive' });
    } finally {
      setValidatingReadiness(false);
    }
  };

  const createPaymentBatch = async (batchEntries: PayrollEntry[]) => {
    if (!selectedPeriod || batchEntries.length === 0) return null;
    const { data: latestRows, error: latestError } = await supabase
      .from('payroll_payment_batches')
      .select('batch_number')
      .eq('payroll_period_id', selectedPeriod.id)
      .eq('provider', provider)
      .order('batch_number', { ascending: false })
      .limit(1);
    if (latestError) throw latestError;
    const latestNumber = Number((latestRows as Array<Record<string, unknown>> | null)?.[0]?.batch_number || 0);
    const batchNumber = latestNumber + 1;
    const { data, error } = await supabase
      .from('payroll_payment_batches')
      .insert({
        payroll_period_id: selectedPeriod.id,
        provider,
        batch_number: batchNumber,
        label: `Payroll batch ${batchNumber}`,
        status: 'processing',
        requested_count: batchEntries.length,
        requested_amount: batchEntries.reduce((sum, entry) => sum + entry.net_pay, 0),
      })
      .select('id,batch_number')
      .single();
    if (error || !data) throw error || new Error('Could not create payroll batch.');
    return { id: String(data.id), batchNumber: Number(data.batch_number || batchNumber) };
  };

  const updatePaymentBatchStatus = async (batchId: string, succeeded: number, failed: number) => {
    const status = succeeded > 0 && failed === 0 ? 'submitted' : succeeded > 0 ? 'partial' : 'failed';
    await supabase.from('payroll_payment_batches').update({ status, updated_at: new Date().toISOString() }).eq('id', batchId);
  };

  const payEntry = async (entry: PayrollEntry, batch?: { id: string; batchNumber: number }): Promise<boolean> => {
    if (!selectedPeriod || !entry.staff_bank_name || !entry.staff_account_number) return false;

    // One stable reference belongs to one payroll entry. A processing/paid attempt
    // must never be submitted again; a failed attempt without a provider transfer
    // code may be safely reused rather than creating a second attempt row.
    const reference = `PAY-${selectedPeriod.id.slice(0, 8)}-${entry.id.slice(0, 8)}`;
    let paymentAttemptId: string | null = null;
    let transferRequestStarted = false;
    setPayingId(entry.id);

    try {
      // Resolve the saved display name against the provider's current bank list.
      // This avoids case-sensitive failures such as "Opay" versus "OPay" and
      // keeps codes current when a provider changes or adds a bank.
      const bankResult = await resolveBank(entry.staff_bank_name);
      const bankCode = String(bankResult?.bank?.code ?? '').trim();
      if (!bankCode) throw new Error(`${entry.staff_bank_name} is not available in ${providerLabel}'s current bank list`);

      const { data: previousAttempts, error: previousAttemptError } = await supabase
        .from('payroll_payments')
        .select('id,status,provider_transfer_code,provider_reference')
        .eq('payroll_entry_id', entry.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (previousAttemptError) throw previousAttemptError;
      const previous = ((previousAttempts || []) as Array<Record<string, unknown>>)[0];
      const previousStatus = String(previous?.status || '').toLowerCase();
      if (previous && ['processing', 'paid', 'success'].includes(previousStatus)) {
        throw new Error(`A ${previousStatus} payment attempt already exists for this payroll entry; wait for provider confirmation before retrying.`);
      }
      if (previous?.provider_transfer_code) {
        throw new Error('A provider transfer reference already exists for this payroll entry; confirmation is required before retrying.');
      }

      if (previous?.id && previousStatus === 'failed') {
        const { error: retryError } = await supabase
          .from('payroll_payments')
          .update({ status: 'processing', amount: entry.net_pay, provider, failure_reason: null, provider_reference: reference, batch_id: batch?.id || null, batch_number: batch?.batchNumber || null })
          .eq('id', previous.id);
        if (retryError) throw retryError;
        paymentAttemptId = String(previous.id);
      } else {
        // Record the attempt before contacting the provider. This prevents an
        // accepted transfer from becoming invisible if a later local write fails.
        const { data: paymentAttempt, error: attemptError } = await supabase
          .from('payroll_payments')
          .insert({
            payroll_period_id: selectedPeriod.id,
            payroll_entry_id: entry.id,
            staff_id: entry.staff_id,
            amount: entry.net_pay,
            status: 'processing',
            provider_reference: reference,
            provider,
            batch_id: batch?.id || null,
            batch_number: batch?.batchNumber || null,
          })
          .select('id')
          .single();
        if (attemptError || !paymentAttempt) throw attemptError || new Error('Could not record the payroll payment attempt.');
        paymentAttemptId = paymentAttempt.id;
      }

      const { error: processingError } = await supabase
        .from('payroll_entries')
        .update({ status: 'processing', payment_reference: reference })
        .eq('id', entry.id);
      if (processingError) throw processingError;

      const accountResult = await resolveAccount(entry.staff_account_number, bankCode);
      const beneficiaryName = accountResult?.account?.account_name || entry.staff_name || 'Staff';
      // From this point onward, a timeout or client-side failure could mean the
      // provider accepted the transfer. Never mark it retryable automatically.
      transferRequestStarted = true;
      const transferRes = await initiateTransfer({
        amount: entry.net_pay,
        account_bank: bankCode,
        account_number: entry.staff_account_number,
        beneficiary_name: beneficiaryName,
        narration: `Salary - ${entry.staff_name}`,
        reference,
      });

      const transferId = transferRes.transfer?.id?.toString() || transferRes.transfer?.transfer_code || '';
      const recipientCode = transferRes.transfer?.recipient_code || null;
      if (!transferId) throw new Error('The provider did not return a usable transfer reference.');

      const { error: transferUpdateError } = await supabase
        .from('payroll_payments')
        .update({ provider_transfer_code: transferId, provider_recipient_code: recipientCode, failure_reason: null })
        .eq('id', paymentAttemptId);
      if (transferUpdateError) throw transferUpdateError;

      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Transfer failed';
      if (paymentAttemptId) {
        const safeStatus = transferRequestStarted ? 'processing' : 'failed';
        const safeReason = transferRequestStarted
          ? `Transfer submission completed without a confirmed provider response. Do not retry until the provider status is verified. ${errorMsg}`
          : errorMsg;
        await supabase
          .from('payroll_payments')
          .update({ status: safeStatus, failure_reason: safeReason })
          .eq('id', paymentAttemptId);
      }
      await supabase.from('payroll_entries').update({ status: transferRequestStarted ? 'processing' : 'failed' }).eq('id', entry.id);

      let title = transferRequestStarted ? 'Transfer Status Requires Confirmation' : 'Payment Rejected';
      let description = transferRequestStarted
        ? `${entry.staff_name}: the transfer request reached the provider boundary, but no confirmed response was received. Do not retry until its provider status is checked.`
        : `${entry.staff_name}: ${errorMsg}`;
      const normalizedError = errorMsg.toLowerCase();
      if (normalizedError.includes('third party payouts')) {
        title = 'Transfers Not Enabled';
        description = `${providerLabel} has not enabled third-party payouts on this account. Activate transfers before retrying.`;
      } else if (normalizedError.includes('insufficient') || normalizedError.includes('insufficient_balance')) {
        title = 'Insufficient Balance';
        description = `Your ${providerLabel} balance is too low to pay ${entry.staff_name} (₦${entry.net_pay.toLocaleString()}). Fund the wallet and retry.`;
      } else if (normalizedError.includes('not configured') || normalizedError.includes('secret_key')) {
        title = 'Provider Not Configured';
        description = `${providerLabel} API credentials are missing or invalid.`;
      } else if (normalizedError.includes('bank code') || normalizedError.includes('current bank list') || normalizedError.includes('not available')) {
        title = 'Bank Not Supported';
        description = `${entry.staff_bank_name} is not available in ${providerLabel}'s current bank list. Refresh the bank details and retry.`;
      } else if (normalizedError.includes('recipient') || normalizedError.includes('account') || normalizedError.includes('beneficiary')) {
        title = 'Invalid Bank Details';
        description = `Could not process payment for ${entry.staff_name}. Verify the bank and account number, then retry.`;
      } else if (normalizedError.includes('ip') || normalizedError.includes('whitelist')) {
        title = 'Access Restricted';
        description = `${providerLabel} is blocking requests from this server. Contact ${providerLabel} support to remove the restriction.`;
      }

      toast({ title, description, variant: 'destructive' });
      return false;
    } finally {
      setPayingId(null);
    }
  };

  const handlePaySingle = async (entry: PayrollEntry) => {
    const ok = await payEntry(entry);
    await onRefreshEntries();
    fetchBalance();
    if (ok) {
      toast({
        title: 'Transfer Submitted for Confirmation',
        description: `₦${entry.net_pay.toLocaleString()} for ${entry.staff_name} is processing with ${providerLabel}. It will show Paid only after provider confirmation.`,
      });
    }
  };

  const payEntriesAsBatch = async (batchEntries: PayrollEntry[]) => {
    if (batchEntries.length === 0) return;
    setShowConfirm(false);
    setPayingAll(true);
    setCreatingBatch(true);
    let succeeded = 0;
    let failed = 0;
    let batch: { id: string; batchNumber: number } | null = null;
    try {
      batch = await createPaymentBatch(batchEntries);
      for (const entry of batchEntries) {
        const ok = await payEntry(entry, batch || undefined);
        if (ok) succeeded++;
        else failed++;
      }
      if (batch) await updatePaymentBatchStatus(batch.id, succeeded, failed);
    } catch (error) {
      toast({ title: 'Batch Processing Failed', description: error instanceof Error ? error.message : 'Could not process this payroll batch.', variant: 'destructive' });
    }

    await onRefreshEntries();
    void fetchBalance();
    setSelectedEntryIds(new Set());
    setCreatingBatch(false);
    setPayingAll(false);

    if (failed === 0 && succeeded > 0) {
      toast({ title: 'Batch Submitted for Confirmation', description: `${succeeded} transfer(s) are processing with ${providerLabel}. They will show Paid only after provider confirmation.` });
    } else if (succeeded > 0 && failed > 0) {
      toast({ title: 'Batch Partially Submitted', description: `${succeeded} submitted for confirmation; ${failed} rejected. Correct the rejected entries and retry only those entries.`, variant: 'destructive' });
    }
  };

  const openBatchConfirmation = (batchEntries: PayrollEntry[]) => {
    if (batchEntries.length === 0) return;
    setPendingBatchEntries(batchEntries);
    setShowConfirm(true);
  };

  const toggleEntrySelection = (entryId: string, checked: boolean) => {
    setSelectedEntryIds(previous => {
      const next = new Set(previous);
      if (checked) next.add(entryId);
      else next.delete(entryId);
      return next;
    });
  };

  const toggleAllSelection = (checked: boolean) => {
    setSelectedEntryIds(checked ? new Set(retryableBankEntries.map(entry => entry.id)) : new Set());
  };

  /* legacy per-entry loop removed; batch processing preserves the same idempotent payEntry path */
  /*
    for (const entry of retryableBankEntries) {
      const ok = await payEntry(entry);
      if (ok) {
        succeeded++;
      } else {
        failed++;
        errors.push(entry.staff_name || 'Unknown');
      }
    }
  */

  const totalRetryableAmount = retryableBankEntries.reduce((sum, e) => sum + e.net_pay, 0);
  const totalAmountToPay = entries.reduce((sum, entry) => sum + entry.net_pay, 0);
  const selectedBatchAmount = selectedRetryableEntries.reduce((sum, entry) => sum + entry.net_pay, 0);
  const providerLabel = provider === 'paystack' ? 'Paystack' : 'Flutterwave';

  return (
    <div className="space-y-4">
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Payroll Batch</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to initiate <strong>{(pendingBatchEntries.length || retryableBankEntries.length)}</strong> bank transfer(s)
              totaling <strong>₦{(pendingBatchEntries.length ? pendingBatchEntries : retryableBankEntries).reduce((sum, entry) => sum + entry.net_pay, 0).toLocaleString()}</strong> via <strong>{providerLabel}</strong>.
              This action will debit your {providerLabel} balance. Are you sure you want to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void payEntriesAsBatch(pendingBatchEntries.length ? pendingBatchEntries : retryableBankEntries)}>Yes, Process Batch</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <Select
          value={selectedPeriod?.id || ''}
          onValueChange={v => {
            const p = periods.find(pp => pp.id === v);
            if (p) onSelectPeriod(p);
          }}
        >
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent>
            {periods.filter(p => p.status !== 'draft').map(p => (
              <SelectItem key={p.id} value={p.id}>
                {MONTHS[p.month - 1]} {p.year} ({p.status})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedPeriod && (
          <Badge variant={selectedPeriod.status === 'locked' ? 'warning' : 'success'}>
            {selectedPeriod.status.toUpperCase()}
          </Badge>
        )}
      </div>

      {canPay && (
        <>
          {/* Provider Selector */}
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-sm font-medium mb-3">Payment Provider</p>
            <RadioGroup
              value={provider}
              onValueChange={(v) => setProvider(v as PaymentProvider)}
              className="flex gap-6"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="flutterwave" id="flw" />
                <Label htmlFor="flw" className="cursor-pointer">Flutterwave</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="paystack" id="ps" />
                <Label htmlFor="ps" className="cursor-pointer">Paystack</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm text-muted-foreground">{providerLabel} Balance</p>
                <Button variant="ghost" size="icon" onClick={fetchBalance} disabled={loadingBalance}>
                  <RefreshCw className={`h-4 w-4 ${loadingBalance ? 'animate-spin' : ''}`} />
                </Button>
              </div>
              <p className="text-2xl font-bold">{balance !== null ? `₦${balance.toLocaleString()}` : '—'}</p>
              {balanceError && <p className="text-xs text-destructive mt-1">{balanceError}</p>}
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-sm text-muted-foreground">Bank Transfers</p>
              <p className="text-2xl font-bold">{bankEntries.length}</p>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-sm text-muted-foreground">Cash Schedule</p>
              <p className="text-2xl font-bold">{cashEntries.length}</p>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-sm text-muted-foreground">Total Amount to Pay</p>
              <p className="text-2xl font-bold">₦{totalAmountToPay.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-1">Bank + cash net pay</p>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-sm text-muted-foreground">Selected Batch Total</p>
              <p className="text-2xl font-bold">₦{selectedBatchAmount.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-1">{selectedRetryableEntries.length} bank staff selected</p>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-sm text-muted-foreground">Confirmed Paid</p>
              <p className="text-2xl font-bold text-success">
                {entries.filter(e => e.status === 'paid').length}
              </p>
            </div>
          </div>
        </>
      )}

      {canPay && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold flex items-center gap-2">
                <Wallet className="h-5 w-5" /> Bank Transfers
              </h3>
              <p className="text-xs text-muted-foreground mt-1">Processing means submitted to the provider. Only Paid is a confirmed settlement; Failed can be corrected and retried.</p>
            </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={validatePayrollReadiness}
                  disabled={validatingReadiness || payingAll || bankEntries.length === 0}
                >
                  {validatingReadiness ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  {validatingReadiness ? 'Checking…' : 'Validate Only'}
                </Button>
                  <Button
                  onClick={() => openBatchConfirmation(retryableBankEntries)}
                  disabled={payingAll || retryableBankEntries.length === 0 || selectedRetryableEntries.length > 0}
                >
                  {payingAll ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                  Pay All ({retryableBankEntries.length})
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => openBatchConfirmation(selectedRetryableEntries)}
                  disabled={payingAll || creatingBatch || selectedRetryableEntries.length === 0}
                >
                  {creatingBatch ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckSquare className="h-4 w-4 mr-2" />}
                  Pay Selected Batch ({selectedRetryableEntries.length})
                </Button>
              </div>
            </div>
            {readinessSummary && <p className="text-xs text-muted-foreground mt-2">{readinessSummary}</p>}
            {readinessResults.length > 0 && (
              <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-border bg-muted/20 p-2 text-xs">
                {readinessResults.map(result => (
                  <div key={result.entryId} className="flex items-start justify-between gap-3 py-1">
                    <span className={result.ok ? 'text-success' : 'text-destructive'}>{result.ok ? 'Passed' : 'Needs attention'}</span>
                    <span className="min-w-0 flex-1">{result.staffName} · {result.bankName}</span>
                    <span className="max-w-[45%] text-right text-muted-foreground">{result.message}</span>
                  </div>
                ))}
              </div>
            )}

          <div className="border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                    <TableRow>
                    <TableHead className="w-10">
                      <Checkbox checked={allRetryableSelected} onCheckedChange={value => toggleAllSelection(value === true)} aria-label="Select all payable staff" />
                    </TableHead>
                    <TableHead>Staff ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Bank</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Net Pay</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-20">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bankEntries.map(entry => (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <Checkbox checked={selectedEntryIds.has(entry.id)} onCheckedChange={value => toggleEntrySelection(entry.id, value === true)} disabled={!['pending', 'failed'].includes(entry.status) || payingAll} aria-label={`Select ${entry.staff_name || 'staff member'}`} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{entry.staff_employee_id}</TableCell>
                      <TableCell className="font-medium">{entry.staff_name}</TableCell>
                      <TableCell className="text-sm">{entry.staff_bank_name}</TableCell>
                      <TableCell className="font-mono text-xs">{entry.staff_account_number}</TableCell>
                      <TableCell className="font-bold">₦{entry.net_pay.toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant={
                          entry.status === 'paid' ? 'success' :
                          entry.status === 'processing' ? 'warning' :
                          entry.status === 'failed' ? 'destructive' : 'outline'
                        }>{entry.status === 'processing' ? 'processing confirmation' : entry.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!['pending', 'failed'].includes(entry.status) || payingId === entry.id || payingAll}
                          onClick={() => handlePaySingle(entry)}
                        >
                          {payingId === entry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Pay'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {bankEntries.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">No bank transfer entries</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {cashEntries.length > 0 && (
            <>
              <h3 className="font-semibold flex items-center gap-2 mt-6">
                <Banknote className="h-5 w-5" /> Cash Payment Schedule
              </h3>
              <div className="border border-border rounded-xl overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>S/N</TableHead>
                      <TableHead>Staff ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Net Pay</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cashEntries.map((entry, idx) => (
                      <TableRow key={entry.id}>
                        <TableCell>{idx + 1}</TableCell>
                        <TableCell className="font-mono text-xs">{entry.staff_employee_id}</TableCell>
                        <TableCell className="font-medium">{entry.staff_name}</TableCell>
                        <TableCell className="font-bold">₦{entry.net_pay.toLocaleString()}</TableCell>
                        <TableCell><Badge variant="outline">Cash</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </>
      )}

      {!canPay && selectedPeriod && (
        <div className="text-center py-12 text-muted-foreground">
          {selectedPeriod.status === 'draft'
            ? 'Lock the payroll period first before processing payments.'
            : `This period is closed. Confirmed paid: ${entries.filter(e => e.status === 'paid').length}; still processing or requiring attention: ${entries.filter(e => ['pending', 'processing', 'failed', 'reversed'].includes(e.status)).length}.`}
        </div>
      )}

      {!selectedPeriod && (
        <div className="text-center py-12 text-muted-foreground">Select a locked/paid period to view payments.</div>
      )}
    </div>
  );
}
