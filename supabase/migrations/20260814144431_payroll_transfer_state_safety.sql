-- Preserve provider failure reasons and correct stale payroll entries whose latest
-- provider result is already failed or reversed.
ALTER TABLE public.payroll_payments
  ADD COLUMN IF NOT EXISTS failure_reason text;

-- A transfer attempt that Flutterwave/Paystack has already rejected must never leave
-- its linked salary entry shown as "processing".  Only the latest attempt per entry
-- is considered, so an active retry remains untouched.
WITH latest_payment AS (
  SELECT DISTINCT ON (payroll_entry_id)
    payroll_entry_id,
    status
  FROM public.payroll_payments
  ORDER BY payroll_entry_id, created_at DESC
)
UPDATE public.payroll_entries AS entry
SET status = latest_payment.status
FROM latest_payment
WHERE entry.id = latest_payment.payroll_entry_id
  AND entry.status = 'processing'
  AND latest_payment.status IN ('failed', 'reversed');

COMMENT ON COLUMN public.payroll_payments.failure_reason IS
  'Provider-returned reason for a failed or reversed payroll transfer attempt.';
