import { supabase } from '@/integrations/supabase/client';
import { PatientStatus } from '@/types/hms';

export type PendingWorkflowStation = Extract<
  PatientStatus,
  'awaiting_billing' | 'awaiting_payment' | 'in_lab' | 'at_pharmacy'
>;

export type WorkflowRouteStatus = PendingWorkflowStation | 'discharged';

const pendingStations: PendingWorkflowStation[] = [
  'awaiting_billing',
  'awaiting_payment',
  'in_lab',
  'at_pharmacy',
];

function isPendingWorkflowStation(value: unknown): value is PendingWorkflowStation {
  return typeof value === 'string' && pendingStations.includes(value as PendingWorkflowStation);
}

export function workflowStationLabel(status: WorkflowRouteStatus) {
  const labels: Record<WorkflowRouteStatus, string> = {
    awaiting_billing: 'Billing',
    awaiting_payment: 'Cashier',
    in_lab: 'Lab',
    at_pharmacy: 'Pharmacy',
    discharged: 'Discharged',
  };
  return labels[status];
}

/**
 * Snap intents that belong to the Emergency Episode billing track. Items on
 * this track are billed and settled separately; they must never block the
 * normal patient flow or move the patient between stations.
 */
const EMERGENCY_SNAP_INTENTS = ['emergency_episode', 'emergency_billing_draft', 'emergency_remainder'];

function isEmergencySnap(snap: { emergency_episode_id?: string | null; intent?: string | null }): boolean {
  return !!snap.emergency_episode_id || EMERGENCY_SNAP_INTENTS.includes(String(snap.intent ?? ''));
}

/**
 * True when every snap linked to the invoice belongs to an Emergency Episode.
 * Settling such an invoice is part of the separate emergency billing track and
 * must never change the patient's workflow status.
 */
export async function isEmergencyOnlyInvoice(invoiceId: string): Promise<boolean> {
  const { data: snaps } = await supabase
    .from('snap_orders')
    .select('emergency_episode_id, intent')
    .eq('invoice_id', invoiceId)
    .limit(25);
  if (!snaps || snaps.length === 0) return false;
  return snaps.every(isEmergencySnap);
}

/**
 * Determine the next station by checking what actually remains pending
 * for a patient's CURRENT open visit only. The original DB RPC
 * `patient_pending_workflow_station` checks ALL visits, which causes
 * stale items from old visits to route patients incorrectly.
 *
 * This frontend function queries snap_orders, invoices, and lab_requests
 * scoped to the current open visit to determine the correct next station.
 * Emergency-episode snaps/invoices are excluded everywhere: they are a
 * separate billing track that must not move or block the patient.
 */
export async function getPendingWorkflowStation(patientId: string): Promise<PendingWorkflowStation | null> {
  // 1. Find the patient's current open visit
  const { data: openVisit } = await supabase
    .from('visits')
    .select('id')
    .eq('patient_id', patientId)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!openVisit) {
    // No open visit — check the DB RPC as a fallback for edge cases
    // (e.g. emergency episodes without visits)
    const { data, error } = await supabase.rpc('patient_pending_workflow_station' as any, {
      _patient_id: patientId,
    });
    if (error) throw new Error(error.message);
    return isPendingWorkflowStation(data) ? data : null;
  }

  // 2. Check for unfilled snap_orders for this visit.
  //    Exclude emergency episode snaps — those create a separate billing track
  //    that must never block normal patient flow routing.
  const { data: pendingSnaps } = await supabase
    .from('snap_orders')
    .select('target_station, status')
    .eq('patient_id', patientId)
    .eq('visit_id', openVisit.id)
    .in('status', ['pending_billing', 'awaiting_payment', 'paid'])
    .is('emergency_episode_id', null)
    .limit(10);

  if (pendingSnaps && pendingSnaps.length > 0) {
    // Mirror patient_pending_workflow_station precedence: billing first,
    // then cashier, then the paid work waiting at its target station.
    // A pending_billing pharmacy order means the patient waits at Billing,
    // not prematurely at the pharmacy.
    if (pendingSnaps.some((row: any) => row.status === 'pending_billing')) return 'awaiting_billing';
    if (pendingSnaps.some((row: any) => row.status === 'awaiting_payment')) return 'awaiting_payment';
    if (pendingSnaps.some((row: any) => row.status === 'paid' && row.target_station === 'lab')) return 'in_lab';
    if (pendingSnaps.some((row: any) => row.status === 'paid' && row.target_station === 'pharmacy')) return 'at_pharmacy';
  }

  // 3. Check for unpaid invoices for this visit.
  //    Emergency-only invoices (emergency episode billing) must not block or
  //    move the patient, so they are excluded here.
  const { data: unpaidInvoices } = await supabase
    .from('invoices')
    .select('id')
    .eq('patient_id', patientId)
    .eq('visit_id', openVisit.id)
    .in('status', ['pending', 'partial'])
    .limit(10);

  if (unpaidInvoices && unpaidInvoices.length > 0) {
    for (const inv of unpaidInvoices) {
      if (!(await isEmergencyOnlyInvoice(inv.id))) return 'awaiting_payment';
    }
  }

  // 4. Check for pending lab requests for this visit (not yet snap-converted).
  //    Emergency lab requests are authorized/performed immediately on the
  //    emergency track and must not route the patient into the normal lab queue.
  const { data: pendingLabs } = await supabase
    .from('lab_requests')
    .select('id')
    .eq('patient_id', patientId)
    .eq('visit_id', openVisit.id)
    .in('status', ['ordered', 'pending'])
    .is('emergency_episode_id', null)
    .limit(1);

  if (pendingLabs && pendingLabs.length > 0) {
    return 'in_lab';
  }

  // Nothing pending for this visit
  return null;
}

