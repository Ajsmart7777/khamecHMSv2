DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'admissions','patients','visits','snap_orders','patient_journey','notifications',
    'beds','rooms','wards','invoices','invoice_items','lab_requests','prescriptions',
    'prescription_items','balance_requests','vitals','standing_orders','task_claims',
    'eligibility_verifications','stock_requests'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;