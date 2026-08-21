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
  _admitted_at timestamptz;
  _discharged_at timestamptz;
  _created_at timestamptz;
  _room_rate numeric;
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

  -- Inline bed-charge calculation. The legacy set-returning helper triggers
  -- CockroachDB's top-level relational-expression error when called here.
  SELECT a.admitted_at, a.discharged_at, a.created_at, r.daily_rate
  INTO _admitted_at, _discharged_at, _created_at, _room_rate
  FROM public.admissions a
  LEFT JOIN public.beds b ON b.id = a.bed_id
  LEFT JOIN public.rooms r ON r.id = b.room_id
  WHERE a.id = _admission_id;

  IF _created_at IS NULL THEN
    _nights := 0;
    _rate := 0;
    _bed_total := 0;
  ELSE
    _nights := GREATEST(
      0,
      (COALESCE(_discharged_at, now())::date - COALESCE(_admitted_at, _created_at)::date)
    )::int;
    IF _nights = 0 THEN
      _rate := 3000;
      _bed_total := 3000;
    ELSE
      _rate := COALESCE(_room_rate, 0);
      _bed_total := ROUND(_nights::numeric * _rate, 2);
    END IF;
  END IF;

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
  _pending_station text;
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

  -- Do this safety check before billing or wallet mutations. Pending clinical
  -- work must be completed by Billing/Lab/Pharmacy before discharge settlement.
  SELECT public.patient_pending_workflow_station((_adm).patient_id)
  INTO _pending_station;
  IF _pending_station IS NOT NULL THEN
    RAISE EXCEPTION 'PENDING_WORKFLOW: complete % work before discharge settlement',
      CASE _pending_station
        WHEN 'awaiting_billing' THEN 'Billing'
        WHEN 'awaiting_payment' THEN 'Cashier payment'
        WHEN 'in_lab' THEN 'Laboratory'
        WHEN 'at_pharmacy' THEN 'Pharmacy'
        ELSE _pending_station
      END;
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


-- Replace the legacy bill helper's ROWS FROM(admission_bed_charge(...)) call.
-- This routine is invoked by discharge_admission and uses the same inline
-- bed calculation as admission_discharge_preview.
CREATE OR REPLACE FUNCTION public.bill_admission_bed_days(_admission_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _adm public.admissions;
  _p public.patients;
  _room_class text;
  _admitted_at timestamptz;
  _discharged_at timestamptz;
  _created_at timestamptz;
  _room_rate numeric;
  _days int;
  _rate numeric;
  _amount numeric;
  _pct numeric;
  _copay numeric;
  _inv uuid;
  _bal numeric;
  _from_wallet numeric;
  _debt numeric;
  _item_desc text;
BEGIN
  SELECT * INTO _adm
  FROM public.admissions
  WHERE id = _admission_id;
  IF _adm IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO _p
  FROM public.patients
  WHERE id = (_adm).patient_id;
  IF _p IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT a.admitted_at, a.discharged_at, a.created_at, r.daily_rate
  INTO _admitted_at, _discharged_at, _created_at, _room_rate
  FROM public.admissions a
  LEFT JOIN public.beds b ON b.id = a.bed_id
  LEFT JOIN public.rooms r ON r.id = b.room_id
  WHERE a.id = _admission_id;
  IF _created_at IS NULL THEN
    RETURN NULL;
  END IF;

  _days := GREATEST(
    0,
    (COALESCE(_discharged_at, now())::date - COALESCE(_admitted_at, _created_at)::date)
  )::int;
  IF _days = 0 THEN
    _rate := 3000;
    _amount := 3000;
  ELSE
    _rate := COALESCE(_room_rate, 0);
    _amount := ROUND(_days::numeric * _rate, 2);
  END IF;
  IF COALESCE(_amount, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT id INTO _inv
  FROM public.invoices
  WHERE patient_id = (_adm).patient_id
    AND notes = 'BED_DAYS:' || _admission_id::text
  LIMIT 1;
  IF _inv IS NOT NULL THEN
    RETURN _inv;
  END IF;

  _pct := public.copay_percent((_p).account_type, (_p).insurance_plan);
  _copay := ROUND((_amount * _pct) / 100.0, 2);
  SELECT r.room_class
  INTO _room_class
  FROM public.beds b
  JOIN public.rooms r ON r.id = b.room_id
  WHERE b.id = (_adm).bed_id;

  INSERT INTO public.invoices(
    patient_id, visit_id, total_amount, original_amount, discount_amount,
    paid_amount, status, sponsor_type, corporate_account_id, notes
  ) VALUES (
    (_adm).patient_id, (_adm).visit_id, _amount, _amount, 0, 0, 'pending',
    CASE WHEN _pct < 100 THEN (_p).account_type ELSE NULL END,
    NULLIF(((_p).corporate_id)::text, '')::uuid,
    'BED_DAYS:' || _admission_id::text
  ) RETURNING id INTO _inv;

  IF _days = 0 THEN
    _item_desc := 'Observation fee (same-day discharge)';
  ELSE
    _item_desc := 'Bed charge - ' || COALESCE(_room_class, 'ward') ||
      ' - ' || _days || ' night(s)';
  END IF;
  INSERT INTO public.invoice_items(
    invoice_id, description, quantity, unit_price, total, category
  ) VALUES (
    _inv, _item_desc, CASE WHEN _days = 0 THEN 1 ELSE _days END,
    _rate, _amount, 'admission'
  );

  -- A fully sponsored admission has no patient share. Marking this invoice
  -- paid with a zero collection is required before the journey-discharge
  -- trigger runs; otherwise the new invoice remains pending and blocks the
  -- otherwise valid discharge transition.
  IF _copay = 0 THEN
    UPDATE public.invoices
    SET paid_amount = 0,
        status = 'paid',
        paid_at = now(),
        payment_method = 'sponsor',
        updated_at = now()
    WHERE id = _inv;
  END IF;

  IF _copay > 0 THEN
    SELECT balance INTO _bal
    FROM public.patients
    WHERE id = (_adm).patient_id
    FOR UPDATE;
    _from_wallet := ROUND(LEAST(GREATEST(COALESCE(_bal, 0), 0), _copay), 2);
    _debt := ROUND(_copay - _from_wallet, 2);
    IF _from_wallet > 0 THEN
      SELECT public.adjust_patient_balance(
        (_adm).patient_id, -_from_wallet, 'invoice_deduction', NULL,
        NULL, _inv,
        CASE WHEN _days = 0 THEN 'Observation fee for admission'
          ELSE 'Bed charge for admission (' || _days || ' night(s))' END
      );
    END IF;
    IF _debt > 0 THEN
      SELECT public.adjust_patient_balance(
        (_adm).patient_id, -_debt, 'debt_incurred', NULL,
        NULL, _inv,
        CASE WHEN _days = 0 THEN 'Observation fee shortfall on discharge'
          ELSE 'Bed charge shortfall on discharge (' || _days || ' night(s))' END
      );
    END IF;
    UPDATE public.invoices
    SET paid_amount = _from_wallet,
        status = CASE
          WHEN _from_wallet >= _amount THEN 'paid'
          WHEN _from_wallet > 0 THEN 'partial'
          ELSE 'pending'
        END,
        paid_at = CASE WHEN _from_wallet >= _amount THEN now() ELSE NULL END
    WHERE id = _inv;
  END IF;

  RETURN _inv;
END;
$$;
