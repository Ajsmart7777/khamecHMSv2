import type { PatientStatus } from '@/types/hms';

export type ClinicalOrderTarget = 'nurse' | 'lab' | 'pharmacy' | 'billing';
export type ClinicalOwnerRole = 'nurse' | 'doctor1' | 'doctor2' | 'clinical_team';

const wardStatuses: PatientStatus[] = ['admitted', 'ready_for_discharge', 'awaiting_room'];

export function normalizeClinicalRole(role?: string | null, asParam?: string | null): 'nurse' | 'doctor1' | 'doctor2' | null {
  const candidate = String(role === 'admin' && asParam ? asParam : role ?? '').trim().toLowerCase();
  return candidate === 'nurse' || candidate === 'doctor1' || candidate === 'doctor2' ? candidate : null;
}

export function statusAfterClinicalOrder(target: ClinicalOrderTarget): PatientStatus {
  return target === 'nurse' ? 'with_nurse' : 'awaiting_billing';
}

/** Returned results are visible to the shared clinical team, never a generic Doctor bucket. */
export function labResultTargetStation(_senderRole?: string | null): 'clinical_team' {
  return 'clinical_team';
}

export function ownerRoleForLabReturn(_input: {
  targetStation?: string | null;
  senderRole?: string | null;
  assignedDoctor?: 'doctor1' | 'doctor2' | null;
}): ClinicalOwnerRole {
  return 'clinical_team';
}

export function shouldPreserveWardLocation(status: string | null | undefined, hasActiveAdmission: boolean) {
  return hasActiveAdmission || wardStatuses.includes(status as PatientStatus);
}

export function queueForPatient(status: string | null | undefined, assignedDoctor?: 'doctor1' | 'doctor2' | null) {
  if (status === 'with_nurse') return 'nurse';
  if (status === 'with_clinical_team') return 'clinical_team';
  return null;
}

export function isOutpatientQueueStatus(status: string | null | undefined) {
  return status === 'waiting' || status === 'with_nurse' || status === 'with_clinical_team';
}
