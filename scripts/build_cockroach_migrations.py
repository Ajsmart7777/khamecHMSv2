from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase" / "migrations"
OUT = ROOT / "generated" / "cockroach-migrations"
BATCH_SIZE = 60
MAX_BATCH_BYTES = 500_000

ROW_TYPE_FALLBACKS = {
    "_p": "public.patients",
    "_adm": "public.admissions",
    "_inv": "public.invoices",
    "_room": "public.beds",
    "_bed": "public.beds",
    "_v": "public.visits",
    "_open_visit": "public.visits",
    "_sponsor": "public.corporate_accounts",
    "_statement": "public.sponsor_statements",
    "_stmt": "public.sponsor_statements",
    "_manual": "public.corporate_manual_service_rows",
    "_src": "public.snap_orders",
    "_existing": "public.task_claims",
    "_batch": "public.inventory_batches",
    "_source_batch": "public.inventory_batches",
    "_transfer": "public.stock_transfers",
    "_item": "public.invoice_items",
    "_rec": "public.corporate_accounts",
}


def archive_eligibility_sql() -> str:
    return """CREATE OR REPLACE FUNCTION public.check_archive_eligibility(_patient_ids uuid[])
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
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.has_role(public.hms_current_user_id(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can check archive eligibility';
  END IF;

  RETURN QUERY
  WITH requested AS (
    SELECT requested_id
    FROM unnest(COALESCE(_patient_ids, ARRAY[]::uuid[])) AS u(requested_id)
  ), base AS (
    SELECT r.requested_id,
           p.id AS actual_id,
           p.card_number,
           trim(concat_ws(' ', p.first_name, p.last_name)) AS full_name
    FROM requested r
    LEFT JOIN public.patients p ON p.id = r.requested_id
  ), journey_ranked AS (
    SELECT pj.patient_id, pj.current_state,
           row_number() OVER (PARTITION BY pj.patient_id ORDER BY pj.updated_at DESC NULLS LAST, pj.created_at DESC NULLS LAST) AS rn
    FROM public.patient_journey pj
  ), details AS (
    SELECT b.*, j.current_state,
           (SELECT max(v.updated_at) FROM public.visits v WHERE v.patient_id = b.actual_id AND v.status::text = 'settled') AS latest_closed_at,
           jsonb_build_object(
             'visits', (SELECT count(*) FROM public.visits WHERE patient_id = b.actual_id),
             'admissions', (SELECT count(*) FROM public.admissions WHERE patient_id = b.actual_id),
             'invoices', (SELECT count(*) FROM public.invoices WHERE patient_id = b.actual_id),
             'invoice_items', (SELECT count(*) FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = b.actual_id)),
             'prescriptions', (SELECT count(*) FROM public.prescriptions WHERE patient_id = b.actual_id),
             'lab_requests', (SELECT count(*) FROM public.lab_requests WHERE patient_id = b.actual_id),
             'snap_orders', (SELECT count(*) FROM public.snap_orders WHERE patient_id = b.actual_id),
             'referral_letters', (SELECT count(*) FROM public.referral_letters WHERE patient_id = b.actual_id),
             'attachments', (SELECT count(*) FROM public.visit_attachments WHERE patient_id = b.actual_id) + (SELECT count(*) FROM public.emr_attachments WHERE patient_id = b.actual_id)
           ) AS counts,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object('bucket', x.bucket, 'path', x.path, 'source', x.source) ORDER BY x.bucket, x.path, x.source)
             FROM (
               SELECT DISTINCT 'visit-cards'::text AS bucket, so.photo_path AS path, 'snap_orders.photo_path'::text AS source FROM public.snap_orders so WHERE so.patient_id = b.actual_id AND NULLIF(btrim(so.photo_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'visit-cards', va.storage_path, 'visit_attachments.storage_path' FROM public.visit_attachments va WHERE va.patient_id = b.actual_id AND NULLIF(btrim(va.storage_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'visit-cards', a.admission_snap_path, 'admissions.admission_snap_path' FROM public.admissions a WHERE a.patient_id = b.actual_id AND NULLIF(btrim(a.admission_snap_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'visit-cards', ev.reception_snap_path, 'eligibility_verifications.reception_snap_path' FROM public.eligibility_verifications ev WHERE ev.patient_id = b.actual_id AND NULLIF(btrim(ev.reception_snap_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'visit-cards', ev.verification_snap_path, 'eligibility_verifications.verification_snap_path' FROM public.eligibility_verifications ev WHERE ev.patient_id = b.actual_id AND NULLIF(btrim(ev.verification_snap_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'emr-attachments', ea.file_path, 'emr_attachments.file_path' FROM public.emr_attachments ea WHERE ea.patient_id = b.actual_id AND NULLIF(btrim(ea.file_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'emr-attachments', rl.file_path, 'referral_letters.file_path' FROM public.referral_letters rl WHERE rl.patient_id = b.actual_id AND NULLIF(btrim(rl.file_path), '') IS NOT NULL
               UNION SELECT DISTINCT 'external-url', sto.photo_url, 'standing_orders.photo_url' FROM public.standing_orders sto WHERE sto.patient_id = b.actual_id AND NULLIF(btrim(sto.photo_url), '') IS NOT NULL
             ) x
           ), '[]'::jsonb) AS attachments
    FROM base b
    LEFT JOIN journey_ranked j ON j.patient_id = b.actual_id AND j.rn = 1
  ), reasoned AS (
    SELECT d.*, array_remove(ARRAY[
      CASE WHEN d.actual_id IS NULL THEN 'Patient record was not found'::text END,
      CASE WHEN d.actual_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.visits v WHERE v.patient_id = d.actual_id AND v.status::text = 'settled') THEN 'No settled visit exists' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.visits v WHERE v.patient_id = d.actual_id AND v.status::text <> 'settled') THEN 'An active or unsettled visit still exists' END,
      CASE WHEN d.actual_id IS NOT NULL AND COALESCE(d.current_state, '') <> 'discharged' THEN 'Patient journey is not discharged' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.admissions a WHERE a.patient_id = d.actual_id AND a.status IN ('waiting_assignment', 'active', 'ready_for_discharge')) THEN 'An active admission still exists' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.invoices i WHERE i.patient_id = d.actual_id AND i.status::text IN ('pending', 'partial')) THEN 'An unpaid or partially paid invoice exists' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.lab_requests lr WHERE lr.patient_id = d.actual_id AND lr.status::text = 'pending') THEN 'A laboratory request is pending' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.prescriptions pr WHERE pr.patient_id = d.actual_id AND pr.status::text = 'pending') THEN 'A pharmacy prescription is pending' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.snap_orders so WHERE so.patient_id = d.actual_id AND so.status::text = 'awaiting_payment') THEN 'A snap order awaits payment' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.balance_requests br WHERE br.patient_id = d.actual_id AND br.status::text = 'pending') THEN 'A patient balance request is pending' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.standing_orders sto WHERE sto.patient_id = d.actual_id AND COALESCE(sto.status::text, '') NOT IN ('completed', 'cancelled', 'closed', 'returned')) THEN 'A standing order or external referral is unresolved' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.referral_letters rl WHERE rl.patient_id = d.actual_id AND COALESCE(rl.status::text, '') NOT IN ('final', 'completed', 'sent', 'closed', 'cancelled')) THEN 'A referral letter is unfinished' END,
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.insurance_claims ic WHERE ic.patient_id = d.actual_id AND COALESCE(ic.status::text, '') NOT IN ('paid', 'settled', 'closed', 'cancelled', 'rejected', 'denied')) THEN 'An insurance claim remains unresolved' END
    ], NULL) AS reason_list
    FROM details d
  )
  SELECT actual_id, card_number, full_name,
         cardinality(COALESCE(reason_list, ARRAY[]::text[])) = 0,
         COALESCE(reason_list, ARRAY[]::text[]), latest_closed_at, counts, attachments,
         CASE WHEN actual_id IS NULL THEN NULL ELSE public.patient_archive_case_fingerprint(actual_id) END
  FROM reasoned;
END;
$$;"""


def rewrite_record_variables(s: str) -> str:
    """Replace unsupported RECORD declarations with concrete CockroachDB row types."""
    if re.search(r"FUNCTION\s+public\.generate_all_sponsor_statements\b", s, flags=re.IGNORECASE):
        s = re.sub(r"DECLARE\s+_rec\s+RECORD;\s+_count", "DECLARE _count", s, count=1, flags=re.IGNORECASE)
        s = re.sub(
            r"FOR\s+_rec\s+IN\s+SELECT\s+id\s+FROM\s+public\.corporate_accounts\s+WHERE\s+status\s*=\s*'active'\s+AND\s+account_type\s+IN\s*\('corporate','retainer'\)\s+LOOP.*?END\s+LOOP;",
            "SELECT COUNT(*) INTO _count FROM (SELECT public.generate_sponsor_statement(id, _year, _month) FROM public.corporate_accounts WHERE status = 'active' AND account_type IN ('corporate','retainer')) AS generated;",
            s,
            count=1,
            flags=re.IGNORECASE | re.DOTALL,
        )
        return s
    declaration = re.search(r"\bDECLARE\b(.*?)\bBEGIN\b", s, flags=re.IGNORECASE | re.DOTALL)
    if not declaration:
        return s
    variables = re.findall(r"\b([A-Za-z_]\w*)\s+RECORD\b", declaration.group(1), flags=re.IGNORECASE)
    for variable in variables:
        sources = re.findall(
            rf"\bINTO\s+{re.escape(variable)}\b[\s\S]{{0,600}}?\bFROM\s+(public\.[A-Za-z_]\w*)",
            s,
            flags=re.IGNORECASE,
        )
        loop_sources = re.findall(
            rf"\bFOR\s+{re.escape(variable)}\s+IN\s+[\s\S]{{0,600}}?\bFROM\s+(public\.[A-Za-z_]\w*)",
            s,
            flags=re.IGNORECASE,
        )
        tables = list(dict.fromkeys(sources + loop_sources))
        table = tables[0] if len(tables) == 1 else ROW_TYPE_FALLBACKS.get(variable)
        if not table:
            continue
        if variable == "_rec" and table == "public.corporate_accounts" and re.search(r"\bFOR\s+_rec\s+IN\s+SELECT\s+id\s+FROM\s+public\.corporate_accounts\b", s, flags=re.IGNORECASE):
            s = re.sub(r"\b_rec\s+RECORD\b", "_rec_id UUID", s, count=1, flags=re.IGNORECASE)
            s = re.sub(r"\bFOR\s+_rec\s+IN\b", "FOR _rec_id IN", s, count=1, flags=re.IGNORECASE)
            s = re.sub(r"\(\s*_rec\s*\)\.id\b", "_rec_id", s, flags=re.IGNORECASE)
            continue
        s = re.sub(
            rf"\b{re.escape(variable)}\s+RECORD\b",
            f"{variable} {table}",
            s,
            count=1,
            flags=re.IGNORECASE,
        )
        s = re.sub(
            rf"SELECT\s+[^;]*?\s+INTO\s+{re.escape(variable)}\s+FROM\s+{re.escape(table)}\b",
            f"SELECT * INTO {variable} FROM {table}",
            s,
            flags=re.IGNORECASE | re.DOTALL,
        )
        s = re.sub(rf"\b{re.escape(variable)}\.", f"({variable}).", s, flags=re.IGNORECASE)
    s = re.sub(r"\(\s*_p\s*\)\.corporate_id\b", "NULLIF(((_p).corporate_id)::STRING, '')::UUID", s, flags=re.IGNORECASE)
    return s


