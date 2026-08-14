import { useInventory } from '@/hooks/useInventory';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowDownToLine, AlertTriangle, PackageCheck, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useState } from 'react';

const money = (amount: number) => `₦${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PharmacyInventoryPanel() {
  const { pharmacyStock, pendingTransfers, loading, refresh, receiveTransfer } = useInventory();
  const [receivingId, setReceivingId] = useState<string | null>(null);

  const receive = async (transferId: string) => {
    setReceivingId(transferId);
    try {
      await receiveTransfer(transferId);
      toast.success('Store transfer received', { description: 'The confirmed batches are now available for Pharmacy dispensing.' });
    } catch (error: any) {
      toast.error('Could not receive Store transfer', { description: error.message });
    } finally {
      setReceivingId(null);
    }
  };

  const lowStock = pharmacyStock.filter(item => item.quantity_on_hand <= item.minimum_level);
  const stockValue = pharmacyStock.reduce((total, item) => total + item.quantity_on_hand, 0);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3"><PackageCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div><h3 className="font-semibold">Pharmacy stock control</h3><p className="text-sm text-muted-foreground">Receive stock from Main Store here. Paid medicines deduct automatically from the earliest-expiring available batch.</p></div></div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>
      </div>

      {pendingTransfers.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4"><div className="mb-3 flex items-center gap-2"><ArrowDownToLine className="h-5 w-5 text-amber-700" /><h3 className="font-semibold text-amber-950">Awaiting receipt from Main Store</h3><Badge variant="outline">{pendingTransfers.length}</Badge></div><div className="space-y-3">{pendingTransfers.map(transfer => <div key={transfer.id} className="rounded-lg border border-amber-200 bg-background p-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium text-sm">{(transfer.stock_transfer_items ?? []).map(item => `${item.inventory_products?.pricelist?.name ?? 'Medicine'} × ${item.quantity_sent}`).join(', ')}</p><p className="mt-1 text-xs text-muted-foreground">Sent {new Date(transfer.sent_at).toLocaleString()}{transfer.note ? ` · ${transfer.note}` : ''}</p></div><Button size="sm" onClick={() => void receive(transfer.id)} disabled={receivingId === transfer.id}>{receivingId === transfer.id ? 'Receiving…' : 'Confirm receipt'}</Button></div></div>)}</div></div>}

      <div className="grid gap-4 md:grid-cols-3"><Stat label="Stock-controlled products" value={String(pharmacyStock.length)} /><Stat label="Units on hand" value={stockValue.toLocaleString()} /><Stat label="Low / out of stock" value={String(lowStock.length)} danger={lowStock.length > 0} /></div>

      <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full min-w-[680px] text-sm"><thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="p-3">Medicine</th><th className="p-3">Unit</th><th className="p-3 text-right">Available</th><th className="p-3 text-right">Minimum</th><th className="p-3">Next expiry</th><th className="p-3">Status</th></tr></thead><tbody>{pharmacyStock.map(item => { const isLow = item.quantity_on_hand <= item.minimum_level; return <tr key={item.product_id} className="border-t"><td className="p-3 font-medium">{item.medicine_name} <span className="font-normal text-muted-foreground">{item.size ?? ''}</span></td><td className="p-3">{item.unit_label}</td><td className="p-3 text-right font-semibold">{item.quantity_on_hand.toLocaleString()}</td><td className="p-3 text-right">{item.minimum_level.toLocaleString()}</td><td className="p-3">{item.next_expiry ?? '—'}</td><td className="p-3">{isLow ? <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />Low</Badge> : <Badge variant="success">Available</Badge>}</td></tr>; })}{!loading && pharmacyStock.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No Pharmacy stock has been confirmed yet. Ask Store to record an opening count or send stock from Main Store.</td></tr>}</tbody></table></div>
    </section>
  );
}

function Stat({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <div className={`rounded-xl border p-4 ${danger ? 'border-destructive/30 bg-destructive/5' : 'bg-card'}`}><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className={`mt-1 text-2xl font-semibold ${danger ? 'text-destructive' : ''}`}>{value}</p></div>;
}
