import { describe, it, expect } from 'vitest';
import { splitInvoice, copayPercent } from '../lib/copay';

describe('Billing Logic (Copay & Splits)', () => {
  it('calculates 10% copay for NHIA/NHIS', () => {
    const sponsor = { account_type: 'NHIA' };
    expect(copayPercent(sponsor)).toBe(10);
    
    const split = splitInvoice(1000, sponsor);
    expect(split.copayAmount).toBe(100);
    expect(split.coveredAmount).toBe(900);
  });

  it('calculates 50% copay for Staff Family', () => {
    const sponsor = { account_type: 'staff_family' };
    expect(copayPercent(sponsor)).toBe(50);
    
    const split = splitInvoice(2500, sponsor);
    expect(split.copayAmount).toBe(1250);
    expect(split.coveredAmount).toBe(1250);
  });

  it('calculates 100% for Cash patients', () => {
    const sponsor = { account_type: 'cash' };
    expect(copayPercent(sponsor)).toBe(100);
    
    const split = splitInvoice(5000, sponsor);
    expect(split.copayAmount).toBe(5000);
    expect(split.coveredAmount).toBe(0);
  });
});
