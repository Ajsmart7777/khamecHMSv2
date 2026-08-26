-- Fix the Cockroach compatibility identity used by SECURITY DEFINER workflows.
-- The previous live definition returned a bootstrap placeholder UUID, so
-- has_any_role() could not recognize the logged-in Reception user.

CREATE TABLE IF NOT EXISTS public.patient_fee_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  fee_type TEXT NOT NULL,
  period_start DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid',
  marked_paid_at TIMESTAMPTZ,
  marked_paid_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT patient_fee_status_type_ck CHECK (fee_type IN ('registration', 'consultation')),
  CONSTRAINT patient_fee_status_state_ck CHECK (status IN ('unpaid', 'paid')),
  CONSTRAINT patient_fee_status_unique UNIQUE (patient_id, fee_type, period_start)
);

CREATE INDEX IF NOT EXISTS patient_fee_status_lookup_idx
  ON public.patient_fee_status (patient_id, fee_type, period_start DESC);

INSERT INTO public.patient_fee_status (patient_id, fee_type, period_start, status, marked_paid_at)
SELECT p.id, 'registration', DATE '0001-01-01', 'paid', COALESCE(p.created_at, now())
FROM public.patients p
WHERE p.registration_fee_paid = true
  AND NOT EXISTS (
    SELECT 1 FROM public.patient_fee_status s
    WHERE s.patient_id = p.id
      AND s.fee_type = 'registration'
      AND s.period_start = DATE '0001-01-01'
  );

CREATE OR REPLACE FUNCTION public.hms_current_user_id()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
  SELECT NULLIF(current_setting('hms.user_id', true), '')::UUID
$$;

CREATE OR REPLACE FUNCTION public.mark_patient_fee_paid(
  _patient_id UUID,
  _fee_type TEXT,
  _period_start DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _uid UUID := public.hms_current_user_id();
  _marked_paid_at TIMESTAMPTZ;
BEGIN
  -- Reception owns fee acknowledgement. Cashier is retained here for legacy
  -- accounts because Cashier now operates under the Reception workspace.
  IF NOT public.has_any_role(_uid, ARRAY['receptionist', 'cashier']::public.app_role[]) THEN
    RAISE EXCEPTION 'Only Reception can mark patient fees as paid';
  END IF;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated user context is missing';
  END IF;
  IF _fee_type NOT IN ('registration', 'consultation') THEN
    RAISE EXCEPTION 'Invalid fee type';
  END IF;
  IF _fee_type = 'registration' AND _period_start <> DATE '0001-01-01' THEN
    RAISE EXCEPTION 'Registration fee must use lifetime period';
  END IF;
  IF _fee_type = 'consultation' AND _period_start <> date_trunc('month', _period_start)::date THEN
    RAISE EXCEPTION 'Consultation fee must use month start';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = _patient_id) THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;

  INSERT INTO public.patient_fee_status (
    patient_id, fee_type, period_start, status, marked_paid_at, marked_paid_by, updated_at
  ) VALUES (
    _patient_id, _fee_type, _period_start, 'paid', now(), _uid, now()
  )
  ON CONFLICT (patient_id, fee_type, period_start)
  DO UPDATE SET
    status = 'paid',
    marked_paid_at = COALESCE(public.patient_fee_status.marked_paid_at, now()),
    marked_paid_by = COALESCE(public.patient_fee_status.marked_paid_by, _uid),
    updated_at = now()
  RETURNING marked_paid_at INTO _marked_paid_at;

  IF _fee_type = 'registration' THEN
    UPDATE public.patients
    SET registration_fee_paid = true, updated_at = now()
    WHERE id = _patient_id;
  END IF;

  RETURN jsonb_build_object(
    'status', 'paid',
    'fee_type', _fee_type,
    'period_start', _period_start,
    'marked_paid_at', _marked_paid_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_patient_fee_paid(UUID, TEXT, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_patient_fee_paid(UUID, TEXT, DATE) TO authenticated;
