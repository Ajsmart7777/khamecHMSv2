-- CockroachDB repair for the partially applied Emergency Billing migration.
-- CockroachDB does not allow replacing a trigger function while an active
-- trigger still references it. Detach first, replace, then recreate.

DROP TRIGGER IF EXISTS snap_orders_auto_finalize_emergency ON public.snap_orders;
DROP TRIGGER IF EXISTS invoices_require_emergency_billing ON public.invoices;

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
  -- Emergency clinical actions and the emergency billing draft do not recurse.
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

  -- Keep ordinary orders independent. Only the emergency episode lines go
  -- into the emergency billing draft; the ordinary order remains its own
  -- actionable Billing item and can proceed to payment separately.
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

  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id=(new).created_by LIMIT 1;
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

  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_invoice_before_emergency_billing()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- A pending Emergency Episode draft is not a gate. Ordinary invoices are
  -- independently billable; the emergency draft can be completed later.
  RETURN new;
END;
$$;

CREATE TRIGGER snap_orders_auto_finalize_emergency
AFTER INSERT ON public.snap_orders
FOR EACH ROW EXECUTE FUNCTION public.auto_finalize_emergency_for_normal_order();

CREATE TRIGGER invoices_require_emergency_billing
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.prevent_invoice_before_emergency_billing();

GRANT EXECUTE ON FUNCTION public.auto_finalize_emergency_for_normal_order() TO authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_invoice_before_emergency_billing() TO authenticated;