/**
 * Determine where a patient should go after an invoice is settled.
 * Scoped to the current visit to avoid stale cross-visit routing.
 * Emergency-episode invoices return null — settling them never moves
 * the patient between stations.
 */
export async function nextStationForInvoice(
  invoiceId: string,
  patientId: string,
  fallback: WorkflowRouteStatus = 'at_pharmacy',
): Promise<WorkflowRouteStatus | null> {
  // 1. Check if this is a clinical invoice (linked to a snap)
  const { data: snaps, error: snapError } = await supabase
    .from('snap_orders')
    .select('target_station, status, visit_id, emergency_episode_id, intent')
    .eq('invoice_id', invoiceId);

  if (snapError) throw new Error(snapError.message);

  // If no snaps are linked to this invoice, it is a custom bill.
  // Custom bills MUST NOT affect the patient's workflow status.
  if (!snaps || snaps.length === 0) {
    return null;
  }

  // Emergency-episode invoices are a separate billing track. Settling them
  // must never move the patient between stations.
  if (snaps.every(isEmergencySnap)) {
    return null;
  }

  // 2. Find the current open visit
  const { data: openVisit } = await supabase
    .from('visits')
    .select('id')
    .eq('patient_id', patientId)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const visitId = openVisit?.id ?? snaps[0]?.visit_id;

  if (visitId) {
    // 3. Check for remaining unfilled snaps for THIS visit only.
    //    Exclude emergency episode snaps — they have their own billing track
    //    and must never keep a patient stuck at billing after normal orders
    //    are fully paid and dispensed.
    const { data: remainingSnaps } = await supabase
      .from('snap_orders')
      .select('target_station, status')
      .eq('patient_id', patientId)
      .eq('visit_id', visitId)
      .in('status', ['pending_billing', 'awaiting_payment', 'paid'])
      .is('emergency_episode_id', null)
      .neq('invoice_id', invoiceId) // Exclude the invoice we just settled
      .limit(10);

    if (remainingSnaps && remainingSnaps.length > 0) {
      // Mirror patient_pending_workflow_station precedence. A pending_billing
      // order means the patient still waits at Billing, not at the target.
      if (remainingSnaps.some((row: any) => row.status === 'pending_billing')) return 'awaiting_billing';
      if (remainingSnaps.some((row: any) => row.status === 'awaiting_payment')) return 'awaiting_payment';
      if (remainingSnaps.some((row: any) => row.status === 'paid' && row.target_station === 'lab')) return 'in_lab';
      if (remainingSnaps.some((row: any) => row.status === 'paid' && row.target_station === 'pharmacy')) return 'at_pharmacy';
    }

    // 4. Check for other unpaid invoices for THIS visit.
    //    Exclude invoices that belong to emergency episodes — those are a
    //    separate billing track and must not keep the patient stuck at billing.
    const { data: otherUnpaid } = await supabase
      .from('invoices')
      .select('id')
      .eq('patient_id', patientId)
      .eq('visit_id', visitId)
      .eq('status', 'pending')
      .neq('id', invoiceId)
      .limit(10);

    if (otherUnpaid && otherUnpaid.length > 0) {
      for (const inv of otherUnpaid) {
        if (!(await isEmergencyOnlyInvoice(inv.id))) return 'awaiting_payment';
      }
    }
  }

  // 5. Check the targets for THIS invoice's non-emergency snaps. The invoice
  //    was just settled, so paid snaps point at the station where the work
  //    happens; anything still awaiting billing/payment keeps the patient at
  //    that station.
  const nonEmergencySnaps = snaps.filter((row: any) => !isEmergencySnap(row));
  if (nonEmergencySnaps.some((row: any) => row.status === 'paid' && row.target_station === 'lab')) return 'in_lab';
  if (nonEmergencySnaps.some((row: any) => row.status === 'paid' && row.target_station === 'pharmacy')) return 'at_pharmacy';
  if (nonEmergencySnaps.some((row: any) => row.status === 'awaiting_payment')) return 'awaiting_payment';
  if (nonEmergencySnaps.some((row: any) => row.status === 'pending_billing')) return 'awaiting_billing';

  // Nothing pending anywhere → patient is done with the clinical visit.
  return 'discharged';
}