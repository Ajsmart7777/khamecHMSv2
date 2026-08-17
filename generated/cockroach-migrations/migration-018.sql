-- SOURCE: 20260809175339_3651aaba-5464-4d8a-b980-1b29b1f239ec.sql statement 2
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS is_salary_deduction BOOLEAN DEFAULT false;

-- SOURCE: 20260809175339_3651aaba-5464-4d8a-b980-1b29b1f239ec.sql statement 3
CREATE OR REPLACE FUNCTION public.settle_invoice_atomic(
  _invoice_id uuid,
  _cash_amount numeric DEFAULT 0,
  _balance_amount numeric DEFAULT 0,
  _debt_amount numeric DEFAULT 0,
  _payment_method text DEFAULT 'cash',
  _notes text DEFAULT NULL,
  _sponsored boolean DEFAULT false,
  _is_salary_deduction boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  v_invoice public.invoices;
  v_new_balance numeric;
  v_collected numeric;
  v_available numeric;
  v_staff_id UUID;
BEGIN
  IF NOT public.is_authenticated_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _cash_amount < 0 OR _balance_amount < 0 OR _debt_amount < 0 THEN
    RAISE EXCEPTION 'Amounts must be non-negative';
  END IF;

  -- Lock the invoice row
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = _invoice_id
  FOR UPDATE;
  IF (v_invoice).id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF (v_invoice).status = 'paid' THEN
    RAISE EXCEPTION 'Invoice already settled';
  END IF;

  -- If salary deduction is requested, verify staff links
  IF _is_salary_deduction THEN
    SELECT staff_id INTO v_staff_id 
    FROM public.staff_family_members 
    WHERE patient_id = (v_invoice).patient_id;
    
    IF v_staff_id IS NULL THEN
      RAISE EXCEPTION 'Patient is not linked to a staff sponsor';
    END IF;
  END IF;

  -- Wallet deduction
  IF _balance_amount > 0 THEN
    SELECT balance INTO v_available
    FROM public.patients
    WHERE id = (v_invoice).patient_id
    FOR UPDATE;

    IF v_available IS NULL OR v_available < _balance_amount THEN
      RAISE EXCEPTION 'Insufficient wallet balance (available: %, requested: %)',
        COALESCE(v_available, 0), _balance_amount;
    END IF;

    SELECT public.adjust_patient_balance(
      (v_invoice).patient_id,
      -_balance_amount,
      'invoice_deduction',
      'balance',
      NULL,
      _invoice_id,
      COALESCE(_notes, format('Applied to invoice %s', (v_invoice).invoice_number))
    );
  END IF;

  -- Record shortfall as patient debt
  IF _debt_amount > 0 THEN
    SELECT public.adjust_patient_balance(
      (v_invoice).patient_id,
      -_debt_amount,
      'debt_incurred',
      _payment_method,
      NULL,
      _invoice_id,
      format('Shortfall on invoice %s', (v_invoice).invoice_number)
    );
  END IF;

  -- Handle overpayment
  IF NOT _sponsored AND (_cash_amount + _balance_amount) > ((v_invoice).total_amount - COALESCE((v_invoice).paid_amount, 0)) THEN
    DECLARE
      v_overpayment numeric;
    BEGIN
      v_overpayment := (_cash_amount + _balance_amount) - ((v_invoice).total_amount - COALESCE((v_invoice).paid_amount, 0));
      SELECT public.adjust_patient_balance(
        (v_invoice).patient_id,
        v_overpayment,
        'overpayment_credit',
        _payment_method,
        NULL,
        _invoice_id,
        format('Overpayment on invoice %s', (v_invoice).invoice_number)
      );
    END;
  END IF;

  v_collected := COALESCE((v_invoice).paid_amount, 0) + _cash_amount + _balance_amount;

  UPDATE public.invoices
  SET paid_amount          = v_collected,
      status               = 'paid',
      payment_method       = CASE WHEN _is_salary_deduction THEN 'salary_deduction' ELSE _payment_method END,
      paid_at              = now(),
      notes                = COALESCE(_notes, notes),
      is_salary_deduction  = _is_salary_deduction,
      staff_sponsor_id     = v_staff_id,
      updated_at           = now()
  WHERE id = _invoice_id;

  SELECT balance INTO v_new_balance FROM public.patients WHERE id = (v_invoice).patient_id;

  RETURN jsonb_build_object(
    'invoice_id',         _invoice_id,
    'invoice_number',     (v_invoice).invoice_number,
    'patient_id',         (v_invoice).patient_id,
    'collected',          v_collected,
    'cash_amount',        _cash_amount,
    'balance_amount',     _balance_amount,
    'debt_amount',        _debt_amount,
    'new_wallet_balance', v_new_balance,
    'sponsored',          _sponsored,
    'is_salary_deduction', _is_salary_deduction
  );
END;
$$;

-- SOURCE: 20260809175339_3651aaba-5464-4d8a-b980-1b29b1f239ec.sql statement 4
GRANT EXECUTE ON FUNCTION public.settle_invoice_atomic(uuid, numeric, numeric, numeric, text, text, boolean, boolean) TO authenticated;

-- SOURCE: 20260809182058_1b0af13f-c0b2-448e-a1af-912e79449c0e.sql statement 1
CREATE OR REPLACE FUNCTION public.is_consultation_fee_required(_patient_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 
AS $function$
DECLARE
  _month_start TIMESTAMPTZ := date_trunc('month', now());
  _required BOOLEAN;
BEGIN
  SELECT NOT EXISTS (
    SELECT 1 
    FROM public.invoices i
    JOIN public.invoice_items ii ON i.id = ii.invoice_id
    WHERE i.patient_id = _patient_id
      AND i.status = 'paid'
      AND ii.category = 'consultation'
      AND i.created_at >= _month_start
      AND i.notes = 'MONTHLY_CONSULTATION'
  ) INTO _required;
  
  RETURN _required;
END;
$function$;

-- SOURCE: 20260809182058_1b0af13f-c0b2-448e-a1af-912e79449c0e.sql statement 2
CREATE OR REPLACE FUNCTION public.onboard_patient_v2(
  _patient_id uuid, 
  _is_new_registration boolean, 
  _consultation_already_paid boolean, 
  _opening_debt numeric DEFAULT 0
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 
AS $function$
DECLARE
  _p public.patients;
  _visit_id UUID;
  _reg_fee NUMERIC := 1000;
  _con_fee NUMERIC := 3000;
  _items JSONB := '[]'::jsonb;
  _inv_id UUID;
  _consultation_required BOOLEAN;
  _reg_required BOOLEAN;
  _total_amount NUMERIC := 0;
  _existing_pending_inv_id UUID;
BEGIN
  -- Authorization check
  IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['receptionist', 'admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _p FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _p IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  -- Handle Opening Debt
  IF _opening_debt > 0 THEN
    SELECT public.adjust_patient_balance(
      _patient_id, 
      -_opening_debt, 
      'debt_incurred', 
      NULL, 
      NULL, 
      NULL, 
      'Opening debt from physical OPD card'
    );
  END IF;

  -- Determine required fees
  _reg_required := _is_new_registration AND NOT COALESCE((SELECT registration_fee_paid FROM public.patients WHERE id = _patient_id), FALSE);
  
  SELECT i.id INTO _existing_pending_inv_id
  FROM public.invoices i
  JOIN public.invoice_items ii ON i.id = ii.invoice_id
  WHERE i.patient_id = _patient_id
    AND i.status IN ('pending', 'partial')
    AND ii.category = 'consultation'
    AND i.created_at >= date_trunc('month', now())
    AND i.notes = 'MONTHLY_CONSULTATION'
  LIMIT 1;

  _consultation_required := NOT _consultation_already_paid 
                           AND public.is_consultation_fee_required(_patient_id)
                           AND _existing_pending_inv_id IS NULL;

  IF _existing_pending_inv_id IS NOT NULL AND (_reg_required OR NOT _consultation_already_paid) THEN
      UPDATE public.patients SET status = 'awaiting_payment' WHERE id = _patient_id;
      RETURN jsonb_build_object('invoice_id', _existing_pending_inv_id, 'status', 'awaiting_payment', 'message', 'Existing pending consultation invoice found');
  END IF;

  IF _reg_required OR _consultation_required THEN
    SELECT id INTO _visit_id FROM public.visits WHERE patient_id = _patient_id AND status = 'open' LIMIT 1;
    IF _visit_id IS NULL THEN
      _visit_id := public.open_visit_for_patient(_patient_id, 'Registration and Onboarding');
    END IF;

    IF _reg_required THEN
      _items := _items || jsonb_build_object(
        'description', 'Registration Fee',
        'quantity', 1,
        'unit_price', _reg_fee,
        'category', 'registration'
      );
      _total_amount := _total_amount + _reg_fee;
    END IF;

    IF _consultation_required THEN
      _items := _items || jsonb_build_object(
        'description', 'Monthly Consultation Fee (' || to_char(now(), 'FMMonth YYYY') || ')',
        'quantity', 1,
        'unit_price', _con_fee,
        'category', 'consultation'
      );
      _total_amount := _total_amount + _con_fee;
    END IF;

    INSERT INTO public.invoices (
      patient_id, visit_id, total_amount, status, notes, sponsor_type, corporate_account_id
    ) VALUES (
      _patient_id, 
      _visit_id, 
      _total_amount,
      'pending',
      'MONTHLY_CONSULTATION',
      CASE WHEN (_p).account_type IN ('corporate', 'retainer', 'nhis', 'hmo', 'katchma') THEN (_p).account_type ELSE NULL END,
      NULLIF(((_p).corporate_id)::STRING, '')::UUID
    ) RETURNING id INTO _inv_id;

    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
    SELECT _inv_id, (val->>'description'), (val->>'quantity')::int, (val->>'unit_price')::numeric, (val->>'unit_price')::numeric, (val->>'category')
    FROM jsonb_array_elements(_items) AS val;

    IF _reg_required THEN
      UPDATE public.patients SET registration_fee_paid = TRUE WHERE id = _patient_id;
    END IF;

    UPDATE public.patients SET status = 'awaiting_payment' WHERE id = _patient_id;
    
    RETURN jsonb_build_object('invoice_id', _inv_id, 'status', 'awaiting_payment');
  ELSE
    IF _is_new_registration THEN
      UPDATE public.patients SET registration_fee_paid = TRUE WHERE id = _patient_id;
    END IF;

    IF (_p).status IN ('registered', 'discharged', 'awaiting_payment') THEN
        UPDATE public.patients SET status = 'registered' WHERE id = _patient_id;
    END IF;
    
    RETURN jsonb_build_object('status', 'registered');
  END IF;
END;
$function$;

-- SOURCE: 20260809183000_fix_consultation_permissions.sql statement 1
GRANT EXECUTE ON FUNCTION public.is_consultation_fee_required(uuid) TO authenticated;

-- SOURCE: 20260809183000_fix_consultation_permissions.sql statement 2
GRANT EXECUTE ON FUNCTION public.onboard_patient_v2(uuid, boolean, boolean, numeric) TO authenticated;

-- SOURCE: 20260809184251_d43d8265-948f-46d1-91fd-70662b7f1c9b.sql statement 1
CREATE OR REPLACE FUNCTION public.check_monthly_consultation_paid(_patient_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER

AS $$
DECLARE
  _month_start TIMESTAMPTZ := date_trunc('month', now());
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM public.invoices i
    JOIN public.invoice_items ii ON i.id = ii.invoice_id
    WHERE i.patient_id = _patient_id
      AND i.status = 'paid'
      AND ii.category = 'consultation'
      AND i.created_at >= _month_start
      AND i.notes = 'MONTHLY_CONSULTATION'
  );
END;
$$;

-- SOURCE: 20260809184251_d43d8265-948f-46d1-91fd-70662b7f1c9b.sql statement 2
GRANT EXECUTE ON FUNCTION public.check_monthly_consultation_paid(uuid) TO authenticated;

-- SOURCE: 20260809184251_d43d8265-948f-46d1-91fd-70662b7f1c9b.sql statement 3
CREATE OR REPLACE FUNCTION public.create_onboarding_invoices(
  _patient_id uuid, 
  _charge_reg boolean, 
  _charge_con boolean,
  _opening_debt numeric DEFAULT 0
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 
AS $$
DECLARE
  _p public.patients;
  _visit_id UUID;
  _reg_fee NUMERIC := 1000;
  _con_fee NUMERIC := 3000;
  _items JSONB := '[]'::jsonb;
  _inv_id UUID;
  _total_amount NUMERIC := 0;
BEGIN
  -- Authorization check
  IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['receptionist', 'admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _p FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _p IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  -- Handle Opening Debt (one-time adjustment)
  IF _opening_debt > 0 THEN
    SELECT public.adjust_patient_balance(
      _patient_id, 
      -_opening_debt, 
      'debt_incurred', 
      NULL, 
      NULL, 
      NULL, 
      'Opening debt from physical OPD card'
    );
  END IF;

  IF _charge_reg OR _charge_con THEN
    SELECT id INTO _visit_id FROM public.visits WHERE patient_id = _patient_id AND status = 'open' LIMIT 1;
    IF _visit_id IS NULL THEN
      _visit_id := public.open_visit_for_patient(_patient_id, 'Registration/Consultation');
    END IF;

    IF _charge_reg THEN
      _items := _items || jsonb_build_object(
        'description', 'Registration Fee',
        'quantity', 1,
        'unit_price', _reg_fee,
        'category', 'registration'
      );
      _total_amount := _total_amount + _reg_fee;
    END IF;

    IF _charge_con THEN
      _items := _items || jsonb_build_object(
        'description', 'Monthly Consultation Fee (' || to_char(now(), 'FMMonth YYYY') || ')',
        'quantity', 1,
        'unit_price', _con_fee,
        'category', 'consultation'
      );
      _total_amount := _total_amount + _con_fee;
    END IF;

    INSERT INTO public.invoices (
      patient_id, visit_id, total_amount, status, notes, sponsor_type, corporate_account_id
    ) VALUES (
      _patient_id, 
      _visit_id, 
      _total_amount,
      'pending',
      'MONTHLY_CONSULTATION',
      CASE WHEN (_p).account_type IN ('corporate', 'retainer', 'nhis', 'hmo', 'katchma') THEN (_p).account_type ELSE NULL END,
      NULLIF(((_p).corporate_id)::STRING, '')::UUID
    ) RETURNING id INTO _inv_id;

    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
    SELECT _inv_id, (val->>'description'), (val->>'quantity')::int, (val->>'unit_price')::numeric, (val->>'unit_price')::numeric, (val->>'category')
    FROM jsonb_array_elements(_items) AS val;

    RETURN jsonb_build_object('invoice_id', _inv_id, 'status', 'success');
  END IF;

  RETURN jsonb_build_object('status', 'no_charge_needed');
END;
$$;

-- SOURCE: 20260809184251_d43d8265-948f-46d1-91fd-70662b7f1c9b.sql statement 4
GRANT EXECUTE ON FUNCTION public.create_onboarding_invoices(uuid, boolean, boolean, numeric) TO authenticated;

-- SOURCE: 20260809184251_d43d8265-948f-46d1-91fd-70662b7f1c9b.sql statement 5
DROP FUNCTION IF EXISTS public.onboard_patient_v2(uuid, boolean, boolean, numeric);

-- SOURCE: 20260809184251_d43d8265-948f-46d1-91fd-70662b7f1c9b.sql statement 6
DROP FUNCTION IF EXISTS public.is_consultation_fee_required(uuid);

-- SOURCE: 20260809185500_update_onboarding_logic.sql statement 1
CREATE OR REPLACE FUNCTION public.create_onboarding_invoices(
  _patient_id uuid, 
  _charge_reg boolean, 
  _charge_con boolean,
  _opening_debt numeric DEFAULT 0,
  _mark_con_paid boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 
 AS $$
DECLARE
  _p public.patients;
  _visit_id UUID;
  _reg_fee NUMERIC := 1000;
  _con_fee NUMERIC := 3000;
  _items JSONB := '[]'::jsonb;
  _inv_id UUID;
  _total_amount NUMERIC := 0;
  _inv_status TEXT := 'pending';
BEGIN
  -- Authorization check
  IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['receptionist', 'admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _p FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _p IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  -- Handle Opening Debt (one-time adjustment)
  IF _opening_debt > 0 THEN
    SELECT public.adjust_patient_balance(
      _patient_id, 
      -_opening_debt, 
      'debt_incurred', 
      NULL, 
      NULL, 
      NULL, 
      'Opening debt from physical OPD card'
    );
  END IF;

  IF _charge_reg OR _charge_con THEN
    SELECT id INTO _visit_id FROM public.visits WHERE patient_id = _patient_id AND status = 'open' LIMIT 1;
    IF _visit_id IS NULL THEN
      _visit_id := public.open_visit_for_patient(_patient_id, 'Registration/Consultation');
    END IF;

    IF _charge_reg THEN
      _items := _items || jsonb_build_object(
        'description', 'Registration Fee',
        'quantity', 1,
        'unit_price', _reg_fee,
        'category', 'registration'
      );
      _total_amount := _total_amount + _reg_fee;
    END IF;

    IF _charge_con THEN
      _items := _items || jsonb_build_object(
        'description', 'Monthly Consultation Fee (' || to_char(now(), 'FMMonth YYYY') || ')',
        'quantity', 1,
        'unit_price', _con_fee,
        'category', 'consultation'
      );
      _total_amount := _total_amount + _con_fee;
    END IF;
    
    -- If we are marking as paid, status is 'paid'
    IF _mark_con_paid THEN
      _inv_status := 'paid';
    END IF;

    INSERT INTO public.invoices (
      patient_id, visit_id, total_amount, paid_amount, status, notes, sponsor_type, corporate_account_id
    ) VALUES (
      _patient_id, 
      _visit_id, 
      _total_amount,
      CASE WHEN _mark_con_paid THEN _total_amount ELSE 0 END,
      _inv_status,
      'MONTHLY_CONSULTATION',
      CASE WHEN (_p).account_type IN ('corporate', 'retainer', 'nhis', 'hmo', 'katchma') THEN (_p).account_type ELSE NULL END,
      NULLIF(((_p).corporate_id)::STRING, '')::UUID
    ) RETURNING id INTO _inv_id;

    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
    SELECT _inv_id, (val->>'description'), (val->>'quantity')::int, (val->>'unit_price')::numeric, (val->>'unit_price')::numeric, (val->>'category')
    FROM jsonb_array_elements(_items) AS val;

    RETURN jsonb_build_object('invoice_id', _inv_id, 'status', 'success');
  END IF;

  RETURN jsonb_build_object('status', 'no_charge_needed');
END;
$$;

-- SOURCE: 20260809185500_update_onboarding_logic.sql statement 2
GRANT EXECUTE ON FUNCTION public.create_onboarding_invoices(uuid, boolean, boolean, numeric, boolean) TO authenticated;

-- SOURCE: 20260809190833_624bd161-3a75-4927-a004-fd7ae3009164.sql statement 1
CREATE OR REPLACE FUNCTION public.create_onboarding_invoices(
  _patient_id uuid, 
  _charge_reg boolean, 
  _charge_con boolean,
  _opening_debt numeric DEFAULT 0,
  _mark_con_paid boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 
 AS $$
DECLARE
  _p public.patients;
  _visit_id UUID;
  _reg_fee NUMERIC := 1000;
  _con_fee NUMERIC := 3000;
  _items JSONB := '[]'::jsonb;
  _inv_id UUID;
  _total_amount NUMERIC := 0;
  _inv_status TEXT := 'paid'; -- Default to paid if _mark_con_paid is true
BEGIN
  -- Authorization check
  IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['receptionist', 'admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _p FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _p IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  -- Handle Opening Debt (one-time adjustment)
  IF _opening_debt > 0 THEN
    SELECT public.adjust_patient_balance(
      _patient_id, 
      -_opening_debt, 
      'debt_incurred', 
      NULL, 
      NULL, 
      NULL, 
      'Opening debt from physical OPD card'
    );
  END IF;

  IF _charge_reg OR _charge_con THEN
    SELECT id INTO _visit_id FROM public.visits WHERE patient_id = _patient_id AND status = 'open' LIMIT 1;
    IF _visit_id IS NULL THEN
      _visit_id := public.open_visit_for_patient(_patient_id, 'Registration/Consultation');
    END IF;

    IF _charge_reg THEN
      _items := _items || jsonb_build_object(
        'description', 'Registration Fee',
        'quantity', 1,
        'unit_price', _reg_fee,
        'category', 'registration'
      );
      _total_amount := _total_amount + _reg_fee;
    END IF;

    IF _charge_con THEN
      _items := _items || jsonb_build_object(
        'description', 'Monthly Consultation Fee (' || to_char(now(), 'FMMonth YYYY') || ')',
        'quantity', 1,
        'unit_price', _con_fee,
        'category', 'consultation'
      );
      _total_amount := _total_amount + _con_fee;
    END IF;
    
    INSERT INTO public.invoices (
      patient_id, visit_id, total_amount, paid_amount, status, notes, sponsor_type, corporate_account_id
    ) VALUES (
      _patient_id, 
      _visit_id, 
      _total_amount,
      CASE WHEN _mark_con_paid THEN _total_amount ELSE 0 END,
      CASE WHEN _mark_con_paid THEN 'completed' ELSE 'pending' END,
      'MONTHLY_CONSULTATION',
      CASE WHEN (_p).account_type IN ('corporate', 'retainer', 'nhis', 'hmo', 'katchma') THEN (_p).account_type ELSE NULL END,
      NULLIF(((_p).corporate_id)::STRING, '')::UUID
    ) RETURNING id INTO _inv_id;

    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
    SELECT _inv_id, (val->>'description'), (val->>'quantity')::int, (val->>'unit_price')::numeric, (val->>'unit_price')::numeric, (val->>'category')
    FROM jsonb_array_elements(_items) AS val;

    RETURN jsonb_build_object('invoice_id', _inv_id, 'status', 'success');
  END IF;

  RETURN jsonb_build_object('status', 'no_charge_needed');
END;
$$;

-- SOURCE: 20260809190833_624bd161-3a75-4927-a004-fd7ae3009164.sql statement 2
GRANT EXECUTE ON FUNCTION public.create_onboarding_invoices(uuid, boolean, boolean, numeric, boolean) TO authenticated;

-- SOURCE: 20260809192342_51d5b17d-2c64-4a48-a3f9-7120222c9cfa.sql statement 1
CREATE OR REPLACE FUNCTION public.check_monthly_consultation_paid(_patient_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER

AS $$
DECLARE
  _month_start TIMESTAMPTZ := date_trunc('month', now());
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM public.invoices i
    JOIN public.invoice_items ii ON i.id = ii.invoice_id
    WHERE i.patient_id = _patient_id
      AND i.status = 'paid'
      AND ii.category = 'consultation'
      AND i.created_at >= _month_start
      AND (i.notes = 'MONTHLY_CONSULTATION' OR i.notes = 'ONBOARDING_FEES')
  );
END;
$$;

-- SOURCE: 20260809192342_51d5b17d-2c64-4a48-a3f9-7120222c9cfa.sql statement 2
CREATE OR REPLACE FUNCTION public.create_onboarding_invoices(
  _patient_id uuid, 
  _charge_reg boolean, 
  _charge_con boolean,
  _opening_debt numeric DEFAULT 0,
  _mark_con_paid boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 
 AS $$
DECLARE
  _p public.patients;
  _visit_id UUID;
  _reg_fee NUMERIC := 1000;
  _con_fee NUMERIC := 3000;
  _items JSONB := '[]'::jsonb;
  _inv_id UUID;
  _total_amount NUMERIC := 0;
  _notes TEXT;
BEGIN
  -- Authorization check
  IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['receptionist', 'admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _p FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _p IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  -- Handle Opening Debt
  IF _opening_debt > 0 THEN
    SELECT public.adjust_patient_balance(_patient_id, -_opening_debt, 'debt_incurred', NULL, NULL, NULL, 'Opening debt');
  END IF;

  IF _charge_reg OR _charge_con THEN
    SELECT id INTO _visit_id FROM public.visits WHERE patient_id = _patient_id AND status = 'open' LIMIT 1;
    IF _visit_id IS NULL THEN
      _visit_id := public.open_visit_for_patient(_patient_id, 'Registration/Consultation');
    END IF;

    IF _charge_reg THEN
      _items := _items || jsonb_build_object('description', 'Registration Fee', 'quantity', 1, 'unit_price', _reg_fee, 'category', 'registration');
      _total_amount := _total_amount + _reg_fee;
    END IF;

    IF _charge_con THEN
      _items := _items || jsonb_build_object('description', 'Monthly Consultation Fee', 'quantity', 1, 'unit_price', _con_fee, 'category', 'consultation');
      _total_amount := _total_amount + _con_fee;
    END IF;
    
    -- Determine specific note for easier tracking
    IF _charge_reg AND _charge_con THEN _notes := 'ONBOARDING_FEES';
    ELSIF _charge_reg THEN _notes := 'REGISTRATION_FEE';
    ELSE _notes := 'MONTHLY_CONSULTATION';
    END IF;

    INSERT INTO public.invoices (
      patient_id, visit_id, total_amount, paid_amount, status, notes, sponsor_type, corporate_account_id
    ) VALUES (
      _patient_id, _visit_id, _total_amount,
      CASE WHEN _mark_con_paid THEN _total_amount ELSE 0 END,
      CASE WHEN _mark_con_paid THEN 'paid' ELSE 'pending' END,
      _notes,
      CASE WHEN (_p).account_type IN ('corporate', 'retainer', 'nhis', 'hmo', 'katchma') THEN (_p).account_type ELSE NULL END,
      NULLIF(((_p).corporate_id)::STRING, '')::UUID
    ) RETURNING id INTO _inv_id;

    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
    SELECT _inv_id, (val->>'description'), (val->>'quantity')::int, (val->>'unit_price')::numeric, (val->>'unit_price')::numeric, (val->>'category')
    FROM jsonb_array_elements(_items) AS val;

    -- If marked as paid during creation (Reception checkbox), update patient status immediately
    IF _mark_con_paid AND _charge_reg THEN
      UPDATE public.patients SET registration_fee_paid = true WHERE id = _patient_id;
    END IF;

    RETURN jsonb_build_object('invoice_id', _inv_id, 'status', 'success');
  END IF;

  RETURN jsonb_build_object('status', 'no_charge_needed');
END;
$$;

-- SOURCE: 20260809192342_51d5b17d-2c64-4a48-a3f9-7120222c9cfa.sql statement 3
CREATE OR REPLACE FUNCTION public.update_patient_reg_status()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW).status = 'paid' AND (
    EXISTS (SELECT 1 FROM public.invoice_items WHERE invoice_id = (NEW).id AND category = 'registration')
  ) THEN
    UPDATE public.patients SET registration_fee_paid = true WHERE id = (NEW).patient_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- SOURCE: 20260809192342_51d5b17d-2c64-4a48-a3f9-7120222c9cfa.sql statement 4
DROP TRIGGER IF EXISTS tr_update_patient_reg_status ON public.invoices;

-- SOURCE: 20260809192342_51d5b17d-2c64-4a48-a3f9-7120222c9cfa.sql statement 5
CREATE TRIGGER tr_update_patient_reg_status
AFTER UPDATE ON public.invoices
FOR EACH ROW
WHEN ((OLD).status IS DISTINCT FROM (NEW).status AND (NEW).status = 'paid')
EXECUTE FUNCTION public.update_patient_reg_status();

-- SOURCE: 20260809192342_51d5b17d-2c64-4a48-a3f9-7120222c9cfa.sql statement 6
GRANT EXECUTE ON FUNCTION public.check_monthly_consultation_paid(uuid) TO authenticated;

-- SOURCE: 20260809192342_51d5b17d-2c64-4a48-a3f9-7120222c9cfa.sql statement 7
GRANT EXECUTE ON FUNCTION public.create_onboarding_invoices(uuid, boolean, boolean, numeric, boolean) TO authenticated;

-- SOURCE: 20260810000001_robust_fee_management.sql statement 1
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS registration_fee_paid BOOLEAN DEFAULT false;

-- SOURCE: 20260810000001_robust_fee_management.sql statement 2
CREATE OR REPLACE FUNCTION public.check_monthly_consultation_paid(_patient_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER

AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM public.invoices i
    JOIN public.invoice_items ii ON i.id = ii.invoice_id
    WHERE i.patient_id = _patient_id
      AND i.status = 'paid'
      AND ii.category = 'consultation'
      AND i.created_at >= date_trunc('month', now())
  );
END;
$$;

-- SOURCE: 20260810000001_robust_fee_management.sql statement 3
CREATE OR REPLACE FUNCTION public.create_onboarding_invoices(
  _patient_id uuid, 
  _charge_reg boolean, 
  _charge_con boolean,
  _opening_debt numeric DEFAULT 0,
  _mark_con_paid boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 
 AS $$
DECLARE
  _p public.patients;
  _visit_id UUID;
  _reg_fee NUMERIC := 1000;
  _con_fee NUMERIC := 3000;
  _items JSONB := '[]'::jsonb;
  _inv_id UUID;
  _total_amount NUMERIC := 0;
  _notes TEXT;
BEGIN
  -- Authorization check
  IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['receptionist', 'admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _p FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _p IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  -- Handle Opening Debt
  IF _opening_debt > 0 THEN
    SELECT public.adjust_patient_balance(_patient_id, -_opening_debt, 'debt_incurred', NULL, NULL, NULL, 'Opening debt from physical card');
  END IF;

  IF _charge_reg OR _charge_con THEN
    -- Get or open visit
    SELECT id INTO _visit_id FROM public.visits WHERE patient_id = _patient_id AND status = 'open' LIMIT 1;
    IF _visit_id IS NULL THEN
      _visit_id := public.open_visit_for_patient(_patient_id, 'Registration/Consultation');
    END IF;

    IF _charge_reg THEN
      _items := _items || jsonb_build_object('description', 'Registration Fee', 'quantity', 1, 'unit_price', _reg_fee, 'category', 'registration');
      _total_amount := _total_amount + _reg_fee;
    END IF;

    IF _charge_con THEN
      _items := _items || jsonb_build_object('description', 'Monthly Consultation Fee', 'quantity', 1, 'unit_price', _con_fee, 'category', 'consultation');
      _total_amount := _total_amount + _con_fee;
    END IF;
    
    -- Precise notes for tracking
    IF _charge_reg AND _charge_con THEN _notes := 'ONBOARDING_FEES';
    ELSIF _charge_reg THEN _notes := 'REGISTRATION_FEE';
    ELSE _notes := 'MONTHLY_CONSULTATION';
    END IF;

    INSERT INTO public.invoices (
      patient_id, visit_id, total_amount, paid_amount, status, notes, sponsor_type, corporate_account_id
    ) VALUES (
      _patient_id, _visit_id, _total_amount,
      CASE WHEN _mark_con_paid THEN _total_amount ELSE 0 END,
      CASE WHEN _mark_con_paid THEN 'paid' ELSE 'pending' END,
      _notes,
      CASE WHEN (_p).account_type IN ('corporate', 'retainer', 'nhis', 'hmo', 'katchma') THEN (_p).account_type ELSE NULL END,
      NULLIF(((_p).corporate_id)::STRING, '')::UUID
    ) RETURNING id INTO _inv_id;

    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
    SELECT _inv_id, (val->>'description'), (val->>'quantity')::int, (val->>'unit_price')::numeric, (val->>'unit_price')::numeric, (val->>'category')
    FROM jsonb_array_elements(_items) AS val;

    -- If we marked it as paid (e.g., existing patient already paid consultation), 
    -- and there was a registration fee, update the flag.
    IF _mark_con_paid AND _charge_reg THEN
      UPDATE public.patients SET registration_fee_paid = true WHERE id = _patient_id;
    END IF;

    RETURN jsonb_build_object('invoice_id', _inv_id, 'status', 'success');
  END IF;

  RETURN jsonb_build_object('status', 'no_charge_needed');
END;
$$;

-- SOURCE: 20260810000001_robust_fee_management.sql statement 4
CREATE OR REPLACE FUNCTION public.update_patient_reg_status_v2()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW).status = 'paid' THEN
    IF EXISTS (SELECT 1 FROM public.invoice_items WHERE invoice_id = (NEW).id AND category = 'registration') THEN
      UPDATE public.patients SET registration_fee_paid = true WHERE id = (NEW).patient_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- SOURCE: 20260810000001_robust_fee_management.sql statement 5
DROP TRIGGER IF EXISTS tr_update_patient_reg_status ON public.invoices;

-- SOURCE: 20260810000001_robust_fee_management.sql statement 6
CREATE TRIGGER tr_update_patient_reg_status
AFTER UPDATE ON public.invoices
FOR EACH ROW
WHEN ((OLD).status IS DISTINCT FROM (NEW).status AND (NEW).status = 'paid')
EXECUTE FUNCTION public.update_patient_reg_status_v2();

-- SOURCE: 20260810000001_robust_fee_management.sql statement 7
GRANT EXECUTE ON FUNCTION public.check_monthly_consultation_paid(uuid) TO authenticated;

-- SOURCE: 20260810000001_robust_fee_management.sql statement 8
GRANT EXECUTE ON FUNCTION public.create_onboarding_invoices(uuid, boolean, boolean, numeric, boolean) TO authenticated;

-- SOURCE: 20260810000002_fix_old_patient_reg_fee.sql statement 1
CREATE OR REPLACE FUNCTION public.create_onboarding_invoices(
  _patient_id uuid, 
  _charge_reg boolean, 
  _charge_con boolean,
  _opening_debt numeric DEFAULT 0,
  _mark_con_paid boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 
 AS $$
DECLARE
  _p public.patients;
  _visit_id UUID;
  _reg_fee NUMERIC := 1000;
  _con_fee NUMERIC := 3000;
  _items JSONB := '[]'::jsonb;
  _inv_id UUID;
  _total_amount NUMERIC := 0;
  _notes TEXT;
BEGIN
  -- Authorization check
  IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['receptionist', 'admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _p FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _p IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  -- Logic: If it's an existing patient (not charging reg), ensure the flag is set
  IF NOT _charge_reg THEN
    UPDATE public.patients SET registration_fee_paid = true WHERE id = _patient_id;
  END IF;

  -- Handle Opening Debt
  IF _opening_debt > 0 THEN
    SELECT public.adjust_patient_balance(_patient_id, -_opening_debt, 'debt_incurred', NULL, NULL, NULL, 'Opening debt from physical card');
  END IF;

  IF _charge_reg OR _charge_con THEN
    -- Get or open visit
    SELECT id INTO _visit_id FROM public.visits WHERE patient_id = _patient_id AND status = 'open' LIMIT 1;
    IF _visit_id IS NULL THEN
      _visit_id := public.open_visit_for_patient(_patient_id, 'Registration/Consultation');
    END IF;

    IF _charge_reg THEN
      _items := _items || jsonb_build_object('description', 'Registration Fee', 'quantity', 1, 'unit_price', _reg_fee, 'category', 'registration');
      _total_amount := _total_amount + _reg_fee;
    END IF;

    IF _charge_con THEN
      _items := _items || jsonb_build_object('description', 'Monthly Consultation Fee', 'quantity', 1, 'unit_price', _con_fee, 'category', 'consultation');
      _total_amount := _total_amount + _con_fee;
    END IF;
    
    -- Precise notes for tracking
    IF _charge_reg AND _charge_con THEN _notes := 'ONBOARDING_FEES';
    ELSIF _charge_reg THEN _notes := 'REGISTRATION_FEE';
    ELSE _notes := 'MONTHLY_CONSULTATION';
    END IF;

    INSERT INTO public.invoices (
      patient_id, visit_id, total_amount, paid_amount, status, notes, sponsor_type, corporate_account_id
    ) VALUES (
      _patient_id, _visit_id, _total_amount,
      CASE WHEN _mark_con_paid THEN _total_amount ELSE 0 END,
      CASE WHEN _mark_con_paid THEN 'paid' ELSE 'pending' END,
      _notes,
      CASE WHEN (_p).account_type IN ('corporate', 'retainer', 'nhis', 'hmo', 'katchma') THEN (_p).account_type ELSE NULL END,
      NULLIF(((_p).corporate_id)::STRING, '')::UUID
    ) RETURNING id INTO _inv_id;

    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
    SELECT _inv_id, (val->>'description'), (val->>'quantity')::int, (val->>'unit_price')::numeric, (val->>'unit_price')::numeric, (val->>'category')
    FROM jsonb_array_elements(_items) AS val;

    -- If we marked it as paid, and there was a registration fee (or it was an existing patient), 
    -- update the flag.
    IF _mark_con_paid AND (_charge_reg OR NOT _charge_reg) THEN
      UPDATE public.patients SET registration_fee_paid = true WHERE id = _patient_id;
    END IF;

    RETURN jsonb_build_object('invoice_id', _inv_id, 'status', 'success');
  END IF;

  RETURN jsonb_build_object('status', 'no_charge_needed');
END;
$$;

-- SOURCE: 20260810150330_5526cc30-6703-4d18-83f5-1e7de9ce9dcc.sql statement 1
CREATE OR REPLACE FUNCTION public.update_patient_reg_status()
 RETURNS trigger
 LANGUAGE plpgsql
 
AS $function$
BEGIN
  IF (NEW).status = 'paid' AND (
    EXISTS (SELECT 1 FROM public.invoice_items WHERE invoice_id = (NEW).id AND category = 'registration')
  ) THEN
    UPDATE public.patients SET registration_fee_paid = true WHERE id = (NEW).patient_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- SOURCE: 20260810150330_5526cc30-6703-4d18-83f5-1e7de9ce9dcc.sql statement 2
REVOKE ALL ON FUNCTION public.update_patient_reg_status() FROM PUBLIC, anon, authenticated;

-- SOURCE: 20260810150330_5526cc30-6703-4d18-83f5-1e7de9ce9dcc.sql statement 3
DROP FUNCTION IF EXISTS public.create_onboarding_invoices(uuid, boolean, boolean, numeric);

-- SOURCE: 20260810150330_5526cc30-6703-4d18-83f5-1e7de9ce9dcc.sql statement 4
REVOKE ALL ON FUNCTION public.settle_invoice_atomic(uuid, numeric, numeric, numeric, text, text, boolean, boolean) FROM PUBLIC, anon;

-- SOURCE: 20260810150330_5526cc30-6703-4d18-83f5-1e7de9ce9dcc.sql statement 5
GRANT EXECUTE ON FUNCTION public.settle_invoice_atomic(uuid, numeric, numeric, numeric, text, text, boolean, boolean) TO authenticated;

-- SOURCE: 20260810150330_5526cc30-6703-4d18-83f5-1e7de9ce9dcc.sql statement 6
REVOKE ALL ON FUNCTION public.check_monthly_consultation_paid(uuid) FROM PUBLIC, anon;

-- SOURCE: 20260810150330_5526cc30-6703-4d18-83f5-1e7de9ce9dcc.sql statement 7
GRANT EXECUTE ON FUNCTION public.check_monthly_consultation_paid(uuid) TO authenticated;

-- SOURCE: 20260810150330_5526cc30-6703-4d18-83f5-1e7de9ce9dcc.sql statement 8
REVOKE ALL ON FUNCTION public.create_onboarding_invoices(uuid, boolean, boolean, numeric, boolean) FROM PUBLIC, anon;

-- SOURCE: 20260810150330_5526cc30-6703-4d18-83f5-1e7de9ce9dcc.sql statement 9
GRANT EXECUTE ON FUNCTION public.create_onboarding_invoices(uuid, boolean, boolean, numeric, boolean) TO authenticated;

-- SOURCE: 20260810183000_fix_balance_transaction_types.sql statement 1
ALTER TABLE public.balance_transactions DROP CONSTRAINT IF EXISTS balance_transactions_transaction_type_check;

-- SOURCE: 20260810183000_fix_balance_transaction_types.sql statement 2
ALTER TABLE public.balance_transactions ADD CONSTRAINT balance_transactions_transaction_type_check
  CHECK (transaction_type = ANY (ARRAY[
    'topup',
    'refund',
    'invoice_deduction',
    'staff_family_coverage',
    'staff_coverage',
    'adjustment',
    'debt_incurred',
    'debt_cleared',
    'admitted_deduction',
    'overpayment_credit'
  ]));

-- SOURCE: 20260810213333_2c0336ca-420c-4b13-96e4-e2b5dea16823.sql statement 1
CREATE OR REPLACE FUNCTION public.can_add_snap_for_patient(_patient_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER

AS $$
DECLARE
  _status text;
  _is_admitted boolean;
  _has_lab_return boolean;
BEGIN
  IF _user_id IS NULL OR _patient_id IS NULL THEN RETURN false; END IF;

  -- Admin always allowed.
  IF public.has_role(_user_id, 'admin'::app_role) THEN RETURN true; END IF;

  SELECT status::text INTO _status FROM public.patients WHERE id = _patient_id;
  IF _status IS NULL THEN RETURN false; END IF;

  -- Lab result check: if a lab result is ready for THIS user, they are an owner.
  SELECT EXISTS (
    SELECT 1 FROM public.snap_orders
     WHERE patient_id = _patient_id
       AND order_type = 'lab_result'
       AND status = 'returned'
       AND returned_to = _user_id
  ) INTO _has_lab_return;

  IF _has_lab_return THEN RETURN true; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.admissions
     WHERE patient_id = _patient_id AND status = 'active'
  ) INTO _is_admitted;

  -- Admitted patients: nursing/doctor roles retain ownership in the ward.
  IF _is_admitted OR _status = 'admitted' THEN
    RETURN public.has_any_role(_user_id,
      ARRAY['nurse','doctor','doctor1','doctor2']::app_role[]);
  END IF;

  RETURN CASE _status
    WHEN 'with_nurse'   THEN public.has_role(_user_id, 'nurse'::app_role)
    WHEN 'with_doctor'  THEN public.has_any_role(_user_id,
                              ARRAY['doctor','doctor1','doctor2']::app_role[])
    WHEN 'in_lab'       THEN public.has_role(_user_id, 'lab_tech'::app_role)
    WHEN 'at_pharmacy'  THEN public.has_role(_user_id, 'pharmacist'::app_role)
    ELSE false
  END;
END;
$$;

-- SOURCE: 20260811130632_205bd16b-fae4-4c41-932e-760ecc20a387.sql statement 1
DROP POLICY IF EXISTS "Billing and admin can update corporate_accounts" ON public.corporate_accounts;

-- SOURCE: 20260811130632_205bd16b-fae4-4c41-932e-760ecc20a387.sql statement 2
CREATE POLICY "Billing and admin can update corporate_accounts"
ON public.corporate_accounts FOR UPDATE TO authenticated
USING (has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role,'admin'::app_role]))
WITH CHECK (has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role,'admin'::app_role]));

-- SOURCE: 20260811173347_49087ad1-b070-4144-a559-819ae7369400.sql statement 1
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS dispensing_status text DEFAULT 'pending';

-- SOURCE: 20260811173347_49087ad1-b070-4144-a559-819ae7369400.sql statement 2
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS dispensing_notes text;

-- SOURCE: 20260811173347_49087ad1-b070-4144-a559-819ae7369400.sql statement 3
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS dispensing_updated_at timestamptz;

-- SOURCE: 20260811173347_49087ad1-b070-4144-a559-819ae7369400.sql statement 4
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS dispensing_updated_by uuid REFERENCES public.auth_users(id);

-- SOURCE: 20260811173347_49087ad1-b070-4144-a559-819ae7369400.sql statement 5
CREATE OR REPLACE FUNCTION public.mark_item_unavailable(
    _item_id uuid,
    _reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
    _invoice_id uuid;
    _item_desc text;
BEGIN
    SELECT invoice_id, description INTO _invoice_id, _item_desc FROM public.invoice_items WHERE id = _item_id;
    
    UPDATE public.invoice_items
    SET dispensing_status = 'unavailable',
        dispensing_notes = _reason,
        dispensing_updated_at = now(),
        dispensing_updated_by = public.hms_current_user_id()
    WHERE id = _item_id;

    SELECT public.write_audit_log('item_marked_unavailable', 'invoice', _invoice_id::text, jsonb_build_object('item_id', _item_id, 'reason', _reason, 'description', _item_desc), 'success');
END;
$$;

-- SOURCE: 20260811173347_49087ad1-b070-4144-a559-819ae7369400.sql statement 6
GRANT EXECUTE ON FUNCTION public.mark_item_unavailable(uuid, text) TO authenticated;

-- SOURCE: 20260811173347_49087ad1-b070-4144-a559-819ae7369400.sql statement 7
CREATE OR REPLACE FUNCTION public.refund_invoice_item(
    _item_id uuid,
    _payment_method text DEFAULT 'balance'
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
    _item_total numeric;
    _patient_id uuid;
    _invoice_id uuid;
    _item_desc text;
    _new_balance numeric;
    _is_sponsored boolean;
BEGIN
    -- Check if eligible
    SELECT ii.total, i.patient_id, ii.invoice_id, ii.description, (i.sponsor_type IS NOT NULL) INTO _item_total, _patient_id, _invoice_id, _item_desc, _is_sponsored
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    WHERE ii.id = _item_id AND ii.dispensing_status = 'unavailable';
    IF _patient_id IS NULL THEN
        RAISE EXCEPTION 'Item not eligible for refund (must be unavailable)';
    END IF;

    -- Mark as refunded
    UPDATE public.invoice_items
    SET dispensing_status = 'refunded',
        dispensing_updated_at = now(),
        dispensing_updated_by = public.hms_current_user_id()
    WHERE id = _item_id;

    -- For Cash/Wallet patients, credit their balance if method is 'balance'
    IF NOT _is_sponsored AND _payment_method = 'balance' THEN
        SELECT public.adjust_patient_balance(
            _patient_id,
            _item_total,
            'topup',
            'cash',
            NULL,
            _invoice_id,
            'Refund for unavailable: ' || _item_desc
        ) INTO _new_balance;
    ELSE
        SELECT balance INTO _new_balance FROM public.patients WHERE id = _patient_id;
    END IF;

    SELECT public.write_audit_log('item_refunded', 'invoice', _invoice_id::text, jsonb_build_object('item_id', _item_id, 'amount', _item_total, 'method', _payment_method, 'is_sponsored', _is_sponsored), 'success');

    RETURN json_build_object(
        'success', true,
        'amount', _item_total,
        'new_balance', _new_balance,
        'is_sponsored', _is_sponsored
    );
END;
$$;

-- SOURCE: 20260811173347_49087ad1-b070-4144-a559-819ae7369400.sql statement 8
GRANT EXECUTE ON FUNCTION public.refund_invoice_item(uuid, text) TO authenticated;

-- SOURCE: 20260811173944_cac5b31b-17d6-44c5-8a4e-2c25d47783ee.sql statement 1
CREATE OR REPLACE FUNCTION public.mark_item_unavailable(
    _item_id uuid,
    _reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
    _invoice_id uuid;
    _item_desc text;
    _current_status text;
BEGIN
    SELECT invoice_id, description, dispensing_status 
    INTO _invoice_id, _item_desc, _current_status 
    FROM public.invoice_items 
    WHERE id = _item_id;
    
    IF _current_status = 'unavailable' THEN
        RAISE EXCEPTION 'Item is already marked as unavailable';
    END IF;

    IF _current_status = 'refunded' THEN
        RAISE EXCEPTION 'Item has already been refunded';
    END IF;
    
    UPDATE public.invoice_items
    SET dispensing_status = 'unavailable',
        dispensing_notes = _reason,
        dispensing_updated_at = now(),
        dispensing_updated_by = public.hms_current_user_id()
    WHERE id = _item_id;

    SELECT public.write_audit_log('item_marked_unavailable', 'invoice', _invoice_id::text, jsonb_build_object('item_id', _item_id, 'reason', _reason, 'description', _item_desc), 'success');
END;
$$;

-- SOURCE: 20260811173944_cac5b31b-17d6-44c5-8a4e-2c25d47783ee.sql statement 2
CREATE OR REPLACE FUNCTION public.refund_invoice_item(
    _item_id uuid,
    _payment_method text DEFAULT 'balance'
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
    _item_total numeric;
    _patient_id uuid;
    _invoice_id uuid;
    _item_desc text;
    _new_balance numeric;
    _is_sponsored boolean;
    _current_status text;
BEGIN
    -- Check if eligible and current status
    SELECT ii.total, i.patient_id, ii.invoice_id, ii.description, (i.sponsor_type IS NOT NULL), ii.dispensing_status
    INTO _item_total, _patient_id, _invoice_id, _item_desc, _is_sponsored, _current_status
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    WHERE ii.id = _item_id;

    IF _current_status = 'refunded' THEN
        RAISE EXCEPTION 'Item has already been refunded';
    END IF;

    IF _current_status != 'unavailable' THEN
        RAISE EXCEPTION 'Item not eligible for refund (must be unavailable)';
    END IF;

    -- Mark as refunded
    UPDATE public.invoice_items
    SET dispensing_status = 'refunded',
        dispensing_updated_at = now(),
        dispensing_updated_by = public.hms_current_user_id()
    WHERE id = _item_id;

    -- For Cash/Wallet patients, credit their balance if method is 'balance'
    IF NOT _is_sponsored AND _payment_method = 'balance' THEN
        SELECT public.adjust_patient_balance(
            _patient_id,
            _item_total,
            'topup',
            'cash',
            NULL,
            _invoice_id,
            'Refund for unavailable: ' || _item_desc
        ) INTO _new_balance;
    ELSE
        SELECT balance INTO _new_balance FROM public.patients WHERE id = _patient_id;
    END IF;

    SELECT public.write_audit_log('item_refunded', 'invoice', _invoice_id::text, jsonb_build_object('item_id', _item_id, 'amount', _item_total, 'method', _payment_method, 'is_sponsored', _is_sponsored), 'success');

    RETURN json_build_object(
        'success', true,
        'amount', _item_total,
        'new_balance', _new_balance,
        'is_sponsored', _is_sponsored
    );
END;
$$;

-- SOURCE: 20260811210752_e27d1688-c8fe-4222-8faa-c453cfc844fd.sql statement 1
CREATE OR REPLACE FUNCTION public.get_database_size()
RETURNS TABLE (
  database_size_bytes bigint,
  database_name text
)
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
BEGIN
  IF NOT public.has_role(public.hms_current_user_id(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can check database size';
  END IF;

  RETURN QUERY
  SELECT NULL::bigint, current_database()::text;
END;
$$;

-- SOURCE: 20260811210752_e27d1688-c8fe-4222-8faa-c453cfc844fd.sql statement 2
GRANT EXECUTE ON FUNCTION public.get_database_size() TO authenticated;

-- SOURCE: 20260811210752_e27d1688-c8fe-4222-8faa-c453cfc844fd.sql statement 3
GRANT ALL ON FUNCTION public.get_database_size() TO service_role;
