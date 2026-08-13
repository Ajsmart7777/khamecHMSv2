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
      ) THEN 'An insurance claim remains unresolved' END,
      CASE WHEN closed_at IS NULL OR closed_at > now() - interval '24 hours'
        THEN 'The case must remain closed for at least 24 hours before archiving' END
    ], NULL);

    is_eligible := COALESCE(cardinality(v_reasons), 0) = 0;
    reasons := COALESCE(v_reasons, ARRAY[]::text[]);
    case_fingerprint := public.patient_archive_case_fingerprint(v_patient.id);
    RETURN NEXT;
  END LOOP;
END;
$$;

