-- Staff deletion from Account > Register Staff.
--
-- Two problems made the trash button fail in production:
--   1. deactivate_staff_for_migration() was gated to 'admin' only, so the
--      Accountant account could never deactivate a staff member.
--   2. The routine (and its supporting columns/functions) came from
--      20260822170000_staff_deactivation_and_patient_migration.sql, which was
--      never added to the deploy-time migration runner, so the live database
--      may not have the function at all.
--
-- This migration is idempotent and self-contained: it adds the columns the
-- routine needs and (re)creates the routine with Accountant access. Historical
-- data is preserved; staff are soft-deleted and linked patients are queued for
-- Reception migration.

ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS deleted_by uuid;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS deletion_reason text;

ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS staff_migration_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS staff_migration_staff_id uuid;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS staff_migration_marked_at timestamptz;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS staff_migration_marked_reason text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS staff_migrated_at timestamptz;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS staff_migrated_by uuid;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS staff_migrated_from_account_type text;

ALTER TABLE public.staff_family_members ADD COLUMN IF NOT EXISTS released_at timestamptz;
ALTER TABLE public.staff_family_members ADD COLUMN IF NOT EXISTS released_by uuid;
ALTER TABLE public.staff_family_members ADD COLUMN IF NOT EXISTS release_reason text;

