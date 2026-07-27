
CREATE OR REPLACE FUNCTION public.discharge_patient(_patient_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _v RECORD;
  _outstanding numeric;
  _is_sponsored boolean := false;
  _new_claim text;
  _closed_visit_id uuid := NULL;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin','billing','cashier','accountant']::app_role[]) THEN
    RAISE EXCEPTION 'Not permitted to discharge patients';
  END IF;

  -- Find the patient's open visit (if any)
  SELECT * INTO _v FROM public.visits
   WHERE patient_id = _patient_id AND status = 'open'
   ORDER BY opened_at DESC LIMIT 1;

  IF _v.id IS NOT NULL THEN
    PERFORM public.recalc_visit_totals(_v.id);
    SELECT * INTO _v FROM public.visits WHERE id = _v.id;

    _is_sponsored := _v.sponsor_type IS NOT NULL
                     AND lower(_v.sponsor_type) IN ('katchma','nhis','nhia','hmo','corporate','retainer','staff','staff_family');
    _outstanding := COALESCE(_v.total_charged,0) - COALESCE(_v.total_paid,0);

    IF NOT _is_sponsored AND _outstanding > 0 THEN
      RAISE EXCEPTION 'Cash patient still owes ₦% — collect payment at Cashier before discharge', _outstanding;
    END IF;

    _new_claim := _v.claim_status;
    IF _v.claim_status = 'not_applicable'
       AND COALESCE(_v.total_charged,0) > 0
       AND _is_sponsored
       AND lower(_v.sponsor_type) IN ('katchma','nhis','nhia','hmo','corporate','retainer')
    THEN
      _new_claim := 'pending';
    END IF;

    UPDATE public.visits
       SET status = 'settled',
           closed_at = now(),
           closed_by = _uid,
           claim_status = _new_claim,
           claim_last_action_at = CASE WHEN _new_claim <> _v.claim_status THEN now() ELSE claim_last_action_at END,
           claim_last_action_by = CASE WHEN _new_claim <> _v.claim_status THEN _uid ELSE claim_last_action_by END,
           updated_at = now()
     WHERE id = _v.id;

    _closed_visit_id := _v.id;

    PERFORM public.write_audit_log(
      'visit_settled_on_discharge', 'visit', _v.id::text,
      jsonb_build_object(
        'visit_number', _v.visit_number,
        'patient_id', _v.patient_id,
        'sponsor_type', _v.sponsor_type,
        'total_charged', _v.total_charged,
        'total_paid', _v.total_paid,
        'outstanding', _outstanding,
        'claim_status', _new_claim,
        'reason', _reason
      ), 'success'
    );
  END IF;

  UPDATE public.patients
     SET status = 'discharged', updated_at = now()
   WHERE id = _patient_id;

  PERFORM public.advance_journey(
    _patient_id, 'discharged', NULL, _uid, NULL, NULL, _closed_visit_id, _reason
  );

  PERFORM public.write_audit_log(
    'patient_discharged', 'patient', _patient_id::text,
    jsonb_build_object('visit_id', _closed_visit_id, 'reason', _reason), 'success'
  );

  RETURN jsonb_build_object('visit_id', _closed_visit_id, 'sponsored', _is_sponsored);
END;
$$;

GRANT EXECUTE ON FUNCTION public.discharge_patient(uuid, text) TO authenticated;
