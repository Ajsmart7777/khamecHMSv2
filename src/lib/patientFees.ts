import { supabase } from '@/integrations/supabase/client';

export type PatientFeeType = 'registration' | 'consultation';

export interface PatientFeeStatus {
  id: string;
  patient_id: string;
  fee_type: PatientFeeType;
  period_start: string;
  status: 'unpaid' | 'paid';
  marked_paid_at: string | null;
  marked_paid_by: string | null;
}

export function monthStart(date = new Date()): string {
  const local = new Date(date.getFullYear(), date.getMonth(), 1);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-01`;
}

export const LIFETIME_REGISTRATION_PERIOD = '0001-01-01';

function normalizePeriodStart(value: unknown): string {
  return String(value ?? '').slice(0, 10);
}

export async function getPatientFeeStatuses(patientId: string, periodStart = monthStart()) {
  const { data, error } = await supabase
    .from('patient_fee_status')
    .select('id, patient_id, fee_type, period_start, status, marked_paid_at, marked_paid_by')
    .eq('patient_id', patientId)
    .in('period_start', [LIFETIME_REGISTRATION_PERIOD, periodStart]);
  if (error) throw error;
  return (data || []).map((row) => ({
    ...row,
    period_start: normalizePeriodStart(row.period_start),
  })) as PatientFeeStatus[];
}

export async function markPatientFeePaid(
  patientId: string,
  feeType: PatientFeeType,
  periodStart = feeType === 'registration' ? LIFETIME_REGISTRATION_PERIOD : monthStart(),
) {
  const { data, error } = await supabase.rpc('mark_patient_fee_paid', {
    _patient_id: patientId,
    _fee_type: feeType,
    _period_start: periodStart,
  });
  if (error) throw error;
  return data as { status: 'paid'; fee_type: PatientFeeType; period_start: string; marked_paid_at: string };
}

export function hasPaidFee(statuses: PatientFeeStatus[], feeType: PatientFeeType) {
  const period = feeType === 'registration' ? LIFETIME_REGISTRATION_PERIOD : monthStart();
  return statuses.some(s => s.fee_type === feeType && normalizePeriodStart(s.period_start) === period && s.status === 'paid');
}
