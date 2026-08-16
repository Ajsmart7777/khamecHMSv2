-- SOURCE: 20260724122530_16461ee3-c7ab-410f-8244-d41708978487.sql statement 6
CREATE OR REPLACE FUNCTION public.reopen_claim(_visit_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _v RECORD;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['claims_manager','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only claims manager or admin can reopen a claim';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  SELECT * INTO _v FROM public.visits WHERE id = _visit_id FOR UPDATE;
  IF _v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF _v.claim_status NOT IN ('settled','rejected','info_requested') THEN
    RAISE EXCEPTION 'Claim is not in a reopenable state (current: %)', _v.claim_status;
  END IF;

  UPDATE public.visits
     SET claim_status = 'pending',
         claim_settled_at = NULL,
         claim_settled_by = NULL,
         claim_reason_code = NULL,
         claim_notes = COALESCE(claim_notes,'') || E'\n[reopened] ' || _reason,
         claim_last_action_at = now(),
         claim_last_action_by = auth.uid(),
         updated_at = now()
   WHERE id = _visit_id;

  PERFORM public.write_audit_log(
    'claim_reopened', 'visit', _visit_id::text,
    jsonb_build_object('reason', _reason, 'from_status', _v.claim_status)
  );
END;
$$;

-- SOURCE: 20260724141846_5e6728ee-d8f9-4de3-9d87-a1cc907d587b.sql statement 1
-- prescriptions
DROP POLICY IF EXISTS "Doctors can insert prescriptions" ON public.prescriptions;

-- SOURCE: 20260724141846_5e6728ee-d8f9-4de3-9d87-a1cc907d587b.sql statement 2
DROP POLICY IF EXISTS "Doctors and pharmacists can update prescriptions" ON public.prescriptions;

-- SOURCE: 20260724141846_5e6728ee-d8f9-4de3-9d87-a1cc907d587b.sql statement 3
DROP POLICY IF EXISTS "Doctors and admins can delete prescriptions" ON public.prescriptions;

-- SOURCE: 20260724141846_5e6728ee-d8f9-4de3-9d87-a1cc907d587b.sql statement 4
CREATE POLICY "Doctors can insert prescriptions" ON public.prescriptions
  FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','admin']::app_role[]));

-- SOURCE: 20260724141846_5e6728ee-d8f9-4de3-9d87-a1cc907d587b.sql statement 5
CREATE POLICY "Doctors and pharmacists can update prescriptions" ON public.prescriptions
  FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','pharmacist','admin']::app_role[]));

-- SOURCE: 20260724141846_5e6728ee-d8f9-4de3-9d87-a1cc907d587b.sql statement 6
CREATE POLICY "Doctors and admins can delete prescriptions" ON public.prescriptions
  FOR DELETE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','admin']::app_role[]));

-- SOURCE: 20260724141846_5e6728ee-d8f9-4de3-9d87-a1cc907d587b.sql statement 7
DROP POLICY IF EXISTS "Doctors can insert prescription_items" ON public.prescription_items;

-- SOURCE: 20260724141846_5e6728ee-d8f9-4de3-9d87-a1cc907d587b.sql statement 8
DROP POLICY IF EXISTS "Doctors and pharmacists can update prescription_items" ON public.prescription_items;

-- SOURCE: 20260724141846_5e6728ee-d8f9-4de3-9d87-a1cc907d587b.sql statement 9
DROP POLICY IF EXISTS "Clinical staff can delete prescription items" ON public.prescription_items;

-- SOURCE: 20260724141846_5e6728ee-d8f9-4de3-9d87-a1cc907d587b.sql statement 10
CREATE POLICY "Doctors can insert prescription_items" ON public.prescription_items
  FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','admin']::app_role[]));

-- SOURCE: 20260724141846_5e6728ee-d8f9-4de3-9d87-a1cc907d587b.sql statement 11
CREATE POLICY "Doctors and pharmacists can update prescription_items" ON public.prescription_items
  FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','pharmacist','admin']::app_role[]));

-- SOURCE: 20260724141846_5e6728ee-d8f9-4de3-9d87-a1cc907d587b.sql statement 12
CREATE POLICY "Clinical staff can delete prescription items" ON public.prescription_items
  FOR DELETE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','pharmacist','admin']::app_role[]));

-- SOURCE: 20260724141846_5e6728ee-d8f9-4de3-9d87-a1cc907d587b.sql statement 13
DROP POLICY IF EXISTS "Doctors and lab_tech can insert lab_requests" ON public.lab_requests;

-- SOURCE: 20260724141846_5e6728ee-d8f9-4de3-9d87-a1cc907d587b.sql statement 14
DROP POLICY IF EXISTS "Doctors and lab_tech can update lab_requests" ON public.lab_requests;

-- SOURCE: 20260724141846_5e6728ee-d8f9-4de3-9d87-a1cc907d587b.sql statement 15
DROP POLICY IF EXISTS "Lab techs and admins can delete lab requests" ON public.lab_requests;

-- SOURCE: 20260724141846_5e6728ee-d8f9-4de3-9d87-a1cc907d587b.sql statement 16
CREATE POLICY "Doctors and lab_tech can insert lab_requests" ON public.lab_requests
  FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','lab_tech','admin']::app_role[]));

-- SOURCE: 20260724141846_5e6728ee-d8f9-4de3-9d87-a1cc907d587b.sql statement 17
CREATE POLICY "Doctors and lab_tech can update lab_requests" ON public.lab_requests
  FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','lab_tech','admin']::app_role[]));

-- SOURCE: 20260724141846_5e6728ee-d8f9-4de3-9d87-a1cc907d587b.sql statement 18
CREATE POLICY "Lab techs and admins can delete lab requests" ON public.lab_requests
  FOR DELETE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['lab_tech','admin']::app_role[]));

