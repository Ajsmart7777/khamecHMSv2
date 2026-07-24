ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS sponsor_auth jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sponsor_auth_captured_at timestamptz;

ALTER TABLE public.insurance_providers
  ADD COLUMN IF NOT EXISTS hmo_code text;

CREATE INDEX IF NOT EXISTS idx_insurance_providers_hmo_code
  ON public.insurance_providers (hmo_code) WHERE hmo_code IS NOT NULL;