
CREATE OR REPLACE FUNCTION public.reconcile_paid_snap_orders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  healed_snaps int := 0;
  healed_patients int := 0;
  r record;
  next_station text;
BEGIN
  -- 1) Heal snap orders stuck at awaiting_payment whose invoice is paid.
  WITH updated AS (
    UPDATE public.snap_orders s
       SET status = 'paid',
           paid_at = COALESCE(s.paid_at, now()),
           updated_at = now()
      FROM public.invoices i
     WHERE s.invoice_id = i.id
       AND s.status = 'awaiting_payment'
       AND i.status = 'paid'
    RETURNING s.id
  )
  SELECT count(*) INTO healed_snaps FROM updated;

  -- 2) Heal patients stuck at awaiting_payment when nothing is truly pending.
  FOR r IN
    SELECT p.id AS patient_id
      FROM public.patients p
     WHERE p.status = 'awaiting_payment'
       AND NOT EXISTS (
         SELECT 1 FROM public.invoices i
          WHERE i.patient_id = p.id
            AND i.status IN ('pending','partial')
       )
  LOOP
    next_station := public.patient_pending_workflow_station(r.patient_id);

    IF next_station IS NULL THEN
      UPDATE public.patients
         SET status = 'discharged', updated_at = now()
       WHERE id = r.patient_id;
    ELSIF next_station <> 'awaiting_payment' THEN
      UPDATE public.patients
         SET status = next_station, updated_at = now()
       WHERE id = r.patient_id;
    ELSE
      CONTINUE;
    END IF;

    healed_patients := healed_patients + 1;

    PERFORM public.write_audit_log(
      'patient_status_reconciled',
      'patient',
      r.patient_id::text,
      jsonb_build_object('new_status', COALESCE(next_station, 'discharged'), 'source', 'reconcile_paid_snap_orders'),
      'success'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'healed_snaps', healed_snaps,
    'healed_patients', healed_patients,
    'ran_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_paid_snap_orders() TO authenticated, service_role;

-- Schedule every 5 minutes via pg_cron
DO $$
BEGIN
  PERFORM cron.unschedule('reconcile-paid-snap-orders');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'reconcile-paid-snap-orders',
  '*/5 * * * *',
  $$SELECT public.reconcile_paid_snap_orders();$$
);
