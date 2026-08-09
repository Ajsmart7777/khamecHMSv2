CREATE OR REPLACE FUNCTION public.is_consultation_fee_required(_patient_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION public.onboard_patient_v2(
  _patient_id uuid, 
  _is_new_registration boolean, 
  _consultation_already_paid boolean, 
  _opening_debt numeric DEFAULT 0
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  _existing_pending_inv_id UUID;
BEGIN
  -- Authorization check
  IF NOT public.has_any_role(auth.uid(), ARRAY['receptionist', 'admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _p FROM public.patients WHERE id = _patient_id FOR UPDATE;
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
    SELECT id INTO _visit_id FROM public.visits WHERE patient_id = _patient_id AND status = 'active' LIMIT 1;
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
      CASE WHEN _p.account_type IN ('corporate', 'retainer', 'nhis', 'hmo', 'katchma') THEN _p.account_type ELSE NULL END,
      _p.corporate_id
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

    IF _p.status IN ('registered', 'discharged', 'awaiting_payment') THEN
        UPDATE public.patients SET status = 'registered' WHERE id = _patient_id;
    END IF;
    
    RETURN jsonb_build_object('status', 'registered');
  END IF;
END;
$function$;