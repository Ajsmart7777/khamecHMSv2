DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['visits','vitals','visit_attachments','snap_orders','invoices','invoice_items','admissions','patients'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
  END LOOP;
END $$;