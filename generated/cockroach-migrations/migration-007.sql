-- SOURCE: 20260721105403_38bdcd76-3e93-4cdc-b8bc-a565a920c4be.sql statement 1
ALTER TABLE public.consultation_notes
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','finalized')),
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;

-- SOURCE: 20260721105403_38bdcd76-3e93-4cdc-b8bc-a565a920c4be.sql statement 2
CREATE INDEX IF NOT EXISTS idx_consultation_notes_status
  ON public.consultation_notes(patient_id, status);

-- SOURCE: 20260721105403_38bdcd76-3e93-4cdc-b8bc-a565a920c4be.sql statement 3
DROP POLICY IF EXISTS "Doctors update own consultation notes" ON public.consultation_notes;

-- SOURCE: 20260721105403_38bdcd76-3e93-4cdc-b8bc-a565a920c4be.sql statement 4
DROP POLICY IF EXISTS "Doctor updates own consultation" ON public.consultation_notes;

-- SOURCE: 20260721105403_38bdcd76-3e93-4cdc-b8bc-a565a920c4be.sql statement 5
CREATE POLICY "Author edits own draft"
  ON public.consultation_notes FOR UPDATE TO authenticated
  USING (doctor_id = public.hms_current_user_id() AND status = 'draft')
  WITH CHECK (doctor_id = public.hms_current_user_id());

-- SOURCE: 20260721105554_690fca6a-052a-495f-a060-18e384419eff.sql statement 1
DROP TABLE IF EXISTS public.consultation_notes CASCADE;

-- SOURCE: 20260721105809_452b631b-1f1f-43ae-8f63-fc11b01ff5ac.sql statement 1
CREATE POLICY "Staff can read own record"
ON public.staff
FOR SELECT
TO authenticated
USING (auth_user_id = public.hms_current_user_id());

-- SOURCE: 20260721105809_452b631b-1f1f-43ae-8f63-fc11b01ff5ac.sql statement 2
DROP POLICY IF EXISTS "Users can read own notifications" ON public.notifications;

-- SOURCE: 20260721105809_452b631b-1f1f-43ae-8f63-fc11b01ff5ac.sql statement 3
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;

-- SOURCE: 20260721105809_452b631b-1f1f-43ae-8f63-fc11b01ff5ac.sql statement 4
CREATE POLICY "Users can read own or targeted notifications"
ON public.notifications
FOR SELECT
TO authenticated
USING (
  user_id = public.hms_current_user_id()
  OR (
    user_id IS NULL
    AND target_role IS NOT NULL
    AND public.has_role(public.hms_current_user_id(), target_role::public.app_role)
  )
);

-- SOURCE: 20260721105809_452b631b-1f1f-43ae-8f63-fc11b01ff5ac.sql statement 5
CREATE POLICY "Users can update own or targeted notifications"
ON public.notifications
FOR UPDATE
TO authenticated
USING (
  user_id = public.hms_current_user_id()
  OR (
    user_id IS NULL
    AND target_role IS NOT NULL
    AND public.has_role(public.hms_current_user_id(), target_role::public.app_role)
  )
);

-- SOURCE: 20260721105809_452b631b-1f1f-43ae-8f63-fc11b01ff5ac.sql statement 6
DROP POLICY IF EXISTS "Billing and admin can read corporate_accounts" ON public.corporate_accounts;

-- SOURCE: 20260721105809_452b631b-1f1f-43ae-8f63-fc11b01ff5ac.sql statement 7
CREATE POLICY "Billing and admin can read corporate_accounts"
ON public.corporate_accounts
FOR SELECT
TO authenticated
USING (public.has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role, 'admin'::app_role, 'accountant'::app_role]));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 1
DROP POLICY IF EXISTS "Admin and account can read staff" ON public.staff;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 2
DROP POLICY IF EXISTS "Only admin can delete staff" ON public.staff;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 3
DROP POLICY IF EXISTS "Only admin can insert staff" ON public.staff;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 4
DROP POLICY IF EXISTS "Only admin can update staff" ON public.staff;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 5
CREATE POLICY "Admin and account can read staff" ON public.staff
  FOR SELECT TO authenticated
  USING (has_any_role(public.hms_current_user_id(), ARRAY['admin'::app_role, 'billing'::app_role]));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 6
