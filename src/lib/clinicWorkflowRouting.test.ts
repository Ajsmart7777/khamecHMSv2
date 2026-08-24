import { describe, expect, it } from 'vitest';
import {
  isOutpatientQueueStatus,
  labResultTargetStation,
  ownerRoleForLabReturn,
  queueForPatient,
  shouldPreserveWardLocation,
  statusAfterClinicalOrder,
} from '@/lib/clinicWorkflowRouting';

describe('clinic workflow routing', () => {
  it('moves a Doctor treatment referral to the Nurse queue', () => {
    expect(statusAfterClinicalOrder('nurse')).toBe('with_nurse');
    expect(queueForPatient('with_nurse')).toBe('nurse');
    expect(queueForPatient('with_doctor', 'doctor1')).toBe('doctor1');
  });

  it('moves Lab and Pharmacy orders to billing without keeping the patient in Doctor queue', () => {
    expect(statusAfterClinicalOrder('lab')).toBe('awaiting_billing');
    expect(statusAfterClinicalOrder('pharmacy')).toBe('awaiting_billing');
    expect(queueForPatient('awaiting_billing')).toBeNull();
  });

  it('routes a returned result to the exact requester station and doctor workspace', () => {
    expect(labResultTargetStation(' nurse ')).toBe('nurse');
    expect(labResultTargetStation('NURSE')).toBe('nurse');
    expect(labResultTargetStation('doctor1')).toBe('doctor');
    expect(ownerRoleForLabReturn({ targetStation: 'nurse', senderRole: 'nurse' })).toBe('nurse');
    expect(ownerRoleForLabReturn({ targetStation: 'doctor', senderRole: 'doctor1', assignedDoctor: 'doctor1' })).toBe('doctor1');
    expect(ownerRoleForLabReturn({ targetStation: 'doctor', senderRole: 'doctor2', assignedDoctor: 'doctor1' })).toBe('doctor2');
    expect(ownerRoleForLabReturn({ targetStation: 'doctor', senderRole: 'doctor', assignedDoctor: 'doctor2' })).toBe('doctor2');
  });

  it('keeps admitted patients in the ward while their orders continue through snaps', () => {
    expect(shouldPreserveWardLocation('admitted', true)).toBe(true);
    expect(shouldPreserveWardLocation('ready_for_discharge', false)).toBe(true);
    expect(shouldPreserveWardLocation('with_doctor', false)).toBe(false);
  });

  it('defines the outpatient statuses that should appear in station queues', () => {
    expect(isOutpatientQueueStatus('waiting')).toBe(true);
    expect(isOutpatientQueueStatus('with_nurse')).toBe(true);
    expect(isOutpatientQueueStatus('with_doctor')).toBe(true);
    expect(isOutpatientQueueStatus('awaiting_payment')).toBe(false);
  });
});
