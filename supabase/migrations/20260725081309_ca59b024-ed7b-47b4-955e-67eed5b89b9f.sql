DROP TRIGGER IF EXISTS trg_queue_family_deduction ON public.invoices;
DROP FUNCTION IF EXISTS public.queue_family_deduction_after_invoice() CASCADE;