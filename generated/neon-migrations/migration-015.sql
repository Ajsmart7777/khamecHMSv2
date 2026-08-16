-- SOURCE: 20260812122943_48d71143-8402-4d9d-9abe-21f127aede20.sql statement 3
GRANT EXECUTE ON FUNCTION public.adjust_patient_balance(uuid, numeric, text, text, uuid, uuid, text) TO authenticated, service_role;

-- SOURCE: 20260812122943_48d71143-8402-4d9d-9abe-21f127aede20.sql statement 4
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

    IF _current_status NOT IN ('unavailable', 'refund_requested', 'refund_pending') THEN
        RAISE EXCEPTION 'Item not eligible for refund (current status: %)', _current_status;
    END IF;

    -- Mark as refunded
    UPDATE public.invoice_items
    SET dispensing_status = 'refunded',
        dispensing_updated_at = now(),
        dispensing_updated_by = auth.uid()
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

    PERFORM public.write_audit_log(
        'item_refunded',
        jsonb_build_object('item_id', _item_id, 'amount', _item_total, 'method', _payment_method, 'is_sponsored', _is_sponsored),
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

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 1
DROP FUNCTION IF EXISTS public.write_audit_log(text, text, text, jsonb, text);

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 2
DROP FUNCTION IF EXISTS public.write_audit_log(text, jsonb, uuid, text, text);

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 3
DROP FUNCTION IF EXISTS public.write_audit_log(text, jsonb, uuid, text);

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 4
DROP FUNCTION IF EXISTS public.write_audit_log(text, json, uuid, text);

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 5
DROP FUNCTION IF EXISTS public.write_audit_log(text, json, uuid, text, text);

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
    _status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.write_audit_log(_action, _details, _resource_id, _resource_type, _status);
END;
$$;

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 8
CREATE OR REPLACE FUNCTION public.write_audit_log(
    _action text,
    _resource_type text,
    _resource_id text,
    _details jsonb
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

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 9
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
    PERFORM public.write_audit_log(_action, _details, _resource_id::text, _resource_type, 'success');
END;
$$;

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 10
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
    PERFORM public.write_audit_log(_action, _details::jsonb, _resource_id::text, _resource_type, 'success');
END;
$$;

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 11
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, text, text, text) TO authenticated, service_role;

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 12
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, text, text, jsonb, text) TO authenticated, service_role;

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 13
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, text, text, jsonb) TO authenticated, service_role;

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 14
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text) TO authenticated, service_role;

-- SOURCE: 20260812131324_4b16087a-7202-4725-94f6-da894ab33b08.sql statement 15
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, json, uuid, text) TO authenticated, service_role;

-- SOURCE: 20260812155154_5dd01833-c0d7-496a-aded-c8a28deedf3f.sql statement 1
CREATE OR REPLACE FUNCTION public.calculate_payroll_deductions(
    _staff_id uuid,
    _period_start date,
    _period_end date
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
SET search_path = public
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
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::public.app_role[]));

-- SOURCE: 20260812163043_50700de6-7a1a-4cea-87b9-296186073bfa.sql statement 7
CREATE POLICY "Accountants can update deduction batches"
ON public.staff_deduction_batches FOR UPDATE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::public.app_role[]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::public.app_role[]));

-- SOURCE: 20260812163043_50700de6-7a1a-4cea-87b9-296186073bfa.sql statement 8
ALTER TABLE public.invoices
  ADD COLUMN salary_deduction_batch_id uuid REFERENCES public.staff_deduction_batches(id);

-- SOURCE: 20260812163043_50700de6-7a1a-4cea-87b9-296186073bfa.sql statement 9
CREATE INDEX idx_invoices_salary_deduction_batch
  ON public.invoices (salary_deduction_batch_id)
  WHERE is_salary_deduction = true;

