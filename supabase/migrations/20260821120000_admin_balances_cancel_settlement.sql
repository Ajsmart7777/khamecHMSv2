-- Admin wallet reporting and safe cancellation of an uncompleted admitted-patient settlement.
-- CockroachDB-compatible: no correlated outer references or PostgreSQL-only arrays.

CREATE OR REPLACE FUNCTION public.admin_patient_balance_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _uid UUID := public.hms_current_user_id();
  _result JSONB;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT jsonb_build_object(
    'patient_count', COUNT(*)::INT,
    'patients_with_credit', COUNT(*) FILTER (WHERE COALESCE(balance, 0) > 0)::INT,
    'patients_with_debt', COUNT(*) FILTER (WHERE COALESCE(balance, 0) < 0)::INT,
    'total_balance', COALESCE(SUM(COALESCE(balance, 0)), 0),
    'total_wallet_credit', COALESCE(SUM(CASE WHEN COALESCE(balance, 0) > 0 THEN balance ELSE 0 END), 0),
    'total_wallet_debt', COALESCE(SUM(CASE WHEN COALESCE(balance, 0) < 0 THEN ABS(balance) ELSE 0 END), 0),
    'generated_at', now()
  )
  INTO _result
  FROM public.patients;

  RETURN _result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_daily_wallet_balance_summary(_day DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _uid UUID := public.hms_current_user_id();
  _result JSONB;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['admin','accountant']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Balance transactions are signed: topups are positive and deductions/debt
  -- are negative. Summing through the end of the selected day gives the
  -- wallet position at that day’s close, independent of the current balance.
  WITH closing AS (
    SELECT
      p.id,
      COALESCE(SUM(bt.amount), 0) AS closing_balance
    FROM public.patients p
    LEFT JOIN public.balance_transactions bt
      ON bt.patient_id = p.id
     AND bt.created_at < ((_day + 1)::DATE)::TIMESTAMPTZ
    GROUP BY p.id
  )
  SELECT jsonb_build_object(
    'date', _day,
    'patients_with_credit', COUNT(*) FILTER (WHERE closing_balance > 0)::INT,
    'patients_with_debt', COUNT(*) FILTER (WHERE closing_balance < 0)::INT,
    'total_balance', COALESCE(SUM(closing_balance), 0),
    'total_wallet_credit', COALESCE(SUM(CASE WHEN closing_balance > 0 THEN closing_balance ELSE 0 END), 0),
    'total_wallet_debt', COALESCE(SUM(CASE WHEN closing_balance < 0 THEN ABS(closing_balance) ELSE 0 END), 0),
    'generated_at', now()
  )
  INTO _result
  FROM closing;

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_patient_balance_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_patient_balance_summary() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_daily_wallet_balance_summary(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_daily_wallet_balance_summary(DATE) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_admission_discharge(
  _admission_id UUID,
  _reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _uid UUID := public.hms_current_user_id();
  _adm public.admissions;
  _journey_id UUID;
  _why TEXT := NULLIF(TRIM(COALESCE(_reason, '')), '');
BEGIN
  IF NOT public.has_any_role(
    _uid,
    ARRAY['cashier','receptionist','billing','accountant','admin']::app_role[]
  ) THEN
    RAISE EXCEPTION 'Only Cashier/Reception or an administrator can cancel a pending discharge settlement';
  END IF;

  SELECT *
    INTO _adm
    FROM public.admissions
   WHERE id = _admission_id
   FOR UPDATE;

  IF (_adm).id IS NULL THEN
    RAISE EXCEPTION 'Admission not found';
  END IF;

  IF (_adm).status = 'discharged' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: a completed settlement cannot be cancelled';
  END IF;

  IF (_adm).status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'NOT_IN_CASHIER_QUEUE: this admission is currently %', (_adm).status;
  END IF;

  -- The admission is still ready_for_discharge, so discharge_admission has
  -- not committed any invoice, wallet, visit, or bed mutation. Reversing only
  -- the queue marker is therefore safe and leaves the patient admitted.
  UPDATE public.admissions
     SET status = 'active',
         ready_for_discharge_at = NULL,
         ready_for_discharge_by = NULL,
         discharge_order_snap_id = NULL,
         updated_at = now()
   WHERE id = _admission_id;

  _journey_id := public.advance_journey(
    (_adm).patient_id,
    'admitted',
    'nurse',
    NULL,
    'ward',
    'ward',
    (_adm).visit_id,
    COALESCE(_why, 'Cashier settlement cancelled; patient returned to ward')
  );

  SELECT public.write_audit_log(
    'discharge_settlement_cancelled',
    'admission',
    _admission_id::TEXT,
    jsonb_build_object(
      'patient_id', (_adm).patient_id,
      'visit_id', (_adm).visit_id,
      'reason', _why,
      'returned_to_status', 'active',
      'journey_id', _journey_id
    )
  );

  RETURN jsonb_build_object(
    'admission_id', _admission_id,
    'patient_id', (_adm).patient_id,
    'status', 'active',
    'journey_id', _journey_id,
    'message', 'Settlement cancelled; patient remains admitted'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_admission_discharge(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_admission_discharge(UUID, TEXT) TO authenticated, service_role;
