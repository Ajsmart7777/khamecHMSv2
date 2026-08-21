-- Deceased admitted-patient workflow for the CockroachDB clone.
-- Death is represented by admission death metadata while status remains active;
-- this avoids changing the legacy admission status constraint. Final settlement
-- moves the admission through the existing ready_for_discharge path atomically.

ALTER TABLE public.admissions
  ADD COLUMN IF NOT EXISTS death_reported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS death_reported_by UUID,
  ADD COLUMN IF NOT EXISTS death_report_notes TEXT,
  ADD COLUMN IF NOT EXISTS death_finalized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS death_finalized_by UUID;

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS deceased_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deceased_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_admissions_death_reported
  ON public.admissions (death_reported_at)
  WHERE death_reported_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.report_admission_death(
  _admission_id UUID,
  _death_at TIMESTAMPTZ DEFAULT NULL::TIMESTAMPTZ,
  _notes TEXT DEFAULT NULL::TEXT
)
RETURNS JSONB
LANGUAGE PLPGSQL
SECURITY DEFINER
AS $$
DECLARE
  _uid UUID := public.hms_current_user_id();
  _adm public.admissions;
  _journey_id UUID;
  _when TIMESTAMPTZ := COALESCE(_death_at, now());
BEGIN
  IF NOT public.has_any_role(
    _uid,
    ARRAY['nurse','doctor1','doctor2','admin']::app_role[]
  ) THEN
    RAISE EXCEPTION 'Only Nurse, Doctor, or Admin can report a patient death';
  END IF;

  IF _when > now() THEN
    RAISE EXCEPTION 'Death time cannot be in the future';
  END IF;

  SELECT * INTO _adm
  FROM public.admissions
  WHERE id = _admission_id
  FOR UPDATE;

  IF _adm IS NULL THEN
    RAISE EXCEPTION 'Admission not found';
  END IF;
  IF (_adm).status = 'discharged' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission is already completed';
  END IF;
  IF (_adm).status = 'cancelled' THEN
    RAISE EXCEPTION 'ADMISSION_CANCELLED: this admission cannot receive a death report';
  END IF;
  IF (_adm).death_reported_at IS NOT NULL THEN
    RAISE EXCEPTION 'DEATH_ALREADY_REPORTED: this admission is already awaiting final settlement';
  END IF;

  UPDATE public.admissions
  SET death_reported_at = _when,
      death_reported_by = _uid,
      death_report_notes = NULLIF(btrim(COALESCE(_notes, '')), ''),
      updated_at = now()
  WHERE id = _admission_id;

  SELECT public.advance_journey(
    (_adm).patient_id,
    'admitted',
    'nurse',
    NULL,
    'ward',
    'ward',
    (_adm).visit_id,
    'Death reported; awaiting final Cashier settlement'
  ) INTO _journey_id;

  SELECT public.write_audit_log(
    'admission_death_reported',
    'admission',
    _admission_id::TEXT,
    jsonb_build_object(
      'patient_id', (_adm).patient_id,
      'visit_id', (_adm).visit_id,
      'death_at', _when,
      'reported_by', _uid,
      'notes', _notes,
      'journey_id', _journey_id
    ),
    'success'
  );

  RETURN jsonb_build_object(
    'admission_id', _admission_id,
    'patient_id', (_adm).patient_id,
    'status', (_adm).status,
    'death_reported_at', _when,
    'journey_id', _journey_id,
    'message', 'Death reported; patient remains in the ward until final settlement'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_admission_death(UUID, TIMESTAMPTZ, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_admission_death(UUID, TIMESTAMPTZ, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_deceased_admission(
  _admission_id UUID,
  _notes TEXT DEFAULT NULL::TEXT,
  _settlement_method TEXT DEFAULT NULL::TEXT,
  _settlement_amount NUMERIC DEFAULT 0,
  _settlement_notes TEXT DEFAULT NULL::TEXT,
  _refund_amount NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE PLPGSQL
SECURITY DEFINER
AS $$
DECLARE
  _uid UUID := public.hms_current_user_id();
  _adm public.admissions;
  _result JSONB;
  _journey_id UUID;
BEGIN
  IF NOT public.has_any_role(
    _uid,
    ARRAY['receptionist','cashier','billing','accountant','admin']::app_role[]
  ) THEN
    RAISE EXCEPTION 'Only Cashier/Reception, Billing, Accountant, or Admin can finalize a deceased admission';
  END IF;

  SELECT * INTO _adm
  FROM public.admissions
  WHERE id = _admission_id
  FOR UPDATE;

  IF _adm IS NULL THEN
    RAISE EXCEPTION 'Admission not found';
  END IF;
  IF (_adm).death_reported_at IS NULL THEN
    RAISE EXCEPTION 'NOT_DEATH_REPORTED: report the patient death from the ward first';
  END IF;
  IF (_adm).status = 'discharged' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission already has a final state';
  END IF;
  IF (_adm).status = 'cancelled' THEN
    RAISE EXCEPTION 'ADMISSION_CANCELLED: this admission cannot be finalized';
  END IF;

  -- Put the locked admission into the same queue state expected by the
  -- already-tested discharge routine. If that routine fails, this transaction
  -- rolls back and the bed/admission remain unchanged.
  UPDATE public.admissions
  SET status = 'ready_for_discharge',
      ready_for_discharge_at = now(),
      ready_for_discharge_by = _uid,
      discharge_notes = COALESCE(_notes, discharge_notes),
      updated_at = now()
  WHERE id = _admission_id
    AND status = 'active';

  IF NOT EXISTS (
    SELECT 1
    FROM public.admissions
    WHERE id = _admission_id
      AND status = 'ready_for_discharge'
      AND ready_for_discharge_by = _uid
  ) THEN
    RAISE EXCEPTION 'DEATH_SETTLEMENT_BUSY: this admission is being processed; refresh and try again';
  END IF;

  SELECT public.discharge_admission(
    _admission_id,
    COALESCE(_notes, 'Final settlement after patient death'),
    _settlement_method,
    _settlement_amount,
    _settlement_notes,
    _refund_amount
  ) INTO _result;

  UPDATE public.admissions
  SET death_finalized_at = now(),
      death_finalized_by = _uid,
      discharge_notes = COALESCE(_notes, discharge_notes),
      updated_at = now()
  WHERE id = _admission_id;

  UPDATE public.patients
  SET status = 'discharged',
      deceased_at = COALESCE(deceased_at, (_adm).death_reported_at),
      deceased_notes = COALESCE(deceased_notes, (_adm).death_report_notes),
      updated_at = now()
  WHERE id = (_adm).patient_id;

  SELECT id INTO _journey_id
  FROM public.patient_journey
  WHERE patient_id = (_adm).patient_id;

  SELECT public.write_audit_log(
    'admission_death_finalized',
    'admission',
    _admission_id::TEXT,
    jsonb_build_object(
      'patient_id', (_adm).patient_id,
      'visit_id', (_adm).visit_id,
      'death_reported_at', (_adm).death_reported_at,
      'finalized_by', _uid,
      'settlement', _result,
      'journey_id', _journey_id,
      'archive_ready_after_eligibility_check', true
    ),
    'success'
  );

  RETURN COALESCE(_result, '{}'::JSONB) || jsonb_build_object(
    'admission_id', _admission_id,
    'patient_id', (_adm).patient_id,
    'outcome', 'deceased',
    'death_finalized_at', now(),
    'message', 'Final death settlement completed; bed released and patient is archive-eligible'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_deceased_admission(UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_deceased_admission(UUID, TEXT, TEXT, NUMERIC, TEXT, NUMERIC) TO service_role;

-- Prevent the ordinary doctor discharge-order routine from bypassing the
-- deceased final-settlement queue. The client also hides that action, but this
-- guard is the authoritative server-side protection.
CREATE OR REPLACE FUNCTION public.mark_ready_for_discharge(
  _admission_id UUID,
  _snap_id UUID DEFAULT NULL::UUID,
  _note TEXT DEFAULT NULL::TEXT
)
RETURNS VOID
LANGUAGE PLPGSQL
SECURITY DEFINER
AS $$
DECLARE
  _uid UUID := public.hms_current_user_id();
  _adm public.admissions;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only doctors can create a discharge order';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF (_adm).death_reported_at IS NOT NULL THEN
    RAISE EXCEPTION 'DEATH_REPORTED: use the deceased final-settlement queue instead';
  END IF;
  IF (_adm).status <> 'active' THEN
    RAISE EXCEPTION 'Admission is not active (%)', (_adm).status;
  END IF;

  UPDATE public.admissions
  SET status = 'ready_for_discharge',
      ready_for_discharge_at = now(),
      ready_for_discharge_by = _uid,
      discharge_order_snap_id = _snap_id,
      discharge_notes = COALESCE(_note, discharge_notes),
      updated_at = now()
  WHERE id = _admission_id;

  SELECT public.write_audit_log(
    'discharge_order_signed', 'admission', _admission_id::TEXT,
    jsonb_build_object('patient_id', (_adm).patient_id, 'snap_id', _snap_id, 'note', _note),
    'success'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_ready_for_discharge(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_ready_for_discharge(UUID, UUID, TEXT) TO service_role;

-- Archive already keys off a discharged patient journey plus settled/closed
-- workflow checks. finalize_deceased_admission deliberately leaves the journey
-- as discharged and all outstanding invoices settled, so deceased patients
-- enter the existing Admin archive candidate flow automatically.

COMMENT ON COLUMN public.admissions.death_reported_at IS 'Clinical death report timestamp; non-null means final Cashier settlement is required.';
COMMENT ON COLUMN public.admissions.death_finalized_at IS 'Timestamp of completed deceased-patient final settlement.';
COMMENT ON COLUMN public.patients.deceased_at IS 'Non-null when the patient was reported deceased; patients.status remains discharged for legacy compatibility.';