-- SOURCE: 20260812163043_50700de6-7a1a-4cea-87b9-296186073bfa.sql statement 10
CREATE OR REPLACE FUNCTION public.close_family_deduction_batch(
  _invoice_ids uuid[],
  _period_month integer DEFAULT NULL,
  _period_year integer DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _batch_id uuid;
  _total numeric := 0;
  _staff_count integer := 0;
  _invoice_count integer := 0;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'Only accountants or admins can close a deduction cycle';
  END IF;

  IF _invoice_ids IS NULL OR array_length(_invoice_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No bills selected to close';
  END IF;

  SELECT COALESCE(SUM(paid_amount), 0), COUNT(DISTINCT staff_sponsor_id), COUNT(*)
    INTO _total, _staff_count, _invoice_count
  FROM public.invoices
  WHERE id = ANY(_invoice_ids)
    AND is_salary_deduction = true
    AND salary_deduction_batch_id IS NULL;

  IF _invoice_count = 0 THEN
    RAISE EXCEPTION 'These bills have already been closed into a batch';
  END IF;

  INSERT INTO public.staff_deduction_batches (
    batch_number, period_month, period_year, total_amount,
    staff_count, invoice_count, notes, closed_by
  ) VALUES (
    'FD-' || to_char(now(), 'YYYYMMDD-HH24MISS'),
    _period_month, _period_year, _total,
    _staff_count, _invoice_count, _notes, auth.uid()
  ) RETURNING id INTO _batch_id;

  UPDATE public.invoices
  SET salary_deduction_batch_id = _batch_id
  WHERE id = ANY(_invoice_ids)
    AND is_salary_deduction = true
    AND salary_deduction_batch_id IS NULL;

  RETURN _batch_id;
END;
$$;

-- SOURCE: 20260812163043_50700de6-7a1a-4cea-87b9-296186073bfa.sql statement 11
GRANT EXECUTE ON FUNCTION public.close_family_deduction_batch(uuid[], integer, integer, text) TO authenticated;

-- SOURCE: 20260812163059_189dfa0f-11ff-4aa3-abfe-de01308229cb.sql statement 1
REVOKE EXECUTE ON FUNCTION public.close_family_deduction_batch(uuid[], integer, integer, text) FROM PUBLIC, anon;

-- SOURCE: 20260812163059_189dfa0f-11ff-4aa3-abfe-de01308229cb.sql statement 2
GRANT EXECUTE ON FUNCTION public.close_family_deduction_batch(uuid[], integer, integer, text) TO authenticated;

-- SOURCE: 20260812170000_observation_fee_logic.sql statement 1
-- 1. Update admission_bed_charge function
-- A "night" only counts if the patient was still admitted when the next calendar day started (past midnight).
-- Nights = (discharge_date::date - admitted_date::date)
-- If nights = 0 -> observation only = 3000 flat (daily_rate = 3000, days = 0, amount = 3000)
-- If nights >= 1 -> nights * daily_rate (days = nights, daily_rate = room.daily_rate, amount = nights * daily_rate)

CREATE OR REPLACE FUNCTION public.admission_bed_charge(_admission_id uuid)
 RETURNS TABLE(days integer, daily_rate numeric, amount numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD;
  _rate numeric;
  _nights int;
  _amount numeric;
BEGIN
  SELECT a.*, r.daily_rate AS room_daily_rate INTO _adm
  FROM public.admissions a
  LEFT JOIN public.beds b ON b.id = a.bed_id
  LEFT JOIN public.rooms r ON r.id = b.room_id
  WHERE a.id = _admission_id;

  IF _adm IS NULL THEN
    RETURN QUERY SELECT 0, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  _nights := GREATEST(0, (COALESCE(_adm.discharged_at, now())::date - COALESCE(_adm.admitted_at, _adm.created_at)::date))::int;

  IF _nights = 0 THEN
    RETURN QUERY SELECT 0, 3000::numeric, 3000::numeric;
  ELSE
    _rate := COALESCE(_adm.room_daily_rate, 0)::numeric;
    _amount := ROUND(_nights * _rate, 2)::numeric;
    RETURN QUERY SELECT _nights, _rate, _amount;
  END IF;
END;
$function$;

-- SOURCE: 20260812170000_observation_fee_logic.sql statement 2
REVOKE ALL ON FUNCTION public.admission_bed_charge(uuid) FROM PUBLIC, anon;

-- SOURCE: 20260812170000_observation_fee_logic.sql statement 3
GRANT EXECUTE ON FUNCTION public.admission_bed_charge(uuid) TO authenticated, service_role;

-- SOURCE: 20260812170000_observation_fee_logic.sql statement 4
CREATE OR REPLACE FUNCTION public.bill_admission_bed_days(_admission_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD;
  _p RECORD;
  _room RECORD;
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
  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id;
  IF _adm IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id;
  IF _p IS NULL THEN RETURN NULL; END IF;

  SELECT d.days, d.daily_rate, d.amount INTO _days, _rate, _amount
  FROM public.admission_bed_charge(_admission_id) d;

  IF COALESCE(_amount, 0) <= 0 THEN RETURN NULL; END IF;

  SELECT id INTO _inv FROM public.invoices
  WHERE patient_id = _adm.patient_id
    AND notes = 'BED_DAYS:' || _admission_id::text
  LIMIT 1;
  IF _inv IS NOT NULL THEN RETURN _inv; END IF;

  _pct := public.copay_percent(_p.account_type, _p.insurance_plan);
  _copay := ROUND(_amount * _pct / 100.0, 2);

  SELECT r.room_number, r.room_class INTO _room
  FROM public.beds b JOIN public.rooms r ON r.id = b.room_id
  WHERE b.id = _adm.bed_id;

  INSERT INTO public.invoices (
    patient_id, visit_id, total_amount, original_amount, discount_amount,
    paid_amount, status, sponsor_type, corporate_account_id, notes
  ) VALUES (
    _adm.patient_id, _adm.visit_id, _amount, _amount, 0,
    0, 'pending',
    CASE WHEN _pct < 100 THEN _p.account_type ELSE NULL END,
    _p.corporate_id,
    'BED_DAYS:' || _admission_id::text
  ) RETURNING id INTO _inv;

  IF _days = 0 THEN
    _item_desc := 'Observation fee (same-day discharge)';
  else
    _item_desc := 'Bed charge - ' || COALESCE(_room.room_class, 'ward') || ' - ' || _days || ' night(s)';
  END IF;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, category)
  VALUES (
    _inv,
    _item_desc,
    CASE WHEN _days = 0 THEN 1 ELSE _days END,
    _rate, _amount, 'admission'
  );

  IF _copay > 0 THEN
    SELECT balance INTO _bal FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
    _from_wallet := ROUND(LEAST(GREATEST(COALESCE(_bal,0), 0), _copay), 2);
    _debt := ROUND(_copay - _from_wallet, 2);

    IF _from_wallet > 0 THEN
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, -_from_wallet, 'invoice_payment', NULL, NULL, _inv,
        CASE WHEN _days = 0 THEN 'Observation fee for admission' ELSE 'Bed charge for admission (' || _days || ' night(s))' END
      );
    END IF;

    IF _debt > 0 THEN
      PERFORM public.adjust_patient_balance(
        _adm.patient_id, -_debt, 'debt_incurred', NULL, NULL, _inv,
        CASE WHEN _days = 0 THEN 'Observation fee shortfall on discharge' ELSE 'Bed charge shortfall on discharge (' || _days || ' night(s))' END
      );
    END IF;

    UPDATE public.invoices
      SET paid_amount = _from_wallet,
          status = CASE WHEN _from_wallet >= _amount THEN 'paid'
                        WHEN _from_wallet > 0 THEN 'partial'
                        ELSE 'pending' END,
          paid_at = CASE WHEN _from_wallet >= _amount THEN now() ELSE NULL END
      WHERE id = _inv;
  END IF;

  RETURN _inv;
END;
$function$;

-- SOURCE: 20260812170000_observation_fee_logic.sql statement 5
REVOKE ALL ON FUNCTION public.bill_admission_bed_days(uuid) FROM PUBLIC, anon;

-- SOURCE: 20260812170000_observation_fee_logic.sql statement 6
GRANT EXECUTE ON FUNCTION public.bill_admission_bed_days(uuid) TO authenticated, service_role;

-- SOURCE: 20260812170000_observation_fee_logic.sql statement 7
CREATE OR REPLACE FUNCTION public.admission_discharge_preview(_admission_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD;
  _p RECORD;
  _nights int; _rate numeric; _bed_total numeric;
  _pct numeric; _share numeric; _covered numeric;
  _bal numeric; _prior numeric; _already boolean;
  _due numeric; _after numeric;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
       ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','cashier','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id;

  SELECT d.days, d.daily_rate, d.amount INTO _nights, _rate, _bed_total
  FROM public.admission_bed_charge(_admission_id) d;

  _pct := public.copay_percent(_p.account_type, _p.insurance_plan);
  _share := ROUND(COALESCE(_bed_total,0) * _pct / 100.0, 2);
  _covered := ROUND(GREATEST(0, COALESCE(_bed_total,0) - _share), 2);

  SELECT EXISTS (
    SELECT 1 FROM public.invoices
    WHERE patient_id = _adm.patient_id
      AND notes = 'BED_DAYS:' || _admission_id::text
  ) INTO _already;

  IF _already THEN
    _share := 0; _covered := 0;
  END IF;

  _bal := COALESCE(_p.balance, 0);
  _prior := ROUND(GREATEST(0, -_bal), 2);
  _after := ROUND(_bal - _share, 2);
  _due := ROUND(GREATEST(0, -_after), 2);

  RETURN jsonb_build_object(
    'admission_id', _admission_id,
    'patient_id', _adm.patient_id,
    'admitted_at', COALESCE(_adm.admitted_at, _adm.created_at),
    'nights', COALESCE(_nights, 0),
    'daily_rate', COALESCE(_rate, 0),
    'bed_total', COALESCE(_bed_total, 0),
    'bed_already_billed', _already,
    'copay_pct', _pct,
    'sponsor_covered', _covered,
    'bed_patient_share', _share,
    'current_balance', _bal,
    'prior_outstanding', _prior,
    'total_due', _due,
    'balance_after_bed', _after
  );
END;
$function$;

-- SOURCE: 20260812170000_observation_fee_logic.sql statement 8
REVOKE ALL ON FUNCTION public.admission_discharge_preview(uuid) FROM PUBLIC, anon;

-- SOURCE: 20260812170000_observation_fee_logic.sql statement 9
GRANT EXECUTE ON FUNCTION public.admission_discharge_preview(uuid) TO authenticated, service_role;

-- SOURCE: 20260812203000_fix_discharge_preview.sql statement 1
CREATE OR REPLACE FUNCTION public.admission_discharge_preview(_admission_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD; _p RECORD;
  _nights int; _rate numeric; _bed_total numeric;
  _pct numeric; _share numeric; _covered numeric;
  _bal numeric; _prior numeric; _already boolean;
  _gross numeric; _credit numeric; _applied numeric; _due numeric;
  _wallet boolean;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
       ARRAY['nurse','doctor','doctor1','doctor2','billing','accountant','cashier','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id;

  SELECT d.days, d.daily_rate, d.amount INTO _nights, _rate, _bed_total
  FROM public.admission_bed_charge(_admission_id) d;

  _pct := public.copay_percent(_p.account_type, _p.insurance_plan);
  _share := ROUND(COALESCE(_bed_total,0) * _pct / 100.0, 2);
  _covered := ROUND(GREATEST(0, COALESCE(_bed_total,0) - _share), 2);

  SELECT EXISTS (SELECT 1 FROM public.invoices
    WHERE patient_id = _adm.patient_id AND notes = 'BED_DAYS:' || _admission_id::text) INTO _already;
  IF _already THEN _share := 0; _covered := 0; END IF;

  _wallet := public.has_wallet(_p.account_type);
  _bal    := COALESCE(_p.balance,0);
  _prior  := public.patient_outstanding(_adm.patient_id);
  _gross  := ROUND(_prior + _share, 2);

  _credit  := CASE WHEN _wallet THEN ROUND(GREATEST(_bal,0),2) ELSE 0 END;
  _applied := ROUND(LEAST(_credit, _gross), 2);
  _due     := ROUND(GREATEST(0, _gross - _applied), 2);

  RETURN jsonb_build_object(
    'admission_id', _admission_id,
    'patient_id', _adm.patient_id,
    'admitted_at', COALESCE(_adm.admitted_at, _adm.created_at),
    'account_type', _p.account_type,
    'insurance_plan', _p.insurance_plan,
    'has_wallet', _wallet,
    'nights', COALESCE(_nights,0),
    'daily_rate', COALESCE(_rate,0),
    'bed_total', COALESCE(_bed_total,0),
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
$function$;

-- SOURCE: 20260812210500_add_salary_deduction_method.sql statement 1
CREATE OR REPLACE FUNCTION public.discharge_admission(_admission_id uuid, _notes text DEFAULT NULL::text, _settlement_method text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0, _settlement_notes text DEFAULT NULL::text, _refund_amount numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD; _p RECORD; _wallet boolean;
  _debt numeric; _collected numeric := 0; _remaining numeric := 0;
  _inv RECORD; _apply numeric; _left numeric; _pct numeric; _share numeric;
  _wallet_used numeric := 0; _refund numeric := 0; _credit numeric := 0;
  _debt_cleared numeric := 0;
  _got_lock boolean;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
       ARRAY['cashier','billing','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only the cashier can settle and complete a discharge';
  END IF;

  _got_lock := pg_catalog.pg_try_advisory_xact_lock(
                 pg_catalog.hashtextextended('discharge_admission:' || _admission_id::text, 0));
  IF NOT _got_lock THEN
    RAISE EXCEPTION 'DISCHARGE_IN_PROGRESS: this discharge is already being settled — refresh the queue';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;

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

  _wallet_used := public.apply_wallet_to_outstanding(_adm.patient_id, 'Balance applied at discharge');

  SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
  _wallet := public.has_wallet(_p.account_type);
  _pct    := public.copay_percent(_p.account_type, _p.insurance_plan);
  _debt   := public.patient_outstanding(_adm.patient_id);
  _remaining := _debt;

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash','pos','transfer') THEN
      _collected := ROUND(GREATEST(COALESCE(_settlement_amount,0),0), 2);
      IF _collected <= 0 THEN RAISE EXCEPTION 'Settlement amount must be greater than zero'; END IF;
      IF _wallet AND _p.balance < 0 THEN
        _debt_cleared := ROUND(LEAST(_collected, -_p.balance), 2);
        PERFORM public.adjust_patient_balance(
          _adm.patient_id, _debt_cleared, 'debt_cleared', _settlement_method,
          NULL, NULL, COALESCE(_settlement_notes,'Discharge settlement'));
      END IF;
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
      IF _remaining > 0 THEN
        PERFORM public.write_audit_log('discharge_partial_settlement','admission',_admission_id::text,
          jsonb_build_object('patient_id',_adm.patient_id,'debt',_debt,'collected',_collected,
                             'outstanding',_remaining,'method',_settlement_method,'notes',_settlement_notes));
      END IF;

    ELSIF _settlement_method = 'salary' THEN
      IF _p.staff_link_id IS NULL THEN
        RAISE EXCEPTION 'STAFF_LINK_REQUIRED: this patient is not linked to any staff member for salary deduction';
      END IF;
      _remaining := 0;
      PERFORM public.write_audit_log('salary_deduction_on_discharge','admission',_admission_id::text,
        jsonb_build_object('patient_id',_adm.patient_id,'debt',_debt,'staff_id',_p.staff_link_id,'notes',_settlement_notes));

    ELSIF _settlement_method = 'carry' THEN
      PERFORM public.write_audit_log('debt_carried_on_discharge','admission',_admission_id::text,
        jsonb_build_object('patient_id',_adm.patient_id,'debt',_debt,'notes',_settlement_notes));
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  -- Money/Credit to apply to invoices
  _left := CASE WHEN _settlement_method IN ('cash','pos','transfer')
                THEN ROUND(GREATEST(0, _collected - _debt_cleared), 2)
                WHEN _settlement_method = 'salary' THEN _debt
                ELSE 0 END;

  IF _left > 0 THEN
    FOR _inv IN
      SELECT id, total_amount, COALESCE(paid_amount,0) AS paid
      FROM public.invoices
      WHERE patient_id = _adm.patient_id AND status IN ('pending','partial')
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN _left <= 0;
      _share := ROUND(_inv.total_amount * _pct / 100.0, 2);
      _apply := ROUND(LEAST(_left, GREATEST(0, _share - _inv.paid)), 2);
      CONTINUE WHEN _apply <= 0;
      
      UPDATE public.invoices
         SET paid_amount = _inv.paid + _apply,
             status = CASE WHEN _inv.paid + _apply >= _share THEN 'paid' ELSE 'partial' END,
             paid_at = CASE WHEN _inv.paid + _apply >= _share THEN now() ELSE paid_at END,
             payment_method = COALESCE(payment_method, _settlement_method),
             is_salary_deduction = CASE WHEN _settlement_method = 'salary' THEN true ELSE is_salary_deduction END,
             staff_sponsor_id = CASE WHEN _settlement_method = 'salary' THEN _p.staff_link_id ELSE staff_sponsor_id END,
             updated_at = now()
       WHERE id = _inv.id;
       
      _left := ROUND(_left - _apply, 2);
    END LOOP;
  END IF;

  -- Anything still left is a genuine overpayment (only for cash/pos/transfer).
  IF _wallet AND _left > 0 AND _settlement_method IN ('cash','pos','transfer') THEN
    PERFORM public.adjust_patient_balance(
      _adm.patient_id, _left, 'topup', _settlement_method, NULL, NULL,
      'Change from discharge settlement left on balance');
    _credit := _left;
  END IF;

  _refund := ROUND(GREATEST(COALESCE(_refund_amount,0),0), 2);
  IF _refund > 0 THEN
    IF NOT _wallet THEN RAISE EXCEPTION 'Sponsored accounts have no wallet to refund from'; END IF;
    SELECT * INTO _p FROM public.patients WHERE id = _adm.patient_id FOR UPDATE;
    IF _refund > _p.balance THEN
      RAISE EXCEPTION 'Refund % exceeds available balance %', _refund, _p.balance;
    END IF;
    PERFORM public.adjust_patient_balance(
      _adm.patient_id, -_refund, 'refund', _settlement_method, NULL, NULL,
      'Change paid out at discharge');
  END IF;

  UPDATE public.admissions
     SET status='discharged', discharged_at=now(), discharged_by=auth.uid(),
         discharge_notes=COALESCE(_notes, discharge_notes), updated_at=now()
   WHERE id = _admission_id AND status = 'ready_for_discharge';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was settled by someone else — refresh the queue';
  END IF;

  IF _adm.bed_id IS NOT NULL THEN
    UPDATE public.beds SET status='available', updated_at=now() WHERE id = _adm.bed_id;
  END IF;

  UPDATE public.patients SET status='discharged', updated_at=now() WHERE id = _adm.patient_id;

  PERFORM public.write_audit_log('admission_discharged','admission',_admission_id::text,
    jsonb_build_object('patient_id',_adm.patient_id,'notes',_notes,'debt',_debt,
                       'wallet_applied',_wallet_used,'collected',_collected,
                       'debt_cleared',_debt_cleared,
                       'outstanding',_remaining,'credit_left',_credit,'refunded',_refund,
                       'method',_settlement_method));

  RETURN jsonb_build_object('debt',_debt,'wallet_applied',_wallet_used,
                            'collected',_collected,'outstanding',_remaining,
                            'credit_left',_credit,'refunded',_refund);
END;
$function$;

-- SOURCE: 20260812213200_sync_discharge_workflow_status.sql statement 1
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

  -- Central workflow write: update patient_journey, append journey history,
  -- and mirror patients.status atomically with the admission discharge.
  PERFORM public.advance_journey(
    _adm.patient_id,
    'discharged',
    'reception',
    NULL,
    NULL,
    NULL,
    _adm.visit_id,
    'Inpatient cashier settlement completed'
  );

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

-- SOURCE: 20260812213200_sync_discharge_workflow_status.sql statement 2
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

-- SOURCE: 20260812213200_sync_discharge_workflow_status.sql statement 3
REVOKE EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) FROM PUBLIC, anon;

-- SOURCE: 20260812213200_sync_discharge_workflow_status.sql statement 4
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) TO authenticated;

-- SOURCE: 20260812213400_finalize_inpatient_workflow_sync.sql statement 1
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

-- SOURCE: 20260812213400_finalize_inpatient_workflow_sync.sql statement 2
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

-- SOURCE: 20260812213400_finalize_inpatient_workflow_sync.sql statement 3
REVOKE EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) FROM PUBLIC, anon;

-- SOURCE: 20260812213400_finalize_inpatient_workflow_sync.sql statement 4
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) TO authenticated;

-- SOURCE: 20260813104627_024a2714-c14d-4239-8f32-680c0176f4f1.sql statement 1
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
  _has_paid_lab_req boolean;
  _has_paid_rx_req boolean;
BEGIN
  IF _user_id IS NULL OR _patient_id IS NULL THEN RETURN false; END IF;

  -- Admin always allowed.
  IF public.has_role(_user_id, 'admin'::app_role) THEN RETURN true; END IF;

  -- Lab Tech check: if they have a PAID lab request for this patient, they must be allowed to fulfill it.
  IF public.has_role(_user_id, 'lab_tech'::app_role) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.snap_orders
       WHERE patient_id = _patient_id
         AND target_station = 'lab'
         AND status = 'paid'
    ) INTO _has_paid_lab_req;
    IF _has_paid_lab_req THEN RETURN true; END IF;
  END IF;

  -- Pharmacist check: if they have a PAID pharmacy request for this patient, they must be allowed to fulfill it.
  IF public.has_role(_user_id, 'pharmacist'::app_role) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.snap_orders
       WHERE patient_id = _patient_id
         AND target_station = 'pharmacy'
         AND status = 'paid'
    ) INTO _has_paid_rx_req;
    IF _has_paid_rx_req THEN RETURN true; END IF;
  END IF;

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

-- SOURCE: 20260813110813_28560c82-d597-49fc-aa18-224044418212.sql statement 1
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
  _has_paid_lab_req boolean;
  _has_paid_rx_req boolean;
BEGIN
  IF _user_id IS NULL OR _patient_id IS NULL THEN RETURN false; END IF;

  -- Admin always allowed.
  IF public.has_role(_user_id, 'admin'::app_role) THEN RETURN true; END IF;

  -- Check if there's an active admission for this patient
  SELECT EXISTS (
    SELECT 1 FROM public.admissions
     WHERE patient_id = _patient_id AND status = 'active'
  ) INTO _is_admitted;

  -- Admitted patients: nursing/doctor roles ALWAYS have ownership to add orders.
  IF _is_admitted THEN
    RETURN public.has_any_role(_user_id,
      ARRAY['nurse','doctor','doctor1','doctor2']::app_role[]);
  END IF;

  -- Lab Tech check: if they have a PAID lab request for this patient, they must be allowed to fulfill it.
  IF public.has_role(_user_id, 'lab_tech'::app_role) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.snap_orders
       WHERE patient_id = _patient_id
         AND target_station = 'lab'
         AND status = 'paid'
    ) INTO _has_paid_lab_req;
    IF _has_paid_lab_req THEN RETURN true; END IF;
  END IF;

  -- Pharmacist check: if they have a PAID pharmacy request for this patient, they must be allowed to fulfill it.
  IF public.has_role(_user_id, 'pharmacist'::app_role) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.snap_orders
       WHERE patient_id = _patient_id
         AND target_station = 'pharmacy'
         AND status = 'paid'
    ) INTO _has_paid_rx_req;
    IF _has_paid_rx_req THEN RETURN true; END IF;
  END IF;

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

  -- Clinical staff can add orders while patient is awaiting billing (during a visit)
  IF _status = 'awaiting_billing' THEN
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
    WHEN 'admitted'     THEN public.has_any_role(_user_id,
                              ARRAY['nurse','doctor','doctor1','doctor2']::app_role[])
    ELSE false
  END;
