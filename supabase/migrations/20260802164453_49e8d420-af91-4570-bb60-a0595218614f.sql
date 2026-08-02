CREATE OR REPLACE FUNCTION public.apply_wallet_to_outstanding(_patient_id uuid, _note text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _p RECORD; _pct numeric; _credit numeric; _applied numeric := 0;
  _inv RECORD; _share numeric; _apply numeric;
BEGIN
  SELECT * INTO _p FROM public.patients WHERE id = _patient_id FOR UPDATE;
  IF _p IS NULL THEN RETURN 0; END IF;
  IF NOT public.has_wallet(_p.account_type) THEN RETURN 0; END IF;

  _credit := ROUND(GREATEST(COALESCE(_p.balance,0), 0), 2);
  IF _credit <= 0 THEN RETURN 0; END IF;

  _pct := public.copay_percent(_p.account_type, _p.insurance_plan);

  FOR _inv IN
    SELECT id, total_amount, COALESCE(paid_amount,0) AS paid
    FROM public.invoices
    WHERE patient_id = _patient_id AND status IN ('pending','partial')
    ORDER BY created_at ASC
  LOOP
    EXIT WHEN _credit <= 0;
    _share := ROUND(_inv.total_amount * _pct / 100.0, 2);
    _apply := ROUND(LEAST(_credit, GREATEST(0, _share - _inv.paid)), 2);
    CONTINUE WHEN _apply <= 0;

    UPDATE public.invoices
       SET paid_amount = _inv.paid + _apply,
           status = CASE WHEN _inv.paid + _apply >= _share THEN 'paid' ELSE 'partial' END,
           paid_at = CASE WHEN _inv.paid + _apply >= _share THEN now() ELSE paid_at END,
           payment_method = COALESCE(payment_method, 'wallet'),
           updated_at = now()
     WHERE id = _inv.id;

    PERFORM public.adjust_patient_balance(_patient_id, -_apply, 'invoice_deduction',
      'wallet', NULL, _inv.id, _note);

    _credit  := ROUND(_credit - _apply, 2);
    _applied := ROUND(_applied + _apply, 2);
  END LOOP;

  RETURN _applied;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.apply_wallet_to_outstanding(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_wallet_to_outstanding(uuid, text) TO authenticated;