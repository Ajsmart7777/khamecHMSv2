// Copay rules per hospital policy. Returns the percentage of an invoice the
// PATIENT is expected to pay at the cashier. The remainder is billed to the
// sponsor (or written off, in the case of full-cover schemes) and shows up in
// the Claims queue after the visit is settled.
//
// Rules (from management):
//   katchma            → 10%   (patient copay)
//   katchma basic      → 0%    (fully covered)
//   nhia / nhis        → 10%
//   hmo                → 0%
//   corporate          → 0%
//   retainer           → 0%
//   staff              → 0%
//   staff_family       → 50%   (family member pays their share at the desk)
//   normal / cash      → 100%  (patient pays in full — not a claim)

export type SponsorInfo = {
  account_type?: string | null;
  insurance_plan?: string | null;
};

const norm = (s?: string | null) => (s ?? '').toLowerCase().trim().replace(/\s+/g, '_');

export function copayPercent({ account_type, insurance_plan }: SponsorInfo): number {
  const a = norm(account_type);
  const plan = norm(insurance_plan);

  if (a === 'katchma') {
    if (plan.includes('basic')) return 0;
    return 10;
  }
  if (a === 'nhia' || a === 'nhis') return 10;
  if (a === 'hmo') return 0;
  if (a === 'corporate' || a === 'retainer') return 0;
  if (a === 'staff') return 0;
  if (a === 'staff_family') return 50;
  return 100; // normal / cash / unknown
}

/** True if the account is a sponsored/insured account (any non-cash). */
export function isSponsored({ account_type }: SponsorInfo): boolean {
  const a = norm(account_type);
  return !!a && a !== 'normal' && a !== 'cash';
}

/**
 * Whether this account is allowed to hold a wallet balance / top-up / owe money
 * on their patient balance. Only walk-in cash patients have a wallet — every
 * insured or sponsored account settles through the sponsor / payroll, never
 * through the patient's own balance.
 */
export function hasWallet({ account_type }: SponsorInfo): boolean {
  const a = norm(account_type);
  return a === '' || a === 'normal' || a === 'cash';
}

/** Human-friendly sponsor label. */
export function sponsorLabel({ account_type, insurance_plan }: SponsorInfo): string {
  const a = norm(account_type);
  const map: Record<string, string> = {
    katchma: 'KATCHMA',
    nhia: 'NHIA', nhis: 'NHIS',
    hmo: 'HMO',
    corporate: 'Corporate',
    retainer: 'Retainer',
    staff: 'Staff',
    staff_family: 'Staff Family',
  };
  const base = map[a] ?? (a || 'Cash');
  return insurance_plan ? `${base} · ${insurance_plan}` : base;
}

export function splitInvoice(total: number, sponsor: SponsorInfo) {
  const pct = copayPercent(sponsor);
  const copay = Math.round((total * pct) / 100 * 100) / 100;
  const covered = Math.max(0, Math.round((total - copay) * 100) / 100);
  return { copayPct: pct, copayAmount: copay, coveredAmount: covered };
}