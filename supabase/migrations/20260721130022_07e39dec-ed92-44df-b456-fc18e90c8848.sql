
-- Revoke EXECUTE from anon/public on SECURITY DEFINER functions; grant only where needed
REVOKE EXECUTE ON FUNCTION public.autofill_visit_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.invoices_touch_visit_totals() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.snap_orders_sync_paid() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.next_visit_number() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recalc_visit_totals(uuid) FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.close_visit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_visit(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_visit_audit_trail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_visit_audit_trail(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.open_visit_for_patient(uuid, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_visit_for_patient(uuid, text, boolean, text) TO authenticated;
