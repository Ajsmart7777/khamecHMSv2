-- Emergency laboratory work still bypasses billing/payment, but it uses the
-- same Laboratory queue and snap-result workflow as ordinary paid lab orders.
-- The paid status here means "authorized for Lab processing"; no invoice or
-- payment row is created by this function.
CREATE OR REPLACE FUNCTION public.record_emergency_lab_request(
  _episode_id UUID,
  _tests TEXT[],
  _diagnosis TEXT DEFAULT NULL,
  _total NUMERIC DEFAULT 0,
  _notes TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid UUID := public.hms_current_user_id();
  v_patient UUID;
  v_visit UUID;
  v_lab UUID := gen_random_uuid();
  v_item UUID;
  v_request_number TEXT;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['nurse','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized to record emergency laboratory work';
  END IF;
  IF _tests IS NULL OR array_length(_tests, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one laboratory test is required';
  END IF;
  SELECT patient_id, visit_id
    INTO v_patient, v_visit
  FROM public.emergency_episodes
  WHERE id = _episode_id AND status = 'open'
  LIMIT 1;
  IF v_patient IS NULL THEN
    RAISE EXCEPTION 'Emergency episode not found or already closed';
  END IF;

  v_request_number := 'EM-LAB-' || substr(replace(v_lab::text, '-', ''), 1, 12);

  -- Canonical request remains linked to the episode for EMR/audit continuity,
  -- but is marked in progress because it is authorized immediately and does
  -- not wait for billing or payment.
  INSERT INTO public.lab_requests(
    id, patient_id, visit_id, request_number, tests, diagnosis, status,
    requested_by, requested_at, printed, emergency_episode_id,
    emergency_authorized_at, emergency_authorized_by
  ) VALUES (
    v_lab, v_patient, v_visit, v_request_number, _tests,
    NULLIF(trim(COALESCE(_diagnosis, '')), ''), 'in_progress', v_uid::text,
    now(), false, _episode_id, now(), v_uid
  );

  INSERT INTO public.emergency_episode_items(
    episode_id, item_type, description, quantity, unit_price, administered_now,
    status, lab_request_id, created_by, notes
  ) VALUES (
    _episode_id, 'lab', array_to_string(_tests, ', '), 1,
    GREATEST(COALESCE(_total, 0), 0), false, 'authorized', v_lab, v_uid,
    NULLIF(trim(COALESCE(_notes, '')), '')
  ) RETURNING id INTO v_item;

  -- Materialize one ordinary Lab queue item. Status paid means Lab is allowed
  -- to process it immediately; no invoice/payment is created for this row.
  INSERT INTO public.snap_orders(
    patient_id, visit_id, order_type, target_station, source_role,
    original_sender_role, photo_path, note, status, created_by,
    emergency_episode_id, ocr_text, matched_items
  ) VALUES (
    v_patient, v_visit, 'lab', 'lab',
    CASE
      WHEN lower(COALESCE(current_setting('hms.user_role', true), '')) IN ('nurse','doctor1','doctor2')
        THEN lower(current_setting('hms.user_role', true))
      ELSE COALESCE((SELECT lower(role::text) FROM public.user_roles WHERE user_id = v_uid LIMIT 1), 'clinical_team')
    END,
    CASE
      WHEN lower(COALESCE(current_setting('hms.user_role', true), '')) IN ('nurse','doctor1','doctor2')
        THEN lower(current_setting('hms.user_role', true))
      ELSE COALESCE((SELECT lower(role::text) FROM public.user_roles WHERE user_id = v_uid LIMIT 1), 'clinical_team')
    END,
    NULL,
    COALESCE(NULLIF(trim(_notes), ''), 'Emergency laboratory request — process immediately without billing/payment.'),
    'paid', v_uid, _episode_id,
    'LINKED_LAB_REQUEST:' || v_lab::text,
    '[]'::jsonb
  );

  SELECT public.write_audit_log(
    'emergency_lab_sent_to_lab_queue', 'lab_request', v_lab::text,
    jsonb_build_object('episode_id', _episode_id, 'patient_id', v_patient, 'queue_status', 'paid'),
    'success'
  );
  RETURN v_lab;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_emergency_lab_request(UUID, TEXT[], TEXT, NUMERIC, TEXT) TO authenticated;