-- SOURCE: 20260724141846_5e6728ee-d8f9-4de3-9d87-a1cc907d587b.sql statement 19
CREATE OR REPLACE FUNCTION public.close_visit(_visit_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _v RECORD;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['billing','cashier','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only billing/cashier/admin can settle a visit';
  END IF;
  PERFORM public.recalc_visit_totals(_visit_id);
  SELECT * INTO _v FROM public.visits WHERE id = _visit_id;
  IF _v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF _v.status <> 'open' THEN RAISE EXCEPTION 'Visit is already %', _v.status; END IF;

  UPDATE public.visits
    SET status = 'settled', closed_at = now(), closed_by = auth.uid(), updated_at = now()
  WHERE id = _visit_id;

  PERFORM public.write_audit_log(
    'visit_settled', 'visit', _visit_id::text,
    jsonb_build_object(
      'visit_number', _v.visit_number,
      'patient_id', _v.patient_id,
      'sponsor_type', _v.sponsor_type,
      'total_charged', _v.total_charged,
      'total_paid', _v.total_paid
    )
  );
END; $function$;

-- SOURCE: 20260724141946_d04999dd-b8b9-4428-9b37-c5115603b007.sql statement 1
CREATE OR REPLACE FUNCTION public.close_visit(_visit_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _v RECORD; _new_claim text;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['billing','cashier','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only billing/cashier/admin can settle a visit';
  END IF;
  PERFORM public.recalc_visit_totals(_visit_id);
  SELECT * INTO _v FROM public.visits WHERE id = _visit_id;
  IF _v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF _v.status <> 'open' THEN RAISE EXCEPTION 'Visit is already %', _v.status; END IF;

  -- Auto-flip claim_status to 'pending' for sponsored/insured visits with charges.
  _new_claim := _v.claim_status;
  IF _v.claim_status = 'not_applicable'
     AND COALESCE(_v.total_charged, 0) > 0
     AND _v.sponsor_type IS NOT NULL
     AND lower(_v.sponsor_type) IN ('katchma','nhis','nhia','hmo','corporate','retainer','staff')
  THEN
    _new_claim := 'pending';
  END IF;

  UPDATE public.visits
    SET status = 'settled',
        closed_at = now(),
        closed_by = auth.uid(),
        claim_status = _new_claim,
        claim_last_action_at = CASE WHEN _new_claim <> _v.claim_status THEN now() ELSE claim_last_action_at END,
        claim_last_action_by = CASE WHEN _new_claim <> _v.claim_status THEN auth.uid() ELSE claim_last_action_by END,
        updated_at = now()
  WHERE id = _visit_id;

  PERFORM public.write_audit_log(
    'visit_settled', 'visit', _visit_id::text,
    jsonb_build_object(
      'visit_number', _v.visit_number,
      'patient_id', _v.patient_id,
      'sponsor_type', _v.sponsor_type,
      'total_charged', _v.total_charged,
      'total_paid', _v.total_paid,
      'claim_status', _new_claim
    )
  );
END; $function$;

-- SOURCE: 20260724150157_15f9a144-77ae-4962-b3d4-145176d58549.sql statement 1
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

-- SOURCE: 20260724150157_15f9a144-77ae-4962-b3d4-145176d58549.sql statement 2
DROP TRIGGER IF EXISTS trg_cancel_visit_invoices ON public.visits;

-- SOURCE: 20260724150157_15f9a144-77ae-4962-b3d4-145176d58549.sql statement 3
CREATE TRIGGER trg_cancel_visit_invoices
AFTER UPDATE OF status ON public.visits
FOR EACH ROW EXECUTE FUNCTION public.cancel_visit_invoices();

-- SOURCE: 20260724150157_15f9a144-77ae-4962-b3d4-145176d58549.sql statement 4
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

-- SOURCE: 20260724150157_15f9a144-77ae-4962-b3d4-145176d58549.sql statement 5
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

-- SOURCE: 20260724150157_15f9a144-77ae-4962-b3d4-145176d58549.sql statement 6
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

-- SOURCE: 20260724163918_6bbdbea5-5e8f-46b8-bd47-16db19619de3.sql statement 1
ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS sponsor_auth jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sponsor_auth_captured_at timestamptz;

-- SOURCE: 20260724163918_6bbdbea5-5e8f-46b8-bd47-16db19619de3.sql statement 2
ALTER TABLE public.insurance_providers
  ADD COLUMN IF NOT EXISTS hmo_code text;

-- SOURCE: 20260724163918_6bbdbea5-5e8f-46b8-bd47-16db19619de3.sql statement 3
CREATE INDEX IF NOT EXISTS idx_insurance_providers_hmo_code
  ON public.insurance_providers (hmo_code) WHERE hmo_code IS NOT NULL;

-- SOURCE: 20260724175033_def68729-97a2-4e4b-915f-3f123d225d20.sql statement 1
CREATE TABLE public.eligibility_verifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  sponsor_type text NOT NULL CHECK (sponsor_type IN ('nhis','hmo','katchma','corporate','retainer')),
  provider_id uuid REFERENCES public.insurance_providers(id) ON DELETE SET NULL,
  provider_name text,
  enrollee_id text,
  plan text,
  encounter_code text,
  encounter_code_captured_at timestamp with time zone,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  rejection_reason text,
  notes text,
  requested_by uuid REFERENCES neon_auth.user(id) ON DELETE SET NULL,
  verified_by uuid REFERENCES neon_auth.user(id) ON DELETE SET NULL,
  verified_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- SOURCE: 20260724175033_def68729-97a2-4e4b-915f-3f123d225d20.sql statement 2
CREATE INDEX idx_eligibility_status ON public.eligibility_verifications(status, created_at DESC);

-- SOURCE: 20260724175033_def68729-97a2-4e4b-915f-3f123d225d20.sql statement 3
CREATE INDEX idx_eligibility_patient ON public.eligibility_verifications(patient_id, created_at DESC);

-- SOURCE: 20260724175033_def68729-97a2-4e4b-915f-3f123d225d20.sql statement 4
GRANT SELECT, INSERT, UPDATE ON public.eligibility_verifications TO authenticated;

-- SOURCE: 20260724175033_def68729-97a2-4e4b-915f-3f123d225d20.sql statement 5
GRANT ALL ON public.eligibility_verifications TO service_role;

-- SOURCE: 20260724175033_def68729-97a2-4e4b-915f-3f123d225d20.sql statement 6
ALTER TABLE public.eligibility_verifications ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260724175033_def68729-97a2-4e4b-915f-3f123d225d20.sql statement 7
CREATE POLICY "staff_view_eligibility"
  ON public.eligibility_verifications FOR SELECT
  TO authenticated
  USING (public.is_authenticated_staff());

-- SOURCE: 20260724175033_def68729-97a2-4e4b-915f-3f123d225d20.sql statement 8
CREATE POLICY "staff_create_eligibility"
  ON public.eligibility_verifications FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['receptionist','claims_manager','admin']::app_role[])
  );

-- SOURCE: 20260724175033_def68729-97a2-4e4b-915f-3f123d225d20.sql statement 9
CREATE POLICY "claims_manager_update_eligibility"
  ON public.eligibility_verifications FOR UPDATE
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['claims_manager','admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['claims_manager','admin']::app_role[]));

-- SOURCE: 20260724175033_def68729-97a2-4e4b-915f-3f123d225d20.sql statement 10
CREATE TRIGGER eligibility_touch_updated_at
  BEFORE UPDATE ON public.eligibility_verifications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- SOURCE: 20260724192155_02cff5d0-6aa9-4a05-bb5d-324afcb0370c.sql statement 1
DROP POLICY IF EXISTS "Fulfillers update only paid snap orders" ON public.snap_orders;

-- SOURCE: 20260724192155_02cff5d0-6aa9-4a05-bb5d-324afcb0370c.sql statement 2
CREATE POLICY "Fulfillers update only paid snap orders"
ON public.snap_orders
FOR UPDATE
USING (
  status = 'paid'
  AND (
    (target_station = 'pharmacy' AND has_role(auth.uid(), 'pharmacist'::app_role))
    OR
    (target_station = 'lab' AND has_role(auth.uid(), 'lab_tech'::app_role))
  )
)
WITH CHECK (
  status = ANY (ARRAY['paid'::text, 'fulfilled'::text, 'rejected'::text])
  AND (
    (target_station = 'pharmacy' AND has_role(auth.uid(), 'pharmacist'::app_role))
    OR
    (target_station = 'lab' AND has_role(auth.uid(), 'lab_tech'::app_role))
  )
);

-- SOURCE: 20260724192155_02cff5d0-6aa9-4a05-bb5d-324afcb0370c.sql statement 3
CREATE OR REPLACE FUNCTION public.validate_staff_family_linkage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _acct text;
  _linked_staff uuid;
BEGIN
  SELECT account_type INTO _acct FROM public.patients WHERE id = NEW.patient_id;
  IF _acct IS NULL THEN
    RAISE EXCEPTION 'Patient % not found', NEW.patient_id;
  END IF;
  IF _acct <> 'staff_family' THEN
    RAISE EXCEPTION 'Patient % is not marked as staff_family (account_type=%)', NEW.patient_id, _acct;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.staff WHERE id = NEW.staff_id) THEN
    RAISE EXCEPTION 'Staff % not found', NEW.staff_id;
  END IF;

  SELECT staff_id INTO _linked_staff
    FROM public.staff_family_members
   WHERE patient_id = NEW.patient_id
     AND (TG_OP = 'INSERT' OR id <> NEW.id)
   LIMIT 1;
  IF _linked_staff IS NOT NULL AND _linked_staff <> NEW.staff_id THEN
    RAISE EXCEPTION 'Patient % is already linked to another staff member', NEW.patient_id;
  END IF;

  RETURN NEW;
END;
$$;

-- SOURCE: 20260724192155_02cff5d0-6aa9-4a05-bb5d-324afcb0370c.sql statement 4
DROP TRIGGER IF EXISTS trg_validate_staff_family_linkage ON public.staff_family_members;

-- SOURCE: 20260724192155_02cff5d0-6aa9-4a05-bb5d-324afcb0370c.sql statement 5
CREATE TRIGGER trg_validate_staff_family_linkage
BEFORE INSERT OR UPDATE ON public.staff_family_members
FOR EACH ROW EXECUTE FUNCTION public.validate_staff_family_linkage();

-- SOURCE: 20260724192306_83a01201-7e0f-45df-9f5a-f91dae2e2324.sql statement 1
CREATE POLICY "Uploader or admin update EMR attachments"
ON public.emr_attachments
FOR UPDATE
USING ((uploaded_by = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))
WITH CHECK ((uploaded_by = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260724192306_83a01201-7e0f-45df-9f5a-f91dae2e2324.sql statement 2
CREATE POLICY "Admin delete insurance_claims"
ON public.insurance_claims
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260724192855_8a4c51b1-58b2-4f08-a9f8-9ab6027bba9c.sql statement 1
CREATE OR REPLACE FUNCTION public.close_visit(_visit_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _v RECORD; _new_claim text;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['billing','cashier','accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only billing/cashier/admin can settle a visit';
  END IF;
  PERFORM public.recalc_visit_totals(_visit_id);
  SELECT * INTO _v FROM public.visits WHERE id = _visit_id;
  IF _v IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  IF _v.status <> 'open' THEN RAISE EXCEPTION 'Visit is already %', _v.status; END IF;

  -- Auto-flip claim_status to 'pending' only for external insurance schemes
  -- (NHIA, HMO, Katchma) and corporate/retainer sponsors that need reconciliation.
  -- Staff (fully free) and staff_family (50% payroll deduction) are NOT claims.
  _new_claim := _v.claim_status;
  IF _v.claim_status = 'not_applicable'
     AND COALESCE(_v.total_charged, 0) > 0
     AND _v.sponsor_type IS NOT NULL
     AND lower(_v.sponsor_type) IN ('katchma','nhis','nhia','hmo','corporate','retainer')
  THEN
    _new_claim := 'pending';
  END IF;

  UPDATE public.visits
    SET status = 'settled',
        closed_at = now(),
        closed_by = auth.uid(),
        claim_status = _new_claim,
        claim_last_action_at = CASE WHEN _new_claim <> _v.claim_status THEN now() ELSE claim_last_action_at END,
        claim_last_action_by = CASE WHEN _new_claim <> _v.claim_status THEN auth.uid() ELSE claim_last_action_by END,
        updated_at = now()
  WHERE id = _visit_id;

  PERFORM public.write_audit_log(
    'visit_settled', 'visit', _visit_id::text,
    jsonb_build_object(
      'visit_number', _v.visit_number,
      'patient_id', _v.patient_id,
      'sponsor_type', _v.sponsor_type,
      'total_charged', _v.total_charged,
      'total_paid', _v.total_paid,
      'claim_status', _new_claim
    )
  );
END; $function$;

-- SOURCE: 20260725081309_ca59b024-ed7b-47b4-955e-67eed5b89b9f.sql statement 1
DROP TRIGGER IF EXISTS trg_queue_family_deduction ON public.invoices;

-- SOURCE: 20260725081309_ca59b024-ed7b-47b4-955e-67eed5b89b9f.sql statement 2
DROP FUNCTION IF EXISTS public.queue_family_deduction_after_invoice() CASCADE;

-- SOURCE: 20260725092837_b24f9fd5-2d0e-46e6-b692-67a762e2a8bc.sql statement 1
ALTER TABLE public.eligibility_verifications
  ALTER COLUMN patient_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS prospective_patient_name text,
  ADD COLUMN IF NOT EXISTS prospective_patient_phone text,
  ADD COLUMN IF NOT EXISTS insurance_details text,
  ADD COLUMN IF NOT EXISTS reception_snap_path text,
  ADD COLUMN IF NOT EXISTS verification_snap_path text,
  ADD COLUMN IF NOT EXISTS verified_enrollee_id text,
  ADD COLUMN IF NOT EXISTS verified_plan text,
  ADD COLUMN IF NOT EXISTS verified_provider_name text,
  ADD COLUMN IF NOT EXISTS consumed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS consumed_patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL;

-- SOURCE: 20260725092837_b24f9fd5-2d0e-46e6-b692-67a762e2a8bc.sql statement 2
ALTER TABLE public.eligibility_verifications
  DROP CONSTRAINT IF EXISTS eligibility_has_subject;

-- SOURCE: 20260725092837_b24f9fd5-2d0e-46e6-b692-67a762e2a8bc.sql statement 3
ALTER TABLE public.eligibility_verifications
  ADD CONSTRAINT eligibility_has_subject
  CHECK (patient_id IS NOT NULL OR (prospective_patient_name IS NOT NULL AND length(trim(prospective_patient_name)) > 0));

-- SOURCE: 20260725093622_eabcdd6c-d383-43f7-a3b7-fe0b706bbd79.sql statement 1
ALTER TABLE public.insurance_providers
  ADD COLUMN IF NOT EXISTS member_id_fields JSONB NOT NULL DEFAULT '[]'::jsonb;

-- SOURCE: 20260725093622_eabcdd6c-d383-43f7-a3b7-fe0b706bbd79.sql statement 2
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS member_id_data JSONB;

-- SOURCE: 20260725093622_eabcdd6c-d383-43f7-a3b7-fe0b706bbd79.sql statement 3
ALTER TABLE public.eligibility_verifications
  ADD COLUMN IF NOT EXISTS member_id_data JSONB;

-- SOURCE: 20260725093622_eabcdd6c-d383-43f7-a3b7-fe0b706bbd79.sql statement 4
UPDATE public.insurance_providers
   SET member_id_fields = '[
     {"key":"enrollee_id","label":"NHIA Enrollee Number","required":true,"pattern":"","placeholder":"e.g. NHIA/2024/12345","primary":true},
     {"key":"dependant_id","label":"Dependant ID","required":false,"placeholder":"If dependant"},
     {"key":"plan_tier","label":"Plan Tier","required":false,"placeholder":"e.g. Formal Sector"}
   ]'::jsonb
 WHERE (member_id_fields IS NULL OR member_id_fields = '[]'::jsonb)
   AND (lower(name) LIKE '%nhia%' OR lower(name) LIKE '%nhis%');

-- SOURCE: 20260725093622_eabcdd6c-d383-43f7-a3b7-fe0b706bbd79.sql statement 5
UPDATE public.insurance_providers
   SET member_id_fields = '[
     {"key":"call_up_number","label":"Call-up Number","required":true,"placeholder":"e.g. NYSC/2024/1234","primary":true},
     {"key":"state_code","label":"State Code","required":true,"placeholder":"e.g. LA/23A/1234"},
     {"key":"batch","label":"Batch","required":false,"placeholder":"e.g. 2024 Batch A"}
   ]'::jsonb
 WHERE (member_id_fields IS NULL OR member_id_fields = '[]'::jsonb)
   AND lower(name) LIKE '%nysc%';

-- SOURCE: 20260725093622_eabcdd6c-d383-43f7-a3b7-fe0b706bbd79.sql statement 6
UPDATE public.insurance_providers
   SET member_id_fields = '[
     {"key":"enrollee_id","label":"Hygeia Enrollee ID","required":true,"primary":true},
     {"key":"pre_auth_token","label":"Pre-Auth / Token Number","required":false,"placeholder":"e.g. HYG-PA-778821"},
     {"key":"plan","label":"Plan","required":false}
   ]'::jsonb
 WHERE (member_id_fields IS NULL OR member_id_fields = '[]'::jsonb)
   AND lower(name) LIKE '%hygeia%';

-- SOURCE: 20260725093622_eabcdd6c-d383-43f7-a3b7-fe0b706bbd79.sql statement 7
UPDATE public.insurance_providers
   SET member_id_fields = '[
     {"key":"enrollee_id","label":"AXA Enrollee ID","required":true,"primary":true},
     {"key":"encounter_code","label":"Encounter Code / OTP","required":true,"placeholder":"e.g. AXA-OTP-8493021"},
     {"key":"plan","label":"Plan","required":false}
   ]'::jsonb
 WHERE (member_id_fields IS NULL OR member_id_fields = '[]'::jsonb)
   AND (lower(name) LIKE '%axa%' OR lower(name) LIKE '%mansard%');

-- SOURCE: 20260725093622_eabcdd6c-d383-43f7-a3b7-fe0b706bbd79.sql statement 8
UPDATE public.insurance_providers
   SET member_id_fields = '[
     {"key":"katchma_id","label":"KATCHMA ID","required":true,"primary":true},
     {"key":"plan","label":"Plan","required":false}
   ]'::jsonb
 WHERE (member_id_fields IS NULL OR member_id_fields = '[]'::jsonb)
   AND lower(name) LIKE '%katchma%';

-- SOURCE: 20260725110238_38028320-8fa4-45cc-b512-82bf95034217.sql statement 1
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS photo_path text;

-- SOURCE: 20260725113335_3fbf08c6-945a-4e5a-97a5-832d72b94af5.sql statement 1
ALTER TABLE public.patients REPLICA IDENTITY FULL;

-- SOURCE: 20260725113335_3fbf08c6-945a-4e5a-97a5-832d72b94af5.sql statement 2
ALTER TABLE public.balance_requests REPLICA IDENTITY FULL;

-- SOURCE: 20260725114843_e8b13480-40d9-41a1-84b6-e95f9802c58b.sql statement 1
CREATE OR REPLACE FUNCTION public.advance_journey(_patient_id uuid, _to_state text, _owner_role text DEFAULT NULL::text, _owner_user_id uuid DEFAULT NULL::uuid, _department text DEFAULT NULL::text, _location text DEFAULT NULL::text, _visit_id uuid DEFAULT NULL::uuid, _reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _existing public.patient_journey%ROWTYPE;
  _journey_id uuid;
  _visit uuid := _visit_id;
  _pending_station text;
  _open_visit RECORD;
BEGIN
  IF NOT public.is_authenticated_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _patient_id IS NULL OR _to_state IS NULL THEN
    RAISE EXCEPTION 'patient_id and to_state are required';
  END IF;

  IF _to_state = 'discharged' THEN
    _pending_station := public.patient_pending_workflow_station(_patient_id);
    IF _pending_station IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot discharge patient: pending workflow remains at %', _pending_station;
    END IF;

    -- NEW: refuse discharge while an open visit exists. The visit MUST be
    -- closed via Billing → Settle & Discharge (close_visit) so that insured
    -- visits auto-flip claim_status=pending and land in the Claims queue.
    SELECT id, visit_number, total_charged, total_paid
      INTO _open_visit
      FROM public.visits
     WHERE patient_id = _patient_id
       AND status = 'open'
     ORDER BY opened_at DESC
     LIMIT 1;
    IF _open_visit.id IS NOT NULL THEN
      RAISE EXCEPTION 'OPEN_VISIT: cannot discharge — visit % is still open. Settle it via Billing → Settle & Discharge first.', _open_visit.visit_number;
    END IF;
  END IF;

  IF _visit IS NULL THEN
    SELECT id INTO _visit FROM public.visits
     WHERE patient_id = _patient_id AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1;
  END IF;

  SELECT * INTO _existing FROM public.patient_journey
   WHERE patient_id = _patient_id FOR UPDATE;

  IF _existing.id IS NULL THEN
    INSERT INTO public.patient_journey
      (patient_id, visit_id, current_state, owner_role, owner_user_id, department, location)
    VALUES
      (_patient_id, _visit, _to_state, _owner_role, _owner_user_id, _department, _location)
    RETURNING id INTO _journey_id;

    INSERT INTO public.patient_journey_history
      (journey_id, patient_id, visit_id, from_state, to_state,
       from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
       department, location, actor_user_id, reason)
    VALUES
      (_journey_id, _patient_id, _visit, NULL, _to_state,
       NULL, _owner_role, NULL, _owner_user_id,
       _department, _location, _uid, _reason);
  ELSE
    _journey_id := _existing.id;
    UPDATE public.patient_journey SET
      visit_id      = COALESCE(_visit, visit_id),
      current_state = _to_state,
      owner_role    = _owner_role,
      owner_user_id = _owner_user_id,
      department    = _department,
      location      = _location,
      updated_at    = now()
    WHERE id = _journey_id;

    INSERT INTO public.patient_journey_history
      (journey_id, patient_id, visit_id, from_state, to_state,
       from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
       department, location, actor_user_id, reason)
    VALUES
      (_journey_id, _patient_id, COALESCE(_visit, _existing.visit_id),
       _existing.current_state, _to_state,
       _existing.owner_role, _owner_role,
       _existing.owner_user_id, _owner_user_id,
       _department, _location, _uid, _reason);
  END IF;

  BEGIN
    UPDATE public.patients
       SET status = _to_state, updated_at = now()
     WHERE id = _patient_id;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN _journey_id;
END;
$function$;

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 1
CREATE SEQUENCE IF NOT EXISTS public.patients_card_seq START 1;

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 2
CREATE SEQUENCE IF NOT EXISTS public.visits_number_seq START 1;

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 3
CREATE SEQUENCE IF NOT EXISTS public.invoices_number_seq START 1;

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 4
CREATE SEQUENCE IF NOT EXISTS public.lab_requests_number_seq START 1;

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 5
CREATE OR REPLACE FUNCTION public.simple_id(_prefix text, _n bigint)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$ SELECT _prefix || '-' || lpad(_n::text, 3, '0'); $$;

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 6
CREATE OR REPLACE FUNCTION public.next_visit_number()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT public.simple_id('V', nextval('public.visits_number_seq')); $$;

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 7
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

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 8
DROP TRIGGER IF EXISTS patients_autofill_card_number ON public.patients;

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 9
CREATE TRIGGER patients_autofill_card_number
BEFORE INSERT ON public.patients
FOR EACH ROW EXECUTE FUNCTION public.autofill_patient_card_number();

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 10
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

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 11
DROP TRIGGER IF EXISTS invoices_autofill_number ON public.invoices;

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 12
CREATE TRIGGER invoices_autofill_number
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.autofill_invoice_number();

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 13
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

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 14
DROP TRIGGER IF EXISTS lab_requests_autofill_number ON public.lab_requests;

-- SOURCE: 20260725153714_54ae38c5-2b04-4f9c-8f47-f6324d1ba9d8.sql statement 15
CREATE TRIGGER lab_requests_autofill_number
BEFORE INSERT ON public.lab_requests
FOR EACH ROW EXECUTE FUNCTION public.autofill_lab_request_number();
