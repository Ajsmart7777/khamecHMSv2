import { useEffect, useMemo, useState } from 'react';
import { useSnapOrders, SnapOrder, snapPhotoUrl, saveSnapOcr, attachInvoiceToSnap, rejectSnap, MatchedItem } from '@/hooks/useSnapOrders';
import { fuzzyMatchPricelist, PricelistItem } from '@/hooks/usePricelist';
import { usePatients } from '@/contexts/PatientContext';
import { useInvoices } from '@/hooks/useInvoices';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Camera, ScanText, Plus, Trash2, Send, XCircle, Loader2, Check, Pencil, SkipForward } from 'lucide-react';
import Tesseract from 'tesseract.js';

type ReviewStatus = 'pending' | 'approved' | 'skipped';
interface ReviewLine {
  query: string;
  ocrConfidence: number; // 0..1 from tesseract for that line
  matches: PricelistItem[];
  chosenId?: string;
  qty: number;
  status: ReviewStatus;
  editing?: boolean;
  manualQuery?: string;
}

const confBand = (c: number) =>
  c >= 0.85 ? { label: 'High', cls: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30' }
  : c >= 0.6 ? { label: 'Med',  cls: 'bg-amber-500/15 text-amber-700 border-amber-500/30' }
  :            { label: 'Low',  cls: 'bg-red-500/15 text-red-700 border-red-500/30' };

const fmt = (n: number) => `₦${n.toLocaleString()}`;

export function BillingSnapInbox() {
  const { orders, loading, refresh } = useSnapOrders({ statuses: ['pending_billing', 'awaiting_payment'] });
  const { patients } = usePatients();
  const [selected, setSelected] = useState<SnapOrder | null>(null);

  const patientById = useMemo(() => {
    const m = new Map<string, string>();
    patients.forEach(p => m.set(p.id, `${p.first_name} ${p.last_name}`));
    return m;
  }, [patients]);

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Camera className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Incoming Snaps</h3>
          <Badge variant="outline" className="text-[10px]">{orders.length}</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={refresh}>Refresh</Button>
      </div>

      {loading && orders.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
      ) : orders.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No snaps waiting.</p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {orders.map(o => (
            <button
              key={o.id}
              onClick={() => setSelected(o)}
              className="w-full text-left p-3 rounded-lg border hover:border-primary transition-colors flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {patientById.get(o.patient_id) ?? 'Unknown patient'}
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="capitalize">{o.order_type}</span> → <span className="capitalize">{o.target_station}</span>
                  {o.note && <> · {o.note}</>}
                </p>
              </div>
              <Badge
                variant={o.status === 'awaiting_payment' ? 'warning' : 'secondary'}
                className="text-[10px] capitalize"
              >
                {o.status.replace('_', ' ')}
              </Badge>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <SnapReviewDialog
          snap={selected}
          onClose={() => setSelected(null)}
          patientName={patientById.get(selected.patient_id) ?? 'Unknown'}
        />
      )}
    </div>
  );
}

function SnapReviewDialog({ snap, onClose, patientName }: {
  snap: SnapOrder;
  onClose: () => void;
  patientName: string;
}) {
  const { createInvoice } = useInvoices();
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState(snap.ocr_text ?? '');
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [lines, setLines] = useState<ReviewLine[]>([]);
  const [items, setItems] = useState<MatchedItem[]>(snap.matched_items ?? []);
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [manualMatches, setManualMatches] = useState<PricelistItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    snapPhotoUrl(snap.photo_path).then(url => { if (!cancelled) setImgUrl(url); });
    return () => { cancelled = true; };
  }, [snap.photo_path]);

  const doManualSearch = async () => {
    const m = await fuzzyMatchPricelist(manualQuery, 6);
    setManualMatches(m);
    if (m.length === 0) toast.error('No matches — add via Pricelist Manager');
  };
  const addManual = (it: PricelistItem) => {
    setItems(prev => [...prev, {
      pricelist_id: it.id, name: it.name, size: it.size, category: it.category, unit_price: it.price, qty: 1,
    }]);
    setManualQuery('');
    setManualMatches([]);
  };

  const runOcr = async () => {
    if (!imgUrl) return;
    setOcrRunning(true);
    setOcrProgress(0);
    try {
      const { data } = await Tesseract.recognize(imgUrl, 'eng', {
        logger: (m) => { if (m.status === 'recognizing text') setOcrProgress(Math.round(m.progress * 100)); },
      });
      const text = data.text ?? '';
      setOcrText(text);
      const overallConf = (data.confidence ?? 0) / 100;

      // Prefer per-line confidence from tesseract when available
      const rawLines: { text: string; conf: number }[] = Array.isArray((data as any).lines) && (data as any).lines.length
        ? (data as any).lines.map((l: any) => ({ text: (l.text ?? '').trim(), conf: (l.confidence ?? 0) / 100 }))
        : text.split(/\r?\n/).map((t: string) => ({ text: t.trim(), conf: overallConf }));

      const candidates = rawLines.filter(l => l.text.length >= 3 && /[a-zA-Z]/.test(l.text)).slice(0, 25);
      const scanned: ReviewLine[] = [];
      for (const c of candidates) {
        const m = await fuzzyMatchPricelist(c.text, 5);
        if (m.length === 0) continue;
        scanned.push({
          query: c.text,
          ocrConfidence: c.conf,
          matches: m,
          chosenId: m[0].id,
          qty: 1,
          status: 'pending',
        });
      }
      setLines(scanned);
      setItems([]); // reset — force review of freshly-extracted lines
      await saveSnapOcr(snap.id, text, overallConf, []);
      toast.success(`OCR done · ${scanned.length} lines to review`);
    } catch (e: any) {
      toast.error('OCR failed: ' + (e.message ?? e));
    } finally {
      setOcrRunning(false);
    }
  };

  const updateLine = (idx: number, patch: Partial<ReviewLine>) =>
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));

  const approveLine = (idx: number) => {
    const line = lines[idx];
    const it = line.matches.find(m => m.id === line.chosenId) ?? line.matches[0];
    if (!it) { toast.error('Pick a match first'); return; }
    setItems(prev => [...prev, {
      pricelist_id: it.id, name: it.name, size: it.size, category: it.category,
      unit_price: it.price, qty: Math.max(1, line.qty || 1),
    }]);
    updateLine(idx, { status: 'approved' });
  };

  const skipLine = (idx: number) => updateLine(idx, { status: 'skipped' });

  const searchInLine = async (idx: number) => {
    const q = (lines[idx].manualQuery ?? '').trim();
    if (!q) return;
    const m = await fuzzyMatchPricelist(q, 6);
    if (m.length === 0) { toast.error('No matches'); return; }
    updateLine(idx, { matches: m, chosenId: m[0].id });
  };


  const setQty = (idx: number, qty: number) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, qty: Math.max(1, qty) } : it));

  const removeItem = (idx: number) =>
    setItems(prev => prev.filter((_, i) => i !== idx));

  const total = items.reduce((s, i) => s + i.unit_price * i.qty, 0);

  const [manualQuery, setManualQuery] = useState('');
  const [manualMatches, setManualMatches] = useState<PricelistItem[]>([]);
  const doManualSearch = async () => {
    const m = await fuzzyMatchPricelist(manualQuery, 6);
    setManualMatches(m);
    if (m.length === 0) toast.error('No matches — add via Pricelist Manager');
  };
  const addManual = (it: PricelistItem) => {
    setItems(prev => [...prev, {
      pricelist_id: it.id, name: it.name, size: it.size, category: it.category, unit_price: it.price, qty: 1,
    }]);
    setManualQuery('');
    setManualMatches([]);
  };

  const createInvoiceAndSend = async () => {
    if (items.length === 0) { toast.error('Add at least one item'); return; }
    setBusy(true);
    try {
      const invoice = await createInvoice(
        snap.patient_id,
        items.map(it => ({
          description: `${it.name}${it.size ? ' ' + it.size : ''}`,
          quantity: it.qty,
          unitPrice: it.unit_price,
          category: it.category,
        })),
        `From snap ${snap.id.slice(0, 8)} · ${snap.order_type} → ${snap.target_station}`,
      );
      if (!invoice) throw new Error('Invoice creation failed');
      await saveSnapOcr(snap.id, ocrText, snap.ocr_confidence ?? 0, items);
      const ok = await attachInvoiceToSnap(snap.id, invoice.id);
      if (!ok) throw new Error('Could not link invoice');
      toast.success('Invoice created · waiting for cashier payment');
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const doReject = async () => {
    if (!rejectReason.trim()) return;
    setBusy(true);
    const ok = await rejectSnap(snap.id, rejectReason.trim());
    setBusy(false);
    if (ok) { toast.success('Snap rejected'); onClose(); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Snap Review · {patientName} · <span className="capitalize text-primary">{snap.order_type}</span> → <span className="capitalize">{snap.target_station}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-4">
          {/* Left: Photo + OCR */}
          <div className="space-y-3">
            <div className="rounded-lg overflow-hidden bg-muted flex items-center justify-center min-h-[240px]">
              {imgUrl
                ? <img src={imgUrl} alt="snap" className="max-h-[400px] object-contain" />
                : <p className="text-xs text-muted-foreground p-4">Loading image…</p>}
            </div>

            <div className="flex gap-2">
              <Button onClick={runOcr} disabled={ocrRunning || !imgUrl} size="sm">
                {ocrRunning
                  ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> OCR {ocrProgress}%</>
                  : <><ScanText className="h-4 w-4 mr-1.5" /> Run OCR</>}
              </Button>
            </div>

            {ocrText && (
              <Textarea
                value={ocrText}
                onChange={(e) => setOcrText(e.target.value)}
                rows={5}
                className="text-xs font-mono"
                placeholder="OCR text will appear here"
              />
            )}

            {lines.length > 0 && (
              <div className="space-y-2 border rounded-lg p-2 max-h-64 overflow-y-auto">
                <p className="text-xs font-medium">OCR Candidates — pick the correct pricelist match:</p>
                {lines.map((line, idx) => (
                  <div key={idx} className="text-xs space-y-1 pb-2 border-b last:border-0">
                    <p className="font-mono text-muted-foreground truncate">{line.query}</p>
                    <div className="flex flex-wrap gap-1">
                      {line.matches.map(m => (
                        <button
                          key={m.id}
                          onClick={() => addFromLine(idx, m.id)}
                          className="px-2 py-1 rounded border hover:bg-primary/10 text-[11px]"
                        >
                          {m.name}{m.size ? ` ${m.size}` : ''} · {fmt(m.price)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Invoice items */}
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Search pricelist manually…"
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doManualSearch()}
              />
              <Button size="sm" onClick={doManualSearch}>Search</Button>
            </div>

            {manualMatches.length > 0 && (
              <div className="border rounded-lg p-2 space-y-1 max-h-40 overflow-y-auto">
                {manualMatches.map(m => (
                  <button
                    key={m.id}
                    onClick={() => addManual(m)}
                    className="w-full text-left text-xs px-2 py-1 rounded hover:bg-primary/10 flex items-center justify-between"
                  >
                    <span>{m.name}{m.size ? ` (${m.size})` : ''}</span>
                    <span className="font-mono">{fmt(m.price)}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="border rounded-lg">
              <div className="p-2 text-xs font-medium border-b flex items-center justify-between">
                <span>Invoice Items</span>
                <span className="text-muted-foreground">{items.length} line{items.length === 1 ? '' : 's'}</span>
              </div>
              <div className="divide-y">
                {items.length === 0 && (
                  <p className="p-3 text-xs text-muted-foreground text-center">
                    Run OCR or search manually to add items.
                  </p>
                )}
                {items.map((it, idx) => (
                  <div key={idx} className="p-2 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{it.name}{it.size ? ` ${it.size}` : ''}</p>
                      <p className="text-[10px] text-muted-foreground">{it.category} · {fmt(it.unit_price)}/unit</p>
                    </div>
                    <Input
                      type="number"
                      min={1}
                      value={it.qty}
                      onChange={(e) => setQty(idx, parseInt(e.target.value) || 1)}
                      className="w-16 h-8 text-xs"
                    />
                    <span className="text-xs font-mono w-20 text-right">{fmt(it.unit_price * it.qty)}</span>
                    <Button size="sm" variant="ghost" onClick={() => removeItem(idx)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="p-2 border-t flex items-center justify-between">
                <span className="text-sm font-medium">Total</span>
                <span className="text-lg font-mono font-bold">{fmt(total)}</span>
              </div>
            </div>

            {showReject && (
              <div className="space-y-2 border rounded-lg p-2">
                <Input
                  placeholder="Reason for rejection…"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" onClick={doReject} disabled={busy}>Confirm Reject</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowReject(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => setShowReject(true)} disabled={busy || showReject}>
            <XCircle className="h-4 w-4 mr-2 text-destructive" /> Reject
          </Button>
          <Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>
          <Button onClick={createInvoiceAndSend} disabled={busy || items.length === 0 || snap.status !== 'pending_billing'}>
            <Send className="h-4 w-4 mr-2" />
            {snap.status === 'awaiting_payment' ? 'Awaiting Payment' : busy ? 'Creating…' : 'Create Invoice → Send to Cashier'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
