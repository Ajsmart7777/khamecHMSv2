-- CockroachDB compatibility cleanup.
-- Removes legacy subset CHECK constraints that were left beside newer expanded constraints.
-- This migration is intentionally scoped to the CockroachDB clone; the primary Supabase project is untouched.

ALTER TABLE public.patients DROP CONSTRAINT IF EXISTS check_status;
ALTER TABLE public.patients DROP CONSTRAINT IF EXISTS check_account_type;
ALTER TABLE public.admissions DROP CONSTRAINT IF EXISTS check_status;
ALTER TABLE public.stock_transfers DROP CONSTRAINT IF EXISTS check_status;

ALTER TABLE public.snap_orders DROP CONSTRAINT IF EXISTS snap_orders_status_check;
ALTER TABLE public.snap_orders ADD CONSTRAINT snap_orders_status_check
  CHECK (status IN ('pending_billing','awaiting_payment','paid','fulfilled','rejected','cancelled','returned','acknowledged','held_no_balance'));

ALTER TABLE public.standing_orders DROP CONSTRAINT IF EXISTS check_order_type1;

ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_database_payload_bytes1;
ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_database_payload_bytes2;
ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_database_payload_bytes3;
ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_r2_cleanup_status1;
ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_r2_cleanup_status2;
ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_r2_cleanup_status3;
ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_r2_deleted_bytes1;
ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_r2_deleted_bytes2;
ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_r2_deleted_bytes3;
ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_r2_object_bytes1;
ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_r2_object_bytes2;
ALTER TABLE public.patient_archive_records DROP CONSTRAINT IF EXISTS check_r2_object_bytes3;
