-- Archive policy revision:
-- 1. Discharged cases can be archived as soon as all workflow and finance blockers are resolved.
-- 2. The retained patient account balance is never reset when detailed history is cleared.

CREATE OR REPLACE FUNCTION public.check_archive_eligibility(_patient_ids uuid[])
RETURNS TABLE (
  patient_id uuid,
  patient_card_number text,
  patient_name text,
  is_eligible boolean,
  reasons text[],
  closed_at timestamptz,
  row_counts jsonb,
  attachment_paths jsonb,
  case_fingerprint text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_requested_id uuid;
  v_patient public.patients%ROWTYPE;
  v_journey_state text;
  v_reasons text[];
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can check archive eligibility';
  END IF;

  FOREACH v_requested_id IN ARRAY COALESCE(_patient_ids, ARRAY[]::uuid[])
  LOOP
    SELECT * INTO v_patient
    FROM public.patients p
    WHERE p.id = v_requested_id;

    IF NOT FOUND THEN
      patient_id := v_requested_id;
      patient_card_number := NULL;
      patient_name := 'Unknown patient';
      is_eligible := false;
      reasons := ARRAY['Patient record was not found'];
      closed_at := NULL;
      row_counts := '{}'::jsonb;
      attachment_paths := '[]'::jsonb;
      case_fingerprint := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT pj.current_state INTO v_journey_state
    FROM public.patient_journey pj
    WHERE pj.patient_id = v_patient.id
    ORDER BY pj.updated_at DESC NULLS LAST, pj.created_at DESC NULLS LAST
    LIMIT 1;

    patient_id := v_patient.id;
    patient_card_number := v_patient.card_number;
    patient_name := trim(concat_ws(' ', v_patient.first_name, v_patient.last_name));
    closed_at := (
      SELECT max(v.updated_at)
      FROM public.visits v
      WHERE v.patient_id = v_patient.id
        AND v.status::text = 'settled'
    );

    row_counts := jsonb_build_object(
      'visits', (SELECT count(*) FROM public.visits WHERE patient_id = v_patient.id),
      'admissions', (SELECT count(*) FROM public.admissions WHERE patient_id = v_patient.id),
      'invoices', (SELECT count(*) FROM public.invoices WHERE patient_id = v_patient.id),
      'invoice_items', (SELECT count(*) FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = v_patient.id)),
      'prescriptions', (SELECT count(*) FROM public.prescriptions WHERE patient_id = v_patient.id),
      'lab_requests', (SELECT count(*) FROM public.lab_requests WHERE patient_id = v_patient.id),
      'snap_orders', (SELECT count(*) FROM public.snap_orders WHERE patient_id = v_patient.id),
      'referral_letters', (SELECT count(*) FROM public.referral_letters WHERE patient_id = v_patient.id),
      'attachments', (
        (SELECT count(*) FROM public.visit_attachments WHERE patient_id = v_patient.id) +
        (SELECT count(*) FROM public.emr_attachments WHERE patient_id = v_patient.id)
      )
    );

    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('bucket', p.bucket, 'path', p.path, 'source', p.source) ORDER BY p.bucket, p.path, p.source),
      '[]'::jsonb
    ) INTO attachment_paths
    FROM (
      SELECT DISTINCT 'visit-cards'::text AS bucket, so.photo_path AS path, 'snap_orders.photo_path'::text AS source
      FROM public.snap_orders so
      WHERE so.patient_id = v_patient.id AND NULLIF(btrim(so.photo_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'visit-cards', va.storage_path, 'visit_attachments.storage_path'
      FROM public.visit_attachments va
      WHERE va.patient_id = v_patient.id AND NULLIF(btrim(va.storage_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'visit-cards', a.admission_snap_path, 'admissions.admission_snap_path'
      FROM public.admissions a
      WHERE a.patient_id = v_patient.id AND NULLIF(btrim(a.admission_snap_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'visit-cards', ev.reception_snap_path, 'eligibility_verifications.reception_snap_path'
      FROM public.eligibility_verifications ev
      WHERE ev.patient_id = v_patient.id AND NULLIF(btrim(ev.reception_snap_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'visit-cards', ev.verification_snap_path, 'eligibility_verifications.verification_snap_path'
      FROM public.eligibility_verifications ev
      WHERE ev.patient_id = v_patient.id AND NULLIF(btrim(ev.verification_snap_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'emr-attachments', ea.file_path, 'emr_attachments.file_path'
      FROM public.emr_attachments ea
      WHERE ea.patient_id = v_patient.id AND NULLIF(btrim(ea.file_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'emr-attachments', rl.file_path, 'referral_letters.file_path'
      FROM public.referral_letters rl
      WHERE rl.patient_id = v_patient.id AND NULLIF(btrim(rl.file_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'external-url', sto.photo_url, 'standing_orders.photo_url'
      FROM public.standing_orders sto
      WHERE sto.patient_id = v_patient.id AND NULLIF(btrim(sto.photo_url), '') IS NOT NULL
    ) p;

    v_reasons := array_remove(ARRAY[
      CASE WHEN NOT EXISTS (
        SELECT 1 FROM public.visits v WHERE v.patient_id = v_patient.id AND v.status::text = 'settled'
      ) THEN 'No settled visit exists' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.visits v WHERE v.patient_id = v_patient.id AND v.status::text <> 'settled'
      ) THEN 'An active or unsettled visit still exists' END,
      CASE WHEN COALESCE(v_journey_state, '') <> 'discharged'
        THEN 'Patient journey is not discharged' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.admissions a
        WHERE a.patient_id = v_patient.id
          AND a.status IN ('waiting_assignment', 'active', 'ready_for_discharge')
      ) THEN 'An active admission still exists' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.invoices i
        WHERE i.patient_id = v_patient.id AND i.status::text IN ('pending', 'partial')
      ) THEN 'An unpaid or partially paid invoice exists' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.lab_requests lr
        WHERE lr.patient_id = v_patient.id AND lr.status::text = 'pending'
      ) THEN 'A laboratory request is pending' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.prescriptions pr
        WHERE pr.patient_id = v_patient.id AND pr.status::text = 'pending'
      ) THEN 'A pharmacy prescription is pending' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.snap_orders so
        WHERE so.patient_id = v_patient.id AND so.status::text = 'awaiting_payment'
      ) THEN 'A snap order awaits payment' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.balance_requests br
        WHERE br.patient_id = v_patient.id AND br.status::text = 'pending'
      ) THEN 'A patient balance request is pending' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.standing_orders sto
        WHERE sto.patient_id = v_patient.id
          AND COALESCE(sto.status::text, '') NOT IN ('completed', 'cancelled', 'closed', 'returned')
      ) THEN 'A standing order or external referral is unresolved' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.referral_letters rl
        WHERE rl.patient_id = v_patient.id
          AND COALESCE(rl.status::text, '') NOT IN ('final', 'completed', 'sent', 'closed', 'cancelled')
      ) THEN 'A referral letter is unfinished' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.insurance_claims ic
        WHERE ic.patient_id = v_patient.id
          AND COALESCE(ic.status::text, '') NOT IN ('paid', 'settled', 'closed', 'cancelled', 'rejected', 'denied')
      ) THEN 'An insurance claim remains unresolved' END
    ], NULL);

    is_eligible := COALESCE(cardinality(v_reasons), 0) = 0;
    reasons := COALESCE(v_reasons, ARRAY[]::text[]);
    case_fingerprint := public.patient_archive_case_fingerprint(v_patient.id);
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_archived_cases(
  _patient_ids uuid[],
  _archive_reference text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reference text := btrim(COALESCE(_archive_reference, ''));
  v_patient_id uuid;
  v_record public.patient_archive_records%ROWTYPE;
  v_eligibility record;
  v_expected_count integer;
  v_statement_ids uuid[];
  v_purged_count integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can purge verified archives';
  END IF;

  IF v_reference = '' OR COALESCE(array_length(_patient_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Archive reference and at least one patient are required';
  END IF;

  IF (SELECT count(DISTINCT x) FROM unnest(_patient_ids) AS x) <> array_length(_patient_ids, 1) THEN
    RAISE EXCEPTION 'Duplicate patient identifiers are not allowed';
  END IF;

  SELECT count(*) INTO v_expected_count
  FROM public.patient_archive_records r
  WHERE r.archive_reference = v_reference
    AND r.patient_id = ANY(_patient_ids)
    AND r.status = 'download_confirmed';

  IF v_expected_count <> array_length(_patient_ids, 1) THEN
    RAISE EXCEPTION 'Every selected patient must have a download-confirmed archive with this reference';
  END IF;

  FOR v_patient_id IN SELECT unnest(_patient_ids)
  LOOP
    SELECT * INTO v_record
    FROM public.patient_archive_records r
    WHERE r.archive_reference = v_reference
      AND r.patient_id = v_patient_id
      AND r.status = 'download_confirmed'
    FOR UPDATE;

    SELECT * INTO v_eligibility
    FROM public.check_archive_eligibility(ARRAY[v_patient_id]);

    IF NOT v_eligibility.is_eligible THEN
      RAISE EXCEPTION 'Patient % is no longer eligible for purge: %',
        v_patient_id, array_to_string(v_eligibility.reasons, '; ');
    END IF;

    IF v_eligibility.case_fingerprint IS DISTINCT FROM v_record.case_fingerprint THEN
      RAISE EXCEPTION 'Patient % changed after archive preparation. Prepare and verify a new ZIP before purge.', v_patient_id;
    END IF;
  END LOOP;

  SELECT COALESCE(array_agg(DISTINCT ssi.statement_id), ARRAY[]::uuid[])
  INTO v_statement_ids
  FROM public.sponsor_statement_items ssi
  WHERE ssi.patient_id = ANY(_patient_ids);

  DELETE FROM public.invoice_items
  WHERE invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = ANY(_patient_ids));
  DELETE FROM public.sponsor_statement_items WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.insurance_claims WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.balance_transactions WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.balance_requests WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.corporate_transactions ct
  WHERE ct.related_statement_id = ANY(v_statement_ids)
    AND NOT EXISTS (
      SELECT 1 FROM public.sponsor_statement_items remaining
      WHERE remaining.statement_id = ct.related_statement_id
    );
  DELETE FROM public.sponsor_statements ss
  WHERE ss.id = ANY(v_statement_ids)
    AND NOT EXISTS (
      SELECT 1 FROM public.sponsor_statement_items remaining
      WHERE remaining.statement_id = ss.id
    );
  DELETE FROM public.invoices WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.prescription_items
  WHERE prescription_id IN (SELECT id FROM public.prescriptions WHERE patient_id = ANY(_patient_ids));
  DELETE FROM public.prescriptions WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.lab_requests WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.vitals WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.snap_orders WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.standing_orders WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.referral_letters WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.visit_attachments WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.emr_attachments WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.eligibility_verifications WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.patient_journey_history WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.patient_journey WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.admissions WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.visits WHERE patient_id = ANY(_patient_ids);

  -- Preserve the patient wallet/account balance exactly as it was at the verified purge.
  -- The account remains reusable for a future visit without creating a duplicate patient.
  UPDATE public.patients
  SET status = 'registered',
      last_visit = NULL,
      updated_at = now()
  WHERE id = ANY(_patient_ids);

  UPDATE public.patient_archive_records
  SET status = 'purged',
      purged_at = now(),
      purged_by = auth.uid()
  WHERE archive_reference = v_reference
    AND patient_id = ANY(_patient_ids)
    AND status = 'download_confirmed';

  GET DIAGNOSTICS v_purged_count = ROW_COUNT;

  PERFORM public.write_audit_log(
    'purge_archived_cases',
    'patient_archive_records',
    v_reference,
    jsonb_build_object('patient_ids', _patient_ids, 'patient_count', v_purged_count),
    'success'
  );

  RETURN v_purged_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_archive_eligibility(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_archived_cases(uuid[], text) TO authenticated;
