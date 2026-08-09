-- Hardening SECURITY DEFINER routines by revoking permissions from non-privileged roles
-- These routines are either purely internal (triggers) or already have role checks in plpgsql
-- but Revoking EXECUTE from authenticated/anon is the best practice for hardening the API surface.

-- 1. Internal / System Functions
REVOKE EXECUTE ON FUNCTION public.write_audit_log(text, text, text, jsonb, text) FROM authenticated, PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.adjust_patient_balance(uuid, numeric, text, text, uuid, uuid, text) FROM authenticated, PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.purge_clinical_data(text[]) FROM authenticated, PUBLIC, anon;

-- 2. Trigger Functions (Should never be called via API)
REVOKE EXECUTE ON FUNCTION public.audit_user_roles() FROM authenticated, PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.audit_invoice_payment() FROM authenticated, PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.audit_prescription_dispense() FROM authenticated, PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.audit_payroll_processed() FROM authenticated, PUBLIC, anon;

-- 3. Additional Internal Helpers
REVOKE EXECUTE ON FUNCTION public.is_consultation_fee_required(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.onboard_patient_v2(uuid, boolean, boolean, numeric) FROM PUBLIC, anon;

-- Note: create_prescription_from_typed and create_lab_request_from_typed were already hardened in a previous migration.
