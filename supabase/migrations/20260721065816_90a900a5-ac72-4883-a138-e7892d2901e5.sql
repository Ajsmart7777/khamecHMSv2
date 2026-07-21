
-- 1. Corporate accounts: sponsor_type (corporate vs retainer)
ALTER TABLE public.corporate_accounts
  ADD COLUMN IF NOT EXISTS sponsor_type text NOT NULL DEFAULT 'corporate';

-- 2. Insurance claims: sponsor_type discriminator (insurance | corporate | retainer)
ALTER TABLE public.insurance_claims
  ADD COLUMN IF NOT EXISTS sponsor_type text NOT NULL DEFAULT 'insurance',
  ADD COLUMN IF NOT EXISTS corporate_account_id uuid REFERENCES public.corporate_accounts(id);

-- provider_id needs to be nullable for corporate/retainer claims
ALTER TABLE public.insurance_claims ALTER COLUMN provider_id DROP NOT NULL;

-- 3. Invoices: discount tracking
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS original_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sponsor_type text,
  ADD COLUMN IF NOT EXISTS corporate_account_id uuid REFERENCES public.corporate_accounts(id);

-- 4. External doctors
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.external_doctors TO authenticated;
GRANT ALL ON public.external_doctors TO service_role;

ALTER TABLE public.external_doctors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read external_doctors" ON public.external_doctors
  FOR SELECT TO authenticated USING (is_authenticated_staff());

CREATE POLICY "Receptionist and admin can insert external_doctors" ON public.external_doctors
  FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['receptionist'::app_role, 'admin'::app_role]));

CREATE POLICY "Receptionist and admin can update external_doctors" ON public.external_doctors
  FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['receptionist'::app_role, 'admin'::app_role]));

CREATE POLICY "Admin can delete external_doctors" ON public.external_doctors
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_external_doctors_updated_at
  BEFORE UPDATE ON public.external_doctors
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

-- 5. Standing orders (prescriptions from external doctors, captured by receptionist)
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
  captured_by uuid REFERENCES auth.users(id),
  fulfilled_by uuid REFERENCES auth.users(id),
  fulfilled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.standing_orders TO authenticated;
GRANT ALL ON public.standing_orders TO service_role;

ALTER TABLE public.standing_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read standing_orders" ON public.standing_orders
  FOR SELECT TO authenticated USING (is_authenticated_staff());

CREATE POLICY "Receptionist and admin can insert standing_orders" ON public.standing_orders
  FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['receptionist'::app_role, 'admin'::app_role]));

CREATE POLICY "Clinical and admin can update standing_orders" ON public.standing_orders
  FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['receptionist'::app_role, 'doctor'::app_role, 'pharmacist'::app_role, 'admin'::app_role]));

CREATE POLICY "Admin can delete standing_orders" ON public.standing_orders
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_standing_orders_updated_at
  BEFORE UPDATE ON public.standing_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

CREATE INDEX IF NOT EXISTS standing_orders_patient_id_idx ON public.standing_orders(patient_id);
CREATE INDEX IF NOT EXISTS standing_orders_status_idx ON public.standing_orders(status);
CREATE INDEX IF NOT EXISTS insurance_claims_sponsor_type_idx ON public.insurance_claims(sponsor_type);
CREATE INDEX IF NOT EXISTS insurance_claims_corporate_account_id_idx ON public.insurance_claims(corporate_account_id);
