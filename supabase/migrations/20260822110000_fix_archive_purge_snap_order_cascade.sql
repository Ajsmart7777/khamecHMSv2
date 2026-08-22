-- Fix archive purge ordering for CockroachDB.
-- snap_orders.invoice_id and snap_orders.parent_snap_id use ON DELETE SET NULL.
-- Deleting invoices or parent snap orders first causes CockroachDB to perform a
-- cascade UPDATE on snap_orders, which conflicts with trg_snap_orders_updated.
-- Remove the affected snap-order rows and clear self-links explicitly first.

CREATE OR REPLACE FUNCTION public.purge_archived_cases(_patient_ids uuid[], _archive_reference text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reference text := btrim(COALESCE(_archive_reference, ''));
  v_statement_ids uuid[];
  v_snap_order_ids uuid[];
  v_purged_count integer;
BEGIN
  IF NOT public.has_role(public.hms_current_user_id(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can purge verified archives';
  END IF;
  IF v_reference = '' OR COALESCE(array_length(_patient_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Archive reference and at least one patient are required';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(_patient_ids) AS x) <> array_length(_patient_ids, 1) THEN
    RAISE EXCEPTION 'Duplicate patient identifiers are not allowed';
  END IF;
  IF (SELECT count(*) FROM public.patient_archive_records r WHERE r.archive_reference = v_reference AND r.patient_id = ANY(_patient_ids) AND r.status = 'download_confirmed') <> array_length(_patient_ids, 1) THEN
    RAISE EXCEPTION 'Every selected patient must have a download-confirmed archive with this reference';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(_patient_ids) AS ids(patient_id)
    LEFT JOIN public.patient_archive_records r ON r.archive_reference = v_reference AND r.patient_id = ids.patient_id AND r.status = 'download_confirmed'
    LEFT JOIN LATERAL public.check_archive_eligibility(ARRAY[ids.patient_id]) e ON true
    WHERE r.id IS NULL OR NOT e.is_eligible OR e.case_fingerprint IS DISTINCT FROM r.case_fingerprint
  ) THEN
    RAISE EXCEPTION 'One or more patients changed after archive preparation. Prepare and verify a new ZIP before purge.';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT ssi.statement_id), ARRAY[]::uuid[]) INTO v_statement_ids
  FROM public.sponsor_statement_items ssi WHERE ssi.patient_id = ANY(_patient_ids);

  DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = ANY(_patient_ids));
  DELETE FROM public.sponsor_statement_items WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.insurance_claims WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.balance_transactions WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.balance_requests WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.corporate_transactions ct WHERE ct.related_statement_id = ANY(v_statement_ids) AND NOT EXISTS (SELECT 1 FROM public.sponsor_statement_items remaining WHERE remaining.statement_id = ct.related_statement_id);
  DELETE FROM public.sponsor_statements ss WHERE ss.id = ANY(v_statement_ids) AND NOT EXISTS (SELECT 1 FROM public.sponsor_statement_items remaining WHERE remaining.statement_id = ss.id);

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_snap_order_ids
  FROM public.snap_orders
  WHERE patient_id = ANY(_patient_ids);
  IF COALESCE(array_length(v_snap_order_ids, 1), 0) > 0 THEN
    UPDATE public.snap_orders
    SET parent_snap_id = NULL
    WHERE parent_snap_id = ANY(v_snap_order_ids);
    DELETE FROM public.snap_orders WHERE id = ANY(v_snap_order_ids);
  END IF;

  DELETE FROM public.invoices WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.prescription_items WHERE prescription_id IN (SELECT id FROM public.prescriptions WHERE patient_id = ANY(_patient_ids));
  DELETE FROM public.prescriptions WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.lab_requests WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.vitals WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.standing_orders WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.referral_letters WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.visit_attachments WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.emr_attachments WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.eligibility_verifications WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.patient_journey_history WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.patient_journey WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.admissions WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.visits WHERE patient_id = ANY(_patient_ids);

  UPDATE public.patients SET status = 'registered', last_visit = NULL, updated_at = now() WHERE id = ANY(_patient_ids);
  UPDATE public.patient_archive_records SET status = 'purged', purged_at = now(), purged_by = public.hms_current_user_id() WHERE archive_reference = v_reference AND patient_id = ANY(_patient_ids) AND status = 'download_confirmed';
  SELECT count(*) INTO v_purged_count FROM public.patient_archive_records WHERE archive_reference = v_reference AND patient_id = ANY(_patient_ids) AND status = 'purged';
  SELECT public.write_audit_log('purge_archived_cases', 'patient_archive_records', v_reference, jsonb_build_object('patient_ids', _patient_ids, 'patient_count', v_purged_count), 'success');
  RETURN v_purged_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_archived_cases(uuid[], text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.purge_archived_cases(uuid[], text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.purge_archived_cases(uuid[], text) FROM public;
