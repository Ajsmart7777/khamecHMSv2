// Statement column order requested by the Accountant:
// S/N · Name · Card # · Exam · Surgery · Drugs & Dressing · Blood & IV Fluid ·
// Delivery · X-ray · Lab Test · Bed · Others · Total.
// 'consultation' is retained as a DB/UI value that shares the Exam column.
export const SPONSOR_SERVICE_CATEGORIES = [
  'consultation',
  'surgery',
  'drugs_dressing',
  'blood_iv_fluid',
  'delivery',
  'xray',
  'lab_test',
  'bed',
  'others',
] as const;

export type SponsorServiceCategory = typeof SPONSOR_SERVICE_CATEGORIES[number];

export interface SponsorServiceBreakdown {
  consultation: number;
  drugs_dressing: number;
  blood_iv_fluid: number;
  surgery: number;
  xray: number;
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
  return {
    consultation: 0,
    drugs_dressing: 0,
    blood_iv_fluid: 0,
    surgery: 0,
    xray: 0,
    lab_test: 0,
    delivery: 0,
    bed: 0,
    others: 0,
  };
}

function normalizedText(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

export function classifySponsorService(item: SponsorInvoiceItemForCategory): SponsorServiceCategory {
  const explicit = normalizedText(item.category);
  const description = normalizedText(item.description);
  const source = `${explicit} ${description}`;

  if (/\b(consult|consultation|clinic|review|outpatient fee|registration)\b/.test(source)) return 'consultation';
  if (/\b(bandage|dressing|gauze|syringe|needle|glove|cotton|consumable|drugs|drug|medication|medicines?|pharmacy|pharmaceutical|prescription|tablets?|capsules?|syrup|injection|infusion)\b/.test(source)) return 'drugs_dressing';
  if (/\b(blood|iv fluid|ivf|dextrose|normal saline|transfusion|packed cell|plasma|ringers)\b/.test(source)) return 'blood_iv_fluid';
  if (/\b(surgery|surgical|operation|theatre|incision|excision|suture|appendectomy|caesarean|cesarean)\b/.test(source)) return 'surgery';
  if (/\b(x[ -]?ray|xray|radiograph|imaging|mri|ct scan|ctscan|scan|ultrasound|sonography|ecg|echo)\b/.test(source)) return 'xray';
  if (/\b(lab|laboratory|test|investigation|pathology|haematology|hematology|chemistry|malaria|genotype|urinalysis)\b/.test(source)) return 'lab_test';
  if (/\b(delivery|dispatch|transport|courier|logistics|childbirth|labour|labor|maternity)\b/.test(source)) return 'delivery';
  if (/\b(bed|ward|admission|room|in patient|inpatient|accommodation)\b/.test(source)) return 'bed';
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

export function sponsorServiceCategoryLabel(category: SponsorServiceCategory): string {
  switch (category) {
    case 'consultation': return 'Consultation';
    case 'drugs_dressing': return 'Drugs & Dressing';
    case 'blood_iv_fluid': return 'Blood & IV Fluid';
    case 'surgery': return 'Surgery';
    case 'xray': return 'X-ray';
    case 'lab_test': return 'Lab Test';
    case 'delivery': return 'Delivery';
    case 'bed': return 'Bed';
    default: return 'Others';
  }
}

// Short labels for the compact manual-record dialog and the PDF table headers.
export function sponsorServiceCategoryShortLabel(category: SponsorServiceCategory): string {
  switch (category) {
    case 'consultation': return 'Exam';
    case 'drugs_dressing': return 'Drugs/Dressing';
    case 'blood_iv_fluid': return 'Blood/IV Fluid';
    case 'surgery': return 'Surgery';
    case 'xray': return 'X-ray';
    case 'lab_test': return 'Lab Test';
    case 'delivery': return 'Delivery';
    case 'bed': return 'Bed';
    default: return 'Others';
  }
}

/**
 * The printed manual-record layout requested by the Accountant shows one
 * combined "Exam" column. Consultation amounts are recorded under their own
 * database/UI value and displayed in that Exam column, so no data is lost
 * while the statement keeps the compact paper layout.
 */
export const SPONSOR_EXAM_COLUMN_KEY = 'exam' as const;
export type SponsorExamColumnKey =
  | typeof SPONSOR_EXAM_COLUMN_KEY
  | Exclude<SponsorServiceCategory, 'consultation'>;

export const SPONSOR_EXAM_TABLE_COLUMNS: SponsorExamColumnKey[] = [
  SPONSOR_EXAM_COLUMN_KEY,
  'surgery',
  'drugs_dressing',
  'blood_iv_fluid',
  'delivery',
  'xray',
  'lab_test',
  'bed',
  'others',
];

export function sponsorExamColumnLabel(key: SponsorExamColumnKey): string {
  return key === SPONSOR_EXAM_COLUMN_KEY ? 'Exam' : sponsorServiceCategoryShortLabel(key);
}

/** Amount shown in the combined Exam column for a statement breakdown. */
export function sponsorExamColumnAmount(breakdown: SponsorServiceBreakdown): number {
  return Number(breakdown.consultation || 0);
}

/** All category amounts contributed to the combined Exam column. */
export function sponsorExamColumnCategories(): SponsorServiceCategory[] {
  return ['consultation'];
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
    result[invoice.patient_id] = addSponsorServiceBreakdown(
      emptySponsorServiceBreakdown(),
      breakdownSponsorInvoice(itemsByInvoice[invoice.id] || [], invoice.total_amount),
    );
  });
  return result;
}
