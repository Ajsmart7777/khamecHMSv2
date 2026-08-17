-- SOURCE: 20260309152934_3b733c10-e1c0-462e-ab19-75fc65d5cccd.sql statement 4
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

-- SOURCE: 20260309152934_3b733c10-e1c0-462e-ab19-75fc65d5cccd.sql statement 5
ALTER TABLE public.insurance_providers ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260309152934_3b733c10-e1c0-462e-ab19-75fc65d5cccd.sql statement 6
ALTER TABLE public.insurance_claims ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260309152934_3b733c10-e1c0-462e-ab19-75fc65d5cccd.sql statement 7
ALTER TABLE public.staff_leave ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260309152934_3b733c10-e1c0-462e-ab19-75fc65d5cccd.sql statement 8
ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260309152934_3b733c10-e1c0-462e-ab19-75fc65d5cccd.sql statement 9
CREATE POLICY "Staff can read insurance_providers" ON public.insurance_providers
  FOR SELECT TO authenticated USING (is_authenticated_staff());

-- SOURCE: 20260309152934_3b733c10-e1c0-462e-ab19-75fc65d5cccd.sql statement 10
CREATE POLICY "Admin can insert insurance_providers" ON public.insurance_providers
  FOR INSERT TO authenticated WITH CHECK (has_any_role(public.hms_current_user_id(), ARRAY['admin'::app_role, 'billing'::app_role]));

-- SOURCE: 20260309152934_3b733c10-e1c0-462e-ab19-75fc65d5cccd.sql statement 11
CREATE POLICY "Admin can update insurance_providers" ON public.insurance_providers
  FOR UPDATE TO authenticated USING (has_any_role(public.hms_current_user_id(), ARRAY['admin'::app_role, 'billing'::app_role]));

