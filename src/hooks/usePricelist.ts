import { useCallback, useEffect, useState } from 'react';
import { createRealtimeChannel, supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type PricelistCategory =
  | 'drug_liquid' | 'drug_tablet' | 'drug_capsule' | 'drug_injection' | 'drug_topical'
  | 'consumable' | 'lab' | 'imaging' | 'bed' | 'procedure' | 'other';

export interface PricelistItem {
  id: string;
  name: string;
  size: string | null;
  pack_qty: number;
  price: number;
  category: PricelistCategory;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function usePricelist() {
  const [items, setItems] = useState<PricelistItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('pricelist')
      .select('*')
      .order('category')
      .order('name');
    setLoading(false);
    if (error) {
      toast.error('Failed to load pricelist');
      return;
    }
    setItems((data ?? []) as PricelistItem[]);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const ch = createRealtimeChannel('pricelist-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pricelist' }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refresh]);

  const upsertItem = async (row: Partial<PricelistItem> & { name: string; price: number; category: PricelistCategory }) => {
    const payload: any = {
      name: row.name.trim(),
      size: row.size?.trim() || null,
      pack_qty: row.pack_qty ?? 1,
      price: row.price,
      category: row.category,
      active: row.active ?? true,
      notes: row.notes ?? null,
    };
    if (row.id) {
      const { error } = await supabase.from('pricelist').update(payload).eq('id', row.id);
      if (error) { toast.error(error.message); return false; }
      toast.success('Item updated');
    } else {
      const { error } = await supabase.from('pricelist').insert(payload);
      if (error) { toast.error(error.message); return false; }
      toast.success('Item added');
    }
    return true;
  };

  const deleteItem = async (id: string) => {
    const { error } = await supabase.from('pricelist').delete().eq('id', id);
    if (error) { toast.error(error.message); return false; }
    toast.success('Item deleted');
    return true;
  };

  return { items, loading, refresh, upsertItem, deleteItem };
}

/** Fuzzy-match one query line against the pricelist. Returns top-N by trigram similarity. */
let _cachedAll: { at: number; items: PricelistItem[] } | null = null;
async function loadAllActive(): Promise<PricelistItem[]> {
  if (_cachedAll && Date.now() - _cachedAll.at < 60_000) return _cachedAll.items;
  const { data, error } = await supabase.from('pricelist').select('*').eq('active', true);
  if (error || !data) return _cachedAll?.items ?? [];
  _cachedAll = { at: Date.now(), items: data as PricelistItem[] };
  return _cachedAll.items;
}

// Levenshtein distance (small strings)
function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length, n = b.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Best token-vs-token fuzzy score: 0..1 where 1 is exact. Tolerates typos & substrings. */
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase().trim();
  const t = target.toLowerCase();
  if (!q || !t) return 0;
  if (t.includes(q)) return 1 - (t.length - q.length) / (t.length + 10);
  const qTokens = q.split(/\s+/).filter(Boolean);
  const tTokens = t.split(/[\s\-\/,()]+/).filter(Boolean);
  let total = 0;
  for (const qt of qTokens) {
    let best = 0;
    for (const tt of tTokens) {
      if (tt.startsWith(qt)) { best = Math.max(best, 0.95); continue; }
      if (tt.includes(qt)) { best = Math.max(best, 0.85); continue; }
      // Levenshtein against prefix of tt matching qt length (+2 slack)
      const slice = tt.slice(0, Math.min(tt.length, qt.length + 2));
      const d = lev(qt, slice);
      const maxLen = Math.max(qt.length, slice.length);
      const sim = maxLen === 0 ? 0 : 1 - d / maxLen;
      // Only count if reasonably close (allow ~1 edit per 3 chars)
      const allowed = Math.max(1, Math.floor(qt.length / 3));
      if (d <= allowed) best = Math.max(best, sim * 0.9);
    }
    total += best;
  }
  return total / Math.max(1, qTokens.length);
}

export async function fuzzyMatchPricelist(query: string, limit = 5): Promise<PricelistItem[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  const all = await loadAllActive();
  const scored = all.map(it => {
    const hay = (it.name + ' ' + (it.size ?? '')).trim();
    const score = fuzzyScore(q, hay);
    return { it, score };
  });
  scored.sort((a, b) => b.score - a.score);
  // Keep only reasonably-similar results (typo-tolerant threshold)
  return scored.filter(s => s.score >= 0.45).slice(0, limit).map(s => s.it);
}
