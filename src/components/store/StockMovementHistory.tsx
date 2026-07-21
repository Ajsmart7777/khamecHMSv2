import { Badge } from '@/components/ui/badge';
import { ArrowDownRight, ArrowUpRight, RefreshCw, Package } from 'lucide-react';
import { StockMovement } from '@/hooks/useInventory';
import { format } from 'date-fns';

interface StockMovementHistoryProps {
  movements: StockMovement[];
  getItemName: (id: string) => string;
  loading: boolean;
}

export function StockMovementHistory({ movements, getItemName, loading }: StockMovementHistoryProps) {
  const getMovementIcon = (type: string) => {
    switch (type) {
      case 'stock_in': return <ArrowDownRight className="h-4 w-4 text-emerald-500" />;
      case 'transfer_out': return <ArrowUpRight className="h-4 w-4 text-orange-500" />;
      default: return <RefreshCw className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getMovementLabel = (type: string) => {
    switch (type) {
      case 'stock_in': return 'Stock In';
      case 'transfer_out': return 'Transfer Out';
      case 'dispensed': return 'Dispensed';
      case 'adjustment': return 'Adjustment';
      default: return type;
    }
  };

  const getMovementVariant = (type: string): "success" | "warning" | "secondary" | "destructive" => {
    switch (type) {
      case 'stock_in': return 'success';
      case 'transfer_out': return 'warning';
      case 'dispensed': return 'destructive';
      default: return 'secondary';
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Loading movement history...</div>;
  }

  return (
    <div className="bg-card rounded-xl border border-border">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Package className="h-5 w-5 text-module-store" />
          Stock Movement History
        </h3>
        <span className="text-sm text-muted-foreground">{movements.length} records</span>
      </div>

      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Item</th>
              <th className="text-center">Qty</th>
              <th>Reference</th>
              <th>Notes</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {movements.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-muted-foreground">
                  No stock movements recorded yet.
                </td>
              </tr>
            ) : (
              movements.map((m) => (
                <tr key={m.id} className="animate-fade-in">
                  <td className="text-sm whitespace-nowrap">
                    {format(new Date(m.created_at), 'dd MMM yyyy, HH:mm')}
                  </td>
                  <td>
                    <Badge variant={getMovementVariant(m.movement_type)} className="gap-1">
                      {getMovementIcon(m.movement_type)}
                      {getMovementLabel(m.movement_type)}
                    </Badge>
                  </td>
                  <td className="font-medium">{getItemName(m.item_id)}</td>
                  <td className="text-center font-mono">
                    <span className={m.quantity > 0 ? 'text-emerald-600' : 'text-orange-600'}>
                      {m.quantity > 0 ? '+' : ''}{m.quantity}
                    </span>
                  </td>
                  <td className="text-sm text-muted-foreground">{m.reference || '—'}</td>
                  <td className="text-sm text-muted-foreground max-w-[200px] truncate">{m.notes || '—'}</td>
                  <td className="text-sm">{m.created_by || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
