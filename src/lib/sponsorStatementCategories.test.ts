import { describe, expect, it } from 'vitest';
import {
  breakdownSponsorInvoice,
  classifySponsorService,
  sponsorServiceBreakdownTotal,
} from './sponsorStatementCategories';

describe('Sponsor service category mapping', () => {
  it('classifies pharmacy and medication services as Medication', () => {
    expect(classifySponsorService({ category: 'pharmacy', description: 'Anpiclos tablets' })).toBe('medication');
  });

  it('classifies laboratory services as Lab Test', () => {
    expect(classifySponsorService({ category: 'laboratory', description: 'Malaria test' })).toBe('lab_test');
  });

  it('does not treat the word latest as a laboratory test', () => {
    expect(classifySponsorService({ category: 'consultation', description: 'Latest consultant review' })).toBe('others');
  });

  it('classifies delivery and bed services separately', () => {
    expect(classifySponsorService({ description: 'Hospital delivery charge' })).toBe('delivery');
    expect(classifySponsorService({ description: 'Ward bed admission' })).toBe('bed');
  });

  it('reconciles line items to the authoritative invoice total', () => {
    const breakdown = breakdownSponsorInvoice(
      [
        { category: 'pharmacy', description: 'Medication', total: 3000 },
        { category: 'laboratory', description: 'Malaria test', total: 1500 },
      ],
      5000,
    );

    expect(breakdown.medication).toBe(3000);
    expect(breakdown.lab_test).toBe(1500);
    expect(breakdown.others).toBe(500);
    expect(sponsorServiceBreakdownTotal(breakdown)).toBe(5000);
  });
});
