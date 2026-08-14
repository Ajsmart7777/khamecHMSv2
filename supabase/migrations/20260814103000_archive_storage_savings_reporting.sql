-- Per-archive storage reporting.
-- R2 byte totals are measured from the original objects downloaded into the verified ZIP.
-- Database payload is a logical row-payload estimate: PostgreSQL may reuse freed pages before
-- its dashboard-visible allocated size decreases, so it is deliberately not presented as physical disk release.

ALTER TABLE public.patient_archive_records
  ADD COLUMN IF NOT EXISTS database_payload_bytes bigint NOT NULL DEFAULT 0 CHECK (database_payload_bytes >= 0),
  ADD COLUMN IF NOT EXISTS database_rows_cleared jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS r2_object_bytes bigint NOT NULL DEFAULT 0 CHECK (r2_object_bytes >= 0),
  ADD COLUMN IF NOT EXISTS r2_deleted_bytes bigint NOT NULL DEFAULT 0 CHECK (r2_deleted_bytes >= 0),
  ADD COLUMN IF NOT EXISTS r2_deleted_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS r2_cleanup_status text NOT NULL DEFAULT 'not_started'
    CHECK (r2_cleanup_status IN ('not_started', 'partial', 'completed'));

-- Captures the records the archive purge removes for one patient.  The byte figure is the
-- PostgreSQL row payload currently occupied by those records, excluding index/page overhead.
CREATE OR REPLACE FUNCTION public.patient_archive_storage_snapshot(_patient_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row_counts jsonb;
  v_payload_bytes bigint;
BEGIN
  SELECT jsonb_build_object(
    'invoice_items', (SELECT count(*) FROM public.invoice_items ii WHERE ii.invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = _patient_id)),
    'sponsor_statement_items', (SELECT count(*) FROM public.sponsor_statement_items WHERE patient_id = _patient_id),
    'insurance_claims', (SELECT count(*) FROM public.insurance_claims WHERE patient_id = _patient_id),
    'balance_transactions', (SELECT count(*) FROM public.balance_transactions WHERE patient_id = _patient_id),
    'balance_requests', (SELECT count(*) FROM public.balance_requests WHERE patient_id = _patient_id),
    'invoices', (SELECT count(*) FROM public.invoices WHERE patient_id = _patient_id),
    'prescription_items', (SELECT count(*) FROM public.prescription_items pi WHERE pi.prescription_id IN (SELECT id FROM public.prescriptions WHERE patient_id = _patient_id)),
    'prescriptions', (SELECT count(*) FROM public.prescriptions WHERE patient_id = _patient_id),
    'lab_requests', (SELECT count(*) FROM public.lab_requests WHERE patient_id = _patient_id),
    'vitals', (SELECT count(*) FROM public.vitals WHERE patient_id = _patient_id),
    'snap_orders', (SELECT count(*) FROM public.snap_orders WHERE patient_id = _patient_id),
    'standing_orders', (SELECT count(*) FROM public.standing_orders WHERE patient_id = _patient_id),
    'referral_letters', (SELECT count(*) FROM public.referral_letters WHERE patient_id = _patient_id),
    'visit_attachments', (SELECT count(*) FROM public.visit_attachments WHERE patient_id = _patient_id),
    'emr_attachments', (SELECT count(*) FROM public.emr_attachments WHERE patient_id = _patient_id),
    'eligibility_verifications', (SELECT count(*) FROM public.eligibility_verifications WHERE patient_id = _patient_id),
    'patient_journey_history', (SELECT count(*) FROM public.patient_journey_history WHERE patient_id = _patient_id),
    'patient_journey', (SELECT count(*) FROM public.patient_journey WHERE patient_id = _patient_id),
    'admissions', (SELECT count(*) FROM public.admissions WHERE patient_id = _patient_id),
    'visits', (SELECT count(*) FROM public.visits WHERE patient_id = _patient_id)
  ) INTO v_row_counts;

  SELECT COALESCE(sum(payload_bytes), 0)::bigint INTO v_payload_bytes
  FROM (
    SELECT pg_column_size(ii)::bigint AS payload_bytes FROM public.invoice_items ii WHERE ii.invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = _patient_id)
    UNION ALL SELECT pg_column_size(ssi)::bigint FROM public.sponsor_statement_items ssi WHERE ssi.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(ic)::bigint FROM public.insurance_claims ic WHERE ic.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(bt)::bigint FROM public.balance_transactions bt WHERE bt.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(br)::bigint FROM public.balance_requests br WHERE br.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(i)::bigint FROM public.invoices i WHERE i.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(pi)::bigint FROM public.prescription_items pi WHERE pi.prescription_id IN (SELECT id FROM public.prescriptions WHERE patient_id = _patient_id)
    UNION ALL SELECT pg_column_size(pr)::bigint FROM public.prescriptions pr WHERE pr.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(lr)::bigint FROM public.lab_requests lr WHERE lr.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(vt)::bigint FROM public.vitals vt WHERE vt.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(so)::bigint FROM public.snap_orders so WHERE so.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(sto)::bigint FROM public.standing_orders sto WHERE sto.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(rl)::bigint FROM public.referral_letters rl WHERE rl.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(va)::bigint FROM public.visit_attachments va WHERE va.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(ea)::bigint FROM public.emr_attachments ea WHERE ea.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(ev)::bigint FROM public.eligibility_verifications ev WHERE ev.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(pjh)::bigint FROM public.patient_journey_history pjh WHERE pjh.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(pj)::bigint FROM public.patient_journey pj WHERE pj.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(a)::bigint FROM public.admissions a WHERE a.patient_id = _patient_id
    UNION ALL SELECT pg_column_size(v)::bigint FROM public.visits v WHERE v.patient_id = _patient_id
  ) payload;

  RETURN jsonb_build_object(
    'row_counts', v_row_counts,
    'database_payload_bytes', v_payload_bytes
  );
