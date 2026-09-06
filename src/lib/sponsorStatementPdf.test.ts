import { describe, it, expect } from 'vitest';
import { buildStatementHtml, type SponsorStatementReport } from './sponsorStatementPdf';
import { emptySponsorServiceBreakdown } from './sponsorStatementCategories';

function breakdown(overrides: Partial<ReturnType<typeof emptySponsorServiceBreakdown>>) {
  return { ...emptySponsorServiceBreakdown(), ...overrides };
}

function reportFixture(): SponsorStatementReport {
  return {
    statement: {
      id: 'stmt-1',
      statement_number: 'KMC-2026-08-001',
      sponsor_id: 'sp-1',
      sponsor_type: 'corporate',
      period_year: 2026,
      period_month: 8,
      period_start: '2026-08-01T00:00:00.000Z',
      period_end: '2026-08-31T23:59:59.999Z',
      total_amount: 15_000,
      invoice_count: 1,
      patient_count: 1,
      manual_service_count: 1,
      previous_outstanding: 0,
      credit_applied: 0,
      amount_due: 15_000,
      coverage_status: 'unpaid',
      status: 'finalized',
      notes: null,
      generated_at: '2026-09-01T10:00:00.000Z',
      finalized_at: '2026-09-01T10:05:00.000Z',
      printed_at: null,
      paid_at: null,
      sponsor: {
        company_name: 'Test & Sons Ltd',
        contact_person: 'A. Manager',
        email: 'accounts@testandsons.example',
        phone: '08000000000',
        address: '1 Main Road, Funtua',
      },
    },
    rows: [
      {
        kind: 'patient',
        name: 'Musa <Abubakar>',
        card_number: 'CARD-0001',
        card_title: 'System Patient ID: CARD-0001',
        refs: 'INV-1001',
        breakdown: breakdown({ consultation: 2_000, lab_test: 5_000, drugs_dressing: 3_000 }),
        subtotal: 10_000,
      },
      {
        kind: 'manual',
        name: 'Walk-in Staff',
        service_description: 'Malaria test & drugs',
        card_number: 'WALK-IN',
        breakdown: breakdown({ lab_test: 2_500, drugs_dressing: 2_500 }),
        subtotal: 5_000,
      },
    ],
    total_breakdown: breakdown({ consultation: 2_000, lab_test: 7_500, drugs_dressing: 5_500 }),
  };
}

describe('sponsorStatementPdf statement rendering', () => {
  it('renders the full service-column table with correct cells and grand total', () => {
    const html = buildStatementHtml(reportFixture());
    expect(html).toContain('Khadija Medical Center');
    expect(html).toContain('Test &amp; Sons Ltd');
    expect(html).toContain('Musa &lt;Abubakar&gt;');
    expect(html).toContain('Exam');
    expect(html).toContain('Lab Test (₦)');
    expect(html).toContain('Drugs/Dressing (₦)');
    // Walk-in rows are flagged instead of consuming an S/N.
    expect(html).toMatch(/<td class="sn">—<\/td>/);
    expect(html).toContain('Grand Total');
    expect(html).toContain('₦15,000.00');
    expect(html).toContain('Amount in words');
  });

  it('handles an empty statement without throwing', () => {
    const fixture = reportFixture();
    fixture.rows = [];
    fixture.statement.total_amount = 0;
    fixture.statement.patient_count = 0;
    fixture.statement.invoice_count = 0;
    fixture.statement.manual_service_count = 0;
    const html = buildStatementHtml(fixture);
    expect(html).toContain('No billable invoices or walk-in paper services were recorded in this period.');
    expect(html).toContain('Grand Total');
  });
});
