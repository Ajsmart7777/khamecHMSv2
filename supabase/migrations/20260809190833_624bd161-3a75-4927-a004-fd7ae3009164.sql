-- Re-standardize create_onboarding_invoices to ensure no ambiguity
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
 SET search_path TO 'public'
 AS $$
DECLARE
  _p RECORD;
  _visit_id UUID;
  _reg_fee NUMERIC := 1000;
  _con_fee NUMERIC := 3000;
  _items JSONB := '[]'::jsonb;
  _inv_id UUID;
  _total_amount NUMERIC := 0;
  _inv_status TEXT := 'paid'; -- Default to paid if _mark_con_paid is true
BEGIN
  -- Authorization check
  IF NOT public.has_any_role(auth.uid(), ARRAY['receptionist', 'admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _p FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _p IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  -- Handle Opening Debt (one-time adjustment)
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
      CASE WHEN _p.account_type IN ('corporate', 'retainer', 'nhis', 'hmo', 'katchma') THEN _p.account_type ELSE NULL END,
      _p.corporate_id
    ) RETURNING id INTO _inv_id;

    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
    SELECT _inv_id, (val->>'description'), (val->>'quantity')::int, (val->>'unit_price')::numeric, (val->>'unit_price')::numeric, (val->>'category')
    FROM jsonb_array_elements(_items) AS val;

    RETURN jsonb_build_object('invoice_id', _inv_id, 'status', 'success');
  END IF;

  RETURN jsonb_build_object('status', 'no_charge_needed');
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_onboarding_invoices(uuid, boolean, boolean, numeric, boolean) TO authenticated;
