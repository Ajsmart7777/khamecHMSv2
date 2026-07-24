ALTER TABLE public.patients DROP CONSTRAINT IF EXISTS patients_account_type_check;
ALTER TABLE public.patients ADD CONSTRAINT patients_account_type_check
CHECK (account_type = ANY (ARRAY['normal','insurance','corporate','nhis','hmo','katchma','retainer','staff','staff_family']::text[]));