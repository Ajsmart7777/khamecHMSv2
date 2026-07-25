
ALTER TABLE public.insurance_providers
  ADD COLUMN IF NOT EXISTS member_id_fields JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS member_id_data JSONB;

ALTER TABLE public.eligibility_verifications
  ADD COLUMN IF NOT EXISTS member_id_data JSONB;

-- Seed common templates only for existing providers with empty templates
UPDATE public.insurance_providers
   SET member_id_fields = '[
     {"key":"enrollee_id","label":"NHIA Enrollee Number","required":true,"pattern":"","placeholder":"e.g. NHIA/2024/12345","primary":true},
     {"key":"dependant_id","label":"Dependant ID","required":false,"placeholder":"If dependant"},
     {"key":"plan_tier","label":"Plan Tier","required":false,"placeholder":"e.g. Formal Sector"}
   ]'::jsonb
 WHERE (member_id_fields IS NULL OR member_id_fields = '[]'::jsonb)
   AND (lower(name) LIKE '%nhia%' OR lower(name) LIKE '%nhis%');

UPDATE public.insurance_providers
   SET member_id_fields = '[
     {"key":"call_up_number","label":"Call-up Number","required":true,"placeholder":"e.g. NYSC/2024/1234","primary":true},
     {"key":"state_code","label":"State Code","required":true,"placeholder":"e.g. LA/23A/1234"},
     {"key":"batch","label":"Batch","required":false,"placeholder":"e.g. 2024 Batch A"}
   ]'::jsonb
 WHERE (member_id_fields IS NULL OR member_id_fields = '[]'::jsonb)
   AND lower(name) LIKE '%nysc%';

UPDATE public.insurance_providers
   SET member_id_fields = '[
     {"key":"enrollee_id","label":"Hygeia Enrollee ID","required":true,"primary":true},
     {"key":"pre_auth_token","label":"Pre-Auth / Token Number","required":false,"placeholder":"e.g. HYG-PA-778821"},
     {"key":"plan","label":"Plan","required":false}
   ]'::jsonb
 WHERE (member_id_fields IS NULL OR member_id_fields = '[]'::jsonb)
   AND lower(name) LIKE '%hygeia%';

UPDATE public.insurance_providers
   SET member_id_fields = '[
     {"key":"enrollee_id","label":"AXA Enrollee ID","required":true,"primary":true},
     {"key":"encounter_code","label":"Encounter Code / OTP","required":true,"placeholder":"e.g. AXA-OTP-8493021"},
     {"key":"plan","label":"Plan","required":false}
   ]'::jsonb
 WHERE (member_id_fields IS NULL OR member_id_fields = '[]'::jsonb)
   AND (lower(name) LIKE '%axa%' OR lower(name) LIKE '%mansard%');

UPDATE public.insurance_providers
   SET member_id_fields = '[
     {"key":"katchma_id","label":"KATCHMA ID","required":true,"primary":true},
     {"key":"plan","label":"Plan","required":false}
   ]'::jsonb
 WHERE (member_id_fields IS NULL OR member_id_fields = '[]'::jsonb)
   AND lower(name) LIKE '%katchma%';
