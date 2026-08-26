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
  order_type: 'lab',
  status: 'returned',
  returned_to: NURSE,
  target_station: 'clinical_team',
  ...over,
});

describe('stationForRole', () => {
  it('recognizes all three clinical roles and Admin workspace aliases', () => {
    expect(stationForRole('nurse')).toBe('nurse');
    expect(stationForRole('doctor1')).toBe('doctor1');
    expect(stationForRole('doctor2')).toBe('doctor2');
    expect(stationForRole('admin', 'nurse')).toBe('nurse');
    expect(stationForRole('admin', 'doctor1')).toBe('doctor1');
  });
});

describe('labResultOrFilter', () => {
  it('scopes every clinical role to the shared clinical-team target', () => {
    expect(labResultOrFilter(NURSE, 'nurse')).toBe('target_station.eq.clinical_team');
    expect(labResultOrFilter(DOC1, 'doctor1')).toBe('target_station.eq.clinical_team');
    expect(labResultOrFilter(DOC2, 'doctor2')).toBe('target_station.eq.clinical_team');
  });

  it('does not grant the shared result filter to unrelated roles', () => {
    expect(labResultOrFilter(DOC1, 'lab_tech')).toBe('target_station.eq.__no_clinical_access__');
  });
});

describe('canSeeLabResult — shared clinical-team visibility', () => {
  it('shows one returned result to Nurse, Doctor 1, and Doctor 2', () => {
    const r = row({ returned_to: DOC1 });
    expect(canSeeLabResult(r, NURSE, 'nurse')).toBe(true);
    expect(canSeeLabResult(r, DOC1, 'doctor1')).toBe(true);
    expect(canSeeLabResult(r, DOC2, 'doctor2')).toBe(true);
  });

  it('also supports Admin acting through a clinical workspace', () => {
    expect(canSeeLabResult(row(), 'admin-user', 'admin', 'nurse')).toBe(true);
    expect(canSeeLabResult(row(), 'admin-user', 'admin', 'doctor1')).toBe(true);
  });

  it('rejects legacy single-station rows until the database migration normalizes them', () => {
    expect(canSeeLabResult(row({ target_station: 'nurse' }), NURSE, 'nurse')).toBe(false);
    expect(canSeeLabResult(row({ target_station: 'legacy_station' }), DOC1, 'doctor1')).toBe(false);
  });

  it('accepts both normal and emergency lab result order types', () => {
    expect(canSeeLabResult(row({ order_type: 'lab' }), NURSE, 'nurse')).toBe(true);
    expect(canSeeLabResult(row({ order_type: 'lab_result' }), DOC1, 'doctor1')).toBe(true);
  });

  it('ignores acknowledged or non-lab rows', () => {
    expect(canSeeLabResult(row({ status: 'acknowledged' }), NURSE, 'nurse')).toBe(false);
    expect(canSeeLabResult(row({ order_type: 'prescription' }), NURSE, 'nurse')).toBe(false);
  });
});

describe('selectInboxResults', () => {
  const rows = [
    row({ id: 'a', patient_id: 'pat-1', returned_to: NURSE }),
    row({ id: 'b', patient_id: 'pat-2', returned_to: DOC1 }),
    row({ id: 'c', patient_id: 'pat-3', returned_to: DOC2 }),
  ];

  it('gives the same shared result set to all three clinical roles', () => {
    expect(selectInboxResults(rows, NURSE, 'nurse').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(selectInboxResults(rows, DOC1, 'doctor1').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(selectInboxResults(rows, DOC2, 'doctor2').map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('hides admitted patients from the outpatient inbox', () => {
    expect(selectInboxResults(rows, DOC1, 'doctor1', ['pat-2']).map((r) => r.id)).toEqual(['a', 'c']);
  });
});

describe('shared acknowledgement', () => {
  it('removes the result from every clinical queue after any next action', () => {
    const acknowledged = afterForward(row(), NURSE, 'nurse');
    expect(acknowledged.status).toBe('acknowledged');
    expect(canSeeLabResult(acknowledged, NURSE, 'nurse')).toBe(false);
    expect(canSeeLabResult(acknowledged, DOC1, 'doctor1')).toBe(false);
    expect(canSeeLabResult(acknowledged, DOC2, 'doctor2')).toBe(false);
  });
});
