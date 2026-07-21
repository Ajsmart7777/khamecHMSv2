
ALTER TABLE public.staff_attendance DROP COLUMN IF EXISTS shift_log_id;
DROP TABLE IF EXISTS public.shift_logs CASCADE;
DROP TABLE IF EXISTS public.shift_assignments CASCADE;
DROP TABLE IF EXISTS public.shift_periods CASCADE;
