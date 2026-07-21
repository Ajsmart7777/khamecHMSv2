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

const BANK_CODES_BY_PROVIDER: Record<PaymentProvider, Record<string, string>> = {
  flutterwave: {
    'Access Bank': '044', 'Citibank': '023', 'Ecobank': '050', 'Fidelity Bank': '070',
    'First Bank': '011', 'First City Monument Bank': '214', 'Guaranty Trust Bank': '058',
    'Heritage Bank': '030', 'Keystone Bank': '082', 'Polaris Bank': '076',
    'Providus Bank': '101', 'Stanbic IBTC Bank': '221', 'Standard Chartered': '068',
    'Sterling Bank': '232', 'SunTrust Bank': '100', 'Titan Trust Bank': '000025',
    'Union Bank': '032', 'United Bank for Africa': '033', 'Unity Bank': '215',
    'Wema Bank': '035', 'Zenith Bank': '057', 'Jaiz Bank': '301',
    'Kuda Bank': '090267', 'OPay': '100004', 'PalmPay': '100033', 'Moniepoint MFB': '110007',
  },
  paystack: {
    'Access Bank': '044', 'Citibank': '023', 'Ecobank': '050', 'Fidelity Bank': '070',
    'First Bank': '011', 'First City Monument Bank': '214', 'Guaranty Trust Bank': '058',
    'Heritage Bank': '030', 'Keystone Bank': '082', 'Polaris Bank': '076',
    'Providus Bank': '101', 'Stanbic IBTC Bank': '221', 'Standard Chartered': '068',
    'Sterling Bank': '232', 'SunTrust Bank': '100', 'Titan Trust Bank': '000025',
    'Union Bank': '032', 'United Bank for Africa': '033', 'Unity Bank': '215',
    'Wema Bank': '035', 'Zenith Bank': '057', 'Jaiz Bank': '301',
    'Kuda Bank': '50211', 'OPay': '999992', 'PalmPay': '999991', 'Moniepoint MFB': '50515',
  },
};

interface Props {
  periods: PayrollPeriod[];
  selectedPeriod: PayrollPeriod | null;
  onSelectPeriod: (p: PayrollPeriod) => void;
  entries: PayrollEntry[];
  onRefreshEntries: () => Promise<void>;
}

