-- Harden Doctor -> Nurse treatment forwarding.
-- The source review snap must be consumed in the same transaction as the
-- downstream billing snap so a refresh or double click cannot forward it twice.

CREATE OR REPLACE FUNCTION public.forward_snap_to_billing(
  _source_snap_id uuid,
  _target_station text,
  _note text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _src public.snap_orders%ROWTYPE;
  _new uuid;
  _role text;
  _order_type text;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _target_station NOT IN ('pharmacy','lab') THEN
    RAISE EXCEPTION 'Target must be pharmacy or lab';
  END IF;

  SELECT * INTO _src
  FROM public.snap_orders
  WHERE id = _source_snap_id
  FOR UPDATE;

  IF _src.id IS NULL THEN
    RAISE EXCEPTION 'Source snap not found';
  END IF;

  -- A Nurse treatment-review row is single-use. Once acknowledged or
  -- fulfilled, a repeated click must not create another downstream order.
  IF _src.target_station IN ('nurse','doctor')
     AND _src.status <> 'pending_billing' THEN
    RAISE EXCEPTION 'SOURCE_SNAP_ALREADY_FORWARDED: this treatment has already been forwarded';
  END IF;

  -- Admission-order snaps are also single-use.
  IF _src.intent = 'admission_order' THEN
    IF _src.ack_at IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.snap_orders c WHERE c.parent_snap_id = _src.id) THEN
      RAISE EXCEPTION 'ADMISSION_SNAP_ALREADY_USED: this admission snap has already been used. Take a new snap.';
    END IF;
  END IF;

  _order_type := CASE _target_station WHEN 'lab' THEN 'lab' ELSE 'prescription' END;
  SELECT role::text INTO _role
  FROM public.user_roles
  WHERE user_id = _uid
  LIMIT 1;

  INSERT INTO public.snap_orders (
    patient_id, visit_id, order_type, target_station, source_role,
    photo_path, note, status, created_by, original_sender_role,
    parent_snap_id, matched_items, ocr_text, ocr_confidence
  ) VALUES (
    _src.patient_id, _src.visit_id, _order_type, _target_station,
    COALESCE(_role, _src.source_role),
    _src.photo_path,
    COALESCE(_note, 'Forwarded from treatment review'),
    'pending_billing', _uid, COALESCE(_role, _src.source_role),
    _src.id, COALESCE(_src.matched_items, '[]'::jsonb),
    _src.ocr_text, _src.ocr_confidence
  ) RETURNING id INTO _new;

  -- Consume every station-review source row after its child is created. This
  -- is intentionally in the same transaction as the insert above.
  UPDATE public.snap_orders
     SET status = 'acknowledged',
         ack_by = _uid,
         ack_at = now(),
         updated_at = now()
   WHERE id = _src.id
     AND status = 'pending_billing';

  PERFORM public.write_audit_log(
    'snap_forwarded_to_billing', 'snap_order', _new::text,
    jsonb_build_object(
      'source_snap_id', _src.id,
      'patient_id', _src.patient_id,
      'target_station', _target_station
    )
  );

  RETURN _new;
END
$function$;

REVOKE ALL ON FUNCTION public.forward_snap_to_billing(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forward_snap_to_billing(uuid, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.forward_snap_to_billing(uuid, text, text)
IS 'Creates one downstream billing snap and atomically consumes the source treatment-review snap.';

NOTIFY pgrst, 'reload schema';

-- Verification notes:
-- 1. A pending Nurse/Doctor review row creates exactly one child and becomes acknowledged.
-- 2. A second call against that source row raises SOURCE_SNAP_ALREADY_FORWARDED.
-- 3. The child retains patient_id, visit_id, parent_snap_id, and the selected target station.
