-- SOURCE: 20260821140000_monthly_claims_profile_archive.sql statement 1
ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS claim_archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_archived_by uuid;

-- SOURCE: 20260821140000_monthly_claims_profile_archive.sql statement 2
ALTER TABLE public.eligibility_verifications
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid;

-- SOURCE: 20260821140000_monthly_claims_profile_archive.sql statement 3
ALTER TABLE public.payroll_periods
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid;

-- SOURCE: 20260821140000_monthly_claims_profile_archive.sql statement 4
ALTER TABLE public.sponsor_statements
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid;

-- SOURCE: 20260821140000_monthly_claims_profile_archive.sql statement 5
CREATE INDEX IF NOT EXISTS idx_visits_claim_archived_at ON public.visits(claim_archived_at);

-- SOURCE: 20260821140000_monthly_claims_profile_archive.sql statement 6
CREATE INDEX IF NOT EXISTS idx_eligibility_verifications_archived_at ON public.eligibility_verifications(archived_at);

-- SOURCE: 20260821140000_monthly_claims_profile_archive.sql statement 7
CREATE INDEX IF NOT EXISTS idx_payroll_periods_archived_at ON public.payroll_periods(archived_at);

-- SOURCE: 20260821140000_monthly_claims_profile_archive.sql statement 8
CREATE INDEX IF NOT EXISTS idx_sponsor_statements_archived_at ON public.sponsor_statements(archived_at);

-- SOURCE: 20260821140000_monthly_claims_profile_archive.sql statement 9
CREATE TABLE IF NOT EXISTS public.operational_archive_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL,
  cutoff_date date NOT NULL,
  mode text NOT NULL CHECK (mode IN ('archive','clear')),
  row_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmation text
);

-- SOURCE: 20260821140000_monthly_claims_profile_archive.sql statement 10
CREATE INDEX IF NOT EXISTS idx_operational_archive_runs_module_date
  ON public.operational_archive_runs(module, cutoff_date);