CREATE OR REPLACE FUNCTION public.deactivate_staff_for_migration(
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
  v_staff_patient_count integer := 0;
  v_family_patient_count integer := 0;
  v_now timestamptz := now();
BEGIN
  -- Account (Register Staff) and Admin both own staff management.
  IF NOT public.has_any_role(v_uid, ARRAY['admin','accountant']::app_role[]) THEN
    RAISE EXCEPTION 'Only the Accountant or an administrator can deactivate staff accounts';
  END IF;

  SELECT s.id,
         concat_ws(' ', s.first_name, s.last_name),
         s.status
    INTO v_staff_id, v_staff_name, v_previous_status
  FROM public.staff s
  WHERE s.id = _staff_id
  FOR UPDATE;

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Staff member not found';
  END IF;

  SELECT count(*)
    INTO v_staff_patient_count
  FROM public.patients p
  WHERE p.staff_link_id = _staff_id
    AND p.account_type = 'staff';

  SELECT count(*)
    INTO v_family_patient_count
  FROM public.staff_family_members sfm
  JOIN public.patients p ON p.id = sfm.patient_id
  WHERE sfm.staff_id = _staff_id
    AND sfm.released_at IS NULL
    AND p.account_type = 'staff_family';

  UPDATE public.staff
  SET status = 'deleted',
      deleted_at = COALESCE(deleted_at, v_now),
      deleted_by = COALESCE(deleted_by, v_uid),
      deletion_reason = COALESCE(NULLIF(_reason, ''), deletion_reason),
      is_system_user = false,
      updated_at = v_now
  WHERE id = _staff_id;

  UPDATE public.patients
  SET staff_migration_required = true,
      staff_migration_staff_id = _staff_id,
      staff_migration_marked_at = COALESCE(staff_migration_marked_at, v_now),
      staff_migration_marked_reason = COALESCE(NULLIF(_reason, ''), 'Linked staff member was deactivated'),
      updated_at = v_now
  WHERE (staff_link_id = _staff_id AND account_type = 'staff')
     OR id IN (
       SELECT sfm.patient_id
       FROM public.staff_family_members sfm
       WHERE sfm.staff_id = _staff_id
         AND sfm.released_at IS NULL
         AND EXISTS (
           SELECT 1 FROM public.patients fp
           WHERE fp.id = sfm.patient_id
             AND fp.account_type = 'staff_family'
         )
     );

  PERFORM public.write_audit_log(
    'staff_deactivated_for_patient_migration'::text,
    jsonb_build_object(
      'staff_name', v_staff_name,
      'previous_status', v_previous_status,
      'staff_patient_count', v_staff_patient_count,
      'family_patient_count', v_family_patient_count,
      'reason', COALESCE(_reason, '')
    )::jsonb,
    _staff_id::uuid,
    'staff'::text,
    'success'::text
  );

  RETURN jsonb_build_object(
    'action', 'deactivated',
    'staff_id', _staff_id,
    'staff_name', v_staff_name,
    'staff_patient_count', v_staff_patient_count,
    'family_patient_count', v_family_patient_count,
    'already_deleted', v_previous_status = 'deleted'
  );
END;
$$;

-- Reception/admin-only one-click conversion used after a staff deactivation.
CREATE OR REPLACE FUNCTION public.convert_staff_linked_patient_to_normal(
  _patient_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid uuid := public.hms_current_user_id();
  v_patient_id uuid;
  v_old_type text;
  v_staff_id uuid;
  v_staff_name text;
  v_family_link_id uuid;
  v_was_required boolean;
BEGIN
  IF NOT public.has_any_role(v_uid, ARRAY['receptionist','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only reception staff and administrators can migrate staff-linked patients';
  END IF;

  SELECT p.id, p.account_type, p.staff_link_id, p.staff_migration_required
    INTO v_patient_id, v_old_type, v_staff_id, v_was_required
  FROM public.patients p
  WHERE p.id = _patient_id
  FOR UPDATE;

  IF v_patient_id IS NULL THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;

  IF v_old_type NOT IN ('staff', 'staff_family') THEN
    RAISE EXCEPTION 'Only Staff and Staff Family patients can be migrated';
  END IF;

  SELECT s.id, concat_ws(' ', s.first_name, s.last_name)
    INTO v_staff_id, v_staff_name
  FROM public.staff s
  WHERE s.id = COALESCE(v_staff_id, (
    SELECT sfm.staff_id
    FROM public.staff_family_members sfm
    WHERE sfm.patient_id = _patient_id
      AND sfm.released_at IS NULL
    LIMIT 1
  ));

  SELECT sfm.id
    INTO v_family_link_id
  FROM public.staff_family_members sfm
  WHERE sfm.patient_id = _patient_id
    AND sfm.released_at IS NULL
  FOR UPDATE;

  IF v_family_link_id IS NOT NULL THEN
    UPDATE public.staff_family_members
    SET released_at = now(),
        released_by = v_uid,
        release_reason = 'Patient converted to normal account after linked staff deactivation',
        updated_at = now()
    WHERE id = v_family_link_id;
  END IF;

  UPDATE public.patients
  SET account_type = 'normal',
      corporate_id = NULL,
      insurance_provider = NULL,
      insurance_policy_number = NULL,
      insurance_plan = NULL,
      staff_link_id = NULL,
      staff_migration_required = false,
      staff_migrated_at = now(),
      staff_migrated_by = v_uid,
      staff_migrated_from_account_type = v_old_type,
      updated_at = now()
  WHERE id = _patient_id;

  SELECT public.write_audit_log(
    'staff_linked_patient_migrated_to_normal'::text,
    jsonb_build_object(
      'old_account_type', v_old_type,
      'staff_id', v_staff_id,
      'staff_name', v_staff_name,
      'family_link_released', v_family_link_id IS NOT NULL,
      'was_migration_required', COALESCE(v_was_required, false)
    )::jsonb,
    _patient_id::uuid,
    'patient'::text,
    'success'::text
  );

  RETURN jsonb_build_object(
    'action', 'migrated_to_normal',
    'patient_id', _patient_id,
    'old_account_type', v_old_type,
    'staff_id', v_staff_id,
    'family_link_released', v_family_link_id IS NOT NULL
  );
END;
$$;

-- Reception uses this read-only queue to show all patients awaiting conversion.
CREATE OR REPLACE FUNCTION public.get_staff_patient_migration_queue()
RETURNS TABLE (
  patient_id uuid,
  first_name text,
  last_name text,
  card_number text,
  account_type text,
  patient_status text,
  balance numeric,
  staff_id uuid,
  staff_name text,
  staff_deleted_at timestamptz,
  marked_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT p.id,
         p.first_name,
         p.last_name,
         p.card_number,
         p.account_type::text,
         p.status::text,
         p.balance,
         COALESCE(p.staff_link_id, sfm.staff_id),
         concat_ws(' ', s.first_name, s.last_name),
         s.deleted_at,
         p.staff_migration_marked_at
  FROM public.patients p
  LEFT JOIN public.staff_family_members sfm
    ON sfm.patient_id = p.id
   AND sfm.released_at IS NULL
  LEFT JOIN public.staff s
    ON s.id = COALESCE(p.staff_link_id, sfm.staff_id)
  WHERE p.staff_migration_required = true
    AND public.has_any_role(public.hms_current_user_id(), ARRAY['receptionist','admin']::app_role[])
  ORDER BY p.staff_migration_marked_at ASC, p.last_name ASC, p.first_name ASC;
$$;

REVOKE ALL ON FUNCTION public.deactivate_staff_for_migration(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deactivate_staff_for_migration(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.convert_staff_linked_patient_to_normal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_staff_linked_patient_to_normal(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_staff_patient_migration_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_staff_patient_migration_queue() TO authenticated;
