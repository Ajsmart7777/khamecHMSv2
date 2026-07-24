
-- 1) Cascade visit cancellation to unpaid invoices
CREATE OR REPLACE FUNCTION public.cancel_visit_invoices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'cancelled'::visit_status AND OLD.status IS DISTINCT FROM 'cancelled'::visit_status THEN
    UPDATE public.invoices
       SET status = 'cancelled',
           notes  = COALESCE(notes,'') ||
                    CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\n' END ||
                    '[auto] visit ' || NEW.visit_number || ' was cancelled',
           updated_at = now()
     WHERE visit_id = NEW.id
       AND status IN ('pending','partial');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_visit_invoices ON public.visits;
CREATE TRIGGER trg_cancel_visit_invoices
AFTER UPDATE OF status ON public.visits
FOR EACH ROW EXECUTE FUNCTION public.cancel_visit_invoices();

-- Retroactively cancel unpaid invoices attached to already-cancelled visits
UPDATE public.invoices i
   SET status = 'cancelled',
       updated_at = now(),
       notes = COALESCE(i.notes,'') ||
               CASE WHEN COALESCE(i.notes,'') = '' THEN '' ELSE E'\n' END ||
               '[auto backfill] visit ' || v.visit_number || ' cancelled'
  FROM public.visits v
 WHERE i.visit_id = v.id
   AND v.status = 'cancelled'
   AND i.status IN ('pending','partial');

-- 2) Backfill sponsor tags on existing invoices from the patient record
UPDATE public.invoices i
   SET sponsor_type = CASE
         WHEN lower(coalesce(p.account_type,'')) = 'corporate' THEN 'corporate'
         WHEN lower(coalesce(p.account_type,'')) = 'retainer'  THEN 'retainer'
         WHEN lower(coalesce(p.account_type,'')) = 'insurance' THEN 'insurance'
         WHEN lower(coalesce(p.account_type,'')) IN ('hmo','katchma','nhia','nhis','staff')
              THEN lower(p.account_type)
         ELSE NULL
       END,
       corporate_account_id = CASE
         WHEN lower(coalesce(p.account_type,'')) IN ('corporate','retainer')
              THEN p.corporate_id
         ELSE i.corporate_account_id
       END,
       updated_at = now()
  FROM public.patients p
 WHERE i.patient_id = p.id
   AND i.sponsor_type IS NULL;

-- 3) Fix Umar Sanusi's stuck visit + journey
DO $$
DECLARE
  v_visit uuid;
  v_pid   uuid := '86d012e8-a2a6-43c3-ac12-095027db6d1f';
BEGIN
  SELECT id INTO v_visit
    FROM public.visits
   WHERE patient_id = v_pid AND status = 'open'
   ORDER BY opened_at DESC LIMIT 1;

  IF v_visit IS NOT NULL THEN
    UPDATE public.visits
       SET status = 'settled',
           closed_at = now(),
           claim_status = CASE
             WHEN COALESCE(total_charged,0) > 0 AND sponsor_type IS NOT NULL
                  AND lower(sponsor_type) IN ('katchma','nhis','nhia','hmo','corporate','retainer','staff','insurance')
               THEN 'pending'
             ELSE claim_status
           END,
           claim_last_action_at = now(),
           updated_at = now()
     WHERE id = v_visit;
  END IF;

  UPDATE public.patient_journey
     SET current_state = 'discharged',
         owner_role    = NULL,
         owner_user_id = NULL,
         department    = NULL,
         location      = NULL,
         updated_at    = now()
   WHERE patient_id = v_pid;

  INSERT INTO public.patient_journey_history
    (journey_id, patient_id, visit_id, from_state, to_state,
     from_owner_role, to_owner_role, reason)
  SELECT id, patient_id, visit_id, 'at_pharmacy', 'discharged',
         'pharmacist', NULL, 'manual fix: pharmacy snap fulfilled, invoice paid'
    FROM public.patient_journey WHERE patient_id = v_pid;

  UPDATE public.patients SET status = 'discharged', updated_at = now() WHERE id = v_pid;
END $$;