-- SOURCE: 20260821140000_monthly_claims_profile_archive.sql statement 11
CREATE OR REPLACE FUNCTION public.mark_claim_settled(_visit_id uuid, _notes text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _uid uuid;
  _current text;
BEGIN
  _uid := public.hms_current_user_id();
  IF NOT public.has_role(_uid, 'claims_manager'::app_role) THEN
    RAISE EXCEPTION 'Only Claims Manager can settle insurance claims';
  END IF;
  RAISE EXCEPTION 'Per-visit claim settlement is disabled; use monthly settlement';

  SELECT claim_status INTO _current
  FROM public.visits
  WHERE id = _visit_id
  FOR UPDATE;

  IF _current IS NULL THEN
    RAISE EXCEPTION 'Visit not found';
  END IF;
  IF _current <> 'pending' THEN
    RAISE EXCEPTION 'Claim is not pending';
  END IF;

  UPDATE public.visits
     SET claim_status = 'settled',
         claim_settled_at = now(),
         claim_settled_by = _uid,
         claim_notes = COALESCE(_notes, claim_notes),
         updated_at = now()
   WHERE id = _visit_id;

  SELECT public.write_audit_log('claim_settled_legacy_blocked_path', 'visit', _visit_id::text, jsonb_build_object('notes', _notes, 'settled_by', _uid)
  , 'success');
END;
$$;

-- SOURCE: 20260821140000_monthly_claims_profile_archive.sql statement 12
CREATE OR REPLACE FUNCTION public.settle_claims_month(
  _sponsor_type text,
  _provider_name text,
  _year integer,
  _month integer,
  _notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _uid uuid;
  _start timestamptz;
  _finish timestamptz;
  _total_count integer;
  _pending_count integer;
  _settled_count integer := 0;
  _settled_amount numeric := 0;
  _id uuid;
  _amount numeric;
BEGIN
  _uid := public.hms_current_user_id();
  IF NOT public.has_role(_uid, 'claims_manager'::app_role) THEN
    RAISE EXCEPTION 'Only Claims Manager can settle a monthly insurance claim batch';
  END IF;
  IF _sponsor_type NOT IN ('nhis','hmo','katchma') THEN
    RAISE EXCEPTION 'Unsupported insurance sponsor type';
  END IF;
  IF _month < 1 OR _month > 12 THEN
    RAISE EXCEPTION 'Month must be between 1 and 12';
  END IF;

  _start := make_date(_year, _month, 1)::timestamptz;
  _finish := _start + interval '1 month';

  SELECT count(*) INTO _total_count
  FROM public.visits v
  JOIN public.patients p ON p.id = v.patient_id
  WHERE v.claim_archived_at IS NULL
    AND v.claim_status IN ('pending','submitted')
    AND v.opened_at >= _start AND v.opened_at < _finish
    AND v.sponsor_type = _sponsor_type
    AND (_provider_name IS NULL OR COALESCE(p.insurance_provider, '') = _provider_name);

  IF _total_count = 0 THEN
    RAISE EXCEPTION 'No pending claims found for this provider and month';
  END IF;

  SELECT count(*) INTO _pending_count
  FROM public.visits v
  JOIN public.patients p ON p.id = v.patient_id
  WHERE v.claim_archived_at IS NULL
    AND v.claim_status NOT IN ('settled','rejected','not_applicable')
    AND v.opened_at >= _start AND v.opened_at < _finish
    AND v.sponsor_type = _sponsor_type
    AND (_provider_name IS NULL OR COALESCE(p.insurance_provider, '') = _provider_name);

  IF _pending_count <> _total_count THEN
    RAISE EXCEPTION 'Monthly batch contains unresolved claims; review the claim cards before settling';
  END IF;

  WHILE true LOOP
    _id := NULL;
    _amount := NULL;
    SELECT v.id, COALESCE(v.total_charged, 0)
      INTO _id, _amount
    FROM public.visits v
    JOIN public.patients p ON p.id = v.patient_id
    WHERE v.claim_archived_at IS NULL
      AND v.claim_status IN ('pending','submitted')
      AND v.opened_at >= _start AND v.opened_at < _finish
      AND v.sponsor_type = _sponsor_type
      AND (_provider_name IS NULL OR COALESCE(p.insurance_provider, '') = _provider_name)
    ORDER BY v.opened_at, v.id
    LIMIT 1;
    IF _id IS NULL THEN
      EXIT;
    END IF;
    UPDATE public.visits
       SET claim_status = 'settled',
           claim_settled_at = now(),
           claim_settled_by = _uid,
           claim_notes = COALESCE(_notes, claim_notes),
           updated_at = now()
     WHERE id = _id;
    _settled_count := _settled_count + 1;
    _settled_amount := _settled_amount + COALESCE(_amount, 0);
  END LOOP;

  SELECT public.write_audit_log('claims_month_settled', 'claims_month', _sponsor_type || ':' || COALESCE(_provider_name, '*', 'success') || ':' || _year::text || '-' || _month::text,
    jsonb_build_object(
      'sponsor_type', _sponsor_type,
      'provider_name', _provider_name,
      'year', _year,
      'month', _month,
      'settled_count', _settled_count,
      'settled_amount', _settled_amount,
      'notes', _notes
    )
  );

  RETURN jsonb_build_object(
    'settled_count', _settled_count,
    'settled_amount', _settled_amount,
    'sponsor_type', _sponsor_type,
    'provider_name', _provider_name,
    'year', _year,
    'month', _month
  );
END;
$$;

-- SOURCE: 20260821140000_monthly_claims_profile_archive.sql statement 13
CREATE OR REPLACE FUNCTION public.set_patient_photo_path(_patient_id uuid, _photo_path text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _uid uuid;
  _changed integer := 0;
BEGIN
  _uid := public.hms_current_user_id();
  IF NOT public.has_role(_uid, 'receptionist'::app_role) THEN
    RAISE EXCEPTION 'Only Reception can change patient profile photos';
  END IF;
  IF _photo_path IS NOT NULL AND length(trim(_photo_path)) = 0 THEN
    RAISE EXCEPTION 'Photo path cannot be empty';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = _patient_id) THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;

  UPDATE public.patients
     SET photo_path = _photo_path,
         updated_at = now()
   WHERE id = _patient_id;

  SELECT public.write_audit_log(CASE WHEN _photo_path IS NULL THEN 'patient_photo_removed' ELSE 'patient_photo_updated' END, 'patient', _patient_id::text, jsonb_build_object('photo_path', _photo_path)
  , 'success');
  RETURN true;
END;
$$;

-- SOURCE: 20260821140000_monthly_claims_profile_archive.sql statement 14
CREATE OR REPLACE FUNCTION public.preview_operational_archive(_module text, _before_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _uid uuid;
  _counts jsonb := '{}'::jsonb;
  _payroll integer := 0;
  _sponsor integer := 0;
  _claims integer := 0;
  _eligibility integer := 0;
BEGIN
  _uid := public.hms_current_user_id();
  IF NOT public.has_role(_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only Admin can preview operational archives';
  END IF;
  IF _before_date IS NULL OR _before_date >= current_date THEN
    RAISE EXCEPTION 'Archive cutoff must be before today';
  END IF;

  IF _module = 'all_closed' THEN
    SELECT count(*) INTO _payroll
    FROM public.payroll_periods
    WHERE archived_at IS NULL
      AND status NOT IN ('draft','processing')
      AND make_date(year, month, 1) < _before_date;
    SELECT count(*) INTO _sponsor
    FROM public.sponsor_statements
    WHERE archived_at IS NULL
      AND status IN ('paid','void')
      AND period_end < _before_date;
    SELECT count(*) INTO _claims
    FROM public.visits
    WHERE claim_archived_at IS NULL
      AND claim_status IN ('settled','rejected')
      AND opened_at::date < _before_date;
    SELECT count(*) INTO _eligibility
    FROM public.eligibility_verifications
    WHERE archived_at IS NULL
      AND status IN ('approved','rejected','expired')
      AND updated_at::date < _before_date;
    _counts := jsonb_build_object('payroll_periods', _payroll, 'sponsor_statements', _sponsor, 'visits', _claims, 'eligibility_verifications', _eligibility);
  ELSIF _module = 'payroll' THEN
    SELECT jsonb_build_object('payroll_periods', count(*)) INTO _counts
    FROM public.payroll_periods
    WHERE archived_at IS NULL
      AND status NOT IN ('draft','processing')
      AND make_date(year, month, 1) < _before_date;
  ELSIF _module = 'corporate_retainer' THEN
    SELECT jsonb_build_object('sponsor_statements', count(*)) INTO _counts
    FROM public.sponsor_statements
    WHERE archived_at IS NULL
      AND status IN ('paid','void')
      AND period_end < _before_date;
  ELSIF _module = 'insurance_claims' THEN
    SELECT jsonb_build_object('visits', count(*)) INTO _counts
    FROM public.visits
    WHERE claim_archived_at IS NULL
      AND claim_status IN ('settled','rejected')
      AND opened_at::date < _before_date;
  ELSIF _module = 'insurance_verification' THEN
    SELECT jsonb_build_object('eligibility_verifications', count(*)) INTO _counts
    FROM public.eligibility_verifications
    WHERE archived_at IS NULL
      AND status IN ('approved','rejected','expired')
      AND updated_at::date < _before_date;
  ELSE
    RAISE EXCEPTION 'Unsupported archive module';
  END IF;

  RETURN jsonb_build_object('module', _module, 'before_date', _before_date, 'counts', _counts, 'mutated', false);
END;
$$;

-- SOURCE: 20260821140000_monthly_claims_profile_archive.sql statement 15
CREATE OR REPLACE FUNCTION public.archive_operational_data(_module text, _before_date date, _confirmation text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _uid uuid;
  _counts jsonb := '{}'::jsonb;
  _run_id uuid;
  _n integer := 0;
  _payroll integer := 0;
  _sponsor integer := 0;
  _claims integer := 0;
  _eligibility integer := 0;
BEGIN
  _uid := public.hms_current_user_id();
  IF NOT public.has_role(_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only Admin can archive operational records';
  END IF;
  IF _before_date IS NULL OR _before_date >= current_date THEN
    RAISE EXCEPTION 'Archive cutoff must be before today';
  END IF;
  IF _confirmation <> 'ARCHIVE ' || upper(_module) || ' ' || _before_date::text THEN
    RAISE EXCEPTION 'Confirmation text does not match the selected archive scope';
  END IF;

  IF _module = 'all_closed' THEN
    SELECT count(*) INTO _payroll
    FROM public.payroll_periods
    WHERE archived_at IS NULL
      AND status NOT IN ('draft','processing')
      AND make_date(year, month, 1) < _before_date;
    UPDATE public.payroll_periods
       SET archived_at = now(), archived_by = _uid
     WHERE archived_at IS NULL
       AND status NOT IN ('draft','processing')
       AND make_date(year, month, 1) < _before_date;

    SELECT count(*) INTO _sponsor
    FROM public.sponsor_statements
    WHERE archived_at IS NULL
      AND status IN ('paid','void')
      AND period_end < _before_date;
    UPDATE public.sponsor_statements
       SET archived_at = now(), archived_by = _uid
     WHERE archived_at IS NULL
       AND status IN ('paid','void')
       AND period_end < _before_date;

    SELECT count(*) INTO _claims
    FROM public.visits
    WHERE claim_archived_at IS NULL
      AND claim_status IN ('settled','rejected')
      AND opened_at::date < _before_date;
    UPDATE public.visits
       SET claim_archived_at = now(), claim_archived_by = _uid
     WHERE claim_archived_at IS NULL
       AND claim_status IN ('settled','rejected')
       AND opened_at::date < _before_date;

    SELECT count(*) INTO _eligibility
    FROM public.eligibility_verifications
    WHERE archived_at IS NULL
      AND status IN ('approved','rejected','expired')
      AND updated_at::date < _before_date;
    UPDATE public.eligibility_verifications
       SET archived_at = now(), archived_by = _uid
     WHERE archived_at IS NULL
       AND status IN ('approved','rejected','expired')
       AND updated_at::date < _before_date;
    _counts := jsonb_build_object('payroll_periods', _payroll, 'sponsor_statements', _sponsor, 'visits', _claims, 'eligibility_verifications', _eligibility);
  ELSIF _module = 'payroll' THEN
    SELECT count(*) INTO _n
    FROM public.payroll_periods
    WHERE archived_at IS NULL
      AND status NOT IN ('draft','processing')
      AND make_date(year, month, 1) < _before_date;
    UPDATE public.payroll_periods
       SET archived_at = now(), archived_by = _uid
     WHERE archived_at IS NULL
       AND status NOT IN ('draft','processing')
       AND make_date(year, month, 1) < _before_date;
    _counts := jsonb_build_object('payroll_periods', _n);
  ELSIF _module = 'corporate_retainer' THEN
    SELECT count(*) INTO _n
    FROM public.sponsor_statements
    WHERE archived_at IS NULL
      AND status IN ('paid','void')
      AND period_end < _before_date;
    UPDATE public.sponsor_statements
       SET archived_at = now(), archived_by = _uid
     WHERE archived_at IS NULL
       AND status IN ('paid','void')
       AND period_end < _before_date;
    _counts := jsonb_build_object('sponsor_statements', _n);
  ELSIF _module = 'insurance_claims' THEN
    SELECT count(*) INTO _n
    FROM public.visits
    WHERE claim_archived_at IS NULL
      AND claim_status IN ('settled','rejected')
      AND opened_at::date < _before_date;
    UPDATE public.visits
       SET claim_archived_at = now(), claim_archived_by = _uid
     WHERE claim_archived_at IS NULL
       AND claim_status IN ('settled','rejected')
       AND opened_at::date < _before_date;
    _counts := jsonb_build_object('visits', _n);
  ELSIF _module = 'insurance_verification' THEN
    SELECT count(*) INTO _n
    FROM public.eligibility_verifications
    WHERE archived_at IS NULL
      AND status IN ('approved','rejected','expired')
      AND updated_at::date < _before_date;
    UPDATE public.eligibility_verifications
       SET archived_at = now(), archived_by = _uid
     WHERE archived_at IS NULL
       AND status IN ('approved','rejected','expired')
       AND updated_at::date < _before_date;
    _counts := jsonb_build_object('eligibility_verifications', _n);
  ELSE
    RAISE EXCEPTION 'Unsupported archive module';
  END IF;

  INSERT INTO public.operational_archive_runs(id, module, cutoff_date, mode, row_counts, created_by, confirmation)
  VALUES (gen_random_uuid(), _module, _before_date, 'archive', _counts, _uid, _confirmation)
  RETURNING id INTO _run_id;

  SELECT public.write_audit_log('operational_archive', 'archive_run', _run_id::text, jsonb_build_object('module', _module, 'before_date', _before_date, 'row_counts', _counts)
  , 'success');

  RETURN jsonb_build_object('run_id', _run_id, 'module', _module, 'counts', _counts, 'mutated', true);
END;
$$;

-- SOURCE: 20260821140000_monthly_claims_profile_archive.sql statement 16
GRANT EXECUTE ON FUNCTION public.settle_claims_month(text,text,integer,integer,text) TO authenticated;

-- SOURCE: 20260821140000_monthly_claims_profile_archive.sql statement 17
GRANT EXECUTE ON FUNCTION public.set_patient_photo_path(uuid,text) TO authenticated;

-- SOURCE: 20260821140000_monthly_claims_profile_archive.sql statement 18
GRANT EXECUTE ON FUNCTION public.preview_operational_archive(text,date) TO authenticated;

-- SOURCE: 20260821140000_monthly_claims_profile_archive.sql statement 19
GRANT EXECUTE ON FUNCTION public.archive_operational_data(text,date,text) TO authenticated;

-- SOURCE: 20260821150000_fix_stale_prescription_archive_blocker.sql statement 1
UPDATE public.prescriptions pr
SET status = 'dispensed',
    updated_at = now()
WHERE pr.status::text = 'pending'
  AND pr.visit_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.patients p
    WHERE p.id = pr.patient_id
      AND p.status::text = 'discharged'
  )
  AND EXISTS (
    SELECT 1
    FROM public.patient_journey pj
    WHERE pj.patient_id = pr.patient_id
      AND pj.current_state::text = 'discharged'
  )
  AND (
    SELECT count(*)
    FROM public.prescriptions pr_all
    WHERE pr_all.patient_id = pr.patient_id
      AND pr_all.visit_id = pr.visit_id
  ) <= (
    SELECT count(*)
    FROM public.snap_orders so
    WHERE so.patient_id = pr.patient_id
      AND so.visit_id = pr.visit_id
      AND so.order_type::text = 'prescription'
      AND so.status::text = 'fulfilled'
  )
  AND EXISTS (
    SELECT 1
    FROM public.snap_orders so
    WHERE so.patient_id = pr.patient_id
      AND so.visit_id = pr.visit_id
      AND so.order_type::text = 'prescription'
      AND so.status::text = 'fulfilled'
  );

-- SOURCE: 20260821150000_fix_stale_prescription_archive_blocker.sql statement 2
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
      CASE WHEN d.actual_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.prescriptions pr
        WHERE pr.patient_id = d.actual_id
          AND pr.status::text = 'pending'
          AND (
            SELECT count(*)
            FROM public.prescriptions pr_all
            WHERE pr_all.patient_id = pr.patient_id
              AND pr_all.visit_id = pr.visit_id
          ) > (
            SELECT count(*)
            FROM public.snap_orders so
            WHERE so.patient_id = pr.patient_id
              AND so.visit_id = pr.visit_id
              AND so.order_type::text = 'prescription'
              AND so.status::text = 'fulfilled'
          )
      ) THEN 'A pharmacy prescription is pending' END,
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
$$;
