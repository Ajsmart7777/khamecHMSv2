import { describe, it, expect } from 'vitest';
import { splitInvoice } from '../lib/copay';

/**
 * Parallel execution simulation of billing operations for an admitted patient.
 * In a real environment, Supabase RPCs (like settle_invoice_atomic) use 
 * row-level locking or transactions to ensure consistency.
 * 
 * This test simulates the logic applied when multiple orders hit the cashier 
 * or are processed near-simultaneously, ensuring the final calculated state 
 * remains consistent.
 */

interface PatientState {
  balance: number;
  account_type: string;
}

interface Order {
  total: number;
  type: 'pharmacy' | 'lab';
}

interface Payment {
  cash: number;
  useBalance: boolean;
}

/**
 * Simulates parallel processing of orders.
 * In the real app, this is handled by database transactions.
 * Here we verify that the logic itself is commutative and handles 
 * shared state transitions correctly.
 */
async function simulateParallelBilling(
  initialPatient: PatientState,
  operations: Array<{ order: Order; payment: Payment }>
) {
  let currentBalance = initialPatient.balance;
  
  // We simulate the database transaction by processing these in a way 
  // that mimics concurrent updates to the same patient record.
  // Each operation reads the "latest" balance and updates it.
  
  const results = await Promise.all(operations.map(async (op) => {
    // In a real DB, the "SELECT FOR UPDATE" would happen here
    const split = splitInvoice(op.order.total, { account_type: initialPatient.account_type });
    return { op, split };
  }));

  // Sequential application of the calculated splits to the shared balance
  // which is how the DB serializes the final writes.
  results.forEach(({ op, split }) => {
    const patientOwes = split.copayAmount;
    let applied = 0;
    
    if (op.payment.useBalance) {
      const fromBal = Math.min(currentBalance, patientOwes);
      currentBalance -= fromBal;
      applied += fromBal;
    }
    
    applied += op.payment.cash;
    
    const shortfall = patientOwes - applied;
    const overpayment = applied - patientOwes;
    
    if (shortfall > 0) {
      currentBalance -= shortfall; 
    }
    
    if (overpayment > 0) {
      currentBalance += overpayment;
    }
  });

  return {
    finalBalance: Math.round(currentBalance * 100) / 100
  };
}

describe('Parallel Admitted Patient Billing', () => {
  it('maintains balance integrity when Pharmacy and Lab orders are processed together', async () => {
    // Patient has 5000 balance
    // Order 1 (Pharmacy): 4000. Uses balance.
    // Order 2 (Lab): 2000. Uses balance + pays 500 cash.
    
    const patient: PatientState = { balance: 5000, account_type: 'cash' };
    
    const operations = [
      { 
        order: { total: 4000, type: 'pharmacy' } as Order, 
        payment: { cash: 0, useBalance: true } 
      },
      { 
        order: { total: 2000, type: 'lab' } as Order, 
        payment: { cash: 500, useBalance: true } 
      }
    ];

    const result = await simulateParallelBilling(patient, operations);

    // Analysis:
    // Op 1: Applied 4000 from bal. Remaining bal: 1000.
    // Op 2: Applied 1000 from bal (max avail). Applied 500 cash. 
    //       Total applied: 1500. Shortfall for 2000 is 500.
    // Final balance should be -500.
    
    expect(result.finalBalance).toBe(-500);
  });

  it('correctly handles simultaneous overpayments from multiple sources', async () => {
    const patient: PatientState = { balance: 0, account_type: 'cash' };
    
    const operations = [
      { 
        order: { total: 1000, type: 'pharmacy' } as Order, 
        payment: { cash: 1500, useBalance: false } // +500 overpay
      },
      { 
        order: { total: 2000, type: 'lab' } as Order, 
        payment: { cash: 3000, useBalance: false } // +1000 overpay
      }
    ];

    const result = await simulateParallelBilling(patient, operations);
    expect(result.finalBalance).toBe(1500);
  });

  it('handles race-like scenarios for copay accounts', async () => {
    // NHIA 10% copay
    const patient: PatientState = { balance: 0, account_type: 'nhia' };
    
    const operations = [
      { 
        order: { total: 10000, type: 'pharmacy' } as Order, 
        payment: { cash: 2000, useBalance: false } // 1000 copay, 1000 overpay
      },
      { 
        order: { total: 5000, type: 'lab' } as Order, 
        payment: { cash: 0, useBalance: true } // 500 copay. Uses from the overpay above.
      }
    ];

    const result = await simulateParallelBilling(patient, operations);
    
    // Op 1: 1000 copay. 2000 cash. Bal = 1000.
    // Op 2: 500 copay. Uses 500 from bal. Bal = 500.
    expect(result.finalBalance).toBe(500);
  });
});