END;
$$;

-- SOURCE: 20260813114243_99220060-0a69-4f96-ac75-e7fdf48ee8a6.sql statement 1
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
  _has_paid_lab_req boolean;
  _has_paid_rx_req boolean;
  _user_role app_role;
BEGIN
  IF _user_id IS NULL OR _patient_id IS NULL THEN RETURN false; END IF;

  -- Admin always allowed.
  IF public.has_role(_user_id, 'admin'::app_role) THEN RETURN true; END IF;

  -- Get patient status
  SELECT status::text INTO _status FROM public.patients WHERE id = _patient_id;
  IF _status IS NULL THEN RETURN false; END IF;

  -- Get current user role (taking first role found for simplicity in this logic)
  SELECT role INTO _user_role FROM public.user_roles WHERE user_id = _user_id LIMIT 1;

  -- Lab Tech check: if they have a PAID lab request for this patient, they must be allowed to fulfill it.
  IF _user_role = 'lab_tech'::app_role THEN
    SELECT EXISTS (
      SELECT 1 FROM public.snap_orders
       WHERE patient_id = _patient_id
         AND target_station = 'lab'
         AND status = 'paid'
    ) INTO _has_paid_lab_req;
    IF _has_paid_lab_req THEN RETURN true; END IF;
  END IF;

  -- Pharmacist check: if they have a PAID pharmacy request for this patient, they must be allowed to fulfill it.
  IF _user_role = 'pharmacist'::app_role THEN
    SELECT EXISTS (
      SELECT 1 FROM public.snap_orders
       WHERE patient_id = _patient_id
         AND target_station = 'pharmacy'
         AND status = 'paid'
    ) INTO _has_paid_rx_req;
    IF _has_paid_rx_req THEN RETURN true; END IF;
  END IF;

  -- Lab result check: if a lab result was returned to THIS user, they are an owner.
  -- This is a HARD RULE: returned results grant ownership back to sender.
  SELECT EXISTS (
    SELECT 1 FROM public.snap_orders
     WHERE patient_id = _patient_id
       AND order_type = 'lab_result'
       AND status = 'returned'
       AND returned_to = _user_id
  ) INTO _has_lab_return;

  IF _has_lab_return THEN RETURN true; END IF;

  -- Admission check
  SELECT EXISTS (
    SELECT 1 FROM public.admissions
     WHERE patient_id = _patient_id AND status = 'active'
  ) INTO _is_admitted;

  -- Admitted patients: clinical staff always have ownership.
  IF _is_admitted OR _status = 'admitted' THEN
    RETURN _user_role IN ('nurse', 'doctor', 'doctor1', 'doctor2');
  END IF;

  -- CLINICAL OWNERSHIP RULES
  -- 1. Nurse owns when status is 'waiting' (triage) or 'with_nurse' (vitals/triage in progress)
  IF _user_role = 'nurse' AND _status IN ('waiting', 'with_nurse') THEN
    RETURN true;
  END IF;

  -- 2. Doctor owns when status is 'with_doctor'
  IF _user_role IN ('doctor', 'doctor1', 'doctor2') AND _status = 'with_doctor' THEN
    -- If it's doctor1 or doctor2, check assignment
    DECLARE
      _assigned_doc text;
    BEGIN
      SELECT assigned_doctor::text INTO _assigned_doc FROM public.patients WHERE id = _patient_id;
      IF _assigned_doc IS NOT NULL AND _assigned_doc != _user_role::text AND _user_role::text IN ('doctor1', 'doctor2') THEN
        RETURN false; -- Assigned to the other doctor
      END IF;
      RETURN true;
    END;
  END IF;

  -- 3. Multi-order workflow: allow clinical staff to add snaps even if status is 'awaiting_billing'
  -- as long as they were the last ones interacting (nurse or doctor).
  IF _user_role IN ('nurse', 'doctor', 'doctor1', 'doctor2') AND _status = 'awaiting_billing' THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- SOURCE: 20260813114309_a756cd4f-3bef-4cc4-835f-f3f2f5cefe0a.sql statement 1
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
  _has_paid_lab_req boolean;
  _has_paid_rx_req boolean;
  _user_role app_role;
