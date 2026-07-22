ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS occupation TEXT;

ALTER TABLE public.patients
  ALTER COLUMN last_name DROP NOT NULL,
  ALTER COLUMN emergency_contact DROP NOT NULL;