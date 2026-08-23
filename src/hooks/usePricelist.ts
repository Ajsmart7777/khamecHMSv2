import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
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
  search_text?: string | null;
}

type PricelistListener = (items: PricelistItem[]) => void;

const CACHE_TTL_MS = 30_000;
let cachedPricelist: { at: number; items: PricelistItem[] } | null = null;
let inFlightLoad: Promise<PricelistItem[]> | null = null;
const listeners = new Set<PricelistListener>();

function normalizeItem(row: any): PricelistItem {
  return {
    ...row,
    pack_qty: Number(row.pack_qty ?? 1),
    price: Number(row.price ?? 0),
    active: row.active !== false,
  } as PricelistItem;
}

/** Normalizes case, punctuation, repeated whitespace, and accents for reliable search. */
export function normalizePricelistText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function publish(items: PricelistItem[]) {
  cachedPricelist = { at: Date.now(), items };
  listeners.forEach(listener => listener(items));
}

async function fetchPricelist(force = false): Promise<PricelistItem[]> {
  if (!force && cachedPricelist && Date.now() - cachedPricelist.at < CACHE_TTL_MS) {
    return cachedPricelist.items;
  }
  if (inFlightLoad) return inFlightLoad;

  inFlightLoad = (async () => {
    const { data, error } = await supabase
      .from('pricelist')
      .select('id,name,size,pack_qty,price,category,search_text,active,notes,created_at,updated_at')
      .order('name');
    if (error) throw new Error(error.message || 'Failed to load pricelist');
    const items = (data ?? []).map(normalizeItem);
    publish(items);
    return items;
  })();

  try {
    return await inFlightLoad;
  } finally {
    inFlightLoad = null;
  }
}

export function usePricelist() {
  const [items, setItems] = useState<PricelistItem[]>(() => cachedPricelist?.items ?? []);
  const [loading, setLoading] = useState(() => !cachedPricelist);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchPricelist(true);
      setItems(next);
    } catch (error: any) {
      toast.error('Failed to load pricelist', { description: error?.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const listener: PricelistListener = next => setItems(next);
    listeners.add(listener);
    void (cachedPricelist ? fetchPricelist(false) : refresh()).then(next => {
      if (next) setItems(next);
    }).catch(() => undefined);

    // The Cockroach compatibility client has no server-pushed realtime events.
    // Polling keeps separate staff tablets current; local mutations publish
    // immediately through the shared listener set.
    const poll = window.setInterval(() => { void refresh(); }, CACHE_TTL_MS);
    return () => {
      listeners.delete(listener);
      window.clearInterval(poll);
    };
  }, [refresh]);

  const upsertItem = async (row: Partial<PricelistItem> & { name: string; price: number; category: PricelistCategory }) => {
    const payload: any = {
      name: row.name.trim(),
      size: row.size?.trim() || null,
      pack_qty: Math.max(1, Number(row.pack_qty ?? 1)),
      price: Number(row.price),
      category: row.category,
      active: row.active ?? true,
      notes: row.notes?.trim() || null,
    };
    let error: any = null;
    if (row.id) {
      ({ error } = await supabase.from('pricelist').update(payload).eq('id', row.id));
    } else {
      ({ error } = await supabase.from('pricelist').insert(payload));
    }
    if (error) { toast.error(error.message); return false; }
    await refresh();
    toast.success(row.id ? 'Item updated' : 'Item added');
    return true;
  };

  const deleteItem = async (id: string) => {
    const { error } = await supabase.from('pricelist').delete().eq('id', id);
    if (error) { toast.error(error.message); return false; }
    await refresh();
    toast.success('Item deleted');
    return true;
  };

  return { items, loading, refresh, upsertItem, deleteItem };
}

/** Levenshtein distance for short search tokens. */
function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function tokenScore(queryToken: string, targetTokens: string[]): number {
  let best = 0;
  for (const targetToken of targetTokens) {
    if (targetToken === queryToken) best = Math.max(best, 1);
    else if (targetToken.startsWith(queryToken)) best = Math.max(best, 0.95);
    else if (targetToken.includes(queryToken)) best = Math.max(best, 0.85);
    else if (queryToken.length >= 3) {
      const slice = targetToken.slice(0, Math.min(targetToken.length, queryToken.length + 2));
      const distance = lev(queryToken, slice);
      const allowed = Math.max(1, Math.floor(queryToken.length / 3));
      if (distance <= allowed) best = Math.max(best, (1 - distance / Math.max(queryToken.length, slice.length)) * 0.9);
    }
  }
  return best;
}

/**
 * Search a supplied Pricelist collection. No arbitrary first-N truncation is
 * applied; callers may pass a limit only when they intentionally want one.
 */
export function searchPricelistItems(items: PricelistItem[], query: string, limit?: number): PricelistItem[] {
  const normalizedQuery = normalizePricelistText(query);
  if (!normalizedQuery) return [];

  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  const scored = items.filter(item => item.active !== false).map(item => {
    const haystack = normalizePricelistText([
      item.name,
      item.size,
      item.category,
      item.notes,
      item.search_text,
    ].filter(Boolean).join(' '));
    const targetTokens = haystack.split(' ').filter(Boolean);
    const score = haystack.includes(normalizedQuery)
      ? 1
      : queryTokens.reduce((sum, token) => sum + tokenScore(token, targetTokens), 0) / queryTokens.length;
    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name) || String(a.item.size ?? '').localeCompare(String(b.item.size ?? '')));
  const matches = scored.filter(({ score }) => score >= 0.45).map(({ item }) => item);
  return limit === undefined ? matches : matches.slice(0, limit);
}

export async function fuzzyMatchPricelist(query: string, limit?: number): Promise<PricelistItem[]> {
  try {
    const all = await fetchPricelist(false);
    return searchPricelistItems(all, query, limit);
  } catch {
    return [];
  }
}
