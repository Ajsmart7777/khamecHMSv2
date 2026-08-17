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

AS $$
DECLARE
    _uid uuid := public.hms_current_user_id();
    _role text := public.current_actor_role(public.hms_current_user_id());
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
        dispensing_updated_by = public.hms_current_user_id()
    WHERE id = _item_id;

    -- Logging with the fixed function signature
    SELECT public.write_audit_log(
        'item_marked_unavailable',
        jsonb_build_object('item_id', _item_id, 'reason', _reason, 'description', _item_desc, 'is_sponsored', _is_sponsored),
        _invoice_id,
        'invoices', 'success');
END;
$$;

-- SOURCE: 20260812103536_634902cf-779a-4c66-a1aa-3ce40683911a.sql statement 1
CREATE OR REPLACE FUNCTION public.can_add_snap_for_patient(_patient_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER

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
        dispensing_updated_by = public.hms_current_user_id()
    WHERE id = _item_id;

    SELECT public.write_audit_log('item_marked_unavailable', 'invoice', _invoice_id::text, jsonb_build_object('item_id', _item_id, 'reason', _reason, 'description', _item_desc), 'success');
END;
$$;

-- SOURCE: 20260812111500_refinement_refund_flow.sql statement 2
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
    ELSIF _payment_method = 'leave_in_balance' THEN
        -- Simply keep it in the patient's balance record without a specific cash refund
        -- adjust_patient_balance with 'topup' actually does exactly what is needed:
        -- it increases their credit/decreases their debt.
        SELECT public.adjust_patient_balance(
            _patient_id,
            _item_total,
            'topup',
            'cash',
            NULL,
            _invoice_id,
            'Credit for not given item: ' || _item_desc
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

-- SOURCE: 20260812114536_ae0b8b44-e1a8-4934-ac75-c11699ce8131.sql statement 1
SELECT 1;

-- SOURCE: 20260812114536_ae0b8b44-e1a8-4934-ac75-c11699ce8131.sql statement 2
SELECT 1;

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

AS $$
DECLARE
    _uid uuid := public.hms_current_user_id();
    _role text := public.current_actor_role(public.hms_current_user_id());
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
CREATE OR REPLACE FUNCTION public.write_audit_log(_action text, _details jsonb, _resource_id uuid, _resource_type text
, 'success')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
BEGIN
    SELECT public.write_audit_log(_action, _details, _resource_id, _resource_type, 'success');
END;
$$;

-- SOURCE: 20260812114536_ae0b8b44-e1a8-4934-ac75-c11699ce8131.sql statement 5
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text, text) TO authenticated;

-- SOURCE: 20260812114536_ae0b8b44-e1a8-4934-ac75-c11699ce8131.sql statement 6
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text, text) TO service_role;

-- SOURCE: 20260812114536_ae0b8b44-e1a8-4934-ac75-c11699ce8131.sql statement 7
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text, 'success') TO authenticated;

-- SOURCE: 20260812114536_ae0b8b44-e1a8-4934-ac75-c11699ce8131.sql statement 8
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text, 'success') TO service_role;

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 1
SELECT 1;

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 2
SELECT 1;

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 3
SELECT 1;

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 4
SELECT 1;

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

AS $$
DECLARE
    _uid uuid := public.hms_current_user_id();
    _role text := public.current_actor_role(public.hms_current_user_id());
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
CREATE OR REPLACE FUNCTION public.write_audit_log(_action text, _details jsonb, _resource_id uuid, _resource_type text
, 'success')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
BEGIN
    SELECT public.write_audit_log(_action, _details, _resource_id, _resource_type, 'success');
END;
$$;

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 7
CREATE OR REPLACE FUNCTION public.write_audit_log(_action text, _details json, _resource_id uuid, _resource_type text
, 'success')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
BEGIN
    SELECT public.write_audit_log(_action, _details::jsonb, _resource_id, _resource_type, 'success');
END;
$$;

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 8
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text, text) TO authenticated;

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 9
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text, text) TO service_role;

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 10
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text, 'success') TO authenticated;

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 11
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text, 'success') TO service_role;

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 12
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, json, uuid, text, 'success') TO authenticated;

-- SOURCE: 20260812120000_fix_audit_log_overloading.sql statement 13
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, json, uuid, text, 'success') TO service_role;