BEGIN
  IF _user_id IS NULL OR _patient_id IS NULL THEN RETURN false; END IF;

  -- Admin always allowed.
  IF public.has_role(_user_id, 'admin'::app_role) THEN RETURN true; END IF;

  -- Get patient status
  SELECT status::text INTO _status FROM public.patients WHERE id = _patient_id;
  IF _status IS NULL THEN RETURN false; END IF;

  -- Get current user role (taking first role found for simplicity in this logic)
  SELECT role INTO _user_role FROM public.user_roles WHERE user_id = _user_id LIMIT 1;

  -- Lab Tech check: if they have a PAID lab request for this patient, they must be allowed to fulfill it.
  IF _user_role = 'lab_tech'::app_role THEN
    SELECT EXISTS (
      SELECT 1 FROM public.snap_orders
       WHERE patient_id = _patient_id
         AND target_station = 'lab'
         AND status = 'paid'
    ) INTO _has_paid_lab_req;
    IF _has_paid_lab_req THEN RETURN true; END IF;
  END IF;

  -- Pharmacist check: if they have a PAID pharmacy request for this patient, they must be allowed to fulfill it.
  IF _user_role = 'pharmacist'::app_role THEN
    SELECT EXISTS (
      SELECT 1 FROM public.snap_orders
       WHERE patient_id = _patient_id
         AND target_station = 'pharmacy'
         AND status = 'paid'
    ) INTO _has_paid_rx_req;
    IF _has_paid_rx_req THEN RETURN true; END IF;
  END IF;

  -- Lab result check: if a lab result was returned to THIS user, they are an owner.
  -- This is a HARD RULE: returned results grant ownership back to sender.
  SELECT EXISTS (
    SELECT 1 FROM public.snap_orders
     WHERE patient_id = _patient_id
       AND order_type = 'lab_result'
       AND status = 'returned'
       AND returned_to = _user_id
  ) INTO _has_lab_return;

  IF _has_lab_return THEN RETURN true; END IF;

  -- Admission check
  SELECT EXISTS (
    SELECT 1 FROM public.admissions
     WHERE patient_id = _patient_id AND status = 'active'
  ) INTO _is_admitted;

  -- Admitted patients: clinical staff always have ownership.
  IF _is_admitted OR _status = 'admitted' THEN
    RETURN _user_role IN ('nurse', 'doctor', 'doctor1', 'doctor2');
  END IF;

  -- CLINICAL OWNERSHIP RULES
  -- 1. Nurse owns when status is 'waiting' (triage) or 'with_nurse' (vitals/triage in progress)
  IF _user_role = 'nurse' AND _status IN ('waiting', 'with_nurse') THEN
    RETURN true;
  END IF;

  -- 2. Doctor owns when status is 'with_doctor'
  IF _user_role IN ('doctor', 'doctor1', 'doctor2') AND _status = 'with_doctor' THEN
    -- If it's doctor1 or doctor2, check assignment
    DECLARE
      _assigned_doc text;
    BEGIN
      SELECT assigned_doctor::text INTO _assigned_doc FROM public.patients WHERE id = _patient_id;
      IF _assigned_doc IS NOT NULL AND _assigned_doc != _user_role::text AND _user_role::text IN ('doctor1', 'doctor2') THEN
        RETURN false; -- Assigned to the other doctor
      END IF;
      RETURN true;
    END;
  END IF;

  -- 3. Multi-order workflow: allow clinical staff to add snaps even if status is 'awaiting_billing'
  -- as long as they were the last ones interacting (nurse or doctor).
  IF _user_role IN ('nurse', 'doctor', 'doctor1', 'doctor2') AND _status = 'awaiting_billing' THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 1
CREATE TABLE public.patient_archive_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE SET NULL,
  patient_card_number text NOT NULL,
  patient_name text NOT NULL,
  archive_reference text NOT NULL,
  archived_by uuid NOT NULL REFERENCES neon_auth.user(id),
  archived_at timestamptz NOT NULL DEFAULT now(),
  visit_count integer NOT NULL DEFAULT 0,
  invoice_count integer NOT NULL DEFAULT 0,
  row_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  attachment_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  archive_manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  case_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'pending_download'
    CHECK (status IN ('pending_download', 'download_confirmed', 'purged')),
  download_confirmed_at timestamptz,
  download_confirmed_by uuid REFERENCES neon_auth.user(id),
  purged_at timestamptz,
  purged_by uuid REFERENCES neon_auth.user(id),
  CONSTRAINT patient_archive_records_reference_patient_key UNIQUE (archive_reference, patient_id)
);

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 2
CREATE INDEX patient_archive_records_status_idx
  ON public.patient_archive_records (status, archived_at DESC);

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 3
CREATE INDEX patient_archive_records_patient_idx
  ON public.patient_archive_records (patient_id, archived_at DESC);

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 4
ALTER TABLE public.patient_archive_records ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 5
CREATE POLICY "Admins can manage patient archive records"
  ON public.patient_archive_records
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 6
CREATE OR REPLACE FUNCTION public.patient_archive_case_fingerprint(_patient_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT md5(concat_ws('|',
    COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id)::text FROM public.visits v WHERE v.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id)::text FROM public.admissions a WHERE a.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id)::text FROM public.invoices i WHERE i.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ii) ORDER BY ii.id)::text FROM public.invoice_items ii WHERE ii.invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = _patient_id)), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ssi) ORDER BY ssi.id)::text FROM public.sponsor_statement_items ssi WHERE ssi.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ic) ORDER BY ic.id)::text FROM public.insurance_claims ic WHERE ic.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(bt) ORDER BY bt.id)::text FROM public.balance_transactions bt WHERE bt.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(br) ORDER BY br.id)::text FROM public.balance_requests br WHERE br.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pr) ORDER BY pr.id)::text FROM public.prescriptions pr WHERE pr.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pi) ORDER BY pi.id)::text FROM public.prescription_items pi WHERE pi.prescription_id IN (SELECT id FROM public.prescriptions WHERE patient_id = _patient_id)), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(lr) ORDER BY lr.id)::text FROM public.lab_requests lr WHERE lr.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(vt) ORDER BY vt.id)::text FROM public.vitals vt WHERE vt.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(so) ORDER BY so.id)::text FROM public.snap_orders so WHERE so.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(sto) ORDER BY sto.id)::text FROM public.standing_orders sto WHERE sto.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(rl) ORDER BY rl.id)::text FROM public.referral_letters rl WHERE rl.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(va) ORDER BY va.id)::text FROM public.visit_attachments va WHERE va.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ea) ORDER BY ea.id)::text FROM public.emr_attachments ea WHERE ea.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ev) ORDER BY ev.id)::text FROM public.eligibility_verifications ev WHERE ev.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pjh) ORDER BY pjh.id)::text FROM public.patient_journey_history pjh WHERE pjh.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pj) ORDER BY pj.id)::text FROM public.patient_journey pj WHERE pj.patient_id = _patient_id), '[]')
  ));
