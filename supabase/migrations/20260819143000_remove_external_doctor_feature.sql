-- Remove the obsolete External Doctors feature.
-- Read-only probes confirmed the table and standing-order references are empty.
-- The archive fingerprint is recreated first because to_jsonb(sto) depended on
-- the standing_orders row shape, including the columns removed below.
CREATE OR REPLACE FUNCTION public.patient_archive_case_fingerprint(_patient_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT md5(concat_ws('|',
    COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id)::text FROM public.visits v WHERE v.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id)::text FROM public.admissions a WHERE a.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id)::text FROM public.invoices i WHERE i.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ii) ORDER BY ii.id)::text FROM public.invoice_items ii WHERE ii.invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = _patient_id)), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ssi) ORDER BY ssi.id)::text FROM public.sponsor_statement_items ssi WHERE ssi.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ic) ORDER BY ic.id)::text FROM public.insurance_claims ic WHERE ic.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(bt) ORDER BY bt.id)::text FROM public.balance_transactions bt WHERE bt.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(br) ORDER BY br.id)::text FROM public.balance_requests br WHERE br.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pr) ORDER BY pr.id)::text FROM public.prescriptions pr WHERE pr.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pi) ORDER BY pi.id)::text FROM public.prescription_items pi WHERE pi.prescription_id IN (SELECT id FROM public.prescriptions WHERE patient_id = _patient_id)), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(lr) ORDER BY lr.id)::text FROM public.lab_requests lr WHERE lr.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(vt) ORDER BY vt.id)::text FROM public.vitals vt WHERE vt.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(so) ORDER BY so.id)::text FROM public.snap_orders so WHERE so.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', sto.id,
      'patient_id', sto.patient_id,
      'photo_url', sto.photo_url,
      'notes', sto.notes,
      'status', sto.status,
      'expiry_date', sto.expiry_date,
      'transcribed_prescription_id', sto.transcribed_prescription_id,
      'captured_by', sto.captured_by,
      'fulfilled_by', sto.fulfilled_by,
      'fulfilled_at', sto.fulfilled_at,
      'created_at', sto.created_at,
      'updated_at', sto.updated_at,
      'order_type', sto.order_type,
      'visit_id', sto.visit_id
    ) ORDER BY sto.id)::text FROM public.standing_orders sto WHERE sto.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(rl) ORDER BY rl.id)::text FROM public.referral_letters rl WHERE rl.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(va) ORDER BY va.id)::text FROM public.visit_attachments va WHERE va.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ea) ORDER BY ea.id)::text FROM public.emr_attachments ea WHERE ea.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ev) ORDER BY ev.id)::text FROM public.eligibility_verifications ev WHERE ev.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pjh) ORDER BY pjh.id)::text FROM public.patient_journey_history pjh WHERE pjh.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pj) ORDER BY pj.id)::text FROM public.patient_journey pj WHERE pj.patient_id = _patient_id), '[]'),
    COALESCE((SELECT p.photo_path::text FROM public.patients p WHERE p.id = _patient_id), '')
  ));
$$;

CREATE OR REPLACE FUNCTION public.patient_archive_storage_snapshot(_patient_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
    UNION ALL SELECT pg_column_size(jsonb_build_object(
      'id', sto.id,
      'patient_id', sto.patient_id,
      'photo_url', sto.photo_url,
      'notes', sto.notes,
      'status', sto.status,
      'expiry_date', sto.expiry_date,
      'transcribed_prescription_id', sto.transcribed_prescription_id,
      'captured_by', sto.captured_by,
      'fulfilled_by', sto.fulfilled_by,
      'fulfilled_at', sto.fulfilled_at,
      'created_at', sto.created_at,
      'updated_at', sto.updated_at,
      'order_type', sto.order_type,
      'visit_id', sto.visit_id
    ))::bigint FROM public.standing_orders sto WHERE sto.patient_id = _patient_id
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

DROP TRIGGER IF EXISTS standing_orders_autofill_visit ON public.standing_orders;

ALTER TABLE public.standing_orders
  DROP CONSTRAINT IF EXISTS standing_orders_external_doctor_id_fkey;

ALTER TABLE public.standing_orders
  DROP COLUMN IF EXISTS external_doctor_id,
  DROP COLUMN IF EXISTS external_doctor_name;

DROP TABLE IF EXISTS public.external_doctors CASCADE;