-- SOURCE: 20260812122943_48d71143-8402-4d9d-9abe-21f127aede20.sql statement 1
-- Drop existing variants to ensure clean state
SELECT 1;

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
  SELECT set_config('app.allow_balance_write', 'on', true);
  UPDATE public.patients SET balance = _after, updated_at = now() WHERE id = _patient_id;
  SELECT set_config('app.allow_balance_write', 'off', true);

  INSERT INTO public.balance_transactions
    (patient_id, transaction_type, amount, balance_before, balance_after, payment_method, related_request_id, related_invoice_id, performed_by, notes)
  VALUES
    (_patient_id, _transaction_type, _delta, _before, _after, _payment_method, _related_request_id, _related_invoice_id, public.hms_current_user_id(), _notes);

  RETURN _after;
END;
$$;

-- SOURCE: 20260812122943_48d71143-8402-4d9d-9abe-21f127aede20.sql statement 3
GRANT EXECUTE ON FUNCTION public.adjust_patient_balance(uuid, numeric, text, text, uuid, uuid, text) TO authenticated, service_role;

-- SOURCE: 20260812122943_48d71143-8402-4d9d-9abe-21f127aede20.sql statement 4
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

    IF _current_status NOT IN ('unavailable', 'refund_requested', 'refund_pending') THEN
        RAISE EXCEPTION 'Item not eligible for refund (current status: %)', _current_status;
    END IF;

    -- Mark as refunded
    UPDATE public.invoice_items
    SET dispensing_status = 'refunded',
        dispensing_updated_at = now(),
        dispensing_updated_by = public.hms_current_user_id()
    WHERE id = _item_id;

    -- For Cash/Wallet patients, credit their balance if method is 'balance' or 'leave_in_balance'
    IF NOT _is_sponsored AND (_payment_method = 'balance' OR _payment_method = 'leave_in_balance') THEN
        -- Corrected call order: patient_id, delta, type, method, request, invoice, notes
        SELECT public.adjust_patient_balance(
            _patient_id,
            _item_total,
            'topup',
            'cash',
            null,
            _invoice_id,
            'Refund for not given item: ' || _item_desc
        ) INTO _new_balance;
    ELSE
        SELECT balance INTO _new_balance FROM public.patients WHERE id = _patient_id;
    END IF;

    SELECT public.write_audit_log(
        'item_refunded',
        jsonb_build_object('item_id', _item_id, 'amount', _item_total, 'method', _payment_method, 'is_sponsored', _is_sponsored),
        _invoice_id,
        'invoices', 'success');

    RETURN json_build_object(
        'success', true,
        'amount', _item_total,
        'new_balance', _new_balance,
        'is_sponsored', _is_sponsored
    );
END;
$$;

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 1
SELECT 1;

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 2
SELECT 1;

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 3
SELECT 1;

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 4
SELECT 1;

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 5
SELECT 1;

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 6
CREATE OR REPLACE FUNCTION public.write_audit_log(
    _action text,
    _details jsonb,
    _resource_id text,
    _resource_type text,
    _status text DEFAULT 'success'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
    _uid uuid := public.hms_current_user_id();
    _role text := public.current_actor_role(public.hms_current_user_id());
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
        _resource_id,
        COALESCE(_details, '{}'::jsonb) || jsonb_build_object('actor_role', _role),
        _status,
        _role
    );
END;
$$;

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 7
CREATE OR REPLACE FUNCTION public.write_audit_log(
    _action text,
    _resource_type text,
    _resource_id text,
    _details jsonb,
    _status text DEFAULT 'success'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
BEGIN
    SELECT public.write_audit_log(_action, _details, _resource_id, _resource_type, _status);
END;
$$;

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 8
CREATE OR REPLACE FUNCTION public.write_audit_log(_action text, _resource_type text, _resource_id text, _details jsonb
, 'success')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
BEGIN
    SELECT public.write_audit_log(_action, _details, _resource_id, _resource_type, 'success');
END;
$$;

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 9
CREATE OR REPLACE FUNCTION public.write_audit_log(_action text, _details jsonb, _resource_id uuid, _resource_type text
, 'success')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
BEGIN
    SELECT public.write_audit_log(_action, _details, _resource_id::text, _resource_type, 'success');
END;
$$;

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 10
CREATE OR REPLACE FUNCTION public.write_audit_log(_action text, _details json, _resource_id uuid, _resource_type text
, 'success')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
BEGIN
    SELECT public.write_audit_log(_action, _details::jsonb, _resource_id::text, _resource_type, 'success');
END;
$$;

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 11
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, text, text, text) TO authenticated, service_role;

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 12
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, text, text, jsonb, text) TO authenticated, service_role;

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 13
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, text, text, jsonb, 'success') TO authenticated, service_role;

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 14
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text, 'success') TO authenticated, service_role;

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 15
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, json, uuid, text, 'success') TO authenticated, service_role;

