import { useMemo, useRef, useState } from 'react';
import { usePricelist, PricelistItem, PricelistCategory } from '@/hooks/usePricelist';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Pencil, Trash2, Search, Upload, Download } from 'lucide-react';
import { toast } from 'sonner';
import { PricelistValidationReport } from './PricelistValidationReport';
import { supabase } from '@/integrations/supabase/client';

const CATEGORIES: { value: PricelistCategory; label: string }[] = [
  { value: 'drug_tablet', label: 'Drug — Tablet' },
  { value: 'drug_capsule', label: 'Drug — Capsule' },
  { value: 'drug_liquid', label: 'Drug — Liquid' },
  { value: 'drug_injection', label: 'Drug — Injection' },
  { value: 'drug_topical', label: 'Drug — Topical' },
  { value: 'consumable', label: 'Consumable' },
  { value: 'lab', label: 'Lab Test' },
  { value: 'imaging', label: 'Imaging' },
  { value: 'bed', label: 'Bed / Admission' },
  { value: 'procedure', label: 'Procedure' },
  { value: 'other', label: 'Other' },
];

const fmt = (n: number) => `₦${n.toLocaleString()}`;
const fmtUnit = (n: number) =>
  `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const VALID_CATS: PricelistCategory[] = [
  'drug_tablet','drug_capsule','drug_liquid','drug_injection','drug_topical',
  'consumable','lab','imaging','bed','procedure','other',
];

function toCsv(items: PricelistItem[]): string {
  const header = ['name','size','pack_qty','price','category','active','notes'];
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = items.map(i => [i.name, i.size ?? '', i.pack_qty, i.price, i.category, i.active, i.notes ?? ''].map(esc).join(','));
  return [header.join(','), ...rows].join('\n');
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (cur !== '' || row.length) { row.push(cur); rows.push(row); row = []; cur = ''; }
        if (c === '\r' && text[i + 1] === '\n') i++;
      } else cur += c;
    }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

export function PricelistManager() {
  const { items, loading, upsertItem, deleteItem } = usePricelist();
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [editing, setEditing] = useState<PricelistItem | null>(null);
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(i =>
      (categoryFilter === 'all' || i.category === categoryFilter) &&
      (q.length === 0 || i.name.toLowerCase().includes(q) || (i.size ?? '').toLowerCase().includes(q))
    );
  }, [items, query, categoryFilter]);

  const openNew = () => { setEditing(null); setOpen(true); };
  const openEdit = (it: PricelistItem) => { setEditing(it); setOpen(true); };

  const handleDownload = () => {
    const csv = toCsv(items);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pricelist-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${items.length} items`);
  };

  const handleUpload = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length < 2) { toast.error('CSV is empty'); return; }
      const header = rows[0].map(h => h.trim().toLowerCase());
      const idx = (k: string) => header.indexOf(k);
      const iName = idx('name'), iSize = idx('size'), iPack = idx('pack_qty'),
            iPrice = idx('price'), iCat = idx('category'), iActive = idx('active'), iNotes = idx('notes');
      if (iName < 0 || iPrice < 0 || iCat < 0) {
        toast.error('CSV must include name, price, category columns');
        return;
      }
      const payload = rows.slice(1).map(r => {
        const cat = (r[iCat] || '').trim() as PricelistCategory;
        return {
          name: (r[iName] || '').trim(),
          size: iSize >= 0 ? (r[iSize] || '').trim() || null : null,
          pack_qty: iPack >= 0 ? parseInt(r[iPack]) || 1 : 1,
          price: parseFloat(r[iPrice]) || 0,
          category: VALID_CATS.includes(cat) ? cat : 'other' as PricelistCategory,
          active: iActive >= 0 ? !/^(false|0|no)$/i.test((r[iActive] || '').trim()) : true,
          notes: iNotes >= 0 ? (r[iNotes] || '').trim() || null : null,
        };
      }).filter(r => r.name && r.price >= 0);

      if (payload.length === 0) { toast.error('No valid rows found'); return; }

      // Match existing items by lower(name)+lower(size) to update in place, insert the rest.
      const key = (n: string, s: string | null) => `${n.toLowerCase()}||${(s ?? '').toLowerCase()}`;
      const existingMap = new Map(items.map(i => [key(i.name, i.size), i.id]));
      const toInsert = payload.filter(r => !existingMap.has(key(r.name, r.size)));
      const toUpdate = payload
        .map(r => ({ id: existingMap.get(key(r.name, r.size)), ...r }))
        .filter(r => r.id) as Array<typeof payload[number] & { id: string }>;

      let inserted = 0, updated = 0, failed = 0;
      if (toInsert.length) {
        const { error, count } = await supabase.from('pricelist').insert(toInsert, { count: 'exact' });
        if (error) failed += toInsert.length; else inserted = count ?? toInsert.length;
      }
      for (const row of toUpdate) {
        const { id, ...rest } = row;
        const { error } = await supabase.from('pricelist').update(rest).eq('id', id);
        if (error) failed++; else updated++;
      }
      toast.success(`Import complete — ${inserted} added, ${updated} updated${failed ? `, ${failed} failed` : ''}`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Import failed');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name or size…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-1.5" /> Add Item</Button>
        <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importing}>
          <Upload className="h-4 w-4 mr-1.5" /> {importing ? 'Importing…' : 'Upload CSV'}
        </Button>
        <Button variant="outline" onClick={handleDownload} disabled={items.length === 0}>
          <Download className="h-4 w-4 mr-1.5" /> Download CSV
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
        />
        <PricelistValidationReport />
      </div>

      <div className="text-xs text-muted-foreground">
        {loading ? 'Loading…' : `${filtered.length} of ${items.length} items`}
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Size</TableHead>
              <TableHead className="text-right">Pack Qty</TableHead>
              <TableHead className="text-right">Pack Price</TableHead>
              <TableHead className="text-right">Unit Price</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(it => (
              <TableRow key={it.id}>
                <TableCell className="font-medium">{it.name}</TableCell>
                <TableCell className="text-muted-foreground">{it.size ?? '—'}</TableCell>
                <TableCell className="text-right">{it.pack_qty}</TableCell>
                <TableCell className="text-right font-mono">{fmt(it.price)}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">
                  {fmtUnit(it.price / Math.max(1, it.pack_qty))}
                </TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{it.category}</Badge></TableCell>
                <TableCell>
                  {it.active
                    ? <Badge variant="success" className="text-[10px]">Active</Badge>
                    : <Badge variant="secondary" className="text-[10px]">Inactive</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(it)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (confirm(`Delete "${it.name}"?`)) await deleteItem(it.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No items</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <PricelistEditor
        open={open}
        onOpenChange={setOpen}
        item={editing}
        onSave={async (row) => {
          const ok = await upsertItem(row);
          if (ok) setOpen(false);
        }}
      />
    </div>
  );
}

function PricelistEditor({
  open, onOpenChange, item, onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  item: PricelistItem | null;
  onSave: (row: Partial<PricelistItem> & { name: string; price: number; category: PricelistCategory }) => Promise<void>;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [size, setSize] = useState(item?.size ?? '');
  const [packQty, setPackQty] = useState(item?.pack_qty ?? 1);
  const [price, setPrice] = useState(item?.price ?? 0);
  const [category, setCategory] = useState<PricelistCategory>(item?.category ?? 'drug_tablet');
  const [active, setActive] = useState(item?.active ?? true);
  const [notes, setNotes] = useState(item?.notes ?? '');

  // Reset form on open
  useMemo(() => {
    if (open) {
      setName(item?.name ?? '');
      setSize(item?.size ?? '');
      setPackQty(item?.pack_qty ?? 1);
      setPrice(item?.price ?? 0);
      setCategory(item?.category ?? 'drug_tablet');
      setActive(item?.active ?? true);
      setNotes(item?.notes ?? '');
    }
  }, [open, item]);

  const submit = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (price < 0) { toast.error('Price must be ≥ 0'); return; }
    await onSave({
      id: item?.id, name, size, pack_qty: packQty, price, category, active, notes,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? 'Edit Item' : 'Add Item'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Paracetamol 500mg" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Size / Strength</Label>
              <Input value={size} onChange={(e) => setSize(e.target.value)} placeholder="500MG, 100ML…" />
            </div>
            <div className="space-y-1.5">
              <Label>Pack Qty</Label>
              <Input type="number" min={1} value={packQty} onChange={(e) => setPackQty(parseInt(e.target.value) || 1)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Price (₦) *</Label>
              <Input type="number" min={0} step="0.01" value={price}
                onChange={(e) => setPrice(parseFloat(e.target.value) || 0)} />
            </div>
            <div className="space-y-1.5">
              <Label>Category *</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as PricelistCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active (visible in pricing search)
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit}>{item ? 'Save Changes' : 'Add Item'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
