DO $$ 
BEGIN
    -- 1. Patients Table Policies
    DROP POLICY IF EXISTS "Admins and reception can delete patients" ON public.patients;
    DROP POLICY IF EXISTS "Only admins can delete patients" ON public.patients;
    
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'patients') THEN
        CREATE POLICY "Admins and reception can delete patients"
        ON public.patients
        FOR DELETE
        TO authenticated
        USING (
          public.has_role(auth.uid(), 'admin') OR 
          public.has_role(auth.uid(), 'receptionist')
        );
        
        GRANT DELETE ON public.patients TO authenticated;
    END IF;

    -- 2. Cascade Delete Constraints
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_patient_id_fkey') THEN
        ALTER TABLE public.invoices DROP CONSTRAINT invoices_patient_id_fkey;
        ALTER TABLE public.invoices ADD CONSTRAINT invoices_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admissions_patient_id_fkey') THEN
        ALTER TABLE public.admissions DROP CONSTRAINT admissions_patient_id_fkey;
        ALTER TABLE public.admissions ADD CONSTRAINT admissions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;
    END IF;
END $$;