END;
$$;

-- Stores the measurements while the immutable archive index is still pending confirmation.
-- R2 bytes are calculated from the byte-checked original attachments in the stored ZIP manifest.
CREATE OR REPLACE FUNCTION public.record_archive_storage_measurement(_archive_reference text)
RETURNS TABLE (
  patient_id uuid,
  r2_object_bytes bigint,
  database_payload_bytes bigint,
  database_rows_cleared jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reference text := btrim(COALESCE(_archive_reference, ''));
  v_updated integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can record archive storage measurements';
  END IF;

  IF v_reference = '' THEN
    RAISE EXCEPTION 'An archive reference is required';
  END IF;

  RETURN QUERY
  WITH snapshots AS (
    SELECT
      r.id,
      public.patient_archive_storage_snapshot(r.patient_id) AS snapshot,
      COALESCE((
        SELECT sum(file_bytes)::bigint
        FROM (
          SELECT max(COALESCE(NULLIF(file ->> 'bytes', '')::bigint, 0)) AS file_bytes
          FROM jsonb_array_elements(COALESCE(r.archive_manifest -> 'files', '[]'::jsonb)) file
          WHERE file ->> 'kind' = 'original_attachment'
            AND COALESCE(file ->> 'bucket', '') <> 'external-url'
            AND NULLIF(file ->> 'bucket', '') IS NOT NULL
            AND NULLIF(file ->> 'original_path', '') IS NOT NULL
          GROUP BY file ->> 'bucket', file ->> 'original_path'
        ) unique_r2_objects
      ), 0)::bigint AS measured_r2_bytes
    FROM public.patient_archive_records r
    WHERE r.archive_reference = v_reference
      AND r.status = 'pending_download'
  )
  UPDATE public.patient_archive_records r
  SET r2_object_bytes = s.measured_r2_bytes,
      database_payload_bytes = COALESCE((s.snapshot ->> 'database_payload_bytes')::bigint, 0),
      database_rows_cleared = COALESCE(s.snapshot -> 'row_counts', '{}'::jsonb)
  FROM snapshots s
  WHERE r.id = s.id
  RETURNING r.patient_id, r.r2_object_bytes, r.database_payload_bytes, r.database_rows_cleared;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'No pending archive records were found for reference %', v_reference;
  END IF;

  PERFORM public.write_audit_log(
    'record_archive_storage_measurement',
    'patient_archive_records',
    v_reference,
    jsonb_build_object('patient_count', v_updated),
    'success'
  );
END;
$$;

-- Records only R2 objects that the authenticated browser confirmed as successfully deleted.
-- This keeps the displayed total truthful when R2 cleanup is partially retried.
CREATE OR REPLACE FUNCTION public.record_archive_r2_cleanup(
  _archive_reference text,
  _deleted_objects jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reference text := btrim(COALESCE(_archive_reference, ''));
  v_record public.patient_archive_records%ROWTYPE;
  v_new_paths jsonb;
  v_merged_paths jsonb;
  v_deleted_bytes bigint;
  v_expected_objects integer;
  v_updated integer := 0;
  v_invalid_objects integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can record R2 archive cleanup';
  END IF;

  IF v_reference = '' THEN
    RAISE EXCEPTION 'An archive reference is required';
  END IF;

  IF jsonb_typeof(_deleted_objects) <> 'array' THEN
    RAISE EXCEPTION 'Deleted R2 objects must be supplied as an array';
  END IF;

  FOR v_record IN
    SELECT *
    FROM public.patient_archive_records r
    WHERE r.archive_reference = v_reference
      AND r.status = 'purged'
    FOR UPDATE
  LOOP
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('bucket', object_value ->> 'bucket', 'path', object_value ->> 'path') ORDER BY object_value ->> 'bucket', object_value ->> 'path'),
      '[]'::jsonb
    ) INTO v_new_paths
    FROM jsonb_array_elements(_deleted_objects) object_value
    WHERE object_value ->> 'patient_id' = v_record.patient_id::text
      AND NULLIF(object_value ->> 'bucket', '') IS NOT NULL
      AND NULLIF(object_value ->> 'path', '') IS NOT NULL;

    SELECT count(*) INTO v_invalid_objects
    FROM jsonb_array_elements(v_new_paths) new_path
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(v_record.attachment_paths, '[]'::jsonb)) expected_path
      WHERE expected_path ->> 'bucket' = new_path ->> 'bucket'
        AND expected_path ->> 'path' = new_path ->> 'path'
        AND expected_path ->> 'bucket' <> 'external-url'
    );

    IF v_invalid_objects > 0 THEN
      RAISE EXCEPTION 'R2 cleanup objects do not match the verified archive record for patient %', v_record.patient_id;
    END IF;

    SELECT COALESCE(
      jsonb_agg(DISTINCT combined_path ORDER BY combined_path),
      '[]'::jsonb
    ) INTO v_merged_paths
    FROM (
      SELECT path_value AS combined_path FROM jsonb_array_elements(COALESCE(v_record.r2_deleted_paths, '[]'::jsonb)) path_value
      UNION ALL
      SELECT path_value FROM jsonb_array_elements(v_new_paths) path_value
    ) paths;

    SELECT COALESCE(sum(file_bytes), 0)::bigint INTO v_deleted_bytes
    FROM (
      SELECT max(COALESCE(NULLIF(file ->> 'bytes', '')::bigint, 0)) AS file_bytes
      FROM jsonb_array_elements(COALESCE(v_record.archive_manifest -> 'files', '[]'::jsonb)) file
      JOIN jsonb_array_elements(v_merged_paths) deleted_path
        ON file ->> 'bucket' = deleted_path ->> 'bucket'
       AND file ->> 'original_path' = deleted_path ->> 'path'
      WHERE file ->> 'kind' = 'original_attachment'
        AND COALESCE(file ->> 'bucket', '') <> 'external-url'
      GROUP BY file ->> 'bucket', file ->> 'original_path'
    ) measured_files;

    SELECT count(*) INTO v_expected_objects
    FROM (
      SELECT DISTINCT expected_path ->> 'bucket', expected_path ->> 'path'
      FROM jsonb_array_elements(COALESCE(v_record.attachment_paths, '[]'::jsonb)) expected_path
      WHERE expected_path ->> 'bucket' <> 'external-url'
        AND NULLIF(expected_path ->> 'bucket', '') IS NOT NULL
        AND NULLIF(expected_path ->> 'path', '') IS NOT NULL
    ) expected_objects;

    UPDATE public.patient_archive_records
    SET r2_deleted_paths = v_merged_paths,
        r2_deleted_bytes = v_deleted_bytes,
        r2_cleanup_status = CASE
          WHEN v_expected_objects = 0 OR jsonb_array_length(v_merged_paths) >= v_expected_objects THEN 'completed'
          WHEN jsonb_array_length(v_merged_paths) > 0 THEN 'partial'
          ELSE 'not_started'
        END
    WHERE id = v_record.id;

    v_updated := v_updated + 1;
  END LOOP;

  IF v_updated = 0 THEN
    RAISE EXCEPTION 'No purged archive records were found for reference %', v_reference;
  END IF;

  PERFORM public.write_audit_log(
    'record_archive_r2_cleanup',
    'patient_archive_records',
    v_reference,
    jsonb_build_object('patient_count', v_updated, 'deleted_object_count', jsonb_array_length(_deleted_objects)),
    'success'
  );

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.patient_archive_storage_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_archive_storage_measurement(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_archive_r2_cleanup(text, jsonb) TO authenticated;
