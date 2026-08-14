-- Remove the legacy overload that omits _is_salary_deduction.
-- Keeping two functions with identical leading parameters and defaults makes
-- Supabase/PostgREST unable to choose a best candidate for Cashier RPC calls.
-- The eight-argument routine is the canonical implementation and preserves
-- full, under, over, sponsored, wallet, and salary-deduction settlement paths.
DROP FUNCTION IF EXISTS public.settle_invoice_atomic(
  uuid,
  numeric,
  numeric,
  numeric,
  text,
  text,
  boolean
);

GRANT EXECUTE ON FUNCTION public.settle_invoice_atomic(
  uuid,
  numeric,
  numeric,
  numeric,
  text,
  text,
  boolean,
  boolean
) TO authenticated;
