import { useEffect, useMemo, useState } from 'react';
import { useInventory } from '@/hooks/useInventory';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowRightLeft, PackageCheck, RefreshCw } from 'lucide-react';

interface MovementRow {
  id: string;
  movement_type: string;
  quantity: number;
  created_at: string;
  note: string | null;
  medicine_name: string | null;
  size: string | null;
  from_location?: { name: string; code: string } | null;
  to_location?: { name: string; code: string } | null;
}

const STORE_CODES = new Set(['main_store', 'store_2']);
const money = (amount: number) => `₦${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const movementLabel: Record<string, string> = {
  opening_count: 'Opening count', receipt: 'Supplier receipt', transfer_out: 'Issued to Pharmacy',
  transfer_in: 'Received into Store', adjustment: 'Authorised adjustment', damage: 'Damage',
};

export function InventoryManagementReport() {
  const { batches, loading, refresh } = useInventory();
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [movementLoading, setMovementLoading] = useState(true);

  const stores = useMemo(() => batches.filter(batch => STORE_CODES.has(batch.inventory_locations?.code || '')), [batches]);
  const storeProducts = useMemo(() => {
    const byProduct = new Map<string, { product_id: string; medicine_name: string; size: string | null; quantity_on_hand: number; unit_label: string }>();
    for (const batch of stores) {
      const product = batch.inventory_products;
      if (!product) continue;
      const current = byProduct.get(batch.product_id);
      byProduct.set(batch.product_id, {
        product_id: batch.product_id,
        medicine_name: product.pricelist?.name ?? product.sku,
        size: product.pricelist?.size ?? null,
        quantity_on_hand: (current?.quantity_on_hand ?? 0) + batch.quantity_on_hand,
        unit_label: product.unit_label,
      });
    }
    return [...byProduct.values()].sort((a, b) => a.medicine_name.localeCompare(b.medicine_name));
  }, [stores]);

  const loadMovements = async () => {
    setMovementLoading(true);
    try {
      const [{ data: movementRows, error: movementError }, { data: catalogRows, error: catalogError }, { data: locationRows, error: locationError }] = await Promise.all([
        (supabase as any).from('stock_movements').select('id,movement_type,product_id,location_id,transfer_id,quantity_delta,created_at,reason').order('created_at', { ascending: false }).limit(200),
        (supabase as any).rpc('get_inventory_catalog'),
        (supabase as any).from('inventory_locations').select('id,name,code'),
      ]);
      if (movementError) throw movementError;
      if (catalogError) throw catalogError;
      if (locationError) throw locationError;
      const rows = (movementRows ?? []) as any[];
      const transferIds = [...new Set(rows.map(row => row.transfer_id).filter(Boolean))];
      const { data: transferRows, error: transferError } = transferIds.length
        ? await (supabase as any).from('stock_transfers').select('id,from_location_id,to_location_id').in('id', transferIds)
        : { data: [], error: null };
      if (transferError) throw transferError;
      const productsById = new Map((catalogRows ?? []).map((row: any) => [String(row.product_id), row]));
      const locationsById = new Map((locationRows ?? []).map((row: any) => [String(row.id), row]));
      const transfersById = new Map((transferRows ?? []).map((row: any) => [String(row.id), row]));
      const storeMovements = rows.map((row: any) => {
        const product = productsById.get(String(row.product_id));
        const transfer = row.transfer_id ? transfersById.get(String(row.transfer_id)) : null;
        const movementLocation = locationsById.get(String(row.location_id));
        const fromLocation = transfer ? locationsById.get(String(transfer.from_location_id)) : movementLocation;
        const toLocation = transfer ? locationsById.get(String(transfer.to_location_id)) : null;
        return {
          id: String(row.id), movement_type: String(row.movement_type), quantity: Math.abs(Number(row.quantity_delta ?? 0)),
          created_at: String(row.created_at), note: row.reason ?? null, medicine_name: product?.medicine_name ?? null, size: product?.size ?? null,
          from_location: fromLocation ? { name: String(fromLocation.name), code: String(fromLocation.code) } : null,
          to_location: toLocation ? { name: String(toLocation.name), code: String(toLocation.code) } : null,
        } as MovementRow;
      }).filter(row => STORE_CODES.has(row.from_location?.code || '') || STORE_CODES.has(row.to_location?.code || ''));
      setMovements(storeMovements);
    } finally { setMovementLoading(false); }
  };

  useEffect(() => { void loadMovements(); }, []);

  const storeValue = stores.reduce((total, batch) => total + batch.quantity_on_hand * batch.unit_cost, 0);
  const receiptCount = movements.filter(movement => movement.movement_type === 'receipt' || movement.movement_type === 'opening_count').length;
  const issueCount = movements.filter(movement => movement.movement_type === 'transfer_out').length;
  const refreshAll = async () => { await Promise.all([refresh(), loadMovements()]); };

  return <section className="space-y-5">
    <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-3"><PackageCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div><h2 className="font-semibold">Store management</h2><p className="text-sm text-muted-foreground">Store-only oversight of stock balances, supplier receipts, and issues sent to Pharmacy. Pharmacy dispensing is managed in the Pharmacy workspace.</p></div></div>
      <Button variant="outline" size="sm" onClick={() => void refreshAll()} disabled={loading || movementLoading}><RefreshCw className={`mr-2 h-4 w-4 ${(loading || movementLoading) ? 'animate-spin' : ''}`} />Refresh</Button>
    </div>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Stat label="Store inventory value" value={money(storeValue)} /><Stat label="Store products" value={storeProducts.length.toLocaleString()} /><Stat label="Receipts / opening" value={receiptCount.toLocaleString()} /><Stat label="Issues to Pharmacy" value={issueCount.toLocaleString()} /></div>
    <div className="overflow-x-auto rounded-xl border bg-card"><div className="border-b p-4"><h3 className="font-semibold">Store stock balance</h3></div><table className="w-full min-w-[620px] text-sm"><thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="p-3">Medicine</th><th className="p-3">Store locations</th><th className="p-3 text-right">Balance</th><th className="p-3">Unit</th></tr></thead><tbody>{storeProducts.map(item => <tr key={item.product_id} className="border-t"><td className="p-3 font-medium">{item.medicine_name} <span className="font-normal text-muted-foreground">{item.size ?? ''}</span></td><td className="p-3 text-xs text-muted-foreground">{stores.filter(batch => batch.product_id === item.product_id).map(batch => batch.inventory_locations?.name).filter(Boolean).join(', ') || '—'}</td><td className="p-3 text-right font-semibold">{item.quantity_on_hand.toLocaleString()}</td><td className="p-3">{item.unit_label}</td></tr>)}{!loading && storeProducts.length === 0 && <tr><td colSpan={4} className="p-7 text-center text-muted-foreground">No store bin cards have been registered yet.</td></tr>}</tbody></table></div>
    <div className="overflow-x-auto rounded-xl border bg-card"><div className="border-b p-4"><h3 className="font-semibold">Store receipts and issues</h3><p className="text-sm text-muted-foreground">This list excludes pharmacy dispensing and pharmacy balance calculations.</p></div><table className="w-full min-w-[760px] text-sm"><thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="p-3">When</th><th className="p-3">Medicine</th><th className="p-3">Particulars</th><th className="p-3 text-right">Quantity</th><th className="p-3">Route</th><th className="p-3">Note</th></tr></thead><tbody>{movements.map(movement => <tr key={movement.id} className="border-t"><td className="p-3 text-xs">{new Date(movement.created_at).toLocaleString()}</td><td className="p-3 font-medium">{movement.medicine_name ?? 'Unknown product'} {movement.size ?? ''}</td><td className="p-3"><Badge variant="outline">{movementLabel[movement.movement_type] ?? movement.movement_type}</Badge></td><td className="p-3 text-right">{movement.quantity.toLocaleString()}</td><td className="p-3 text-xs text-muted-foreground">{movement.from_location?.name ?? '—'} <ArrowRightLeft className="mx-1 inline h-3 w-3" /> {movement.to_location?.name ?? '—'}</td><td className="p-3 text-xs text-muted-foreground">{movement.note ?? '—'}</td></tr>)}{!movementLoading && movements.length === 0 && <tr><td colSpan={6} className="p-7 text-center text-muted-foreground">No store receipts or issues have been recorded yet.</td></tr>}</tbody></table></div>
  </section>;
}

function Stat({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border bg-card p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>; }
