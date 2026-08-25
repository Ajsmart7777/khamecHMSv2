-- Preserve the exact clinical requester through billing and laboratory result return.
-- Additive production migration: no patient, visit, invoice, or historical snap rows
-- are rewritten by this migration.

CREATE OR REPLACE FUNCTION public.forward_snap_to_billing(
  _source_snap_id uuid,
  _target_station text,
  _note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _uid uuid := public.hms_current_user_id();
  _src RECORD;
  _new uuid;
  _role text;
  _owner_role text;
  _order_type text;
  _requester_id uuid;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor1','doctor2','admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _target_station NOT IN ('pharmacy','lab') THEN
    RAISE EXCEPTION 'Target must be pharmacy or lab';
  END IF;

  SELECT * INTO _src FROM public.snap_orders WHERE id = _source_snap_id;
  IF _src IS NULL THEN
    RAISE EXCEPTION 'Source snap not found';
  END IF;

  SELECT role::text INTO _role
  FROM public.user_roles
  WHERE user_id = _uid
  LIMIT 1;

  -- Admin may operate a station, but must never become the clinical requester
  -- merely because the station was opened through an admin view.
  _owner_role := CASE
    WHEN lower(COALESCE(_src.original_sender_role, '')) IN ('nurse','doctor1','doctor2')
      THEN lower(_src.original_sender_role)
    WHEN lower(COALESCE(_src.source_role, '')) IN ('nurse','doctor1','doctor2')
      THEN lower(_src.source_role)
    WHEN lower(COALESCE(_role, '')) IN ('nurse','doctor1','doctor2')
      THEN lower(_role)
    ELSE CASE WHEN _target_station = 'lab' THEN 'doctor1' ELSE 'nurse' END
  END;

  _requester_id := COALESCE(_src.returned_to, _src.created_by);
  _order_type := CASE _target_station WHEN 'lab' THEN 'lab' ELSE 'prescription' END;

  INSERT INTO public.snap_orders (
    patient_id, visit_id, order_type, target_station, source_role,
    photo_path, note, status, created_by, original_sender_role,
    returned_to, parent_snap_id, matched_items, ocr_text, ocr_confidence
  ) VALUES (
    _src.patient_id, _src.visit_id, _order_type, _target_station,
    _owner_role,
    _src.photo_path,
    COALESCE(_note, 'Forwarded from admitted patient snap'),
    'pending_billing', _uid, _owner_role,
    _requester_id, _src.id, COALESCE(_src.matched_items, '[]'::jsonb),
    _src.ocr_text, _src.ocr_confidence
  ) RETURNING id INTO _new;

  PERFORM public.write_audit_log(
    'snap_forwarded_to_billing', 'snap_order', _new::text,
    jsonb_build_object(
      'source_snap_id', _src.id,
      'patient_id', _src.patient_id,
      'target_station', _target_station,
      'original_sender_role', _owner_role,
      'returned_to', _requester_id
    )
  );
  RETURN _new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.forward_snap_to_billing(uuid, text, text) TO authenticated;

-- Emergency laboratory completion uses the canonical lab_requests row. The
-- result remains on the shared doctor station for compatibility, while
-- returned_to and original_sender_role identify the exact requester.
CREATE OR REPLACE FUNCTION public.complete_emergency_lab_request(
  _lab_request_id uuid,
  _results jsonb,
  _result_path text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid uuid := public.hms_current_user_id();
  v_episode uuid;
  v_patient uuid;
  v_visit uuid;
  v_parent_snap uuid;
  v_requester uuid;
  v_result_snap uuid;
  v_status text;
  v_sender_role text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['lab_tech','admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Only laboratory staff can complete an emergency laboratory request';
  END IF;

  SELECT lr.emergency_episode_id, lr.patient_id, lr.visit_id, lr.status,
         CASE WHEN lr.requested_by ~ '^[0-9a-fA-F-]{36}$' THEN lr.requested_by::uuid ELSE NULL END
    INTO v_episode, v_patient, v_visit, v_status, v_requester
  FROM public.lab_requests lr
  WHERE lr.id = _lab_request_id
  LIMIT 1;
  IF v_episode IS NULL THEN
    RAISE EXCEPTION 'Emergency laboratory request not found';
  END IF;
  IF v_status = 'completed' THEN
    RAISE EXCEPTION 'Emergency laboratory request is already completed';
  END IF;

  SELECT e.source_snap_id INTO v_parent_snap
  FROM public.emergency_episode_items e
  WHERE e.lab_request_id = _lab_request_id
  ORDER BY e.created_at
  LIMIT 1;

  SELECT CASE
    WHEN lower(COALESCE(so.original_sender_role, '')) IN ('nurse','doctor1','doctor2')
      THEN lower(so.original_sender_role)
    WHEN lower(COALESCE(so.source_role, '')) IN ('nurse','doctor1','doctor2')
      THEN lower(so.source_role)
    ELSE 'doctor1'
  END
  INTO v_sender_role
  FROM public.snap_orders so
  WHERE so.id = v_parent_snap;

  v_sender_role := COALESCE(v_sender_role, 'doctor1');

  UPDATE public.lab_requests
     SET status = 'completed',
         results = _results,
         completed_at = now(),
         emergency_result_path = _result_path,
         updated_at = now()
   WHERE id = _lab_request_id;

  UPDATE public.emergency_episode_items
     SET status = 'completed', updated_at = now()
   WHERE lab_request_id = _lab_request_id;

  INSERT INTO public.snap_orders(
    patient_id, visit_id, order_type, target_station, source_role,
    original_sender_role, parent_snap_id, photo_path, result_text, note,
    status, returned_to, returned_at, created_by, emergency_episode_id, ocr_text
  ) VALUES (
    v_patient, v_visit, 'lab', 'doctor', 'lab', v_sender_role, v_parent_snap,
    _result_path, COALESCE(_results->>'value', _results::text),
    COALESCE(_results->>'interpretation', 'Emergency laboratory result'),
    'returned', v_requester, now(), v_uid, v_episode,
    'EMERGENCY_LAB_RESULT:' || _lab_request_id::text
  ) RETURNING id INTO v_result_snap;

  PERFORM public.write_audit_log(
    'emergency_lab_completed', 'lab_request', _lab_request_id::text,
    jsonb_build_object(
      'episode_id', v_episode,
      'patient_id', v_patient,
      'result_snap_id', v_result_snap,
      'original_sender_role', v_sender_role,
      'returned_to', v_requester
    ),
    'success'
  );
  RETURN jsonb_build_object(
    'lab_request_id', _lab_request_id,
    'episode_id', v_episode,
    'patient_id', v_patient,
    'status', 'completed',
    'result_snap_id', v_result_snap
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_emergency_lab_request(uuid, jsonb, text) TO authenticated;

-- Retire the standalone generic doctor role from future role assignments.
-- Existing clinical history is intentionally preserved; Doctor 1 is the safe
-- compatibility destination for any legacy generic assignment.
UPDATE public.user_roles
SET role = 'doctor1'::public.app_role
WHERE role::text = 'doctor';
