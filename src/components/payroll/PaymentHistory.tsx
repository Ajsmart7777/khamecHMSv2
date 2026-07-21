import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { PayrollPeriod } from '@/hooks/usePayroll';
import { format } from 'date-fns';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface PaymentRecord {
  id: string;
  amount: number;
  status: string;
  provider: string;
  provider_reference: string | null;
  provider_transfer_code: string | null;
  paid_at: string | null;
  created_at: string;
  staff_name: string;
  staff_employee_id: string;
}

interface Props {
  periods: PayrollPeriod[];
}

export function PaymentHistory({ periods }: Props) {
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const nonDraftPeriods = periods.filter(p => p.status !== 'draft');

  useEffect(() => {
    if (!selectedPeriodId && nonDraftPeriods.length > 0) {
      setSelectedPeriodId(nonDraftPeriods[0].id);
    }
  }, [nonDraftPeriods, selectedPeriodId]);

  useEffect(() => {
    if (!selectedPeriodId) return;
    const fetchPayments = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('payroll_payments')
        .select('*, staff!inner(first_name, last_name, employee_id)')
        .eq('payroll_period_id', selectedPeriodId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching payment history:', error);
        setPayments([]);
      } else {
        setPayments((data || []).map((p: Record<string, unknown>) => {
          const staff = p.staff as Record<string, unknown>;
          return {
            id: p.id as string,
            amount: Number(p.amount),
            status: p.status as string,
            provider: p.provider as string,
            provider_reference: p.provider_reference as string | null,
            provider_transfer_code: p.provider_transfer_code as string | null,
            paid_at: p.paid_at as string | null,
            created_at: p.created_at as string,
            staff_name: `${staff.first_name} ${staff.last_name}`,
            staff_employee_id: staff.employee_id as string,
          };
        }));
      }
      setLoading(false);
    };
    fetchPayments();
  }, [selectedPeriodId]);

  const statusVariant = (s: string) => {
    switch (s) {
      case 'paid': case 'success': return 'success' as const;
      case 'processing': return 'warning' as const;
      case 'failed': return 'destructive' as const;
      default: return 'outline' as const;
    }
  };

  const totalPaid = payments.filter(p => p.status === 'paid' || p.status === 'success').reduce((s, p) => s + p.amount, 0);
  const totalProcessing = payments.filter(p => p.status === 'processing').reduce((s, p) => s + p.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <Select value={selectedPeriodId} onValueChange={setSelectedPeriodId}>
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent>
            {nonDraftPeriods.map(p => (
              <SelectItem key={p.id} value={p.id}>
                {MONTHS[p.month - 1]} {p.year} ({p.status})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedPeriodId && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-sm text-muted-foreground">Total Transactions</p>
            <p className="text-2xl font-bold">{payments.length}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-sm text-muted-foreground">Total Paid</p>
            <p className="text-2xl font-bold text-success">₦{totalPaid.toLocaleString()}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-sm text-muted-foreground">Processing</p>
            <p className="text-2xl font-bold text-warning">₦{totalProcessing.toLocaleString()}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : payments.length > 0 ? (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.staff_employee_id}</TableCell>
                    <TableCell className="font-medium">{p.staff_name}</TableCell>
                    <TableCell className="font-bold">₦{p.amount.toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant={p.provider === 'paystack' ? 'secondary' : 'outline'}>
                        {p.provider === 'paystack' ? 'Paystack' : 'Flutterwave'}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {p.provider_reference || '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(p.status)}>{p.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.paid_at ? format(new Date(p.paid_at), 'dd MMM yyyy HH:mm') : format(new Date(p.created_at), 'dd MMM yyyy HH:mm')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : selectedPeriodId ? (
        <div className="text-center py-12 text-muted-foreground">No payment records for this period.</div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">Select a period to view payment history.</div>
      )}
    </div>
  );
}
