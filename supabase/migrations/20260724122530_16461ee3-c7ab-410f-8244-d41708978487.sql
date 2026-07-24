-- Extend claim workflow with rejected + info_requested states
ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS claim_reason_code text,
  ADD COLUMN IF NOT EXISTS claim_reason_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS claim_last_action_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_last_action_by uuid;

-- Widen the claim_status check constraint if one exists; otherwise add one.
DO $$
DECLARE _con text;
BEGIN
  SELECT conname INTO _con
    FROM pg_constraint
   WHERE conrelid = 'public.visits'::regclass
     AND contype  = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%claim_status%';
  IF _con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.visits DROP CONSTRAINT %I', _con);
  END IF;
  ALTER TABLE public.visits
    ADD CONSTRAINT visits_claim_status_check
    CHECK (claim_status IN ('not_applicable','pending','settled','rejected','info_requested'));
END $$;

CREATE INDEX IF NOT EXISTS idx_visits_claim_reason_code ON public.visits(claim_reason_code);

-- Mark a claim as rejected
CREATE OR REPLACE FUNCTION public.mark_claim_rejected(
  _visit_id uuid,
  _reason_code text,
  _notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _v RECORD;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['claims_manager','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only claims manager or admin can reject claims';
  END IF;
  IF _reason_code IS NULL OR length(trim(_reason_code)) = 0 THEN
    RAISE EXCEPTION 'A reason code is required';
  END IF;
  SELECT * INTO _v FROM public.visits WHERE id = _visit_id FOR UPDATE;
  IF _v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF _v.claim_status NOT IN ('pending','info_requested') THEN
    RAISE EXCEPTION 'Claim cannot be rejected from status: %', _v.claim_status;
  END IF;

  UPDATE public.visits
     SET claim_status = 'rejected',
         claim_reason_code = _reason_code,
         claim_notes = COALESCE(claim_notes,'') ||
                       CASE WHEN claim_notes IS NULL OR claim_notes = '' THEN '' ELSE E'\n' END ||
                       '[rejected:' || _reason_code || '] ' || COALESCE(_notes,''),
         claim_last_action_at = now(),
         claim_last_action_by = auth.uid(),
         updated_at = now()
   WHERE id = _visit_id;

  PERFORM public.write_audit_log(
    'claim_rejected', 'visit', _visit_id::text,
    jsonb_build_object(
      'visit_number', _v.visit_number,
      'patient_id', _v.patient_id,
      'sponsor_type', _v.sponsor_type,
      'insurance_plan', _v.insurance_plan,
      'total_charged', _v.total_charged,
      'reason_code', _reason_code,
      'notes', _notes
    )
  );
END;
$$;

-- Request more information from the patient/scheme for a claim
CREATE OR REPLACE FUNCTION public.request_claim_info(
  _visit_id uuid,
  _reason_code text,
  _notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _v RECORD;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['claims_manager','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only claims manager or admin can request more info';
  END IF;
  IF _reason_code IS NULL OR length(trim(_reason_code)) = 0 THEN
    RAISE EXCEPTION 'A reason code is required';
  END IF;
  SELECT * INTO _v FROM public.visits WHERE id = _visit_id FOR UPDATE;
  IF _v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF _v.claim_status NOT IN ('pending','info_requested') THEN
    RAISE EXCEPTION 'Cannot request info from status: %', _v.claim_status;
  END IF;

  UPDATE public.visits
     SET claim_status = 'info_requested',
         claim_reason_code = _reason_code,
         claim_notes = COALESCE(claim_notes,'') ||
                       CASE WHEN claim_notes IS NULL OR claim_notes = '' THEN '' ELSE E'\n' END ||
                       '[info_requested:' || _reason_code || '] ' || COALESCE(_notes,''),
         claim_last_action_at = now(),
         claim_last_action_by = auth.uid(),
         updated_at = now()
   WHERE id = _visit_id;

  PERFORM public.write_audit_log(
    'claim_info_requested', 'visit', _visit_id::text,
    jsonb_build_object(
      'visit_number', _v.visit_number,
      'patient_id', _v.patient_id,
      'sponsor_type', _v.sponsor_type,
      'insurance_plan', _v.insurance_plan,
      'reason_code', _reason_code,
      'notes', _notes
    )
  );
END;
$$;

-- Allow reopening from rejected / info_requested too
CREATE OR REPLACE FUNCTION public.reopen_claim(_visit_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _v RECORD;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['claims_manager','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only claims manager or admin can reopen a claim';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  SELECT * INTO _v FROM public.visits WHERE id = _visit_id FOR UPDATE;
  IF _v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF _v.claim_status NOT IN ('settled','rejected','info_requested') THEN
    RAISE EXCEPTION 'Claim is not in a reopenable state (current: %)', _v.claim_status;
  END IF;

  UPDATE public.visits
     SET claim_status = 'pending',
         claim_settled_at = NULL,
         claim_settled_by = NULL,
         claim_reason_code = NULL,
         claim_notes = COALESCE(claim_notes,'') || E'\n[reopened] ' || _reason,
         claim_last_action_at = now(),
         claim_last_action_by = auth.uid(),
         updated_at = now()
   WHERE id = _visit_id;

  PERFORM public.write_audit_log(
    'claim_reopened', 'visit', _visit_id::text,
    jsonb_build_object('reason', _reason, 'from_status', _v.claim_status)
  );
END;
$$;