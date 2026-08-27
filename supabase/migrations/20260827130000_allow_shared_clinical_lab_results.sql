-- CockroachDB compatibility fix for shared clinical lab result routing.
-- Emergency and paid lab results are visible to Nurse, Doctor 1, and Doctor 2
-- through the shared clinical-team queue. The existing constraint omitted that
-- internal routing station, so result snap submission failed after upload.
-- Older Cockroach deployments may retain either constraint name; remove both
-- before adding the widened constraint so the legacy check cannot still reject
-- the insert.
ALTER TABLE public.snap_orders DROP CONSTRAINT IF EXISTS snap_orders_target_station_check;
ALTER TABLE public.snap_orders DROP CONSTRAINT IF EXISTS check_target_station;
ALTER TABLE public.snap_orders ADD CONSTRAINT snap_orders_target_station_check
  CHECK (target_station IN ('pharmacy','lab','doctor','nurse','billing','clinical_team'));
