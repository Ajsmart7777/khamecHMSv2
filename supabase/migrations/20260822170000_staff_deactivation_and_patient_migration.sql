-- CockroachDB clone only.
-- Staff records and linked patient records must remain auditable after a staff member leaves.

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS deletion_reason text;

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS staff_migration_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS staff_migration_staff_id uuid,
  ADD COLUMN IF NOT EXISTS staff_migration_marked_at timestamptz,
  ADD COLUMN IF NOT EXISTS staff_migration_marked_reason text,
  ADD COLUMN IF NOT EXISTS staff_migrated_at timestamptz,
  ADD COLUMN IF NOT EXISTS staff_migrated_by uuid,
  ADD COLUMN IF NOT EXISTS staff_migrated_from_account_type text;

ALTER TABLE public.staff_family_members
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_by uuid,
  ADD COLUMN IF NOT EXISTS release_reason text;

-- Retain links if a direct SQL delete is attempted. The application path below
-- only marks staff deleted, but the FK is an additional safety net.
ALTER TABLE public.staff_family_members
  DROP CONSTRAINT IF EXISTS staff_family_members_staff_id_fkey;
ALTER TABLE public.staff_family_members
  ADD CONSTRAINT staff_family_members_staff_id_fkey
  FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE RESTRICT;

ALTER TABLE public.patients
  DROP CONSTRAINT IF EXISTS patients_staff_link_id_fkey;
ALTER TABLE public.patients
  ADD CONSTRAINT patients_staff_link_id_fkey
  FOREIGN KEY (staff_link_id) REFERENCES public.staff(id) ON DELETE RESTRICT;

ALTER TABLE public.patients
  DROP CONSTRAINT IF EXISTS patients_staff_migration_staff_id_fkey;
ALTER TABLE public.patients
  ADD CONSTRAINT patients_staff_migration_staff_id_fkey
  FOREIGN KEY (staff_migration_staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS patients_staff_migration_idx
  ON public.patients(staff_migration_required, account_type);

CREATE INDEX IF NOT EXISTS staff_family_active_staff_idx
  ON public.staff_family_members(staff_id, released_at)
  WHERE released_at IS NULL;

-- Prevent every new visit path, including direct table inserts and RPCs, for a
-- patient awaiting migration. Existing visits can continue to discharge.
CREATE OR REPLACE FUNCTION public.block_staff_migration_visit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_required boolean;
BEGIN
  SELECT p.staff_migration_required
    INTO v_required
  FROM public.patients p
  WHERE p.id = (NEW).patient_id;

  IF COALESCE(v_required, false) THEN
    RAISE EXCEPTION 'STAFF_MIGRATION_REQUIRED: this patient must be converted to a normal patient before starting a new visit';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS visits_block_staff_migration ON public.visits;
CREATE TRIGGER visits_block_staff_migration
  BEFORE INSERT ON public.visits
  FOR EACH ROW
  EXECUTE FUNCTION public.block_staff_migration_visit();

-- Admin-only soft deletion. It is intentionally idempotent and returns counts
-- for the confirmation UI. It does not delete patients, family links, payroll,
-- invoices, balances, visits, or authentication history.
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
  IF NOT public.has_any_role(v_uid, ARRAY['admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only administrators can deactivate staff accounts';
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

  SELECT public.write_audit_log(
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

-- Reception/admin-only one-click conversion. The patient row, ID, balance,
-- clinical history, and finance history are retained. The family link is marked
-- released rather than deleted, so historical sponsorship remains auditable.
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

  -- Release the family link first. The existing linkage trigger requires the
  -- patient to remain staff_family while this link is updated.
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

REVOKE ALL ON FUNCTION public.deactivate_staff_for_migration(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deactivate_staff_for_migration(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.convert_staff_linked_patient_to_normal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_staff_linked_patient_to_normal(uuid) TO authenticated;

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

REVOKE ALL ON FUNCTION public.get_staff_patient_migration_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_staff_patient_migration_queue() TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_staff_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RAISE EXCEPTION 'STAFF_DEACTIVATION_REQUIRED: staff records are preserved for audit and must be deactivated, not deleted';
END;
$$;

DROP TRIGGER IF EXISTS staff_prevent_hard_delete ON public.staff;
CREATE TRIGGER staff_prevent_hard_delete
  BEFORE DELETE ON public.staff
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_staff_hard_delete();

CREATE OR REPLACE FUNCTION public.prevent_deleted_staff_reactivation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF (OLD).status = 'deleted' AND (NEW).status <> 'deleted' THEN
    RAISE EXCEPTION 'STAFF_DELETED: a deleted staff record cannot be reactivated';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_prevent_deleted_reactivation ON public.staff;
CREATE TRIGGER staff_prevent_deleted_reactivation
  BEFORE UPDATE ON public.staff
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_deleted_staff_reactivation();

-- Do not allow a new staff-linked patient to be created against a deleted staff
-- member. Existing family registration still creates the family link after the
-- patient insert, so the UI selector plus the deactivation transaction cover it.
CREATE OR REPLACE FUNCTION public.prevent_deleted_staff_patient_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status text;
BEGIN
  IF (NEW).account_type = 'staff' AND (NEW).staff_link_id IS NOT NULL THEN
    SELECT s.status::text INTO v_status FROM public.staff s WHERE s.id = (NEW).staff_link_id;
    IF COALESCE(v_status, '') <> 'active' THEN
      RAISE EXCEPTION 'STAFF_INACTIVE: only active staff can be linked to a Staff patient account';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS patients_prevent_deleted_staff_link ON public.patients;
CREATE TRIGGER patients_prevent_deleted_staff_link
  BEFORE INSERT OR UPDATE ON public.patients
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_deleted_staff_patient_link();
