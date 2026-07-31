import { ADMISSION_PERMS, type AdmissionAction } from '@/lib/admissionPermissions';

const ACTION_LABELS: Record<AdmissionAction, string> = {
  admit: 'Admit patient',
  assignBed: 'Assign ward / room / bed',
  forwardSnap: 'Send snap to Pharmacy / Lab',
  admittedSnap: 'Create admitted snap',
  dischargeOrder: 'Sign discharge order',
  discharge: 'Complete discharge',
  waiveDebt: 'Waive outstanding debt',
};

/** Postgres/PostgREST signals that mean "server rejected this on permissions". */
export function isPermissionError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  const code = error.code ?? '';
  const msg = (error.message ?? '').toLowerCase();
  return (
    code === '42501' ||
    code === 'PGRST301' ||
    /not_permitted|permission denied|not authorized|unauthorized|only .* (can|may)|insufficient/.test(msg)
  );
}

/**
 * Human-readable message for a server-side permission rejection, naming the
 * roles that are allowed to perform the action.
 */
export function permissionErrorMessage(
  action: AdmissionAction,
  currentRole?: string | null,
  fallback?: string,
) {
  const allowed = (ADMISSION_PERMS[action] as readonly string[]).join(', ');
  const label = ACTION_LABELS[action] ?? action;
  const who = currentRole ? `Your role "${currentRole}" ` : 'Your account ';
  return {
    title: `Not permitted: ${label}`,
    description:
      `${who}is missing the required permission. Allowed roles: ${allowed}.` +
      (fallback ? ` Server said: ${fallback}` : ''),
  };
}
