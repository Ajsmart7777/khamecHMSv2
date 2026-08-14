-- Allow laboratory staff to return a result as typed text instead of an image.
-- The existing photo_path remains available for the snap workflow; both fields may
-- coexist so a lab result can include typed interpretation plus a supporting image.
ALTER TABLE public.snap_orders
  ADD COLUMN IF NOT EXISTS result_text text;

COMMENT ON COLUMN public.snap_orders.result_text IS
  'Typed laboratory result returned to the requesting clinical station; optional when photo_path is used.';

CREATE INDEX IF NOT EXISTS idx_snap_orders_lab_result_text
  ON public.snap_orders (patient_id, order_type, created_at DESC)
  WHERE order_type = 'lab_result' AND result_text IS NOT NULL;

NOTIFY pgrst, 'reload schema';
