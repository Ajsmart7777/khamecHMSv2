/**
 * Shared visibility rules for laboratory results.
 *
 * A returned lab result is available to Nurse, Doctor 1, and Doctor 2 at the
 * same time. `returned_to` is retained for audit/history compatibility, but it
 * is not used to hide the result from the other clinical workspaces.
 */

export type LabResultRow = {
  id: string;
  patient_id: string;
  order_type: string;
  status: string;
  returned_to: string | null;
  target_station: string | null;
};

export type StationKey = 'nurse' | 'doctor1' | 'doctor2' | 'clinical_team';

export function stationForRole(role: string | null | undefined, asParam: string | null = null): StationKey | null {
  const effectiveRole = role === 'admin' && asParam ? asParam : role;
  if (effectiveRole === 'nurse' || effectiveRole === 'doctor1' || effectiveRole === 'doctor2') return effectiveRole;
  return null;
}

/** The result target is a shared clinical team, not a single requester. */
export function labResultOrFilter(_userId: string, role: string | null | undefined, asParam: string | null = null): string {
  const station = stationForRole(role, asParam);
  return station ? 'target_station.eq.clinical_team' : 'target_station.eq.__no_clinical_access__';
}

export function canSeeLabResult(
  row: LabResultRow,
  _userId: string,
  role: string | null | undefined,
  asParam: string | null = null,
): boolean {
  if (!['lab', 'lab_result'].includes(row.order_type)) return false;
  if (row.status !== 'returned') return false;
  return Boolean(stationForRole(role, asParam)) && row.target_station === 'clinical_team';
}

export function selectInboxResults(
  rows: LabResultRow[],
  userId: string,
  role: string | null | undefined,
  admittedPatientIds: Iterable<string> = [],
  asParam: string | null = null,
): LabResultRow[] {
  const admitted = new Set(admittedPatientIds);
  return rows.filter((row) => canSeeLabResult(row, userId, role, asParam) && !admitted.has(row.patient_id));
}

/** Any accepted next action acknowledges the shared result for every queue. */
export function afterForward(
  row: LabResultRow,
  _newOwnerId: string | null,
  _newStation: string | null = null,
): LabResultRow {
  return { ...row, status: 'acknowledged', returned_to: null, target_station: 'clinical_team' };
}
