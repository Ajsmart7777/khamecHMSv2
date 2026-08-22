import { useEffect, useState } from 'react';
import { createRealtimeChannel, supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles, Plus, RefreshCw, ClipboardCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { MatchedItem } from '@/hooks/useSnapOrders';
import { SnapOcrReviewDialog } from './SnapOcrReviewDialog';

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

export function SnapOcrPanel({
  snapId,
  onAddItem,
}: {
  snapId: string;
  onAddItem: (item: MatchedItem) => void;
}) {
  const [status, setStatus] = useState<string>('pending');
  const [text, setText] = useState<string>('');
  const [confidence, setConfidence] = useState<number>(0);
  const [matches, setMatches] = useState<OcrMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  const load = async () => {
    const { data, error: queryError } = await supabase
      .from('snap_orders')
      .select('ocr_status, ocr_text, ocr_confidence, ocr_matches, ocr_error, ocr_reviewed_at')
      .eq('id', snapId)
      .single<any>();
    if (queryError) {
      setError(queryError.message);
      return;
    }
    if (!data) return;
    setStatus(data.ocr_status ?? 'pending');
    setText(data.ocr_text ?? '');
    setConfidence(Number(data.ocr_confidence ?? 0));
    setMatches(Array.isArray(data.ocr_matches) ? (data.ocr_matches as OcrMatch[]) : []);
    setError(data.ocr_error ?? null);
    setReviewed(!!data.ocr_reviewed_at);
  };

  useEffect(() => {
    let disposed = false;
    const refresh = () => { if (!disposed) void load(); };
    refresh();
    // CockroachDB intentionally has no realtime socket; polling keeps OCR results
    // visible on tablets as soon as the server function finishes.
    const timer = window.setInterval(refresh, 1800);
    const ch = createRealtimeChannel(`snap-ocr-${snapId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'snap_orders', filter: `id=eq.${snapId}` },
        refresh,
      )
      .subscribe();
    return () => {
      disposed = true;
      window.clearInterval(timer);
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapId]);

  const rerun = async () => {
    if (running) return;
    setRunning(true);
    setStatus('pending');
    setError(null);
    const { error: resetError } = await supabase
      .from('snap_orders')
      .update({ ocr_status: 'pending', ocr_error: null } as any)
      .eq('id', snapId);
    if (resetError) {
      setRunning(false);
      toast.error(resetError.message);
      return;
    }
    const { data, error } = await supabase.functions.invoke('snap-ocr', { body: { snap_id: snapId } });
    setRunning(false);
    if (error || data?.ok === false) toast.error(error?.message ?? data?.error ?? 'OCR failed');
    else toast.success('OCR completed');
    await load();
  };

  const addCandidate = (m: OcrMatch, c: Candidate) => {
    onAddItem({
      pricelist_id: c.id,
      name: c.name,
      size: c.size,
      category: c.category,
      unit_price: c.price,
      qty: Math.max(1, m.qty || 1),
    });
  };

  return (
    <div className="border rounded-lg p-2 space-y-2 bg-primary/5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          AI Suggestions
          <Badge variant="outline" className="text-[10px] capitalize">{status}</Badge>
          {reviewed && <Badge variant="secondary" className="text-[10px]">reviewed</Badge>}
          {confidence > 0 && (
            <span className="text-[10px] text-muted-foreground">
              conf {Math.round(confidence * 100)}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {status === 'done' && matches.length > 0 && (
            <Button
              size="sm"
              variant={reviewed ? 'outline' : 'default'}
              className="h-7"
              onClick={() => setReviewOpen(true)}
            >
              <ClipboardCheck className="h-3 w-3 mr-1" />
              {reviewed ? 'Re-review' : 'Review'}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7" onClick={rerun} disabled={running || status === 'pending'}>
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      {status === 'done' && matches.length > 0 && !reviewed && (
        <p className="text-[11px] text-warning">
          Review each extracted line — accept or edit before adding to the invoice.
        </p>
      )}

      {status === 'pending' && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Reading snap…
        </p>
      )}
      {status === 'failed' && (
        <p className="text-[11px] text-destructive">OCR failed{error ? `: ${error}` : ''}</p>
      )}

      {status === 'done' && matches.length === 0 && (
        <p className="text-[11px] text-muted-foreground">No catalogue matches found.</p>
      )}

      {matches.map((m, i) => (
        <div key={i} className="rounded border bg-background p-1.5 space-y-1">
          <div className="flex items-start gap-2">
            <span className="text-[10px] uppercase text-muted-foreground shrink-0">
              {m.type ?? 'item'} × {m.qty}
            </span>
            <p className="text-xs font-mono flex-1 break-words">{m.query}</p>
          </div>
          <div className="flex flex-wrap gap-1">
            {m.candidates.slice(0, 3).map(c => (
              <button
                key={c.id}
                onClick={() => addCandidate(m, c)}
                className="px-1.5 py-1 rounded border text-[11px] hover:border-primary hover:bg-primary/10 flex items-center gap-1"
                title={`${c.source} · score ${c.score?.toFixed?.(2) ?? c.score}`}
              >
                <Plus className="h-3 w-3" />
                {c.name}{c.size ? ` ${c.size}` : ''} · ₦{c.price.toLocaleString()}
              </button>
            ))}
          </div>
        </div>
      ))}

      {text && status === 'done' && (
        <details className="text-[10px] text-muted-foreground">
          <summary className="cursor-pointer">Raw AI text</summary>
          <pre className="whitespace-pre-wrap font-mono mt-1">{text}</pre>
        </details>
      )}

      <SnapOcrReviewDialog
        snapId={snapId}
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        onAcceptItems={(items) => items.forEach(onAddItem)}
      />
    </div>
  );
}