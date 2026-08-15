import type { PatientStatus } from '@/types/hms';

export type ClinicalOrderTarget = 'nurse' | 'lab' | 'pharmacy' | 'billing';
export type ClinicalOwnerRole = 'nurse' | 'doctor1' | 'doctor2';

const wardStatuses: PatientStatus[] = ['admitted', 'ready_for_discharge', 'awaiting_room'];

export function statusAfterClinicalOrder(target: ClinicalOrderTarget): PatientStatus {
  return target === 'nurse' ? 'with_nurse' : 'awaiting_billing';
}

export function ownerRoleForLabReturn(input: {
  targetStation: 'nurse' | 'doctor';
  senderRole?: string | null;
  assignedDoctor?: 'doctor1' | 'doctor2' | null;
}): ClinicalOwnerRole {
  if (input.targetStation === 'nurse') return 'nurse';
  if (input.senderRole === 'doctor2' || input.assignedDoctor === 'doctor2') return 'doctor2';
  return 'doctor1';
}

export function shouldPreserveWardLocation(status: string | null | undefined, hasActiveAdmission: boolean) {
  return hasActiveAdmission || wardStatuses.includes(status as PatientStatus);
}

export function queueForPatient(status: string | null | undefined, assignedDoctor?: 'doctor1' | 'doctor2' | null) {
  if (status === 'with_nurse') return 'nurse';
  if (status === 'with_doctor') return assignedDoctor ?? 'doctor1';
  return null;
}

export function isOutpatientQueueStatus(status: string | null | undefined) {
  return status === 'waiting' || status === 'with_nurse' || status === 'with_doctor';
}
