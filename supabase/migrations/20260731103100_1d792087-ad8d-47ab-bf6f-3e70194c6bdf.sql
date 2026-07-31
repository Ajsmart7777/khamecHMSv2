DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['prescription_items','standing_orders','vitals','admissions','snap_orders','visit_attachments','balance_requests','rooms','stock_requests','visits','lab_requests','task_claims','invoice_items','patients','patient_journey','notifications','wards','prescriptions','invoices','eligibility_verifications','beds']
  LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY DEFAULT', t);
  END LOOP;
END $$;