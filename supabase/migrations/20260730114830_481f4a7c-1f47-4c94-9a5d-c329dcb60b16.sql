-- 1) Server-side, role-checked bed assignment
CREATE OR REPLACE FUNCTION public.assign_admission_bed(_admission_id uuid, _bed_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _adm RECORD;
  _bed RECORD;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only a nurse or admin can assign a ward/room/bed';
  END IF;

  SELECT * INTO _adm FROM public.admissions WHERE id = _admission_id FOR UPDATE;
  IF _adm IS NULL THEN RAISE EXCEPTION 'Admission not found'; END IF;
  IF _adm.status <> 'waiting_assignment' THEN
    RAISE EXCEPTION 'Admission is not waiting for a room (%)', _adm.status;
  END IF;

  SELECT * INTO _bed FROM public.beds WHERE id = _bed_id FOR UPDATE;
  IF _bed IS NULL OR NOT _bed.active THEN RAISE EXCEPTION 'Bed not found or inactive'; END IF;
  IF _bed.status <> 'available' THEN RAISE EXCEPTION 'Bed is not available'; END IF;

  UPDATE public.admissions
     SET bed_id = _bed_id,
         assigned_by_nurse = _uid,
         status = 'active',
         admitted_at = now(),
         updated_at = now()
   WHERE id = _admission_id;

  PERFORM public.write_audit_log(
    'admission_bed_assigned', 'admission', _admission_id::text,
    jsonb_build_object('patient_id', _adm.patient_id, 'bed_id', _bed_id)
  );
END $$;

REVOKE ALL ON FUNCTION public.assign_admission_bed(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_admission_bed(uuid, uuid) TO authenticated;

-- 2) Block direct table updates: all admission movement must go through checked RPCs
DROP POLICY IF EXISTS "Nurses & admin update admissions" ON public.admissions;
DROP POLICY IF EXISTS "Doctors create admissions" ON public.admissions;

-- 3) Ensure the RPCs remain reachable only by signed-in staff
REVOKE ALL ON FUNCTION public.request_admission(uuid, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_admission(uuid, text, text, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_ready_for_discharge(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_ready_for_discharge(uuid, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) TO authenticated;
REVOKE ALL ON FUNCTION public.forward_snap_to_billing(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forward_snap_to_billing(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.create_admitted_snap(uuid, text, text, text, text, jsonb, numeric, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_admitted_snap(uuid, text, text, text, text, jsonb, numeric, boolean, text) TO authenticated;
