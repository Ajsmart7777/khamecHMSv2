-- Fix SECURITY DEFINER routine permissions
-- Revoke PUBLIC/anon access for newly created workflow routines
REVOKE EXECUTE ON FUNCTION public.create_prescription_from_typed(UUID, UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_lab_request_from_typed(UUID, UUID, TEXT, TEXT[]) FROM PUBLIC, anon;
