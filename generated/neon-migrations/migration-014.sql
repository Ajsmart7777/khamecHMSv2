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
  _inv_status TEXT := 'pending';
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

-- SOURCE: 20260809190833_624bd161-3a75-4927-a004-fd7ae3009164.sql statement 2
GRANT EXECUTE ON FUNCTION public.create_onboarding_invoices(uuid, boolean, boolean, numeric, boolean) TO authenticated;

-- SOURCE: 20260809192342_51d5b17d-2c64-4a48-a3f9-7120222c9cfa.sql statement 1
CREATE OR REPLACE FUNCTION public.check_monthly_consultation_paid(_patient_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
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
  _notes TEXT;
BEGIN
  -- Authorization check
  IF NOT public.has_any_role(auth.uid(), ARRAY['receptionist', 'admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _p FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _p IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  -- Handle Opening Debt
  IF _opening_debt > 0 THEN
    PERFORM public.adjust_patient_balance(_patient_id, -_opening_debt, 'debt_incurred', NULL, NULL, NULL, 'Opening debt');
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
      CASE WHEN _p.account_type IN ('corporate', 'retainer', 'nhis', 'hmo', 'katchma') THEN _p.account_type ELSE NULL END,
      _p.corporate_id
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
  IF NEW.status = 'paid' AND (
    EXISTS (SELECT 1 FROM public.invoice_items WHERE invoice_id = NEW.id AND category = 'registration')
  ) THEN
    UPDATE public.patients SET registration_fee_paid = true WHERE id = NEW.patient_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- SOURCE: 20260809192342_51d5b17d-2c64-4a48-a3f9-7120222c9cfa.sql statement 4
DROP TRIGGER IF EXISTS tr_update_patient_reg_status ON public.invoices;

-- SOURCE: 20260809192342_51d5b17d-2c64-4a48-a3f9-7120222c9cfa.sql statement 5
CREATE TRIGGER tr_update_patient_reg_status
AFTER UPDATE OF status ON public.invoices
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'paid')
EXECUTE FUNCTION public.update_patient_reg_status();

-- SOURCE: 20260809192342_51d5b17d-2c64-4a48-a3f9-7120222c9cfa.sql statement 6
GRANT EXECUTE ON FUNCTION public.check_monthly_consultation_paid(uuid) TO authenticated;

-- SOURCE: 20260809192342_51d5b17d-2c64-4a48-a3f9-7120222c9cfa.sql statement 7
GRANT EXECUTE ON FUNCTION public.create_onboarding_invoices(uuid, boolean, boolean, numeric, boolean) TO authenticated;

-- SOURCE: 20260810000001_robust_fee_management.sql statement 1
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'patients' AND column_name = 'registration_fee_paid') THEN
    ALTER TABLE public.patients ADD COLUMN registration_fee_paid BOOLEAN DEFAULT false;
  END IF;
END $$;

-- SOURCE: 20260810000001_robust_fee_management.sql statement 2
CREATE OR REPLACE FUNCTION public.check_monthly_consultation_paid(_patient_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
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
  _notes TEXT;
BEGIN
  -- Authorization check
  IF NOT public.has_any_role(auth.uid(), ARRAY['receptionist', 'admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _p FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _p IS NULL THEN RAISE EXCEPTION 'Patient not found'; END IF;

  -- Handle Opening Debt
  IF _opening_debt > 0 THEN
    PERFORM public.adjust_patient_balance(_patient_id, -_opening_debt, 'debt_incurred', NULL, NULL, NULL, 'Opening debt from physical card');
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
      CASE WHEN _p.account_type IN ('corporate', 'retainer', 'nhis', 'hmo', 'katchma') THEN _p.account_type ELSE NULL END,
      _p.corporate_id
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
  IF NEW.status = 'paid' THEN
    IF EXISTS (SELECT 1 FROM public.invoice_items WHERE invoice_id = NEW.id AND category = 'registration') THEN
      UPDATE public.patients SET registration_fee_paid = true WHERE id = NEW.patient_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- SOURCE: 20260810000001_robust_fee_management.sql statement 5
DROP TRIGGER IF EXISTS tr_update_patient_reg_status ON public.invoices;

-- SOURCE: 20260810000001_robust_fee_management.sql statement 6
CREATE TRIGGER tr_update_patient_reg_status
AFTER UPDATE OF status ON public.invoices
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'paid')
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
  _notes TEXT;
BEGIN
  -- Authorization check
  IF NOT public.has_any_role(auth.uid(), ARRAY['receptionist', 'admin']::app_role[]) THEN
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
    PERFORM public.adjust_patient_balance(_patient_id, -_opening_debt, 'debt_incurred', NULL, NULL, NULL, 'Opening debt from physical card');
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
      CASE WHEN _p.account_type IN ('corporate', 'retainer', 'nhis', 'hmo', 'katchma') THEN _p.account_type ELSE NULL END,
      _p.corporate_id
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
 SET search_path = public
AS $function$
BEGIN
  IF NEW.status = 'paid' AND (
    EXISTS (SELECT 1 FROM public.invoice_items WHERE invoice_id = NEW.id AND category = 'registration')
  ) THEN
    UPDATE public.patients SET registration_fee_paid = true WHERE id = NEW.patient_id;
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
SET search_path = public
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
USING (has_any_role(auth.uid(), ARRAY['billing'::app_role,'admin'::app_role]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['billing'::app_role,'admin'::app_role]));

-- SOURCE: 20260811173347_49087ad1-b070-4144-a559-819ae7369400.sql statement 1
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS dispensing_status text DEFAULT 'pending';

-- SOURCE: 20260811173347_49087ad1-b070-4144-a559-819ae7369400.sql statement 2
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS dispensing_notes text;

-- SOURCE: 20260811173347_49087ad1-b070-4144-a559-819ae7369400.sql statement 3
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS dispensing_updated_at timestamptz;

-- SOURCE: 20260811173347_49087ad1-b070-4144-a559-819ae7369400.sql statement 4
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS dispensing_updated_by uuid REFERENCES neon_auth.user(id);

-- SOURCE: 20260811173347_49087ad1-b070-4144-a559-819ae7369400.sql statement 5
CREATE OR REPLACE FUNCTION public.mark_item_unavailable(
    _item_id uuid,
    _reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
        dispensing_updated_by = auth.uid()
    WHERE id = _item_id;

    PERFORM public.write_audit_log(
        'item_marked_unavailable',
        json_build_object('item_id', _item_id, 'reason', _reason, 'description', _item_desc),
        _invoice_id,
        'invoices'
    );
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
SET search_path = public
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

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Item not eligible for refund (must be unavailable)';
    END IF;

    -- Mark as refunded
    UPDATE public.invoice_items
    SET dispensing_status = 'refunded',
        dispensing_updated_at = now(),
        dispensing_updated_by = auth.uid()
    WHERE id = _item_id;

    -- For Cash/Wallet patients, credit their balance if method is 'balance'
    IF NOT _is_sponsored AND _payment_method = 'balance' THEN
        SELECT public.adjust_patient_balance(
            _item_total,
            'Refund for unavailable: ' || _item_desc,
            _patient_id,
            'cash',
            _invoice_id,
            null,
            'topup'
        ) INTO _new_balance;
    ELSE
        SELECT balance INTO _new_balance FROM public.patients WHERE id = _patient_id;
    END IF;

    PERFORM public.write_audit_log(
        'item_refunded',
        json_build_object('item_id', _item_id, 'amount', _item_total, 'method', _payment_method, 'is_sponsored', _is_sponsored),
        _invoice_id,
        'invoices'
    );

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
SET search_path = public
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
        dispensing_updated_by = auth.uid()
    WHERE id = _item_id;

    PERFORM public.write_audit_log(
        'item_marked_unavailable',
        json_build_object('item_id', _item_id, 'reason', _reason, 'description', _item_desc),
        _invoice_id,
        'invoices'
    );
END;
$$;

-- SOURCE: 20260811173944_cac5b31b-17d6-44c5-8a4e-2c25d47783ee.sql statement 2
CREATE OR REPLACE FUNCTION public.refund_invoice_item(
    _item_id uuid,
    _payment_method text DEFAULT 'balance'
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
        dispensing_updated_by = auth.uid()
    WHERE id = _item_id;

    -- For Cash/Wallet patients, credit their balance if method is 'balance'
    IF NOT _is_sponsored AND _payment_method = 'balance' THEN
        SELECT public.adjust_patient_balance(
            _item_total,
            'Refund for unavailable: ' || _item_desc,
            _patient_id,
            'cash',
            _invoice_id,
            null,
            'topup'
        ) INTO _new_balance;
    ELSE
        SELECT balance INTO _new_balance FROM public.patients WHERE id = _patient_id;
    END IF;

    PERFORM public.write_audit_log(
        'item_refunded',
        json_build_object('item_id', _item_id, 'amount', _item_total, 'method', _payment_method, 'is_sponsored', _is_sponsored),
        _invoice_id,
        'invoices'
    );

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
SET search_path = public
AS $$
BEGIN
  -- Check if user is admin
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can check database size';
  END IF;

  RETURN QUERY
  SELECT pg_database_size(current_database()), current_database()::text;
END;
$$;

-- SOURCE: 20260811210752_e27d1688-c8fe-4222-8faa-c453cfc844fd.sql statement 2
GRANT EXECUTE ON FUNCTION public.get_database_size() TO authenticated;

-- SOURCE: 20260811210752_e27d1688-c8fe-4222-8faa-c453cfc844fd.sql statement 3
GRANT ALL ON FUNCTION public.get_database_size() TO service_role;

-- SOURCE: 20260812095912_26c52fb5-31f2-4f08-b28e-19ec631a718d.sql statement 1
CREATE OR REPLACE FUNCTION public.write_audit_log(
    _action text,
    _details jsonb,
    _resource_id uuid,
    _resource_type text,
    _status text DEFAULT 'success'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _uid uuid := auth.uid();
    _role text := public.current_actor_role(auth.uid());
BEGIN
    INSERT INTO public.audit_logs (
        user_id,
        action,
        resource_type,
        resource_id,
        details,
        status,
        actor_role
    )
    VALUES (
        _uid,
        _action,
        _resource_type,
        _resource_id::text,
        COALESCE(_details, '{}'::jsonb) || jsonb_build_object('actor_role', _role),
        _status,
        _role
    );
END;
$$;

-- SOURCE: 20260812095912_26c52fb5-31f2-4f08-b28e-19ec631a718d.sql statement 2
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text, text) TO authenticated;

-- SOURCE: 20260812095912_26c52fb5-31f2-4f08-b28e-19ec631a718d.sql statement 3
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text, text) TO service_role;

-- SOURCE: 20260812095912_26c52fb5-31f2-4f08-b28e-19ec631a718d.sql statement 4
CREATE OR REPLACE FUNCTION public.mark_item_unavailable(
    _item_id uuid,
    _reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _invoice_id uuid;
    _item_desc text;
    _current_status text;
    _is_sponsored boolean;
    _patient_id uuid;
BEGIN
    SELECT ii.invoice_id, ii.description, ii.dispensing_status, (i.sponsor_type IS NOT NULL AND i.sponsor_type != 'cash' AND i.sponsor_type != 'normal'), i.patient_id
    INTO _invoice_id, _item_desc, _current_status, _is_sponsored, _patient_id
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    WHERE ii.id = _item_id;
    
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
        dispensing_updated_by = auth.uid()
    WHERE id = _item_id;

    -- Logging with the fixed function signature
    PERFORM public.write_audit_log(
        'item_marked_unavailable',
        jsonb_build_object('item_id', _item_id, 'reason', _reason, 'description', _item_desc, 'is_sponsored', _is_sponsored),
        _invoice_id,
        'invoices'
    );
END;
$$;

-- SOURCE: 20260812103536_634902cf-779a-4c66-a1aa-3ce40683911a.sql statement 1
CREATE OR REPLACE FUNCTION public.can_add_snap_for_patient(_patient_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _status text;
  _is_admitted boolean;
  _has_lab_return boolean;
  _user_role public.app_role;
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

  -- Allow nurses to act on 'waiting' status (Queue)
  IF _status = 'waiting' THEN
    RETURN public.has_role(_user_id, 'nurse'::app_role);
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

-- SOURCE: 20260812111500_refinement_refund_flow.sql statement 1
CREATE OR REPLACE FUNCTION public.mark_item_unavailable(
    _item_id uuid,
    _reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    
    IF _current_status IN ('unavailable', 'refund_requested') THEN
        RAISE EXCEPTION 'Item is already marked as unavailable';
    END IF;

    IF _current_status = 'refunded' THEN
        RAISE EXCEPTION 'Item has already been refunded';
    END IF;
    
    UPDATE public.invoice_items
    SET dispensing_status = 'refund_requested', -- Using a more descriptive transition status
        dispensing_notes = _reason,
        dispensing_updated_at = now(),
        dispensing_updated_by = auth.uid()
    WHERE id = _item_id;

    PERFORM public.write_audit_log(
        'item_marked_unavailable',
        json_build_object('item_id', _item_id, 'reason', _reason, 'description', _item_desc),
        _invoice_id,
        'invoices'
    );
END;
$$;

-- SOURCE: 20260812111500_refinement_refund_flow.sql statement 2
CREATE OR REPLACE FUNCTION public.refund_invoice_item(
    _item_id uuid,
    _payment_method text DEFAULT 'balance'
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _item_total numeric;
    _patient_id uuid;
    _invoice_id uuid;
    _item_desc text;
    _new_balance numeric;
    _is_sponsored boolean;
    _current_status text;
    _account_type text;
BEGIN
    -- Check if eligible and current status
    SELECT ii.total, i.patient_id, ii.invoice_id, ii.description, (i.sponsor_type IS NOT NULL), ii.dispensing_status, p.account_type
    INTO _item_total, _patient_id, _invoice_id, _item_desc, _is_sponsored, _current_status, _account_type
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    JOIN public.patients p ON p.id = i.patient_id
    WHERE ii.id = _item_id;

    IF _current_status = 'refunded' THEN
        RAISE EXCEPTION 'Item has already been refunded';
    END IF;

    IF _current_status NOT IN ('unavailable', 'refund_requested') THEN
        RAISE EXCEPTION 'Item not eligible for refund (must be unavailable)';
    END IF;

    -- Mark as refunded
    UPDATE public.invoice_items
    SET dispensing_status = 'refunded',
        dispensing_updated_at = now(),
        dispensing_updated_by = auth.uid()
    WHERE id = _item_id;

    -- For Cash/Wallet patients, credit their balance if method is 'balance'
    IF NOT _is_sponsored AND _payment_method = 'balance' THEN
        SELECT public.adjust_patient_balance(
            _item_total,
            'Refund for unavailable: ' || _item_desc,
            _patient_id,
            'cash',
            _invoice_id,
            null,
            'topup'
        ) INTO _new_balance;
    ELSIF _payment_method = 'leave_in_balance' THEN
        -- Simply keep it in the patient's balance record without a specific cash refund
        -- adjust_patient_balance with 'topup' actually does exactly what is needed:
        -- it increases their credit/decreases their debt.
        SELECT public.adjust_patient_balance(
            _item_total,
            'Credit for not given item: ' || _item_desc,
            _patient_id,
            'cash',
            _invoice_id,
            null,
            'topup'
        ) INTO _new_balance;
    ELSE
        SELECT balance INTO _new_balance FROM public.patients WHERE id = _patient_id;
    END IF;

    PERFORM public.write_audit_log(
        'item_refunded',
        json_build_object('item_id', _item_id, 'amount', _item_total, 'method', _payment_method, 'is_sponsored', _is_sponsored),
        _invoice_id,
        'invoices'
    );

    RETURN json_build_object(
        'success', true,
        'amount', _item_total,
        'new_balance', _new_balance,
        'is_sponsored', _is_sponsored
    );
END;
$$;

-- SOURCE: 20260812114536_ae0b8b44-e1a8-4934-ac75-c11699ce8131.sql statement 1
DROP FUNCTION IF EXISTS public.write_audit_log(text, jsonb, uuid, text, text);

-- SOURCE: 20260812114536_ae0b8b44-e1a8-4934-ac75-c11699ce8131.sql statement 2
DROP FUNCTION IF EXISTS public.write_audit_log(text, jsonb, uuid, text);

-- SOURCE: 20260812114536_ae0b8b44-e1a8-4934-ac75-c11699ce8131.sql statement 3
CREATE OR REPLACE FUNCTION public.write_audit_log(
    _action text,
    _details jsonb,
    _resource_id uuid,
    _resource_type text,
    _status text DEFAULT 'success'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _uid uuid := auth.uid();
    _role text := public.current_actor_role(auth.uid());
BEGIN
    INSERT INTO public.audit_logs (
        user_id,
        action,
        resource_type,
        resource_id,
        details,
        status,
        actor_role
    )
    VALUES (
        _uid,
        _action,
        _resource_type,
        _resource_id::text,
        COALESCE(_details, '{}'::jsonb) || jsonb_build_object('actor_role', _role),
        _status,
        _role
    );
END;
$$;

-- SOURCE: 20260812114536_ae0b8b44-e1a8-4934-ac75-c11699ce8131.sql statement 4
CREATE OR REPLACE FUNCTION public.write_audit_log(
    _action text,
    _details jsonb,
    _resource_id uuid,
    _resource_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.write_audit_log(_action, _details, _resource_id, _resource_type, 'success');
END;
$$;

-- SOURCE: 20260812114536_ae0b8b44-e1a8-4934-ac75-c11699ce8131.sql statement 5
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text, text) TO authenticated;

-- SOURCE: 20260812114536_ae0b8b44-e1a8-4934-ac75-c11699ce8131.sql statement 6
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text, text) TO service_role;

-- SOURCE: 20260812114536_ae0b8b44-e1a8-4934-ac75-c11699ce8131.sql statement 7
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text) TO authenticated;

-- SOURCE: 20260812114536_ae0b8b44-e1a8-4934-ac75-c11699ce8131.sql statement 8
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text) TO service_role;

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 1
DROP FUNCTION IF EXISTS public.write_audit_log(text, jsonb, uuid, text, text);

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 2
DROP FUNCTION IF EXISTS public.write_audit_log(text, jsonb, uuid, text);

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 3
DROP FUNCTION IF EXISTS public.write_audit_log(text, json, uuid, text);

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 4
DROP FUNCTION IF EXISTS public.write_audit_log(text, json, uuid, text, text);

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 5
CREATE OR REPLACE FUNCTION public.write_audit_log(
    _action text,
    _details jsonb,
    _resource_id uuid,
    _resource_type text,
    _status text DEFAULT 'success'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _uid uuid := auth.uid();
    _role text := public.current_actor_role(auth.uid());
BEGIN
    INSERT INTO public.audit_logs (
        user_id,
        action,
        resource_type,
        resource_id,
        details,
        status,
        actor_role
    )
    VALUES (
        _uid,
        _action,
        _resource_type,
        _resource_id::text,
        COALESCE(_details, '{}'::jsonb) || jsonb_build_object('actor_role', _role),
        _status,
        _role
    );
END;
$$;

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 6
CREATE OR REPLACE FUNCTION public.write_audit_log(
    _action text,
    _details jsonb,
    _resource_id uuid,
    _resource_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.write_audit_log(_action, _details, _resource_id, _resource_type, 'success');
END;
$$;

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 7
CREATE OR REPLACE FUNCTION public.write_audit_log(
    _action text,
    _details json,
    _resource_id uuid,
    _resource_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.write_audit_log(_action, _details::jsonb, _resource_id, _resource_type, 'success');
END;
$$;

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 8
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text, text) TO authenticated;

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 9
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text, text) TO service_role;

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 10
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text) TO authenticated;

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 11
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text) TO service_role;

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 12
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, json, uuid, text) TO authenticated;

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 13
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, json, uuid, text) TO service_role;

-- SOURCE: 20260812122943_48d71143-8402-4d9d-9abe-21f127aede20.sql statement 1
-- Drop existing variants to ensure clean state
DROP FUNCTION IF EXISTS public.adjust_patient_balance(uuid, numeric, text, text, uuid, uuid, text);

-- SOURCE: 20260812122943_48d71143-8402-4d9d-9abe-21f127aede20.sql statement 2
CREATE OR REPLACE FUNCTION public.adjust_patient_balance(
    _patient_id uuid,
    _delta numeric,
    _transaction_type text,
    _payment_method text DEFAULT NULL::text,
    _related_request_id uuid DEFAULT NULL::uuid,
    _related_invoice_id uuid DEFAULT NULL::uuid,
    _notes text DEFAULT NULL::text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _before NUMERIC;
  _after NUMERIC;
BEGIN
  SELECT balance INTO _before FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _before IS NULL THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;
  
  _after := _before + _delta;
  
  -- Only 'debt_incurred' transactions may push balance negative
  IF _after < 0 AND _transaction_type <> 'debt_incurred' THEN
    RAISE EXCEPTION 'Insufficient balance (current: %, requested delta: %)', _before, _delta;
  END IF;

  -- Bypass the RLS trigger if it exists
  PERFORM set_config('app.allow_balance_write', 'on', true);
  UPDATE public.patients SET balance = _after, updated_at = now() WHERE id = _patient_id;
  PERFORM set_config('app.allow_balance_write', 'off', true);

  INSERT INTO public.balance_transactions
    (patient_id, transaction_type, amount, balance_before, balance_after, payment_method, related_request_id, related_invoice_id, performed_by, notes)
  VALUES
    (_patient_id, _transaction_type, _delta, _before, _after, _payment_method, _related_request_id, _related_invoice_id, auth.uid(), _notes);

  RETURN _after;
END;
$$;
