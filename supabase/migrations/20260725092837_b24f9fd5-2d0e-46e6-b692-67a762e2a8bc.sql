
ALTER TABLE public.eligibility_verifications
  ALTER COLUMN patient_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS prospective_patient_name text,
  ADD COLUMN IF NOT EXISTS prospective_patient_phone text,
  ADD COLUMN IF NOT EXISTS insurance_details text,
  ADD COLUMN IF NOT EXISTS reception_snap_path text,
  ADD COLUMN IF NOT EXISTS verification_snap_path text,
  ADD COLUMN IF NOT EXISTS verified_enrollee_id text,
  ADD COLUMN IF NOT EXISTS verified_plan text,
  ADD COLUMN IF NOT EXISTS verified_provider_name text,
  ADD COLUMN IF NOT EXISTS consumed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS consumed_patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL;

-- Ensure at least a patient_id OR a prospective name is present
ALTER TABLE public.eligibility_verifications
  DROP CONSTRAINT IF EXISTS eligibility_has_subject;
ALTER TABLE public.eligibility_verifications
  ADD CONSTRAINT eligibility_has_subject
  CHECK (patient_id IS NOT NULL OR (prospective_patient_name IS NOT NULL AND length(trim(prospective_patient_name)) > 0));
