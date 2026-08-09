-- 1. CONSULTATION FEE & REGISTRATION FEE ENFORCEMENT
-- Requirements: 
-- - Registration Fee: ₦1,000 once only for new patients.
-- - Consultation Fee: ₦3,000 once per calendar month.
-- - Opening Debt: Support for inherited physical card debt.

-- Add flags to patients table to track these payments
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS registration_fee_paid BOOLEAN DEFAULT FALSE;

-- 2. HELPER: Check if consultation fee is required for the current month
CREATE OR REPLACE FUNCTION public.is_consultation_fee_required(_patient_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _month_start TIMESTAMPTZ := date_trunc('month', now());
  _required BOOLEAN;
BEGIN
  -- Check if there is a paid or pending consultation invoice for this month
  -- Note: We use a specific note 'MONTHLY_CONSULTATION' to distinguish it from regular consultations if any
  SELECT NOT EXISTS (
    SELECT 1 
    FROM public.invoices i
    JOIN public.invoice_items ii ON i.id = ii.invoice_id
    WHERE i.patient_id = _patient_id
      AND i.status IN ('paid', 'pending', 'partial')
      AND ii.category = 'consultation'
      AND i.created_at >= _month_start
      AND i.notes = 'MONTHLY_CONSULTATION'
  ) INTO _required;
  
  RETURN _required;
END;
$$;

-- 3. RPC: ONBOARD OR REGISTER PATIENT WITH FEES
CREATE OR REPLACE FUNCTION public.onboard_patient_v2(
  _patient_id UUID,
  _is_new_registration BOOLEAN,
  _consultation_already_paid BOOLEAN,
  _opening_debt NUMERIC(12,2) DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _p RECORD;
  _visit_id UUID;
  _reg_fee NUMERIC := 1000;
  _con_fee NUMERIC := 3000;
  _items JSONB := '[]'::jsonb;
  _inv_id UUID;
  _consultation_required BOOLEAN;
  _reg_required BOOLEAN;
  _total_amount NUMERIC := 0;
BEGIN
  -- 1. Authorization check
  IF NOT public.has_any_role(auth.uid(), ARRAY['receptionist', 'admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _p FROM public.patients WHERE id = _patient_id;
  IF _p IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  -- 2. Handle Opening Debt
  IF _opening_debt > 0 THEN
    -- adjust_patient_balance already handles wallet/audit log
    PERFORM public.adjust_patient_balance(
      _patient_id, 
      -_opening_debt, 
      'debt_incurred', 
      NULL, 
      NULL, 
      NULL, 
      'Opening debt from physical OPD card'
    );
  END IF;

  -- 3. Determine required fees
  _reg_required := _is_new_registration AND NOT _p.registration_fee_paid;
  _consultation_required := NOT _consultation_already_paid AND public.is_consultation_fee_required(_patient_id);

  -- 4. Create Fees Invoice if needed
  IF _reg_required OR _consultation_required THEN
    -- Open a visit if none exists
    _visit_id := public.open_visit_for_patient(_patient_id, 'Registration and Onboarding');

    -- Construct invoice items
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

    -- Insert Invoice
    INSERT INTO public.invoices (
      patient_id, visit_id, total_amount, status, notes, sponsor_type, corporate_account_id
    ) VALUES (
      _patient_id, 
      _visit_id, 
      _total_amount,
      'pending',
      'MONTHLY_CONSULTATION',
      CASE WHEN _p.account_type IN ('corporate', 'retainer', 'nhis', 'hmo', 'katchma') THEN _p.account_type ELSE NULL END,
      _p.corporate_id
    ) RETURNING id INTO _inv_id;

    -- Insert Invoice Items
    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
    SELECT _inv_id, (val->>'description'), (val->>'quantity')::int, (val->>'unit_price')::numeric, (val->>'unit_price')::numeric, (val->>'category')
    FROM jsonb_array_elements(_items) AS val;

    -- Update flags
    IF _reg_required THEN
      UPDATE public.patients SET registration_fee_paid = TRUE WHERE id = _patient_id;
    END IF;

    -- Update patient status to block workflow until paid
    UPDATE public.patients SET status = 'awaiting_payment' WHERE id = _patient_id;
    
    RETURN jsonb_build_object('invoice_id', _inv_id, 'status', 'awaiting_payment');
  ELSE
    -- No fees required or already marked paid by reception
    IF _is_new_registration THEN
      UPDATE public.patients SET registration_fee_paid = TRUE WHERE id = _patient_id;
    END IF;

    -- Unlock workflow immediately
    UPDATE public.patients SET status = 'registered' WHERE id = _patient_id;
    RETURN jsonb_build_object('status', 'registered');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_consultation_fee_required(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.onboard_patient_v2(uuid, boolean, boolean, numeric) TO authenticated;
