import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

interface BinCardEntry {
  id: string;
  created_at: string;
  movement_type: string;
  quantity_delta: number;
  unit_cost: number;
  reason: string | null;
  particulars: string;
  balance: number;
}

interface BinCardViewProps {
  productId: string;
  locationId: string;
  productName: string;
  unitLabel: string;
}

export function BinCardView({ productId, locationId, productName, unitLabel }: BinCardViewProps) {
  const [entries, setEntries] = useState<BinCardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBinCard = async () => {
      setLoading(true);
      try {
        const { data, error } = await (supabase as any)
          .from('stock_movements')
          .select('id, created_at, movement_type, quantity_delta, unit_cost, reason')
          .eq('product_id', productId)
          .eq('location_id', locationId)
          .order('created_at', { ascending: true });

        if (error) throw error;

        let runningBalance = 0;
        const processedEntries: BinCardEntry[] = (data ?? []).map((row: Record<string, unknown>) => {
          runningBalance += Number(row.quantity_delta ?? 0);
          
          let particulars = typeof row.reason === 'string' ? row.reason : '';
          if (row.movement_type === 'opening_count') {
            particulars = 'Opening Count';
          } else if (row.movement_type === 'receipt') {
            particulars = 'Stock';
          } else if (row.movement_type === 'transfer_out') {
            particulars = 'Clinic';
          } else if (row.movement_type === 'transfer_in') {
            particulars = 'Stock';
          } else if (row.movement_type === 'dispensed') {
            particulars = 'Clinic';
          }

          return {
            id: String(row.id),
            created_at: String(row.created_at),
            movement_type: String(row.movement_type),
            quantity_delta: Number(row.quantity_delta ?? 0),
            unit_cost: Number(row.unit_cost ?? 0),
            reason: typeof row.reason === 'string' ? row.reason : null,
            particulars,
            balance: runningBalance
          };
        });

        setEntries(processedEntries); // Keep the same oldest-to-newest order as the paper Bin Card
      } catch (err) {
        console.error('Error fetching bin card:', err);
      } finally {
        setLoading(false);
      }
    };

    if (productId && locationId) {
      void fetchBinCard();
    }
  }, [productId, locationId]);

  if (loading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b pb-2">
        <div>
          <h3 className="text-lg font-bold text-primary uppercase">{productName}</h3>
          <p className="text-sm text-muted-foreground">Unit: {unitLabel}</p>
        </div>
        <Badge variant="outline" className="text-xs">Digital Bin Card</Badge>
      </div>

      <div className="rounded-md border bg-white shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead className="w-[120px] font-bold text-slate-900 border-r">Date</TableHead>
              <TableHead className="font-bold text-slate-900 border-r">Particulars</TableHead>
              <TableHead className="w-[100px] text-right font-bold text-slate-900 border-r">Receipts</TableHead>
              <TableHead className="w-[100px] text-right font-bold text-slate-900 border-r">Issues</TableHead>
              <TableHead className="w-[120px] text-right font-bold text-slate-900 border-r text-blue-600">Cost Price</TableHead>
              <TableHead className="w-[100px] text-right font-bold text-slate-900 text-primary">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id} className="hover:bg-slate-50/50">
                <TableCell className="text-xs border-r">{new Date(entry.created_at).toLocaleDateString()}</TableCell>
                <TableCell className="border-r font-medium">{entry.particulars}</TableCell>
                <TableCell className="text-right border-r text-green-700 font-semibold">
                  {entry.quantity_delta > 0 ? entry.quantity_delta.toLocaleString() : '-'}
                </TableCell>
                <TableCell className="text-right border-r text-red-700 font-semibold">
                  {entry.quantity_delta < 0 ? Math.abs(entry.quantity_delta).toLocaleString() : '-'}
                </TableCell>
                <TableCell className="text-right border-r text-blue-600 font-medium">
                  {entry.unit_cost > 0 ? `₦${entry.unit_cost.toLocaleString()}` : '-'}
                </TableCell>
                <TableCell className="text-right font-bold text-slate-900 bg-slate-50/30">
                  {entry.balance.toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No bin card entries found for this location.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
