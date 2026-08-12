import { describe, it, expect } from 'vitest';

/**
 * Test pure JS representation of the bed day / observation fee calculation rules:
 * - Nights = (discharge_date::date - admitted_date::date)
 * - If nights = 0 -> observation only = ₦3,000 flat
 * - If nights >= 1 -> nights × daily_rate
 */
function calculateBedCharge(admittedAt: string, dischargedAt: string, dailyRate: number) {
  const admDate = new Date(admittedAt);
  const disDate = new Date(dischargedAt);
  
  // Extract calendar dates (ignoring time)
  const admDay = new Date(admDate.getFullYear(), admDate.getMonth(), admDate.getDate());
  const disDay = new Date(disDate.getFullYear(), disDate.getMonth(), disDate.getDate());
  
  const diffTime = disDay.getTime() - admDay.getTime();
  const nights = Math.max(0, Math.round(diffTime / (1000 * 60 * 60 * 24)));
  
  if (nights === 0) {
    return { days: 0, dailyRate: 3000, amount: 3000 };
  } else {
    return { days: nights, dailyRate, amount: nights * dailyRate };
  }
}

describe('Observation Fee and Bed Night Billing Logic', () => {
  it('charges ₦3,000 flat observation fee for same-day discharge (nights = 0)', () => {
    // Admitted Aug 10 at 2pm, discharged Aug 10 at 8pm
    const res = calculateBedCharge('2026-08-10T14:00:00Z', '2026-08-10T20:00:00Z', 15000);
    expect(res.days).toBe(0);
    expect(res.dailyRate).toBe(3000);
    expect(res.amount).toBe(3000);
  });

  it('charges 1 × daily_rate for overnight stay crossing 1 midnight (nights = 1)', () => {
    // Admitted Aug 10 at 10pm, discharged Aug 11 at 8am
    const res = calculateBedCharge('2026-08-10T22:00:00Z', '2026-08-11T08:00:00Z', 15000);
    expect(res.days).toBe(1);
    expect(res.dailyRate).toBe(15000);
    expect(res.amount).toBe(15000);
  });

  it('charges multiple nights correctly for multi-day stays (nights >= 1)', () => {
    // Admitted Aug 10, discharged Aug 13
    const res = calculateBedCharge('2026-08-10T10:00:00Z', '2026-08-13T10:00:00Z', 20000);
    expect(res.days).toBe(3);
    expect(res.dailyRate).toBe(20000);
    expect(res.amount).toBe(60000);
  });
});
