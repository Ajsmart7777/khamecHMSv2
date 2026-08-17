import { useInventory } from '@/hooks/useInventory';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowDownToLine, Check, PackageCheck, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { useState } from 'react';

export function PharmacyInventoryPanel() {
  const { pendingTransfers, loading, refresh, receiveTransfer, rejectTransfer } = useInventory();
  const [processingId, setProcessingId] = useState<string | null>(null);

  const accept = async (transferId: string) => {
    setProcessingId(transferId);
    try {
      await receiveTransfer(transferId);
      toast.success('Store delivery accepted', {
        description: 'The Store issue and Pharmacy receipt have been recorded.',
      });
    } catch (error: any) {
      toast.error('Could not accept Store delivery', { description: error.message });
    } finally {
      setProcessingId(null);
    }
  };

  const reject = async (transferId: string) => {
    setProcessingId(transferId);
    try {
      await rejectTransfer(transferId);
      toast.success('Store delivery rejected', {
        description: 'No Store Issue or Pharmacy Receipt was posted.',
      });
    } catch (error: any) {
      toast.error('Could not reject Store delivery', { description: error.message });
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <PackageCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <h3 className="font-semibold">Store delivery acceptance</h3>
            <p className="text-sm text-muted-foreground">
              Check the physical delivery, then accept or reject it. This section records Store-to-Pharmacy movement only; Pharmacy balance is not shown here.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <ArrowDownToLine className="h-5 w-5 text-amber-700" />
          <h3 className="font-semibold text-amber-950">Pending Store deliveries</h3>
          <Badge variant="outline">{pendingTransfers.length}</Badge>
        </div>

        {pendingTransfers.length > 0 ? (
          <div className="space-y-3">
            {pendingTransfers.map((transfer) => {
              const busy = processingId === transfer.id;
              const items = transfer.stock_transfer_items ?? [];
              return (
                <div key={transfer.id} className="rounded-lg border border-amber-200 bg-background p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-sm">
                        From {transfer.from_location?.name ?? 'Store'}: {items.map((item) => `${item.inventory_products?.pricelist?.name ?? 'Medicine'} × ${item.quantity_sent}`).join(', ')}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Sent {new Date(transfer.sent_at).toLocaleString()}
                        {transfer.note ? ` · ${transfer.note}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" onClick={() => void accept(transfer.id)} disabled={busy}>
                        <Check className="mr-1.5 h-4 w-4" />
                        {busy ? 'Processing…' : 'Accept delivery'}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => void reject(transfer.id)} disabled={busy}>
                        <X className="mr-1.5 h-4 w-4" />
                        Reject
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-amber-300 bg-background/70 p-6 text-sm text-muted-foreground">
            <PackageCheck className="h-5 w-5" />
            No Store deliveries are awaiting a Pharmacy decision.
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Prescription dispensing remains in the Pharmacy prescription workspace and is not changed by accepting or rejecting a Store delivery.
      </p>
    </section>
  );
}
