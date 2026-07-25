// HMO encounter/pre-auth helpers for the Claims Management workspace.
// Handles per-sponsor label logic, the 72-hour daily-claim window, and copy.

export type HmoCode = 'hygeia' | 'axa_mansard' | 'generic' | null | undefined;

export interface SponsorAuth {
  code?: string;
  notes?: string;
  captured_at?: string;
  captured_by?: string;
}

/** Detect HMO code from a provider row (matched by name) or from raw text. */
export function detectHmoCode(opts: {
  providerHmoCode?: string | null;
  providerName?: string | null;
  insurancePlan?: string | null;
}): HmoCode {
  if (opts.providerHmoCode) return opts.providerHmoCode as HmoCode;
  const hay = `${opts.providerName ?? ''} ${opts.insurancePlan ?? ''}`.toLowerCase();
  if (/hygeia/.test(hay)) return 'hygeia';
  if (/axa|mansard/.test(hay)) return 'axa_mansard';
  return null;
}

/** Label the Encounter/Pre-Auth code field per HMO. */
export function encounterCodeLabel(code: HmoCode, sponsorType?: string | null): string {
  if (code === 'axa_mansard') return 'AXA Mansard Encounter Code / OTP';
  if (code === 'hygeia') return 'Hygeia Pre-Auth / Token Number';
  if (code === 'generic') return 'HMO Encounter Code';
  const s = (sponsorType ?? '').toLowerCase();
  if (s === 'hmo') return 'HMO Encounter Code';
  if (s === 'nhia' || s === 'nhis') return 'NHIA Authorization Code';
  if (s === 'katchma') return 'KATCHMA Authorization Code';
  return 'Sponsor Authorization Code';
}

/** Placeholder hint per HMO. */
export function encounterCodePlaceholder(code: HmoCode): string {
  if (code === 'axa_mansard') return 'e.g. AXA-OTP-8493021';
  if (code === 'hygeia') return 'e.g. HYG-PA-778821';
  return 'Enter authorization / token number';
}

/** Copy text to the clipboard with a graceful fallback. */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}