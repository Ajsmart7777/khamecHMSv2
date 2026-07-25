// Per-provider member ID field definitions.
// Claims Managers edit these from the Insurance Providers UI so no code change
// is needed to onboard a new HMO / NHIA scheme.

export interface ProviderField {
  key: string;          // machine key, snake_case
  label: string;        // shown to users
  required?: boolean;
  primary?: boolean;    // best-effort "enrollee_id" alias
  placeholder?: string;
  pattern?: string;     // optional regex validation (unanchored)
  helper?: string;
}

/** Default template shown when a provider has no custom fields yet. */
export const DEFAULT_MEMBER_FIELDS: ProviderField[] = [
  { key: 'enrollee_id', label: 'Member / Enrollee ID', required: true, primary: true },
  { key: 'plan', label: 'Plan / Tier', required: false },
];

/** Normalise whatever came from the DB into a safe ProviderField[]. */
export function normaliseFields(raw: unknown): ProviderField[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_MEMBER_FIELDS;
  return raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f) => ({
      key: String(f.key ?? '').trim(),
      label: String(f.label ?? '').trim() || String(f.key ?? '').trim(),
      required: !!f.required,
      primary: !!f.primary,
      placeholder: f.placeholder ? String(f.placeholder) : undefined,
      pattern: f.pattern ? String(f.pattern) : undefined,
      helper: f.helper ? String(f.helper) : undefined,
    }))
    .filter((f) => f.key.length > 0);
}

/** Pick a primary "enrollee_id" from captured values so old columns still populate. */
export function derivePrimaryEnrolleeId(
  fields: ProviderField[],
  data: Record<string, string>,
): string | null {
  const primary = fields.find((f) => f.primary);
  if (primary && data[primary.key]) return data[primary.key];
  const enrollee = fields.find((f) => f.key === 'enrollee_id');
  if (enrollee && data[enrollee.key]) return data[enrollee.key];
  const firstFilled = fields.find((f) => data[f.key]);
  return firstFilled ? data[firstFilled.key] : null;
}

/** Validate captured values against the field template. Returns [ok, errorsMap]. */
export function validateMemberFields(
  fields: ProviderField[],
  data: Record<string, string>,
): { ok: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const raw = (data[f.key] ?? '').trim();
    if (f.required && !raw) {
      errors[f.key] = `${f.label} is required`;
      continue;
    }
    if (raw && f.pattern) {
      try {
        const re = new RegExp(f.pattern);
        if (!re.test(raw)) errors[f.key] = `${f.label} format is invalid`;
      } catch { /* ignore bad regex from admin */ }
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/** Human-readable summary "Label: value · Label: value". */
export function summariseMemberData(
  fields: ProviderField[],
  data: Record<string, string> | null | undefined,
): string {
  if (!data) return '';
  return fields
    .filter((f) => data[f.key])
    .map((f) => `${f.label}: ${data[f.key]}`)
    .join(' · ');
}