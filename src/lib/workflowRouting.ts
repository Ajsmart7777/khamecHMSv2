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
  const { data, error } = await supabase
    .from('snap_orders')
    .select('target_station, status, created_at')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  const stations = (data || []).map((row: any) => row.target_station);
  if (stations.includes('lab')) return 'in_lab';
  if (stations.includes('pharmacy')) return 'at_pharmacy';

  const pendingStation = await getPendingWorkflowStation(patientId);
  if (pendingStation === 'in_lab' || pendingStation === 'at_pharmacy') return pendingStation;

  return fallback;
}