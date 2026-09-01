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
 * Determine the next station by checking what actually remains pending
 * for a patient's CURRENT open visit only. The original DB RPC
 * `patient_pending_workflow_station` checks ALL visits, which causes
 * stale items from old visits to route patients incorrectly.
 *
 * This frontend function queries snap_orders and invoices scoped to
 * the current open visit to determine the correct next station.
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

  // 2. Check for unfilled snap_orders for this visit
  const { data: pendingSnaps } = await supabase
    .from('snap_orders')
    .select('target_station, status')
    .eq('patient_id', patientId)
    .eq('visit_id', openVisit.id)
    .in('status', ['pending_billing', 'awaiting_payment', 'paid'])
    .limit(1);

  if (pendingSnaps && pendingSnaps.length > 0) {
    const station = pendingSnaps[0].target_station;
    if (station === 'pharmacy') return 'at_pharmacy';
    if (station === 'lab') return 'in_lab';
    if (station === 'billing' || station === 'clinical_team') return 'awaiting_billing';
  }

  // 3. Check for unpaid invoices for this visit
  const { data: unpaidInvoices } = await supabase
    .from('invoices')
    .select('id')
    .eq('patient_id', patientId)
    .eq('visit_id', openVisit.id)
    .in('status', ['pending', 'partial'])
    .limit(1);

  if (unpaidInvoices && unpaidInvoices.length > 0) {
    return 'awaiting_payment';
  }

  // 4. Check for pending lab requests for this visit (not yet snap-converted)
  const { data: pendingLabs } = await supabase
    .from('lab_requests')
    .select('id')
    .eq('patient_id', patientId)
    .eq('visit_id', openVisit.id)
    .in('status', ['ordered', 'pending'])
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
 */
export async function nextStationForInvoice(
  invoiceId: string,
  patientId: string,
  fallback: WorkflowRouteStatus = 'at_pharmacy',
): Promise<WorkflowRouteStatus | null> {
  // 1. Check if this is a clinical invoice (linked to a snap)
  const { data: snaps, error: snapError } = await supabase
    .from('snap_orders')
    .select('target_station, status, visit_id')
    .eq('invoice_id', invoiceId);

  if (snapError) throw new Error(snapError.message);

  // If no snaps are linked to this invoice, it is a custom bill.
  // Custom bills MUST NOT affect the patient's workflow status.
  if (!snaps || snaps.length === 0) {
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
    // 3. Check for remaining unfilled snaps for THIS visit only
    const { data: remainingSnaps } = await supabase
      .from('snap_orders')
      .select('target_station, status')
      .eq('patient_id', patientId)
      .eq('visit_id', visitId)
      .in('status', ['pending_billing', 'awaiting_payment', 'paid'])
      .neq('invoice_id', invoiceId) // Exclude the invoice we just settled
      .limit(1);

    if (remainingSnaps && remainingSnaps.length > 0) {
      const station = remainingSnaps[0].target_station;
      if (station === 'pharmacy') return 'at_pharmacy';
      if (station === 'lab') return 'in_lab';
      if (station === 'billing' || station === 'clinical_team') return 'awaiting_billing';
    }

    // 4. Check for other unpaid invoices for THIS visit
    const { data: otherUnpaid } = await supabase
      .from('invoices')
      .select('id')
      .eq('patient_id', patientId)
      .eq('visit_id', visitId)
      .eq('status', 'pending')
      .neq('id', invoiceId)
      .limit(1);

    if (otherUnpaid && otherUnpaid.length > 0) {
      return 'awaiting_payment';
    }
  }

  // 5. Check the targets for THIS invoice's snaps
  const stations = snaps.map((row: any) => row.target_station);
  if (stations.includes('lab')) return 'in_lab';
  if (stations.includes('pharmacy')) return 'at_pharmacy';

  // Nothing pending anywhere → patient is done with the clinical visit.
  return 'discharged';
}