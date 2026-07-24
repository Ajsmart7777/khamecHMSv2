CREATE TABLE public.eligibility_verifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  sponsor_type text NOT NULL CHECK (sponsor_type IN ('nhis','hmo','katchma','corporate','retainer')),
  provider_id uuid REFERENCES public.insurance_providers(id) ON DELETE SET NULL,
  provider_name text,
  enrollee_id text,
  plan text,
  encounter_code text,
  encounter_code_captured_at timestamp with time zone,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  rejection_reason text,
  notes text,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_eligibility_status ON public.eligibility_verifications(status, created_at DESC);
CREATE INDEX idx_eligibility_patient ON public.eligibility_verifications(patient_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.eligibility_verifications TO authenticated;
GRANT ALL ON public.eligibility_verifications TO service_role;

ALTER TABLE public.eligibility_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_view_eligibility"
  ON public.eligibility_verifications FOR SELECT
  TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "staff_create_eligibility"
  ON public.eligibility_verifications FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['receptionist','claims_manager','admin']::app_role[])
  );

CREATE POLICY "claims_manager_update_eligibility"
  ON public.eligibility_verifications FOR UPDATE
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['claims_manager','admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['claims_manager','admin']::app_role[]));

CREATE TRIGGER eligibility_touch_updated_at
  BEFORE UPDATE ON public.eligibility_verifications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();