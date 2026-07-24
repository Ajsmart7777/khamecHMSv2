REVOKE EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.advance_journey(uuid, text, text, uuid, text, text, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.advance_journey(uuid, text, text, uuid, text, text, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.advance_journey(uuid, text, text, uuid, text, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_journey(uuid, text, text, uuid, text, text, uuid, text) TO service_role;