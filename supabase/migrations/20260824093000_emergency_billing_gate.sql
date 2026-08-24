-- Enforce the Emergency Episode billing gate at the database boundary.
-- A normal invoice must not bypass a pending emergency billing draft.
CREATE OR REPLACE FUNCTION public.prevent_invoice_before_emergency_billing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.snap_orders so
     WHERE so.patient_id = (new).patient_id
       AND so.intent = 'emergency_billing_draft'
       AND so.status = 'pending_billing'
  )
  AND COALESCE((new).notes, '') NOT ILIKE 'Emergency Episode%'
  AND COALESCE((new).notes, '') NOT ILIKE 'Auto-finalized Emergency Episode%'
  THEN
    RAISE EXCEPTION 'EMERGENCY_BILLING_REQUIRED: complete the Emergency Episode Billing draft before creating another invoice';
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS invoices_require_emergency_billing ON public.invoices;
CREATE TRIGGER invoices_require_emergency_billing
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.prevent_invoice_before_emergency_billing();

GRANT EXECUTE ON FUNCTION public.prevent_invoice_before_emergency_billing() TO authenticated;
