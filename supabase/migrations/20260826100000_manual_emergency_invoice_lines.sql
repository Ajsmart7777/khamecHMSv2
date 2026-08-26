-- Emergency reference lines are not invoice lines.
-- Billing may add zero or more Pricelist/manual lines, with no required
-- one-to-one match to the original emergency text.

CREATE OR REPLACE FUNCTION public.complete_emergency_billing_draft(
  _draft_snap_id UUID,
  _matched_items JSONB,
  _billing_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid UUID := public.hms_current_user_id();
  v_episode UUID;
  v_patient UUID;
  v_visit UUID;
  v_draft_status TEXT;
  v_line_count INT8;
  v_invoice UUID;
  v_total NUMERIC := 0;
  v_account_type TEXT;
  v_corporate_id UUID;
  v_role TEXT;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['billing','accountant','receptionist','admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Only Billing staff can complete an Emergency Episode draft';
  END IF;

  SELECT emergency_episode_id, patient_id, visit_id, status
    INTO v_episode, v_patient, v_visit, v_draft_status
  FROM public.snap_orders
  WHERE id = _draft_snap_id
    AND intent = 'emergency_billing_draft'
  LIMIT 1;

  IF v_episode IS NULL THEN
    RAISE EXCEPTION 'Emergency Billing draft not found';
  END IF;
  IF v_draft_status <> 'pending_billing' THEN
    RAISE EXCEPTION 'Emergency Billing draft is no longer waiting for billing';
  END IF;

  v_line_count := jsonb_array_length(COALESCE(_matched_items, '[]'::JSONB));
  IF v_line_count < 1 THEN
    RAISE EXCEPTION 'Add at least one Billing item before creating the invoice';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::JSONB)) AS item
    WHERE COALESCE(NULLIF(trim(item->>'name'), ''), '') = ''
       OR COALESCE(NULLIF(trim(item->>'description'), ''), NULLIF(trim(item->>'name'), '')) IS NULL
       OR COALESCE(item->>'qty', '') !~ '^[0-9]+$'
       OR greatest((item->>'qty')::INT8, 1) < 1
       OR COALESCE(item->>'unit_price', '') !~ '^[0-9]+([.][0-9]+)?$'
       OR (item->>'unit_price')::NUMERIC < 0
  ) THEN
    RAISE EXCEPTION 'Every Billing item needs a description, quantity, and non-negative price';
  END IF;

  SELECT account_type, corporate_id
    INTO v_account_type, v_corporate_id
  FROM public.patients
  WHERE id = v_patient;
  SELECT role::TEXT
    INTO v_role
  FROM public.user_roles
  WHERE user_id = v_uid
  LIMIT 1;

  SELECT COALESCE(SUM(
    greatest((item->>'qty')::INT8, 1) * (item->>'unit_price')::NUMERIC
  ), 0)
    INTO v_total
  FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::JSONB)) AS item;

  INSERT INTO public.invoices(
    patient_id, visit_id, invoice_number, total_amount, original_amount,
    discount_amount, paid_amount, status, payment_method, notes,
    sponsor_type, corporate_account_id, created_by
  ) VALUES (
    v_patient, v_visit, '', v_total, v_total, 0, 0, 'pending', NULL,
    COALESCE(NULLIF(trim(_billing_note), ''), 'Emergency Episode ' || substr(v_episode::TEXT, 1, 8) || ' — Manual billing'),
    v_account_type,
    CASE WHEN v_account_type IN ('corporate', 'retainer') THEN v_corporate_id ELSE NULL END,
    v_role
  ) RETURNING id INTO v_invoice;

  -- These are Billing’s independently entered invoice lines. They are not
  -- forced to mirror the number or wording of the original emergency lines.
  INSERT INTO public.invoice_items(
    invoice_id, description, quantity, unit_price, total, category,
    dispensing_status, dispensing_notes
  )
  SELECT
    v_invoice,
    COALESCE(NULLIF(trim(item->>'description'), ''), trim(item->>'name')),
    greatest((item->>'qty')::INT8, 1),
    (item->>'unit_price')::NUMERIC,
    greatest((item->>'qty')::INT8, 1) * (item->>'unit_price')::NUMERIC,
    COALESCE(NULLIF(trim(item->>'category'), ''), 'emergency'),
    'pending',
    'Entered manually from an Emergency Episode Billing draft.'
  FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::JSONB)) AS item;

  -- Close the emergency billing lifecycle without pretending that an invoice
  -- line is a one-to-one representation of the original emergency text.
  UPDATE public.emergency_episode_items
  SET status = 'billed', updated_at = now()
  WHERE episode_id = v_episode
    AND status <> 'cancelled';

  UPDATE public.snap_orders
  SET status = 'awaiting_payment',
      invoice_id = v_invoice,
      matched_items = COALESCE(_matched_items, '[]'::JSONB),
      billed_by = v_uid,
      billed_at = now(),
      updated_at = now()
  WHERE id = _draft_snap_id;

  UPDATE public.emergency_episodes
  SET status = 'reconciled',
      invoice_id = v_invoice,
      reconciled_at = now(),
      reconciled_by = v_uid,
      updated_at = now()
  WHERE id = v_episode;

  IF NOT EXISTS (
    SELECT 1
    FROM public.admissions
    WHERE patient_id = v_patient
      AND status IN ('active', 'ready_for_discharge')
  ) THEN
    UPDATE public.patients
    SET status = 'awaiting_payment', updated_at = now()
    WHERE id = v_patient;
  END IF;

  SELECT public.write_audit_log(
    'emergency_billing_draft_completed',
    'invoice',
    v_invoice::TEXT,
    jsonb_build_object(
      'episode_id', v_episode,
      'draft_id', _draft_snap_id,
      'total', v_total,
      'manual_lines', true,
      'source_lines_are_reference_only', true,
      'entered_line_count', v_line_count
    ),
    'success'
  );

  RETURN jsonb_build_object(
    'episode_id', v_episode,
    'invoice_id', v_invoice,
    'total', v_total,
    'status', 'pending',
    'manual_lines', true,
    'entered_line_count', v_line_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_emergency_billing_draft(UUID, JSONB, TEXT) TO authenticated;
