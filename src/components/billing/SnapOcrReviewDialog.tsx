import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Check, X, Pencil, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { MatchedItem } from '@/hooks/useSnapOrders';

interface Candidate {
  id: string;
  source: 'pricelist' | 'inventory';
  name: string;
  size: string | null;
  category: string;
  price: number;
  score: number;
}
interface OcrMatch {
  query: string;
  type: string | null;
  qty: number;
  candidates: Candidate[];
}
type Decision = 'pending' | 'accepted' | 'rejected';
interface ReviewRow {
  query: string;
  type: string | null;
  qty: number;
  candidates: Candidate[];
  decision: Decision;
  selectedId: string | null;
  customName: string;
  customPrice: string;
}

export interface ReviewedLine {
  query: string;
  type: string | null;
  qty: number;
  decision: Decision;
  accepted?: MatchedItem | null;
  reason?: string;
}

export function SnapOcrReviewDialog({
  snapId,
  open,
  onOpenChange,
  onAcceptItems,
}: {
  snapId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAcceptItems: (items: MatchedItem[]) => void;
}) {
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [confidence, setConfidence] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    supabase
      .from('snap_orders')
      .select('ocr_confidence, ocr_matches, ocr_reviewed_lines')
      .eq('id', snapId)
      .single<any>()
      .then(({ data }) => {
        setLoading(false);
        if (!data) return;
        setConfidence(Number(data.ocr_confidence ?? 0));
        const prior: ReviewedLine[] | null = Array.isArray(data.ocr_reviewed_lines) ? data.ocr_reviewed_lines : null;
        const matches: OcrMatch[] = Array.isArray(data.ocr_matches) ? data.ocr_matches : [];
        setRows(
          matches.map((m, idx) => {
            const p = prior?.[idx];
            const acc = p?.accepted ?? null;
            const matched = acc ? m.candidates.find(c => c.id === acc.pricelist_id) : undefined;
            return {
              query: m.query,
              type: m.type ?? null,
              qty: p?.qty ?? m.qty ?? 1,
              candidates: m.candidates ?? [],
              decision: (p?.decision ?? 'pending') as Decision,
              selectedId: matched?.id ?? (m.candidates[0]?.id ?? null),
              customName: acc && !matched ? acc.name : '',
              customPrice: acc && !matched ? String(acc.unit_price ?? '') : '',
            };
          }),
        );
      });
  }, [open, snapId]);

  const stats = useMemo(() => {
    const a = rows.filter(r => r.decision === 'accepted').length;
    return { accepted: a, pending: rows.length - a };
  }, [rows]);

  const update = (i: number, patch: Partial<ReviewRow>) =>
    setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const buildAccepted = (r: ReviewRow): MatchedItem | null => {
    const cand = r.candidates.find(c => c.id === r.selectedId);
    if (cand) {
      return {
        pricelist_id: cand.id,
        name: cand.name,
        size: cand.size,
        category: cand.category,
        unit_price: cand.price,
        qty: Math.max(1, r.qty || 1),
      };
    }
    // Custom override
    const price = Number(r.customPrice);
    if (r.customName.trim() && Number.isFinite(price) && price >= 0) {
      return {
        pricelist_id: '',
        name: r.customName.trim(),
        size: null,
        category: 'custom',
        unit_price: price,
        qty: Math.max(1, r.qty || 1),
      };
    }
    return null;
  };

  const save = async () => {
    const reviewed: ReviewedLine[] = [];
    const accepted: MatchedItem[] = [];
    for (const r of rows) {
      let item: MatchedItem | null = null;
      if (r.decision === 'accepted') {
        item = buildAccepted(r);
        if (!item) {
          toast.error(`Accepted line "${r.query}" needs a match or a custom name & price`);
          return;
        }
        accepted.push(item);
      }
      reviewed.push({
        query: r.query,
        type: r.type,
        qty: r.qty,
        decision: r.decision,
        accepted: item,
      });
    }

    setSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('snap_orders')
      .update({
        ocr_reviewed_lines: reviewed as any,
        ocr_reviewed_at: new Date().toISOString(),
        ocr_reviewed_by: auth.user?.id ?? null,
      } as any)
      .eq('id', snapId);
    setSaving(false);

    if (error) {
      toast.error('Failed to save review', { description: error.message });
      return;
    }
    if (accepted.length) onAcceptItems(accepted);
    toast.success(`Review saved · ${stats.accepted} accepted`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Review OCR Extractions
          </DialogTitle>
          <DialogDescription>
            Accept or edit each extracted line before it's added to the invoice.
            {confidence > 0 && <span className="ml-2 text-xs">Overall confidence {Math.round(confidence * 100)}%</span>}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading extractions…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No OCR lines to review.</p>
        ) : (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {rows.map((r, i) => {
              const custom = r.selectedId === null || r.selectedId === '';
              return (
                <div key={i} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <Badge variant="outline" className="text-[10px] uppercase shrink-0">{r.type ?? 'item'}</Badge>
                    <Input
                      className="h-8 text-sm flex-1"
                      value={r.query}
                      onChange={(e) => update(i, { query: e.target.value })}
                    />
                    <Input
                      className="h-8 w-16 text-sm"
                      type="number"
                      min={1}
                      value={r.qty}
                      onChange={(e) => update(i, { qty: parseInt(e.target.value) || 1 })}
                    />
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {r.candidates.map(c => (
                      <button
                        key={c.id}
                        onClick={() => update(i, { selectedId: c.id })}
                        className={`px-2 py-1 rounded border text-[11px] flex items-center gap-1 ${
                          r.selectedId === c.id
                            ? 'border-primary bg-primary/10 font-medium'
                            : 'hover:border-primary/40'
                        }`}
                        title={`${c.source} · score ${c.score?.toFixed?.(2) ?? c.score}`}
                      >
                        {c.name}{c.size ? ` ${c.size}` : ''} · ₦{c.price.toLocaleString()}
                      </button>
                    ))}
                    <button
                      onClick={() => update(i, { selectedId: '' })}
                      className={`px-2 py-1 rounded border text-[11px] flex items-center gap-1 ${
                        custom ? 'border-primary bg-primary/10 font-medium' : 'hover:border-primary/40'
                      }`}
                    >
                      <Pencil className="h-3 w-3" /> Custom
                    </button>
                  </div>

                  {custom && (
                    <div className="flex gap-2">
                      <Input
                        className="h-8 text-sm flex-1"
                        placeholder="Item name"
                        value={r.customName}
                        onChange={(e) => update(i, { customName: e.target.value })}
                      />
                      <Input
                        className="h-8 w-28 text-sm"
                        type="number"
                        placeholder="Unit ₦"
                        value={r.customPrice}
                        onChange={(e) => update(i, { customPrice: e.target.value })}
                      />
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      size="sm"
                      variant={r.decision === 'accepted' ? 'default' : 'outline'}
                      onClick={() => update(i, { decision: r.decision === 'accepted' ? 'pending' : 'accepted' })}
                    >
                      <Check className="h-3.5 w-3.5 mr-1" /> Accept
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="items-center">
          <div className="text-xs text-muted-foreground mr-auto">
            {stats.accepted} accepted · {stats.pending} pending
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save review'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}