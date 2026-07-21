CREATE OR REPLACE FUNCTION public.adjust_patient_balance(_patient_id uuid, _delta numeric, _transaction_type text, _payment_method text DEFAULT NULL::text, _related_request_id uuid DEFAULT NULL::uuid, _related_invoice_id uuid DEFAULT NULL::uuid, _notes text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _before NUMERIC;
  _after NUMERIC;
BEGIN
  SELECT balance INTO _before FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _before IS NULL THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;
  _after := _before + _delta;
  -- Only 'debt_incurred' transactions may push balance negative (short payments)
  IF _after < 0 AND _transaction_type <> 'debt_incurred' THEN
    RAISE EXCEPTION 'Insufficient balance (current: %, requested delta: %)', _before, _delta;
  END IF;
  UPDATE public.patients SET balance = _after, updated_at = now() WHERE id = _patient_id;
  INSERT INTO public.balance_transactions
    (patient_id, transaction_type, amount, balance_before, balance_after, payment_method, related_request_id, related_invoice_id, performed_by, notes)
  VALUES
    (_patient_id, _transaction_type, _delta, _before, _after, _payment_method, _related_request_id, _related_invoice_id, auth.uid(), _notes);
  RETURN _after;
END;
$function$;