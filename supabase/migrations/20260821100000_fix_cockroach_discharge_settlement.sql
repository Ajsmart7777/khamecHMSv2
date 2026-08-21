-- CockroachDB discharge-settlement compatibility repair.
-- Replaces correlated relational expressions with procedural, row-by-row
-- allocation while preserving invoice, wallet, discharge, journey, and audit semantics.

CREATE OR REPLACE FUNCTION public.patient_outstanding(_patient_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  _p public.patients;
  _pct numeric;
  _invoice_due numeric := 0;
BEGIN
  SELECT * INTO _p
  FROM public.patients
  WHERE id = _patient_id;

  IF _p IS NULL THEN
    RETURN 0;
  END IF;

  _pct := public.copay_percent((_p).account_type, (_p).insurance_plan);

  SELECT COALESCE(SUM(
    GREATEST(
      0,
      ROUND(i.total_amount * _pct / 100.0, 2) - COALESCE(i.paid_amount, 0)
    )
  ), 0)
  INTO _invoice_due
  FROM public.invoices i
  WHERE i.patient_id = _patient_id
    AND i.status IN ('pending', 'partial');

  RETURN ROUND(
    GREATEST(0, -COALESCE((_p).balance, 0)) + COALESCE(_invoice_due, 0),
    2
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_wallet_to_outstanding(
  _patient_id uuid,
  _note text DEFAULT NULL::text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _p public.patients;
  _pct numeric;
  _credit numeric;
  _applied_total numeric := 0;
  _inv_id uuid;
  _inv_total numeric;
  _inv_paid numeric;
  _share numeric;
  _apply numeric;
BEGIN
  SELECT * INTO _p
  FROM public.patients
  WHERE id = _patient_id
  FOR UPDATE;

  IF _p IS NULL OR NOT public.has_wallet((_p).account_type) THEN
    RETURN 0;
  END IF;

  _credit := ROUND(GREATEST(COALESCE((_p).balance, 0), 0), 2);
  IF _credit <= 0 THEN
    RETURN 0;
  END IF;

  _pct := public.copay_percent((_p).account_type, (_p).insurance_plan);

  WHILE _credit > 0 LOOP
    _inv_id := NULL;
    _inv_total := NULL;
    _inv_paid := NULL;

    SELECT i.id, i.total_amount, COALESCE(i.paid_amount, 0)
    INTO _inv_id, _inv_total, _inv_paid
    FROM public.invoices i
    WHERE i.patient_id = _patient_id
      AND i.status IN ('pending', 'partial')
      AND ROUND(COALESCE(i.total_amount, 0) * _pct / 100.0, 2) > COALESCE(i.paid_amount, 0)
    ORDER BY i.created_at ASC, i.id ASC
    LIMIT 1;

    IF _inv_id IS NULL THEN
      _credit := 0;
    ELSE
      _share := ROUND(COALESCE(_inv_total, 0) * _pct / 100.0, 2);
      _apply := ROUND(LEAST(_credit, GREATEST(0, _share - COALESCE(_inv_paid, 0))), 2);
      IF _apply > 0 THEN
        UPDATE public.invoices
        SET paid_amount = COALESCE(_inv_paid, 0) + _apply,
            status = CASE
              WHEN COALESCE(_inv_paid, 0) + _apply >= _share THEN 'paid'
              ELSE 'partial'
            END,
            paid_at = CASE
              WHEN COALESCE(_inv_paid, 0) + _apply >= _share THEN now()
              ELSE paid_at
            END,
            payment_method = COALESCE(payment_method, 'wallet'),
            updated_at = now()
        WHERE id = _inv_id;

        SELECT public.adjust_patient_balance(
          _patient_id,
          -_apply,
          'invoice_deduction',
          'wallet',
          NULL,
          _inv_id,
          _note
        );

        _credit := ROUND(_credit - _apply, 2);
        _applied_total := ROUND(_applied_total + _apply, 2);
      ELSE
        _credit := 0;
      END IF;
    END IF;
  END LOOP;

  RETURN _applied_total;
END;
$$;

CREATE OR REPLACE FUNCTION public.admission_discharge_preview(_admission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _adm public.admissions;
  _p public.patients;
  _nights int;
  _rate numeric;
  _bed_total numeric;
  _pct numeric;
  _share numeric;
  _covered numeric;
  _bal numeric;
  _prior numeric;
  _already boolean;
  _gross numeric;
  _credit numeric;
  _applied numeric;
  _due numeric;
  _wallet boolean;
BEGIN
  IF NOT public.has_any_role(
    public.hms_current_user_id(),
    ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','cashier','receptionist','admin']::app_role[]
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _adm
  FROM public.admissions
  WHERE id = _admission_id;
  IF _adm IS NULL THEN
    RAISE EXCEPTION 'Admission not found';
  END IF;

  SELECT * INTO _p
  FROM public.patients
  WHERE id = (_adm).patient_id;
  IF _p IS NULL THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;

  -- Direct set-returning function syntax is supported by CockroachDB;
  -- ROWS FROM(...) produced the preview failure in the generated routine.
  SELECT days, daily_rate, amount
  INTO _nights, _rate, _bed_total
  FROM public.admission_bed_charge(_admission_id);

  _pct := public.copay_percent((_p).account_type, (_p).insurance_plan);
  _share := ROUND(COALESCE(_bed_total, 0) * _pct / 100.0, 2);
  _covered := ROUND(GREATEST(0, COALESCE(_bed_total, 0) - _share), 2);

  SELECT EXISTS (
    SELECT 1
    FROM public.invoices i
    WHERE i.patient_id = (_adm).patient_id
      AND i.notes = 'BED_DAYS:' || _admission_id::text
  ) INTO _already;

  IF _already THEN
    _share := 0;
    _covered := 0;
  END IF;

  _wallet := public.has_wallet((_p).account_type);
  _bal := COALESCE((_p).balance, 0);
  _prior := public.patient_outstanding((_adm).patient_id);
  _gross := ROUND(_prior + _share, 2);
  _credit := CASE WHEN _wallet THEN ROUND(GREATEST(_bal, 0), 2) ELSE 0 END;
  _applied := ROUND(LEAST(_credit, _gross), 2);
  _due := ROUND(GREATEST(0, _gross - _applied), 2);

  RETURN jsonb_build_object(
    'admission_id', _admission_id,
    'patient_id', (_adm).patient_id,
    'admitted_at', COALESCE((_adm).admitted_at, (_adm).created_at),
    'account_type', (_p).account_type,
    'insurance_plan', (_p).insurance_plan,
    'has_wallet', _wallet,
    'nights', COALESCE(_nights, 0),
    'daily_rate', COALESCE(_rate, 0),
    'bed_total', COALESCE(_bed_total, 0),
    'bed_already_billed', _already,
    'copay_pct', _pct,
    'sponsor_covered', _covered,
    'bed_patient_share', _share,
    'current_balance', _bal,
    'prior_outstanding', _prior,
    'gross_total', _gross,
    'wallet_credit', _credit,
    'wallet_applied', _applied,
    'total_due', _due,
    'balance_after_bed', ROUND(_bal - _applied, 2)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.discharge_admission(
  _admission_id uuid,
  _notes text DEFAULT NULL::text,
  _settlement_method text DEFAULT NULL::text,
  _settlement_amount numeric DEFAULT 0,
  _settlement_notes text DEFAULT NULL::text,
  _refund_amount numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _adm public.admissions;
  _p public.patients;
  _wallet boolean;
  _debt numeric;
  _collected numeric := 0;
  _remaining numeric := 0;
  _left numeric := 0;
  _applied numeric := 0;
  _pct numeric;
  _wallet_used numeric := 0;
  _refund numeric := 0;
  _credit numeric := 0;
  _debt_cleared numeric := 0;
  _journey public.patient_journey;
  _journey_id uuid;
  _inv_id uuid;
  _inv_total numeric;
  _inv_paid numeric;
  _share numeric;
  _due numeric;
  _apply numeric;
BEGIN
  IF NOT public.has_any_role(
    public.hms_current_user_id(),
    ARRAY['cashier','billing','accountant','receptionist','admin']::app_role[]
  ) THEN
    RAISE EXCEPTION 'Only the cashier or reception can settle and complete a discharge';
  END IF;

  SELECT * INTO _adm
  FROM public.admissions
  WHERE id = _admission_id
  FOR UPDATE;

  IF _adm IS NULL THEN
    RAISE EXCEPTION 'Admission not found';
  END IF;
  IF (_adm).status = 'discharged' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was already settled and discharged on %',
      COALESCE(to_char((_adm).discharged_at, 'DD Mon YYYY HH24:MI'), 'an earlier date');
  END IF;
  IF (_adm).status = 'cancelled' THEN
    RAISE EXCEPTION 'ADMISSION_CANCELLED: this admission was cancelled and cannot be settled';
  END IF;
  IF (_adm).status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'NOT_IN_CASHIER_QUEUE: the ward has not confirmed this discharge yet (%)', (_adm).status;
  END IF;

  SELECT public.bill_admission_bed_days(_admission_id);
  _wallet_used := public.apply_wallet_to_outstanding(
    (_adm).patient_id,
    'Balance applied at discharge'
  );

  SELECT * INTO _p
  FROM public.patients
  WHERE id = (_adm).patient_id
  FOR UPDATE;

  _wallet := public.has_wallet((_p).account_type);
  _pct := public.copay_percent((_p).account_type, (_p).insurance_plan);
  _debt := public.patient_outstanding((_adm).patient_id);
  _remaining := _debt;

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash', 'pos', 'transfer') THEN
      _collected := ROUND(GREATEST(COALESCE(_settlement_amount, 0), 0), 2);
      IF _collected <= 0 THEN
        RAISE EXCEPTION 'Settlement amount must be greater than zero';
      END IF;
      IF _wallet AND (_p).balance < 0 THEN
        _debt_cleared := ROUND(LEAST(_collected, -(_p).balance), 2);
        SELECT public.adjust_patient_balance(
          (_adm).patient_id,
          _debt_cleared,
          'debt_cleared',
          _settlement_method,
          NULL,
          NULL,
          COALESCE(_settlement_notes, '')
        );
      END IF;
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
    ELSIF _settlement_method = 'salary' THEN
      IF (_p).staff_link_id IS NULL THEN
        RAISE EXCEPTION 'STAFF_LINK_REQUIRED: this patient is not linked to any staff member for salary deduction';
      END IF;
      _remaining := 0;
    ELSIF _settlement_method = 'carry' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  _left := CASE
    WHEN _settlement_method IN ('cash', 'pos', 'transfer')
      THEN ROUND(GREATEST(0, _collected - _debt_cleared), 2)
    WHEN _settlement_method = 'salary' THEN _debt
    ELSE 0
  END;

  -- Allocate cash/salary settlement to the oldest unpaid patient shares.
  -- This loop is intentionally procedural: CockroachDB rejects the former
  -- correlated window/CTE expression with "top-level relational expression
  -- cannot have outer columns".
  IF _left > 0 THEN
    WHILE _left > 0 LOOP
      _inv_id := NULL;
      _inv_total := NULL;
      _inv_paid := NULL;

      SELECT i.id, i.total_amount, COALESCE(i.paid_amount, 0)
      INTO _inv_id, _inv_total, _inv_paid
      FROM public.invoices i
      WHERE i.patient_id = (_adm).patient_id
        AND i.status IN ('pending', 'partial')
        AND ROUND(COALESCE(i.total_amount, 0) * _pct / 100.0, 2) > COALESCE(i.paid_amount, 0)
      ORDER BY i.created_at ASC, i.id ASC
      LIMIT 1;

      IF _inv_id IS NULL THEN
        _left := 0;
      ELSE
        _share := ROUND(COALESCE(_inv_total, 0) * _pct / 100.0, 2);
        _due := GREATEST(_share - COALESCE(_inv_paid, 0), 0);
        _apply := ROUND(LEAST(_left, _due), 2);
        IF _apply > 0 THEN
          UPDATE public.invoices
          SET paid_amount = COALESCE(_inv_paid, 0) + _apply,
              status = CASE
                WHEN COALESCE(_inv_paid, 0) + _apply >= _share THEN 'paid'
                ELSE 'partial'
              END,
              paid_at = CASE
                WHEN COALESCE(_inv_paid, 0) + _apply >= _share THEN now()
                ELSE paid_at
              END,
              payment_method = COALESCE(payment_method, _settlement_method),
              is_salary_deduction = CASE
                WHEN _settlement_method = 'salary' THEN true
                ELSE is_salary_deduction
              END,
              staff_sponsor_id = CASE
                WHEN _settlement_method = 'salary' THEN (_p).staff_link_id
                ELSE staff_sponsor_id
              END,
              updated_at = now()
          WHERE id = _inv_id;

          _left := ROUND(_left - _apply, 2);
          _applied := ROUND(_applied + _apply, 2);
        ELSE
          _left := 0;
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF _wallet AND _left > 0 AND _settlement_method IN ('cash', 'pos', 'transfer') THEN
    SELECT public.adjust_patient_balance(
      (_adm).patient_id,
      _left,
      'topup',
      _settlement_method,
      NULL,
      NULL,
      'Change from discharge settlement left on balance'
    );
    _credit := _left;
  END IF;

  _refund := ROUND(GREATEST(COALESCE(_refund_amount, 0), 0), 2);
  IF _refund > 0 THEN
    IF NOT _wallet THEN
      RAISE EXCEPTION 'Sponsored accounts have no wallet to refund from';
    END IF;
    SELECT * INTO _p
    FROM public.patients
    WHERE id = (_adm).patient_id
    FOR UPDATE;
    IF _refund > (_p).balance THEN
      RAISE EXCEPTION 'Refund % exceeds available balance %', _refund, (_p).balance;
    END IF;
    SELECT public.adjust_patient_balance(
      (_adm).patient_id,
      -_refund,
      'refund',
      _settlement_method,
      NULL,
      NULL,
      'Change paid out at discharge'
    );
  END IF;

  UPDATE public.admissions
  SET status = 'discharged',
      discharged_at = now(),
      discharged_by = public.hms_current_user_id(),
      discharge_notes = COALESCE(_notes, discharge_notes),
      updated_at = now()
  WHERE id = _admission_id
    AND status = 'ready_for_discharge';

  IF (_adm).status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was settled by someone else — refresh the queue';
  END IF;

  UPDATE public.visits
  SET status = 'settled',
      closed_at = COALESCE(closed_at, now()),
      closed_by = COALESCE(closed_by, public.hms_current_user_id()),
      updated_at = now()
  WHERE id = (_adm).visit_id
    AND status <> 'settled';

  IF (_adm).bed_id IS NOT NULL THEN
    UPDATE public.beds
    SET status = 'available', updated_at = now()
    WHERE id = (_adm).bed_id;
  END IF;

  SELECT * INTO _journey
  FROM public.patient_journey
  WHERE patient_id = (_adm).patient_id
  FOR UPDATE;

  IF (_journey).id IS NULL THEN
    INSERT INTO public.patient_journey (
      patient_id, visit_id, current_state, owner_role, owner_user_id
    ) VALUES (
      (_adm).patient_id, (_adm).visit_id, 'discharged', 'reception', NULL
    )
    RETURNING id INTO _journey_id;

    INSERT INTO public.patient_journey_history (
      journey_id, patient_id, visit_id, from_state, to_state,
      from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
      reason
    ) VALUES (
      _journey_id, (_adm).patient_id, (_adm).visit_id, NULL, 'discharged',
      NULL, 'reception', NULL, NULL,
      'Inpatient cashier settlement completed'
    );
  ELSE
    UPDATE public.patient_journey
    SET visit_id = COALESCE((_adm).visit_id, (_journey).visit_id),
        current_state = 'discharged',
        owner_role = 'reception',
        owner_user_id = NULL,
        updated_at = now()
    WHERE id = (_journey).id;

    INSERT INTO public.patient_journey_history (
      journey_id, patient_id, visit_id, from_state, to_state,
      from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
      reason
    ) VALUES (
      (_journey).id, (_adm).patient_id, COALESCE((_adm).visit_id, (_journey).visit_id),
      (_journey).current_state, 'discharged',
      (_journey).owner_role, 'reception', (_journey).owner_user_id, NULL,
      'Inpatient cashier settlement completed'
    );
  END IF;

  UPDATE public.patients
  SET status = 'discharged', updated_at = now()
  WHERE id = (_adm).patient_id;

  SELECT public.write_audit_log(
    'admission_discharged',
    'admission',
    _admission_id::text,
    jsonb_build_object(
      'patient_id', (_adm).patient_id,
      'notes', _notes,
      'debt', _debt,
      'wallet_applied', _wallet_used,
      'collected', _collected,
      'debt_cleared', _debt_cleared,
      'outstanding', _remaining,
      'credit_left', _credit,
      'refunded', _refund,
      'method', _settlement_method
    ),
    'success'
  );

  RETURN jsonb_build_object(
    'debt', _debt,
    'wallet_applied', _wallet_used,
    'collected', _collected,
    'outstanding', _remaining,
    'credit_left', _credit,
    'refunded', _refund
  );
END;
$$;
