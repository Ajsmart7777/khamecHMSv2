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
    const ch = supabase
      .channel('pricelist-changes')
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
export async function fuzzyMatchPricelist(query: string, limit = 5): Promise<PricelistItem[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  // Uses pg_trgm's ILIKE + similarity ranking via a two-word tokenized OR.
  const tokens = q.split(/\s+/).filter(t => t.length >= 1).slice(0, 4);
  if (tokens.length === 0) return [];
  const orExpr = tokens.map(t => `search_text.ilike.%${t.replace(/[%,()]/g, '')}%`).join(',');
  const { data, error } = await supabase
    .from('pricelist')
    .select('*')
    .eq('active', true)
    .or(orExpr)
    .limit(limit * 3);
  if (error || !data) return [];
  // Rank client-side by number of matching tokens then by length proximity
  const scored = (data as PricelistItem[]).map(it => {
    const s = (it.name + ' ' + (it.size ?? '')).toLowerCase();
    const hits = tokens.filter(t => s.includes(t)).length;
    return { it, hits, len: Math.abs(s.length - q.length) };
  });
  scored.sort((a, b) => b.hits - a.hits || a.len - b.len);
  return scored.slice(0, limit).map(s => s.it);
}
