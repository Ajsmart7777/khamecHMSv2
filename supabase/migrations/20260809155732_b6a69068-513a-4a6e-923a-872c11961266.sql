-- 1. FIX TYPE MISMATCHES AND CONSOLIDATE WORKFLOW ROUTINES
-- 2. HARDEN SECURITY DEFINER ROUTINES

-- Revoke permissions for typed orders from public/anon (Hardening)
REVOKE EXECUTE ON FUNCTION public.create_prescription_from_typed(UUID, UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_lab_request_from_typed(UUID, UUID, TEXT, TEXT[]) FROM PUBLIC, anon;

-- Ensure patients table has the tracking flag
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS registration_fee_paid BOOLEAN DEFAULT FALSE;

-- Helper to check consultation fee requirement
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

-- Unified Onboarding RPC with correct types and safety checks
CREATE OR REPLACE FUNCTION public.onboard_patient_v2(
  _patient_id UUID,
  _is_new_registration BOOLEAN,
  _consultation_already_paid BOOLEAN,
  _opening_debt NUMERIC DEFAULT 0
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
  -- Authorization check
  IF NOT public.has_any_role(auth.uid(), ARRAY['receptionist', 'admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _p FROM public.patients WHERE id = _patient_id;
  IF _p IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  -- Handle Opening Debt
  IF _opening_debt > 0 THEN
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

  -- Determine required fees
  _reg_required := _is_new_registration AND NOT COALESCE(_p.registration_fee_paid, FALSE);
  _consultation_required := NOT _consultation_already_paid AND public.is_consultation_fee_required(_patient_id);

  IF _reg_required OR _consultation_required THEN
    -- Get or open a visit
    SELECT id INTO _visit_id FROM public.visits WHERE patient_id = _patient_id AND status = 'active' LIMIT 1;
    IF _visit_id IS NULL THEN
      _visit_id := public.open_visit_for_patient(_patient_id, 'Registration and Onboarding');
    END IF;

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

-- Revoke permissions for other system routines (Hardening)
REVOKE EXECUTE ON FUNCTION public.write_audit_log(text, text, text, jsonb, text) FROM authenticated, PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.adjust_patient_balance(uuid, numeric, text, text, uuid, uuid, text) FROM authenticated, PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.purge_clinical_data(text[]) FROM authenticated, PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.audit_user_roles() FROM authenticated, PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.audit_invoice_payment() FROM authenticated, PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.audit_prescription_dispense() FROM authenticated, PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.audit_payroll_processed() FROM authenticated, PUBLIC, anon;

-- Grant permissions for workflow routines to authenticated users
GRANT EXECUTE ON FUNCTION public.is_consultation_fee_required(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.onboard_patient_v2(uuid, boolean, boolean, numeric) TO authenticated;

-- Revoke from public/anon
REVOKE EXECUTE ON FUNCTION public.is_consultation_fee_required(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.onboard_patient_v2(uuid, boolean, boolean, numeric) FROM PUBLIC, anon;

-- Updated Settle Invoice with Overpayment support
CREATE OR REPLACE FUNCTION public.settle_invoice_atomic(
  _invoice_id uuid,
  _cash_amount numeric DEFAULT 0,
  _balance_amount numeric DEFAULT 0,
  _debt_amount numeric DEFAULT 0,
  _payment_method text DEFAULT 'cash',
  _notes text DEFAULT NULL,
  _sponsored boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice invoices%ROWTYPE;
  v_new_balance numeric;
  v_collected numeric;
  v_available numeric;
  v_total_applied numeric;
  v_outstanding numeric;
  v_overpayment numeric;
BEGIN
  IF NOT public.is_authenticated_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _cash_amount < 0 OR _balance_amount < 0 OR _debt_amount < 0 THEN
    RAISE EXCEPTION 'Amounts must be non-negative';
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF v_invoice.status = 'paid' THEN RAISE EXCEPTION 'Invoice already settled'; END IF;

  SELECT balance INTO v_available FROM public.patients WHERE id = v_invoice.patient_id FOR UPDATE;

  v_total_applied := _cash_amount + _balance_amount;
  v_outstanding := v_invoice.total_amount - COALESCE(v_invoice.paid_amount, 0);
  
  IF _sponsored AND v_total_applied > v_outstanding THEN
     RAISE EXCEPTION 'Overpayment not supported for sponsored invoices';
  END IF;

  IF _balance_amount > 0 THEN
    IF v_available IS NULL OR v_available < _balance_amount THEN
      RAISE EXCEPTION 'Insufficient wallet balance';
    END IF;

    PERFORM public.adjust_patient_balance(
      v_invoice.patient_id,
      -_balance_amount,
      'invoice_deduction',
      'balance',
      NULL,
      _invoice_id,
      COALESCE(_notes, format('Applied to invoice %s', v_invoice.invoice_number))
    );
  END IF;

  IF _debt_amount > 0 THEN
    PERFORM public.adjust_patient_balance(
      v_invoice.patient_id,
      -_debt_amount,
      'debt_incurred',
      _payment_method,
      NULL,
      _invoice_id,
      format('Shortfall on invoice %s', v_invoice.invoice_number)
    );
  END IF;

  IF NOT _sponsored AND v_total_applied > v_outstanding THEN
    v_overpayment := v_total_applied - v_outstanding;
    PERFORM public.adjust_patient_balance(
      v_invoice.patient_id,
      v_overpayment,
      'refund',
      _payment_method,
      NULL,
      _invoice_id,
      format('Overpayment on invoice %s', v_invoice.invoice_number)
    );
    v_total_applied := v_outstanding;
  END IF;

  UPDATE public.invoices
  SET 
    paid_amount = COALESCE(paid_amount, 0) + v_total_applied,
    payment_method = _payment_method,
    status = CASE 
      WHEN COALESCE(paid_amount, 0) + v_total_applied >= total_amount THEN 'paid' 
      ELSE 'partial' 
    END,
    updated_at = now()
  WHERE id = _invoice_id;

  RETURN jsonb_build_object(
    'success', true, 
    'applied', v_total_applied,
    'overpayment', COALESCE(v_overpayment, 0)
  );
END;
$$;
