-- Optional payroll batching: one locked payroll period may be paid in one or more auditable batches.
-- Existing payroll periods and payment attempts remain valid; batch_id is nullable for history.

CREATE TABLE IF NOT EXISTS public.payroll_payment_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_period_id uuid NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'flutterwave',
  batch_number integer NOT NULL DEFAULT 1,
  label text NOT NULL DEFAULT 'Payroll batch',
  status text NOT NULL DEFAULT 'processing',
  requested_count integer NOT NULL DEFAULT 0,
  requested_amount numeric NOT NULL DEFAULT 0,
  provider_batch_id text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(payroll_period_id, provider, batch_number)
);

ALTER TABLE public.payroll_payments
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.payroll_payment_batches(id) ON DELETE SET NULL;

ALTER TABLE public.payroll_payments
  ADD COLUMN IF NOT EXISTS batch_number integer;

CREATE INDEX IF NOT EXISTS payroll_payment_batches_period_idx
  ON public.payroll_payment_batches (payroll_period_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payroll_payments_batch_idx
  ON public.payroll_payments (batch_id, created_at DESC);

ALTER TABLE public.payroll_payment_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Payroll roles can read payment batches"
  ON public.payroll_payment_batches FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'accountant'::app_role, 'admin'::app_role]));

CREATE POLICY "Payroll roles can insert payment batches"
  ON public.payroll_payment_batches FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'accountant'::app_role, 'admin'::app_role]));

CREATE POLICY "Payroll roles can update payment batches"
  ON public.payroll_payment_batches FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'accountant'::app_role, 'admin'::app_role]));

GRANT SELECT, INSERT, UPDATE ON public.payroll_payment_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.payroll_payment_batches TO service_role;
