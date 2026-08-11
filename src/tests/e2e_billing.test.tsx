import { describe, it, expect } from 'vitest';
import { splitInvoice } from '../lib/copay';

/**
 * End-to-end simulation of a complex billing cycle for an admitted patient.
 * Verifies that multiple orders (Pharmacy + Lab) correctly update wallet balances,
 * handle partial payments, debt, and sponsor splits without leaking value.
 */

interface PatientState {
  balance: number;
  account_type: string;
}

interface Order {
  total: number;
  type: 'pharmacy' | 'lab';
}

function simulateBillingFlow(
  initialPatient: PatientState,
  orders: Order[],
  payments: { cash: number; useBalance: boolean }[]
) {
  let currentBalance = initialPatient.balance;
  let totalDebt = 0;
  let totalSponsorClaims = 0;

  orders.forEach((order, idx) => {
    const split = splitInvoice(order.total, { account_type: initialPatient.account_type });
    totalSponsorClaims += split.coveredAmount;
    
    const patientOwes = split.copayAmount;
    const payment = payments[idx];
    
    let applied = 0;
    if (payment.useBalance) {
      const fromBal = Math.min(currentBalance, patientOwes);
      currentBalance -= fromBal;
      applied += fromBal;
    }
    
    applied += payment.cash;
    
    const shortfall = patientOwes - applied;
    const overpayment = applied - patientOwes;
    
    if (shortfall > 0) {
      totalDebt += shortfall;
      // In our DB logic, debt is often tracked as negative balance or separate field
      // Here we simulate the patient balance impact
      currentBalance -= shortfall; 
    }
    
    if (overpayment > 0) {
      currentBalance += overpayment;
    }
  });

  return {
    finalBalance: Math.round(currentBalance * 100) / 100,
    totalSponsorClaims: Math.round(totalSponsorClaims * 100) / 100
  };
}

describe('Complex Admitted Patient Billing Cycle', () => {
  it('handles mixed pharmacy/lab orders with overpayments and balance usage', () => {
    // Scenario: Cash patient starts with 1000 balance.
    // 1. Pharmacy order: 5000. Pays 6000 cash. (Wallet should become 1000 + (6000-5000) = 2000)
    // 2. Lab order: 3000. Uses balance (2000) + pays 500 cash. (Owes 500, balance -500)
    
    const patient: PatientState = { balance: 1000, account_type: 'cash' };
    const orders: Order[] = [
      { total: 5000, type: 'pharmacy' },
      { total: 3000, type: 'lab' }
    ];
    const payments = [
      { cash: 6000, useBalance: false }, // Overpays 1000
      { cash: 500, useBalance: true }    // Uses 2000 balance, still needs 1000, pays 500, debt 500
    ];

    const result = simulateBillingFlow(patient, orders, payments);
    
    // Step 1: 1000 + (6000 - 5000) = 2000
    // Step 2: 2000 (bal) + 500 (cash) = 2500. Total 3000. Shortfall 500.
    // Final balance: 2000 - 2500 (used) + 500 (cash) - 500 (debt) = -500
    expect(result.finalBalance).toBe(-500);
  });

  it('correctly splits multi-order cycles for 10% copay patients (NHIA)', () => {
    // Scenario: NHIA patient (10% copay).
    // 1. Lab: 10000. Copay 1000. Pays 1000 cash. Balance 0.
    // 2. Pharmacy: 5000. Copay 500. Pays 1000 cash. Balance 500.
    
    const patient: PatientState = { balance: 0, account_type: 'nhia' };
    const orders: Order[] = [
      { total: 10000, type: 'lab' },
      { total: 5000, type: 'pharmacy' }
    ];
    const payments = [
      { cash: 1000, useBalance: false },
      { cash: 1000, useBalance: true }
    ];

    const result = simulateBillingFlow(patient, orders, payments);
    
    expect(result.finalBalance).toBe(500);
    expect(result.totalSponsorClaims).toBe(13500); // 9000 + 4500
  });

  it('handles rounding for Staff Family (50%) across multiple orders', () => {
    // Staff Family 50% copay.
    // 1. Pharmacy: 99.99. Copay: 50.00 (rounded). Pays 100. Balance 50.00.
    // 2. Lab: 200.01. Copay: 100.01. Uses balance 50. Pays 60. Balance 9.99.
    
    const patient: PatientState = { balance: 0, account_type: 'staff_family' };
    const orders: Order[] = [
      { total: 99.99, type: 'pharmacy' },
      { total: 200.01, type: 'lab' }
    ];
    const payments = [
      { cash: 100, useBalance: false },
      { cash: 60, useBalance: true }
    ];

    const result = simulateBillingFlow(patient, orders, payments);
    
    // Order 1: Copay 50.00. Covered 49.99. Cash 100. Bal = 50.00.
    // Order 2: Copay 100.01. Covered 100.00. Bal usage 50. Cash 60. Total applied 110. Overpay 9.99.
    // Final Bal: 50.00 - 50.00 (used) + 9.99 (overpay) = 9.99
    expect(result.finalBalance).toBe(9.99);
  });
});
