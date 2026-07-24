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

export async function getPendingWorkflowStation(patientId: string): Promise<PendingWorkflowStation | null> {
  const { data, error } = await supabase.rpc('patient_pending_workflow_station' as any, {
    _patient_id: patientId,
  });

  if (error) throw new Error(error.message);
  return isPendingWorkflowStation(data) ? data : null;
}

export async function nextStationForInvoice(
  invoiceId: string,
  patientId: string,
  fallback: WorkflowRouteStatus = 'at_pharmacy',
): Promise<WorkflowRouteStatus> {
  // Source of truth = the DB view of any *unfinished* work for this patient.
  // Fulfilled/rejected snaps are excluded there, so a paid-and-dispensed
  // pharmacy snap does not falsely route the patient back to pharmacy.
  const pendingStation = await getPendingWorkflowStation(patientId);
  if (pendingStation) return pendingStation;

  // No outstanding station-level work — check what this specific invoice
  // originated from in case the snap has not yet been marked paid.
  const { data, error } = await supabase
    .from('snap_orders')
    .select('target_station, status')
    .eq('invoice_id', invoiceId)
    .in('status', ['pending_billing', 'awaiting_payment', 'paid']);

  if (error) throw new Error(error.message);

  const stations = (data || []).map((row: any) => row.target_station);
  if (stations.includes('lab')) return 'in_lab';
  if (stations.includes('pharmacy')) return 'at_pharmacy';

  // Nothing pending anywhere → patient is done.
  return 'discharged';
}