$$;

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 7
CREATE OR REPLACE FUNCTION public.check_archive_eligibility(_patient_ids uuid[])
RETURNS TABLE (
  patient_id uuid,
  patient_card_number text,
  patient_name text,
  is_eligible boolean,
  reasons text[],
  closed_at timestamptz,
  row_counts jsonb,
  attachment_paths jsonb,
  case_fingerprint text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_requested_id uuid;
  v_patient public.patients%ROWTYPE;
  v_journey_state text;
  v_reasons text[];
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can check archive eligibility';
  END IF;

  FOREACH v_requested_id IN ARRAY COALESCE(_patient_ids, ARRAY[]::uuid[])
  LOOP
    SELECT * INTO v_patient
    FROM public.patients p
    WHERE p.id = v_requested_id;

    IF NOT FOUND THEN
      patient_id := v_requested_id;
      patient_card_number := NULL;
      patient_name := 'Unknown patient';
      is_eligible := false;
      reasons := ARRAY['Patient record was not found'];
      closed_at := NULL;
      row_counts := '{}'::jsonb;
      attachment_paths := '[]'::jsonb;
      case_fingerprint := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT pj.current_state INTO v_journey_state
    FROM public.patient_journey pj
    WHERE pj.patient_id = v_patient.id
    ORDER BY pj.updated_at DESC NULLS LAST, pj.created_at DESC NULLS LAST
    LIMIT 1;

    patient_id := v_patient.id;
    patient_card_number := v_patient.card_number;
    patient_name := trim(concat_ws(' ', v_patient.first_name, v_patient.last_name));
    closed_at := (
      SELECT max(v.updated_at)
      FROM public.visits v
      WHERE v.patient_id = v_patient.id
        AND v.status::text = 'settled'
    );

    row_counts := jsonb_build_object(
      'visits', (SELECT count(*) FROM public.visits WHERE patient_id = v_patient.id),
      'admissions', (SELECT count(*) FROM public.admissions WHERE patient_id = v_patient.id),
      'invoices', (SELECT count(*) FROM public.invoices WHERE patient_id = v_patient.id),
      'invoice_items', (SELECT count(*) FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = v_patient.id)),
      'prescriptions', (SELECT count(*) FROM public.prescriptions WHERE patient_id = v_patient.id),
      'lab_requests', (SELECT count(*) FROM public.lab_requests WHERE patient_id = v_patient.id),
      'snap_orders', (SELECT count(*) FROM public.snap_orders WHERE patient_id = v_patient.id),
      'referral_letters', (SELECT count(*) FROM public.referral_letters WHERE patient_id = v_patient.id),
      'attachments', (
        (SELECT count(*) FROM public.visit_attachments WHERE patient_id = v_patient.id) +
        (SELECT count(*) FROM public.emr_attachments WHERE patient_id = v_patient.id)
      )
    );

    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('bucket', p.bucket, 'path', p.path, 'source', p.source) ORDER BY p.bucket, p.path, p.source),
      '[]'::jsonb
    ) INTO attachment_paths
    FROM (
      SELECT DISTINCT 'visit-cards'::text AS bucket, so.photo_path AS path, 'snap_orders.photo_path'::text AS source
      FROM public.snap_orders so
      WHERE so.patient_id = v_patient.id AND NULLIF(btrim(so.photo_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'visit-cards', va.storage_path, 'visit_attachments.storage_path'
      FROM public.visit_attachments va
      WHERE va.patient_id = v_patient.id AND NULLIF(btrim(va.storage_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'visit-cards', a.admission_snap_path, 'admissions.admission_snap_path'
      FROM public.admissions a
      WHERE a.patient_id = v_patient.id AND NULLIF(btrim(a.admission_snap_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'visit-cards', ev.reception_snap_path, 'eligibility_verifications.reception_snap_path'
      FROM public.eligibility_verifications ev
      WHERE ev.patient_id = v_patient.id AND NULLIF(btrim(ev.reception_snap_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'visit-cards', ev.verification_snap_path, 'eligibility_verifications.verification_snap_path'
      FROM public.eligibility_verifications ev
      WHERE ev.patient_id = v_patient.id AND NULLIF(btrim(ev.verification_snap_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'emr-attachments', ea.file_path, 'emr_attachments.file_path'
      FROM public.emr_attachments ea
      WHERE ea.patient_id = v_patient.id AND NULLIF(btrim(ea.file_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'emr-attachments', rl.file_path, 'referral_letters.file_path'
      FROM public.referral_letters rl
      WHERE rl.patient_id = v_patient.id AND NULLIF(btrim(rl.file_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'external-url', sto.photo_url, 'standing_orders.photo_url'
      FROM public.standing_orders sto
      WHERE sto.patient_id = v_patient.id AND NULLIF(btrim(sto.photo_url), '') IS NOT NULL
    ) p;

    v_reasons := array_remove(ARRAY[
      CASE WHEN NOT EXISTS (
        SELECT 1 FROM public.visits v WHERE v.patient_id = v_patient.id AND v.status::text = 'settled'
      ) THEN 'No settled visit exists' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.visits v WHERE v.patient_id = v_patient.id AND v.status::text <> 'settled'
      ) THEN 'An active or unsettled visit still exists' END,
      CASE WHEN COALESCE(v_journey_state, '') <> 'discharged'
        THEN 'Patient journey is not discharged' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.admissions a
        WHERE a.patient_id = v_patient.id
          AND a.status IN ('waiting_assignment', 'active', 'ready_for_discharge')
      ) THEN 'An active admission still exists' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.invoices i
        WHERE i.patient_id = v_patient.id AND i.status::text IN ('pending', 'partial')
      ) THEN 'An unpaid or partially paid invoice exists' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.lab_requests lr
        WHERE lr.patient_id = v_patient.id AND lr.status::text = 'pending'
      ) THEN 'A laboratory request is pending' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.prescriptions pr
        WHERE pr.patient_id = v_patient.id AND pr.status::text = 'pending'
      ) THEN 'A pharmacy prescription is pending' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.snap_orders so
        WHERE so.patient_id = v_patient.id AND so.status::text = 'awaiting_payment'
      ) THEN 'A snap order awaits payment' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.balance_requests br
        WHERE br.patient_id = v_patient.id AND br.status::text = 'pending'
      ) THEN 'A patient balance request is pending' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.standing_orders sto
        WHERE sto.patient_id = v_patient.id
          AND COALESCE(sto.status::text, '') NOT IN ('completed', 'cancelled', 'closed', 'returned')
      ) THEN 'A standing order or external referral is unresolved' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.referral_letters rl
        WHERE rl.patient_id = v_patient.id
          AND COALESCE(rl.status::text, '') NOT IN ('final', 'completed', 'sent', 'closed', 'cancelled')
      ) THEN 'A referral letter is unfinished' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.insurance_claims ic
        WHERE ic.patient_id = v_patient.id
          AND COALESCE(ic.status::text, '') NOT IN ('paid', 'settled', 'closed', 'cancelled', 'rejected', 'denied')
      ) THEN 'An insurance claim remains unresolved' END,
      CASE WHEN closed_at IS NULL OR closed_at > now() - interval '24 hours'
        THEN 'The case must remain closed for at least 24 hours before archiving' END
    ], NULL);

    is_eligible := COALESCE(cardinality(v_reasons), 0) = 0;
    reasons := COALESCE(v_reasons, ARRAY[]::text[]);
    case_fingerprint := public.patient_archive_case_fingerprint(v_patient.id);
    RETURN NEXT;
  END LOOP;
END;
$$;

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 8
CREATE OR REPLACE FUNCTION public.prepare_patient_archive(
  _archive_reference text,
  _archives jsonb
)
RETURNS TABLE (
  archive_record_id uuid,
  patient_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry jsonb;
  v_patient_id uuid;
  v_expected_fingerprint text;
  v_manifest jsonb;
  v_eligibility record;
  v_existing_status text;
  v_count integer := 0;
  v_reference text := btrim(COALESCE(_archive_reference, ''));
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can prepare an archive';
  END IF;

  IF v_reference = '' THEN
    RAISE EXCEPTION 'An archive reference is required';
  END IF;

  IF jsonb_typeof(_archives) <> 'array' OR jsonb_array_length(_archives) = 0 THEN
    RAISE EXCEPTION 'At least one patient archive manifest is required';
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(_archives)
  LOOP
    v_patient_id := NULLIF(v_entry ->> 'patient_id', '')::uuid;
    v_expected_fingerprint := NULLIF(v_entry ->> 'case_fingerprint', '');
    v_manifest := COALESCE(v_entry -> 'manifest', '{}'::jsonb);

    IF v_patient_id IS NULL OR v_expected_fingerprint IS NULL THEN
      RAISE EXCEPTION 'Each archive manifest must include patient_id and case_fingerprint';
    END IF;

    SELECT * INTO v_eligibility
    FROM public.check_archive_eligibility(ARRAY[v_patient_id]);

    IF NOT FOUND OR NOT v_eligibility.is_eligible THEN
      RAISE EXCEPTION 'Patient % is no longer eligible for archiving: %',
        v_patient_id, COALESCE(array_to_string(v_eligibility.reasons, '; '), 'unknown reason');
    END IF;

    IF v_eligibility.case_fingerprint IS DISTINCT FROM v_expected_fingerprint THEN
      RAISE EXCEPTION 'Case records changed while the archive was being prepared. Create a new ZIP before continuing.';
    END IF;

    SELECT r.status INTO v_existing_status
    FROM public.patient_archive_records r
    WHERE r.patient_id = v_patient_id AND r.archive_reference = v_reference
    FOR UPDATE;

    IF FOUND THEN
      RAISE EXCEPTION 'Archive reference % already has a % record for patient %',
        v_reference, v_existing_status, v_patient_id;
    END IF;

    INSERT INTO public.patient_archive_records (
      patient_id,
      patient_card_number,
      patient_name,
      archive_reference,
      archived_by,
      visit_count,
      invoice_count,
      row_counts,
      attachment_paths,
      archive_manifest,
      case_fingerprint,
      status
    ) VALUES (
      v_eligibility.patient_id,
      v_eligibility.patient_card_number,
      v_eligibility.patient_name,
      v_reference,
      auth.uid(),
      COALESCE((v_eligibility.row_counts ->> 'visits')::integer, 0),
      COALESCE((v_eligibility.row_counts ->> 'invoices')::integer, 0),
      v_eligibility.row_counts,
      v_eligibility.attachment_paths,
      v_manifest,
      v_eligibility.case_fingerprint,
      'pending_download'
    )
    RETURNING id, patient_archive_records.patient_id INTO archive_record_id, patient_id;

    v_count := v_count + 1;
    RETURN NEXT;
  END LOOP;

  PERFORM public.write_audit_log(
    'prepare_patient_archive',
    'patient_archive_records',
    v_reference,
    jsonb_build_object('patient_count', v_count),
    'success'
  );
END;
$$;

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 9
CREATE OR REPLACE FUNCTION public.confirm_archive_download(_archive_reference text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reference text := btrim(COALESCE(_archive_reference, ''));
  v_updated integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can confirm an archive download';
  END IF;

  IF v_reference = '' THEN
    RAISE EXCEPTION 'An archive reference is required';
  END IF;

  UPDATE public.patient_archive_records
  SET status = 'download_confirmed',
      download_confirmed_at = now(),
      download_confirmed_by = auth.uid()
  WHERE archive_reference = v_reference
    AND status = 'pending_download';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RAISE EXCEPTION 'No pending archive records were found for reference %', v_reference;
  END IF;

  PERFORM public.write_audit_log(
    'confirm_archive_download',
    'patient_archive_records',
    v_reference,
    jsonb_build_object('patient_count', v_updated),
    'success'
  );

  RETURN v_updated;
END;
$$;

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 10
CREATE OR REPLACE FUNCTION public.purge_archived_cases(
  _patient_ids uuid[],
  _archive_reference text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reference text := btrim(COALESCE(_archive_reference, ''));
  v_patient_id uuid;
  v_record public.patient_archive_records%ROWTYPE;
  v_eligibility record;
  v_expected_count integer;
  v_statement_ids uuid[];
  v_purged_count integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can purge verified archives';
  END IF;

  IF v_reference = '' OR COALESCE(array_length(_patient_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Archive reference and at least one patient are required';
  END IF;

  IF (SELECT count(DISTINCT x) FROM unnest(_patient_ids) AS x) <> array_length(_patient_ids, 1) THEN
    RAISE EXCEPTION 'Duplicate patient identifiers are not allowed';
  END IF;

  SELECT count(*) INTO v_expected_count
  FROM public.patient_archive_records r
  WHERE r.archive_reference = v_reference
    AND r.patient_id = ANY(_patient_ids)
    AND r.status = 'download_confirmed';

  IF v_expected_count <> array_length(_patient_ids, 1) THEN
    RAISE EXCEPTION 'Every selected patient must have a download-confirmed archive with this reference';
  END IF;

  -- Lock every archive row and revalidate eligibility plus the exact clinical-data fingerprint.
  FOR v_patient_id IN SELECT unnest(_patient_ids)
  LOOP
    SELECT * INTO v_record
    FROM public.patient_archive_records r
    WHERE r.archive_reference = v_reference
      AND r.patient_id = v_patient_id
      AND r.status = 'download_confirmed'
    FOR UPDATE;

    SELECT * INTO v_eligibility
    FROM public.check_archive_eligibility(ARRAY[v_patient_id]);

    IF NOT v_eligibility.is_eligible THEN
      RAISE EXCEPTION 'Patient % is no longer eligible for purge: %',
        v_patient_id, array_to_string(v_eligibility.reasons, '; ');
    END IF;

    IF v_eligibility.case_fingerprint IS DISTINCT FROM v_record.case_fingerprint THEN
      RAISE EXCEPTION 'Patient % changed after archive preparation. Prepare and verify a new ZIP before purge.', v_patient_id;
    END IF;
  END LOOP;

  -- Capture affected statement IDs before removing their selected patient items.  Shared
  -- sponsor statements are retained whenever another patient still has an item in them.
  SELECT COALESCE(array_agg(DISTINCT ssi.statement_id), ARRAY[]::uuid[])
  INTO v_statement_ids
  FROM public.sponsor_statement_items ssi
  WHERE ssi.patient_id = ANY(_patient_ids);

  -- Delete child rows in dependency order.  The retained patient identity and account links
  -- are deliberately excluded from this list.
  DELETE FROM public.invoice_items
  WHERE invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = ANY(_patient_ids));

  DELETE FROM public.sponsor_statement_items WHERE patient_id = ANY(_patient_ids);

  DELETE FROM public.insurance_claims WHERE patient_id = ANY(_patient_ids);

  DELETE FROM public.balance_transactions WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.balance_requests WHERE patient_id = ANY(_patient_ids);

  DELETE FROM public.corporate_transactions ct
  WHERE ct.related_statement_id = ANY(v_statement_ids)
    AND NOT EXISTS (
      SELECT 1 FROM public.sponsor_statement_items remaining
      WHERE remaining.statement_id = ct.related_statement_id
    );

  DELETE FROM public.sponsor_statements ss
  WHERE ss.id = ANY(v_statement_ids)
    AND NOT EXISTS (
      SELECT 1 FROM public.sponsor_statement_items remaining
      WHERE remaining.statement_id = ss.id
    );

  DELETE FROM public.invoices WHERE patient_id = ANY(_patient_ids);

  DELETE FROM public.prescription_items
  WHERE prescription_id IN (SELECT id FROM public.prescriptions WHERE patient_id = ANY(_patient_ids));
  DELETE FROM public.prescriptions WHERE patient_id = ANY(_patient_ids);

  DELETE FROM public.lab_requests WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.vitals WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.snap_orders WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.standing_orders WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.referral_letters WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.visit_attachments WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.emr_attachments WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.eligibility_verifications WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.patient_journey_history WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.patient_journey WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.admissions WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.visits WHERE patient_id = ANY(_patient_ids);

  -- Keep MRN/card number and demographic record so a returning patient can be registered
  -- again without duplicate identity creation.  The archive index remains the permanent link
  -- to the verified offline ZIP.
  UPDATE public.patients
  SET status = 'registered',
      last_visit = NULL,
      balance = 0,
      updated_at = now()
  WHERE id = ANY(_patient_ids);

  UPDATE public.patient_archive_records
  SET status = 'purged',
      purged_at = now(),
      purged_by = auth.uid()
  WHERE archive_reference = v_reference
    AND patient_id = ANY(_patient_ids)
    AND status = 'download_confirmed';

  GET DIAGNOSTICS v_purged_count = ROW_COUNT;

  PERFORM public.write_audit_log(
    'purge_archived_cases',
    'patient_archive_records',
    v_reference,
    jsonb_build_object('patient_ids', _patient_ids, 'patient_count', v_purged_count),
    'success'
  );

  RETURN v_purged_count;
END;
$$;

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 11
REVOKE ALL ON FUNCTION public.patient_archive_case_fingerprint(uuid) FROM PUBLIC;

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 12
GRANT EXECUTE ON FUNCTION public.check_archive_eligibility(uuid[]) TO authenticated;

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 13
GRANT EXECUTE ON FUNCTION public.prepare_patient_archive(text, jsonb) TO authenticated;

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 14
GRANT EXECUTE ON FUNCTION public.confirm_archive_download(text) TO authenticated;

-- SOURCE: 20260813150000_patient_archive_feature.sql statement 15
GRANT EXECUTE ON FUNCTION public.purge_archived_cases(uuid[], text) TO authenticated;

-- SOURCE: 20260813150100_archive_eligibility_name_resolution.sql statement 1
CREATE OR REPLACE FUNCTION public.check_archive_eligibility(_patient_ids uuid[])
RETURNS TABLE (
  patient_id uuid,
  patient_card_number text,
  patient_name text,
  is_eligible boolean,
  reasons text[],
  closed_at timestamptz,
  row_counts jsonb,
  attachment_paths jsonb,
  case_fingerprint text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_requested_id uuid;
  v_patient public.patients%ROWTYPE;
  v_journey_state text;
  v_reasons text[];
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can check archive eligibility';
  END IF;

  FOREACH v_requested_id IN ARRAY COALESCE(_patient_ids, ARRAY[]::uuid[])
  LOOP
    SELECT * INTO v_patient
    FROM public.patients p
    WHERE p.id = v_requested_id;

    IF NOT FOUND THEN
      patient_id := v_requested_id;
      patient_card_number := NULL;
      patient_name := 'Unknown patient';
      is_eligible := false;
      reasons := ARRAY['Patient record was not found'];
      closed_at := NULL;
      row_counts := '{}'::jsonb;
      attachment_paths := '[]'::jsonb;
      case_fingerprint := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT pj.current_state INTO v_journey_state
    FROM public.patient_journey pj
    WHERE pj.patient_id = v_patient.id
    ORDER BY pj.updated_at DESC NULLS LAST, pj.created_at DESC NULLS LAST
    LIMIT 1;

    patient_id := v_patient.id;
    patient_card_number := v_patient.card_number;
    patient_name := trim(concat_ws(' ', v_patient.first_name, v_patient.last_name));
    closed_at := (
      SELECT max(v.updated_at)
      FROM public.visits v
      WHERE v.patient_id = v_patient.id
        AND v.status::text = 'settled'
    );

    row_counts := jsonb_build_object(
      'visits', (SELECT count(*) FROM public.visits WHERE patient_id = v_patient.id),
      'admissions', (SELECT count(*) FROM public.admissions WHERE patient_id = v_patient.id),
      'invoices', (SELECT count(*) FROM public.invoices WHERE patient_id = v_patient.id),
      'invoice_items', (SELECT count(*) FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = v_patient.id)),
      'prescriptions', (SELECT count(*) FROM public.prescriptions WHERE patient_id = v_patient.id),
      'lab_requests', (SELECT count(*) FROM public.lab_requests WHERE patient_id = v_patient.id),
      'snap_orders', (SELECT count(*) FROM public.snap_orders WHERE patient_id = v_patient.id),
      'referral_letters', (SELECT count(*) FROM public.referral_letters WHERE patient_id = v_patient.id),
      'attachments', (
        (SELECT count(*) FROM public.visit_attachments WHERE patient_id = v_patient.id) +
        (SELECT count(*) FROM public.emr_attachments WHERE patient_id = v_patient.id)
      )
    );

    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('bucket', p.bucket, 'path', p.path, 'source', p.source) ORDER BY p.bucket, p.path, p.source),
      '[]'::jsonb
    ) INTO attachment_paths
    FROM (
      SELECT DISTINCT 'visit-cards'::text AS bucket, so.photo_path AS path, 'snap_orders.photo_path'::text AS source
      FROM public.snap_orders so
      WHERE so.patient_id = v_patient.id AND NULLIF(btrim(so.photo_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'visit-cards', va.storage_path, 'visit_attachments.storage_path'
      FROM public.visit_attachments va
      WHERE va.patient_id = v_patient.id AND NULLIF(btrim(va.storage_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'visit-cards', a.admission_snap_path, 'admissions.admission_snap_path'
      FROM public.admissions a
      WHERE a.patient_id = v_patient.id AND NULLIF(btrim(a.admission_snap_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'visit-cards', ev.reception_snap_path, 'eligibility_verifications.reception_snap_path'
      FROM public.eligibility_verifications ev
      WHERE ev.patient_id = v_patient.id AND NULLIF(btrim(ev.reception_snap_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'visit-cards', ev.verification_snap_path, 'eligibility_verifications.verification_snap_path'
      FROM public.eligibility_verifications ev
      WHERE ev.patient_id = v_patient.id AND NULLIF(btrim(ev.verification_snap_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'emr-attachments', ea.file_path, 'emr_attachments.file_path'
      FROM public.emr_attachments ea
      WHERE ea.patient_id = v_patient.id AND NULLIF(btrim(ea.file_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'emr-attachments', rl.file_path, 'referral_letters.file_path'
      FROM public.referral_letters rl
      WHERE rl.patient_id = v_patient.id AND NULLIF(btrim(rl.file_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'external-url', sto.photo_url, 'standing_orders.photo_url'
      FROM public.standing_orders sto
      WHERE sto.patient_id = v_patient.id AND NULLIF(btrim(sto.photo_url), '') IS NOT NULL
    ) p;

    v_reasons := array_remove(ARRAY[
      CASE WHEN NOT EXISTS (
        SELECT 1 FROM public.visits v WHERE v.patient_id = v_patient.id AND v.status::text = 'settled'
      ) THEN 'No settled visit exists' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.visits v WHERE v.patient_id = v_patient.id AND v.status::text <> 'settled'
      ) THEN 'An active or unsettled visit still exists' END,
      CASE WHEN COALESCE(v_journey_state, '') <> 'discharged'
        THEN 'Patient journey is not discharged' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.admissions a
        WHERE a.patient_id = v_patient.id
          AND a.status IN ('waiting_assignment', 'active', 'ready_for_discharge')
      ) THEN 'An active admission still exists' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.invoices i
        WHERE i.patient_id = v_patient.id AND i.status::text IN ('pending', 'partial')
      ) THEN 'An unpaid or partially paid invoice exists' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.lab_requests lr
        WHERE lr.patient_id = v_patient.id AND lr.status::text = 'pending'
      ) THEN 'A laboratory request is pending' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.prescriptions pr
        WHERE pr.patient_id = v_patient.id AND pr.status::text = 'pending'
      ) THEN 'A pharmacy prescription is pending' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.snap_orders so
        WHERE so.patient_id = v_patient.id AND so.status::text = 'awaiting_payment'
      ) THEN 'A snap order awaits payment' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.balance_requests br
        WHERE br.patient_id = v_patient.id AND br.status::text = 'pending'
      ) THEN 'A patient balance request is pending' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.standing_orders sto
        WHERE sto.patient_id = v_patient.id
          AND COALESCE(sto.status::text, '') NOT IN ('completed', 'cancelled', 'closed', 'returned')
      ) THEN 'A standing order or external referral is unresolved' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.referral_letters rl
        WHERE rl.patient_id = v_patient.id
          AND COALESCE(rl.status::text, '') NOT IN ('final', 'completed', 'sent', 'closed', 'cancelled')
      ) THEN 'A referral letter is unfinished' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.insurance_claims ic
        WHERE ic.patient_id = v_patient.id
          AND COALESCE(ic.status::text, '') NOT IN ('paid', 'settled', 'closed', 'cancelled', 'rejected', 'denied')
      ) THEN 'An insurance claim remains unresolved' END,
      CASE WHEN closed_at IS NULL OR closed_at > now() - interval '24 hours'
        THEN 'The case must remain closed for at least 24 hours before archiving' END
    ], NULL);

    is_eligible := COALESCE(cardinality(v_reasons), 0) = 0;
    reasons := COALESCE(v_reasons, ARRAY[]::text[]);
    case_fingerprint := public.patient_archive_case_fingerprint(v_patient.id);
    RETURN NEXT;
  END LOOP;
END;
$$;

-- SOURCE: 20260813223000_archive_balance_retention_and_immediate_eligibility.sql statement 1
CREATE OR REPLACE FUNCTION public.check_archive_eligibility(_patient_ids uuid[])
RETURNS TABLE (
  patient_id uuid,
  patient_card_number text,
  patient_name text,
  is_eligible boolean,
  reasons text[],
  closed_at timestamptz,
  row_counts jsonb,
  attachment_paths jsonb,
  case_fingerprint text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_requested_id uuid;
  v_patient public.patients%ROWTYPE;
  v_journey_state text;
  v_reasons text[];
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can check archive eligibility';
  END IF;

  FOREACH v_requested_id IN ARRAY COALESCE(_patient_ids, ARRAY[]::uuid[])
  LOOP
    SELECT * INTO v_patient
    FROM public.patients p
    WHERE p.id = v_requested_id;

    IF NOT FOUND THEN
      patient_id := v_requested_id;
      patient_card_number := NULL;
      patient_name := 'Unknown patient';
      is_eligible := false;
      reasons := ARRAY['Patient record was not found'];
      closed_at := NULL;
      row_counts := '{}'::jsonb;
      attachment_paths := '[]'::jsonb;
      case_fingerprint := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT pj.current_state INTO v_journey_state
    FROM public.patient_journey pj
    WHERE pj.patient_id = v_patient.id
    ORDER BY pj.updated_at DESC NULLS LAST, pj.created_at DESC NULLS LAST
    LIMIT 1;

    patient_id := v_patient.id;
    patient_card_number := v_patient.card_number;
    patient_name := trim(concat_ws(' ', v_patient.first_name, v_patient.last_name));
    closed_at := (
      SELECT max(v.updated_at)
      FROM public.visits v
      WHERE v.patient_id = v_patient.id
        AND v.status::text = 'settled'
    );

    row_counts := jsonb_build_object(
      'visits', (SELECT count(*) FROM public.visits WHERE patient_id = v_patient.id),
      'admissions', (SELECT count(*) FROM public.admissions WHERE patient_id = v_patient.id),
      'invoices', (SELECT count(*) FROM public.invoices WHERE patient_id = v_patient.id),
      'invoice_items', (SELECT count(*) FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = v_patient.id)),
      'prescriptions', (SELECT count(*) FROM public.prescriptions WHERE patient_id = v_patient.id),
      'lab_requests', (SELECT count(*) FROM public.lab_requests WHERE patient_id = v_patient.id),
      'snap_orders', (SELECT count(*) FROM public.snap_orders WHERE patient_id = v_patient.id),
      'referral_letters', (SELECT count(*) FROM public.referral_letters WHERE patient_id = v_patient.id),
      'attachments', (
        (SELECT count(*) FROM public.visit_attachments WHERE patient_id = v_patient.id) +
        (SELECT count(*) FROM public.emr_attachments WHERE patient_id = v_patient.id)
      )
    );

    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('bucket', p.bucket, 'path', p.path, 'source', p.source) ORDER BY p.bucket, p.path, p.source),
      '[]'::jsonb
    ) INTO attachment_paths
    FROM (
      SELECT DISTINCT 'visit-cards'::text AS bucket, so.photo_path AS path, 'snap_orders.photo_path'::text AS source
      FROM public.snap_orders so
      WHERE so.patient_id = v_patient.id AND NULLIF(btrim(so.photo_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'visit-cards', va.storage_path, 'visit_attachments.storage_path'
      FROM public.visit_attachments va
      WHERE va.patient_id = v_patient.id AND NULLIF(btrim(va.storage_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'visit-cards', a.admission_snap_path, 'admissions.admission_snap_path'
      FROM public.admissions a
      WHERE a.patient_id = v_patient.id AND NULLIF(btrim(a.admission_snap_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'visit-cards', ev.reception_snap_path, 'eligibility_verifications.reception_snap_path'
      FROM public.eligibility_verifications ev
      WHERE ev.patient_id = v_patient.id AND NULLIF(btrim(ev.reception_snap_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'visit-cards', ev.verification_snap_path, 'eligibility_verifications.verification_snap_path'
      FROM public.eligibility_verifications ev
      WHERE ev.patient_id = v_patient.id AND NULLIF(btrim(ev.verification_snap_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'emr-attachments', ea.file_path, 'emr_attachments.file_path'
      FROM public.emr_attachments ea
      WHERE ea.patient_id = v_patient.id AND NULLIF(btrim(ea.file_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'emr-attachments', rl.file_path, 'referral_letters.file_path'
      FROM public.referral_letters rl
      WHERE rl.patient_id = v_patient.id AND NULLIF(btrim(rl.file_path), '') IS NOT NULL
      UNION
      SELECT DISTINCT 'external-url', sto.photo_url, 'standing_orders.photo_url'
      FROM public.standing_orders sto
      WHERE sto.patient_id = v_patient.id AND NULLIF(btrim(sto.photo_url), '') IS NOT NULL
    ) p;

    v_reasons := array_remove(ARRAY[
      CASE WHEN NOT EXISTS (
        SELECT 1 FROM public.visits v WHERE v.patient_id = v_patient.id AND v.status::text = 'settled'
      ) THEN 'No settled visit exists' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.visits v WHERE v.patient_id = v_patient.id AND v.status::text <> 'settled'
      ) THEN 'An active or unsettled visit still exists' END,
      CASE WHEN COALESCE(v_journey_state, '') <> 'discharged'
        THEN 'Patient journey is not discharged' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.admissions a
        WHERE a.patient_id = v_patient.id
          AND a.status IN ('waiting_assignment', 'active', 'ready_for_discharge')
      ) THEN 'An active admission still exists' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.invoices i
        WHERE i.patient_id = v_patient.id AND i.status::text IN ('pending', 'partial')
      ) THEN 'An unpaid or partially paid invoice exists' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.lab_requests lr
        WHERE lr.patient_id = v_patient.id AND lr.status::text = 'pending'
      ) THEN 'A laboratory request is pending' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.prescriptions pr
        WHERE pr.patient_id = v_patient.id AND pr.status::text = 'pending'
      ) THEN 'A pharmacy prescription is pending' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.snap_orders so
        WHERE so.patient_id = v_patient.id AND so.status::text = 'awaiting_payment'
      ) THEN 'A snap order awaits payment' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.balance_requests br
        WHERE br.patient_id = v_patient.id AND br.status::text = 'pending'
      ) THEN 'A patient balance request is pending' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.standing_orders sto
        WHERE sto.patient_id = v_patient.id
          AND COALESCE(sto.status::text, '') NOT IN ('completed', 'cancelled', 'closed', 'returned')
      ) THEN 'A standing order or external referral is unresolved' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.referral_letters rl
        WHERE rl.patient_id = v_patient.id
          AND COALESCE(rl.status::text, '') NOT IN ('final', 'completed', 'sent', 'closed', 'cancelled')
      ) THEN 'A referral letter is unfinished' END,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.insurance_claims ic
        WHERE ic.patient_id = v_patient.id
          AND COALESCE(ic.status::text, '') NOT IN ('paid', 'settled', 'closed', 'cancelled', 'rejected', 'denied')
      ) THEN 'An insurance claim remains unresolved' END
    ], NULL);

    is_eligible := COALESCE(cardinality(v_reasons), 0) = 0;
    reasons := COALESCE(v_reasons, ARRAY[]::text[]);
    case_fingerprint := public.patient_archive_case_fingerprint(v_patient.id);
    RETURN NEXT;
  END LOOP;
END;
$$;

-- SOURCE: 20260813223000_archive_balance_retention_and_immediate_eligibility.sql statement 2
CREATE OR REPLACE FUNCTION public.purge_archived_cases(
  _patient_ids uuid[],
  _archive_reference text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reference text := btrim(COALESCE(_archive_reference, ''));
  v_patient_id uuid;
  v_record public.patient_archive_records%ROWTYPE;
  v_eligibility record;
  v_expected_count integer;
  v_statement_ids uuid[];
  v_purged_count integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can purge verified archives';
  END IF;

  IF v_reference = '' OR COALESCE(array_length(_patient_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Archive reference and at least one patient are required';
  END IF;

  IF (SELECT count(DISTINCT x) FROM unnest(_patient_ids) AS x) <> array_length(_patient_ids, 1) THEN
    RAISE EXCEPTION 'Duplicate patient identifiers are not allowed';
  END IF;

  SELECT count(*) INTO v_expected_count
  FROM public.patient_archive_records r
  WHERE r.archive_reference = v_reference
    AND r.patient_id = ANY(_patient_ids)
    AND r.status = 'download_confirmed';

  IF v_expected_count <> array_length(_patient_ids, 1) THEN
    RAISE EXCEPTION 'Every selected patient must have a download-confirmed archive with this reference';
  END IF;

  FOR v_patient_id IN SELECT unnest(_patient_ids)
  LOOP
    SELECT * INTO v_record
    FROM public.patient_archive_records r
    WHERE r.archive_reference = v_reference
      AND r.patient_id = v_patient_id
      AND r.status = 'download_confirmed'
    FOR UPDATE;

    SELECT * INTO v_eligibility
    FROM public.check_archive_eligibility(ARRAY[v_patient_id]);

    IF NOT v_eligibility.is_eligible THEN
      RAISE EXCEPTION 'Patient % is no longer eligible for purge: %',
        v_patient_id, array_to_string(v_eligibility.reasons, '; ');
    END IF;

    IF v_eligibility.case_fingerprint IS DISTINCT FROM v_record.case_fingerprint THEN
      RAISE EXCEPTION 'Patient % changed after archive preparation. Prepare and verify a new ZIP before purge.', v_patient_id;
    END IF;
  END LOOP;

  SELECT COALESCE(array_agg(DISTINCT ssi.statement_id), ARRAY[]::uuid[])
  INTO v_statement_ids
  FROM public.sponsor_statement_items ssi
  WHERE ssi.patient_id = ANY(_patient_ids);

  DELETE FROM public.invoice_items
  WHERE invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = ANY(_patient_ids));
  DELETE FROM public.sponsor_statement_items WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.insurance_claims WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.balance_transactions WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.balance_requests WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.corporate_transactions ct
  WHERE ct.related_statement_id = ANY(v_statement_ids)
    AND NOT EXISTS (
      SELECT 1 FROM public.sponsor_statement_items remaining
      WHERE remaining.statement_id = ct.related_statement_id
    );
  DELETE FROM public.sponsor_statements ss
  WHERE ss.id = ANY(v_statement_ids)
    AND NOT EXISTS (
      SELECT 1 FROM public.sponsor_statement_items remaining
      WHERE remaining.statement_id = ss.id
    );
  DELETE FROM public.invoices WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.prescription_items
  WHERE prescription_id IN (SELECT id FROM public.prescriptions WHERE patient_id = ANY(_patient_ids));
  DELETE FROM public.prescriptions WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.lab_requests WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.vitals WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.snap_orders WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.standing_orders WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.referral_letters WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.visit_attachments WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.emr_attachments WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.eligibility_verifications WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.patient_journey_history WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.patient_journey WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.admissions WHERE patient_id = ANY(_patient_ids);
  DELETE FROM public.visits WHERE patient_id = ANY(_patient_ids);

  -- Preserve the patient wallet/account balance exactly as it was at the verified purge.
  -- The account remains reusable for a future visit without creating a duplicate patient.
  UPDATE public.patients
  SET status = 'registered',
      last_visit = NULL,
      updated_at = now()
  WHERE id = ANY(_patient_ids);

  UPDATE public.patient_archive_records
  SET status = 'purged',
      purged_at = now(),
      purged_by = auth.uid()
  WHERE archive_reference = v_reference
    AND patient_id = ANY(_patient_ids)
    AND status = 'download_confirmed';

  GET DIAGNOSTICS v_purged_count = ROW_COUNT;

  PERFORM public.write_audit_log(
    'purge_archived_cases',
    'patient_archive_records',
    v_reference,
    jsonb_build_object('patient_ids', _patient_ids, 'patient_count', v_purged_count),
    'success'
  );

  RETURN v_purged_count;
END;
$$;

-- SOURCE: 20260813223000_archive_balance_retention_and_immediate_eligibility.sql statement 3
GRANT EXECUTE ON FUNCTION public.check_archive_eligibility(uuid[]) TO authenticated;

-- SOURCE: 20260813223000_archive_balance_retention_and_immediate_eligibility.sql statement 4
GRANT EXECUTE ON FUNCTION public.purge_archived_cases(uuid[], text) TO authenticated;

-- SOURCE: 20260814103000_archive_storage_savings_reporting.sql statement 1
ALTER TABLE public.patient_archive_records
  ADD COLUMN IF NOT EXISTS database_payload_bytes bigint NOT NULL DEFAULT 0 CHECK (database_payload_bytes >= 0),
  ADD COLUMN IF NOT EXISTS database_rows_cleared jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS r2_object_bytes bigint NOT NULL DEFAULT 0 CHECK (r2_object_bytes >= 0),
  ADD COLUMN IF NOT EXISTS r2_deleted_bytes bigint NOT NULL DEFAULT 0 CHECK (r2_deleted_bytes >= 0),
  ADD COLUMN IF NOT EXISTS r2_deleted_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS r2_cleanup_status text NOT NULL DEFAULT 'not_started'
    CHECK (r2_cleanup_status IN ('not_started', 'partial', 'completed'));
