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
import { Wallet, Send, Loader2, RefreshCw, Banknote } from 'lucide-react';
import { PayrollPeriod, PayrollEntry, PaymentProvider, useProviderActions } from '@/hooks/usePayroll';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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
  const { getBalance, resolveBank, resolveAccount, initiateTransfer } = useProviderActions(provider);

  const bankEntries = entries.filter(e => e.staff_payment_method === 'bank' && e.staff_bank_name && e.staff_account_number);
  const cashEntries = entries.filter(e => e.staff_payment_method !== 'bank' || !e.staff_account_number);
  const retryableBankEntries = bankEntries.filter(e => e.status === 'pending' || e.status === 'failed');

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

  const payEntry = async (entry: PayrollEntry): Promise<boolean> => {
    if (!selectedPeriod || !entry.staff_bank_name || !entry.staff_account_number) return false;

    const reference = `PAY-${entry.id.slice(0, 8)}-${Date.now()}`;
    let paymentAttemptId: string | null = null;
    setPayingId(entry.id);

    try {
      // Resolve the saved display name against the provider's current bank list.
      // This avoids case-sensitive failures such as "Opay" versus "OPay" and
      // keeps codes current when a provider changes or adds a bank.
      const bankResult = await resolveBank(entry.staff_bank_name);
      const bankCode = String(bankResult?.bank?.code ?? '').trim();
      if (!bankCode) throw new Error(`${entry.staff_bank_name} is not available in ${providerLabel}'s current bank list`);

      // Record the attempt before contacting the provider.  This prevents an
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
        })
        .select('id')
        .single();
      if (attemptError || !paymentAttempt) throw attemptError || new Error('Could not record the payroll payment attempt.');
      paymentAttemptId = paymentAttempt.id;

      const { error: processingError } = await supabase
        .from('payroll_entries')
        .update({ status: 'processing', payment_reference: reference })
        .eq('id', entry.id);
      if (processingError) throw processingError;

      const accountResult = await resolveAccount(entry.staff_account_number, bankCode);
      const beneficiaryName = accountResult?.account?.account_name || entry.staff_name || 'Staff';
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
        await supabase
          .from('payroll_payments')
          .update({ status: 'failed', failure_reason: errorMsg })
          .eq('id', paymentAttemptId);
      }
      await supabase.from('payroll_entries').update({ status: 'failed' }).eq('id', entry.id);

      let title = 'Payment Rejected';
      let description = `${entry.staff_name}: ${errorMsg}`;
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

  const payAll = async () => {
    setShowConfirm(false);
    setPayingAll(true);
    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const entry of retryableBankEntries) {
      const ok = await payEntry(entry);
      if (ok) {
        succeeded++;
      } else {
        failed++;
        errors.push(entry.staff_name || 'Unknown');
      }
    }

    await onRefreshEntries();
    fetchBalance();
    setPayingAll(false);

    if (failed === 0 && succeeded > 0) {
      toast({ title: 'Transfers Submitted for Confirmation', description: `${succeeded} transfer(s) are processing with ${providerLabel}. They will show Paid only after provider confirmation.` });
    } else if (succeeded > 0 && failed > 0) {
      toast({ title: 'Some Transfers Were Rejected', description: `${succeeded} submitted for confirmation; ${failed} rejected. Check the specific error toast, correct the issue, then retry.`, variant: 'destructive' });
    }
    // When all fail, individual rejection toasts already explain the reason.
  };

  const totalRetryableAmount = retryableBankEntries.reduce((sum, e) => sum + e.net_pay, 0);
  const providerLabel = provider === 'paystack' ? 'Paystack' : 'Flutterwave';

  return (
    <div className="space-y-4">
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Bulk Payment</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to initiate <strong>{retryableBankEntries.length}</strong> bank transfer(s)
              totaling <strong>₦{totalRetryableAmount.toLocaleString()}</strong> via <strong>{providerLabel}</strong>.
              This action will debit your {providerLabel} balance. Are you sure you want to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={payAll}>Yes, Pay All</AlertDialogAction>
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

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
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
            <Button
              onClick={() => setShowConfirm(true)}
              disabled={payingAll || retryableBankEntries.length === 0}
            >
              {payingAll ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Pay All ({retryableBankEntries.length})
            </Button>
          </div>

          <div className="border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
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
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No bank transfer entries</TableCell>
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
