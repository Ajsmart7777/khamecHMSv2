export const SPONSOR_SERVICE_CATEGORIES = ['medication', 'lab_test', 'delivery', 'bed', 'others'] as const;

export type SponsorServiceCategory = typeof SPONSOR_SERVICE_CATEGORIES[number];

export interface SponsorServiceBreakdown {
  medication: number;
  lab_test: number;
  delivery: number;
  bed: number;
  others: number;
}

export interface SponsorInvoiceItemForCategory {
  description?: string | null;
  category?: string | null;
  total?: number | string | null;
}

export interface SponsorInvoiceForCategory {
  id: string;
  patient_id: string;
  total_amount: number | string | null;
}

export function emptySponsorServiceBreakdown(): SponsorServiceBreakdown {
  return { medication: 0, lab_test: 0, delivery: 0, bed: 0, others: 0 };
}

function normalizedText(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

export function classifySponsorService(item: SponsorInvoiceItemForCategory): SponsorServiceCategory {
  const explicit = normalizedText(item.category);
  const description = normalizedText(item.description);
  const source = `${explicit} ${description}`;

  if (/\b(delivery|dispatch|transport|courier|logistics)\b/.test(explicit) || /\b(delivery|dispatch|transport|courier|logistics)\b/.test(description)) return 'delivery';
  if (/\b(bed|ward|admission|room|in patient|inpatient|accommodation)\b/.test(explicit) || /\b(bed|ward|admission|room|in patient|inpatient|accommodation)\b/.test(description)) return 'bed';
  if (/\b(lab|laboratory|test|investigation|pathology|haematology|hematology|chemistry|malaria|genotype|urinalysis|x[ -]?ray|xray|scan|ultrasound)\b/.test(source)) return 'lab_test';
  if (/\b(medication|medicines?|drug|pharmacy|pharmaceutical|prescription|tablets?|capsules?|syrup|injection)\b/.test(source)) return 'medication';
  return 'others';
}

export function breakdownSponsorInvoice(
  items: SponsorInvoiceItemForCategory[],
  fallbackTotal: number | string | null,
): SponsorServiceBreakdown {
  const result = emptySponsorServiceBreakdown();
  const invoiceTotal = Number(fallbackTotal || 0);

  if (items.length === 0) {
    result.others = invoiceTotal;
    return result;
  }

  let itemTotal = 0;
  items.forEach(item => {
    const amount = Number(item.total || 0);
    itemTotal += amount;
    result[classifySponsorService(item)] += amount;
  });

  // Keep the report reconciled to the authoritative invoice total if line-item
  // rounding or a legacy invoice leaves a small difference.
  result.others += invoiceTotal - itemTotal;
  return result;
}

export function addSponsorServiceBreakdown(
  target: SponsorServiceBreakdown,
  source: SponsorServiceBreakdown,
) {
  SPONSOR_SERVICE_CATEGORIES.forEach(category => {
    target[category] += Number(source[category] || 0);
  });
  return target;
}

export function sponsorServiceBreakdownTotal(breakdown: SponsorServiceBreakdown) {
  return SPONSOR_SERVICE_CATEGORIES.reduce((sum, category) => sum + Number(breakdown[category] || 0), 0);
}

export function formatSponsorServiceCategory(category: SponsorServiceCategory) {
  switch (category) {
    case 'lab_test': return 'Lab Test';
    case 'medication': return 'Medication';
    case 'delivery': return 'Delivery';
    case 'bed': return 'Bed';
    default: return 'Others';
  }
}

export function buildPatientSponsorBreakdowns<T extends SponsorInvoiceForCategory>(
  invoices: T[],
  invoiceItems: (SponsorInvoiceItemForCategory & { invoice_id?: string | null })[],
) {
  const itemsByInvoice: Record<string, SponsorInvoiceItemForCategory[]> = {};
  invoiceItems.forEach(item => {
    if (item.invoice_id) (itemsByInvoice[item.invoice_id] ||= []).push(item);
  });

  const result: Record<string, SponsorServiceBreakdown> = {};
  invoices.forEach(invoice => {
    const target = result[invoice.patient_id] ||= emptySponsorServiceBreakdown();
    addSponsorServiceBreakdown(
      target,
      breakdownSponsorInvoice(itemsByInvoice[invoice.id] || [], invoice.total_amount),
    );
  });
  return result;
}
