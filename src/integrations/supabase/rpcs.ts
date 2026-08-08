import { supabase } from "@/integrations/supabase/client";

/**
 * Frontend wrappers for clinical typed order RPCs.
 * These match the signatures in supabase/migrations/20260807_clinical_typed_orders.sql
 */

export async function createPrescriptionFromTyped(input: {
  patientId: string;
  visitId: string | null;
  diagnosis?: string;
  notes?: string;
  items: Array<{
    medication: string;
    dosage: string;
    frequency: string;
    duration: string;
    quantity: number;
  }>;
}) {
  const { data, error } = await (supabase.rpc as any)('create_prescription_from_typed', {
    _patient_id: input.patientId,
    _visit_id: input.visitId,
    _diagnosis: input.diagnosis || '',
    _notes: input.notes || '',
    _items: input.items,
  });
  if (error) throw error;
  return data as string; // returns UUID
}

export async function createLabRequestFromTyped(input: {
  patientId: string;
  visitId: string | null;
  diagnosis?: string;
  tests: string[];
}) {
  const { data, error } = await (supabase.rpc as any)('create_lab_request_from_typed', {
    _patient_id: input.patientId,
    _visit_id: input.visitId,
    _diagnosis: input.diagnosis || '',
    _tests: input.tests,
  });
  if (error) throw error;
  return data as string; // returns UUID
}

export async function finalizeReferral(referralId: string, filePath?: string) {
  const { data, error } = await (supabase.rpc as any)('finalize_referral', {
    _referral_id: referralId,
    _file_path: filePath,
  });
  if (error) throw error;
  return data as { referral_id: string; ref_number: string };
}

