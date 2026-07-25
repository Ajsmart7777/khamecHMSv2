-- Sequences (start at 1; tables are currently empty)
CREATE SEQUENCE IF NOT EXISTS public.patients_card_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.visits_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.invoices_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.lab_requests_number_seq START 1;

-- Helper: PREFIX-### with growth beyond 999
CREATE OR REPLACE FUNCTION public.simple_id(_prefix text, _n bigint)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$ SELECT _prefix || '-' || lpad(_n::text, 3, '0'); $$;

-- Rewrite next_visit_number to simple format
CREATE OR REPLACE FUNCTION public.next_visit_number()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT public.simple_id('V', nextval('public.visits_number_seq')); $$;

-- Patients: fill card_number + mini_card_number if blank
CREATE OR REPLACE FUNCTION public.autofill_patient_card_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _n bigint; _num text;
BEGIN
  IF NEW.card_number IS NULL OR length(trim(NEW.card_number)) = 0 THEN
    _n := nextval('public.patients_card_seq');
    NEW.card_number := public.simple_id('P', _n);
    IF NEW.mini_card_number IS NULL OR length(trim(NEW.mini_card_number)) = 0 THEN
      NEW.mini_card_number := lpad(_n::text, 3, '0');
    END IF;
  ELSIF NEW.mini_card_number IS NULL OR length(trim(NEW.mini_card_number)) = 0 THEN
    NEW.mini_card_number := split_part(NEW.card_number, '-', 2);
    IF NEW.mini_card_number IS NULL OR length(NEW.mini_card_number) = 0 THEN
      NEW.mini_card_number := NEW.card_number;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS patients_autofill_card_number ON public.patients;
CREATE TRIGGER patients_autofill_card_number
BEFORE INSERT ON public.patients
FOR EACH ROW EXECUTE FUNCTION public.autofill_patient_card_number();

-- Invoices: fill invoice_number if blank
CREATE OR REPLACE FUNCTION public.autofill_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.invoice_number IS NULL OR length(trim(NEW.invoice_number)) = 0 THEN
    NEW.invoice_number := public.simple_id('INV', nextval('public.invoices_number_seq'));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS invoices_autofill_number ON public.invoices;
CREATE TRIGGER invoices_autofill_number
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.autofill_invoice_number();

-- Lab requests: fill request_number if blank
CREATE OR REPLACE FUNCTION public.autofill_lab_request_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.request_number IS NULL OR length(trim(NEW.request_number)) = 0 THEN
    NEW.request_number := public.simple_id('LAB', nextval('public.lab_requests_number_seq'));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS lab_requests_autofill_number ON public.lab_requests;
CREATE TRIGGER lab_requests_autofill_number
BEFORE INSERT ON public.lab_requests
FOR EACH ROW EXECUTE FUNCTION public.autofill_lab_request_number();