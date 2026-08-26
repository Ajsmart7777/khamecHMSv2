import { describe, expect, it } from 'vitest';
import {
  isOutpatientQueueStatus,
  labResultTargetStation,
  normalizeClinicalRole,
  ownerRoleForLabReturn,
  queueForPatient,
  shouldPreserveWardLocation,
  statusAfterClinicalOrder,
} from '@/lib/clinicWorkflowRouting';

describe('clinic workflow routing', () => {
  it('resolves the active workspace role for Admin sessions', () => {
    expect(normalizeClinicalRole('admin', 'nurse')).toBe('nurse');
    expect(normalizeClinicalRole('admin', 'doctor1')).toBe('doctor1');
    expect(normalizeClinicalRole('admin', 'doctor2')).toBe('doctor2');
    expect(normalizeClinicalRole('admin', 'doctor')).toBeNull();
    expect(normalizeClinicalRole('doctor1', 'doctor2')).toBe('doctor1');
  });

  it('keeps nurse-targeted clinical orders in the Nurse queue', () => {
    expect(statusAfterClinicalOrder('nurse')).toBe('with_nurse');
    expect(queueForPatient('with_nurse')).toBe('nurse');
    expect(queueForPatient('with_clinical_team')).toBe('clinical_team');
  });

  it('moves Lab and Pharmacy orders to Billing without a clinical queue owner', () => {
    expect(statusAfterClinicalOrder('lab')).toBe('awaiting_billing');
    expect(statusAfterClinicalOrder('pharmacy')).toBe('awaiting_billing');
    expect(queueForPatient('awaiting_billing')).toBeNull();
  });

  it('routes every returned result to the shared clinical team', () => {
    expect(labResultTargetStation('nurse')).toBe('clinical_team');
    expect(labResultTargetStation('doctor1')).toBe('clinical_team');
    expect(labResultTargetStation('doctor2')).toBe('clinical_team');
    expect(ownerRoleForLabReturn({ targetStation: 'nurse', senderRole: 'nurse' })).toBe('clinical_team');
    expect(ownerRoleForLabReturn({ targetStation: 'clinical_team', senderRole: 'doctor1', assignedDoctor: 'doctor1' })).toBe('clinical_team');
    expect(ownerRoleForLabReturn({ targetStation: 'clinical_team', senderRole: 'doctor2', assignedDoctor: 'doctor1' })).toBe('clinical_team');
  });

  it('keeps admitted patients in the ward while their orders continue through snaps', () => {
    expect(shouldPreserveWardLocation('admitted', true)).toBe(true);
    expect(shouldPreserveWardLocation('ready_for_discharge', false)).toBe(true);
    expect(shouldPreserveWardLocation('with_clinical_team', false)).toBe(false);
  });

  it('defines the shared outpatient clinical-team status', () => {
    expect(isOutpatientQueueStatus('waiting')).toBe(true);
    expect(isOutpatientQueueStatus('with_nurse')).toBe(true);
    expect(isOutpatientQueueStatus('with_clinical_team')).toBe(true);
    expect(isOutpatientQueueStatus('legacy_queue')).toBe(false);
    expect(isOutpatientQueueStatus('awaiting_payment')).toBe(false);
  });
});
