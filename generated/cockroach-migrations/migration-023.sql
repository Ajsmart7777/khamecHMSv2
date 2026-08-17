-- SOURCE: 20260815173500_harden_discharge_archive_consistency.sql statement 7
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) TO authenticated;

-- SOURCE: 20260815174000_enforce_discharge_consistency_trigger.sql statement 1
CREATE OR REPLACE FUNCTION public.check_patient_discharge_eligibility()
RETURNS TRIGGER AS $$
DECLARE
  _pending_station text;
  _open_visit_id uuid;
  _active_adm_id uuid;
  _pending_inv_id uuid;
BEGIN
  -- Only run check when status is changing to 'discharged'
  IF (NEW).status = 'discharged' AND ((OLD).status IS NULL OR (OLD).status <> 'discharged') THEN
    
    -- 1. Check for pending workflow stations (Labs, Pharmacy, Billing)
    -- This uses the hardened function that checks snap_orders, lab_requests, and prescriptions.
    _pending_station := public.patient_pending_workflow_station((NEW).id);
    IF _pending_station IS NOT NULL THEN
      RAISE EXCEPTION 'CANNOT_DISCHARGE: patient has pending workflow at %', _pending_station;
    END IF;

    -- 2. Check for open visits
    SELECT id INTO _open_visit_id
    FROM public.visits
    WHERE patient_id = (NEW).id AND status = 'open'
    LIMIT 1;
    IF _open_visit_id IS NOT NULL THEN
      RAISE EXCEPTION 'CANNOT_DISCHARGE: patient has an open visit (ID: %)', _open_visit_id;
    END IF;

    -- 3. Check for active admissions
    SELECT id INTO _active_adm_id
    FROM public.admissions
    WHERE patient_id = (NEW).id
      AND status IN ('waiting_assignment', 'active', 'ready_for_discharge')
    LIMIT 1;
    IF _active_adm_id IS NOT NULL THEN
      RAISE EXCEPTION 'CANNOT_DISCHARGE: patient has an active admission (ID: %)', _active_adm_id;
    END IF;

    -- 4. Check for unpaid invoices
    SELECT id INTO _pending_inv_id
    FROM public.invoices
    WHERE patient_id = (NEW).id AND status IN ('pending', 'partial')
    LIMIT 1;
    IF _pending_inv_id IS NOT NULL THEN
      RAISE EXCEPTION 'CANNOT_DISCHARGE: patient has unpaid or partial invoices';
    END IF;

  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- SOURCE: 20260815174000_enforce_discharge_consistency_trigger.sql statement 2
DROP TRIGGER IF EXISTS tr_check_patient_discharge_eligibility ON public.patients;

-- SOURCE: 20260815174000_enforce_discharge_consistency_trigger.sql statement 3
CREATE TRIGGER tr_check_patient_discharge_eligibility
BEFORE UPDATE ON public.patients
FOR EACH ROW
EXECUTE FUNCTION public.check_patient_discharge_eligibility();

-- SOURCE: 20260815174000_enforce_discharge_consistency_trigger.sql statement 4
CREATE OR REPLACE FUNCTION public.check_journey_discharge_eligibility()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW).current_state = 'discharged' AND ((OLD).current_state IS NULL OR (OLD).current_state <> 'discharged') THEN
    -- We can just call the patient check logic or rely on the fact that 
    -- advance_journey updates both. However, a direct update to patient_journey
    -- should also be guarded.
    IF EXISTS (
      SELECT 1 FROM public.visits WHERE patient_id = (NEW).patient_id AND status = 'open'
    ) OR EXISTS (
      SELECT 1 FROM public.admissions WHERE patient_id = (NEW).patient_id AND status IN ('waiting_assignment', 'active', 'ready_for_discharge')
    ) OR public.patient_pending_workflow_station((NEW).patient_id) IS NOT NULL THEN
      RAISE EXCEPTION 'CANNOT_DISCHARGE: journey transition blocked by open visit or pending orders';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- SOURCE: 20260815174000_enforce_discharge_consistency_trigger.sql statement 5
DROP TRIGGER IF EXISTS tr_check_journey_discharge_eligibility ON public.patient_journey;

