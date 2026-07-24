
-- Phase 2: Unified Task Layer (view only, no table changes)
-- RLS on underlying tables is preserved because the view inherits it.

CREATE OR REPLACE VIEW public.v_tasks AS
-- Lab requests
SELECT
  ('lab_requests:' || lr.id::text)          AS task_id,
  'lab_requests'::text                       AS source,
  lr.id                                      AS source_id,
  lr.patient_id                              AS patient_id,
  lr.visit_id                                AS visit_id,
  'lab_tech'::text                           AS assigned_role,
  NULL::uuid                                 AS assigned_user_id,
  lr.status                                  AS status,
  0                                          AS priority,
  lr.created_at                              AS created_at,
  lr.updated_at                              AS updated_at,
  jsonb_build_object(
    'request_number', lr.request_number,
    'tests', lr.tests,
    'diagnosis', lr.diagnosis
  )                                          AS payload
FROM public.lab_requests lr

UNION ALL

-- Prescriptions
SELECT
  ('prescriptions:' || pr.id::text),
  'prescriptions',
  pr.id,
  pr.patient_id,
  pr.visit_id,
  'pharmacist',
  NULL::uuid,
  pr.status,
  0,
  pr.created_at,
  pr.updated_at,
  jsonb_build_object(
    'diagnosis', pr.diagnosis,
    'notes', pr.notes
  )
FROM public.prescriptions pr

UNION ALL

-- Admissions
SELECT
  ('admissions:' || a.id::text),
  'admissions',
  a.id,
  a.patient_id,
  a.visit_id,
  CASE a.status
    WHEN 'waiting_assignment'    THEN 'nurse'
    WHEN 'active'                THEN 'nurse'
    WHEN 'ready_for_discharge'   THEN 'nurse'
    ELSE NULL
  END,
  a.admitting_doctor,
  a.status,
  CASE a.status WHEN 'ready_for_discharge' THEN 10 ELSE 5 END,
  a.created_at,
  a.updated_at,
  jsonb_build_object(
    'reason', a.reason,
    'bed_id', a.bed_id,
    'admitted_at', a.admitted_at,
    'ready_for_discharge_at', a.ready_for_discharge_at
  )
FROM public.admissions a

UNION ALL

-- Snap orders
SELECT
  ('snap_orders:' || s.id::text),
  'snap_orders',
  s.id,
  s.patient_id,
  s.visit_id,
  CASE s.target_station
    WHEN 'pharmacy' THEN 'pharmacist'
    WHEN 'lab'      THEN 'lab_tech'
    WHEN 'nurse'    THEN 'nurse'
    WHEN 'billing'  THEN 'billing'
    ELSE s.target_station
  END,
  s.created_by,
  s.status,
  CASE WHEN s.is_admitted_snap THEN 8 ELSE 3 END,
  s.created_at,
  s.updated_at,
  jsonb_build_object(
    'order_type', s.order_type,
    'target_station', s.target_station,
    'source_role', s.source_role,
    'intent', s.intent,
    'note', s.note
  )
FROM public.snap_orders s

UNION ALL

-- Stock requests
SELECT
  ('stock_requests:' || sr.id::text),
  'stock_requests',
  sr.id,
  NULL::uuid,
  NULL::uuid,
  'store',
  NULL::uuid,
  sr.status,
  1,
  sr.created_at,
  sr.updated_at,
  jsonb_build_object(
    'item_name', sr.item_name,
    'item_id', sr.item_id,
    'quantity', sr.quantity,
    'requested_by', sr.requested_by
  )
FROM public.stock_requests sr;

GRANT SELECT ON public.v_tasks TO authenticated;
GRANT SELECT ON public.v_tasks TO service_role;
