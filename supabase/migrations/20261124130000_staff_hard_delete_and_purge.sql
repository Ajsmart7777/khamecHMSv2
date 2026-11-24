-- Hard delete for staff records (Account > Register Staff trash button).
--
-- The earlier flow only marked staff as 'deleted' and preserved the linked
-- Staff / Staff Family patient accounts for a Reception migration queue. That
-- left rows that could never be removed (already-deleted staff kept the trash
-- button disabled), and the RPC behind it was admin-only.
--
-- purge_staff_member() deletes, in one transaction:
--   * the linked Staff patient account and Staff Family patient accounts,
--     together with their clinical/finance history,
--   * the staff_family_members links,
--   * the staff row itself (payroll entries, leave, attendance, deductions
--     cascade from it),
--   * the staff member's login role.
--
-- CockroachDB notes: PL/pgSQL bodies here must avoid PERFORM/EXECUTE/CASE and
-- loops, and children are removed in the same proven order used by
-- purge_archived_cases() because snap_orders/invoices/snap parent links use
-- ON DELETE SET NULL, which trips CRDB's cascade-trigger guard.

-- The soft-delete guard from the abandoned migration blocked every hard delete.
DROP TRIGGER IF EXISTS staff_prevent_hard_delete ON public.staff;
DROP FUNCTION IF EXISTS public.prevent_staff_hard_delete();

CREATE OR REPLACE FUNCTION public.purge_staff_member(
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
  v_auth_user_id uuid;
  v_patient_ids uuid[];
  v_statement_ids uuid[];
  v_snap_order_ids uuid[];
  v_staff_patient_count integer := 0;
  v_family_patient_count integer := 0;
BEGIN
  IF NOT public.has_any_role(v_uid, ARRAY['admin','accountant']::app_role[]) THEN
    RAISE EXCEPTION 'Only the Accountant or an administrator can delete staff accounts';
  END IF;

  SELECT s.id,
         concat_ws(' ', s.first_name, s.last_name),
         s.auth_user_id
    INTO v_staff_id, v_staff_name, v_auth_user_id
  FROM public.staff s
  WHERE s.id = _staff_id
  FOR UPDATE;

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Staff member not found';
  END IF;

  SELECT COALESCE(array_agg(ids.patient_id), ARRAY[]::uuid[])
    INTO v_patient_ids
  FROM (
    SELECT p.id AS patient_id
    FROM public.patients p
    WHERE p.staff_link_id = _staff_id
    UNION
    SELECT sfm.patient_id
    FROM public.staff_family_members sfm
    WHERE sfm.staff_id = _staff_id
  ) AS ids;

  SELECT count(*)
    INTO v_staff_patient_count
  FROM public.patients p
  WHERE p.staff_link_id = _staff_id;

  SELECT count(*)
    INTO v_family_patient_count
  FROM public.staff_family_members sfm
  WHERE sfm.staff_id = _staff_id;

  IF COALESCE(array_length(v_patient_ids, 1), 0) > 0 THEN
    SELECT COALESCE(array_agg(DISTINCT ssi.statement_id), ARRAY[]::uuid[])
      INTO v_statement_ids
    FROM public.sponsor_statement_items ssi
    WHERE ssi.patient_id = ANY(v_patient_ids);

    DELETE FROM public.invoice_items
    WHERE invoice_id IN (
      SELECT i.id FROM public.invoices i WHERE i.patient_id = ANY(v_patient_ids)
    );
    DELETE FROM public.sponsor_statement_items WHERE patient_id = ANY(v_patient_ids);
    DELETE FROM public.insurance_claims WHERE patient_id = ANY(v_patient_ids);
    DELETE FROM public.balance_transactions WHERE patient_id = ANY(v_patient_ids);
    DELETE FROM public.balance_requests WHERE patient_id = ANY(v_patient_ids);
    DELETE FROM public.corporate_transactions ct
    WHERE ct.related_statement_id = ANY(v_statement_ids)
      AND NOT EXISTS (
        SELECT 1 FROM public.sponsor_statement_items remaining
        WHERE remaining.statement_id = ct.related_statement_id
      );
    DELETE FROM public.sponsor_statements ss
    WHERE ss.id = ANY(v_statement_ids)
      AND NOT EXISTS (
        SELECT 1 FROM public.sponsor_statement_items remaining
        WHERE remaining.statement_id = ss.id
      );

    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
      INTO v_snap_order_ids
    FROM public.snap_orders
    WHERE patient_id = ANY(v_patient_ids);

    IF COALESCE(array_length(v_snap_order_ids, 1), 0) > 0 THEN
      UPDATE public.snap_orders
      SET parent_snap_id = NULL
      WHERE parent_snap_id = ANY(v_snap_order_ids);
      DELETE FROM public.snap_orders WHERE id = ANY(v_snap_order_ids);
    END IF;

    DELETE FROM public.invoices WHERE patient_id = ANY(v_patient_ids);
    DELETE FROM public.prescription_items
    WHERE prescription_id IN (
      SELECT pr.id FROM public.prescriptions pr WHERE pr.patient_id = ANY(v_patient_ids)
    );
    DELETE FROM public.prescriptions WHERE patient_id = ANY(v_patient_ids);
    DELETE FROM public.lab_requests WHERE patient_id = ANY(v_patient_ids);
    DELETE FROM public.vitals WHERE patient_id = ANY(v_patient_ids);
    DELETE FROM public.standing_orders WHERE patient_id = ANY(v_patient_ids);
    DELETE FROM public.referral_letters WHERE patient_id = ANY(v_patient_ids);
    DELETE FROM public.visit_attachments WHERE patient_id = ANY(v_patient_ids);
    DELETE FROM public.emr_attachments WHERE patient_id = ANY(v_patient_ids);
    DELETE FROM public.eligibility_verifications WHERE patient_id = ANY(v_patient_ids);
    DELETE FROM public.patient_journey_history WHERE patient_id = ANY(v_patient_ids);
    DELETE FROM public.patient_journey WHERE patient_id = ANY(v_patient_ids);
    DELETE FROM public.admissions WHERE patient_id = ANY(v_patient_ids);
    DELETE FROM public.visits WHERE patient_id = ANY(v_patient_ids);

    DELETE FROM public.staff_family_members WHERE patient_id = ANY(v_patient_ids);
    DELETE FROM public.patients WHERE id = ANY(v_patient_ids);
  END IF;

  -- invoices.staff_sponsor_id has no ON DELETE rule, so a sponsored invoice
  -- from another patient would otherwise block the staff delete.
  UPDATE public.invoices SET staff_sponsor_id = NULL WHERE staff_sponsor_id = _staff_id;

  DELETE FROM public.staff_family_members WHERE staff_id = _staff_id;
  DELETE FROM public.staff WHERE id = _staff_id;

  IF v_auth_user_id IS NOT NULL THEN
    DELETE FROM public.user_roles WHERE user_id = v_auth_user_id;
  END IF;

  SELECT public.write_audit_log(
    'staff_deleted'::text,
    'staff'::text,
    _staff_id::text,
    jsonb_build_object(
      'staff_name', v_staff_name,
      'staff_patient_count', v_staff_patient_count,
      'family_patient_count', v_family_patient_count,
      'reason', COALESCE(NULLIF(_reason, ''), '')
    )::jsonb,
    'success'::text
  );

  RETURN jsonb_build_object(
    'action', 'deleted',
    'staff_id', _staff_id,
    'staff_name', v_staff_name,
    'staff_patient_count', v_staff_patient_count,
    'family_patient_count', v_family_patient_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_staff_member(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_staff_member(uuid, text) TO authenticated;
