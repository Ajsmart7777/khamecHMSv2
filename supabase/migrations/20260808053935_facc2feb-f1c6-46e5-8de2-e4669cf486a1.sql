-- Consolidated patient deletion logic with safety checks
DO $$ 
BEGIN
    -- Patient Deletion Policies (Safely drop and recreate)
    DROP POLICY IF EXISTS "Admins and reception can delete patients" ON public.patients;
    DROP POLICY IF EXISTS "Only admins can delete patients" ON public.patients;
    
    CREATE POLICY "Admins and reception can delete patients"
    ON public.patients
    FOR DELETE
    TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin') OR 
      public.has_role(auth.uid(), 'receptionist')
    );

    -- Cascade delete constraints for related tables
    -- Invoices
    ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_patient_id_fkey;
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Admissions
    ALTER TABLE public.admissions DROP CONSTRAINT IF EXISTS admissions_patient_id_fkey;
    ALTER TABLE public.admissions ADD CONSTRAINT admissions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Balance transactions
    ALTER TABLE public.balance_transactions DROP CONSTRAINT IF EXISTS balance_transactions_patient_id_fkey;
    ALTER TABLE public.balance_transactions ADD CONSTRAINT balance_transactions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Snap orders
    ALTER TABLE public.snap_orders DROP CONSTRAINT IF EXISTS snap_orders_patient_id_fkey;
    ALTER TABLE public.snap_orders ADD CONSTRAINT snap_orders_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Visits
    ALTER TABLE public.visits DROP CONSTRAINT IF EXISTS visits_patient_id_fkey;
    ALTER TABLE public.visits ADD CONSTRAINT visits_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Vitals
    ALTER TABLE public.vitals DROP CONSTRAINT IF EXISTS vitals_patient_id_fkey;
    ALTER TABLE public.vitals ADD CONSTRAINT vitals_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Lab Requests
    ALTER TABLE public.lab_requests DROP CONSTRAINT IF EXISTS lab_requests_patient_id_fkey;
    ALTER TABLE public.lab_requests ADD CONSTRAINT lab_requests_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Audit Logs / Journey
    ALTER TABLE public.patient_journey DROP CONSTRAINT IF EXISTS patient_journey_patient_id_fkey;
    ALTER TABLE public.patient_journey ADD CONSTRAINT patient_journey_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Eligibility
    ALTER TABLE public.eligibility_verifications DROP CONSTRAINT IF EXISTS eligibility_verifications_patient_id_fkey;
    ALTER TABLE public.eligibility_verifications ADD CONSTRAINT eligibility_verifications_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;
    
    ALTER TABLE public.eligibility_verifications DROP CONSTRAINT IF EXISTS eligibility_verifications_consumed_patient_id_fkey;
    ALTER TABLE public.eligibility_verifications ADD CONSTRAINT eligibility_verifications_consumed_patient_id_fkey FOREIGN KEY (consumed_patient_id) REFERENCES public.patients(id) ON DELETE SET NULL;

    -- EMR / Attachments
    ALTER TABLE public.emr_attachments DROP CONSTRAINT IF EXISTS emr_attachments_patient_id_fkey;
    ALTER TABLE public.emr_attachments ADD CONSTRAINT emr_attachments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;
    
    ALTER TABLE public.visit_attachments DROP CONSTRAINT IF EXISTS visit_attachments_patient_id_fkey;
    ALTER TABLE public.visit_attachments ADD CONSTRAINT visit_attachments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Insurance / Statements
    ALTER TABLE public.insurance_claims DROP CONSTRAINT IF EXISTS insurance_claims_patient_id_fkey;
    ALTER TABLE public.insurance_claims ADD CONSTRAINT insurance_claims_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    ALTER TABLE public.sponsor_statement_items DROP CONSTRAINT IF EXISTS sponsor_statement_items_patient_id_fkey;
    ALTER TABLE public.sponsor_statement_items ADD CONSTRAINT sponsor_statement_items_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Staff links
    ALTER TABLE public.staff_family_members DROP CONSTRAINT IF EXISTS staff_family_members_patient_id_fkey;
    ALTER TABLE public.staff_family_members ADD CONSTRAINT staff_family_members_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;

    -- Standing orders
    ALTER TABLE public.standing_orders DROP CONSTRAINT IF EXISTS standing_orders_patient_id_fkey;
    ALTER TABLE public.standing_orders ADD CONSTRAINT standing_orders_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;
    
    -- Balance Requests
    ALTER TABLE public.balance_requests DROP CONSTRAINT IF EXISTS balance_requests_patient_id_fkey;
    ALTER TABLE public.balance_requests ADD CONSTRAINT balance_requests_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;
END $$;

GRANT DELETE ON public.patients TO authenticated;
GRANT ALL ON public.patients TO service_role;
