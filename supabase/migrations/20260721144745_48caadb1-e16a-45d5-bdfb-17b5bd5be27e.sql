
-- Blank any patients.corporate_id values that are not valid UUIDs so the type change succeeds
UPDATE public.patients
   SET corporate_id = NULL
 WHERE corporate_id IS NOT NULL
   AND corporate_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

ALTER TABLE public.patients
  ALTER COLUMN corporate_id TYPE uuid USING corporate_id::uuid;

-- Ensure referential integrity (skip if already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patients_corporate_id_fkey'
  ) THEN
    ALTER TABLE public.patients
      ADD CONSTRAINT patients_corporate_id_fkey
      FOREIGN KEY (corporate_id) REFERENCES public.corporate_accounts(id) ON DELETE SET NULL;
  END IF;
END $$;
