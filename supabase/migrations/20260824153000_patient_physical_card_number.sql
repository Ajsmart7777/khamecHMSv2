ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS physical_card_number TEXT;

CREATE INDEX IF NOT EXISTS idx_patients_physical_card_number
  ON public.patients (physical_card_number);

COMMENT ON COLUMN public.patients.physical_card_number IS
  'Optional card number copied from an existing patient physical card; card_number remains the system-generated Patient ID.';