-- SOURCE: 20260815174000_enforce_discharge_consistency_trigger.sql statement 6
CREATE TRIGGER tr_check_journey_discharge_eligibility
BEFORE UPDATE ON public.patient_journey
FOR EACH ROW
EXECUTE FUNCTION public.check_journey_discharge_eligibility();

-- SOURCE: 20260816103000_include_patient_profile_photo_in_archive.sql statement 1
CREATE OR REPLACE FUNCTION public.patient_archive_case_fingerprint(_patient_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER

AS $$
  SELECT md5(concat_ws('|',
    COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id)::text FROM public.visits v WHERE v.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id)::text FROM public.admissions a WHERE a.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id)::text FROM public.invoices i WHERE i.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ii) ORDER BY ii.id)::text FROM public.invoice_items ii WHERE ii.invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = _patient_id)), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ssi) ORDER BY ssi.id)::text FROM public.sponsor_statement_items ssi WHERE ssi.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ic) ORDER BY ic.id)::text FROM public.insurance_claims ic WHERE ic.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(bt) ORDER BY bt.id)::text FROM public.balance_transactions bt WHERE bt.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(br) ORDER BY br.id)::text FROM public.balance_requests br WHERE br.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pr) ORDER BY pr.id)::text FROM public.prescriptions pr WHERE pr.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pi) ORDER BY pi.id)::text FROM public.prescription_items pi WHERE pi.prescription_id IN (SELECT id FROM public.prescriptions WHERE patient_id = _patient_id)), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(lr) ORDER BY lr.id)::text FROM public.lab_requests lr WHERE lr.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(vt) ORDER BY vt.id)::text FROM public.vitals vt WHERE vt.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(so) ORDER BY so.id)::text FROM public.snap_orders so WHERE so.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(sto) ORDER BY sto.id)::text FROM public.standing_orders sto WHERE sto.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(rl) ORDER BY rl.id)::text FROM public.referral_letters rl WHERE rl.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(va) ORDER BY va.id)::text FROM public.visit_attachments va WHERE va.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ea) ORDER BY ea.id)::text FROM public.emr_attachments ea WHERE ea.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ev) ORDER BY ev.id)::text FROM public.eligibility_verifications ev WHERE ev.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pjh) ORDER BY pjh.id)::text FROM public.patient_journey_history pjh WHERE pjh.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pj) ORDER BY pj.id)::text FROM public.patient_journey pj WHERE pj.patient_id = _patient_id), '[]'),
    COALESCE((SELECT p.photo_path::text FROM public.patients p WHERE p.id = _patient_id), '')
  ));
$$;

-- SOURCE: 20260816103000_include_patient_profile_photo_in_archive.sql statement 2
CREATE OR REPLACE FUNCTION public.attach_patient_profile_photo_to_archive_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  v_photo_path text;
BEGIN
  SELECT NULLIF(btrim(p.photo_path), '')
  INTO v_photo_path
  FROM public.patients p
  WHERE p.id = (NEW).patient_id;

  IF v_photo_path IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM jsonb_array_elements(COALESCE((NEW).attachment_paths, '[]'::jsonb)) item
       WHERE item ->> 'bucket' = 'patient-photos'
         AND item ->> 'path' = v_photo_path
     ) THEN NEW.attachment_paths := COALESCE((NEW).attachment_paths, '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object(
        'bucket', 'patient-photos',
        'path', v_photo_path,
        'source', 'patients.photo_path'
      ));
  END IF;

  RETURN NEW;
END;
$$;

-- SOURCE: 20260816103000_include_patient_profile_photo_in_archive.sql statement 3
DROP TRIGGER IF EXISTS patient_archive_profile_photo_manifest_trigger
  ON public.patient_archive_records;

-- SOURCE: 20260816103000_include_patient_profile_photo_in_archive.sql statement 4
CREATE TRIGGER patient_archive_profile_photo_manifest_trigger
BEFORE INSERT ON public.patient_archive_records
FOR EACH ROW
EXECUTE FUNCTION public.attach_patient_profile_photo_to_archive_record();

-- SOURCE: 20260816103000_include_patient_profile_photo_in_archive.sql statement 5
REVOKE ALL ON FUNCTION public.attach_patient_profile_photo_to_archive_record() FROM PUBLIC;
