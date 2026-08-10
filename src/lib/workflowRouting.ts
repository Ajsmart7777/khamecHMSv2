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
): Promise<WorkflowRouteStatus | null> {
  // 1. Check if this is a clinical invoice (linked to a snap)
  const { data: snaps, error: snapError } = await supabase
    .from('snap_orders')
    .select('target_station, status')
    .eq('invoice_id', invoiceId);

  if (snapError) throw new Error(snapError.message);

  // If no snaps are linked to this invoice, it is a custom bill.
  // Custom bills MUST NOT affect the patient's workflow status.
  if (!snaps || snaps.length === 0) {
    return null;
  }

  // 2. It's a clinical invoice. Check for ANY other outstanding station-level work for this patient.
  const pendingStation = await getPendingWorkflowStation(patientId);
  if (pendingStation) return pendingStation;

  // 3. No other pending work found via RPC, but let's check the targets for THIS invoice's snaps.
  const stations = snaps.map((row: any) => row.target_station);
  if (stations.includes('lab')) return 'in_lab';
  if (stations.includes('pharmacy')) return 'at_pharmacy';

  // Nothing pending anywhere → patient is done with the clinical visit.
  return 'discharged';
}