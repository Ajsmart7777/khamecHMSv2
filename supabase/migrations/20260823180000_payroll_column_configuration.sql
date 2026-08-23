-- Persist the visible payroll header names per period.
-- Existing payroll values remain unchanged; the frontend maps legacy keys into the approved grid.
ALTER TABLE public.payroll_periods
  ADD COLUMN IF NOT EXISTS column_labels JSONB NOT NULL DEFAULT '{}'::jsonb;
