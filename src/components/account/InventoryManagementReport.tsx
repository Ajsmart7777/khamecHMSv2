import { useEffect, useMemo, useState } from 'react';
import { useInventory } from '@/hooks/useInventory';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ArrowRightLeft, PackageCheck, RefreshCw, TrendingDown } from 'lucide-react';

interface MovementRow {
  id: string;
  movement_type: string;
  quantity: number;
  created_at: string;
  note: string | null;
  medicine_name: string | null;
  size: string | null;
  from_location?: { name: string } | null;
  to_location?: { name: string } | null;
}

const money = (amount: number) => `₦${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const movementLabel: Record<string, string> = { opening_count: 'Opening count', receipt: 'Supplier receipt', transfer_out: 'Sent to Pharmacy', transfer_in: 'Received in Pharmacy', dispense: 'Dispensed to patient', adjustment: 'Authorised adjustment', damage: 'Damage' };

export function InventoryManagementReport() {
  const { batches, loading, refresh } = useInventory();
  const pharmacyStock = useMemo(() => {
    const byProduct = new Map<string, { product_id: string; medicine_name: string; size: string | null; quantity_on_hand: number; minimum_level: number; unit_label: string }>();
    for (const batch of batches) {
      if (batch.inventory_locations?.code !== 'pharmacy' || !batch.inventory_products) continue;
      const product = batch.inventory_products;
      const name = product.pricelist?.name ?? product.sku;
      const current = byProduct.get(batch.product_id);
      byProduct.set(batch.product_id, {
        product_id: batch.product_id,
        medicine_name: name,
        size: product.pricelist?.size ?? null,
        quantity_on_hand: (current?.quantity_on_hand ?? 0) + batch.quantity_on_hand,
        minimum_level: product.minimum_level,
        unit_label: product.unit_label,
      });
    }
    return [...byProduct.values()];
  }, [batches]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [movementLoading, setMovementLoading] = useState(true);

  const loadMovements = async () => {
    setMovementLoading(true);
    try {
      const [{ data: movementRows, error: movementError }, { data: catalogRows, error: catalogError }, { data: locationRows, error: locationError }] = await Promise.all([
        (supabase as any).from('stock_movements').select('id,movement_type,product_id,location_id,transfer_id,quantity_delta,created_at,reason').order('created_at', { ascending: false }).limit(100),
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
      setMovements(rows.map((row: any) => {
        const product = productsById.get(String(row.product_id));
        const transfer = row.transfer_id ? transfersById.get(String(row.transfer_id)) : null;
        const movementLocation = locationsById.get(String(row.location_id));
        const fromLocation = transfer ? locationsById.get(String(transfer.from_location_id)) : movementLocation;
        const toLocation = transfer ? locationsById.get(String(transfer.to_location_id)) : null;
        return {
          id: String(row.id),
          movement_type: String(row.movement_type),
          quantity: Math.abs(Number(row.quantity_delta ?? 0)),
          created_at: String(row.created_at),
          note: row.reason ?? null,
          medicine_name: product?.medicine_name ?? null,
          size: product?.size ?? null,
          from_location: fromLocation ? { name: String(fromLocation.name) } : null,
          to_location: toLocation ? { name: String(toLocation.name) } : null,
        };
      }));
    } finally { setMovementLoading(false); }
  };

  useEffect(() => { void loadMovements(); }, []);

  const stores = useMemo(() => batches.filter(batch => ['main_store', 'store_2'].includes(batch.inventory_locations?.code || '')), [batches]);
  const storeValue = stores.reduce((total, batch) => total + batch.quantity_on_hand * batch.unit_cost, 0);
  const pharmacyUnits = pharmacyStock.reduce((total, item) => total + item.quantity_on_hand, 0);
  const pharmacyLow = pharmacyStock.filter(item => item.quantity_on_hand <= item.minimum_level);
  const dispensedToday = movements.filter(movement => movement.movement_type === 'dispense' && movement.created_at.slice(0, 10) === new Date().toISOString().slice(0, 10));

  const refreshAll = async () => { await Promise.all([refresh(), loadMovements()]); };

  return <section className="space-y-5">
    <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><PackageCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div><h2 className="font-semibold">Pharmacy & Store management</h2><p className="text-sm text-muted-foreground">Read-only financial oversight of stock, purchase value, low-stock risk, and every controlled movement.</p></div></div><Button variant="outline" size="sm" onClick={() => void refreshAll()} disabled={loading || movementLoading}><RefreshCw className={`mr-2 h-4 w-4 ${(loading || movementLoading) ? 'animate-spin' : ''}`} />Refresh</Button></div>

    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Stat label="Store Inventory value" value={money(storeValue)} /><Stat label="Store Inventory units" value={stores.reduce((total, batch) => total + batch.quantity_on_hand, 0).toLocaleString()} /><Stat label="Pharmacy units" value={pharmacyUnits.toLocaleString()} /><Stat label="Dispensed today" value={String(dispensedToday.length)} /></div>

    {pharmacyLow.length > 0 && <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4"><div className="mb-3 flex gap-2"><AlertTriangle className="h-5 w-5 text-destructive" /><div><h3 className="font-semibold text-destructive">Pharmacy low-stock attention</h3><p className="text-sm text-muted-foreground">These stock-controlled medicines are at or below their configured minimum.</p></div></div><div className="flex flex-wrap gap-2">{pharmacyLow.map(item => <Badge key={item.product_id} variant="outline" className="border-destructive/30 bg-background text-destructive">{item.medicine_name}: {item.quantity_on_hand} / min {item.minimum_level}</Badge>)}</div></div>}

    <div className="grid gap-5 xl:grid-cols-2"><div className="overflow-x-auto rounded-xl border bg-card"><div className="border-b p-4"><h3 className="font-semibold">Pharmacy availability</h3></div><table className="w-full min-w-[560px] text-sm"><thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="p-3">Medicine</th><th className="p-3 text-right">Available</th><th className="p-3 text-right">Minimum</th></tr></thead><tbody>{pharmacyStock.map(item => <tr key={item.product_id} className="border-t"><td className="p-3 font-medium">{item.medicine_name} <span className="font-normal text-muted-foreground">{item.size ?? ''}</span></td><td className="p-3 text-right">{item.quantity_on_hand.toLocaleString()} {item.unit_label}</td><td className="p-3 text-right">{item.minimum_level}</td></tr>)}{!loading && pharmacyStock.length === 0 && <tr><td colSpan={3} className="p-7 text-center text-muted-foreground">No Pharmacy opening count or Store transfer has been confirmed.</td></tr>}</tbody></table></div>
      <div className="overflow-x-auto rounded-xl border bg-card"><div className="border-b p-4"><h3 className="font-semibold">Recent controlled movement</h3></div><table className="w-full min-w-[620px] text-sm"><thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="p-3">When</th><th className="p-3">Medicine</th><th className="p-3">Action</th><th className="p-3 text-right">Quantity</th><th className="p-3">Route</th></tr></thead><tbody>{movements.map(movement => <tr key={movement.id} className="border-t"><td className="p-3 text-xs">{new Date(movement.created_at).toLocaleString()}</td><td className="p-3 font-medium">{movement.medicine_name ?? 'Unknown product'} {movement.size ?? ''}</td><td className="p-3"><Badge variant="outline">{movementLabel[movement.movement_type] ?? movement.movement_type}</Badge></td><td className="p-3 text-right">{movement.quantity.toLocaleString()}</td><td className="p-3 text-xs text-muted-foreground">{movement.from_location?.name ?? '—'} <ArrowRightLeft className="mx-1 inline h-3 w-3" /> {movement.to_location?.name ?? '—'}</td></tr>)}{!movementLoading && movements.length === 0 && <tr><td colSpan={5} className="p-7 text-center text-muted-foreground">No controlled inventory movement has been recorded yet.</td></tr>}</tbody></table></div></div>
  </section>;
}

function Stat({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border bg-card p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>; }
