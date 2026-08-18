-- CockroachDB clone compatibility cleanup.
-- The 7-argument settlement routine overlaps the canonical 8-argument
-- routine because the latter has a default salary-deduction flag. Removing
-- the obsolete overload makes both 7- and 8-argument calls resolve to the
-- canonical implementation.
DROP FUNCTION IF EXISTS public.settle_invoice_atomic(
  uuid,
  numeric,
  numeric,
  numeric,
  text,
  text,
  boolean
);

-- The legacy four-argument audit helper overlaps the canonical five-argument
-- helper whose status has a default. Existing four-argument callers should
-- resolve to the canonical helper after this legacy overload is removed.
DROP FUNCTION IF EXISTS public.write_audit_log(
  text,
  text,
  text,
  jsonb
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
