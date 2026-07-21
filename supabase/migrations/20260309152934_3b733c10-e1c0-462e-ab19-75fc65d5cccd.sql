
-- Insurance providers table
CREATE TABLE public.insurance_providers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'private', -- 'nhis', 'private', 'hmo'
  code TEXT UNIQUE,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  coverage_percentage NUMERIC NOT NULL DEFAULT 0,
  max_coverage_amount NUMERIC NOT NULL DEFAULT 0,
  plans JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insurance claims tracking
CREATE TABLE public.insurance_claims (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_number TEXT NOT NULL UNIQUE,
  patient_id UUID NOT NULL REFERENCES public.patients(id),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id),
  provider_id UUID NOT NULL REFERENCES public.insurance_providers(id),
  total_amount NUMERIC NOT NULL DEFAULT 0,
  covered_amount NUMERIC NOT NULL DEFAULT 0,
  patient_copay NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'submitted', -- submitted, approved, rejected, paid, partial
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  rejection_reason TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Staff leave management
CREATE TABLE public.staff_leave (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL DEFAULT 'annual', -- annual, sick, maternity, emergency, unpaid
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_count INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected, cancelled
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Staff attendance (linked to shift logs but standalone tracking)
CREATE TABLE public.staff_attendance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  clock_in TIMESTAMPTZ,
  clock_out TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'present', -- present, absent, late, half_day, leave
  notes TEXT,
  shift_log_id UUID REFERENCES public.shift_logs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.insurance_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_leave ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;

-- Insurance providers: billing/admin/receptionist can read, admin can write
CREATE POLICY "Staff can read insurance_providers" ON public.insurance_providers
  FOR SELECT TO authenticated USING (is_authenticated_staff());

CREATE POLICY "Admin can insert insurance_providers" ON public.insurance_providers
  FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'billing'::app_role]));

CREATE POLICY "Admin can update insurance_providers" ON public.insurance_providers
  FOR UPDATE TO authenticated USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'billing'::app_role]));

CREATE POLICY "Admin can delete insurance_providers" ON public.insurance_providers
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- Insurance claims: billing/admin can manage
CREATE POLICY "Staff can read insurance_claims" ON public.insurance_claims
  FOR SELECT TO authenticated USING (is_authenticated_staff());

CREATE POLICY "Billing can insert insurance_claims" ON public.insurance_claims
  FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing can update insurance_claims" ON public.insurance_claims
  FOR UPDATE TO authenticated USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- Staff leave: admin manages, staff can read own
CREATE POLICY "Staff can read own leave" ON public.staff_leave
  FOR SELECT TO authenticated USING (is_authenticated_staff());

CREATE POLICY "Admin can insert staff_leave" ON public.staff_leave
  FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'billing'::app_role]));

CREATE POLICY "Admin can update staff_leave" ON public.staff_leave
  FOR UPDATE TO authenticated USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'billing'::app_role]));

CREATE POLICY "Admin can delete staff_leave" ON public.staff_leave
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- Staff attendance: admin can manage
CREATE POLICY "Staff can read attendance" ON public.staff_attendance
  FOR SELECT TO authenticated USING (is_authenticated_staff());

CREATE POLICY "Admin can insert attendance" ON public.staff_attendance
  FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'billing'::app_role]));

CREATE POLICY "Admin can update attendance" ON public.staff_attendance
  FOR UPDATE TO authenticated USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'billing'::app_role]));

-- Enable realtime for claims
ALTER PUBLICATION supabase_realtime ADD TABLE public.insurance_claims;
ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_attendance;
