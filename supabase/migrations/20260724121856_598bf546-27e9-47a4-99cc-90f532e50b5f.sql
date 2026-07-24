
ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS claim_status text NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS claim_settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_settled_by uuid,
  ADD COLUMN IF NOT EXISTS claim_notes text;

-- Backfill: insured sponsored visits that are already settled become "pending claim"
UPDATE public.visits
   SET claim_status = 'pending'
 WHERE status = 'settled'
   AND sponsor_type IN ('nhia','hmo','katchma','staff','staff_family')
   AND claim_status = 'not_applicable';

-- Corporate/retainer are handled by the accountant module — leave 'not_applicable'.

CREATE INDEX IF NOT EXISTS idx_visits_claim_status ON public.visits(claim_status);

-- Only claims_manager / admin can set claim_status
CREATE OR REPLACE FUNCTION public.mark_claim_settled(_visit_id uuid, _notes text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _v RECORD;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['claims_manager','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only claims manager or admin can settle claims';
  END IF;
  SELECT * INTO _v FROM public.visits WHERE id = _visit_id FOR UPDATE;
  IF _v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF _v.claim_status <> 'pending' THEN
    RAISE EXCEPTION 'Claim is not pending (current: %)', _v.claim_status;
  END IF;

  UPDATE public.visits
     SET claim_status = 'settled',
         claim_settled_at = now(),
         claim_settled_by = auth.uid(),
         claim_notes = COALESCE(_notes, claim_notes),
         updated_at = now()
   WHERE id = _visit_id;

  PERFORM public.write_audit_log(
    'claim_settled', 'visit', _visit_id::text,
    jsonb_build_object(
      'visit_number', _v.visit_number,
      'patient_id', _v.patient_id,
      'sponsor_type', _v.sponsor_type,
      'insurance_plan', _v.insurance_plan,
      'total_charged', _v.total_charged,
      'notes', _notes
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_claim(_visit_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admin can reopen a settled claim';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  UPDATE public.visits
     SET claim_status = 'pending',
         claim_settled_at = NULL,
         claim_settled_by = NULL,
         claim_notes = COALESCE(claim_notes,'') || E'\n[reopened] ' || _reason,
         updated_at = now()
   WHERE id = _visit_id AND claim_status = 'settled';
  PERFORM public.write_audit_log(
    'claim_reopened', 'visit', _visit_id::text,
    jsonb_build_object('reason', _reason)
  );
END;
$$;
