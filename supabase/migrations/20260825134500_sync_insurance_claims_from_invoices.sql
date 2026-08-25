-- Ensure every billable insured invoice produces an eligible visit claim.
-- This repairs legacy visits where cashier settlement left claim_status as
-- not_applicable and total_charged at zero even though sponsored invoices exist.

CREATE OR REPLACE FUNCTION public.sync_insurance_claim_from_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_account_type text;
BEGIN
  SELECT lower(COALESCE(p.account_type, ''))
    INTO v_account_type
  FROM public.patients p
  WHERE p.id = (NEW).patient_id;

  IF (NEW).visit_id IS NOT NULL
     AND v_account_type IN ('hmo', 'nhis', 'nhia', 'katchma', 'insurance')
     AND lower(COALESCE((NEW).sponsor_type, '')) IN ('insurance', 'hmo', 'nhis', 'nhia', 'katchma')
     AND COALESCE((NEW).total_amount, 0) > 0
  THEN
    UPDATE public.visits v
       SET claim_status = CASE
                             WHEN v.claim_status IN ('settled', 'rejected') THEN v.claim_status
                             ELSE 'pending'
                           END,
           total_charged = COALESCE((
             SELECT SUM(COALESCE(i.total_amount, 0))
             FROM public.invoices i
             WHERE i.visit_id = (NEW).visit_id
               AND lower(COALESCE(i.status, '')) <> 'cancelled'
           ), 0),
           updated_at = now()
     WHERE v.id = (NEW).visit_id
       AND v.claim_status NOT IN ('settled', 'rejected');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_sync_insurance_claim ON public.invoices;
CREATE TRIGGER invoices_sync_insurance_claim
AFTER INSERT OR UPDATE
ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.sync_insurance_claim_from_invoice();

-- Backfill only open/unresolved claims. Settled and rejected history is never
-- reopened by this repair.
WITH insured_visit_totals AS (
  SELECT
    v.id AS visit_id,
    SUM(COALESCE(i.total_amount, 0)) AS total_charged
  FROM public.visits v
  JOIN public.patients p ON p.id = v.patient_id
  JOIN public.invoices i ON i.visit_id = v.id
  WHERE lower(COALESCE(p.account_type, '')) IN ('hmo', 'nhis', 'nhia', 'katchma', 'insurance')
    AND lower(COALESCE(i.sponsor_type, '')) IN ('insurance', 'hmo', 'nhis', 'nhia', 'katchma')
    AND lower(COALESCE(i.status, '')) <> 'cancelled'
    AND COALESCE(i.total_amount, 0) > 0
    AND v.claim_status NOT IN ('settled', 'rejected')
  GROUP BY v.id
)
UPDATE public.visits v
   SET claim_status = 'pending',
       total_charged = t.total_charged,
       updated_at = now()
  FROM insured_visit_totals t
 WHERE v.id = t.visit_id;

GRANT EXECUTE ON FUNCTION public.sync_insurance_claim_from_invoice() TO authenticated;
