import { describe, expect, it } from 'vitest';
import { normalizePricelistText, searchPricelistItems, type PricelistItem } from './usePricelist';

const item = (id: string, name: string, size: string | null, category: PricelistItem['category'], active = true): PricelistItem => ({
  id,
  name,
  size,
  pack_qty: 1,
  price: 100,
  category,
  active,
  notes: null,
  created_at: '',
  updated_at: '',
});

describe('Pricelist search', () => {
  const items = [
    item('1', 'AMINOPHYLLINE INJ', '10CC 250MG', 'drug_injection'),
    item('2', 'AMINOPHYLLINE', '100MG', 'drug_tablet'),
    item('3', 'A.F.B', null, 'lab'),
    item('4', 'AMINOPHYLLINE INACTIVE', null, 'drug_tablet', false),
  ];

  it('normalizes case, punctuation, and repeated whitespace', () => {
    expect(normalizePricelistText('  A.F.B /  Test  ')).toBe('a f b test');
  });

  it('returns every matching active item instead of hiding matches behind a top-N cap', () => {
    const matches = searchPricelistItems(items, 'aminophylline');
    expect(new Set(matches.map(match => match.id))).toEqual(new Set(['1', '2']));
    expect(matches).toHaveLength(2);
  });

  it('matches multi-word medicine and strength searches', () => {
    const matches = searchPricelistItems(items, 'aminophylin 250 mg');
    expect(matches.map(match => match.id)).toContain('1');
  });

  it('does not return inactive items to order and Billing matching', () => {
    expect(searchPricelistItems(items, 'inactive')).toEqual([]);
  });

  it('supports an explicit limit only when the caller intentionally supplies one', () => {
    expect(searchPricelistItems(items, 'aminophylline', 1)).toHaveLength(1);
  });
});
