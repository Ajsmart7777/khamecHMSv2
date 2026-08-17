import { useEffect, useMemo, useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InventoryCatalogProduct, InventoryLocationCode, ReceiptKind, ReceiptLineInput, StoreBatch, useInventory } from '@/hooks/useInventory';
import { supabase } from '@/integrations/supabase/client';
import { PackagePlus, ArrowRightLeft, RefreshCw, Plus, Trash2, AlertTriangle, PackageCheck, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { BinCardView } from '@/components/inventory/BinCardView';

interface PricelistItem {
  id: string;
  name: string;
  size: string | null;
  category: string;
  price: number;
  active: boolean;
}

interface TransferLine {
  batch_id: string;
  quantity: string;
}

const emptyReceiptLine = (): ReceiptLineInput => ({
  product_id: '',
  batch_number: '',
  expiry_date: '',
  quantity: '',
  unit_cost: '',
});

const emptyTransferLine = (): TransferLine => ({ batch_id: '', quantity: '' });

const money = (amount: number) => `₦${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Store() {
  const {
    catalog,
    storeBatches,
    locations,
    loading,
    refresh,
    createProduct,
    recordReceipt,
    sendToPharmacy,
  } = useInventory();

  const [pricelist, setPricelist] = useState<PricelistItem[]>([]);
  const [mapping, setMapping] = useState({ pricelistItemId: '', sku: '', unitLabel: 'unit', minimumLevel: '0' });
  const [receiptKind, setReceiptKind] = useState<ReceiptKind>('opening_count');
  const [receiptLocation, setReceiptLocation] = useState<InventoryLocationCode>('main_store');
  const [supplierName, setSupplierName] = useState('');
  const [supplierReference, setSupplierReference] = useState('');
  const [receiptNote, setReceiptNote] = useState('');
  const [receiptLines, setReceiptLines] = useState<ReceiptLineInput[]>([emptyReceiptLine()]);
  const [transferLines, setTransferLines] = useState<TransferLine[]>([emptyTransferLine()]);
  const [transferSourceLocationId, setTransferSourceLocationId] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Bin Card state
  const [binCardProductId, setBinCardProductId] = useState<string>('');
  const [binCardLocationId, setBinCardLocationId] = useState<string>('');

  const storeLocations = useMemo(() => locations.filter(l => l.code !== 'pharmacy'), [locations]);

  useEffect(() => {
    if (storeLocations.length > 0) {
      if (!receiptLocation) setReceiptLocation(storeLocations[0].code);
      if (!binCardLocationId) setBinCardLocationId(storeLocations[0].id);
      if (!transferSourceLocationId) setTransferSourceLocationId(storeLocations[0].id);
    }
  }, [storeLocations, receiptLocation, binCardLocationId, transferSourceLocationId]);

  useEffect(() => {
    const loadPricelist = async () => {
      const { data, error } = await (supabase as any)
        .from('pricelist')
        .select('id,name,size,category,price,active')
        .eq('active', true)
        .order('name');
      if (!error) setPricelist(data ?? []);
    };
    void loadPricelist();
  }, []);

  const mappedPricelistIds = useMemo(() => new Set(catalog.map(product => product.pricelist_item_id)), [catalog]);
  const unmappedPricelist = useMemo(() => pricelist.filter(item => !mappedPricelistIds.has(item.id)), [pricelist, mappedPricelistIds]);
  const medicineLikePricelist = useMemo(() => unmappedPricelist.filter(item => /medicine|drug|pharmacy|consumable|medication/i.test(item.category)), [unmappedPricelist]);

  const productById = useMemo(() => new Map(catalog.map(product => [product.product_id, product])), [catalog]);
  const availableBatches = useMemo(() => storeBatches.filter(batch => batch.location_id === transferSourceLocationId && batch.status === 'active' && batch.quantity_on_hand > 0 && batch.expiry_date >= new Date().toISOString().slice(0, 10)), [storeBatches, transferSourceLocationId]);

  const updateReceiptLine = (index: number, field: keyof ReceiptLineInput, value: string) => {
    setReceiptLines(lines => lines.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line));
  };

  const updateTransferLine = (index: number, field: keyof TransferLine, value: string) => {
    setTransferLines(lines => lines.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line));
  };

  const handleMapProduct = async () => {
    if (!mapping.pricelistItemId || !mapping.sku.trim() || !mapping.unitLabel.trim()) {
      toast.error('Select a medicine and enter its SKU and unit label.');
      return;
    }
    setSaving(true);
    try {
      await createProduct(mapping.pricelistItemId, mapping.sku.trim(), mapping.unitLabel.trim(), Number(mapping.minimumLevel || 0));
      toast.success('Digital Bin Card created', { description: 'You can now record stock for this item.' });
      setMapping({ pricelistItemId: '', sku: '', unitLabel: 'unit', minimumLevel: '0' });
    } catch (error: unknown) {
      toast.error('Could not create bin card', { description: error instanceof Error ? error.message : 'An unexpected error occurred.' });
    } finally {
      setSaving(false);
    }
  };

  const handleReceipt = async () => {
    const validLines = receiptLines.filter(line => line.product_id && line.batch_number.trim() && line.expiry_date && Number(line.quantity) > 0 && Number(line.unit_cost) >= 0);
    if (validLines.length !== receiptLines.length) {
      toast.error('Complete every receipt line with product, batch, expiry date, quantity, and unit cost.');
      return;
    }
    if (receiptKind === 'supplier_delivery' && !supplierName.trim()) {
      toast.error('Supplier name is required for a supplier delivery.');
      return;
    }
    if (receiptKind === 'supplier_delivery' && receiptLocation === 'pharmacy') {
      toast.error('Supplier deliveries must be received into Store 1 or Store 2, not Pharmacy.');
      return;
    }
    setSaving(true);
    try {
      await recordReceipt(receiptKind, receiptLocation, validLines, supplierName, supplierReference, receiptNote);
      toast.success(receiptKind === 'opening_count' ? 'Opening count recorded' : 'Supplier delivery received', {
        description: `Stock has been added to ${locations.find(l => l.code === receiptLocation)?.name || 'Store'}.`,
      });
      setReceiptLines([emptyReceiptLine()]);
      setSupplierName('');
      setSupplierReference('');
      setReceiptNote('');
    } catch (error: unknown) {
      toast.error('Could not save stock receipt', { description: error instanceof Error ? error.message : 'An unexpected error occurred.' });
    } finally {
      setSaving(false);
    }
  };

  const handleTransfer = async () => {
    const validLines = transferLines.filter(line => line.batch_id && Number(line.quantity) > 0);
    if (validLines.length !== transferLines.length) {
      toast.error('Choose every stock batch and enter a positive quantity.');
      return;
    }
    setSaving(true);
    try {
      await sendToPharmacy(validLines, transferNote);
      toast.success('Stock sent to Pharmacy', { description: 'Pharmacy must confirm receipt before this stock is available for dispensing.' });
      setTransferLines([emptyTransferLine()]);
      setTransferNote('');
    } catch (error: unknown) {
      toast.error('Could not send stock', { description: error instanceof Error ? error.message : 'An unexpected error occurred.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <MainLayout title="Store Management" subtitle="Controlled medicine receiving, Store 1 & 2, and Pharmacy supply">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <PackageCheck className="h-4 w-4 text-primary" />
          <span>Supplier → Store (1/2) → Pharmacy → Patient</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh stock
        </Button>
      </div>

      <Tabs defaultValue="overview" className="space-y-5">
        <TabsList className="h-auto flex flex-wrap justify-start gap-1 bg-muted p-1">
          <TabsTrigger value="overview">Inventory Overview</TabsTrigger>
          <TabsTrigger value="bincard">Digital Bin Card</TabsTrigger>
          <TabsTrigger value="setup">Setup Bin Cards</TabsTrigger>
          <TabsTrigger value="receive">Stock Receipts</TabsTrigger>
          <TabsTrigger value="transfer">Send to Pharmacy</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Metric label="Active batches" value={String(availableBatches.length)} />
            <Metric label="Total Units in Store" value={storeBatches.reduce((total, batch) => total + batch.quantity_on_hand, 0).toLocaleString()} />
            <Metric label="Stock value" value={money(storeBatches.reduce((total, batch) => total + batch.quantity_on_hand * batch.unit_cost, 0))} />
          </div>
          <div className="rounded-xl border bg-card overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="p-3">Medicine</th><th className="p-3">Location</th><th className="p-3">Batch</th><th className="p-3">Expiry</th><th className="p-3 text-right">Available</th><th className="p-3 text-right">Unit cost</th><th className="p-3 text-right">Value</th></tr>
              </thead>
              <tbody>
                {storeBatches.map(batch => {
                  const product = batch.inventory_products;
                  const expired = batch.expiry_date < new Date().toISOString().slice(0, 10);
                  return <tr key={batch.id} className="border-b last:border-0">
                    <td className="p-3 font-medium">{product?.pricelist?.name ?? 'Unknown product'} <span className="font-normal text-muted-foreground">{product?.pricelist?.size ?? ''}</span></td>
                    <td className="p-3"><Badge variant="outline">{batch.inventory_locations?.name}</Badge></td>
                    <td className="p-3">{batch.batch_number}</td>
                    <td className="p-3">{batch.expiry_date} {expired && <Badge variant="destructive" className="ml-1">Expired</Badge>}</td>
                    <td className="p-3 text-right font-medium">{batch.quantity_on_hand.toLocaleString()} {product?.unit_label ?? ''}</td>
                    <td className="p-3 text-right">{money(batch.unit_cost)}</td>
                    <td className="p-3 text-right font-medium">{money(batch.quantity_on_hand * batch.unit_cost)}</td>
                  </tr>;
                })}
                {!loading && storeBatches.length === 0 && <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">No Store stock has been recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="bincard" className="space-y-5">
          <section className="rounded-xl border bg-card p-5">
            <div className="mb-4 flex items-start gap-3"><FileText className="mt-0.5 h-5 w-5 text-primary" /><div><h2 className="font-semibold">View Digital Bin Card</h2><p className="text-sm text-muted-foreground">Select a medicine and location to view its movement history.</p></div></div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2"><Label>Medicine</Label><select value={binCardProductId} onChange={event => setBinCardProductId(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Select a medicine…</option>{catalog.map(product => <option key={product.product_id} value={product.product_id}>{product.medicine_name}{product.size ? ` — ${product.size}` : ''}</option>)}</select></div>
              <div className="space-y-2"><Label>Location</Label><select value={binCardLocationId} onChange={event => setBinCardLocationId(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">{locations.map(loc => <option key={loc.id} value={loc.id}>{loc.name}</option>)}</select></div>
            </div>
          </section>

          {binCardProductId && binCardLocationId && (
            <BinCardView
              productId={binCardProductId}
              locationId={binCardLocationId}
              productName={productById.get(binCardProductId)?.medicine_name || ''}
              unitLabel={productById.get(binCardProductId)?.unit_label || ''}
            />
          )}
        </TabsContent>

        <TabsContent value="setup" className="space-y-5">
          <section className="rounded-xl border bg-card p-5">
            <div className="mb-4 flex items-start gap-3"><PackagePlus className="mt-0.5 h-5 w-5 text-primary" /><div><h2 className="font-semibold">Create a new Bin Card</h2><p className="text-sm text-muted-foreground">Link a medicine from the pricelist to start tracking its inventory.</p></div></div>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2 md:col-span-2"><Label>Select Medicine from Pricelist</Label><select value={mapping.pricelistItemId} onChange={event => setMapping(current => ({ ...current, pricelistItemId: event.target.value }))} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Select a medicine…</option>{(medicineLikePricelist.length ? medicineLikePricelist : unmappedPricelist).map(item => <option key={item.id} value={item.id}>{item.name}{item.size ? ` — ${item.size}` : ''} ({item.category})</option>)}</select></div>
              <div className="space-y-2"><Label>Store SKU / Code</Label><Input value={mapping.sku} onChange={event => setMapping(current => ({ ...current, sku: event.target.value }))} placeholder="e.g. PCM-500-TAB" /></div>
              <div className="space-y-2"><Label>Unit (e.g. tablet, vial)</Label><Input value={mapping.unitLabel} onChange={event => setMapping(current => ({ ...current, unitLabel: event.target.value }))} placeholder="tablet, vial, pack" /></div>
              <div className="space-y-2"><Label>Minimum Stock Level</Label><Input type="number" min="0" value={mapping.minimumLevel} onChange={event => setMapping(current => ({ ...current, minimumLevel: event.target.value }))} /></div>
              <div className="flex items-end"><Button onClick={() => void handleMapProduct()} disabled={saving}><Plus className="mr-2 h-4 w-4" />Create Bin Card</Button></div>
            </div>
          </section>
          <section className="rounded-xl border bg-card overflow-x-auto"><div className="border-b p-4"><h2 className="font-semibold">Active Bin Cards</h2></div><table className="w-full min-w-[720px] text-sm"><thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="p-3">Medicine</th><th className="p-3">SKU</th><th className="p-3">Unit</th><th className="p-3 text-right">Minimum</th><th className="p-3 text-right">Selling price</th></tr></thead><tbody>{catalog.map(product => <tr key={product.product_id} className="border-t"><td className="p-3 font-medium">{product.medicine_name} <span className="font-normal text-muted-foreground">{product.size ?? ''}</span></td><td className="p-3 font-mono text-xs">{product.sku}</td><td className="p-3">{product.unit_label}</td><td className="p-3 text-right">{product.minimum_level}</td><td className="p-3 text-right">{money(product.sale_price)}</td></tr>)}{catalog.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No Bin Cards created yet.</td></tr>}</tbody></table></section>
        </TabsContent>

        <TabsContent value="receive" className="space-y-5">
          <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-sm text-amber-900"><div className="flex gap-2"><AlertTriangle className="h-5 w-5 shrink-0" /><p><strong>Opening count is performed by Store.</strong> Enter the real physical balance that is already in Store 1, Store 2, or Pharmacy. Each location can be opened only once; corrections must be visible and authorised later.</p></div></section>
          <section className="rounded-xl border bg-card p-5 space-y-5">
            <div className="flex flex-wrap gap-2"><Button variant={receiptKind === 'opening_count' ? 'default' : 'outline'} onClick={() => setReceiptKind('opening_count')}>Opening physical count</Button><Button variant={receiptKind === 'supplier_delivery' ? 'default' : 'outline'} onClick={() => { setReceiptKind('supplier_delivery'); }}>Supplier delivery</Button></div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2"><Label>Store Location</Label><select value={receiptLocation} onChange={event => setReceiptLocation(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">{locations.map(loc => <option key={loc.id} value={loc.code} disabled={receiptKind === 'supplier_delivery' && loc.code === 'pharmacy'}>{loc.name}</option>)}</select></div>
              {receiptKind === 'supplier_delivery' && <><div className="space-y-2"><Label>Supplier name</Label><Input value={supplierName} onChange={event => setSupplierName(event.target.value)} placeholder="Supplier / distributor" /></div><div className="space-y-2"><Label>Supplier reference</Label><Input value={supplierReference} onChange={event => setSupplierReference(event.target.value)} placeholder="Invoice or delivery note number" /></div></>}
              <div className="space-y-2 md:col-span-3"><Label>Note</Label><Input value={receiptNote} onChange={event => setReceiptNote(event.target.value)} placeholder="Reason for receipt or opening" /></div>
            </div>
            <ReceiptLines lines={receiptLines} catalog={catalog} productById={productById} onChange={updateReceiptLine} onAdd={() => setReceiptLines(lines => [...lines, emptyReceiptLine()])} onRemove={index => setReceiptLines(lines => lines.length === 1 ? lines : lines.filter((_, lineIndex) => lineIndex !== index))} />
            <Button onClick={() => void handleReceipt()} disabled={saving}>{saving ? 'Saving…' : receiptKind === 'opening_count' ? 'Record opening count' : 'Receive supplier delivery'}</Button>
          </section>
        </TabsContent>

        <TabsContent value="transfer" className="space-y-5">
          <section className="rounded-xl border bg-card p-5 space-y-5"><div className="flex items-start gap-3"><ArrowRightLeft className="mt-0.5 h-5 w-5 text-primary" /><div><h2 className="font-semibold">Send stock to Pharmacy</h2><p className="text-sm text-muted-foreground">Choose either Store 1 or Store 2. A transfer cannot mix stock from both stores, and Pharmacy must confirm receipt before dispensing.</p></div></div><div className="grid gap-4 md:grid-cols-3"><div className="space-y-2"><Label>Source store</Label><select value={transferSourceLocationId} onChange={event => { setTransferSourceLocationId(event.target.value); setTransferLines([emptyTransferLine()]); }} className="h-10 w-full rounded-md border bg-background px-3 text-sm">{storeLocations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></div><div className="space-y-2 md:col-span-2"><Label>Transfer note</Label><Input value={transferNote} onChange={event => setTransferNote(event.target.value)} placeholder="Optional issue voucher or purpose" /></div></div><TransferLines lines={transferLines} batches={availableBatches} onChange={updateTransferLine} onAdd={() => setTransferLines(lines => [...lines, emptyTransferLine()])} onRemove={index => setTransferLines(lines => lines.length === 1 ? lines : lines.filter((_, lineIndex) => index !== lineIndex))} /><Button onClick={() => void handleTransfer()} disabled={saving || availableBatches.length === 0}><ArrowRightLeft className="mr-2 h-4 w-4" />{saving ? 'Sending…' : 'Send to Pharmacy'}</Button></section>
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border bg-card p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>;
}

function ReceiptLines({ lines, catalog, productById, onChange, onAdd, onRemove }: { lines: ReceiptLineInput[]; catalog: InventoryCatalogProduct[]; productById: Map<string, InventoryCatalogProduct>; onChange: (index: number, field: keyof ReceiptLineInput, value: string) => void; onAdd: () => void; onRemove: (index: number) => void }) {
  return <div className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-medium">Stock lines</h3><Button size="sm" variant="outline" onClick={onAdd}><Plus className="mr-1 h-4 w-4" />Add line</Button></div>{lines.map((line, index) => <div key={index} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]"><div className="space-y-1"><Label className="text-xs">Medicine</Label><select value={line.product_id} onChange={event => onChange(index, 'product_id', event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Select bin card…</option>{catalog.map(product => <option key={product.product_id} value={product.product_id}>{product.medicine_name}{product.size ? ` — ${product.size}` : ''}</option>)}</select></div><div className="space-y-1"><Label className="text-xs">Batch no.</Label><Input value={line.batch_number} onChange={event => onChange(index, 'batch_number', event.target.value)} placeholder="Batch" /></div><div className="space-y-1"><Label className="text-xs">Expiry</Label><Input type="date" value={line.expiry_date} onChange={event => onChange(index, 'expiry_date', event.target.value)} /></div><div className="space-y-1"><Label className="text-xs">Quantity</Label><Input type="number" min="0.001" step="0.001" value={line.quantity} onChange={event => onChange(index, 'quantity', event.target.value)} /></div><div className="space-y-1"><Label className="text-xs">Unit cost</Label><Input type="number" min="0" step="0.01" value={line.unit_cost} onChange={event => onChange(index, 'unit_cost', event.target.value)} placeholder={line.product_id ? `Unit: ${productById.get(line.product_id)?.unit_label ?? ''}` : '₦'} /></div><div className="flex items-end"><Button variant="ghost" size="icon" onClick={() => onRemove(index)} title="Remove line"><Trash2 className="h-4 w-4 text-destructive" /></Button></div></div>)}</div>;
}

function TransferLines({ lines, batches, onChange, onAdd, onRemove }: { lines: TransferLine[]; batches: StoreBatch[]; onChange: (index: number, field: keyof TransferLine, value: string) => void; onAdd: () => void; onRemove: (index: number) => void }) {
  return <div className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-medium">Batches to send</h3><Button size="sm" variant="outline" onClick={onAdd}><Plus className="mr-1 h-4 w-4" />Add batch</Button></div>{lines.map((line, index) => <div key={index} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[3fr_1fr_auto]"><div className="space-y-1"><Label className="text-xs">Store batch</Label><select value={line.batch_id} onChange={event => onChange(index, 'batch_id', event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Select batch…</option>{batches.map(batch => <option key={batch.id} value={batch.id}>{batch.inventory_products?.pricelist?.name ?? 'Unknown'} · {batch.batch_number} · Exp {batch.expiry_date} · Available {batch.quantity_on_hand} {batch.inventory_products?.unit_label ?? ''} ({batch.inventory_locations?.name})</option>)}</select></div><div className="space-y-1"><Label className="text-xs">Quantity</Label><Input type="number" min="0.001" step="0.001" value={line.quantity} onChange={event => onChange(index, 'quantity', event.target.value)} /></div><div className="flex items-end"><Button variant="ghost" size="icon" onClick={() => onRemove(index)} title="Remove line"><Trash2 className="h-4 w-4 text-destructive" /></Button></div></div>)}</div>;
}
