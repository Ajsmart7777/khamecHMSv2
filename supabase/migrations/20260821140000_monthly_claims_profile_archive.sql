-- Monthly insurance claims, Reception-only patient photos, and operational archive controls
-- CockroachDB clone migration. Active clinical data and the Patient Ledger Card are preserved.

ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS claim_archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_archived_by uuid;

ALTER TABLE public.eligibility_verifications
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid;

ALTER TABLE public.payroll_periods
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid;

ALTER TABLE public.sponsor_statements
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid;

CREATE INDEX IF NOT EXISTS idx_visits_claim_archived_at ON public.visits(claim_archived_at);
CREATE INDEX IF NOT EXISTS idx_eligibility_verifications_archived_at ON public.eligibility_verifications(archived_at);
CREATE INDEX IF NOT EXISTS idx_payroll_periods_archived_at ON public.payroll_periods(archived_at);
CREATE INDEX IF NOT EXISTS idx_sponsor_statements_archived_at ON public.sponsor_statements(archived_at);

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

CREATE INDEX IF NOT EXISTS idx_operational_archive_runs_module_date
  ON public.operational_archive_runs(module, cutoff_date);

-- Keep the legacy RPC safe if an old client attempts a per-visit settlement.
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

  SELECT public.write_audit_log(
    'claim_settled_legacy_blocked_path', 'visit', _visit_id::text,
    jsonb_build_object('notes', _notes, 'settled_by', _uid)
  );
END;
$$;

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

  SELECT public.write_audit_log(
    'claims_month_settled', 'claims_month',
    _sponsor_type || ':' || COALESCE(_provider_name, '*') || ':' || _year::text || '-' || _month::text,
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

-- Dedicated server-side photo mutation. Claims Manager and every other role are read-only.
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

  SELECT public.write_audit_log(
    CASE WHEN _photo_path IS NULL THEN 'patient_photo_removed' ELSE 'patient_photo_updated' END,
    'patient', _patient_id::text,
    jsonb_build_object('photo_path', _photo_path)
  );
  RETURN true;
END;
$$;

-- Archive preview. It never mutates data and excludes active or unresolved records.
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

-- Archive is a reversible-safe soft archive. It hides old completed operational rows
-- from active queues while preserving the complete ledger and master setup.
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

  SELECT public.write_audit_log(
    'operational_archive', 'archive_run', _run_id::text,
    jsonb_build_object('module', _module, 'before_date', _before_date, 'row_counts', _counts)
  );

  RETURN jsonb_build_object('run_id', _run_id, 'module', _module, 'counts', _counts, 'mutated', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_claims_month(text,text,integer,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_patient_photo_path(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_operational_archive(text,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_operational_data(text,date,text) TO authenticated;