export function PayrollPayments({ periods, selectedPeriod, onSelectPeriod, entries, onRefreshEntries }: Props) {
  const [balance, setBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [payingAll, setPayingAll] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [provider, setProvider] = useState<PaymentProvider>('flutterwave');
  const { getBalance, resolveAccount, initiateTransfer } = useProviderActions(provider);

  const bankEntries = entries.filter(e => e.staff_payment_method === 'bank' && e.staff_bank_name && e.staff_account_number);
  const cashEntries = entries.filter(e => e.staff_payment_method !== 'bank' || !e.staff_account_number);
  const retryableBankEntries = bankEntries.filter(e => e.status === 'pending' || e.status === 'failed');

  const canPay = selectedPeriod?.status === 'locked';

  const fetchBalance = async () => {
    setLoadingBalance(true);
    try {
      const data = await getBalance();
      const ngn = data.balance;
      setBalance(ngn ? (typeof ngn.available_balance === 'number' ? ngn.available_balance : Number(ngn.available_balance) || 0) : 0);
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Could not fetch balance', variant: 'destructive' });
    }
    setLoadingBalance(false);
  };

  useEffect(() => { if (canPay) fetchBalance(); }, [canPay, provider]);

  const payEntry = async (entry: PayrollEntry): Promise<boolean> => {
    if (!entry.staff_bank_name || !entry.staff_account_number) return false;
    const bankCode = BANK_CODES_BY_PROVIDER[provider][entry.staff_bank_name];
    if (!bankCode) {
      toast({ title: 'Bank Not Supported', description: `${entry.staff_bank_name} is not mapped for ${providerLabel}. Please edit the staff bank details and retry.`, variant: 'destructive' });
      await supabase.from('payroll_entries').update({ status: 'failed' }).eq('id', entry.id);
      return false;
    }

    if (entry.status === 'failed') {
      await supabase.from('payroll_entries').update({ status: 'pending' }).eq('id', entry.id);
    }

    setPayingId(entry.id);
    try {
      await resolveAccount(entry.staff_account_number, bankCode);

      const reference = `PAY-${entry.id.slice(0, 8)}-${Date.now()}`;
      const transferRes = await initiateTransfer({
        amount: entry.net_pay,
        account_bank: bankCode,
        account_number: entry.staff_account_number,
        beneficiary_name: entry.staff_name || 'Staff',
        narration: `Salary - ${entry.staff_name}`,
        reference,
      });

      const transferId = transferRes.transfer?.id?.toString() || transferRes.transfer?.transfer_code || '';
      const recipientCode = transferRes.transfer?.recipient_code || null;

      await supabase.from('payroll_payments').insert({
        payroll_period_id: selectedPeriod!.id,
        payroll_entry_id: entry.id,
        staff_id: entry.staff_id,
        amount: entry.net_pay,
        status: 'processing',
        provider_transfer_code: transferId,
        provider_reference: reference,
        provider_recipient_code: recipientCode,
        provider,
      });

      await supabase.from('payroll_entries').update({ status: 'processing', payment_reference: reference }).eq('id', entry.id);

      setPayingId(null);
      return true;
    } catch (err) {
      await supabase.from('payroll_entries').update({ status: 'failed' }).eq('id', entry.id);
      const errorMsg = err instanceof Error ? err.message : 'Transfer failed';
      
      // Provide tailored, user-friendly error descriptions
      let title = 'Payment Could Not Be Processed';
      let description = `${entry.staff_name}: ${errorMsg}`;
      
      if (errorMsg.includes('third party payouts')) {
        title = 'Transfers Not Enabled';
        description = `${providerLabel} has not enabled third-party payouts on your account. Please contact ${providerLabel} support to activate transfers before retrying.`;
      } else if (errorMsg.includes('insufficient') || errorMsg.includes('Insufficient')) {
        title = 'Insufficient Balance';
        description = `Your ${providerLabel} balance is too low to pay ${entry.staff_name} (₦${entry.net_pay.toLocaleString()}). Please fund your ${providerLabel} wallet and retry.`;
      } else if (errorMsg.includes('not configured') || errorMsg.includes('SECRET_KEY')) {
        title = 'Provider Not Configured';
        description = `${providerLabel} API key is missing or invalid. Please check your configuration.`;
      } else if (errorMsg.includes('Unknown Bank Code') || errorMsg.includes('Bank Code')) {
        title = 'Bank Code Not Accepted';
        description = `${providerLabel} rejected ${entry.staff_bank_name}. Please edit the staff bank details and select the correct bank option before retrying.`;
      } else if (errorMsg.includes('recipient') || errorMsg.includes('account') || errorMsg.includes('beneficiary')) {
        title = 'Invalid Bank Details';
        description = `Could not process payment for ${entry.staff_name}. Please verify the bank name and account number are correct.`;
      } else if (errorMsg.includes('IP') || errorMsg.includes('whitelist')) {
        title = 'Access Restricted';
        description = `${providerLabel} is blocking requests from this server. Please contact ${providerLabel} support to disable IP whitelisting.`;
      }
      
      toast({ title, description, variant: 'destructive' });
      setPayingId(null);
      return false;
    }
  };

  const handlePaySingle = async (entry: PayrollEntry) => {
    const ok = await payEntry(entry);
    await onRefreshEntries();
    fetchBalance();
    if (ok) {
      toast({ title: 'Transfer Initiated', description: `₦${entry.net_pay.toLocaleString()} sent to ${entry.staff_name} via ${provider === 'paystack' ? 'Paystack' : 'Flutterwave'}` });
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
      toast({ title: 'Bulk Payment Complete', description: `${succeeded} transfer(s) initiated successfully via ${providerLabel}.` });
    } else if (succeeded > 0 && failed > 0) {
      toast({ title: 'Bulk Payment Partial', description: `${succeeded} succeeded, ${failed} failed. Check the individual error messages above for details.`, variant: 'destructive' });
    }
    // When all fail, don't show a generic bulk toast — the individual tailored errors are already visible
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
              <p className="text-sm text-muted-foreground">Paid</p>
              <p className="text-2xl font-bold text-success">
                {entries.filter(e => e.status === 'paid' || e.status === 'processing').length}
              </p>
            </div>
          </div>
        </>
      )}

      {canPay && (
        <>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              <Wallet className="h-5 w-5" /> Bank Transfers
            </h3>
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
                        }>{entry.status}</Badge>
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
            : 'All payments for this period have been processed.'}
        </div>
      )}

      {!selectedPeriod && (
        <div className="text-center py-12 text-muted-foreground">Select a locked/paid period to view payments.</div>
      )}
    </div>
  );
}
