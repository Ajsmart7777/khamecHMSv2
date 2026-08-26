-- Shared laboratory-result routing for Nurse, Doctor 1, and Doctor 2.
-- Returned-to remains audit data; visibility is shared through clinical_team.

UPDATE public.patients SET status = 'with_clinical_team' WHERE status = 'with_doctor';
UPDATE public.patient_journey
SET current_state = 'with_clinical_team', owner_role = 'clinical_team', updated_at = now()
WHERE current_state = 'with_doctor';
UPDATE public.user_roles SET role = 'doctor1'::public.app_role WHERE role::text = 'doctor';

CREATE OR REPLACE FUNCTION public.can_add_snap_for_patient(_patient_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _status text;
  _is_admitted boolean;
  _has_lab_return boolean;
  _has_paid_lab_req boolean;
  _has_paid_rx_req boolean;
  _user_role app_role;
BEGIN
  IF _user_id IS NULL OR _patient_id IS NULL THEN RETURN false; END IF;
  IF public.has_role(_user_id, 'admin'::app_role) THEN RETURN true; END IF;
  SELECT status::text INTO _status FROM public.patients WHERE id = _patient_id;
  IF _status IS NULL THEN RETURN false; END IF;
  SELECT role INTO _user_role FROM public.user_roles WHERE user_id = _user_id LIMIT 1;

  IF _user_role = 'lab_tech'::app_role THEN
    SELECT EXISTS (SELECT 1 FROM public.snap_orders WHERE patient_id = _patient_id AND target_station = 'lab' AND status = 'paid') INTO _has_paid_lab_req;
    IF _has_paid_lab_req THEN RETURN true; END IF;
  END IF;
  IF _user_role = 'pharmacist'::app_role THEN
    SELECT EXISTS (SELECT 1 FROM public.snap_orders WHERE patient_id = _patient_id AND target_station = 'pharmacy' AND status = 'paid') INTO _has_paid_rx_req;
    IF _has_paid_rx_req THEN RETURN true; END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.snap_orders
    WHERE patient_id = _patient_id
      AND order_type IN ('lab', 'lab_result')
      AND status = 'returned'
      AND target_station = 'clinical_team'
  ) INTO _has_lab_return;
  IF _has_lab_return THEN
    RETURN _user_role IN ('nurse'::app_role, 'doctor1'::app_role, 'doctor2'::app_role);
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.admissions WHERE patient_id = _patient_id AND status = 'active') INTO _is_admitted;
  IF _is_admitted OR _status = 'admitted' THEN
    RETURN _user_role IN ('nurse'::app_role, 'doctor1'::app_role, 'doctor2'::app_role);
  END IF;
  IF _user_role = 'nurse'::app_role AND _status IN ('waiting', 'with_nurse') THEN RETURN true; END IF;
  IF _user_role IN ('nurse'::app_role, 'doctor1'::app_role, 'doctor2'::app_role) AND _status IN ('with_clinical_team', 'awaiting_billing') THEN RETURN true; END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.acknowledge_clinical_team_lab_results(_patient_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := public.hms_current_user_id();
  _count integer;
BEGIN
  IF _uid IS NULL OR NOT public.has_any_role(_uid, ARRAY['nurse','doctor1','doctor2','admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.snap_orders
  SET status = 'acknowledged', ack_by = _uid, ack_at = now(), updated_at = now()
  WHERE patient_id = _patient_id
    AND status = 'returned'
    AND order_type IN ('lab', 'lab_result')
    AND target_station = 'clinical_team';
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_lab_request_from_typed(
  _patient_id uuid, _visit_id uuid, _diagnosis text, _tests text[]
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := public.hms_current_user_id();
  v_lab_id uuid;
  v_req_num text;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.has_any_role(v_uid, ARRAY['nurse','doctor1','doctor2','admin']::app_role[]) THEN RAISE EXCEPTION 'Unauthorized role'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = _patient_id) THEN RAISE EXCEPTION 'Patient not found'; END IF;
  IF _visit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.visits WHERE id = _visit_id AND patient_id = _patient_id) THEN RAISE EXCEPTION 'Invalid visit for patient'; END IF;
  IF _tests IS NULL OR array_length(_tests, 1) IS NULL THEN RAISE EXCEPTION 'At least one test is required'; END IF;

  v_req_num := 'LAB-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('public.lab_requests_number_seq')::text, 4, '0');
  INSERT INTO public.lab_requests(patient_id, visit_id, tests, diagnosis, status, requested_by, requested_at, printed, request_number)
  VALUES (_patient_id, _visit_id, _tests, _diagnosis, 'pending', v_uid::text, now(), false, v_req_num)
  RETURNING id INTO v_lab_id;

  v_role := lower(NULLIF(current_setting('hms.user_role', true), ''));
  IF v_role NOT IN ('nurse', 'doctor1', 'doctor2') THEN
    SELECT lower(role::text) INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;
  END IF;
  IF v_role NOT IN ('nurse', 'doctor1', 'doctor2') THEN v_role := 'clinical_team'; END IF;

  INSERT INTO public.snap_orders(patient_id, visit_id, order_type, target_station, source_role, status, created_by, original_sender_role, intent, note, ocr_text)
  VALUES (_patient_id, _visit_id, 'lab', 'lab', v_role, 'pending_billing', v_uid, v_role, 'typed_order', 'Typed Lab Order: ' || array_to_string(_tests, ', '), 'LINKED_LAB_REQUEST:' || v_lab_id::text);
  UPDATE public.patients SET status = 'awaiting_billing' WHERE id = _patient_id AND status::text != 'admitted';
  PERFORM public.write_audit_log('create_typed_lab_request', 'lab_requests', v_lab_id::text, jsonb_build_object('patient_id', _patient_id, 'source_role', v_role), 'success');
  RETURN v_lab_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_emergency_lab_from_typed(
  _episode_id uuid, _patient_id uuid, _visit_id uuid, _diagnosis text, _tests text[]
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := public.hms_current_user_id();
  v_patient uuid;
  v_lab uuid := gen_random_uuid();
  v_item uuid;
  v_role text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['nurse','doctor1','doctor2','admin']::app_role[]) THEN RAISE EXCEPTION 'Not authorized to create an emergency lab request'; END IF;
  SELECT patient_id INTO v_patient FROM public.emergency_episodes WHERE id = _episode_id AND status = 'open';
  IF v_patient IS NULL OR v_patient <> _patient_id THEN RAISE EXCEPTION 'Emergency episode not found or patient mismatch'; END IF;
  IF _visit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.visits WHERE id = _visit_id AND patient_id = _patient_id) THEN RAISE EXCEPTION 'Invalid visit for patient'; END IF;
  IF _tests IS NULL OR array_length(_tests,1) IS NULL THEN RAISE EXCEPTION 'At least one laboratory test is required'; END IF;

  v_role := lower(NULLIF(current_setting('hms.user_role', true), ''));
  IF v_role NOT IN ('nurse', 'doctor1', 'doctor2') THEN
    SELECT lower(role::text) INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;
  END IF;
  IF v_role NOT IN ('nurse', 'doctor1', 'doctor2') THEN v_role := 'clinical_team'; END IF;

  INSERT INTO public.lab_requests(id, patient_id, visit_id, request_number, tests, diagnosis, status, requested_by, requested_at, printed, emergency_episode_id, emergency_authorized_at, emergency_authorized_by)
  VALUES (v_lab, _patient_id, _visit_id, 'EM-LAB-' || substr(replace(v_lab::text,'-',''),1,12), _tests, NULLIF(trim(COALESCE(_diagnosis,'')), ''), 'emergency_authorized', v_uid::text, now(), false, _episode_id, now(), v_uid);
  INSERT INTO public.emergency_episode_items(episode_id, item_type, description, quantity, unit_price, administered_now, status, lab_request_id, created_by, notes)
  VALUES (_episode_id, 'lab', array_to_string(_tests, ', '), 1, 0, false, 'authorized', v_lab, v_uid, 'Typed emergency lab request; performed before payment.')
  RETURNING id INTO v_item;
  PERFORM public.write_audit_log('emergency_typed_lab_created', 'lab_request', v_lab::text, jsonb_build_object('episode_id', _episode_id, 'episode_item_id', v_item, 'source_role', v_role), 'success');
  RETURN v_lab;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_emergency_lab_request(
  _lab_request_id uuid, _results jsonb, _result_path text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := public.hms_current_user_id();
  v_episode uuid; v_patient uuid; v_visit uuid; v_parent_snap uuid; v_requester uuid; v_result_snap uuid; v_status text; v_sender_role text; v_active_admission boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['lab_tech','admin']::public.app_role[]) THEN RAISE EXCEPTION 'Only laboratory staff can complete an emergency laboratory request'; END IF;
  SELECT lr.emergency_episode_id, lr.patient_id, lr.visit_id, lr.status, CASE WHEN lr.requested_by ~ '^[0-9a-fA-F-]{36}$' THEN lr.requested_by::uuid ELSE NULL END
  INTO v_episode, v_patient, v_visit, v_status, v_requester FROM public.lab_requests lr WHERE lr.id = _lab_request_id LIMIT 1;
  IF v_episode IS NULL THEN RAISE EXCEPTION 'Emergency laboratory request not found'; END IF;
  IF v_status = 'completed' THEN RAISE EXCEPTION 'Emergency laboratory request is already completed'; END IF;
  SELECT e.source_snap_id INTO v_parent_snap FROM public.emergency_episode_items e WHERE e.lab_request_id = _lab_request_id ORDER BY e.created_at LIMIT 1;
  SELECT CASE WHEN lower(COALESCE(so.original_sender_role, '')) IN ('nurse','doctor1','doctor2') THEN lower(so.original_sender_role) WHEN lower(COALESCE(so.source_role, '')) IN ('nurse','doctor1','doctor2') THEN lower(so.source_role) ELSE 'clinical_team' END INTO v_sender_role FROM public.snap_orders so WHERE so.id = v_parent_snap;
  v_sender_role := COALESCE(v_sender_role, 'clinical_team');

  UPDATE public.lab_requests SET status='completed', results=_results, completed_at=now(), emergency_result_path=_result_path, updated_at=now() WHERE id=_lab_request_id;
  UPDATE public.emergency_episode_items SET status='completed', updated_at=now() WHERE lab_request_id=_lab_request_id;
  INSERT INTO public.snap_orders(patient_id, visit_id, order_type, target_station, source_role, original_sender_role, parent_snap_id, photo_path, result_text, note, status, returned_to, returned_at, created_by, emergency_episode_id, ocr_text)
  VALUES (v_patient, v_visit, 'lab', 'clinical_team', 'lab', v_sender_role, v_parent_snap, _result_path, COALESCE(_results->>'value', _results::text), COALESCE(_results->>'interpretation', 'Emergency laboratory result'), 'returned', v_requester, now(), v_uid, v_episode, 'EMERGENCY_LAB_RESULT:' || _lab_request_id::text)
  RETURNING id INTO v_result_snap;

  SELECT EXISTS (SELECT 1 FROM public.admissions WHERE patient_id = v_patient AND status IN ('active','ready_for_discharge','waiting_assignment')) INTO v_active_admission;
  IF NOT v_active_admission THEN UPDATE public.patients SET status='with_clinical_team', last_visit=now(), updated_at=now() WHERE id=v_patient AND status::text NOT IN ('discharged','with_clinical_team'); END IF;
  PERFORM public.write_audit_log('emergency_lab_completed', 'lab_request', _lab_request_id::text, jsonb_build_object('episode_id', v_episode, 'patient_id', v_patient, 'result_snap_id', v_result_snap, 'original_sender_role', v_sender_role, 'target_station', 'clinical_team'), 'success');
  RETURN jsonb_build_object('lab_request_id', _lab_request_id, 'episode_id', v_episode, 'patient_id', v_patient, 'status', 'completed', 'result_snap_id', v_result_snap, 'target_station', 'clinical_team');
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_add_snap_for_patient(uuid, uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.advance_clinical_team_action(
  _patient_id uuid, _to_state text, _owner_role text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := public.hms_current_user_id();
  _journey_id uuid;
BEGIN
  IF _uid IS NULL OR NOT public.has_any_role(_uid, ARRAY['nurse','doctor1','doctor2','admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _patient_id IS NULL OR _to_state IS NULL THEN
    RAISE EXCEPTION 'patient_id and to_state are required';
  END IF;

  UPDATE public.snap_orders
  SET status = 'acknowledged', ack_by = _uid, ack_at = now(), updated_at = now()
  WHERE patient_id = _patient_id
    AND status = 'returned'
    AND order_type IN ('lab', 'lab_result')
    AND target_station = 'clinical_team';

  _journey_id := public.advance_journey(_patient_id, _to_state, _owner_role);
  RETURN _journey_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.acknowledge_clinical_team_lab_results(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_clinical_team_action(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_lab_request_from_typed(uuid, uuid, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_emergency_lab_from_typed(uuid, uuid, uuid, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_emergency_lab_request(uuid, jsonb, text) TO authenticated;
