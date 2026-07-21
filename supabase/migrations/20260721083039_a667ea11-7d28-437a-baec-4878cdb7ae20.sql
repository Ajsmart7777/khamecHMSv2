
REVOKE EXECUTE ON FUNCTION public.audit_invoice_payment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_payroll_processed() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_prescription_dispense() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_user_roles() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_patients_updated_at() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, app_role[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_authenticated_staff() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.write_audit_log(text, text, text, jsonb, text) FROM PUBLIC, anon;
