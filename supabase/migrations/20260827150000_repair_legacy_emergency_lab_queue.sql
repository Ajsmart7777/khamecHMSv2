-- Repair legacy emergency lab requests that are still awaiting a result but
-- used a status value not covered by the first queue backfill. This only creates
-- the standard Lab queue projection; it creates no invoice or payment.
INSERT INTO public.snap_orders(
  patient_id, visit_id, order_type, target_station, source_role,
  original_sender_role, photo_path, note, status, created_by,
  emergency_episode_id, ocr_text, matched_items
)
SELECT
  lr.patient_id,
  lr.visit_id,
  'lab',
  'lab',
  CASE
    WHEN lower(COALESCE(ur.role::text, '')) IN ('nurse','doctor1','doctor2') THEN lower(ur.role::text)
    ELSE 'clinical_team'
  END,
  CASE
    WHEN lower(COALESCE(ur.role::text, '')) IN ('nurse','doctor1','doctor2') THEN lower(ur.role::text)
    ELSE 'clinical_team'
  END,
  NULL,
  'Emergency laboratory request — process immediately without billing/payment.',
  'paid',
  CASE WHEN lr.requested_by ~ '^[0-9a-fA-F-]{36}$' THEN lr.requested_by::uuid ELSE NULL END,
  lr.emergency_episode_id,
  'LINKED_LAB_REQUEST:' || lr.id::text,
  '[]'::jsonb
FROM public.lab_requests lr
LEFT JOIN public.user_roles ur
  ON ur.user_id = CASE WHEN lr.requested_by ~ '^[0-9a-fA-F-]{36}$' THEN lr.requested_by::uuid ELSE NULL END
WHERE lr.emergency_episode_id IS NOT NULL
  AND COALESCE(lower(lr.status), '') NOT IN ('completed', 'cancelled', 'canceled', 'returned', 'closed')
  AND NOT EXISTS (
    SELECT 1 FROM public.snap_orders so
    WHERE so.ocr_text = 'LINKED_LAB_REQUEST:' || lr.id::text
  );
