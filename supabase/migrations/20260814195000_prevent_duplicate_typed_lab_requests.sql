-- Prevent repeated Nurse submissions from creating duplicate active lab requests.
-- Existing duplicate active requests are retained for audit, but the older
-- non-terminal duplicate is marked cancelled before the unique guard is added.

WITH ranked_active AS (
  SELECT
    lr.id,
    row_number() OVER (
      PARTITION BY lr.patient_id, COALESCE(lr.visit_id, '00000000-0000-0000-0000-000000000000'::uuid)
      ORDER BY
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM public.snap_orders so
            WHERE so.order_type = 'lab'
              AND so.ocr_text = 'LINKED_LAB_REQUEST:' || lr.id::text
              AND so.status IN ('paid', 'fulfilled')
          ) THEN 0
          WHEN EXISTS (
            SELECT 1
            FROM public.snap_orders so
            WHERE so.order_type = 'lab'
              AND so.ocr_text = 'LINKED_LAB_REQUEST:' || lr.id::text
              AND so.status = 'awaiting_payment'
          ) THEN 1
          ELSE 2
        END,
        lr.requested_at DESC,
        lr.id DESC
    ) AS duplicate_rank
  FROM public.lab_requests lr
  WHERE lr.status IN ('pending', 'in_progress')
)
UPDATE public.lab_requests lr
SET
  status = 'cancelled',
  results = COALESCE(lr.results, '{}'::jsonb) || jsonb_build_object(
    'system_note', 'Cancelled automatically as a duplicate active lab request.',
    'cancelled_at', now()
  )
FROM ranked_active ra
WHERE ra.id = lr.id
  AND ra.duplicate_rank > 1;

UPDATE public.snap_orders so
SET
  status = 'cancelled',
  rejection_reason = COALESCE(so.rejection_reason, 'Duplicate lab request cancelled automatically.'),
  updated_at = now()
WHERE so.order_type = 'lab'
  AND so.status IN ('pending_billing', 'awaiting_payment')
  AND so.ocr_text LIKE 'LINKED_LAB_REQUEST:%'
  AND EXISTS (
    SELECT 1
    FROM public.lab_requests lr
    WHERE lr.id::text = substring(so.ocr_text FROM length('LINKED_LAB_REQUEST:') + 1)
      AND lr.status = 'cancelled'
      AND lr.results ->> 'system_note' = 'Cancelled automatically as a duplicate active lab request.'
  );

CREATE UNIQUE INDEX IF NOT EXISTS lab_requests_one_active_per_patient_visit_idx
  ON public.lab_requests (
    patient_id,
    COALESCE(visit_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status IN ('pending', 'in_progress');

CREATE OR REPLACE FUNCTION public.create_lab_request_from_typed(
  _patient_id uuid,
  _visit_id uuid,
  _diagnosis text,
  _tests text[]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lab_id uuid;
  v_req_num text;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT public.has_any_role(v_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Unauthorized role';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = _patient_id) THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;

  IF _visit_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.visits WHERE id = _visit_id AND patient_id = _patient_id) THEN
      RAISE EXCEPTION 'Invalid visit for patient';
    END IF;
  END IF;

  IF _tests IS NULL OR array_length(_tests, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one test is required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.lab_requests
    WHERE patient_id = _patient_id
      AND visit_id IS NOT DISTINCT FROM _visit_id
      AND status IN ('pending', 'in_progress')
  ) THEN
    RAISE EXCEPTION 'An active lab request already exists for this patient and visit. Use the existing request instead of submitting again.';
  END IF;

  v_req_num := 'LAB-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('public.lab_requests_number_seq')::text, 4, '0');

  INSERT INTO public.lab_requests
    (patient_id, visit_id, tests, diagnosis, status, requested_by, requested_at, printed, request_number)
  VALUES (
    _patient_id, _visit_id, _tests, _diagnosis,
    'pending', v_uid::text, now(), false, v_req_num
  )
  RETURNING id INTO v_lab_id;

  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;

  INSERT INTO public.snap_orders (
    patient_id,
    visit_id,
    order_type,
    target_station,
    source_role,
    status,
    created_by,
    original_sender_role,
    intent,
    note,
    ocr_text
  ) VALUES (
    _patient_id,
    _visit_id,
    'lab',
    'lab',
    COALESCE(v_role, 'doctor'),
    'pending_billing',
    v_uid,
    COALESCE(v_role, 'doctor'),
    'typed_order',
    'Typed Lab Order: ' || array_to_string(_tests, ', '),
    'LINKED_LAB_REQUEST:' || v_lab_id::text
  );

  -- Move the patient out of the Nurse queue in the same transaction as the request.
  UPDATE public.patients
  SET status = 'awaiting_billing'
  WHERE id = _patient_id
    AND status != 'admitted';

  PERFORM public.write_audit_log(
    'create_typed_lab_request',
    'lab_requests',
    v_lab_id::text,
    jsonb_build_object('patient_id', _patient_id),
    'success'
  );

  RETURN v_lab_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_lab_request_from_typed(uuid, uuid, text, text[]) TO authenticated;
