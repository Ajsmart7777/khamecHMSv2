CREATE OR REPLACE FUNCTION public.mark_invoice_claim_settled(_invoice_id uuid, _notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _inv public.invoices%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.has_role(_uid, 'admin'::app_role) OR public.has_role(_uid, 'claims_manager'::app_role)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT * INTO _inv FROM public.invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice not found';
  END IF;

  IF _inv.status = 'paid' AND _inv.paid_amount >= _inv.total_amount THEN
    RETURN jsonb_build_object('ok', true, 'already_settled', true, 'invoice_id', _invoice_id);
  END IF;

  UPDATE public.invoices
     SET paid_amount = total_amount,
         status = 'paid',
         payment_method = COALESCE(payment_method, 'sponsor_claim'),
         paid_at = COALESCE(paid_at, now()),
         claim_submitted_at = COALESCE(claim_submitted_at, now()),
         claim_submitted_by = COALESCE(claim_submitted_by, _uid),
         claim_submission_notes = COALESCE(_notes, claim_submission_notes),
         updated_at = now()
   WHERE id = _invoice_id;

  INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, details, status, actor_role)
  VALUES (_uid, 'claim_invoice_settled', 'invoice', _invoice_id::text,
          jsonb_build_object('invoice_number', _inv.invoice_number,
                             'amount', _inv.total_amount,
                             'previous_paid', _inv.paid_amount,
                             'notes', _notes),
          'success', public.current_actor_role(_uid));

  RETURN jsonb_build_object('ok', true, 'invoice_id', _invoice_id, 'amount', _inv.total_amount);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_invoice_claim_settled(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_invoice_claim_settled(uuid, text) TO authenticated;