-- SOURCE: 20260812155154_5dd01833-c0d7-496a-aded-c8a28deedf3f.sql statement 1
CREATE OR REPLACE FUNCTION public.calculate_payroll_deductions(
    _staff_id uuid,
    _period_start date,
    _period_end date
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
    _total numeric;
BEGIN
    SELECT COALESCE(SUM(paid_amount), 0)
    INTO _total
    FROM public.invoices
    WHERE staff_sponsor_id = _staff_id
      AND is_salary_deduction = true
      AND status = 'paid'
      AND paid_at::date >= _period_start
      AND paid_at::date <= _period_end;
      
    RETURN _total;
END;
$$;

-- SOURCE: 20260812155154_5dd01833-c0d7-496a-aded-c8a28deedf3f.sql statement 2
GRANT EXECUTE ON FUNCTION public.calculate_payroll_deductions(uuid, date, date) TO authenticated;

-- SOURCE: 20260812155154_5dd01833-c0d7-496a-aded-c8a28deedf3f.sql statement 3
GRANT EXECUTE ON FUNCTION public.calculate_payroll_deductions(uuid, date, date) TO service_role;

-- SOURCE: 20260812160000_payroll_family_deductions.sql statement 1
CREATE OR REPLACE FUNCTION public.calculate_payroll_deductions(
    _staff_id uuid,
    _period_start date,
    _period_end date
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
    _total numeric;
BEGIN
    SELECT COALESCE(SUM(paid_amount), 0)
    INTO _total
    FROM public.invoices
    WHERE staff_sponsor_id = _staff_id
      AND is_salary_deduction = true
      AND status = 'paid'
      -- Only count invoices paid within the specified period
      AND paid_at::date >= _period_start
      AND paid_at::date <= _period_end;
      
    RETURN _total;
END;
$$;

-- SOURCE: 20260812160000_payroll_family_deductions.sql statement 2
GRANT EXECUTE ON FUNCTION public.calculate_payroll_deductions(uuid, date, date) TO authenticated;

-- SOURCE: 20260812160000_payroll_family_deductions.sql statement 3
GRANT EXECUTE ON FUNCTION public.calculate_payroll_deductions(uuid, date, date) TO service_role;

-- SOURCE: 20260812163043_50700de6-7a1a-4cea-87b9-296186073bfa.sql statement 1
CREATE TABLE public.staff_deduction_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number text NOT NULL,
  period_month integer,
  period_year integer,
  total_amount numeric NOT NULL DEFAULT 0,
  staff_count integer NOT NULL DEFAULT 0,
  invoice_count integer NOT NULL DEFAULT 0,
  notes text,
  closed_by uuid,
  closed_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- SOURCE: 20260812163043_50700de6-7a1a-4cea-87b9-296186073bfa.sql statement 2
GRANT SELECT, INSERT, UPDATE ON public.staff_deduction_batches TO authenticated;

-- SOURCE: 20260812163043_50700de6-7a1a-4cea-87b9-296186073bfa.sql statement 3
GRANT ALL ON public.staff_deduction_batches TO service_role;

-- SOURCE: 20260812163043_50700de6-7a1a-4cea-87b9-296186073bfa.sql statement 4
ALTER TABLE public.staff_deduction_batches ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260812163043_50700de6-7a1a-4cea-87b9-296186073bfa.sql statement 5
CREATE POLICY "Staff can view deduction batches"
ON public.staff_deduction_batches FOR SELECT TO authenticated
USING (public.is_authenticated_staff());

-- SOURCE: 20260812163043_50700de6-7a1a-4cea-87b9-296186073bfa.sql statement 6
CREATE POLICY "Accountants can create deduction batches"
ON public.staff_deduction_batches FOR INSERT TO authenticated
WITH CHECK (public.has_any_role(public.hms_current_user_id(), ARRAY['admin','accountant']::public.app_role[]));

-- SOURCE: 20260812163043_50700de6-7a1a-4cea-87b9-296186073bfa.sql statement 7
CREATE POLICY "Accountants can update deduction batches"
ON public.staff_deduction_batches FOR UPDATE TO authenticated
USING (public.has_any_role(public.hms_current_user_id(), ARRAY['admin','accountant']::public.app_role[]))
WITH CHECK (public.has_any_role(public.hms_current_user_id(), ARRAY['admin','accountant']::public.app_role[]));
