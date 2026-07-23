import { useMemo, useState } from 'react';
import { usePricelist, PricelistItem } from '@/hooks/usePricelist';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AlertTriangle, CheckCircle2, FileSearch, Download } from 'lucide-react';

const fmt = (n: number | null | undefined) =>
  n == null || Number.isNaN(n) ? '—' : `₦${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/** Try to parse pack cost + pack size hints out of the item's notes field. */
function parsePackHint(notes: string | null): { packCost: number | null; packQty: number | null; raw: string | null } {
  if (!notes) return { packCost: null, packQty: null, raw: null };
  const raw = notes.trim();
  // Match things like "pack of 30 @ ₦3000", "pack 30 = 3000", "30s ₦3,000"
  const qtyMatch = raw.match(/pack(?:\s*of)?\s*(\d+)/i) || raw.match(/\b(\d+)\s*(?:s|pcs|tabs?|caps?)\b/i);
  const costMatch = raw.match(/[₦N]?\s*([\d,]+(?:\.\d+)?)\s*(?:\/pack|per pack|pack)?/i);
  const packQty = qtyMatch ? parseInt(qtyMatch[1], 10) : null;
  const packCost = costMatch ? parseFloat(costMatch[1].replace(/,/g, '')) : null;
  return { packCost, packQty, raw };
}

type Row = {
  item: PricelistItem;
  packCost: number | null;
  expectedUnit: number | null;
  drift: number | null;      // absolute Naira drift vs. stored price
  issues: string[];
};

function analyze(items: PricelistItem[]): Row[] {
  return items.map((item) => {
    const issues: string[] = [];
    const { packCost, packQty } = parsePackHint(item.notes);

    if (!item.pack_qty || item.pack_qty < 1) issues.push('Missing pack size');
    if (item.price == null || item.price <= 0) issues.push('Missing / zero price');
    if (packCost == null) issues.push('No pack cost recorded in notes');
    if (packQty != null && item.pack_qty && packQty !== item.pack_qty) {
      issues.push(`Pack size mismatch (notes: ${packQty}, stored: ${item.pack_qty})`);
    }

    const qtyForCalc = item.pack_qty && item.pack_qty > 0 ? item.pack_qty : packQty;
    const expectedUnit = packCost != null && qtyForCalc ? packCost / qtyForCalc : null;
    const drift = expectedUnit != null && item.price != null ? Math.abs(expectedUnit - item.price) : null;
    if (drift != null && drift > 0.5) {
      issues.push(`Unit price drift: expected ${fmt(expectedUnit)}, stored ${fmt(item.price)}`);
    }

    return { item, packCost, expectedUnit, drift, issues };
  });
}

function toCsv(rows: Row[]): string {
  const header = ['Name', 'Category', 'Pack Qty', 'Pack Cost (notes)', 'Expected Unit', 'Stored Unit', 'Drift', 'Issues'];
  const body = rows.map(r => [
    r.item.name,
    r.item.category,
    r.item.pack_qty ?? '',
    r.packCost ?? '',
    r.expectedUnit != null ? r.expectedUnit.toFixed(2) : '',
    r.item.price ?? '',
    r.drift != null ? r.drift.toFixed(2) : '',
    r.issues.join('; '),
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  return [header.join(','), ...body].join('\n');
}

export function PricelistValidationReport() {
  const { items, loading } = usePricelist();
  const [open, setOpen] = useState(false);

  const rows = useMemo(() => analyze(items), [items]);
  const flagged = rows.filter(r => r.issues.length > 0);
  const clean = rows.length - flagged.length;

  const download = () => {
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pricelist-validation-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderTable = (data: Row[]) => (
    <div className="rounded-lg border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead className="text-right">Pack Qty</TableHead>
            <TableHead className="text-right">Pack Cost</TableHead>
            <TableHead>Unit-price calculation</TableHead>
            <TableHead className="text-right">Stored</TableHead>
            <TableHead>Issues</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map(r => (
            <TableRow key={r.item.id}>
              <TableCell>
                <div className="font-medium">{r.item.name}</div>
                <div className="text-[10px] text-muted-foreground uppercase">{r.item.category}</div>
              </TableCell>
              <TableCell className="text-right font-mono">{r.item.pack_qty ?? '—'}</TableCell>
              <TableCell className="text-right font-mono">{fmt(r.packCost)}</TableCell>
              <TableCell className="font-mono text-xs">
                {r.packCost != null && r.item.pack_qty
                  ? <>{fmt(r.packCost)} ÷ {r.item.pack_qty} = <span className="font-semibold">{fmt(r.expectedUnit)}</span></>
                  : <span className="text-muted-foreground">insufficient data</span>}
              </TableCell>
              <TableCell className="text-right font-mono">{fmt(r.item.price)}</TableCell>
              <TableCell>
                {r.issues.length === 0
                  ? <Badge variant="success" className="text-[10px]">OK</Badge>
                  : (
                    <ul className="text-xs list-disc list-inside space-y-0.5">
                      {r.issues.map((i, idx) => <li key={idx} className="text-destructive">{i}</li>)}
                    </ul>
                  )}
              </TableCell>
            </TableRow>
          ))}
          {data.length === 0 && (
            <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nothing to show</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileSearch className="h-4 w-4 mr-1.5" />
          Validation Report
          {flagged.length > 0 && (
            <Badge variant="destructive" className="ml-2 text-[10px]">{flagged.length}</Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSearch className="h-5 w-5" /> Pricelist Import Validation
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Total items</div>
            <div className="text-2xl font-semibold">{loading ? '…' : rows.length}</div>
          </div>
          <div className="rounded-lg border p-3 border-destructive/30 bg-destructive/5">
            <div className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Flagged</div>
            <div className="text-2xl font-semibold text-destructive">{flagged.length}</div>
          </div>
          <div className="rounded-lg border p-3 border-emerald-500/30 bg-emerald-500/5">
            <div className="text-xs text-emerald-700 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Clean</div>
            <div className="text-2xl font-semibold text-emerald-700">{clean}</div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={download}>
            <Download className="h-4 w-4 mr-1.5" /> Download CSV
          </Button>
        </div>

        <Tabs defaultValue="flagged">
          <TabsList>
            <TabsTrigger value="flagged">Flagged ({flagged.length})</TabsTrigger>
            <TabsTrigger value="all">All items ({rows.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="flagged" className="mt-3">{renderTable(flagged)}</TabsContent>
          <TabsContent value="all" className="mt-3">{renderTable(rows)}</TabsContent>
        </Tabs>

        <p className="text-xs text-muted-foreground">
          Unit-price rule: <span className="font-mono">pack_cost ÷ pack_qty</span>. Pack cost is parsed from each
          item's notes field (e.g. <span className="font-mono">"Pack of 30 @ ₦3000"</span> → ₦100/unit).
          Items are flagged if pack size or pack cost is missing, if pack size disagrees with notes,
          or if the stored unit price drifts more than ₦0.50 from the calculated value.
        </p>
      </DialogContent>
    </Dialog>
  );
}