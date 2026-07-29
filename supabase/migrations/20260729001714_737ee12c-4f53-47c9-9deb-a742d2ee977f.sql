
CREATE OR REPLACE FUNCTION public.purge_clinical_data(_modules text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _result jsonb := '{}'::jsonb;
  _n bigint;
  _has text[] := _modules;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can purge clinical data';
  END IF;

  -- Order: dependents first
  IF 'tasks' = ANY(_has) THEN
    DELETE FROM public.task_claims; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('task_claims', _n);
  END IF;

  IF 'notifications' = ANY(_has) THEN
    DELETE FROM public.notifications; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('notifications', _n);
  END IF;

  IF 'errors' = ANY(_has) THEN
    DELETE FROM public.error_logs; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('error_logs', _n);
  END IF;

  IF 'audit' = ANY(_has) THEN
    DELETE FROM public.audit_logs; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('audit_logs', _n);
  END IF;

  IF 'lab' = ANY(_has) THEN
    DELETE FROM public.lab_requests; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('lab_requests', _n);
  END IF;

  IF 'prescriptions' = ANY(_has) THEN
    DELETE FROM public.prescription_items; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('prescription_items', _n);
    DELETE FROM public.prescriptions; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('prescriptions', _n);
  END IF;

  IF 'billing' = ANY(_has) THEN
    DELETE FROM public.invoice_items; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('invoice_items', _n);
    DELETE FROM public.sponsor_statement_items; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('sponsor_statement_items', _n);
    DELETE FROM public.sponsor_statements; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('sponsor_statements', _n);
    DELETE FROM public.insurance_claims; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('insurance_claims', _n);
    DELETE FROM public.corporate_transactions; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('corporate_transactions', _n);
    DELETE FROM public.balance_transactions; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('balance_transactions', _n);
    DELETE FROM public.balance_requests; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('balance_requests', _n);
    DELETE FROM public.invoices; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('invoices', _n);
  END IF;

  IF 'snaps' = ANY(_has) THEN
    DELETE FROM public.snap_orders; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('snap_orders', _n);
  END IF;

  IF 'admissions' = ANY(_has) THEN
    DELETE FROM public.admissions; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('admissions', _n);
    UPDATE public.beds SET status = 'available' WHERE status <> 'available';
    GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('beds_reset', _n);
  END IF;

  IF 'anc' = ANY(_has) THEN
    DELETE FROM public.anc_visits; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('anc_visits', _n);
    DELETE FROM public.anc_programs; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('anc_programs', _n);
  END IF;

  IF 'visits' = ANY(_has) THEN
    DELETE FROM public.visit_attachments; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('visit_attachments', _n);
    DELETE FROM public.emr_attachments; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('emr_attachments', _n);
    DELETE FROM public.vitals; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('vitals', _n);
    DELETE FROM public.patient_journey_history; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('patient_journey_history', _n);
    DELETE FROM public.patient_journey; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('patient_journey', _n);
    DELETE FROM public.visits; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('visits', _n);
  END IF;

  IF 'patients' = ANY(_has) THEN
    DELETE FROM public.patients; GET DIAGNOSTICS _n = ROW_COUNT;
    _result := _result || jsonb_build_object('patients', _n);
  END IF;

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_clinical_data(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_clinical_data(text[]) TO authenticated;
