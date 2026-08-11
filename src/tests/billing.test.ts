import { describe, it, expect, beforeAll } from 'vitest';
import { splitInvoice, copayPercent } from '../lib/copay';

// We test the logic units first to ensure calculations are correct
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

  it('handles rounding correctly for non-even splits', () => {
    const sponsor = { account_type: 'NHIA' }; // 10%
    const split = splitInvoice(99.99, sponsor);
    // 9.999 -> 10.00
    expect(split.copayAmount).toBe(10);
    expect(split.coveredAmount).toBe(89.99);
  });
});

/**
 * Integration-style tests for the settle_invoice_atomic RPC would normally go here.
 * Since we are in a sandbox and can't easily mock the full Supabase RPC return types without a real DB connection,
 * we focus on the logic verification that powers the UI and the data sent to those RPCs.
 */
