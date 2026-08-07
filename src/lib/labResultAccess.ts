/**
 * Single source of truth for "who owns a lab result".
 *
 * A returned lab result belongs to the EXACT user who created the original
 * lab snap (`returned_to`). It must never fan out to a whole station, because
 * doctor1 and doctor2 share `target_station = 'doctor'`.
 */

export type LabResultRow = {
  id: string;
  patient_id: string;
  order_type: string;
  status: string;
  returned_to: string | null;
  target_station: string | null;
};

export type StationKey = 'nurse' | 'doctor';

/** Station bucket used only as a legacy fallback for rows with no owner. */
export function stationForRole(role: string | null | undefined): StationKey {
  return role === 'nurse' ? 'nurse' : 'doctor';
}

/** PostgREST `.or()` expression: mine, or legacy ownerless rows for my station. */
export function labResultOrFilter(userId: string, role: string | null | undefined): string {
  const station = stationForRole(role);
  return `returned_to.eq.${userId},and(returned_to.is.null,target_station.eq.${station})`;
}

/** Client-side guard mirroring the server filter. */
export function canSeeLabResult(
  row: LabResultRow,
  userId: string,
  role: string | null | undefined,
): boolean {
  if (row.order_type !== 'lab_result') return false;
  if (row.status !== 'returned') return false;
  if (row.returned_to) return row.returned_to === userId;
  return row.target_station === stationForRole(role);
}

/** Full inbox selection: owned results, excluding admitted patients. */
export function selectInboxResults(
  rows: LabResultRow[],
  userId: string,
  role: string | null | undefined,
  admittedPatientIds: Iterable<string> = [],
): LabResultRow[] {
  const admitted = new Set(admittedPatientIds);
  return rows.filter((r) => canSeeLabResult(r, userId, role) && !admitted.has(r.patient_id));
}

/**
 * Forwarding / acknowledging transfers ownership away from the current user,
 * so the row must leave their inbox immediately.
 */
export function afterForward(
  row: LabResultRow,
  newOwnerId: string | null,
  newStation: string | null = null,
): LabResultRow {
  return {
    ...row,
    status: 'acknowledged',
    returned_to: newOwnerId,
    target_station: newStation ?? row.target_station,
  };
}
