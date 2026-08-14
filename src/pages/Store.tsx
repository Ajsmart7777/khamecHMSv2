import { useEffect, useMemo, useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useInventory, ReceiptKind, ReceiptLineInput } from '@/hooks/useInventory';
import { supabase } from '@/integrations/supabase/client';
import { PackagePlus, ArrowRightLeft, ClipboardList, RefreshCw, Plus, Trash2, AlertTriangle, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';

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
    mainStoreBatches,
    loading,
    refresh,
    createProduct,
    recordReceipt,
    sendToPharmacy,
  } = useInventory();
  const [pricelist, setPricelist] = useState<PricelistItem[]>([]);
  const [mapping, setMapping] = useState({ pricelistItemId: '', sku: '', unitLabel: 'unit', minimumLevel: '0' });
  const [receiptKind, setReceiptKind] = useState<ReceiptKind>('opening_count');
  const [receiptLocation, setReceiptLocation] = useState<'main_store' | 'pharmacy'>('main_store');
  const [supplierName, setSupplierName] = useState('');
  const [supplierReference, setSupplierReference] = useState('');
  const [receiptNote, setReceiptNote] = useState('');
  const [receiptLines, setReceiptLines] = useState<ReceiptLineInput[]>([emptyReceiptLine()]);
  const [transferLines, setTransferLines] = useState<TransferLine[]>([emptyTransferLine()]);
  const [transferNote, setTransferNote] = useState('');
  const [saving, setSaving] = useState(false);

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
  const availableBatches = useMemo(() => mainStoreBatches.filter(batch => batch.status === 'active' && batch.quantity_on_hand > 0 && batch.expiry_date >= new Date().toISOString().slice(0, 10)), [mainStoreBatches]);

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
      toast.success('Medicine mapped to inventory', { description: 'It can now be counted, received, and transferred.' });
      setMapping({ pricelistItemId: '', sku: '', unitLabel: 'unit', minimumLevel: '0' });
    } catch (error: any) {
      toast.error('Could not map medicine', { description: error.message });
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
    setSaving(true);
    try {
      await recordReceipt(receiptKind, receiptKind === 'supplier_delivery' ? 'main_store' : receiptLocation, validLines, supplierName, supplierReference, receiptNote);
      toast.success(receiptKind === 'opening_count' ? 'Opening count recorded' : 'Supplier delivery received', {
        description: receiptKind === 'opening_count' ? `Opening stock saved for ${receiptLocation === 'main_store' ? 'Main Store' : 'Pharmacy'}.` : 'Stock has been added to Main Store.',
      });
      setReceiptLines([emptyReceiptLine()]);
      setSupplierName('');
      setSupplierReference('');
      setReceiptNote('');
    } catch (error: any) {
      toast.error('Could not save stock receipt', { description: error.message });
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
    } catch (error: any) {
      toast.error('Could not send stock', { description: error.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <MainLayout title="Store" subtitle="Controlled medicine receiving and Pharmacy supply">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <PackageCheck className="h-4 w-4 text-primary" />
          <span>Supplier → Main Store → Pharmacy → Patient</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh stock
        </Button>
      </div>

      <Tabs defaultValue="overview" className="space-y-5">
        <TabsList className="h-auto flex flex-wrap justify-start gap-1 bg-muted p-1">
          <TabsTrigger value="overview">Main Store stock</TabsTrigger>
          <TabsTrigger value="map">Medicine mapping</TabsTrigger>
          <TabsTrigger value="receive">Opening count & receiving</TabsTrigger>
          <TabsTrigger value="transfer">Send to Pharmacy</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Metric label="Active batches" value={String(availableBatches.length)} />
            <Metric label="Units in Main Store" value={mainStoreBatches.reduce((total, batch) => total + batch.quantity_on_hand, 0).toLocaleString()} />
            <Metric label="Stock value" value={money(mainStoreBatches.reduce((total, batch) => total + batch.quantity_on_hand * batch.unit_cost, 0))} />
          </div>
          <div className="rounded-xl border bg-card overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="p-3">Medicine</th><th className="p-3">SKU</th><th className="p-3">Batch</th><th className="p-3">Expiry</th><th className="p-3 text-right">Available</th><th className="p-3 text-right">Unit cost</th><th className="p-3 text-right">Value</th></tr>
              </thead>
              <tbody>
                {mainStoreBatches.map(batch => {
                  const product = batch.inventory_products;
                  const expired = batch.expiry_date < new Date().toISOString().slice(0, 10);
                  return <tr key={batch.id} className="border-b last:border-0">
                    <td className="p-3 font-medium">{product?.pricelist?.name ?? 'Unknown product'} <span className="font-normal text-muted-foreground">{product?.pricelist?.size ?? ''}</span></td>
                    <td className="p-3 font-mono text-xs">{product?.sku ?? '—'}</td>
                    <td className="p-3">{batch.batch_number}</td>
                    <td className="p-3">{batch.expiry_date} {expired && <Badge variant="destructive" className="ml-1">Expired</Badge>}</td>
                    <td className="p-3 text-right font-medium">{batch.quantity_on_hand.toLocaleString()} {product?.unit_label ?? ''}</td>
                    <td className="p-3 text-right">{money(batch.unit_cost)}</td>
                    <td className="p-3 text-right font-medium">{money(batch.quantity_on_hand * batch.unit_cost)}</td>
                  </tr>;
                })}
                {!loading && mainStoreBatches.length === 0 && <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">No Main Store stock has been counted or received yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="map" className="space-y-5">
          <section className="rounded-xl border bg-card p-5">
            <div className="mb-4 flex items-start gap-3"><PackagePlus className="mt-0.5 h-5 w-5 text-primary" /><div><h2 className="font-semibold">Map a billed medicine to stock control</h2><p className="text-sm text-muted-foreground">Only mapped medicine or consumable pricelist entries can be counted, received, and deducted on dispensing.</p></div></div>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2 md:col-span-2"><Label>Pricelist medicine / consumable</Label><select value={mapping.pricelistItemId} onChange={event => setMapping(current => ({ ...current, pricelistItemId: event.target.value }))} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Select an unmapped medicine…</option>{(medicineLikePricelist.length ? medicineLikePricelist : unmappedPricelist).map(item => <option key={item.id} value={item.id}>{item.name}{item.size ? ` — ${item.size}` : ''} ({item.category})</option>)}</select></div>
              <div className="space-y-2"><Label>Store SKU</Label><Input value={mapping.sku} onChange={event => setMapping(current => ({ ...current, sku: event.target.value }))} placeholder="e.g. PCM-500-TAB" /></div>
              <div className="space-y-2"><Label>Unit label</Label><Input value={mapping.unitLabel} onChange={event => setMapping(current => ({ ...current, unitLabel: event.target.value }))} placeholder="tablet, vial, pack" /></div>
              <div className="space-y-2"><Label>Minimum level</Label><Input type="number" min="0" value={mapping.minimumLevel} onChange={event => setMapping(current => ({ ...current, minimumLevel: event.target.value }))} /></div>
              <div className="flex items-end"><Button onClick={() => void handleMapProduct()} disabled={saving}><Plus className="mr-2 h-4 w-4" />Add stock product</Button></div>
            </div>
          </section>
          <section className="rounded-xl border bg-card overflow-x-auto"><div className="border-b p-4"><h2 className="font-semibold">Mapped inventory products</h2></div><table className="w-full min-w-[720px] text-sm"><thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="p-3">Medicine</th><th className="p-3">SKU</th><th className="p-3">Unit</th><th className="p-3 text-right">Minimum</th><th className="p-3 text-right">Selling price</th></tr></thead><tbody>{catalog.map(product => <tr key={product.product_id} className="border-t"><td className="p-3 font-medium">{product.medicine_name} <span className="font-normal text-muted-foreground">{product.size ?? ''}</span></td><td className="p-3 font-mono text-xs">{product.sku}</td><td className="p-3">{product.unit_label}</td><td className="p-3 text-right">{product.minimum_level}</td><td className="p-3 text-right">{money(product.sale_price)}</td></tr>)}{catalog.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No medicines are mapped yet.</td></tr>}</tbody></table></section>
        </TabsContent>

        <TabsContent value="receive" className="space-y-5">
          <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-sm text-amber-900"><div className="flex gap-2"><AlertTriangle className="h-5 w-5 shrink-0" /><p><strong>Opening count is performed by Store.</strong> Enter the real physical balance that is already in Main Store or Pharmacy. Each location can be opened only once; corrections must be visible and authorised later.</p></div></section>
          <section className="rounded-xl border bg-card p-5 space-y-5">
            <div className="flex flex-wrap gap-2"><Button variant={receiptKind === 'opening_count' ? 'default' : 'outline'} onClick={() => setReceiptKind('opening_count')}>Opening physical count</Button><Button variant={receiptKind === 'supplier_delivery' ? 'default' : 'outline'} onClick={() => { setReceiptKind('supplier_delivery'); setReceiptLocation('main_store'); }}>Supplier delivery</Button></div>
            <div className="grid gap-4 md:grid-cols-3">
              {receiptKind === 'opening_count' ? <div className="space-y-2"><Label>Count location</Label><select value={receiptLocation} onChange={event => setReceiptLocation(event.target.value as 'main_store' | 'pharmacy')} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="main_store">Main Store</option><option value="pharmacy">Pharmacy</option></select></div> : <><div className="space-y-2"><Label>Supplier name</Label><Input value={supplierName} onChange={event => setSupplierName(event.target.value)} placeholder="Supplier / distributor" /></div><div className="space-y-2"><Label>Supplier reference</Label><Input value={supplierReference} onChange={event => setSupplierReference(event.target.value)} placeholder="Invoice or delivery note number" /></div><div className="space-y-2"><Label>Destination</Label><Input value="Main Store (required)" disabled /></div></>}
              <div className="space-y-2 md:col-span-3"><Label>Note</Label><Input value={receiptNote} onChange={event => setReceiptNote(event.target.value)} placeholder="Optional receiving or count note" /></div>
            </div>
            <ReceiptLines lines={receiptLines} catalog={catalog} productById={productById} onChange={updateReceiptLine} onAdd={() => setReceiptLines(lines => [...lines, emptyReceiptLine()])} onRemove={index => setReceiptLines(lines => lines.length === 1 ? lines : lines.filter((_, lineIndex) => lineIndex !== index))} />
            <Button onClick={() => void handleReceipt()} disabled={saving}>{saving ? 'Saving…' : receiptKind === 'opening_count' ? 'Record opening count' : 'Receive supplier delivery'}</Button>
          </section>
        </TabsContent>

        <TabsContent value="transfer" className="space-y-5">
          <section className="rounded-xl border bg-card p-5 space-y-5"><div className="flex items-start gap-3"><ArrowRightLeft className="mt-0.5 h-5 w-5 text-primary" /><div><h2 className="font-semibold">Send stock from Main Store to Pharmacy</h2><p className="text-sm text-muted-foreground">Stock leaves Main Store immediately and becomes available in Pharmacy only after the Pharmacist confirms receipt.</p></div></div><div className="space-y-2"><Label>Transfer note</Label><Input value={transferNote} onChange={event => setTransferNote(event.target.value)} placeholder="Optional issue voucher or purpose" /></div><TransferLines lines={transferLines} batches={availableBatches} onChange={updateTransferLine} onAdd={() => setTransferLines(lines => [...lines, emptyTransferLine()])} onRemove={index => setTransferLines(lines => lines.length === 1 ? lines : lines.filter((_, lineIndex) => lineIndex !== index))} /><Button onClick={() => void handleTransfer()} disabled={saving || availableBatches.length === 0}><ArrowRightLeft className="mr-2 h-4 w-4" />{saving ? 'Sending…' : 'Send to Pharmacy'}</Button></section>
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border bg-card p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>;
}

function ReceiptLines({ lines, catalog, productById, onChange, onAdd, onRemove }: { lines: ReceiptLineInput[]; catalog: any[]; productById: Map<string, any>; onChange: (index: number, field: keyof ReceiptLineInput, value: string) => void; onAdd: () => void; onRemove: (index: number) => void }) {
  return <div className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-medium">Stock lines</h3><Button size="sm" variant="outline" onClick={onAdd}><Plus className="mr-1 h-4 w-4" />Add line</Button></div>{lines.map((line, index) => <div key={index} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]"><div className="space-y-1"><Label className="text-xs">Medicine</Label><select value={line.product_id} onChange={event => onChange(index, 'product_id', event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Select mapped product…</option>{catalog.map(product => <option key={product.product_id} value={product.product_id}>{product.medicine_name}{product.size ? ` — ${product.size}` : ''}</option>)}</select></div><div className="space-y-1"><Label className="text-xs">Batch no.</Label><Input value={line.batch_number} onChange={event => onChange(index, 'batch_number', event.target.value)} placeholder="Batch" /></div><div className="space-y-1"><Label className="text-xs">Expiry</Label><Input type="date" value={line.expiry_date} onChange={event => onChange(index, 'expiry_date', event.target.value)} /></div><div className="space-y-1"><Label className="text-xs">Quantity</Label><Input type="number" min="0.001" step="0.001" value={line.quantity} onChange={event => onChange(index, 'quantity', event.target.value)} /></div><div className="space-y-1"><Label className="text-xs">Unit cost</Label><Input type="number" min="0" step="0.01" value={line.unit_cost} onChange={event => onChange(index, 'unit_cost', event.target.value)} placeholder={line.product_id ? `Unit: ${productById.get(line.product_id)?.unit_label ?? ''}` : '₦'} /></div><div className="flex items-end"><Button variant="ghost" size="icon" onClick={() => onRemove(index)} title="Remove line"><Trash2 className="h-4 w-4 text-destructive" /></Button></div></div>)}</div>;
}

function TransferLines({ lines, batches, onChange, onAdd, onRemove }: { lines: TransferLine[]; batches: any[]; onChange: (index: number, field: keyof TransferLine, value: string) => void; onAdd: () => void; onRemove: (index: number) => void }) {
  return <div className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-medium">Batches to send</h3><Button size="sm" variant="outline" onClick={onAdd}><Plus className="mr-1 h-4 w-4" />Add batch</Button></div>{lines.map((line, index) => <div key={index} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[3fr_1fr_auto]"><div className="space-y-1"><Label className="text-xs">Main Store batch</Label><select value={line.batch_id} onChange={event => onChange(index, 'batch_id', event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Select batch…</option>{batches.map(batch => <option key={batch.id} value={batch.id}>{batch.inventory_products?.pricelist?.name ?? 'Unknown'} · {batch.batch_number} · Exp {batch.expiry_date} · Available {batch.quantity_on_hand} {batch.inventory_products?.unit_label ?? ''}</option>)}</select></div><div className="space-y-1"><Label className="text-xs">Quantity</Label><Input type="number" min="0.001" step="0.001" value={line.quantity} onChange={event => onChange(index, 'quantity', event.target.value)} /></div><div className="flex items-end"><Button variant="ghost" size="icon" onClick={() => onRemove(index)} title="Remove line"><Trash2 className="h-4 w-4 text-destructive" /></Button></div></div>)}</div>;
}