def split_sql(sql: str) -> list[str]:
    statements: list[str] = []
    start = 0
    i = 0
    quote: str | None = None
    dollar_tag: str | None = None
    line_comment = False
    block_comment = False
    while i < len(sql):
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < len(sql) else ""
        if line_comment:
            if ch == "\n": line_comment = False
            i += 1; continue
        if block_comment:
            if ch == "*" and nxt == "/": block_comment = False; i += 2
            else: i += 1
            continue
        if dollar_tag is not None:
            if sql.startswith(dollar_tag, i): i += len(dollar_tag); dollar_tag = None
            else: i += 1
            continue
        if quote is not None:
            if ch == quote:
                if quote == "'" and nxt == "'": i += 2; continue
                quote = None
            elif ch == "\\" and quote == "'": i += 2; continue
            i += 1; continue
        if ch == "-" and nxt == "-": line_comment = True; i += 2; continue
        if ch == "/" and nxt == "*": block_comment = True; i += 2; continue
        if ch in ("'", '"'): quote = ch; i += 1; continue
        if ch == "$":
            match = re.match(r"\$[A-Za-z_0-9]*\$", sql[i:])
            if match: dollar_tag = match.group(0); i += len(dollar_tag); continue
        if ch == ";":
            piece = sql[start:i + 1].strip()
            if piece and re.sub(r"--[^\n]*", "", piece).strip(): statements.append(piece)
            start = i + 1
        i += 1
    tail = sql[start:].strip()
    if tail and re.sub(r"--[^\n]*", "", tail).strip(): statements.append(tail)
    return statements


def prepare_archive_sql() -> str:
    return """CREATE OR REPLACE FUNCTION public.prepare_patient_archive(_archive_reference text, _archives jsonb)
RETURNS TABLE (archive_record_id uuid, patient_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reference text := btrim(COALESCE(_archive_reference, ''));
  v_bad integer;
  v_count integer;
BEGIN
  IF NOT public.has_role(public.hms_current_user_id(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can prepare an archive';
  END IF;
  IF v_reference = '' THEN RAISE EXCEPTION 'An archive reference is required'; END IF;
  IF jsonb_typeof(_archives) <> 'array' OR jsonb_array_length(_archives) = 0 THEN
    RAISE EXCEPTION 'At least one patient archive manifest is required';
  END IF;

  SELECT count(*) INTO v_bad
  FROM jsonb_array_elements(_archives) a(value)
  WHERE NULLIF(a.value ->> 'patient_id', '') IS NULL
     OR NULLIF(a.value ->> 'case_fingerprint', '') IS NULL;
  IF v_bad > 0 THEN RAISE EXCEPTION 'Each archive manifest must include patient_id and case_fingerprint'; END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(_archives) a(value)
    CROSS JOIN LATERAL public.check_archive_eligibility(ARRAY[(a.value ->> 'patient_id')::uuid]) e
    WHERE NOT e.is_eligible
       OR e.case_fingerprint IS DISTINCT FROM NULLIF(a.value ->> 'case_fingerprint', '')
  ) THEN
    RAISE EXCEPTION 'One or more patients are no longer eligible or their records changed. Create a new ZIP before continuing.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.patient_archive_records r
    JOIN jsonb_array_elements(_archives) a(value) ON r.patient_id = (a.value ->> 'patient_id')::uuid
    WHERE r.archive_reference = v_reference
  ) THEN
    RAISE EXCEPTION 'Archive reference % already contains one or more selected patients', v_reference;
  END IF;

  INSERT INTO public.patient_archive_records (
    patient_id, patient_card_number, patient_name, archive_reference, archived_by,
    visit_count, invoice_count, row_counts, attachment_paths, archive_manifest,
    case_fingerprint, status
  )
  SELECT e.patient_id, e.patient_card_number, e.patient_name, v_reference,
         public.hms_current_user_id(),
         COALESCE((e.row_counts ->> 'visits')::integer, 0),
         COALESCE((e.row_counts ->> 'invoices')::integer, 0),
         e.row_counts, e.attachment_paths, a.value -> 'manifest', e.case_fingerprint,
         'pending_download'
  FROM jsonb_array_elements(_archives) a(value)
  CROSS JOIN LATERAL public.check_archive_eligibility(ARRAY[(a.value ->> 'patient_id')::uuid]) e;

  SELECT count(*) INTO v_count
  FROM public.patient_archive_records
  WHERE archive_reference = v_reference AND archived_by = public.hms_current_user_id();
  SELECT public.write_audit_log('prepare_patient_archive', 'patient_archive_records', v_reference, jsonb_build_object('patient_count', v_count), 'success');
  RETURN QUERY SELECT r.id, r.patient_id FROM public.patient_archive_records r WHERE r.archive_reference = v_reference AND r.archived_by = public.hms_current_user_id();
END;
$$;"""


def purge_archive_sql() -> str:
    return """CREATE OR REPLACE FUNCTION public.purge_archived_cases(_patient_ids uuid[], _archive_reference text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reference text := btrim(COALESCE(_archive_reference, ''));
  v_statement_ids uuid[];
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
  DELETE FROM public.invoices WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.prescription_items WHERE prescription_id IN (SELECT id FROM public.prescriptions WHERE patient_id = ANY(_patient_ids));
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

  UPDATE public.patients SET status = 'registered', last_visit = NULL, updated_at = now() WHERE id = ANY(_patient_ids);
  UPDATE public.patient_archive_records SET status = 'purged', purged_at = now(), purged_by = public.hms_current_user_id() WHERE archive_reference = v_reference AND patient_id = ANY(_patient_ids) AND status = 'download_confirmed';
  SELECT count(*) INTO v_purged_count FROM public.patient_archive_records WHERE archive_reference = v_reference AND patient_id = ANY(_patient_ids) AND status = 'purged';
  SELECT public.write_audit_log('purge_archived_cases', 'patient_archive_records', v_reference, jsonb_build_object('patient_ids', _patient_ids, 'patient_count', v_purged_count), 'success');
  RETURN v_purged_count;
END;
$$;"""


def r2_cleanup_sql() -> str:
    return """CREATE OR REPLACE FUNCTION public.record_archive_r2_cleanup(_archive_reference text, _deleted_objects jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reference text := btrim(COALESCE(_archive_reference, ''));
  v_updated integer;
BEGIN
  IF NOT public.has_role(public.hms_current_user_id(), 'admin'::app_role) THEN RAISE EXCEPTION 'Only administrators can record R2 archive cleanup'; END IF;
  IF v_reference = '' THEN RAISE EXCEPTION 'An archive reference is required'; END IF;
  IF jsonb_typeof(_deleted_objects) <> 'array' THEN RAISE EXCEPTION 'Deleted R2 objects must be supplied as an array'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patient_archive_records WHERE archive_reference = v_reference AND status = 'purged') THEN
    RAISE EXCEPTION 'No purged archive records were found for reference %', v_reference;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.patient_archive_records r
    CROSS JOIN LATERAL jsonb_array_elements(_deleted_objects) o(value)
    WHERE r.archive_reference = v_reference AND r.status = 'purged'
      AND o.value ->> 'patient_id' = r.patient_id::text
      AND NULLIF(o.value ->> 'bucket', '') IS NOT NULL
      AND NULLIF(o.value ->> 'path', '') IS NOT NULL
      AND o.value ->> 'bucket' <> 'external-url'
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(r.attachment_paths, '[]'::jsonb)) e(value)
        WHERE e.value ->> 'bucket' = o.value ->> 'bucket' AND e.value ->> 'path' = o.value ->> 'path'
      )
  ) THEN
    RAISE EXCEPTION 'R2 cleanup objects do not match the verified archive record';
  END IF;

  WITH incoming AS (
    SELECT r.id,
           COALESCE(jsonb_agg(jsonb_build_object('bucket', o.value ->> 'bucket', 'path', o.value ->> 'path')) FILTER (WHERE o.value ->> 'patient_id' = r.patient_id::text AND NULLIF(o.value ->> 'bucket', '') IS NOT NULL AND NULLIF(o.value ->> 'path', '') IS NOT NULL), '[]'::jsonb) AS paths
    FROM public.patient_archive_records r
    LEFT JOIN LATERAL jsonb_array_elements(_deleted_objects) o(value) ON true
    WHERE r.archive_reference = v_reference AND r.status = 'purged'
    GROUP BY r.id
  ), merged AS (
    SELECT i.id,
           COALESCE((SELECT jsonb_agg(q.path) FROM (
             SELECT p AS path FROM jsonb_array_elements(COALESCE(r.r2_deleted_paths, '[]'::jsonb)) p
             UNION ALL SELECT p AS path FROM jsonb_array_elements(i.paths) p
           ) q), '[]'::jsonb) AS paths
    FROM incoming i JOIN public.patient_archive_records r ON r.id = i.id
  ), measured AS (
    SELECT m.id, m.paths,
           COALESCE((SELECT sum(bytes)::bigint FROM (
             SELECT max(COALESCE(NULLIF(f.value ->> 'bytes', '')::bigint, 0)) AS bytes
             FROM public.patient_archive_records r
             CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.archive_manifest -> 'files', '[]'::jsonb)) f(value)
             CROSS JOIN LATERAL jsonb_array_elements(m.paths) p(value)
             WHERE r.id = m.id AND f.value ->> 'kind' = 'original_attachment'
               AND f.value ->> 'bucket' = p.value ->> 'bucket' AND f.value ->> 'original_path' = p.value ->> 'path'
             GROUP BY f.value ->> 'bucket', f.value ->> 'original_path'
           ) bytes), 0)::bigint AS deleted_bytes
    FROM merged m
  )
  UPDATE public.patient_archive_records r
  SET r2_deleted_paths = m.paths,
      r2_deleted_bytes = m.deleted_bytes,
      r2_cleanup_status = CASE
        WHEN (SELECT count(*) FROM jsonb_array_elements(COALESCE(r.attachment_paths, '[]'::jsonb)) e(value) WHERE e.value ->> 'bucket' <> 'external-url' AND NULLIF(e.value ->> 'bucket', '') IS NOT NULL AND NULLIF(e.value ->> 'path', '') IS NOT NULL) = 0 THEN 'completed'
        WHEN jsonb_array_length(m.paths) >= (SELECT count(*) FROM jsonb_array_elements(COALESCE(r.attachment_paths, '[]'::jsonb)) e(value) WHERE e.value ->> 'bucket' <> 'external-url' AND NULLIF(e.value ->> 'bucket', '') IS NOT NULL AND NULLIF(e.value ->> 'path', '') IS NOT NULL) THEN 'completed'
        WHEN jsonb_array_length(m.paths) > 0 THEN 'partial' ELSE 'not_started' END
  FROM measured m WHERE r.id = m.id;

  SELECT count(*) INTO v_updated FROM public.patient_archive_records WHERE archive_reference = v_reference AND status = 'purged';
  SELECT public.write_audit_log('record_archive_r2_cleanup', 'patient_archive_records', v_reference, jsonb_build_object('patient_count', v_updated, 'deleted_object_count', jsonb_array_length(_deleted_objects)), 'success');
  RETURN v_updated;
END;
$$;"""


def admission_bed_charge_sql() -> str:
    return """CREATE OR REPLACE FUNCTION public.admission_bed_charge(_admission_id uuid)
RETURNS TABLE(days integer, daily_rate numeric, amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  _admitted_at timestamptz;
  _discharged_at timestamptz;
  _created_at timestamptz;
  _rate numeric;
  _nights int;
  _amount numeric;
BEGIN
  SELECT a.admitted_at, a.discharged_at, a.created_at, r.daily_rate
    INTO _admitted_at, _discharged_at, _created_at, _rate
  FROM public.admissions a
  LEFT JOIN public.beds b ON b.id = a.bed_id
  LEFT JOIN public.rooms r ON r.id = b.room_id
  WHERE a.id = _admission_id;

  IF _created_at IS NULL THEN
    RETURN QUERY SELECT 0, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  _nights := GREATEST(0, (COALESCE(_discharged_at, now())::date - COALESCE(_admitted_at, _created_at)::date))::int;
  IF _nights = 0 THEN
    RETURN QUERY SELECT 0, 3000::numeric, 3000::numeric;
  ELSE
    _rate := COALESCE(_rate, 0)::numeric;
    _amount := ROUND(_nights::numeric * _rate, 2)::numeric;
    RETURN QUERY SELECT _nights, _rate, _amount;
  END IF;
END;
$function$;"""


