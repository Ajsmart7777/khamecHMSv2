import { describe, it, expect } from 'vitest';

/**
 * These tests verify the logic for reversing overpayment credits.
 * In the system, an overpayment on a cash/copay account increases the patient's wallet balance.
 * Voiding or refunding must decrease that balance back to its original state.
 */

interface Patient {
  id: string;
  balance: number;
  account_type: string;
}

interface Invoice {
  id: string;
  total_amount: number;
  paid_amount: number;
  status: 'pending' | 'paid' | 'partial' | 'voided';
}

// Logic simulation for the atomic reverse operations
function calculateBalanceAfterVoid(
  currentBalance: number,
  invoicePaidAmount: number,
  invoiceTotalAmount: number,
  isSponsored: boolean,
  copayPct: number
): number {
  const patientShare = isSponsored 
    ? Math.round((invoiceTotalAmount * copayPct) / 100 * 100) / 100 
    : invoiceTotalAmount;
  
  const overpayment = Math.max(0, Math.round((invoicePaidAmount - patientShare) * 100) / 100);
  
  // If we void the invoice, we must take back the overpayment credit 
  // that was previously added to the balance.
  return Math.round((currentBalance - overpayment) * 100) / 100;
}

describe('Wallet Credit Reversal Logic', () => {
  it('correctly calculates balance reversal for a 100% cash overpayment', () => {
    // Scenario: Patient paid 5000 for a 4000 invoice. 
    // Wallet balance increased by 1000.
    const initialBalance = 1000; // The 1000 credit from the overpayment
    const paid = 5000;
    const total = 4000;
    
    const newBalance = calculateBalanceAfterVoid(initialBalance, paid, total, false, 100);
    
    // Balance should return to 0 (or whatever it was before that specific payment)
    expect(newBalance).toBe(0);
  });

  it('correctly handles reversal for sponsored copay overpayment', () => {
    // Scenario: Staff Family (50% copay). Total 10000. Copay 5000.
    // Patient paid 6000. Balance increased by 1000.
    const initialBalance = 1000;
    const paid = 6000;
    const total = 10000;
    const copayPct = 50;
    
    const newBalance = calculateBalanceAfterVoid(initialBalance, paid, total, true, copayPct);
    
    expect(newBalance).toBe(0);
  });

  it('does not affect balance if there was no overpayment', () => {
    const initialBalance = 0;
    const paid = 4000;
    const total = 4000;
    
    const newBalance = calculateBalanceAfterVoid(initialBalance, paid, total, false, 100);
    
    expect(newBalance).toBe(0);
  });

  it('handles rounding in reversals', () => {
    const initialBalance = 0.01; // 10.00 - 9.99
    const paid = 10;
    const total = 99.9; // 10% copay of 99.9 is 9.99
    
    const newBalance = calculateBalanceAfterVoid(initialBalance, paid, 99.9, true, 10);
    expect(newBalance).toBe(0);
  });
});