-- SOURCE: 20260309152934_3b733c10-e1c0-462e-ab19-75fc65d5cccd.sql statement 12
CREATE POLICY "Admin can delete insurance_providers" ON public.insurance_providers
  FOR DELETE TO authenticated USING (has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260309152934_3b733c10-e1c0-462e-ab19-75fc65d5cccd.sql statement 13
CREATE POLICY "Staff can read insurance_claims" ON public.insurance_claims
  FOR SELECT TO authenticated USING (is_authenticated_staff());

-- SOURCE: 20260309152934_3b733c10-e1c0-462e-ab19-75fc65d5cccd.sql statement 14
CREATE POLICY "Billing can insert insurance_claims" ON public.insurance_claims
  FOR INSERT TO authenticated WITH CHECK (has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260309152934_3b733c10-e1c0-462e-ab19-75fc65d5cccd.sql statement 15
CREATE POLICY "Billing can update insurance_claims" ON public.insurance_claims
  FOR UPDATE TO authenticated USING (has_any_role(public.hms_current_user_id(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- SOURCE: 20260309152934_3b733c10-e1c0-462e-ab19-75fc65d5cccd.sql statement 16
CREATE POLICY "Staff can read own leave" ON public.staff_leave
  FOR SELECT TO authenticated USING (is_authenticated_staff());

-- SOURCE: 20260309152934_3b733c10-e1c0-462e-ab19-75fc65d5cccd.sql statement 17
CREATE POLICY "Admin can insert staff_leave" ON public.staff_leave
  FOR INSERT TO authenticated WITH CHECK (has_any_role(public.hms_current_user_id(), ARRAY['admin'::app_role, 'billing'::app_role]));

-- SOURCE: 20260309152934_3b733c10-e1c0-462e-ab19-75fc65d5cccd.sql statement 18
CREATE POLICY "Admin can update staff_leave" ON public.staff_leave
  FOR UPDATE TO authenticated USING (has_any_role(public.hms_current_user_id(), ARRAY['admin'::app_role, 'billing'::app_role]));

-- SOURCE: 20260309152934_3b733c10-e1c0-462e-ab19-75fc65d5cccd.sql statement 19
CREATE POLICY "Admin can delete staff_leave" ON public.staff_leave
  FOR DELETE TO authenticated USING (has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260309152934_3b733c10-e1c0-462e-ab19-75fc65d5cccd.sql statement 20
CREATE POLICY "Staff can read attendance" ON public.staff_attendance
  FOR SELECT TO authenticated USING (is_authenticated_staff());

-- SOURCE: 20260309152934_3b733c10-e1c0-462e-ab19-75fc65d5cccd.sql statement 21
CREATE POLICY "Admin can insert attendance" ON public.staff_attendance
  FOR INSERT TO authenticated WITH CHECK (has_any_role(public.hms_current_user_id(), ARRAY['admin'::app_role, 'billing'::app_role]));

-- SOURCE: 20260309152934_3b733c10-e1c0-462e-ab19-75fc65d5cccd.sql statement 22
CREATE POLICY "Admin can update attendance" ON public.staff_attendance
  FOR UPDATE TO authenticated USING (has_any_role(public.hms_current_user_id(), ARRAY['admin'::app_role, 'billing'::app_role]));

-- SOURCE: 20260309163559_5f04b897-fb50-4050-ade9-78182dc30a18.sql statement 1
ALTER TABLE public.payroll_payments RENAME COLUMN paystack_transfer_code TO provider_transfer_code;

-- SOURCE: 20260309163559_5f04b897-fb50-4050-ade9-78182dc30a18.sql statement 2
ALTER TABLE public.payroll_payments RENAME COLUMN paystack_reference TO provider_reference;

-- SOURCE: 20260309163559_5f04b897-fb50-4050-ade9-78182dc30a18.sql statement 3
ALTER TABLE public.payroll_payments RENAME COLUMN paystack_recipient_code TO provider_recipient_code;

-- SOURCE: 20260309183641_3533cbba-239d-480f-a427-5070b5572fc8.sql statement 1
ALTER TABLE public.payroll_payments ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'flutterwave';

-- SOURCE: 20260630033419_576bc116-554b-47b7-9bfa-ea75fc87b73a.sql statement 1
DROP POLICY IF EXISTS "Only admins can delete patients" ON public.patients;

-- SOURCE: 20260630033419_576bc116-554b-47b7-9bfa-ea75fc87b73a.sql statement 2
CREATE POLICY "Only admins can delete patients"
ON public.patients FOR DELETE TO authenticated
USING (public.has_role(public.hms_current_user_id(), 'admin'));

-- SOURCE: 20260630033419_576bc116-554b-47b7-9bfa-ea75fc87b73a.sql statement 3
DROP POLICY IF EXISTS "Doctors and admins can delete prescriptions" ON public.prescriptions;

-- SOURCE: 20260630033419_576bc116-554b-47b7-9bfa-ea75fc87b73a.sql statement 4
CREATE POLICY "Doctors and admins can delete prescriptions"
ON public.prescriptions FOR DELETE TO authenticated
USING (public.has_any_role(public.hms_current_user_id(), ARRAY['doctor', 'admin']::app_role[]));

-- SOURCE: 20260630033419_576bc116-554b-47b7-9bfa-ea75fc87b73a.sql statement 5
DROP POLICY IF EXISTS "Clinical staff can delete prescription items" ON public.prescription_items;

-- SOURCE: 20260630033419_576bc116-554b-47b7-9bfa-ea75fc87b73a.sql statement 6
CREATE POLICY "Clinical staff can delete prescription items"
ON public.prescription_items FOR DELETE TO authenticated
USING (public.has_any_role(public.hms_current_user_id(), ARRAY['doctor', 'pharmacist', 'admin']::app_role[]));

-- SOURCE: 20260630033419_576bc116-554b-47b7-9bfa-ea75fc87b73a.sql statement 7
DROP POLICY IF EXISTS "Lab techs and admins can delete lab requests" ON public.lab_requests;

-- SOURCE: 20260630033419_576bc116-554b-47b7-9bfa-ea75fc87b73a.sql statement 8
CREATE POLICY "Lab techs and admins can delete lab requests"
ON public.lab_requests FOR DELETE TO authenticated
USING (public.has_any_role(public.hms_current_user_id(), ARRAY['lab_tech', 'admin']::app_role[]));

-- SOURCE: 20260701001126_c8c5baee-6d67-4b32-8af3-ec3c4bb95f41.sql statement 1
CREATE OR REPLACE FUNCTION public.write_audit_log(
  _action text,
  _resource_type text,
  _resource_id text,
  _details jsonb,
  _status text DEFAULT 'success'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
BEGIN
  INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, details, status)
  VALUES (public.hms_current_user_id(), _action, _resource_type, _resource_id, _details, _status);
END;
$$;

-- SOURCE: 20260701001126_c8c5baee-6d67-4b32-8af3-ec3c4bb95f41.sql statement 2
CREATE OR REPLACE FUNCTION public.audit_user_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT public.write_audit_log('role_assigned', 'user_role', (NEW).id::text, jsonb_build_object('target_user_id', (NEW).user_id, 'role', (NEW).role)
    , 'success');
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT public.write_audit_log('role_removed', 'user_role', (OLD).id::text, jsonb_build_object('target_user_id', (OLD).user_id, 'role', (OLD).role)
    , 'success');
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND ((NEW).role IS DISTINCT FROM (OLD).role OR (NEW).user_id IS DISTINCT FROM (OLD).user_id) THEN
    SELECT public.write_audit_log('role_assigned', 'user_role', (NEW).id::text, jsonb_build_object('target_user_id', (NEW).user_id, 'old_role', (OLD).role, 'new_role', (NEW).role)
    , 'success');
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

-- SOURCE: 20260701001126_c8c5baee-6d67-4b32-8af3-ec3c4bb95f41.sql statement 3
DROP TRIGGER IF EXISTS trg_audit_user_roles ON public.user_roles;

-- SOURCE: 20260701001126_c8c5baee-6d67-4b32-8af3-ec3c4bb95f41.sql statement 4
CREATE TRIGGER trg_audit_user_roles
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.audit_user_roles();

-- SOURCE: 20260701001126_c8c5baee-6d67-4b32-8af3-ec3c4bb95f41.sql statement 5
CREATE OR REPLACE FUNCTION public.audit_invoice_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW).paid_amount > COALESCE((OLD).paid_amount, 0) THEN
    SELECT public.write_audit_log('payment_received', 'invoice', (NEW).id::text, jsonb_build_object(
        'invoice_number', (NEW).invoice_number,
        'patient_id', (NEW).patient_id,
        'amount', (NEW).paid_amount - COALESCE((OLD).paid_amount, 0),
        'new_paid_total', (NEW).paid_amount,
        'total_amount', (NEW).total_amount,
        'payment_method', (NEW).payment_method,
        'status', (NEW).status
      )
    , 'success');
  END IF;
  RETURN NEW;
END;
$$;

-- SOURCE: 20260701001126_c8c5baee-6d67-4b32-8af3-ec3c4bb95f41.sql statement 6
DROP TRIGGER IF EXISTS trg_audit_invoice_payment ON public.invoices;

-- SOURCE: 20260701001126_c8c5baee-6d67-4b32-8af3-ec3c4bb95f41.sql statement 7
CREATE TRIGGER trg_audit_invoice_payment
AFTER UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.audit_invoice_payment();

-- SOURCE: 20260701001126_c8c5baee-6d67-4b32-8af3-ec3c4bb95f41.sql statement 8
CREATE OR REPLACE FUNCTION public.audit_prescription_dispense()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW).status = 'dispensed'
     AND COALESCE((OLD).status, '') <> 'dispensed' THEN
    SELECT public.write_audit_log('prescription_dispensed', 'prescription', (NEW).id::text, jsonb_build_object('patient_id', (NEW).patient_id, 'diagnosis', (NEW).diagnosis)
    , 'success');
  END IF;
  RETURN NEW;
END;
$$;

-- SOURCE: 20260701001126_c8c5baee-6d67-4b32-8af3-ec3c4bb95f41.sql statement 9
DROP TRIGGER IF EXISTS trg_audit_prescription_dispense ON public.prescriptions;

-- SOURCE: 20260701001126_c8c5baee-6d67-4b32-8af3-ec3c4bb95f41.sql statement 10
CREATE TRIGGER trg_audit_prescription_dispense
AFTER UPDATE ON public.prescriptions
FOR EACH ROW EXECUTE FUNCTION public.audit_prescription_dispense();

-- SOURCE: 20260701001126_c8c5baee-6d67-4b32-8af3-ec3c4bb95f41.sql statement 11
CREATE OR REPLACE FUNCTION public.audit_payroll_processed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW).status = 'paid'
     AND COALESCE((OLD).status, '') <> 'paid' THEN
    SELECT public.write_audit_log('salary_processed', 'payroll_entry', (NEW).id::text, jsonb_build_object(
        'staff_id', (NEW).staff_id,
        'payroll_period_id', (NEW).payroll_period_id,
        'net_pay', (NEW).net_pay,
        'payment_reference', (NEW).payment_reference
      )
    , 'success');
  END IF;
  RETURN NEW;
END;
$$;

-- SOURCE: 20260701001126_c8c5baee-6d67-4b32-8af3-ec3c4bb95f41.sql statement 12
DROP TRIGGER IF EXISTS trg_audit_payroll_processed ON public.payroll_entries;

-- SOURCE: 20260701001126_c8c5baee-6d67-4b32-8af3-ec3c4bb95f41.sql statement 13
CREATE TRIGGER trg_audit_payroll_processed
AFTER UPDATE ON public.payroll_entries
FOR EACH ROW EXECUTE FUNCTION public.audit_payroll_processed();

-- SOURCE: 20260721064937_ec064f2e-b1dd-4dac-92a9-1a0a864de02f.sql statement 1
ALTER TYPE public.app_role ADD VALUE 'accountant';

-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 1
ALTER TABLE public.corporate_accounts
  ADD COLUMN IF NOT EXISTS sponsor_type text NOT NULL DEFAULT 'corporate';

-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 2
ALTER TABLE public.insurance_claims
  ADD COLUMN IF NOT EXISTS sponsor_type text NOT NULL DEFAULT 'insurance',
  ADD COLUMN IF NOT EXISTS corporate_account_id uuid REFERENCES public.corporate_accounts(id);

-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 3
ALTER TABLE public.insurance_claims ALTER COLUMN provider_id DROP NOT NULL;

-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 4
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS original_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sponsor_type text,
  ADD COLUMN IF NOT EXISTS corporate_account_id uuid REFERENCES public.corporate_accounts(id);

-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 5
CREATE TABLE IF NOT EXISTS public.external_doctors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  specialty text,
  schedule_notes text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 6
GRANT SELECT, INSERT, UPDATE, DELETE ON public.external_doctors TO authenticated;

-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 7
GRANT ALL ON public.external_doctors TO service_role;

-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 8
ALTER TABLE public.external_doctors ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 9
CREATE POLICY "Staff can read external_doctors" ON public.external_doctors
  FOR SELECT TO authenticated USING (is_authenticated_staff());

-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 10
CREATE POLICY "Receptionist and admin can insert external_doctors" ON public.external_doctors
  FOR INSERT TO authenticated
  WITH CHECK (has_any_role(public.hms_current_user_id(), ARRAY['receptionist'::app_role, 'admin'::app_role]));

-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 11
CREATE POLICY "Receptionist and admin can update external_doctors" ON public.external_doctors
  FOR UPDATE TO authenticated
  USING (has_any_role(public.hms_current_user_id(), ARRAY['receptionist'::app_role, 'admin'::app_role]));

-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 12
CREATE POLICY "Admin can delete external_doctors" ON public.external_doctors
  FOR DELETE TO authenticated
  USING (has_role(public.hms_current_user_id(), 'admin'::app_role));

-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 13
CREATE TRIGGER update_external_doctors_updated_at
  BEFORE UPDATE ON public.external_doctors
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 14
CREATE TABLE IF NOT EXISTS public.standing_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  external_doctor_id uuid REFERENCES public.external_doctors(id),
  external_doctor_name text,
  photo_url text NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'pending_fulfillment',
  expiry_date date,
  transcribed_prescription_id uuid REFERENCES public.prescriptions(id),
  captured_by uuid REFERENCES public.auth_users(id),
  fulfilled_by uuid REFERENCES public.auth_users(id),
  fulfilled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- SOURCE: 20260721065816_90a900a5-ac72-4883-a138-e7892d2901e5.sql statement 15
GRANT SELECT, INSERT, UPDATE, DELETE ON public.standing_orders TO authenticated;