CREATE POLICY "Only admin can delete staff" ON public.staff
  FOR DELETE TO authenticated USING (has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 7
CREATE POLICY "Only admin can insert staff" ON public.staff
  FOR INSERT TO authenticated WITH CHECK (has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 8
CREATE POLICY "Only admin can update staff" ON public.staff
  FOR UPDATE TO authenticated USING (has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 9
DROP POLICY IF EXISTS "Admin can delete shift_periods" ON public.shift_periods;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 10
DROP POLICY IF EXISTS "Admin can insert shift_periods" ON public.shift_periods;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 11
DROP POLICY IF EXISTS "Admin can update shift_periods" ON public.shift_periods;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 12
DROP POLICY IF EXISTS "Authenticated staff can read shift_periods" ON public.shift_periods;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 13
CREATE POLICY "Admin can delete shift_periods" ON public.shift_periods
  FOR DELETE TO authenticated USING (has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 14
CREATE POLICY "Admin can insert shift_periods" ON public.shift_periods
  FOR INSERT TO authenticated WITH CHECK (has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 15
CREATE POLICY "Admin can update shift_periods" ON public.shift_periods
  FOR UPDATE TO authenticated USING (has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 16
CREATE POLICY "Authenticated staff can read shift_periods" ON public.shift_periods
  FOR SELECT TO authenticated USING (is_authenticated_staff());

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 17
DROP POLICY IF EXISTS "Admin can delete shift_assignments" ON public.shift_assignments;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 18
DROP POLICY IF EXISTS "Admin can insert shift_assignments" ON public.shift_assignments;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 19
DROP POLICY IF EXISTS "Admin can update shift_assignments" ON public.shift_assignments;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 20
DROP POLICY IF EXISTS "Staff can read own assignments" ON public.shift_assignments;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 21
CREATE POLICY "Admin can delete shift_assignments" ON public.shift_assignments
  FOR DELETE TO authenticated USING (has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 22
CREATE POLICY "Admin can insert shift_assignments" ON public.shift_assignments
  FOR INSERT TO authenticated WITH CHECK (has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 23
CREATE POLICY "Admin can update shift_assignments" ON public.shift_assignments
  FOR UPDATE TO authenticated USING (has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 24
CREATE POLICY "Staff can read own assignments" ON public.shift_assignments
  FOR SELECT TO authenticated
  USING ((staff_user_id = public.hms_current_user_id()) OR has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 25
DROP POLICY IF EXISTS "Staff can insert own shift_logs" ON public.shift_logs;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 26
DROP POLICY IF EXISTS "Staff can read own logs and admin can read all" ON public.shift_logs;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 27
DROP POLICY IF EXISTS "Staff can update own shift_logs" ON public.shift_logs;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 28
CREATE POLICY "Staff can insert own shift_logs" ON public.shift_logs
  FOR INSERT TO authenticated WITH CHECK (staff_user_id = public.hms_current_user_id());

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 29
CREATE POLICY "Staff can read own logs and admin can read all" ON public.shift_logs
  FOR SELECT TO authenticated
  USING ((staff_user_id = public.hms_current_user_id()) OR has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 30
CREATE POLICY "Staff can update own shift_logs" ON public.shift_logs
  FOR UPDATE TO authenticated
  USING ((staff_user_id = public.hms_current_user_id()) OR has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260721110306_5b560637-2e05-496d-92f5-a1799d237c10.sql statement 1
ALTER TABLE public.staff_attendance DROP COLUMN IF EXISTS shift_log_id;

-- SOURCE: 20260721110306_5b560637-2e05-496d-92f5-a1799d237c10.sql statement 2
DROP TABLE IF EXISTS public.shift_logs CASCADE;

-- SOURCE: 20260721110306_5b560637-2e05-496d-92f5-a1799d237c10.sql statement 3
DROP TABLE IF EXISTS public.shift_assignments CASCADE;

-- SOURCE: 20260721110306_5b560637-2e05-496d-92f5-a1799d237c10.sql statement 4
DROP TABLE IF EXISTS public.shift_periods CASCADE;

-- SOURCE: 20260721111446_d530ae64-9e97-441f-8ca4-bbd4e2672541.sql statement 1
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS assigned_doctor TEXT CHECK (assigned_doctor IN ('doctor1','doctor2'));

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 1
CREATE TYPE public.visit_station AS ENUM (
    'reception','nurse','doctor','lab','pharmacy','billing','cashier','other'
  );

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 2
CREATE TYPE public.visit_status AS ENUM ('open','settled','cancelled');

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 3
CREATE TABLE IF NOT EXISTS public.visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_number TEXT NOT NULL UNIQUE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  status public.visit_status NOT NULL DEFAULT 'open',
  presenting_complaint TEXT,
  -- snapshot at check-in so mid-visit changes don't corrupt claims
  sponsor_type TEXT,
  corporate_id UUID REFERENCES public.corporate_accounts(id) ON DELETE SET NULL,
  insurance_plan TEXT,
  -- running totals kept in sync by triggers
  total_charged NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_by UUID REFERENCES public.auth_users(id),
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES public.auth_users(id),
  cancel_reason TEXT,
  force_new_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 4
CREATE INDEX IF NOT EXISTS visits_patient_status_idx ON public.visits (patient_id, status);

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 5
CREATE INDEX IF NOT EXISTS visits_status_opened_idx ON public.visits (status, opened_at DESC);

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 6
CREATE INDEX IF NOT EXISTS visits_sponsor_idx ON public.visits (sponsor_type, corporate_id);

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 7
GRANT SELECT, INSERT, UPDATE ON public.visits TO authenticated;

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 8
GRANT ALL ON public.visits TO service_role;

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 9
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 10
CREATE POLICY "Authenticated staff can view visits"
  ON public.visits FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 11
CREATE POLICY "Clinical/reception/billing can open visits"
  ON public.visits FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(public.hms_current_user_id(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','billing','admin']::app_role[]));

-- SOURCE: 20260721114714_8e46d620-22a7-4be8-b7d6-564e73be8dc7.sql statement 12
CREATE POLICY "Staff can update visits"
  ON public.visits FOR UPDATE TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','lab_tech','pharmacist','billing','accountant','admin']::app_role[]))
  WITH CHECK (public.has_any_role(public.hms_current_user_id(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','lab_tech','pharmacist','billing','accountant','admin']::app_role[]));
