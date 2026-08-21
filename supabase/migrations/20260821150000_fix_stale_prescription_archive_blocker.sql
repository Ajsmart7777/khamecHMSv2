-- Repair false archive blockers caused by legacy prescription rows that remained pending
-- after the corresponding pharmacy snap workflow was fulfilled.
--
-- The data correction is intentionally narrow: it requires a discharged patient,
-- a visit-linked prescription, at least one fulfilled prescription snap, and a
-- fulfilled-snap count that covers every prescription for that patient and visit.
-- A genuinely pending prescription therefore remains a blocker.

UPDATE public.prescriptions pr
SET status = 'dispensed',
    updated_at = now()
WHERE pr.status::text = 'pending'
  AND pr.visit_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.patients p
    WHERE p.id = pr.patient_id
      AND p.status::text = 'discharged'
  )
  AND EXISTS (
    SELECT 1
    FROM public.patient_journey pj
    WHERE pj.patient_id = pr.patient_id
      AND pj.current_state::text = 'discharged'
  )
  AND (
    SELECT count(*)
    FROM public.prescriptions pr_all
    WHERE pr_all.patient_id = pr.patient_id
      AND pr_all.visit_id = pr.visit_id
  ) <= (
    SELECT count(*)
    FROM public.snap_orders so
    WHERE so.patient_id = pr.patient_id
      AND so.visit_id = pr.visit_id
      AND so.order_type::text = 'prescription'
      AND so.status::text = 'fulfilled'
  )
  AND EXISTS (
    SELECT 1
    FROM public.snap_orders so
    WHERE so.patient_id = pr.patient_id
      AND so.visit_id = pr.visit_id
      AND so.order_type::text = 'prescription'
      AND so.status::text = 'fulfilled'
  );

-- The migration builder replaces this marker with the complete
-- CockroachDB-compatible implementation in build_cockroach_migrations.py.
CREATE OR REPLACE FUNCTION public.check_archive_eligibility(_patient_ids uuid[])
RETURNS TABLE (
  patient_id uuid,
  patient_card_number text,
  patient_name text,
  is_eligible boolean,
  reasons text[],
  closed_at timestamptz,
  row_counts jsonb,
  attachment_paths jsonb,
  case_fingerprint text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN;
END;
$$;
