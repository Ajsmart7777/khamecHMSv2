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

GRANT SELECT, INSERT, UPDATE ON public.staff_deduction_batches TO authenticated;
GRANT ALL ON public.staff_deduction_batches TO service_role;

ALTER TABLE public.staff_deduction_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view deduction batches"
ON public.staff_deduction_batches FOR SELECT TO authenticated
USING (public.is_authenticated_staff());

CREATE POLICY "Accountants can create deduction batches"
ON public.staff_deduction_batches FOR INSERT TO authenticated
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::public.app_role[]));

CREATE POLICY "Accountants can update deduction batches"
ON public.staff_deduction_batches FOR UPDATE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::public.app_role[]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','accountant']::public.app_role[]));

ALTER TABLE public.invoices
  ADD COLUMN salary_deduction_batch_id uuid REFERENCES public.staff_deduction_batches(id);

CREATE INDEX idx_invoices_salary_deduction_batch
  ON public.invoices (salary_deduction_batch_id)
  WHERE is_salary_deduction = true;

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

GRANT EXECUTE ON FUNCTION public.close_family_deduction_batch(uuid[], integer, integer, text) TO authenticated;