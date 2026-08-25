-- Separate Emergency Episode billing from ordinary clinical-order billing.
-- Emergency lines remain plain text until Billing manually enters billable
-- descriptions, quantities, and prices. No automatic Pricelist match is used.

CREATE OR REPLACE FUNCTION public.complete_emergency_billing_draft(
  _draft_snap_id UUID,
  _matched_items JSONB,
  _billing_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid UUID := public.hms_current_user_id();
  v_episode UUID;
  v_patient UUID;
  v_visit UUID;
  v_draft_status TEXT;
  v_expected INT8;
  v_provided INT8;
  v_unique INT8;
  v_invoice UUID;
  v_total NUMERIC := 0;
  v_account_type TEXT;
  v_corporate_id UUID;
  v_role TEXT;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['billing','accountant','receptionist','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only Billing staff can complete an Emergency Episode draft';
  END IF;

  SELECT emergency_episode_id, patient_id, visit_id, status
    INTO v_episode, v_patient, v_visit, v_draft_status
  FROM public.snap_orders
  WHERE id = _draft_snap_id AND intent = 'emergency_billing_draft'
  LIMIT 1;
  IF v_episode IS NULL THEN RAISE EXCEPTION 'Emergency Billing draft not found'; END IF;
  IF v_draft_status <> 'pending_billing' THEN RAISE EXCEPTION 'Emergency Billing draft is no longer waiting for billing'; END IF;

  SELECT count(*) INTO v_expected
  FROM public.emergency_episode_items
  WHERE episode_id = v_episode AND status <> 'cancelled';
  SELECT count(*) INTO v_provided FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb));
  SELECT count(DISTINCT item->>'emergency_episode_item_id') INTO v_unique
  FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb)) AS item;
  IF v_provided <> v_expected OR v_unique <> v_expected THEN
    RAISE EXCEPTION 'Every Emergency Episode line must be represented before creating the invoice';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb)) AS item
    WHERE NULLIF(trim(COALESCE(item->>'emergency_episode_item_id','')), '') IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.emergency_episode_items e
         WHERE e.id = NULLIF(item->>'emergency_episode_item_id','')::uuid
           AND e.episode_id = v_episode AND e.status <> 'cancelled'
       )
       OR COALESCE(NULLIF(trim(item->>'name'), ''), '') = ''
       OR COALESCE(NULLIF(trim(item->>'description'), ''), NULLIF(trim(item->>'name'), '')) IS NULL
  ) THEN
    RAISE EXCEPTION 'Each Emergency Episode line needs a billable description';
  END IF;

  SELECT COALESCE(SUM(
    (CASE WHEN COALESCE(item->>'qty','') ~ '^[0-9]+$' THEN greatest((item->>'qty')::int8,1) ELSE 1 END)
    * COALESCE(NULLIF(item->>'unit_price','')::numeric, 0)
  ),0)
  INTO v_total
  FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb)) AS item;

  SELECT account_type, corporate_id INTO v_account_type, v_corporate_id
  FROM public.patients WHERE id = v_patient;
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;

  INSERT INTO public.invoices(
    patient_id, visit_id, invoice_number, total_amount, original_amount, discount_amount,
    paid_amount, status, payment_method, notes, sponsor_type, corporate_account_id, created_by
  ) VALUES (
    v_patient, v_visit, '', v_total, v_total, 0, 0, 'pending', NULL,
    COALESCE(NULLIF(trim(_billing_note), ''), 'Emergency Episode ' || substr(v_episode::text,1,8) || ' — Billing draft'),
    v_account_type, CASE WHEN v_account_type IN ('corporate','retainer') THEN v_corporate_id ELSE NULL END, v_role
  ) RETURNING id INTO v_invoice;

  INSERT INTO public.invoice_items(
    invoice_id, emergency_episode_item_id, description, quantity, unit_price, total,
    category, dispensing_status, dispensing_notes
  )
  SELECT
    v_invoice,
    e.id,
    COALESCE(NULLIF(trim(item->>'description'), ''), trim(item->>'name')),
    CASE WHEN COALESCE(item->>'qty','') ~ '^[0-9]+$' THEN greatest((item->>'qty')::int8,1) ELSE 1 END,
    COALESCE(NULLIF(item->>'unit_price','')::numeric, 0),
    (CASE WHEN COALESCE(item->>'qty','') ~ '^[0-9]+$' THEN greatest((item->>'qty')::int8,1) ELSE 1 END) * COALESCE(NULLIF(item->>'unit_price','')::numeric, 0),
    COALESCE(NULLIF(item->>'category',''), CASE WHEN e.item_type = 'lab' THEN 'lab' ELSE 'drug' END),
    CASE WHEN e.item_type = 'lab' OR e.administered_now THEN 'dispensed' ELSE 'pending' END,
    CASE WHEN e.item_type = 'lab' THEN 'Emergency laboratory work authorized/performed before payment.' WHEN e.administered_now THEN 'Administered during emergency; do not re-dispense.' ELSE NULL END
  FROM jsonb_array_elements(COALESCE(_matched_items, '[]'::jsonb)) AS item
  JOIN public.emergency_episode_items e ON e.id = NULLIF(item->>'emergency_episode_item_id','')::uuid;

  UPDATE public.emergency_episode_items e
  SET invoice_item_id = i.id, status = 'billed', updated_at = now()
  FROM public.invoice_items i
  WHERE i.invoice_id = v_invoice AND i.emergency_episode_item_id = e.id;

  UPDATE public.snap_orders
  SET status='awaiting_payment', invoice_id=v_invoice, matched_items=COALESCE(_matched_items, '[]'::jsonb),
      billed_by=v_uid, billed_at=now(), updated_at=now()
  WHERE id=_draft_snap_id;

  UPDATE public.emergency_episodes
  SET status='reconciled', invoice_id=v_invoice, reconciled_at=now(),
      reconciled_by=v_uid, updated_at=now()
  WHERE id=v_episode;

  IF NOT EXISTS (
    SELECT 1 FROM public.admissions
    WHERE patient_id=v_patient AND status IN ('active','ready_for_discharge')
  ) THEN
    UPDATE public.patients SET status='awaiting_payment', updated_at=now() WHERE id=v_patient;
  END IF;

  SELECT public.write_audit_log(
    'emergency_billing_draft_completed', 'invoice', v_invoice::text,
    jsonb_build_object('episode_id', v_episode, 'draft_id', _draft_snap_id, 'total', v_total, 'manual_lines', true), 'success'
  );
  RETURN jsonb_build_object('episode_id', v_episode, 'invoice_id', v_invoice, 'total', v_total, 'status', 'pending');
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_finalize_emergency_for_normal_order()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_episode UUID;
  v_draft UUID;
  v_patient UUID;
  v_visit UUID;
  v_admission UUID;
  v_role TEXT;
  v_items JSONB;
