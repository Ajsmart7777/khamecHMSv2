
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS claim_submitted_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS claim_submitted_by uuid,
  ADD COLUMN IF NOT EXISTS claim_submission_notes text;

CREATE OR REPLACE FUNCTION public.mark_invoice_claim_submitted(
  _invoice_id uuid,
  _notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.has_role(_uid, 'admin'::app_role) OR public.has_role(_uid, 'claims_manager'::app_role)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.invoices
     SET claim_submitted_at = now(),
         claim_submitted_by = _uid,
         claim_submission_notes = COALESCE(_notes, claim_submission_notes)
   WHERE id = _invoice_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unmark_invoice_claim_submitted(
  _invoice_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.has_role(_uid, 'admin'::app_role) OR public.has_role(_uid, 'claims_manager'::app_role)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.invoices
     SET claim_submitted_at = NULL,
         claim_submitted_by = NULL
   WHERE id = _invoice_id;
END;
$$;
