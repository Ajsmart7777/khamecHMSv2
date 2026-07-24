CREATE OR REPLACE FUNCTION public.close_visit(_visit_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _v RECORD; _new_claim text;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['billing','cashier','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only billing/cashier/admin can settle a visit';
  END IF;
  PERFORM public.recalc_visit_totals(_visit_id);
  SELECT * INTO _v FROM public.visits WHERE id = _visit_id;
  IF _v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF _v.status <> 'open' THEN RAISE EXCEPTION 'Visit is already %', _v.status; END IF;

  -- Auto-flip claim_status to 'pending' for sponsored/insured visits with charges.
  _new_claim := _v.claim_status;
  IF _v.claim_status = 'not_applicable'
     AND COALESCE(_v.total_charged, 0) > 0
     AND _v.sponsor_type IS NOT NULL
     AND lower(_v.sponsor_type) IN ('katchma','nhis','nhia','hmo','corporate','retainer','staff')
  THEN
    _new_claim := 'pending';
  END IF;

  UPDATE public.visits
    SET status = 'settled',
        closed_at = now(),
        closed_by = auth.uid(),
        claim_status = _new_claim,
        claim_last_action_at = CASE WHEN _new_claim <> _v.claim_status THEN now() ELSE claim_last_action_at END,
        claim_last_action_by = CASE WHEN _new_claim <> _v.claim_status THEN auth.uid() ELSE claim_last_action_by END,
        updated_at = now()
  WHERE id = _visit_id;

  PERFORM public.write_audit_log(
    'visit_settled', 'visit', _visit_id::text,
    jsonb_build_object(
      'visit_number', _v.visit_number,
      'patient_id', _v.patient_id,
      'sponsor_type', _v.sponsor_type,
      'total_charged', _v.total_charged,
      'total_paid', _v.total_paid,
      'claim_status', _new_claim
    )
  );
END; $function$;