-- Keep inpatient cashier settlement and the central workflow engine in sync.
-- The whole function runs in one transaction: if the workflow transition fails,
-- no admission, invoice, wallet, or status change is committed.

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
SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD;
  _p RECORD;
  _wallet boolean;
  _debt numeric;
  _collected numeric := 0;
  _remaining numeric := 0;
  _inv RECORD;
  _apply numeric;
  _left numeric;
  _pct numeric;
  _share numeric;
  _wallet_used numeric := 0;
  _refund numeric := 0;
  _credit numeric := 0;
  _debt_cleared numeric := 0;
  _got_lock boolean;
  _journey public.patient_journey%ROWTYPE;
  _journey_id uuid;
BEGIN
  IF NOT public.has_any_role(
    auth.uid(),
    ARRAY['cashier','billing','accountant','admin']::app_role[]
  ) THEN
    RAISE EXCEPTION 'Only the cashier can settle and complete a discharge';
  END IF;

  _got_lock := pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('discharge_admission:' || _admission_id::text, 0)
  );
  IF NOT _got_lock THEN
    RAISE EXCEPTION 'DISCHARGE_IN_PROGRESS: this discharge is already being settled — refresh the queue';
  END IF;

  SELECT * INTO _adm
  FROM public.admissions
  WHERE id = _admission_id
  FOR UPDATE;

  IF _adm IS NULL THEN
    RAISE EXCEPTION 'Admission not found';
  END IF;
  IF _adm.status = 'discharged' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was already settled and discharged on %',
      COALESCE(to_char(_adm.discharged_at, 'DD Mon YYYY HH24:MI'), 'an earlier date');
  END IF;
  IF _adm.status = 'cancelled' THEN
    RAISE EXCEPTION 'ADMISSION_CANCELLED: this admission was cancelled and cannot be settled';
  END IF;
  IF _adm.status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'NOT_IN_CASHIER_QUEUE: the ward has not confirmed this discharge yet (%)', _adm.status;
  END IF;

  PERFORM public.bill_admission_bed_days(_admission_id);
  _wallet_used := public.apply_wallet_to_outstanding(
    _adm.patient_id,
    'Balance applied at discharge'
  );

  SELECT * INTO _p
  FROM public.patients
  WHERE id = _adm.patient_id
  FOR UPDATE;

  _wallet := public.has_wallet(_p.account_type);
  _pct := public.copay_percent(_p.account_type, _p.insurance_plan);
  _debt := public.patient_outstanding(_adm.patient_id);
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
      IF _wallet AND _p.balance < 0 THEN
        _debt_cleared := ROUND(LEAST(_collected, -_p.balance), 2);
        PERFORM public.adjust_patient_balance(
          _adm.patient_id,
          _debt_cleared,
          'debt_cleared',
          _settlement_method,
          NULL,
          NULL,
          COALESCE(_settlement_notes, 'Discharge settlement')
        );
      END IF;
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
      IF _remaining > 0 THEN
        PERFORM public.write_audit_log(
          'discharge_partial_settlement',
          'admission',
          _admission_id::text,
          jsonb_build_object(
            'patient_id', _adm.patient_id,
            'debt', _debt,
            'collected', _collected,
            'outstanding', _remaining,
            'method', _settlement_method,
            'notes', _settlement_notes
          )
        );
      END IF;
    ELSIF _settlement_method = 'salary' THEN
      IF _p.staff_link_id IS NULL THEN
        RAISE EXCEPTION 'STAFF_LINK_REQUIRED: this patient is not linked to any staff member for salary deduction';
      END IF;
      _remaining := 0;
      PERFORM public.write_audit_log(
        'salary_deduction_on_discharge',
        'admission',
        _admission_id::text,
        jsonb_build_object(
          'patient_id', _adm.patient_id,
          'debt', _debt,
          'staff_id', _p.staff_link_id,
          'notes', _settlement_notes
        )
      );
    ELSIF _settlement_method = 'carry' THEN
      PERFORM public.write_audit_log(
        'debt_carried_on_discharge',
        'admission',
        _admission_id::text,
        jsonb_build_object(
          'patient_id', _adm.patient_id,
          'debt', _debt,
          'notes', _settlement_notes
        )
      );
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

  IF _left > 0 THEN
    FOR _inv IN
      SELECT id, total_amount, COALESCE(paid_amount, 0) AS paid
      FROM public.invoices
      WHERE patient_id = _adm.patient_id
        AND status IN ('pending', 'partial')
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN _left <= 0;
      _share := ROUND(_inv.total_amount * _pct / 100.0, 2);
      _apply := ROUND(LEAST(_left, GREATEST(0, _share - _inv.paid)), 2);
      CONTINUE WHEN _apply <= 0;

      UPDATE public.invoices
      SET paid_amount = _inv.paid + _apply,
          status = CASE
            WHEN _inv.paid + _apply >= _share THEN 'paid'
            ELSE 'partial'
          END,
          paid_at = CASE
            WHEN _inv.paid + _apply >= _share THEN now()
            ELSE paid_at
          END,
          payment_method = COALESCE(payment_method, _settlement_method),
          is_salary_deduction = CASE
            WHEN _settlement_method = 'salary' THEN true
            ELSE is_salary_deduction
          END,
          staff_sponsor_id = CASE
            WHEN _settlement_method = 'salary' THEN _p.staff_link_id
            ELSE staff_sponsor_id
          END,
          updated_at = now()
      WHERE id = _inv.id;

      _left := ROUND(_left - _apply, 2);
    END LOOP;
  END IF;

  IF _wallet AND _left > 0 AND _settlement_method IN ('cash', 'pos', 'transfer') THEN
    PERFORM public.adjust_patient_balance(
      _adm.patient_id,
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
    WHERE id = _adm.patient_id
    FOR UPDATE;
    IF _refund > _p.balance THEN
      RAISE EXCEPTION 'Refund % exceeds available balance %', _refund, _p.balance;
    END IF;
    PERFORM public.adjust_patient_balance(
      _adm.patient_id,
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
      discharged_by = auth.uid(),
      discharge_notes = COALESCE(_notes, discharge_notes),
      updated_at = now()
  WHERE id = _admission_id
    AND status = 'ready_for_discharge';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was settled by someone else — refresh the queue';
  END IF;

  IF _adm.bed_id IS NOT NULL THEN
    UPDATE public.beds
    SET status = 'available', updated_at = now()
    WHERE id = _adm.bed_id;
  END IF;

  -- An inpatient cashier settlement is the authoritative terminal event for
  -- this admission. It writes the journey and its audit record directly so the
  -- new admission invoice cannot be misclassified as pending outpatient work.
  SELECT * INTO _journey
  FROM public.patient_journey
  WHERE patient_id = _adm.patient_id
  FOR UPDATE;

  IF _journey.id IS NULL THEN
    INSERT INTO public.patient_journey (
      patient_id, visit_id, current_state, owner_role, owner_user_id
    ) VALUES (
      _adm.patient_id, _adm.visit_id, 'discharged', 'reception', NULL
    )
    RETURNING id INTO _journey_id;

    INSERT INTO public.patient_journey_history (
      journey_id, patient_id, visit_id, from_state, to_state,
      from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
      reason
    ) VALUES (
      _journey_id, _adm.patient_id, _adm.visit_id, NULL, 'discharged',
      NULL, 'reception', NULL, NULL,
      'Inpatient cashier settlement completed'
    );
  ELSE
    UPDATE public.patient_journey
    SET visit_id = COALESCE(_adm.visit_id, _journey.visit_id),
        current_state = 'discharged',
        owner_role = 'reception',
        owner_user_id = NULL,
        updated_at = now()
    WHERE id = _journey.id;

    INSERT INTO public.patient_journey_history (
      journey_id, patient_id, visit_id, from_state, to_state,
      from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
      reason
    ) VALUES (
      _journey.id, _adm.patient_id, COALESCE(_adm.visit_id, _journey.visit_id),
      _journey.current_state, 'discharged',
      _journey.owner_role, 'reception', _journey.owner_user_id, NULL,
      'Inpatient cashier settlement completed'
    );
  END IF;

  UPDATE public.patients
  SET status = 'discharged',
      updated_at = now()
  WHERE id = _adm.patient_id;

  PERFORM public.write_audit_log(
    'admission_discharged',
    'admission',
    _admission_id::text,
    jsonb_build_object(
      'patient_id', _adm.patient_id,
      'notes', _notes,
      'debt', _debt,
      'wallet_applied', _wallet_used,
      'collected', _collected,
      'debt_cleared', _debt_cleared,
      'outstanding', _remaining,
      'credit_left', _credit,
      'refunded', _refund,
      'method', _settlement_method
    )
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
$function$;

-- Repair legacy cases caused by the previous settlement function, which marked
-- admissions as discharged without moving the patient and journey state.
WITH candidates AS (
  SELECT
    j.id AS journey_id,
    j.patient_id,
    j.visit_id,
    j.current_state AS from_state,
    j.owner_role AS from_owner_role,
    j.owner_user_id AS from_owner_user_id
  FROM public.patient_journey j
  JOIN public.patients p ON p.id = j.patient_id
  WHERE p.status = 'admitted'
    AND j.current_state = 'admitted'
    AND EXISTS (
      SELECT 1
      FROM public.admissions a
      WHERE a.patient_id = p.id
        AND a.status = 'discharged'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.admissions a
      WHERE a.patient_id = p.id
        AND a.status IN ('waiting_assignment', 'active', 'ready_for_discharge')
    )
), updated_journeys AS (
  UPDATE public.patient_journey j
  SET current_state = 'discharged',
      owner_role = 'reception',
      owner_user_id = NULL,
      updated_at = now()
  FROM candidates c
  WHERE j.id = c.journey_id
  RETURNING j.id, c.patient_id, c.visit_id, c.from_state, c.from_owner_role, c.from_owner_user_id
), history_written AS (
  INSERT INTO public.patient_journey_history (
    journey_id,
    patient_id,
    visit_id,
    from_state,
    to_state,
    from_owner_role,
    to_owner_role,
    from_owner_user_id,
    to_owner_user_id,
    reason
  )
  SELECT
    id,
    patient_id,
    visit_id,
    from_state,
    'discharged',
    from_owner_role,
    'reception',
    from_owner_user_id,
    NULL,
    'Repair: previously settled inpatient was left in admitted workflow state'
  FROM updated_journeys
  RETURNING patient_id
)
UPDATE public.patients p
SET status = 'discharged',
    updated_at = now()
FROM history_written h
WHERE p.id = h.patient_id;

REVOKE EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) TO authenticated;
