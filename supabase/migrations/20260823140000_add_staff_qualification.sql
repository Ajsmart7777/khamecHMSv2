-- Cockroach-only compatibility migration: store staff qualification separately from designation.
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS qualification TEXT;
