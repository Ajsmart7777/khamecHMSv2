ALTER TABLE public.snap_orders
  ADD COLUMN IF NOT EXISTS ocr_reviewed_lines jsonb,
  ADD COLUMN IF NOT EXISTS ocr_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ocr_reviewed_by uuid;