BEGIN
  IF (new).status <> 'pending_billing'
     OR COALESCE((new).intent,'') IN ('emergency_episode','emergency_billing_draft','emergency_remainder')
     OR (new).emergency_episode_id IS NOT NULL THEN
    RETURN new;
  END IF;

  SELECT e.id, e.patient_id, e.visit_id, e.admission_id
    INTO v_episode, v_patient, v_visit, v_admission
  FROM public.emergency_episodes e
  WHERE e.patient_id=(new).patient_id AND e.status='open'
  ORDER BY e.created_at DESC LIMIT 1;
  IF v_episode IS NULL THEN RETURN new; END IF;

  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id=(new).created_by LIMIT 1;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'emergency_episode_item_id', e.id,
    'name', e.description,
    'description', e.description,
    'size', NULL,
    'category', CASE WHEN e.item_type='lab' THEN 'lab' ELSE 'drug' END,
    'qty', e.quantity,
    'unit_price', 0,
    'pricelist_id', '',
    'source_snap_id', e.source_snap_id,
    'source_text', e.description
  ) ORDER BY e.created_at), '[]'::jsonb)
  INTO v_items
  FROM public.emergency_episode_items e
  WHERE e.episode_id=v_episode AND e.status <> 'cancelled';

  INSERT INTO public.snap_orders(
    patient_id, visit_id, order_type, target_station, source_role, photo_path, note,
    matched_items, status, created_by, original_sender_role, intent,
    is_admitted_snap, emergency_episode_id, ocr_text
  ) VALUES (
    v_patient, v_visit, 'treatment', 'billing', COALESCE(v_role,'nurse'), NULL,
    'Emergency Episode billing draft — emergency lines only', v_items, 'pending_billing',
    (new).created_by, COALESCE(v_role,'nurse'), 'emergency_billing_draft', v_admission IS NOT NULL,
    v_episode, 'EMERGENCY_EPISODE:' || v_episode::text
  ) RETURNING id INTO v_draft;

  UPDATE public.emergency_episodes
  SET status='finalized', billing_draft_snap_id=v_draft, finalized_at=now(),
      finalized_by=(new).created_by, updated_at=now()
  WHERE id=v_episode;

  -- The normal order remains an independent Billing item. It is not copied into
  -- the Emergency Episode draft and may be invoiced/paid separately.
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS snap_orders_auto_finalize_emergency ON public.snap_orders;
CREATE TRIGGER snap_orders_auto_finalize_emergency
AFTER INSERT ON public.snap_orders
FOR EACH ROW EXECUTE FUNCTION public.auto_finalize_emergency_for_normal_order();

CREATE OR REPLACE FUNCTION public.prevent_invoice_before_emergency_billing()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Emergency and ordinary order invoices are intentionally independent. The
  -- pending Emergency draft is no longer a gate for normal invoices.
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS invoices_require_emergency_billing ON public.invoices;
CREATE TRIGGER invoices_require_emergency_billing
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.prevent_invoice_before_emergency_billing();

GRANT EXECUTE ON FUNCTION public.complete_emergency_billing_draft(UUID,JSONB,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_finalize_emergency_for_normal_order() TO authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_invoice_before_emergency_billing() TO authenticated;
