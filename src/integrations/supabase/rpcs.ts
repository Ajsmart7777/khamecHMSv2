import { supabase } from "@/integrations/supabase/client";

/**
 * Frontend wrappers for clinical typed order RPCs.
 * The emergency variants attach the clinical record to an open episode and
 * deliberately defer billing until the episode is reconciled.
 */

export async function createPrescriptionFromTyped(input: {
  patientId: string;
  visitId: string | null;
  emergencyEpisodeId?: string | null;
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
  const rpcName = input.emergencyEpisodeId
    ? 'create_emergency_prescription_from_typed'
    : 'create_prescription_from_typed';
  const args = input.emergencyEpisodeId
    ? {
        _episode_id: input.emergencyEpisodeId,
        _patient_id: input.patientId,
        _visit_id: input.visitId,
        _diagnosis: input.diagnosis || '',
        _notes: input.notes || '',
        _items: input.items,
      }
    : {
        _patient_id: input.patientId,
        _visit_id: input.visitId,
        _diagnosis: input.diagnosis || '',
        _notes: input.notes || '',
        _items: input.items,
      };
  const { data, error } = await (supabase.rpc as any)(rpcName, args);
  if (error) throw error;
  return data as string;
}

export async function createLabRequestFromTyped(input: {
  patientId: string;
  visitId: string | null;
  emergencyEpisodeId?: string | null;
  diagnosis?: string;
  tests: string[];
}) {
  const rpcName = input.emergencyEpisodeId
    ? 'create_emergency_lab_from_typed'
    : 'create_lab_request_from_typed';
  const args = input.emergencyEpisodeId
    ? {
        _episode_id: input.emergencyEpisodeId,
        _patient_id: input.patientId,
        _visit_id: input.visitId,
        _diagnosis: input.diagnosis || '',
        _tests: input.tests,
      }
    : {
        _patient_id: input.patientId,
        _visit_id: input.visitId,
        _diagnosis: input.diagnosis || '',
        _tests: input.tests,
      };
  const { data, error } = await (supabase.rpc as any)(rpcName, args);
  if (error) throw error;
  return data as string;
}

export async function finalizeReferral(referralId: string, filePath?: string) {
  const { data, error } = await supabase.rpc('finalize_referral', {
    _referral_id: referralId,
    _file_path: filePath,
  });
  if (error) throw error;
  return data as { referral_id: string; ref_number: string };
}
