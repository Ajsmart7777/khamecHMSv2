-- Recover a staff record marked "Deactivated" (status = 'deleted') back to
-- 'active', keeping every saved detail (designation, salary, bank, employment
-- data) so the person shows up in Register Staff and Payroll again.
--
-- Why this is needed:
--   public.prevent_deleted_staff_reactivation() (created by
--   20260822170000_staff_deactivation_and_patient_migration.sql) raises
--   STAFF_DELETED on every UPDATE that moves a deleted staff row to another
--   status. Both the recovery script and any Register Staff attempt run inside
--   a transaction, so the exception rolled the whole update back and the record
--   stayed deactivated while the deploy looked successful.
--
-- The guard stays in force for every other code path. reactivate_staff_member()
-- writes a row into staff_reactivation_grants for the staff id, performs the
-- update and removes the row again - all inside one transaction, so the opening
-- exists for exactly that one statement and disappears with a rollback.
-- (A session variable cannot be used here: CockroachDB does not propagate
-- set_config() from inside a PL/pgSQL routine to the trigger it fires.)
--
-- Idempotent: safe to apply more than once.

ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS deleted_by uuid;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS deletion_reason text;

CREATE TABLE IF NOT EXISTS public.staff_reactivation_grants (
  staff_id uuid PRIMARY KEY,
  granted_at timestamptz NOT NULL DEFAULT now()
);

-- CockroachDB refuses to replace a trigger function while its trigger is
-- active, so the trigger is dropped first and recreated at the end.
DROP TRIGGER IF EXISTS staff_prevent_deleted_reactivation ON public.staff;

CREATE OR REPLACE FUNCTION public.prevent_deleted_staff_reactivation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.staff_reactivation_grants g WHERE g.staff_id = (NEW).id) THEN
    RETURN NEW;
  END IF;
  IF (OLD).status = 'deleted' AND (NEW).status <> 'deleted' THEN
    RAISE EXCEPTION 'STAFF_DELETED: a deleted staff record cannot be reactivated';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER staff_prevent_deleted_reactivation
  BEFORE UPDATE ON public.staff
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_deleted_staff_reactivation();

CREATE OR REPLACE FUNCTION public.reactivate_staff_member(
  _staff_id uuid,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid uuid := public.hms_current_user_id();
  v_staff_id uuid;
  v_staff_name text;
  v_previous_status text;
  v_patients_cleared integer := 0;
BEGIN
  IF NOT public.has_any_role(v_uid, ARRAY['admin','accountant']::app_role[]) THEN
    RAISE EXCEPTION 'Only the Accountant or an administrator can reactivate staff accounts';
  END IF;

  SELECT s.id,
         concat_ws(' ', s.first_name, s.last_name),
         s.status::text
    INTO v_staff_id, v_staff_name, v_previous_status
  FROM public.staff s
  WHERE s.id = _staff_id
  FOR UPDATE;

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Staff member not found';
  END IF;

  IF v_previous_status NOT IN ('deleted', 'inactive') THEN
    RETURN jsonb_build_object(
      'action', 'noop',
      'staff_id', v_staff_id,
      'staff_name', v_staff_name,
      'previous_status', v_previous_status,
      'status', v_previous_status
    );
  END IF;

  -- Open the deleted-staff guard for this single update only.
  INSERT INTO public.staff_reactivation_grants (staff_id) VALUES (_staff_id)
  ON CONFLICT (staff_id) DO NOTHING;

  UPDATE public.staff
     SET status = 'active',
         deleted_at = NULL,
         deleted_by = NULL,
         deletion_reason = NULL,
         updated_at = now()
   WHERE id = _staff_id;

  DELETE FROM public.staff_reactivation_grants WHERE staff_id = _staff_id;

  -- The deactivation flagged the staff member's patient accounts for a
  -- Reception migration; they belong to an active staff member again.
  SELECT count(*)
    INTO v_patients_cleared
  FROM public.patients p
  WHERE p.staff_migration_required = true
    AND (p.staff_link_id = _staff_id
         OR p.id IN (SELECT sfm.patient_id FROM public.staff_family_members sfm WHERE sfm.staff_id = _staff_id));

  UPDATE public.patients
     SET staff_migration_required = false,
         staff_migration_staff_id = NULL,
         staff_migration_marked_at = NULL,
         staff_migration_marked_reason = NULL
   WHERE staff_migration_required = true
     AND (staff_link_id = _staff_id
          OR id IN (SELECT sfm.patient_id FROM public.staff_family_members sfm WHERE sfm.staff_id = _staff_id));

  SELECT public.write_audit_log(
    'staff_reactivated'::text,
    'staff'::text,
    _staff_id::text,
    jsonb_build_object(
      'staff_name', v_staff_name,
      'previous_status', v_previous_status,
      'patient_flags_cleared', v_patients_cleared,
      'reason', COALESCE(NULLIF(_reason, ''), '')
    )::jsonb,
    'success'::text
  );

  RETURN jsonb_build_object(
    'action', 'reactivated',
    'staff_id', v_staff_id,
    'staff_name', v_staff_name,
    'previous_status', v_previous_status,
    'status', 'active',
    'patient_flags_cleared', v_patients_cleared
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reactivate_staff_member(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reactivate_staff_member(uuid, text) TO authenticated;
