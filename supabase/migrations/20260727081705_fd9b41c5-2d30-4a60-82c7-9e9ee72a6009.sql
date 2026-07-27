CREATE OR REPLACE FUNCTION public.reset_patient_history()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reset patient history';
  END IF;

  DELETE FROM public.invoice_items;
  DELETE FROM public.sponsor_statement_items;
  DELETE FROM public.sponsor_statements;
  DELETE FROM public.insurance_claims;
  DELETE FROM public.corporate_transactions;
  DELETE FROM public.balance_transactions;
  DELETE FROM public.balance_requests;
  DELETE FROM public.invoices;
  DELETE FROM public.prescription_items;
  DELETE FROM public.prescriptions;
  DELETE FROM public.lab_requests;
  DELETE FROM public.vitals;
  DELETE FROM public.snap_orders;
  DELETE FROM public.standing_orders;
  DELETE FROM public.visit_attachments;
  DELETE FROM public.emr_attachments;
  DELETE FROM public.eligibility_verifications;
  DELETE FROM public.patient_journey_history;
  DELETE FROM public.patient_journey;
  DELETE FROM public.admissions;
  DELETE FROM public.anc_visits;
  DELETE FROM public.anc_programs;
  DELETE FROM public.visits;

  UPDATE public.patients
     SET status = 'registered',
         last_visit = NULL,
         balance = 0;

  UPDATE public.corporate_accounts SET balance = 0;

  PERFORM public.write_audit_log('reset_patient_history', 'patients', NULL, NULL, 'success');
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_patient_history() TO authenticated;