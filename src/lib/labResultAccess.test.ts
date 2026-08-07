import { describe, it, expect } from 'vitest';
import {
  canSeeLabResult,
  labResultOrFilter,
  selectInboxResults,
  stationForRole,
  afterForward,
  type LabResultRow,
} from '@/lib/labResultAccess';

const NURSE = 'user-nurse';
const DOC1 = 'user-doc1';
const DOC2 = 'user-doc2';

const row = (over: Partial<LabResultRow> = {}): LabResultRow => ({
  id: 'snap-1',
  patient_id: 'pat-1',
  order_type: 'lab_result',
  status: 'returned',
  returned_to: NURSE,
  target_station: 'nurse',
  ...over,
});

describe('stationForRole', () => {
  it('maps nurse to nurse and both doctors to the doctor station', () => {
    expect(stationForRole('nurse')).toBe('nurse');
    expect(stationForRole('doctor1')).toBe('doctor');
    expect(stationForRole('doctor2')).toBe('doctor');
  });
});

describe('labResultOrFilter', () => {
  it('always scopes to returned_to of the current user', () => {
    expect(labResultOrFilter(DOC1, 'doctor1')).toBe(
      `returned_to.eq.${DOC1},and(returned_to.is.null,target_station.eq.doctor)`,
    );
  });

  it('never contains a bare station clause that could fan out', () => {
    const f = labResultOrFilter(DOC2, 'doctor2');
    expect(f).not.toMatch(/(^|,)target_station\.eq\./);
  });
});

describe('canSeeLabResult — strict single-owner visibility', () => {
  it('shows the result to the requester only', () => {
    const r = row({ returned_to: DOC1, target_station: 'doctor' });
    expect(canSeeLabResult(r, DOC1, 'doctor1')).toBe(true);
    expect(canSeeLabResult(r, DOC2, 'doctor2')).toBe(false);
    expect(canSeeLabResult(r, NURSE, 'nurse')).toBe(false);
  });

  it('does not leak a nurse-requested result to doctors', () => {
    const r = row({ returned_to: NURSE, target_station: 'nurse' });
    expect(canSeeLabResult(r, NURSE, 'nurse')).toBe(true);
    expect(canSeeLabResult(r, DOC1, 'doctor1')).toBe(false);
    expect(canSeeLabResult(r, DOC2, 'doctor2')).toBe(false);
  });

  it('falls back to station only for legacy ownerless rows', () => {
    const legacy = row({ returned_to: null, target_station: 'doctor' });
    expect(canSeeLabResult(legacy, DOC1, 'doctor1')).toBe(true);
    expect(canSeeLabResult(legacy, NURSE, 'nurse')).toBe(false);
  });

  it('ignores non lab_result or non returned rows', () => {
    expect(canSeeLabResult(row({ order_type: 'lab' }), NURSE, 'nurse')).toBe(false);
    expect(canSeeLabResult(row({ status: 'acknowledged' }), NURSE, 'nurse')).toBe(false);
  });
});

describe('selectInboxResults', () => {
  const rows = [
    row({ id: 'a', returned_to: NURSE, target_station: 'nurse' }),
    row({ id: 'b', patient_id: 'pat-2', returned_to: DOC1, target_station: 'doctor' }),
    row({ id: 'c', patient_id: 'pat-3', returned_to: DOC2, target_station: 'doctor' }),
  ];

  it('gives each user only their own results', () => {
    expect(selectInboxResults(rows, NURSE, 'nurse').map((r) => r.id)).toEqual(['a']);
    expect(selectInboxResults(rows, DOC1, 'doctor1').map((r) => r.id)).toEqual(['b']);
    expect(selectInboxResults(rows, DOC2, 'doctor2').map((r) => r.id)).toEqual(['c']);
  });

  it('hides admitted patients from the outpatient inbox', () => {
    expect(selectInboxResults(rows, DOC1, 'doctor1', ['pat-2'])).toEqual([]);
  });
});

describe('forwarding', () => {
  it('removes the row from the previous owner and gives it to the new one', () => {
    const original = row({ returned_to: DOC1, target_station: 'doctor' });
    const forwarded = afterForward(original, NURSE, 'nurse');

    expect(canSeeLabResult(forwarded, DOC1, 'doctor1')).toBe(false);
    expect(canSeeLabResult(forwarded, DOC2, 'doctor2')).toBe(false);
    expect(selectInboxResults([forwarded], DOC2, 'doctor2')).toEqual([]);
  });

  it('doctor1 forwarding to nurse does not leave a copy at doctor2', () => {
    const inbox = [row({ id: 'x', returned_to: DOC1, target_station: 'doctor' })];
    const after = inbox.map((r) => afterForward(r, NURSE, 'nurse'));
    expect(selectInboxResults(after, DOC1, 'doctor1')).toEqual([]);
    expect(selectInboxResults(after, DOC2, 'doctor2')).toEqual([]);
  });
});
