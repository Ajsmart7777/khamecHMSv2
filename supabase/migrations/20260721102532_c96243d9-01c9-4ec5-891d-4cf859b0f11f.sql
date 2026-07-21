-- Add insurance_plan and katchma/claims_manager support
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS insurance_plan TEXT;

DO $$ BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'claims_manager';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;