def transform_statement(statement: str) -> str | None:
    # Replace sponsor_balance field access with explicit corporate_accounts query
    if "_statement.sponsor_balance" in statement or "(_statement).sponsor_balance" in statement:
        statement = statement.replace(
            "_balance_before := _statement.sponsor_balance;",
            "SELECT balance INTO _balance_before FROM public.corporate_accounts WHERE id = _statement.sponsor_id;"
        ).replace(
            "_balance_before := (_statement).sponsor_balance;",
            "SELECT balance INTO _balance_before FROM public.corporate_accounts WHERE id = (_statement).sponsor_id;"
        )
    s = re.sub(r"^\s*(?:--[^\n]*\n|/\*.*?\*/\s*)+", "", statement, flags=re.DOTALL).strip()
    if not s:
        return None
    if re.match(r"(?:REVOKE|GRANT)\s+.*?\bON\s+FUNCTION\s+public\.(?:anc_|tenant_|sync_)", s, flags=re.IGNORECASE):
        return "SELECT 1;"
    if "reset_patient_history" in s:
        s = s.replace("DELETE FROM public.anc_visits;", "-- DELETE FROM public.anc_visits;")
        s = s.replace("DELETE FROM public.anc_programs;", "-- DELETE FROM public.anc_programs;")
    if "purge_clinical_data" in s:
        s = s.replace("SELECT count(*) INTO _n FROM public.anc_visits;", "SELECT 0 INTO _n;")
        s = s.replace("DELETE FROM public.anc_visits;", "-- DELETE FROM public.anc_visits;")
        s = s.replace("SELECT count(*) INTO _n FROM public.anc_programs;", "SELECT 0 INTO _n;")
        s = s.replace("DELETE FROM public.anc_programs;", "-- DELETE FROM public.anc_programs;")

    # Replace Supabase auth references with the isolated CockroachDB auth
    # compatibility layer, including references inside procedural DDL blocks.
    s = re.sub(r"\bauth\.uid\(\)", "public.hms_current_user_id()", s, flags=re.IGNORECASE)
    s = re.sub(r"\bauth\.users\b", "public.auth_users", s, flags=re.IGNORECASE)
    # Normalize legacy four-argument audit calls across multi-line blocks
    # Normalize adjust_patient_balance calls with extra nulls
    s = re.sub(
        r"public\.adjust_patient_balance\s*\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*NULL,\s*NULL,\s*([^,\)]+),\s*([^,\)]+)\s*\)",
        r"public.adjust_patient_balance(\1, \2, \3, \4, NULL, NULL, \5)",
        s,
        flags=re.IGNORECASE
    )
    # Blanket rewrite for any 4-argument write_audit_log call using greedy balanced matching
    s = re.sub(
        r"\bwrite_audit_log\s*\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,\)]+(?:\([\s\S]*?\))?[^,\)]*)\s*\)",
        r"write_audit_log(\1, \2, \3, \4, 'success')",
        s,
        flags=re.IGNORECASE
    )
    s = re.sub(
        r"\bwrite_audit_log\s*\(\s*('[^']+'|\$[A-Z]*\$[\s\S]*?\$[A-Z]*\$)\s*,\s*('[^']+'|\$[A-Z]*\$[\s\S]*?\$[A-Z]*\$)\s*,\s*([^,]+)\s*,\s*(CASE[\s\S]*?END)\s*\)",
        r"write_audit_log(\1, \2, \3, \4, 'success')",
        s,
        flags=re.IGNORECASE
    )
    s = re.sub(
        r"(SELECT\s+public\.write_audit_log\(\s*'[^']+'\s*,\s*jsonb_build_object\(.*?\)\s*,\s*_invoice_id\s*,\s*'invoices')\s*\);",
        r"\1, 'success');",
        s,
        flags=re.IGNORECASE | re.DOTALL,
    )
    # CockroachDB can retain an older composite descriptor while an ALTER TABLE
    # column is propagating. Use a scalar lookup for this late-added field.
    s = re.sub(
        r"COALESCE\(\(_p\)\.registration_fee_paid,\s*FALSE\)",
        "COALESCE((SELECT registration_fee_paid FROM public.patients WHERE id = _patient_id), FALSE)",
        s,
        flags=re.IGNORECASE,
    )

    # visits use the visit_status enum ('open','settled','cancelled'); the
    # legacy onboarding function used admissions-style status 'active'.
    s = re.sub(
        r"(FROM\s+public\.visits\s+WHERE\s+patient_id\s*=\s*_patient_id\s+AND\s+status\s*=\s*)'active'",
        r"\1'open'",
        s,
        flags=re.IGNORECASE,
    )

    # A late inventory routine used an obsolete four-argument audit signature.
    # Preserve the audit event while mapping it to the current HMS contract.
    s = re.sub(
        r"SELECT\s+public\.write_audit_log\(\s*'item_marked_unavailable'\s*,\s*json_build_object\((.*?)\)\s*,\s*_invoice_id\s*,\s*'invoices'\s*\);",
        r"SELECT public.write_audit_log('item_marked_unavailable', 'invoice', _invoice_id::text, jsonb_build_object(\1), 'success');",
        s,
        flags=re.IGNORECASE | re.DOTALL,
    )
    s = s.replace(
        """SELECT public.write_audit_log(
        'item_marked_unavailable',
        json_build_object('item_id', _item_id, 'reason', _reason, 'description', _item_desc),
        _invoice_id,
        'invoices'
    );""",
        """SELECT public.write_audit_log('item_marked_unavailable', 'invoice', _invoice_id::text, jsonb_build_object('item_id', _item_id, 'reason', _reason, 'description', _item_desc), 'success');""",
    )

    # CockroachDB does not support these PostgreSQL metadata statements in
    # the migration surface; they do not affect clinical or billing behavior.
    if re.match(r"(?:COMMENT\s+ON|NOTIFY\s+)", s, flags=re.IGNORECASE):
        return None

    # The derived room_daily_rate field came from a joined RECORD in Supabase.
    # Compute the room rate directly instead of reading it from admissions.
    if re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.admission_bed_charge\s*\(", s, flags=re.IGNORECASE):
        return admission_bed_charge_sql()

    # The archive feature redefines this function several times. Emit the
    # final immediate-eligibility implementation for every definition so no
    # unsupported FOREACH or row-variable syntax reaches CockroachDB.
    if re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.check_archive_eligibility\s*\(", s, flags=re.IGNORECASE):
        return archive_eligibility_sql()
    if re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.prepare_patient_archive\s*\(", s, flags=re.IGNORECASE):
        return prepare_archive_sql()
    if re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.purge_archived_cases\s*\(", s, flags=re.IGNORECASE):
        return purge_archive_sql()
    if re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.record_archive_r2_cleanup\s*\(", s, flags=re.IGNORECASE):
        return r2_cleanup_sql()

    # emr_attachments has no visit_id or label column in the source schema.
    # Preserve the referral file linkage using the actual attachment columns.
    if re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.finalize_referral\s*\(", s, flags=re.IGNORECASE):
        s = re.sub(
            r"INSERT INTO public\.emr_attachments\s*\([^;]*\)\s*VALUES\s*\([^;]*\);",
            "INSERT INTO public.emr_attachments (patient_id, uploaded_by, file_path, file_name, category, description)\\n        VALUES ((v_ref).patient_id, v_uid, _file_path, 'Referral Letter ' || v_ref_num, 'referral', 'Referral Letter ' || v_ref_num);",
            s,
            count=1,
            flags=re.IGNORECASE,
        )

    # Inventory receipt and transfer functions use row loops over JSON arrays.
    # Expand and validate the arrays once, then perform set-based writes.
    if re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.record_inventory_receipt\s*\(", s, flags=re.IGNORECASE):
        s = re.sub(
            r"  FOR _row IN SELECT value FROM jsonb_array_elements\(_items\)\s+LOOP[\s\S]*?  END LOOP;",
            """  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_items) AS x(value)
    WHERE NULLIF(btrim(x.value->>'batch_number'), '') IS NULL
       OR NULLIF(x.value->>'expiry_date', '') IS NULL
       OR NULLIF(x.value->>'quantity', '') IS NULL
       OR (x.value->>'quantity')::numeric <= 0
       OR NULLIF(x.value->>'unit_cost', '') IS NULL
       OR (x.value->>'unit_cost')::numeric < 0
       OR (x.value->>'expiry_date')::date < current_date
       OR NOT EXISTS (SELECT 1 FROM public.inventory_products p WHERE p.id = (x.value->>'product_id')::uuid AND p.active)
  ) THEN
    RAISE EXCEPTION 'Each item requires an active product, batch number, future expiry date, positive quantity, and non-negative unit cost';
  END IF;

  INSERT INTO public.inventory_batches (product_id, location_id, batch_number, expiry_date, unit_cost, quantity_on_hand)
  SELECT (x.value->>'product_id')::uuid, _location_id, NULLIF(btrim(x.value->>'batch_number'), ''),
         (x.value->>'expiry_date')::date, (x.value->>'unit_cost')::numeric, (x.value->>'quantity')::numeric
  FROM jsonb_array_elements(_items) AS x(value)
  ON CONFLICT (product_id, location_id, batch_number, expiry_date) DO UPDATE
    SET quantity_on_hand = public.inventory_batches.quantity_on_hand + EXCLUDED.quantity_on_hand,
        unit_cost = EXCLUDED.unit_cost, status = 'active', updated_at = now();

  INSERT INTO public.stock_receipt_items (receipt_id, batch_id, product_id, quantity, unit_cost)
  SELECT _receipt_id, b.id, (x.value->>'product_id')::uuid, (x.value->>'quantity')::numeric, (x.value->>'unit_cost')::numeric
  FROM jsonb_array_elements(_items) AS x(value)
  JOIN public.inventory_batches b ON b.product_id = (x.value->>'product_id')::uuid
    AND b.location_id = _location_id AND b.batch_number = NULLIF(btrim(x.value->>'batch_number'), '')
    AND b.expiry_date = (x.value->>'expiry_date')::date;

  INSERT INTO public.stock_movements (movement_type, product_id, batch_id, location_id, quantity_delta, unit_cost, receipt_id, performed_by, reason)
  SELECT CASE WHEN _receipt_kind = 'opening_count' THEN 'opening_count' ELSE 'receipt' END,
         (x.value->>'product_id')::uuid, b.id, _location_id, (x.value->>'quantity')::numeric,
         (x.value->>'unit_cost')::numeric, _receipt_id, public.hms_current_user_id(), _note
  FROM jsonb_array_elements(_items) AS x(value)
  JOIN public.inventory_batches b ON b.product_id = (x.value->>'product_id')::uuid
    AND b.location_id = _location_id AND b.batch_number = NULLIF(btrim(x.value->>'batch_number'), '')
    AND b.expiry_date = (x.value->>'expiry_date')::date;""",
            s, count=1, flags=re.IGNORECASE,
        )
    if re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.create_store_to_pharmacy_transfer\s*\(", s, flags=re.IGNORECASE):
        s = re.sub(
            r"  FOR _row IN SELECT value FROM jsonb_array_elements\(_items\)\s+LOOP[\s\S]*?  END LOOP;",
            """  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_items) AS x(value) WHERE NULLIF(x.value->>'quantity', '') IS NULL OR (x.value->>'quantity')::numeric <= 0) THEN
    RAISE EXCEPTION 'Transfer quantities must be positive';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_items) AS x(value)
    LEFT JOIN public.inventory_batches b ON b.id = (x.value->>'batch_id')::uuid
      AND b.location_id = _from_location AND b.status = 'active' AND b.expiry_date >= current_date
    WHERE b.id IS NULL OR b.quantity_on_hand < (x.value->>'quantity')::numeric
  ) THEN
    RAISE EXCEPTION 'Insufficient available Main Store quantity for one or more selected batches';
  END IF;
  UPDATE public.inventory_batches b
  SET quantity_on_hand = b.quantity_on_hand - (x.value->>'quantity')::numeric, updated_at = now()
  FROM jsonb_array_elements(_items) AS x(value)
  WHERE b.id = (x.value->>'batch_id')::uuid;
  INSERT INTO public.stock_transfer_items (transfer_id, source_batch_id, product_id, quantity_sent)
  SELECT _transfer_id, b.id, b.product_id, (x.value->>'quantity')::numeric
  FROM jsonb_array_elements(_items) AS x(value) JOIN public.inventory_batches b ON b.id = (x.value->>'batch_id')::uuid;
  INSERT INTO public.stock_movements (movement_type, product_id, batch_id, location_id, quantity_delta, unit_cost, transfer_id, performed_by, reason)
  SELECT 'transfer_out', b.product_id, b.id, _from_location, -(x.value->>'quantity')::numeric, b.unit_cost, _transfer_id, public.hms_current_user_id(), _note
  FROM jsonb_array_elements(_items) AS x(value) JOIN public.inventory_batches b ON b.id = (x.value->>'batch_id')::uuid;""",
            s, count=1, flags=re.IGNORECASE,
        )

    if re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.receive_store_transfer\s*\(", s, flags=re.IGNORECASE):
        s = re.sub(
            r"  FOR _item IN[\s\S]*?  END LOOP;",
            """  INSERT INTO public.inventory_batches (product_id, location_id, batch_number, expiry_date, unit_cost, quantity_on_hand, source_batch_id)
  SELECT sti.product_id, st.to_location_id, sb.batch_number, sb.expiry_date, sb.unit_cost,
         sti.quantity_sent - sti.quantity_received, sb.id
  FROM public.stock_transfer_items sti
  JOIN public.stock_transfers st ON st.id = sti.transfer_id
  JOIN public.inventory_batches sb ON sb.id = sti.source_batch_id
  WHERE sti.transfer_id = _transfer_id AND sti.quantity_sent > sti.quantity_received
  ON CONFLICT (product_id, location_id, batch_number, expiry_date) DO UPDATE
    SET quantity_on_hand = public.inventory_batches.quantity_on_hand + EXCLUDED.quantity_on_hand,
        updated_at = now();

  UPDATE public.stock_transfer_items sti
  SET quantity_received = sti.quantity_sent,
      destination_batch_id = db.id
  FROM public.stock_transfers st
  JOIN public.inventory_batches sb ON sb.id = sti.source_batch_id
  JOIN public.inventory_batches db ON db.product_id = sti.product_id
    AND db.location_id = st.to_location_id AND db.batch_number = sb.batch_number AND db.expiry_date = sb.expiry_date
  WHERE sti.transfer_id = _transfer_id AND sti.quantity_sent > sti.quantity_received;

  INSERT INTO public.stock_movements (movement_type, product_id, batch_id, location_id, quantity_delta, unit_cost, transfer_id, performed_by, reason)
  SELECT 'transfer_in', sti.product_id, sti.destination_batch_id, st.to_location_id,
         sti.quantity_received - (sti.quantity_sent - sti.quantity_received), sb.unit_cost,
         _transfer_id, public.hms_current_user_id(), st.note
  FROM public.stock_transfer_items sti
  JOIN public.stock_transfers st ON st.id = sti.transfer_id
  JOIN public.inventory_batches sb ON sb.id = sti.source_batch_id
  WHERE sti.transfer_id = _transfer_id AND sti.quantity_received > 0;""",
            s, count=1, flags=re.IGNORECASE,
        )
        # The movement quantity above must be the newly received delta; the
        # source value is retained in the table, so use sent - old received.
        s = s.replace("sti.quantity_received - (sti.quantity_sent - sti.quantity_received)", "sti.quantity_sent")

    if re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.dispense_inventory_invoice_item\s*\(", s, flags=re.IGNORECASE):
        s = s.replace("DECLARE\n  _item public.invoice_items;", "DECLARE\n  _item public.invoice_items;\n  _taken numeric;")
        s = re.sub(
            r"  FOR _batch IN[\s\S]*?  END LOOP;",
            """  SELECT COALESCE(SUM(take), 0) INTO _taken
  FROM (
    SELECT LEAST(quantity_on_hand, GREATEST(_remaining - prior_qty, 0))::numeric AS take
    FROM (
      SELECT quantity_on_hand,
             COALESCE(SUM(quantity_on_hand) OVER (ORDER BY expiry_date ASC, received_at ASC, id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)::numeric AS prior_qty
      FROM public.inventory_batches
      WHERE product_id = _product_id AND location_id = _pharmacy_location
        AND status = 'active' AND expiry_date >= current_date AND quantity_on_hand > 0
    ) q
  ) allocated;
  IF _taken < _remaining THEN RAISE EXCEPTION 'Insufficient Pharmacy stock to dispense this item'; END IF;

  WITH ordered AS (
    SELECT id, quantity_on_hand,
           COALESCE(SUM(quantity_on_hand) OVER (ORDER BY expiry_date ASC, received_at ASC, id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)::numeric AS prior_qty
    FROM public.inventory_batches
    WHERE product_id = _product_id AND location_id = _pharmacy_location
      AND status = 'active' AND expiry_date >= current_date AND quantity_on_hand > 0
  ), allocated AS (
    SELECT id, LEAST(quantity_on_hand, GREATEST(_remaining - prior_qty, 0))::numeric AS take
    FROM ordered
  )
  UPDATE public.inventory_batches b
  SET quantity_on_hand = b.quantity_on_hand - a.take, updated_at = now()
  FROM allocated a WHERE b.id = a.id AND a.take > 0;

  WITH ordered AS (
    SELECT id, quantity_on_hand,
           COALESCE(SUM(quantity_on_hand) OVER (ORDER BY expiry_date ASC, received_at ASC, id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)::numeric AS prior_qty
    FROM public.inventory_batches
    WHERE product_id = _product_id AND location_id = _pharmacy_location
      AND status = 'active' AND expiry_date >= current_date AND quantity_on_hand > 0
  ), allocated AS (
    SELECT id, LEAST(quantity_on_hand, GREATEST(_remaining - prior_qty, 0))::numeric AS take
    FROM ordered
  )
  INSERT INTO public.stock_movements (movement_type, product_id, batch_id, location_id, quantity_delta, unit_cost, invoice_item_id, performed_by, reason)
  SELECT 'dispensed', _product_id, a.id, _pharmacy_location, -a.take, b.unit_cost, (_item).id, public.hms_current_user_id(), 'Patient dispensing'
  FROM allocated a JOIN public.inventory_batches b ON b.id = a.id WHERE a.take > 0;

  INSERT INTO public.dispense_stock_allocations (invoice_item_id, stock_movement_id, batch_id, quantity, dispensed_by)
  SELECT (_item).id, sm.id, sm.batch_id, -sm.quantity_delta, public.hms_current_user_id()
  FROM public.stock_movements sm
  WHERE sm.invoice_item_id = (_item).id AND sm.movement_type = 'dispensed'
    AND sm.created_at >= transaction_timestamp();""",
            s, count=1, flags=re.IGNORECASE,
        )

    upper = s.upper()
    # These generic pg_proc privilege loops use unsupported RECORD variables.
    # Explicit HMS grants/revokes remain in the ordered migration stream.
    if re.search(r"\bDO\s+\$[^$]*\$.*DECLARE\s+r\s+record\b", s, flags=re.IGNORECASE | re.DOTALL):
        return None
    alter_enum = re.search(r"\bDO\s+\$[^$]*\$\s*BEGIN\s*(ALTER\s+TYPE\b[\s\S]*?\bADD\s+VALUE[\s\S]*?;)\s*EXCEPTION\b", s, flags=re.IGNORECASE)
    if alter_enum:
        s = alter_enum.group(1).strip()
    create_type = re.search(r"\bDO\s+\$[^$]*\$\s*BEGIN\s*(CREATE\s+TYPE\b[\s\S]*?;)\s*EXCEPTION\b", s, flags=re.IGNORECASE)
    if create_type:
        s = create_type.group(1).strip()
    if re.search(r"FOR\s+i\s+IN\s+1\.\.10\s+LOOP", s, flags=re.IGNORECASE) and re.search(r"first_names\s*\[", s, flags=re.IGNORECASE) and re.search(r"Dangote\s+Group", s, flags=re.IGNORECASE):
        return "SELECT 1;"

    if re.search(r"GET\s+DIAGNOSTICS\s+v_updated\s*=\s*ROW_COUNT", s, flags=re.IGNORECASE):
        s = re.sub(
            r"GET\s+DIAGNOSTICS\s+v_updated\s*=\s*ROW_COUNT;",
            "SELECT count(*) INTO v_updated FROM public.patient_archive_records WHERE archive_reference = v_reference AND status = 'pending_download';",
            s,
            flags=re.IGNORECASE,
        )
    if re.search(r"GET\s+DIAGNOSTICS\s+v_purged_count\s*=\s*ROW_COUNT", s, flags=re.IGNORECASE):
        s = re.sub(
            r"GET\s+DIAGNOSTICS\s+v_purged_count\s*=\s*ROW_COUNT;",
            "SELECT count(*) INTO v_purged_count FROM public.patient_archive_records WHERE archive_reference = v_reference AND patient_id = ANY(_patient_ids) AND status = 'download_confirmed';",
            s,
            flags=re.IGNORECASE,
        )

    if re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.enforce_patient_field_permissions\s*\(\s*\)", s, flags=re.IGNORECASE):
        return """CREATE OR REPLACE FUNCTION public.enforce_patient_field_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _uid uuid := public.hms_current_user_id();
  _old jsonb := to_jsonb(OLD);
  _new jsonb := to_jsonb(NEW);
  _identity_cols text[] := ARRAY['first_name','last_name','date_of_birth','gender','phone','address','emergency_contact','occupation','photo_path'];
  _card_cols text[] := ARRAY['card_number','mini_card_number'];
  _sponsor_cols text[] := ARRAY['account_type','corporate_id','insurance_provider','insurance_plan','insurance_policy_number','enrollee_id','member_id_data','staff_link_id'];
  _clinical_cols text[] := ARRAY['blood_group','allergies'];
BEGIN
  IF _uid IS NULL THEN RETURN NEW; END IF;
  IF public.has_role(_uid, 'admin'::app_role) THEN RETURN NEW; END IF;

  IF EXISTS (SELECT 1 FROM jsonb_object_keys(_new) AS changed(key) WHERE (_new -> changed.key) IS DISTINCT FROM (_old -> changed.key) AND changed.key = ANY(_identity_cols)) THEN
    IF NOT public.has_role(_uid, 'receptionist'::app_role) THEN
      RAISE EXCEPTION 'NOT_PERMITTED: only reception or an admin can change patient personal details';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM jsonb_object_keys(_new) AS changed(key) WHERE (_new -> changed.key) IS DISTINCT FROM (_old -> changed.key) AND changed.key = ANY(_card_cols)) THEN
    RAISE EXCEPTION 'NOT_PERMITTED: only an admin can change patient card numbers';
  ELSIF EXISTS (SELECT 1 FROM jsonb_object_keys(_new) AS changed(key) WHERE (_new -> changed.key) IS DISTINCT FROM (_old -> changed.key) AND changed.key = ANY(_sponsor_cols)) THEN
    IF NOT public.has_any_role(_uid, ARRAY['receptionist','billing','accountant','claims_manager']::app_role[]) THEN
      RAISE EXCEPTION 'NOT_PERMITTED: only reception, billing, accounts or claims staff can change sponsor/insurance details';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM jsonb_object_keys(_new) AS changed(key) WHERE (_new -> changed.key) IS DISTINCT FROM (_old -> changed.key) AND changed.key = ANY(_clinical_cols)) THEN
    IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','anc']::app_role[]) THEN
      RAISE EXCEPTION 'NOT_PERMITTED: only clinical staff can change clinical details';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM jsonb_object_keys(_new) AS changed(key) WHERE (_new -> changed.key) IS DISTINCT FROM (_old -> changed.key) AND changed.key = 'balance') THEN
    IF COALESCE(current_setting('app.allow_balance_write', true), '') <> 'on'
       AND NOT public.has_any_role(_uid, ARRAY['billing','cashier','accountant']::app_role[]) THEN
      RAISE EXCEPTION 'NOT_PERMITTED: patient balance can only be changed by billing/cashier/accounts or through a payment routine';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;"""

    if re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.discharge_admission\s*\(", s, flags=re.IGNORECASE):
        s = s.replace("  _left numeric;", "  _left numeric;\n  _applied numeric := 0;")
        if "_applied numeric" not in s:
            s = re.sub(r"(_left\s+numeric;)", r"\1\n  _applied numeric := 0;", s, count=1, flags=re.IGNORECASE)
        old_loop = """  IF _left > 0 THEN
    FOR _inv IN
      SELECT id, total_amount, COALESCE(paid_amount,0) AS paid
      FROM public.invoices
      WHERE patient_id = _adm.patient_id
        AND status IN ('pending','partial')
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN _left <= 0;
      _apply := ROUND(LEAST(_left, _inv.total_amount - _inv.paid), 2);
      CONTINUE WHEN _apply <= 0;
      UPDATE public.invoices
         SET paid_amount = _inv.paid + _apply,
             status = CASE WHEN _inv.paid + _apply >= _inv.total_amount THEN 'paid' ELSE 'partial' END,
             paid_at = CASE WHEN _inv.paid + _apply >= _inv.total_amount THEN now() ELSE paid_at END,
             payment_method = COALESCE(payment_method, _settlement_method),
             updated_at = now()
       WHERE id = _inv.id;
      _left := ROUND(_left - _apply, 2);
    END LOOP;
  END IF;"""
        new_loop = """  IF _left > 0 THEN
    SELECT COALESCE(SUM(applied), 0) INTO _applied
    FROM (
      SELECT LEAST(due, GREATEST(_left - prior_due, 0))::numeric AS applied
      FROM (
        SELECT GREATEST(total_amount - COALESCE(paid_amount, 0), 0)::numeric AS due,
               COALESCE(SUM(GREATEST(total_amount - COALESCE(paid_amount, 0), 0)) OVER (
                 ORDER BY created_at ASC, id ASC
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ), 0)::numeric AS prior_due
        FROM public.invoices
        WHERE patient_id = _adm.patient_id
          AND status IN ('pending','partial')
      ) unpaid
    ) allocation;

    WITH unpaid AS (
      SELECT id, total_amount, COALESCE(paid_amount, 0)::numeric AS paid,
             GREATEST(total_amount - COALESCE(paid_amount, 0), 0)::numeric AS due,
             COALESCE(SUM(GREATEST(total_amount - COALESCE(paid_amount, 0), 0)) OVER (
               ORDER BY created_at ASC, id ASC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0)::numeric AS prior_due
      FROM public.invoices
      WHERE patient_id = _adm.patient_id
        AND status IN ('pending','partial')
    ), allocated AS (
      SELECT id, total_amount, paid,
             LEAST(due, GREATEST(_left - prior_due, 0))::numeric AS applied
      FROM unpaid
    )
    UPDATE public.invoices i
       SET paid_amount = a.paid + a.applied,
           status = CASE WHEN a.paid + a.applied >= a.total_amount THEN 'paid' ELSE 'partial' END,
           paid_at = CASE WHEN a.paid + a.applied >= a.total_amount THEN now() ELSE i.paid_at END,
           payment_method = COALESCE(i.payment_method, _settlement_method),
           updated_at = now()
      FROM allocated a
     WHERE i.id = a.id AND a.applied > 0;

    _left := ROUND(_left - COALESCE(_applied, 0), 2);
  END IF;"""
        if old_loop in s:
            s = s.replace(old_loop, new_loop)

        share_loop = re.compile(r"  IF _left > 0 THEN\s+FOR _inv IN\s+SELECT id, total_amount, COALESCE\(paid_amount,0\) AS paid\s+FROM public\.invoices\s+WHERE patient_id = _adm\.patient_id AND status IN \('pending','partial'\)\s+ORDER BY created_at ASC\s+LOOP[\s\S]*?END LOOP;\s+END IF;", re.IGNORECASE)
        share_replacement = """  IF _left > 0 THEN
    SELECT COALESCE(SUM(applied), 0) INTO _applied
    FROM (
      SELECT LEAST(share, GREATEST(_left - prior_due, 0))::numeric AS applied
      FROM (
        SELECT ROUND(total_amount * _pct / 100.0, 2)::numeric AS share,
               GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)::numeric AS due,
               COALESCE(SUM(GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)) OVER (
                 ORDER BY created_at ASC, id ASC
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ), 0)::numeric AS prior_due
        FROM public.invoices
        WHERE patient_id = _adm.patient_id AND status IN ('pending','partial')
      ) unpaid
    ) allocation;

    WITH unpaid AS (
      SELECT id, total_amount, COALESCE(paid_amount, 0)::numeric AS paid,
             ROUND(total_amount * _pct / 100.0, 2)::numeric AS share,
             GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)::numeric AS due,
             COALESCE(SUM(GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)) OVER (
               ORDER BY created_at ASC, id ASC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0)::numeric AS prior_due
      FROM public.invoices
      WHERE patient_id = _adm.patient_id AND status IN ('pending','partial')
    ), allocated AS (
      SELECT id, total_amount, paid, share,
             LEAST(due, GREATEST(_left - prior_due, 0))::numeric AS applied
      FROM unpaid
    )
    UPDATE public.invoices i
       SET paid_amount = a.paid + a.applied,
           status = CASE WHEN a.paid + a.applied >= a.share THEN 'paid' ELSE 'partial' END,
           paid_at = CASE WHEN a.paid + a.applied >= a.share THEN now() ELSE i.paid_at END,
           payment_method = COALESCE(i.payment_method, _settlement_method),
           updated_at = now()
      FROM allocated a
     WHERE i.id = a.id AND a.applied > 0;

    _left := ROUND(_left - COALESCE(_applied, 0), 2);
  END IF;"""
        s = share_loop.sub(share_replacement, s, count=1)

        # Later discharge revisions use the same invoice allocation loop but
        # qualify the admission row as (_adm).patient_id and include salary
        # deduction metadata. Replace that form with a deterministic windowed
        # allocation that is supported by CockroachDB.
        generic_discharge_loop = re.compile(
            r"  IF _left > 0 THEN\s+FOR _inv IN\s+SELECT id, total_amount, COALESCE\(paid_amount,\s*0\) AS paid\s+"
            r"FROM public\.invoices\s+WHERE patient_id = (?:\(_adm\)\.patient_id|_adm\.patient_id)\s+"
            r"AND status IN \('pending', 'partial'\)\s+ORDER BY created_at ASC\s+LOOP[\s\S]*?END LOOP;\s+END IF;",
            re.IGNORECASE,
        )
        if generic_discharge_loop.search(s):
            share_expr = "ROUND(total_amount * _pct / 100.0, 2)" if re.search(r"\b_pct\b", s) else "total_amount"
            salary_set = ""
            if re.search(r"\bis_salary_deduction\b", s):
                salary_set += "\n           is_salary_deduction = CASE WHEN _settlement_method = 'salary' THEN true ELSE is_salary_deduction END,"
            if re.search(r"\bstaff_sponsor_id\b", s):
                salary_set += "\n           staff_sponsor_id = CASE WHEN _settlement_method = 'salary' THEN (_p).staff_link_id ELSE staff_sponsor_id END,"
            generic_replacement = f"""  IF _left > 0 THEN
    SELECT COALESCE(SUM(applied), 0) INTO _applied
    FROM (
      SELECT LEAST(due, GREATEST(_left - prior_due, 0))::numeric AS applied
      FROM (
        SELECT {share_expr}::numeric AS share,
               GREATEST(({share_expr}) - COALESCE(paid_amount, 0), 0)::numeric AS due,
               COALESCE(SUM(GREATEST(({share_expr}) - COALESCE(paid_amount, 0), 0)) OVER (
                 ORDER BY created_at ASC, id ASC
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ), 0)::numeric AS prior_due
        FROM public.invoices
        WHERE patient_id = (_adm).patient_id AND status IN ('pending', 'partial')
      ) unpaid
    ) allocation;

    WITH unpaid AS (
      SELECT id, total_amount, COALESCE(paid_amount, 0)::numeric AS paid,
             {share_expr}::numeric AS share,
             GREATEST(({share_expr}) - COALESCE(paid_amount, 0), 0)::numeric AS due,
             COALESCE(SUM(GREATEST(({share_expr}) - COALESCE(paid_amount, 0), 0)) OVER (
               ORDER BY created_at ASC, id ASC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0)::numeric AS prior_due
      FROM public.invoices
      WHERE patient_id = (_adm).patient_id AND status IN ('pending', 'partial')
    ), allocated AS (
      SELECT id, total_amount, paid, share,
             LEAST(due, GREATEST(_left - prior_due, 0))::numeric AS applied
      FROM unpaid
    )
    UPDATE public.invoices i
       SET paid_amount = a.paid + a.applied,
           status = CASE WHEN a.paid + a.applied >= a.share THEN 'paid' ELSE 'partial' END,
           paid_at = CASE WHEN a.paid + a.applied >= a.share THEN now() ELSE i.paid_at END,
           payment_method = COALESCE(i.payment_method, _settlement_method),{salary_set}
           updated_at = now()
      FROM allocated a
     WHERE i.id = a.id AND a.applied > 0;

    _left := ROUND(_left - COALESCE(_applied, 0), 2);
  END IF;"""
            s = generic_discharge_loop.sub(generic_replacement, s, count=2)

    if re.search(r"jsonb_array_elements\(_items\)", s, flags=re.IGNORECASE) and re.search(r"INSERT\s+INTO\s+public\.prescription_items", s, flags=re.IGNORECASE):
        typed_item_loop = re.compile(
            r"  FOR v_item IN SELECT \* FROM jsonb_array_elements\(_items\)\s+LOOP[\s\S]*?END LOOP;",
            re.IGNORECASE,
        )
        typed_item_replacement = """  SELECT value INTO v_item
  FROM jsonb_array_elements(_items) AS item(value)
  WHERE COALESCE(value->>'quantity', '') = ''
     OR (value->>'quantity') !~ '^[0-9]+$'
     OR (value->>'quantity')::int <= 0
     OR COALESCE(value->>'medication', '') = ''
     OR COALESCE(value->>'dosage', '') = ''
     OR COALESCE(value->>'frequency', '') = ''
     OR COALESCE(value->>'duration', '') = ''
  LIMIT 1;
  IF v_item IS NOT NULL THEN
    RAISE EXCEPTION 'Each medication requires a positive integer quantity, medication, dosage, frequency, and duration';
  END IF;

  INSERT INTO public.prescription_items
    (prescription_id, medication, dosage, frequency, duration, quantity, dispensed)
  SELECT
    v_prescription_id,
    value->>'medication',
    value->>'dosage',
    value->>'frequency',
    value->>'duration',
    (value->>'quantity')::int,
    false
  FROM jsonb_array_elements(_items) AS item(value);"""
        s = typed_item_loop.sub(typed_item_replacement, s, count=1)
        s = typed_item_loop.sub(typed_item_replacement, s, count=1)

    if re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.apply_wallet_to_outstanding\s*\(", s, flags=re.IGNORECASE):
        wallet_loop = re.compile(r"  FOR _inv IN\s+SELECT id, total_amount, COALESCE\(paid_amount,\s*0\) AS paid\s+FROM public\.invoices\s+WHERE patient_id = _patient_id AND status IN \('pending','partial'\)\s+ORDER BY created_at ASC\s+LOOP[\s\S]*?END LOOP;", re.IGNORECASE)
        wallet_replacement = """  SELECT COALESCE(SUM(applied), 0) INTO _applied
  FROM (
    SELECT LEAST(share, GREATEST(_credit - prior_due, 0))::numeric AS applied
    FROM (
      SELECT ROUND(total_amount * _pct / 100.0, 2)::numeric AS share,
             GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)::numeric AS due,
             COALESCE(SUM(GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)) OVER (
               ORDER BY created_at ASC, id ASC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0)::numeric AS prior_due
      FROM public.invoices
      WHERE patient_id = _patient_id AND status IN ('pending','partial')
    ) unpaid
  ) allocation;

  IF _applied > 0 THEN
    WITH unpaid AS (
      SELECT id, total_amount, COALESCE(paid_amount, 0)::numeric AS paid,
             ROUND(total_amount * _pct / 100.0, 2)::numeric AS share,
             GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)::numeric AS due,
             COALESCE(SUM(GREATEST(ROUND(total_amount * _pct / 100.0, 2) - COALESCE(paid_amount, 0), 0)) OVER (
               ORDER BY created_at ASC, id ASC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0)::numeric AS prior_due
      FROM public.invoices
      WHERE patient_id = _patient_id AND status IN ('pending','partial')
    ), allocated AS (
      SELECT id, total_amount, paid, share,
             LEAST(due, GREATEST(_credit - prior_due, 0))::numeric AS applied
      FROM unpaid
    )
    UPDATE public.invoices i
       SET paid_amount = a.paid + a.applied,
           status = CASE WHEN a.paid + a.applied >= a.share THEN 'paid' ELSE 'partial' END,
           paid_at = CASE WHEN a.paid + a.applied >= a.share THEN now() ELSE i.paid_at END,
           payment_method = COALESCE(i.payment_method, 'wallet'),
           updated_at = now()
      FROM allocated a
     WHERE i.id = a.id AND a.applied > 0;

    SELECT public.adjust_patient_balance(_patient_id, -_applied, 'invoice_deduction',
      'wallet', NULL, NULL, _note);
  END IF;"""
        s = wallet_loop.sub(wallet_replacement, s, count=1)

    if re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.admission_discharge_preview\s*\(", s, flags=re.IGNORECASE):
        s = re.sub(r"\bSTABLE\b", "", s, count=1, flags=re.IGNORECASE)

    if re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.bill_admission_bed_days\s*\(", s, flags=re.IGNORECASE):
        s = re.sub(r"_room\s+(?:RECORD|public\.beds);", "_room_class text;", s, flags=re.IGNORECASE)
        s = re.sub(
            r"SELECT\s+r\.room_number\s*,\s*r\.room_class\s+INTO\s+_room\s+FROM\s+public\.beds\s+b\s+JOIN\s+public\.rooms\s+r",
            "SELECT r.room_class INTO _room_class FROM public.beds b JOIN public.rooms r",
            s,
            flags=re.IGNORECASE,
        )
        s = re.sub(
            r"SELECT\s+\*\s+INTO\s+_room\s+FROM\s+public\.beds\s+b\s+JOIN\s+public\.rooms\s+r",
            "SELECT r.room_class INTO _room_class FROM public.beds b JOIN public.rooms r",
            s,
            flags=re.IGNORECASE,
        )
        s = s.replace("COALESCE(_room.room_class, 'ward')", "COALESCE(_room_class, 'ward')")
        s = s.replace("(_room).room_class", "_room_class")
        s = s.replace("_room.room_class", "_room_class")

    if re.search(r"_room\s+public\.beds;", s, flags=re.IGNORECASE) and re.search(r"SELECT\s+\*\s+INTO\s+_room\s+FROM\s+public\.beds\s+b\s+JOIN\s+public\.rooms\s+r", s, flags=re.IGNORECASE):
        s = re.sub(r"(_room\s+)public\.beds;", r"\1public.rooms;", s, flags=re.IGNORECASE)
        s = re.sub(r"SELECT\s+\*\s+INTO\s+_room\s+FROM\s+public\.beds\s+b\s+JOIN\s+public\.rooms\s+r", "SELECT r.* INTO _room FROM public.beds b JOIN public.rooms r", s, flags=re.IGNORECASE)

    if re.search(r"admission_bed_charge", s, flags=re.IGNORECASE):
        s = s.replace(
            "(GREATEST(1, CEIL(EXTRACT(EPOCH FROM (COALESCE(a.discharged_at, now()) - COALESCE(a.admitted_at, a.created_at))) / 86400.0)) * COALESCE(r.daily_rate, 0))",
            "(GREATEST(1, CEIL(EXTRACT(EPOCH FROM (COALESCE(a.discharged_at, now()) - COALESCE(a.admitted_at, a.created_at))) / 86400.0))::numeric * COALESCE(r.daily_rate, 0)::numeric)",
        )

    if re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.purge_clinical_data\s*\(", s, flags=re.IGNORECASE):
        s = re.sub(
            r"(?m)^(\s*)(DELETE\s+FROM\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)(\s+WHERE\s+[^;]+)?);\s*GET\s+DIAGNOSTICS\s+_n\s*=\s*ROW_COUNT;",
            lambda m: f"{m.group(1)}SELECT count(*) INTO _n FROM {m.group(3)}{m.group(4) or ''};\n{m.group(1)}{m.group(2)};",
            s,
            flags=re.IGNORECASE,
        )
        s = re.sub(
            r"(?m)^(\s*)(UPDATE\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)\s+SET\s+[\s\S]*?\s+WHERE\s+([^;]+);)\s*GET\s+DIAGNOSTICS\s+_n\s*=\s*ROW_COUNT;",
            lambda m: f"{m.group(1)}SELECT count(*) INTO _n FROM {m.group(3)} WHERE {m.group(4)};\n{m.group(1)}{m.group(2)}",
            s,
            flags=re.IGNORECASE,
        )

    if re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.reconcile_paid_snap_orders\s*\(\s*\)", s, flags=re.IGNORECASE):
        return """CREATE OR REPLACE FUNCTION public.reconcile_paid_snap_orders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  healed_snaps int := 0;
  healed_patients int := 0;
BEGIN
  WITH updated AS (
    UPDATE public.snap_orders s
       SET status = 'paid',
           paid_at = COALESCE(s.paid_at, now()),
           updated_at = now()
      FROM public.invoices i
     WHERE s.invoice_id = i.id
       AND s.status = 'awaiting_payment'
       AND i.status = 'paid'
    RETURNING s.id
  )
  SELECT count(*) INTO healed_snaps FROM updated;

  WITH candidates AS (
    SELECT p.id, public.patient_pending_workflow_station(p.id) AS next_station
      FROM public.patients p
     WHERE p.status = 'awaiting_payment'
       AND NOT EXISTS (
         SELECT 1 FROM public.invoices i
          WHERE i.patient_id = p.id
            AND i.status IN ('pending','partial')
       )
  ), updated AS (
    UPDATE public.patients p
       SET status = COALESCE(c.next_station, 'discharged'), updated_at = now()
      FROM candidates c
     WHERE p.id = c.id
       AND c.next_station IS DISTINCT FROM 'awaiting_payment'
    RETURNING p.id
  )
  SELECT count(*) INTO healed_patients FROM updated;

  RETURN jsonb_build_object(
    'healed_snaps', healed_snaps,
    'healed_patients', healed_patients,
    'ran_at', now()
  );
END;
$$;"""

    if re.search(r"pg_get_constraintdef\s*\(\s*oid\s*\)\s+ILIKE\s+'%claim_status%'", s, flags=re.IGNORECASE):
        return """ALTER TABLE public.visits DROP CONSTRAINT IF EXISTS visits_claim_status_check;
ALTER TABLE public.visits
  ADD CONSTRAINT visits_claim_status_check
  CHECK (claim_status IN ('not_applicable','pending','settled','rejected','info_requested'));"""

    if re.search(r"FOREACH\s+_ward_letter\s+IN\s+ARRAY\s+ARRAY\s*\[\s*'A'\s*,\s*'B'\s*,\s*'C'\s*,\s*'D'\s*,\s*'E'", s, flags=re.IGNORECASE):
        return """INSERT INTO public.wards (name, ward_type, gender, description, active, min_admission_deposit)
VALUES
  ('Ward A', 'general', 'any', NULL, true, 0),
  ('Ward B', 'general', 'any', NULL, true, 0),
  ('Ward C', 'general', 'any', NULL, true, 0),
  ('Ward D', 'general', 'any', NULL, true, 0),
  ('Ward E', 'vip', 'any', 'VIP ward', true, 0)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.rooms (ward_id, room_number, room_class, daily_rate, active)
SELECT w.id, v.letter || n.number::text,
       CASE WHEN v.is_vip THEN 'vip' ELSE 'general' END,
       CASE WHEN v.is_vip THEN 25000 ELSE 5000 END,
       true
FROM public.wards AS w
JOIN (VALUES ('A', false), ('B', false), ('C', false), ('D', false), ('E', true)) AS v(letter, is_vip)
  ON w.name = 'Ward ' || v.letter
CROSS JOIN (VALUES (1), (2), (3)) AS n(number)
WHERE NOT EXISTS (
  SELECT 1 FROM public.rooms AS existing_room
  WHERE existing_room.ward_id = w.id
    AND existing_room.room_number = v.letter || n.number::text
);

INSERT INTO public.beds (room_id, bed_label, status, active)
SELECT r.id, 'Bed 1', 'available', true
FROM public.rooms AS r
WHERE NOT EXISTS (
  SELECT 1 FROM public.beds AS existing_bed
  WHERE existing_bed.room_id = r.id
);"""

    if re.search(r"create_prescription_from_snap", s, flags=re.IGNORECASE) and re.search(r"FOR\s+v_item\s+IN\s+SELECT\s+\*\s+FROM\s+jsonb_array_elements", s, flags=re.IGNORECASE):
        s = re.sub(
            r"\s+FOR\s+v_item\s+IN\s+SELECT\s+\*\s+FROM\s+jsonb_array_elements\([\s\S]*?END\s+LOOP;",
            """
  INSERT INTO public.prescription_items
    (prescription_id, medication, dosage, frequency, duration, quantity, dispensed)
  SELECT
    v_prescription_id,
    COALESCE(item.value->>'medication', item.value->>'name', 'Unknown'),
    COALESCE(item.value->>'dosage', ''),
    COALESCE(item.value->>'frequency', ''),
    COALESCE(item.value->>'duration', ''),
    COALESCE((item.value->>'quantity')::int, (item.value->>'qty')::int, 1),
    true
  FROM jsonb_array_elements(COALESCE(_items, '[]'::jsonb)) AS item(value);""",
            s,
            count=1,
            flags=re.IGNORECASE,
        )

    # The HMS source later converts patients.corporate_id from TEXT to UUID,
    # but CockroachDB cannot alter a column while earlier production functions
    # depend on it. Keep the established text identifier contract; functions
    # cast it at UUID destinations and the cleanup statement remains applied.
    if re.search(r"ALTER\s+TABLE\s+public\.patients\s+ALTER\s+COLUMN\s+corporate_id\s+TYPE\s+uuid", s, flags=re.IGNORECASE):
        return None
    if re.search(r"patients_corporate_id_fkey", s, flags=re.IGNORECASE):
        return None

    drop_constraints = re.findall(
        r"ALTER\s+TABLE\s+((?:public\.)?[A-Za-z_]\w*)\s+DROP\s+CONSTRAINT\s+([A-Za-z_]\w*)\s*;",
        s,
        flags=re.IGNORECASE,
    )
    if re.match(r"^DO\s+\$", s, flags=re.IGNORECASE) and drop_constraints:
        return "\n".join(
            f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {constraint};"
            for table, constraint in drop_constraints
        )
    # CockroachDB does not provide the Supabase pg_cron schema; scheduled reconciliation
    # will be handled by Netlify or an external scheduler instead.
    if re.search(r"\bcron\.", s, flags=re.IGNORECASE):
        return None

    if re.search(r"^\s*ALTER\s+VIEW\b[\s\S]*security_invoker", s, flags=re.IGNORECASE):
        return None
    s = re.sub(r"(?im)^\s*WITH\s*\(\s*security_invoker\s*=\s*(?:on|off|true|false)\s*\)\s*", "", s)
    s = re.sub(r"\s+WITH\s*\(\s*security_invoker\s*=\s*(?:on|off|true|false)\s*\)", "", s, flags=re.IGNORECASE)

    s = re.sub(r"_got_lock\s*:=\s*(?:pg_catalog\.)?pg_try_advisory_xact_lock\s*\([^;]+;", "_got_lock := true;", s, flags=re.IGNORECASE)

    if re.match(r"\s*DO\s+\$\$", s, flags=re.IGNORECASE) and "ALTER TABLE" in upper and "DROP CONSTRAINT IF EXISTS" in upper:
        s = re.sub(r"^\s*DO\s+\$\$\s*BEGIN\s*", "", s, flags=re.IGNORECASE | re.DOTALL)
        s = re.sub(r"\s*END\s*\$\$\s*;?\s*$", "", s, flags=re.IGNORECASE | re.DOTALL)
        s = re.sub(
            r"ALTER TABLE\s+(?P<table>public\.[A-Za-z0-9_]+)\s+DROP CONSTRAINT IF EXISTS\s+(?P<drop>[A-Za-z0-9_]+)\s*,\s*ADD CONSTRAINT\s+(?P<add>[A-Za-z0-9_]+)\s+(?P<rest>[^;]+);",
            lambda m: f"ALTER TABLE {m.group('table')} DROP CONSTRAINT IF EXISTS {m.group('drop')}; ALTER TABLE {m.group('table')} ADD CONSTRAINT {m.group('add')} {m.group('rest')};",
            s,
            flags=re.IGNORECASE | re.DOTALL,
        )
        return s.strip()

    # CockroachDB does not support ALTER TABLE inside a procedural DO block.
    # Convert the common information_schema-guarded ADD COLUMN form into
    # idempotent direct DDL before execution.
    if re.search(r"\bDO\s+\$\$", s, flags=re.IGNORECASE) and "INFORMATION_SCHEMA.COLUMNS" in upper and "ALTER TABLE" in upper and "ADD COLUMN" in upper:
        add_column = re.search(
            r"ALTER\s+TABLE\s+(public\.[A-Za-z_]\w*)\s+ADD\s+COLUMN\s+([A-Za-z_]\w*)\s+([^;]+);",
            s,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if add_column:
            return f"ALTER TABLE {add_column.group(1)} ADD COLUMN IF NOT EXISTS {add_column.group(2)} {add_column.group(3).strip()};"

    # Entire statements that belong to Supabase services or unsupported extensions.
    if any(token in upper for token in (
        "SUPABASE_REALTIME", "STORAGE.OBJECTS", "PG_CRON", "PG_NET",
        "REPLICA IDENTITY", "CREATE PUBLICATION", "ALTER PUBLICATION",
        "CREATE EXTENSION IF NOT EXISTS PG_TRGM",
    )):
        return None

    # Neon Auth and Supabase Auth are replaced by the local application identity table.
    s = re.sub(r"\bneon_auth\.user\b", "public.auth_users", s, flags=re.IGNORECASE)
    s = re.sub(r"\bauth\.users\b", "public.auth_users", s, flags=re.IGNORECASE)
    s = re.sub(r"\bauth\.uid\s*\(\s*\)", "public.hms_current_user_id()", s, flags=re.IGNORECASE)
    s = re.sub(r"\bauth\.role\s*\(\s*\)", "public.hms_current_user_role()", s, flags=re.IGNORECASE)
    s = re.sub(
        r"staff_id\s+IN\s+\(\s*SELECT\s+id\s+FROM\s+public\.staff\s+WHERE\s+auth_user_id\s*=\s*public\.hms_current_user_id\(\)\s*\)",
        "staff_id = public.hms_current_staff_id()",
        s,
        flags=re.IGNORECASE,
    )

    # get_visit_audit_trail raises on authorization failure, so it cannot be
    # declared STABLE by CockroachDB even though its successful path is read-only.
    if re.search(r"FUNCTION\s+public\.get_visit_audit_trail\s*\(", s, flags=re.IGNORECASE):
        s = re.sub(r"\bSTABLE\s+SECURITY\s+DEFINER\b", "SECURITY DEFINER", s, count=1, flags=re.IGNORECASE)

    # CockroachDB rejects a trigger on invoices whose trigger function also
    # statically reads invoices. Maintain visit totals by invoice deltas instead.
    if re.search(r"FUNCTION\s+public\.invoices_touch_visit_totals\s*\(\s*\)", s, flags=re.IGNORECASE):
        return """CREATE OR REPLACE FUNCTION public.invoices_touch_visit_totals()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _old_visit UUID;
  _new_visit UUID;
  _old_charged NUMERIC := 0;
  _old_paid NUMERIC := 0;
  _new_charged NUMERIC := 0;
  _new_paid NUMERIC := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _old_visit := (OLD).visit_id;
    _old_charged := COALESCE((OLD).total_amount, 0);
    _old_paid := COALESCE((OLD).paid_amount, 0);
    IF _old_visit IS NOT NULL THEN
      UPDATE public.visits
      SET total_charged = COALESCE(total_charged, 0) - _old_charged,
          total_paid = COALESCE(total_paid, 0) - _old_paid,
          updated_at = now()
      WHERE id = _old_visit;
    END IF;
    RETURN OLD;
  END IF;

  _new_visit := (NEW).visit_id;
  _new_charged := COALESCE((NEW).total_amount, 0);
  _new_paid := COALESCE((NEW).paid_amount, 0);
  IF TG_OP = 'UPDATE' THEN
    _old_visit := (OLD).visit_id;
    _old_charged := COALESCE((OLD).total_amount, 0);
    _old_paid := COALESCE((OLD).paid_amount, 0);
    IF _old_visit IS DISTINCT FROM _new_visit THEN
      IF _old_visit IS NOT NULL THEN
        UPDATE public.visits
        SET total_charged = COALESCE(total_charged, 0) - _old_charged,
            total_paid = COALESCE(total_paid, 0) - _old_paid,
            updated_at = now()
        WHERE id = _old_visit;
      END IF;
      IF _new_visit IS NOT NULL THEN
        UPDATE public.visits
        SET total_charged = COALESCE(total_charged, 0) + _new_charged,
            total_paid = COALESCE(total_paid, 0) + _new_paid,
            updated_at = now()
        WHERE id = _new_visit;
      END IF;
    ELSE
      IF _new_visit IS NOT NULL THEN
        UPDATE public.visits
        SET total_charged = COALESCE(total_charged, 0) + (_new_charged - _old_charged),
            total_paid = COALESCE(total_paid, 0) + (_new_paid - _old_paid),
            updated_at = now()
        WHERE id = _new_visit;
      END IF;
    END IF;
  ELSE
    IF _new_visit IS NOT NULL THEN
      UPDATE public.visits
      SET total_charged = COALESCE(total_charged, 0) + _new_charged,
          total_paid = COALESCE(total_paid, 0) + _new_paid,
          updated_at = now()
      WHERE id = _new_visit;
    END IF;
  END IF;
  RETURN NEW;
END; $$;"""

    s = rewrite_record_variables(s)

    # Apply once more after row-variable normalization because that pass may
    # parenthesize a patient row variable.
    s = re.sub(
        r"COALESCE\(\s*\(_p\)\.registration_fee_paid\s*,\s*FALSE\s*\)",
        "COALESCE((SELECT registration_fee_paid FROM public.patients WHERE id = _patient_id), FALSE)",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(
        r"COALESCE\(\s*_p\.registration_fee_paid\s*,\s*FALSE\s*\)",
        "COALESCE((SELECT registration_fee_paid FROM public.patients WHERE id = _patient_id), FALSE)",
        s,
        flags=re.IGNORECASE,
    )

    def rowtype_replacement(match: re.Match[str]) -> str:
        return f"{match.group(1) or 'public.'}{match.group(2)}"

    s = re.sub(
        r"\b(public\.)?([A-Za-z_]\w*)%ROWTYPE\b",
        rowtype_replacement,
        s,
        flags=re.IGNORECASE,
    )
    row_variables = re.findall(
        r"(?m)^\s*([A-Za-z_]\w*)\s+public\.[A-Za-z_]\w*\s*(?:;|:=)",
        s,
        flags=re.IGNORECASE,
    )
    for row_variable in row_variables:
        s = re.sub(rf"\b{re.escape(row_variable)}\.", f"({row_variable}).", s)

    s = re.sub(
        r"(SELECT\s+\*\s+INTO\s+([A-Za-z_]\w*)[\s\S]{0,320}?;)\s*IF\s+NOT\s+FOUND\s+THEN",
        lambda m: f"{m.group(1)}\n  IF ({m.group(2)}).id IS NULL THEN",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(
        r"(WHERE\s+ii\.id\s*=\s*_item_id\s+AND\s+ii\.dispensing_status\s*=\s*'unavailable';)\s*IF\s+NOT\s+FOUND\s+THEN",
        r"\1\n    IF _patient_id IS NULL THEN",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(
        r"IF\s+NOT\s+FOUND\s+OR\s+NOT\s+\(v_eligibility\)\.is_eligible\s+THEN",
        "IF (v_eligibility).patient_id IS NULL OR NOT (v_eligibility).is_eligible THEN",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(
        r"(SELECT\s+r\.status\s+INTO\s+v_existing_status[\s\S]{0,220}?;)\s*IF\s+FOUND\s+THEN",
        lambda m: f"{m.group(1)}\n    IF v_existing_status IS NOT NULL THEN",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(
        r"IF\s+NOT\s+FOUND\s+THEN(\s*RAISE\s+EXCEPTION\s+'ALREADY_DISCHARGED:[\s\S]*?END\s+IF;)",
        r"IF (_adm).status <> 'ready_for_discharge' THEN\1",
        s,
        flags=re.IGNORECASE,
    )

    # Salary-deduction metadata is preserved through compatibility columns
    # injected after the invoices table is created; do not strip assignments.

    # CockroachDB rejects ON DELETE SET NULL when the referencing column is
    # declared NOT NULL. Archived patient rows must survive patient purges, so
    # preserve the intended action and make patient_id nullable.
    s = re.sub(
        r"(patient_id\s+uuid)\s+NOT\s+NULL\s+REFERENCES\s+public\.patients\(id\)\s+ON\s+DELETE\s+SET\s+NULL",
        r"\1 REFERENCES public.patients(id) ON DELETE SET NULL",
        s,
        flags=re.IGNORECASE,
    )

    # In the HMS schema patients.corporate_id is text while sponsor IDs are UUIDs.
    # Preserve the existing identifier semantics with explicit casts at UUID boundaries.
    s = re.sub(r"(\b(?:[A-Za-z_]\w*\.)?corporate_id\s*=\s*)((_sponsor_id|_sponsor|_corporate_id)\b)", r"\1\2::text", s, flags=re.IGNORECASE)
    s = re.sub(r"(\bTHEN\s+)p\.corporate_id\b", r"\1NULLIF(p.corporate_id, '')::uuid", s, flags=re.IGNORECASE)

    # CockroachDB accepts enum value additions but not PostgreSQL's
    # ADD VALUE IF NOT EXISTS syntax in this migration form. These HMS enum
    # values are unique in the clean ordered import.
    s = re.sub(r"RETURN\s+COALESCE\(NEW\s*,\s*OLD\)\s*;", "RETURN NEW;", s, flags=re.IGNORECASE)

    # CockroachDB's PL/pgSQL implementation does not support PERFORM;
    # SELECT is the compatible side-effect call for these void-returning HMS
    # procedures and functions.
    s = re.sub(r"\bPERFORM\s+", "SELECT ", s, flags=re.IGNORECASE)

    # Within SQL expressions in trigger functions, CockroachDB resolves the
    # trigger pseudo-record fields using parenthesized NEW/OLD notation.
    s = re.sub(r"\b(NEW|OLD)\.", r"(\1).", s, flags=re.IGNORECASE)
    # Restore direct PL/pgSQL assignments to the trigger record, which must
    # remain NEW.column :=/=. This covers one-line and line-start forms.
    s = re.sub(r"\b(BEGIN|THEN|ELSE)\s+\(NEW\)\.([A-Za-z_]\w*)(\s*(?::=|=))", r"\1 NEW.\2\3", s, flags=re.IGNORECASE)
    s = re.sub(r"(?m)^(\s*)\(NEW\)\.([A-Za-z_]\w*)(\s*(?::=|=))", r"\1NEW.\2\3", s, flags=re.IGNORECASE)
    s = re.sub(r"(?m)^(\s*)\(OLD\)\.([A-Za-z_]\w*)(\s*(?::=|=))", r"\1OLD.\2\3", s, flags=re.IGNORECASE)

    s = re.sub(r"(ALTER\s+TYPE\s+[^;]+?\s+ADD\s+VALUE)\s+IF\s+NOT\s+EXISTS\s+", r"\1 ", s, flags=re.IGNORECASE)

    s = re.sub(
        r"ALTER\s+TABLE\s+((?:public\.)?[A-Za-z_]\w*)\s+DROP\s+CONSTRAINT\s+(?!IF\s+EXISTS\s+)([A-Za-z_]\w*)",
        r"ALTER TABLE \1 DROP CONSTRAINT IF EXISTS \2",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(r"(DROP\s+FUNCTION\s+IF\s+EXISTS\s+[^;]+?)\s+CASCADE", r"\1", s, flags=re.IGNORECASE)
    s = re.sub(
        r"\bCREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS\s+)",
        lambda m: f"CREATE {m.group(1) or ''}INDEX IF NOT EXISTS ",
        s,
        flags=re.IGNORECASE,
    )

    # CockroachDB does not support PostgreSQL trigger column lists (UPDATE OF).
    s = re.sub(r"\bUPDATE\s+OF\s+[A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*\s+ON\b", "UPDATE ON", s, flags=re.IGNORECASE)

    # CockroachDB rejects a descriptor dependency cycle when a policy on
    # user_roles calls has_role(), because has_role() reads user_roles. The
    # session role is already set by the application auth layer, so use the
    # bootstrap helper only for these self-referential admin policies.
    if re.search(r"ON\s+public\.user_roles\b", s, flags=re.IGNORECASE):
        s = re.sub(
            r"public\.has_role\(\s*public\.hms_current_user_id\(\)\s*,\s*'admin'\s*\)",
            "public.hms_current_user_role() = 'admin'",
            s,
            flags=re.IGNORECASE,
        )

    # CockroachDB supports SECURITY DEFINER; retain it for RLS helper functions.
    # Remove only the unsupported search_path clause. Preserve AS $$ / $function$
    # markers, and skip standalone ALTER FUNCTION storage-setting statements.
    if re.match(r"^ALTER\s+FUNCTION\b", s, flags=re.IGNORECASE) and re.search(r"SET\s+search_path", s, flags=re.IGNORECASE):
        return None
    s = re.sub(r"\bSET\s+search_path\s+(?:TO\s+(?:'public'|\"public\"|public)|=\s*public)", "", s, flags=re.IGNORECASE)

    # CockroachDB retains parameter defaults on CREATE OR REPLACE. Preserve
    # the legacy success default on every five-argument audit-log replacement,
    # while four-argument callers are normalized later with explicit status.
    if re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.write_audit_log\b", s, flags=re.IGNORECASE):
        s = re.sub(
            r"(_status\s+text)(?!\s+DEFAULT)",
            r"\1 DEFAULT 'success'",
            s,
            count=1,
            flags=re.IGNORECASE,
        )

    # write_audit_log overloads are referenced by already-created routines.
    # CockroachDB cannot drop a depended-on routine without CASCADE, and the
    # following CREATE OR REPLACE statements are sufficient to update/create
    # each overload. Replace only these cleanup drops with no-ops.
    s = re.sub(
        r"DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.write_audit_log\([^;]+\);",
        "SELECT 1;",
        s,
        flags=re.IGNORECASE | re.DOTALL,
    )
    # Existing routines depend on this balance helper, so its PostgreSQL
    # cleanup drop cannot be executed on CockroachDB without CASCADE.
    s = re.sub(
        r"DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.adjust_patient_balance\([^;]+\);",
        "SELECT 1;",
        s,
        flags=re.IGNORECASE | re.DOTALL,
    )

    # CockroachDB Serverless virtual clusters do not expose PostgreSQL's
    # pg_database_size() and reject node-store virtual tables. Keep the admin
    # endpoint callable and explicit: the UI can show that provider-level size
    # must be read from CockroachDB Cloud rather than displaying a false value.
    if re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_database_size\s*\(\)", s, flags=re.IGNORECASE):
        s = re.sub(
            r"AS\s+\$\$.*?\$\$\s*;",
            """AS $$
BEGIN
  IF NOT public.has_role(public.hms_current_user_id(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can check database size';
  END IF;

  RETURN QUERY
  SELECT NULL::bigint, current_database()::text;
END;
$$;""",
            s,
            count=1,
            flags=re.IGNORECASE | re.DOTALL,
        )

    # The late refund routines retain an obsolete balance-helper argument order.
    # The final 'topup' value is the intended transaction type for crediting the
    # patient's balance; preserve the invoice relationship and explanatory note.
    s = s.replace(
        """SELECT public.adjust_patient_balance(
            _item_total,
            'Refund for unavailable: ' || _item_desc,
            _patient_id,
            'cash',
            _invoice_id,
            null,
            'topup'
        ) INTO _new_balance;""",
        """SELECT public.adjust_patient_balance(
            _patient_id,
            _item_total,
            'topup',
            'cash',
            NULL,
            _invoice_id,
            'Refund for unavailable: ' || _item_desc
        ) INTO _new_balance;""",
    )
    s = s.replace(
        """SELECT public.adjust_patient_balance(
            _item_total,
            'Credit for not given item: ' || _item_desc,
            _patient_id,
            'cash',
            _invoice_id,
            null,
            'topup'
        ) INTO _new_balance;""",
        """SELECT public.adjust_patient_balance(
            _patient_id,
            _item_total,
            'topup',
            'cash',
            NULL,
            _invoice_id,
            'Credit for not given item: ' || _item_desc
        ) INTO _new_balance;""",
    )

    # Some later legacy migrations emit inventory audit calls in both the
    # canonical four-argument UUID shape and the older text/text/text/jsonb
    # shape. Because CockroachDB retains defaults on CREATE OR REPLACE, the
    # four-argument UUID call can remain ambiguous when both overloads exist.
    # Always provide an explicit status and normalize the older shape.
    s = re.sub(
        r"SELECT\s+public\.write_audit_log\(\s*'item_marked_unavailable'\s*,\s*'invoice'\s*,\s*_invoice_id::text\s*,\s*jsonb_build_object\((.*?)\)\s*\);",
        r"SELECT public.write_audit_log('item_marked_unavailable', 'invoice', _invoice_id::text, jsonb_build_object(\1), 'success');",
        s,
        flags=re.IGNORECASE | re.DOTALL,
    )
    s = re.sub(
        r"(SELECT\s+public\.write_audit_log\(\s*'[^']+'\s*,\s*jsonb_build_object\(.*?\)\s*,\s*_invoice_id\s*,\s*'invoices')\s*\);",
        r"\1, 'success');",
        s,
        flags=re.IGNORECASE | re.DOTALL,
    )
    s = re.sub(
        r"(SELECT\s+public\.write_audit_log\(\s*'[^']+'\s*,\s*'[^']+'\s*,\s*[^,]+::text\s*,\s*jsonb_build_object\(.*?\))\s*\);",
        r"\1, 'success');",
        s,
        flags=re.IGNORECASE | re.DOTALL,
    )

    # Normalize obsolete inventory audit calls after all other rewrites.
    def normalize_inventory_audit(match: re.Match[str]) -> str:
        return (
            "SELECT public.write_audit_log("
            f"'{match.group(1)}', 'invoice', _invoice_id::text, "
            f"jsonb_build_object({match.group(2)}), 'success');"
        )

    s = re.sub(
        r"SELECT\s+public\.write_audit_log\(\s*'([^']+)'\s*,\s*json_build_object\((.*?)\)\s*,\s*_invoice_id\s*,\s*'invoices'\s*\);",
        normalize_inventory_audit,
        s,
        flags=re.IGNORECASE | re.DOTALL,
    )

    # Data API roles are represented by SQL roles created in the bootstrap.
    # Keep policy semantics intact; role creation/grants are emitted separately.
    return s.strip()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("batch-*.json"): old.unlink()
    for old in OUT.glob("migration-*.sql"): old.unlink()

    all_statements: list[dict[str, str]] = []
    staff_helper_added = False
    staff_helper_sql = """CREATE OR REPLACE FUNCTION public.hms_current_staff_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT id FROM public.staff
  WHERE auth_user_id = public.hms_current_user_id()
  LIMIT 1
$$;"""
    compatibility_sql = {
        "patients": "ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS registration_fee_paid boolean NOT NULL DEFAULT false;",
        "admissions": "ALTER TABLE public.admissions ADD COLUMN IF NOT EXISTS visit_id uuid;",
        "invoice_items": "ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS dispensing_status text NOT NULL DEFAULT 'pending';\nALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS dispensing_notes text;\nALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS dispensing_updated_at timestamptz;\nALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS dispensing_updated_by uuid;",
        "invoices": "ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS is_salary_deduction boolean NOT NULL DEFAULT false;\nALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS staff_sponsor_id uuid;",
        "inventory_locations": "CREATE TABLE IF NOT EXISTS public.inventory_locations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, name text NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());\nINSERT INTO public.inventory_locations (code, name) VALUES ('main_store', 'Main Store'), ('pharmacy', 'Pharmacy') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;",
    }
    compatibility_injected: set[str] = set()
    for path in sorted(MIGRATIONS.glob("*.sql")):
        for index, raw in enumerate(split_sql(path.read_text()), start=1):
            transformed = transform_statement(raw)
            if transformed:
                all_statements.append({"source": path.name, "index": str(index), "sql": transformed})
                table_key = None
                for candidate in ("patients", "admissions", "invoice_items", "invoices"):
                    if re.search(rf"CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+public\.{candidate}\b", transformed, flags=re.IGNORECASE):
                        table_key = candidate
                        break
                if re.search(r"CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+public\.inventory_products\b", transformed, flags=re.IGNORECASE):
                    table_key = "inventory_locations"
                if table_key and table_key not in compatibility_injected:
                    all_statements.append({"source": "cockroach_compatibility", "index": table_key, "sql": compatibility_sql[table_key]})
                    compatibility_injected.add(table_key)
                if (not staff_helper_added
                        and re.search(r"ALTER\s+TABLE\s+public\.staff\b", transformed, flags=re.IGNORECASE)
                        and re.search(r"ADD\s+COLUMN[\s\S]*\bauth_user_id\b", transformed, flags=re.IGNORECASE)):
                    all_statements.append({"source": "cockroach_compatibility", "index": "hms_current_staff_id", "sql": staff_helper_sql})
                    staff_helper_added = True

    batches: list[list[dict[str, str]]] = []
    current: list[dict[str, str]] = []
    current_bytes = 0
    for item in all_statements:
        item_bytes = len(item["sql"].encode())
        if current and (len(current) >= BATCH_SIZE or current_bytes + item_bytes > MAX_BATCH_BYTES):
            batches.append(current); current = []; current_bytes = 0
        current.append(item); current_bytes += item_bytes
    if current: batches.append(current)

    for index, batch in enumerate(batches, start=1):
        payload = {"batch": index, "sqlStatements": [x["sql"] for x in batch]}
        (OUT / f"batch-{index:03d}.json").write_text(json.dumps(payload, indent=2) + "\n")
        text = "\n\n".join(f"-- SOURCE: {x['source']} statement {x['index']}\n{x['sql']}" for x in batch)
        (OUT / f"migration-{index:03d}.sql").write_text(text + "\n")

    manifest = {
        "source_migrations": len(list(MIGRATIONS.glob("*.sql"))),
        "transformed_statements": len(all_statements),
        "batches": len(batches),
        "removed_constructs": ["Supabase Realtime", "Supabase Storage policies", "pg_cron", "pg_net", "REPLICA IDENTITY", "pg_trgm extension"],
        "auth_users_target": "public.auth_users",
        "auth_uid_target": "public.hms_current_user_id()",
        "user_roles_admin_policy_target": "public.hms_current_user_role() = 'admin'",
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
