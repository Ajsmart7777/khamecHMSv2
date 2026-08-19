-- CockroachDB clone compatibility: remove stale duplicate constraints that
-- remained from the initial snap_orders table definition. The later widened
-- constraints below already preserve the intended application values.
ALTER TABLE public.snap_orders DROP CONSTRAINT IF EXISTS check_order_type;
ALTER TABLE public.snap_orders DROP CONSTRAINT IF EXISTS check_target_station;
ALTER TABLE public.snap_orders DROP CONSTRAINT IF EXISTS check_status;
