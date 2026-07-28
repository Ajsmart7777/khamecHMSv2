CREATE OR REPLACE FUNCTION public.snap_orders_sync_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Advance the linked snap to "paid" as soon as the invoice is marked paid,
  -- regardless of whether the money came from the patient or a sponsor claim.
  IF NEW.status = 'paid'
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.status, '') <> 'paid') THEN
    UPDATE public.snap_orders
       SET status = 'paid', paid_at = now(), updated_at = now()
     WHERE invoice_id = NEW.id
       AND status IN ('awaiting_payment', 'pending_billing');
  END IF;
  RETURN NEW;
END;
$$;

-- Heal any snaps that got stuck under the old trigger definition.
UPDATE public.snap_orders so
   SET status = 'paid', paid_at = COALESCE(so.paid_at, now()), updated_at = now()
  FROM public.invoices i
 WHERE so.invoice_id = i.id
   AND i.status = 'paid'
   AND so.status IN ('awaiting_payment', 'pending_billing');