-- The archive register intentionally uses ON DELETE SET NULL so a deliberate full-patient
-- purge can retain its historical archive evidence.  Its patient reference must therefore
-- be nullable; the original NOT NULL declaration made the Admin Danger Zone purge fail.
ALTER TABLE public.patient_archive_records
  ALTER COLUMN patient_id DROP NOT NULL;
