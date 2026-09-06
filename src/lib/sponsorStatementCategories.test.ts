import { describe, expect, it } from 'vitest';
import {
  breakdownSponsorInvoice,
  classifySponsorService,
  sponsorServiceBreakdownTotal,
} from './sponsorStatementCategories';

describe('Sponsor service category mapping', () => {
  it('classifies pharmacy and medication services as Drugs & Dressing', () => {
    expect(classifySponsorService({ category: 'pharmacy', description: 'Anpiclos tablets' })).toBe('drugs_dressing');
  });

  it('classifies laboratory services as Lab Test', () => {
    expect(classifySponsorService({ category: 'laboratory', description: 'Malaria test' })).toBe('lab_test');
  });

  it('classifies imaging and x-ray services as X-ray, not Lab Test', () => {
    expect(classifySponsorService({ category: 'imaging', description: 'Chest x-ray' })).toBe('xray');
    expect(classifySponsorService({ description: 'Abdominal ultrasound scan' })).toBe('xray');
  });

  it('classifies consultation services separately', () => {
    expect(classifySponsorService({ category: 'consultation', description: 'Consultant review' })).toBe('consultation');
  });

  it('classifies surgery, blood, and dressing services into their own columns', () => {
    expect(classifySponsorService({ description: 'Theatre operation fee' })).toBe('surgery');
    expect(classifySponsorService({ description: 'Packed cells transfusion' })).toBe('blood_iv_fluid');
    expect(classifySponsorService({ description: 'Wound dressing and gauze' })).toBe('drugs_dressing');
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

    expect(breakdown.drugs_dressing).toBe(3000);
    expect(breakdown.lab_test).toBe(1500);
    expect(breakdown.others).toBe(500);
    expect(sponsorServiceBreakdownTotal(breakdown)).toBe(5000);
  });
});
