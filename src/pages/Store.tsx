import { useEffect, useMemo, useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ReceiptKind,
  StoreLocationCode,
  useInventory,
} from '@/hooks/useInventory';
import { supabase } from '@/integrations/supabase/client';
import { ArrowRightLeft, FileText, PackageCheck, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
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

interface StockLine {
  productId: string;
  quantity: string;
  costPrice: string;
}

interface PharmacyIssueLine {
  productId: string;
  quantity: string;
}

const emptyStockLine = (): StockLine => ({ productId: '', quantity: '', costPrice: '' });
const emptyIssueLine = (): PharmacyIssueLine => ({ productId: '', quantity: '' });
const money = (amount: number) => `₦${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const describeStoreError = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    const parts = [value.message, value.details, value.hint, value.code ? `Code: ${value.code}` : null]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
    if (parts.length > 0) return parts.join(' — ');
    try { return JSON.stringify(error); } catch { return 'An unexpected error occurred.'; }
  }
  return typeof error === 'string' && error.trim() ? error : 'An unexpected error occurred.';
};

export default function Store() {
  const {
    catalog,
    storeBinCards,
    storeLocations,
    locations,
    loading,
    refresh,
    registerBinCard,
    registerManualBinCard,
    recordReceipt,
    sendToPharmacy,
  } = useInventory();

  const [pricelist, setPricelist] = useState<PricelistItem[]>([]);
  const [selectedStoreCode, setSelectedStoreCode] = useState<StoreLocationCode>('main_store');
  const [searchText, setSearchText] = useState('');
  const [selectedBinCardId, setSelectedBinCardId] = useState('');
  const [registrationMedicineId, setRegistrationMedicineId] = useState('');
  const [pricelistSearch, setPricelistSearch] = useState('');
  const [manualMedicineName, setManualMedicineName] = useState('');
  const [manualCategory, setManualCategory] = useState('manual');
  const [manualSize, setManualSize] = useState('');
  const [manualSalePrice, setManualSalePrice] = useState('');
  const [stockKind, setStockKind] = useState<ReceiptKind>('supplier_delivery');
  const [supplierName, setSupplierName] = useState('');
  const [stockLine, setStockLine] = useState<StockLine>(emptyStockLine());
  const [issueLines, setIssueLines] = useState<PharmacyIssueLine[]>([emptyIssueLine()]);
  const [saving, setSaving] = useState(false);

  const selectedLocation = useMemo(
    () => storeLocations.find(location => location.code === selectedStoreCode),
    [selectedStoreCode, storeLocations],
  );
  const selectedStoreBinCards = useMemo(
    () => storeBinCards.filter(card => card.location_code === selectedStoreCode),
    [selectedStoreCode, storeBinCards],
  );
  const filteredBinCards = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return selectedStoreBinCards;
    return selectedStoreBinCards.filter(card =>
      `${card.medicine_name} ${card.size ?? ''} ${card.sku}`.toLowerCase().includes(query),
    );
  }, [searchText, selectedStoreBinCards]);
  const selectedBinCard = selectedStoreBinCards.find(card => card.bin_card_id === selectedBinCardId);
  const availableIssueCards = selectedStoreBinCards.filter(card => card.current_balance > 0);
  const registeredPricelistIds = useMemo(
    () => new Set(selectedStoreBinCards.map(card => card.pricelist_item_id)),
    [selectedStoreBinCards],
  );
  const unregisteredPricelist = useMemo(
    () => pricelist.filter(item => !registeredPricelistIds.has(item.id)),
    [pricelist, registeredPricelistIds],
  );
  const filteredPricelist = useMemo(() => {
    const query = pricelistSearch.trim().toLowerCase();
    if (!query) return unregisteredPricelist;
    return unregisteredPricelist.filter(item =>
      `${item.name} ${item.size ?? ''} ${item.category ?? ''}`.toLowerCase().includes(query),
    );
  }, [pricelistSearch, unregisteredPricelist]);

  useEffect(() => {
    let cancelled = false;
    const loadPricelist = async () => {
      const pageSize = 500;
      const rows: PricelistItem[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await (supabase as any)
          .from('pricelist')
          .select('id,name,size,category,price,active')
          .eq('active', true)
          .order('name')
          .range(from, from + pageSize - 1);
        if (error) {
          toast.error('Could not load the complete Pricelist', { description: describeStoreError(error) });
          return;
        }
        rows.push(...(data ?? []));
        if (!data || data.length < pageSize) break;
      }
      if (!cancelled) setPricelist(rows);
    };
    void loadPricelist();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const firstCard = selectedStoreBinCards[0];
    setSelectedBinCardId(current => current && selectedStoreBinCards.some(card => card.bin_card_id === current) ? current : firstCard?.bin_card_id ?? '');
    setStockLine(current => ({ ...current, productId: current.productId && selectedStoreBinCards.some(card => card.product_id === current.productId) ? current.productId : '' }));
    setIssueLines(lines => lines.map(line => ({ ...line, productId: line.productId && selectedStoreBinCards.some(card => card.product_id === line.productId) ? line.productId : '' })));
  }, [selectedStoreBinCards]);

  const handleRegister = async () => {
    if (!registrationMedicineId) {
      toast.error('Select a medicine from the Pricelist first.');
      return;
    }
    setSaving(true);
    try {
      await registerBinCard(registrationMedicineId, selectedStoreCode);
      toast.success(`${selectedLocation?.name ?? 'Store'} Bin Card registered`);
      setRegistrationMedicineId('');
    } catch (error: unknown) {
      toast.error('Could not register Bin Card', { description: describeStoreError(error) });
    } finally {
      setSaving(false);
    }
  };

  const handleManualRegister = async () => {
    const name = manualMedicineName.trim();
    const salePrice = Number(manualSalePrice || 0);
    if (!name) {
      toast.error('Enter the medicine or item name.');
      return;
    }
    if (!Number.isFinite(salePrice) || salePrice < 0) {
      toast.error('Selling price must be zero or a positive amount.');
      return;
    }
    setSaving(true);
    try {
      await registerManualBinCard(name, manualCategory.trim() || 'manual', manualSize.trim(), String(salePrice), selectedStoreCode);
      toast.success(`${selectedLocation?.name ?? 'Store'} manual Bin Card registered`, {
        description: 'This item is inventory-only until it is separately added to Pricelist.',
      });
      setManualMedicineName('');
      setManualCategory('manual');
      setManualSize('');
      setManualSalePrice('');
    } catch (error: unknown) {
      toast.error('Could not register manual Bin Card', { description: describeStoreError(error) });
    } finally {
      setSaving(false);
    }
  };

  const handleStock = async () => {
    const quantity = Number(stockLine.quantity);
    const costPrice = Number(stockLine.costPrice);
    if (!stockLine.productId || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(costPrice) || costPrice < 0) {
      toast.error('Select a Bin Card and enter quantity and cost price.');
      return;
    }
    if (stockKind === 'supplier_delivery' && !supplierName.trim()) {
      toast.error('Supplier name is required for a supplier delivery.');
      return;
    }
    setSaving(true);
    try {
      await recordReceipt(stockKind, selectedStoreCode, [{
        product_id: stockLine.productId,
        quantity: stockLine.quantity,
        unit_cost: stockLine.costPrice,
      }], stockKind === 'supplier_delivery' ? supplierName.trim() : undefined);
      toast.success(stockKind === 'opening_count' ? 'Opening Stock recorded' : 'Stock received', {
        description: `${selectedLocation?.name ?? 'Store'} Bin Card balance has been updated.`,
      });
      setStockLine(emptyStockLine());
      setSupplierName('');
    } catch (error: unknown) {
      toast.error('Could not record Stock', { description: describeStoreError(error) });
    } finally {
      setSaving(false);
    }
  };

  const handleIssue = async () => {
    const validLines = issueLines.filter(line => line.productId && Number(line.quantity) > 0);
    if (validLines.length !== issueLines.length || validLines.length === 0) {
      toast.error('Select a Bin Card and enter a positive Pharmacy issue quantity for every line.');
      return;
    }
    const quantities = new Map<string, number>();
    for (const line of validLines) quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + Number(line.quantity));
    for (const [productId, quantity] of quantities) {
      const card = selectedStoreBinCards.find(item => item.product_id === productId);
      if (!card || quantity > card.current_balance) {
        toast.error(`Issue cannot exceed the available balance for ${card?.medicine_name ?? 'the selected medicine'}.`);
        return;
      }
    }
    setSaving(true);
    try {
      await sendToPharmacy(validLines.map(line => ({
        product_id: line.productId,
        quantity: line.quantity,
      })), selectedStoreCode);
      toast.success('Pharmacy issue sent for acceptance', { description: 'Store balance will change only after Pharmacy accepts the transfer.' });
      setIssueLines([emptyIssueLine()]);
    } catch (error: unknown) {
      toast.error('Could not send Pharmacy issue', { description: describeStoreError(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <MainLayout title="Store Management" subtitle="Store 1 and Store 2 Bin Cards with controlled Pharmacy issues">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <PackageCheck className="h-4 w-4 text-primary" />
          <span>Pricelist → Bin Card → Stock / Pharmacy</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh
        </Button>
      </div>

      <section className="mb-5 rounded-xl border bg-card p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div><h2 className="font-semibold">Choose Store Location</h2><p className="text-sm text-muted-foreground">Store 1 and Store 2 maintain separate Bin Cards and balances.</p></div>
          <div className="w-full sm:w-64"><Label>Store</Label><select value={selectedStoreCode} onChange={event => setSelectedStoreCode(event.target.value as StoreLocationCode)} className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="main_store">Store 1</option><option value="store_2">Store 2</option></select></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="Registered Bin Cards" value={String(selectedStoreBinCards.length)} />
          <Metric label="Available Balance" value={selectedStoreBinCards.reduce((total, card) => total + card.current_balance, 0).toLocaleString()} />
          <Metric label="Pending Pharmacy Issues" value="See Pharmacy acceptance queue" />
        </div>
      </section>

      <Tabs defaultValue="bincards" className="space-y-5">
        <TabsList className="h-auto flex flex-wrap justify-start gap-1 bg-muted p-1">
          <TabsTrigger value="bincards">Bin Cards</TabsTrigger>
          <TabsTrigger value="register">Register Bin Card</TabsTrigger>
          <TabsTrigger value="stock">Record Stock</TabsTrigger>
          <TabsTrigger value="pharmacy">Issue to Pharmacy</TabsTrigger>
        </TabsList>

        <TabsContent value="bincards" className="space-y-5">
          <section className="rounded-xl border bg-card p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div><h2 className="font-semibold">{selectedLocation?.name ?? 'Store'} Bin Cards</h2><p className="text-sm text-muted-foreground">Search the registered medicines in this Store, then open a paper-style ledger.</p></div>
              <div className="relative w-full sm:w-72"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={searchText} onChange={event => setSearchText(event.target.value)} placeholder="Search medicine…" /></div>
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[760px] text-sm"><thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="p-3">Medicine</th><th className="p-3">Particulars</th><th className="p-3 text-right">Balance</th><th className="p-3 text-right">Selling price</th><th className="p-3"></th></tr></thead><tbody>
                {filteredBinCards.map(card => <tr key={card.bin_card_id} className="border-t"><td className="p-3 font-medium">{card.medicine_name} <span className="font-normal text-muted-foreground">{card.size ?? ''}</span></td><td className="p-3"><Badge variant="outline">Stock / Pharmacy</Badge></td><td className="p-3 text-right font-semibold">{card.current_balance.toLocaleString()}</td><td className="p-3 text-right text-green-600">{money(card.sale_price)}</td><td className="p-3 text-right"><Button size="sm" variant={selectedBinCardId === card.bin_card_id ? 'default' : 'outline'} onClick={() => setSelectedBinCardId(card.bin_card_id)}><FileText className="mr-2 h-4 w-4" />Open</Button></td></tr>)}
                {!loading && filteredBinCards.length === 0 && <tr><td colSpan={5} className="p-10 text-center text-muted-foreground">No Bin Cards match this Store and search.</td></tr>}
              </tbody></table>
            </div>
          </section>
          {selectedBinCard && <BinCardView productId={selectedBinCard.product_id} locationId={selectedBinCard.location_id} productName={selectedBinCard.medicine_name} unitLabel="" />}
        </TabsContent>

        <TabsContent value="register" className="space-y-5">
          <section className="rounded-xl border bg-card p-5">
            <div className="mb-4 flex items-start gap-3"><FileText className="mt-0.5 h-5 w-5 text-primary" /><div><h2 className="font-semibold">Register a Bin Card in {selectedLocation?.name ?? 'Store'}</h2><p className="text-sm text-muted-foreground">All active Pricelist items are loaded across pages. If an item is not in Pricelist, use the manual registration form below.</p><p className="mt-1 text-xs text-muted-foreground">{pricelist.length.toLocaleString()} active Pricelist items loaded; {unregisteredPricelist.length.toLocaleString()} available for this Store.</p></div></div>
            <div className="grid gap-3 lg:grid-cols-[1fr_220px_auto] lg:items-end"><div><Label>Search active Pricelist items</Label><Input className="mt-2" value={pricelistSearch} onChange={event => setPricelistSearch(event.target.value)} placeholder="Search medicine, size, or category…" /></div><div><Label>Medicine from Pricelist</Label><select value={registrationMedicineId} onChange={event => setRegistrationMedicineId(event.target.value)} className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Select a medicine…</option>{filteredPricelist.map(item => <option key={item.id} value={item.id}>{item.name}{item.size ? ` — ${item.size}` : ''} ({item.category})</option>)}</select></div><Button onClick={() => void handleRegister()} disabled={saving || !registrationMedicineId}><Plus className="mr-2 h-4 w-4" />Register Bin Card</Button></div>
            <div className="my-5 border-t" />
            <div className="mb-3"><h3 className="font-semibold">Register item manually</h3><p className="text-sm text-muted-foreground">Use this for a real store item that is not yet in Pricelist. It will be available for Store receipts, balances, and issues, but it will not be used for patient billing until added to Pricelist.</p></div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4"><div><Label>Medicine / item name</Label><Input className="mt-2" value={manualMedicineName} onChange={event => setManualMedicineName(event.target.value)} placeholder="e.g. Vitamin C syrup" /></div><div><Label>Category</Label><Input className="mt-2" value={manualCategory} onChange={event => setManualCategory(event.target.value)} placeholder="e.g. drug, consumable" /></div><div><Label>Size (optional)</Label><Input className="mt-2" value={manualSize} onChange={event => setManualSize(event.target.value)} placeholder="e.g. 100ml" /></div><div><Label>Selling price (optional)</Label><Input className="mt-2" type="number" min="0" step="0.01" value={manualSalePrice} onChange={event => setManualSalePrice(event.target.value)} placeholder="0" /></div></div>
            <Button className="mt-4" variant="outline" onClick={() => void handleManualRegister()} disabled={saving || !manualMedicineName.trim()}><Plus className="mr-2 h-4 w-4" />Register Manual Bin Card</Button>
          </section>
          <Info text="The same medicine can be registered separately in Store 1 and Store 2. Each registration has its own balance and movement ledger." />
        </TabsContent>

        <TabsContent value="stock" className="space-y-5">
          <section className="rounded-xl border bg-card p-5">
            <div className="mb-4 flex flex-wrap gap-2"><Button variant={stockKind === 'opening_count' ? 'default' : 'outline'} onClick={() => setStockKind('opening_count')}>Opening Stock</Button><Button variant={stockKind === 'supplier_delivery' ? 'default' : 'outline'} onClick={() => setStockKind('supplier_delivery')}>Supplier Delivery</Button></div>
            <div className="mb-5"><h2 className="font-semibold">Record Stock in {selectedLocation?.name ?? 'Store'}</h2><p className="text-sm text-muted-foreground">Particulars will be recorded as <strong>Stock</strong>. Receipts increase the Bin Card Balance automatically.</p></div>
            <div className="grid gap-4 md:grid-cols-3"><div className="space-y-2 md:col-span-2"><Label>Bin Card / Medicine</Label><select value={stockLine.productId} onChange={event => setStockLine(line => ({ ...line, productId: event.target.value }))} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Select a registered Bin Card…</option>{selectedStoreBinCards.map(card => <option key={card.bin_card_id} value={card.product_id}>{card.medicine_name}{card.size ? ` — ${card.size}` : ''} (Balance: {card.current_balance})</option>)}</select></div>{stockKind === 'supplier_delivery' && <div className="space-y-2"><Label>Supplier name</Label><Input value={supplierName} onChange={event => setSupplierName(event.target.value)} placeholder="Supplier" /></div>}</div>
            <div className="mt-4 grid gap-4 md:grid-cols-2"><div className="space-y-2"><Label>Receipts / Quantity</Label><Input type="number" min="0.001" step="0.001" value={stockLine.quantity} onChange={event => setStockLine(line => ({ ...line, quantity: event.target.value }))} placeholder="e.g. 60" /></div><div className="space-y-2"><Label>Cost price per unit (₦)</Label><Input type="number" min="0" step="0.01" value={stockLine.costPrice} onChange={event => setStockLine(line => ({ ...line, costPrice: event.target.value }))} placeholder="Price paid" /></div></div>
            <Button className="mt-5" onClick={() => void handleStock()} disabled={saving || selectedStoreBinCards.length === 0}><PackageCheck className="mr-2 h-4 w-4" />{saving ? 'Saving…' : stockKind === 'opening_count' ? 'Record Opening Stock' : 'Receive Stock'}</Button>
          </section>
        </TabsContent>

        <TabsContent value="pharmacy" className="space-y-5">
          <section className="rounded-xl border bg-card p-5">
            <div className="mb-4 flex items-start gap-3"><ArrowRightLeft className="mt-0.5 h-5 w-5 text-primary" /><div><h2 className="font-semibold">Issue Stock to Pharmacy from {selectedLocation?.name ?? 'Store'}</h2><p className="text-sm text-muted-foreground">Particulars will be recorded as <strong>Pharmacy</strong>. The Store balance stays unchanged until Pharmacy accepts the issue.</p></div></div>
            <div className="space-y-3">{issueLines.map((line, index) => <div key={index} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_220px_auto]"><div className="space-y-1"><Label className="text-xs">Bin Card / Medicine</Label><select value={line.productId} onChange={event => setIssueLines(lines => lines.map((item, itemIndex) => itemIndex === index ? { ...item, productId: event.target.value } : item))} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Select a Bin Card…</option>{availableIssueCards.map(card => <option key={card.bin_card_id} value={card.product_id}>{card.medicine_name}{card.size ? ` — ${card.size}` : ''} (Balance: {card.current_balance})</option>)}</select></div><div className="space-y-1"><Label className="text-xs">Issues / Quantity</Label><Input type="number" min="0.001" step="0.001" value={line.quantity} onChange={event => setIssueLines(lines => lines.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} placeholder="e.g. 10" /></div><div className="flex items-end"><Button variant="ghost" size="icon" onClick={() => setIssueLines(lines => lines.length === 1 ? lines : lines.filter((_, itemIndex) => itemIndex !== index))} title="Remove line"><Trash2 className="h-4 w-4 text-destructive" /></Button></div></div>)}</div>
            <div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" onClick={() => setIssueLines(lines => [...lines, emptyIssueLine()])}><Plus className="mr-2 h-4 w-4" />Add medicine</Button><Button onClick={() => void handleIssue()} disabled={saving || availableIssueCards.length === 0}><ArrowRightLeft className="mr-2 h-4 w-4" />{saving ? 'Sending…' : 'Send to Pharmacy'}</Button></div>
          </section>
          <Info text="Pharmacy will accept the pending issue. At acceptance, the Store Issues ledger entry and Pharmacy Receipts entry are created together. Patient dispensing does not deduct this Pharmacy balance." />
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border bg-card p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>;
}

function Info({ text }: { text: string }) {
  return <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground"><span>{text}</span></div>;
}
