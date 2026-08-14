import { useEffect, useState, useCallback } from 'react';
import { createRealtimeChannel, supabase } from '@/integrations/supabase/client';
import { logError } from '@/lib/errorHandler';
import { Badge } from '@/components/ui/badge';
import { ArrowDownCircle, ArrowUpCircle, History, Receipt } from 'lucide-react';
import { format } from 'date-fns';

interface BalanceTx {
  id: string;
  transaction_type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  payment_method: string | null;
  performed_by: string | null;
  notes: string | null;
  created_at: string;
}

interface Props { patientId: string; }

export function PatientBalanceHistory({ patientId }: Props) {
  const [txs, setTxs] = useState<BalanceTx[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTxs = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('balance_transactions')
        .select('*')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setTxs((data || []) as any[] as BalanceTx[]);
    } catch (err) {
      logError('fetchBalanceHistory', err);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    fetchTxs();
    const channel = createRealtimeChannel(`balance-tx-${patientId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'balance_transactions',
        filter: `patient_id=eq.${patientId}`,
      }, () => fetchTxs())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [patientId, fetchTxs]);

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <History className="h-4 w-4 text-muted-foreground" />
        <h4 className="font-semibold text-sm">Balance History</h4>
        {txs.length > 0 && (
          <Badge variant="secondary" className="text-[10px]">{txs.length}</Badge>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : txs.length === 0 ? (
        <div className="py-6 text-center text-muted-foreground">
          <Receipt className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-xs">No balance transactions yet</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {txs.map(tx => {
            const isCredit = tx.amount > 0;
            return (
              <div
                key={tx.id}
                className="flex items-start gap-3 p-2.5 rounded-lg border border-border/60 bg-muted/30"
              >
                <div className={`mt-0.5 shrink-0 ${isCredit ? 'text-success' : 'text-destructive'}`}>
                  {isCredit ? <ArrowDownCircle className="h-5 w-5" /> : <ArrowUpCircle className="h-5 w-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium capitalize">
                      {tx.transaction_type.replace(/_/g, ' ')}
                    </span>
                    <span className={`text-sm font-semibold ${isCredit ? 'text-success' : 'text-destructive'}`}>
                      {isCredit ? '+' : ''}₦{Math.abs(tx.amount).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-1 text-[11px] text-muted-foreground">
                    <span>{format(new Date(tx.created_at), 'dd MMM yyyy, HH:mm')}</span>
                    {tx.payment_method && (
                      <>
                        <span>•</span>
                        <Badge variant="outline" className="text-[10px] capitalize py-0 h-4">
                          {tx.payment_method}
                        </Badge>
                      </>
                    )}
                    {tx.performed_by && (
                      <>
                        <span>•</span>
                        <span>Cashier: {tx.performed_by.slice(0, 8)}</span>
                      </>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Balance: ₦{tx.balance_before.toLocaleString()} → ₦{tx.balance_after.toLocaleString()}
                  </div>
                  {tx.notes && (
                    <p className="text-[11px] text-muted-foreground mt-1 italic">"{tx.notes}"</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
