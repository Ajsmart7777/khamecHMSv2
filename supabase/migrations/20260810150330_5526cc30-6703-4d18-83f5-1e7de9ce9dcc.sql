-- Pin search_path on trigger function and lock down direct execution
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

REVOKE ALL ON FUNCTION public.update_patient_reg_status() FROM PUBLIC, anon, authenticated;

-- Remove stale overload of onboarding invoice routine
DROP FUNCTION IF EXISTS public.create_onboarding_invoices(uuid, boolean, boolean, numeric);

-- Restrict privileged SECURITY DEFINER routines to signed-in users only
REVOKE ALL ON FUNCTION public.settle_invoice_atomic(uuid, numeric, numeric, numeric, text, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_invoice_atomic(uuid, numeric, numeric, numeric, text, text, boolean, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.check_monthly_consultation_paid(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_monthly_consultation_paid(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.create_onboarding_invoices(uuid, boolean, boolean, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_onboarding_invoices(uuid, boolean, boolean, numeric, boolean) TO authenticated;