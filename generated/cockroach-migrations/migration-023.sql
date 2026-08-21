-- SOURCE: 20260815173500_harden_discharge_archive_consistency.sql statement 7
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) TO authenticated;

-- SOURCE: 20260815174000_enforce_discharge_consistency_trigger.sql statement 1
CREATE OR REPLACE FUNCTION public.check_patient_discharge_eligibility()
RETURNS TRIGGER AS $$
DECLARE
  _pending_station text;
  _open_visit_id uuid;
  _active_adm_id uuid;
  _pending_inv_id uuid;
BEGIN
  -- Only run check when status is changing to 'discharged'
  IF (NEW).status = 'discharged' AND ((OLD).status IS NULL OR (OLD).status <> 'discharged') THEN
    
    -- 1. Check for pending workflow stations (Labs, Pharmacy, Billing)
    -- This uses the hardened function that checks snap_orders, lab_requests, and prescriptions.
    _pending_station := public.patient_pending_workflow_station((NEW).id);
    IF _pending_station IS NOT NULL THEN
      RAISE EXCEPTION 'CANNOT_DISCHARGE: patient has pending workflow at %', _pending_station;
    END IF;

    -- 2. Check for open visits
    SELECT id INTO _open_visit_id
    FROM public.visits
    WHERE patient_id = (NEW).id AND status = 'open'
    LIMIT 1;
    IF _open_visit_id IS NOT NULL THEN
      RAISE EXCEPTION 'CANNOT_DISCHARGE: patient has an open visit (ID: %)', _open_visit_id;
    END IF;

    -- 3. Check for active admissions
    SELECT id INTO _active_adm_id
    FROM public.admissions
    WHERE patient_id = (NEW).id
      AND status IN ('waiting_assignment', 'active', 'ready_for_discharge')
    LIMIT 1;
    IF _active_adm_id IS NOT NULL THEN
      RAISE EXCEPTION 'CANNOT_DISCHARGE: patient has an active admission (ID: %)', _active_adm_id;
    END IF;

    -- 4. Check for unpaid invoices
    SELECT id INTO _pending_inv_id
    FROM public.invoices
    WHERE patient_id = (NEW).id AND status IN ('pending', 'partial')
    LIMIT 1;
    IF _pending_inv_id IS NOT NULL THEN
      RAISE EXCEPTION 'CANNOT_DISCHARGE: patient has unpaid or partial invoices';
    END IF;

  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- SOURCE: 20260815174000_enforce_discharge_consistency_trigger.sql statement 2
DROP TRIGGER IF EXISTS tr_check_patient_discharge_eligibility ON public.patients;

-- SOURCE: 20260815174000_enforce_discharge_consistency_trigger.sql statement 3
CREATE TRIGGER tr_check_patient_discharge_eligibility
BEFORE UPDATE ON public.patients
FOR EACH ROW
EXECUTE FUNCTION public.check_patient_discharge_eligibility();

-- SOURCE: 20260815174000_enforce_discharge_consistency_trigger.sql statement 4
CREATE OR REPLACE FUNCTION public.check_journey_discharge_eligibility()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW).current_state = 'discharged' AND ((OLD).current_state IS NULL OR (OLD).current_state <> 'discharged') THEN
    -- We can just call the patient check logic or rely on the fact that 
    -- advance_journey updates both. However, a direct update to patient_journey
    -- should also be guarded.
    IF EXISTS (
      SELECT 1 FROM public.visits WHERE patient_id = (NEW).patient_id AND status = 'open'
    ) OR EXISTS (
      SELECT 1 FROM public.admissions WHERE patient_id = (NEW).patient_id AND status IN ('waiting_assignment', 'active', 'ready_for_discharge')
    ) OR public.patient_pending_workflow_station((NEW).patient_id) IS NOT NULL THEN
      RAISE EXCEPTION 'CANNOT_DISCHARGE: journey transition blocked by open visit or pending orders';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- SOURCE: 20260815174000_enforce_discharge_consistency_trigger.sql statement 5
DROP TRIGGER IF EXISTS tr_check_journey_discharge_eligibility ON public.patient_journey;

-- SOURCE: 20260815174000_enforce_discharge_consistency_trigger.sql statement 6
CREATE TRIGGER tr_check_journey_discharge_eligibility
BEFORE UPDATE ON public.patient_journey
FOR EACH ROW
EXECUTE FUNCTION public.check_journey_discharge_eligibility();

-- SOURCE: 20260816103000_include_patient_profile_photo_in_archive.sql statement 1
CREATE OR REPLACE FUNCTION public.patient_archive_case_fingerprint(_patient_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER

AS $$
  SELECT md5(concat_ws('|',
    COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id)::text FROM public.visits v WHERE v.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id)::text FROM public.admissions a WHERE a.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id)::text FROM public.invoices i WHERE i.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ii) ORDER BY ii.id)::text FROM public.invoice_items ii WHERE ii.invoice_id IN (SELECT id FROM public.invoices WHERE patient_id = _patient_id)), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ssi) ORDER BY ssi.id)::text FROM public.sponsor_statement_items ssi WHERE ssi.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ic) ORDER BY ic.id)::text FROM public.insurance_claims ic WHERE ic.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(bt) ORDER BY bt.id)::text FROM public.balance_transactions bt WHERE bt.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(br) ORDER BY br.id)::text FROM public.balance_requests br WHERE br.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pr) ORDER BY pr.id)::text FROM public.prescriptions pr WHERE pr.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pi) ORDER BY pi.id)::text FROM public.prescription_items pi WHERE pi.prescription_id IN (SELECT id FROM public.prescriptions WHERE patient_id = _patient_id)), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(lr) ORDER BY lr.id)::text FROM public.lab_requests lr WHERE lr.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(vt) ORDER BY vt.id)::text FROM public.vitals vt WHERE vt.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(so) ORDER BY so.id)::text FROM public.snap_orders so WHERE so.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(sto) ORDER BY sto.id)::text FROM public.standing_orders sto WHERE sto.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(rl) ORDER BY rl.id)::text FROM public.referral_letters rl WHERE rl.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(va) ORDER BY va.id)::text FROM public.visit_attachments va WHERE va.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ea) ORDER BY ea.id)::text FROM public.emr_attachments ea WHERE ea.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(ev) ORDER BY ev.id)::text FROM public.eligibility_verifications ev WHERE ev.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pjh) ORDER BY pjh.id)::text FROM public.patient_journey_history pjh WHERE pjh.patient_id = _patient_id), '[]'),
    COALESCE((SELECT jsonb_agg(to_jsonb(pj) ORDER BY pj.id)::text FROM public.patient_journey pj WHERE pj.patient_id = _patient_id), '[]'),
    COALESCE((SELECT p.photo_path::text FROM public.patients p WHERE p.id = _patient_id), '')
  ));
$$;

-- SOURCE: 20260816103000_include_patient_profile_photo_in_archive.sql statement 2
CREATE OR REPLACE FUNCTION public.attach_patient_profile_photo_to_archive_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  v_photo_path text;
BEGIN
  SELECT NULLIF(btrim(p.photo_path), '')
  INTO v_photo_path
  FROM public.patients p
  WHERE p.id = (NEW).patient_id;

  IF v_photo_path IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM jsonb_array_elements(COALESCE((NEW).attachment_paths, '[]'::jsonb)) item
       WHERE item ->> 'bucket' = 'patient-photos'
         AND item ->> 'path' = v_photo_path
     ) THEN NEW.attachment_paths := COALESCE((NEW).attachment_paths, '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object(
        'bucket', 'patient-photos',
        'path', v_photo_path,
        'source', 'patients.photo_path'
      ));
  END IF;

  RETURN NEW;
END;
$$;

-- SOURCE: 20260816103000_include_patient_profile_photo_in_archive.sql statement 3
DROP TRIGGER IF EXISTS patient_archive_profile_photo_manifest_trigger
  ON public.patient_archive_records;

-- SOURCE: 20260816103000_include_patient_profile_photo_in_archive.sql statement 4
CREATE TRIGGER patient_archive_profile_photo_manifest_trigger
BEFORE INSERT ON public.patient_archive_records
FOR EACH ROW
EXECUTE FUNCTION public.attach_patient_profile_photo_to_archive_record();

-- SOURCE: 20260816103000_include_patient_profile_photo_in_archive.sql statement 5
REVOKE ALL ON FUNCTION public.attach_patient_profile_photo_to_archive_record() FROM PUBLIC;

-- SOURCE: 20260817120000_store_1_store_2_cockroach.sql statement 1
INSERT INTO public.inventory_locations (code, name, active)
VALUES ('store_2', 'Store 2', true)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, active = true;

-- SOURCE: 20260817120000_store_1_store_2_cockroach.sql statement 2
UPDATE public.inventory_locations SET name = 'Store 1' WHERE code = 'main_store';

-- SOURCE: 20260817120000_store_1_store_2_cockroach.sql statement 3
UPDATE public.inventory_locations SET name = 'Store 2' WHERE code = 'store_2';

-- SOURCE: 20260817120000_store_1_store_2_cockroach.sql statement 4
UPDATE public.inventory_locations SET name = 'Pharmacy' WHERE code = 'pharmacy';

-- SOURCE: 20260817120000_store_1_store_2_cockroach.sql statement 5
CREATE OR REPLACE FUNCTION public.record_inventory_receipt(
  _receipt_kind text,
  _location_code text,
  _items jsonb,
  _supplier_name text DEFAULT NULL,
  _supplier_reference text DEFAULT NULL,
  _note text DEFAULT NULL,
  _received_on date DEFAULT current_date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _receipt_id uuid;
  _location_id uuid;
  _row jsonb;
  _batch_id uuid;
  _product_id uuid;
  _batch_number text;
  _expiry_date date;
  _quantity numeric;
  _unit_cost numeric;
  _existing_opening boolean;
BEGIN
  IF _receipt_kind NOT IN ('opening_count', 'supplier_delivery') OR _location_code NOT IN ('main_store', 'pharmacy', 'store_2') OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'A valid receipt kind, location, and at least one item are required';
  END IF;

  IF _receipt_kind = 'supplier_delivery' AND _location_code = 'pharmacy' THEN
    RAISE EXCEPTION 'Supplier deliveries must be received into a Store location; direct Pharmacy delivery is not enabled';
  END IF;

  SELECT id INTO _location_id FROM public.inventory_locations WHERE code = _location_code AND active;
  IF _location_id IS NULL THEN RAISE EXCEPTION 'Inventory location is unavailable'; END IF;

  INSERT INTO public.stock_receipts (receipt_kind, supplier_name, supplier_reference, received_on, location_id, note)
  VALUES (_receipt_kind, NULLIF(btrim(_supplier_name), ''), NULLIF(btrim(_supplier_reference), ''), COALESCE(_received_on, current_date), _location_id, NULLIF(btrim(_note), ''))
  RETURNING id INTO _receipt_id;

  FOR i IN 0 .. jsonb_array_length(_items) - 1 LOOP
    _row := _items->i;
    _product_id := (_row->>'product_id')::uuid;
    _batch_number := NULLIF(btrim(_row->>'batch_number'), '');
    _expiry_date := (_row->>'expiry_date')::date;
    _quantity := (_row->>'quantity')::numeric;
    _unit_cost := (_row->>'unit_cost')::numeric;

    IF _batch_number IS NULL OR _expiry_date IS NULL OR _quantity IS NULL OR _quantity <= 0 OR _unit_cost IS NULL OR _unit_cost < 0 THEN
      RAISE EXCEPTION 'Each item requires product, batch number, expiry date, positive quantity, and unit cost';
    END IF;

    INSERT INTO public.inventory_batches (product_id, location_id, batch_number, expiry_date, unit_cost, quantity_on_hand, status)
    VALUES (_product_id, _location_id, _batch_number, _expiry_date, _unit_cost, _quantity, 'active')
    ON CONFLICT (product_id, location_id, batch_number, expiry_date) DO UPDATE
      SET quantity_on_hand = public.inventory_batches.quantity_on_hand + EXCLUDED.quantity_on_hand,
          unit_cost = EXCLUDED.unit_cost,
          status = 'active',
          updated_at = clock_timestamp()
    RETURNING id INTO _batch_id;

    INSERT INTO public.stock_receipt_items (receipt_id, batch_id, product_id, quantity, unit_cost)
    VALUES (_receipt_id, _batch_id, _product_id, _quantity, _unit_cost);

    INSERT INTO public.stock_movements (movement_type, product_id, batch_id, location_id, quantity_delta, unit_cost, receipt_id, reason)
    VALUES (CASE WHEN _receipt_kind = 'opening_count' THEN 'opening_count' ELSE 'receipt' END, _product_id, _batch_id, _location_id, _quantity, _unit_cost, _receipt_id, _note);
  END LOOP;

  RETURN _receipt_id;
END;
$$;

-- SOURCE: 20260817120000_store_1_store_2_cockroach.sql statement 6
CREATE OR REPLACE FUNCTION public.create_store_to_pharmacy_transfer(_items jsonb, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _transfer_id uuid;
  _to_location uuid;
  _source_location uuid;
  _row jsonb;
  _batch_id_val uuid;
  _batch_product_id uuid;
  _batch_unit_cost numeric;
  _batch_quantity_on_hand numeric;
  _batch_location_id uuid;
  _quantity numeric;
BEGIN
  IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Select at least one batch and quantity to transfer';
  END IF;

  SELECT id INTO _to_location FROM public.inventory_locations WHERE code = 'pharmacy' AND active;
  IF _to_location IS NULL THEN RAISE EXCEPTION 'Pharmacy location is unavailable'; END IF;

  FOR i IN 0 .. jsonb_array_length(_items) - 1 LOOP
    _row := _items->i;
    _quantity := (_row->>'quantity')::numeric;
    IF _quantity IS NULL OR _quantity <= 0 THEN RAISE EXCEPTION 'Transfer quantities must be positive'; END IF;

    SELECT b.id, b.product_id, b.unit_cost, b.quantity_on_hand, b.location_id
    INTO _batch_id_val, _batch_product_id, _batch_unit_cost, _batch_quantity_on_hand, _batch_location_id
    FROM public.inventory_batches b
    JOIN public.inventory_locations source_location ON source_location.id = b.location_id
    WHERE b.id = (_row->>'batch_id')::uuid
      AND source_location.code IN ('main_store', 'store_2')
      AND b.status = 'active'
      AND b.expiry_date >= current_date
    FOR UPDATE;

    IF _batch_id_val IS NULL OR _batch_quantity_on_hand < _quantity THEN
      RAISE EXCEPTION 'Insufficient available stock for one or more selected Store batches';
    END IF;
    IF _source_location IS NULL THEN
      _source_location := _batch_location_id;
    ELSIF _batch_location_id <> _source_location THEN
      RAISE EXCEPTION 'A transfer must contain stock from only one Store location';
    END IF;

    IF _transfer_id IS NULL THEN
      INSERT INTO public.stock_transfers (from_location_id, to_location_id, note)
      VALUES (_batch_location_id, _to_location, NULLIF(btrim(_note), ''))
      RETURNING id INTO _transfer_id;
    END IF;

    UPDATE public.inventory_batches
    SET quantity_on_hand = quantity_on_hand - _quantity, updated_at = clock_timestamp()
    WHERE id = _batch_id_val;

    INSERT INTO public.stock_transfer_items (transfer_id, source_batch_id, product_id, quantity_sent)
    VALUES (_transfer_id, _batch_id_val, _batch_product_id, _quantity);

    INSERT INTO public.stock_movements (movement_type, product_id, batch_id, location_id, quantity_delta, unit_cost, transfer_id, reason)
    VALUES ('transfer_out', _batch_product_id, _batch_id_val, _batch_location_id, -_quantity, _batch_unit_cost, _transfer_id, _note);
  END LOOP;

  RETURN _transfer_id;
END;
$$;

-- SOURCE: 20260817130000_simplify_store_bin_card_flow.sql statement 1
CREATE TABLE IF NOT EXISTS public.inventory_bin_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.inventory_products(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  registered_by uuid NOT NULL REFERENCES public.auth_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, location_id)
);

-- SOURCE: 20260817130000_simplify_store_bin_card_flow.sql statement 2
CREATE INDEX IF NOT EXISTS inventory_bin_cards_location_idx
  ON public.inventory_bin_cards (location_id, product_id);

-- SOURCE: 20260817130000_simplify_store_bin_card_flow.sql statement 3
CREATE OR REPLACE FUNCTION public.register_inventory_bin_card(
  _pricelist_item_id uuid,
  _location_code text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _product_id uuid;
  _location_id uuid;
  _card_id uuid;
  _sku text;
  _user_id uuid := public.hms_current_user_id();
BEGIN
  IF NOT public.has_any_role(_user_id, ARRAY['store'::public.app_role, 'admin'::public.app_role]) THEN
    RAISE EXCEPTION 'Only Store or Admin can register a Bin Card';
  END IF;
  IF _location_code NOT IN ('main_store', 'store_2') THEN
    RAISE EXCEPTION 'A Bin Card can only be registered in Store 1 or Store 2';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pricelist WHERE id = _pricelist_item_id AND active) THEN
    RAISE EXCEPTION 'Select an active medicine from the Pricelist';
  END IF;

  SELECT id INTO _location_id
  FROM public.inventory_locations
  WHERE code = _location_code AND active;
  IF _location_id IS NULL THEN RAISE EXCEPTION 'Selected Store location is unavailable'; END IF;

  SELECT id INTO _product_id
  FROM public.inventory_products
  WHERE pricelist_item_id = _pricelist_item_id;

  IF _product_id IS NULL THEN
    _sku := 'PL-' || replace(_pricelist_item_id::text, '-', '');
    INSERT INTO public.inventory_products (pricelist_item_id, sku, unit_label, minimum_level, created_by)
    VALUES (_pricelist_item_id, _sku, 'unit', 0, _user_id)
    RETURNING id INTO _product_id;
  ELSE
    UPDATE public.inventory_products
    SET active = true, updated_at = now()
    WHERE id = _product_id;
  END IF;

  INSERT INTO public.inventory_bin_cards (product_id, location_id, registered_by)
  VALUES (_product_id, _location_id, _user_id)
  ON CONFLICT (product_id, location_id) DO NOTHING;

  SELECT id INTO _card_id
  FROM public.inventory_bin_cards
  WHERE product_id = _product_id AND location_id = _location_id;
  RETURN _card_id;
END;
$$;

-- SOURCE: 20260817130000_simplify_store_bin_card_flow.sql statement 4
CREATE OR REPLACE FUNCTION public.get_store_bin_cards()
RETURNS TABLE (
  bin_card_id uuid,
  product_id uuid,
  location_id uuid,
  location_code text,
  location_name text,
  pricelist_item_id uuid,
  medicine_name text,
  category text,
  size text,
  sale_price numeric,
  sku text,
  unit_label text,
  current_balance numeric,
  next_expiry date,
  active boolean
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT bc.id, ip.id, il.id, il.code, il.name, p.id, p.name, p.category,
         p.size, p.price, ip.sku, ip.unit_label,
         COALESCE(SUM(b.quantity_on_hand) FILTER (
           WHERE b.status = 'active' AND b.expiry_date >= current_date
         ), 0),
         MIN(b.expiry_date) FILTER (
           WHERE b.status = 'active' AND b.quantity_on_hand > 0 AND b.expiry_date >= current_date
         ),
         (bc.id IS NOT NULL AND ip.active AND p.active)
  FROM public.inventory_bin_cards bc
  JOIN public.inventory_products ip ON ip.id = bc.product_id
  JOIN public.inventory_locations il ON il.id = bc.location_id
  JOIN public.pricelist p ON p.id = ip.pricelist_item_id
  LEFT JOIN public.inventory_batches b
    ON b.product_id = bc.product_id AND b.location_id = bc.location_id
  WHERE il.code IN ('main_store', 'store_2')
    AND il.active
    AND public.has_any_role(public.hms_current_user_id(), ARRAY[
      'store'::public.app_role, 'pharmacist'::public.app_role,
      'accountant'::public.app_role, 'admin'::public.app_role
    ])
  GROUP BY bc.id, ip.id, il.id, il.code, il.name, p.id, p.name, p.category,
           p.size, p.price, ip.sku, ip.unit_label, ip.active, p.active
  ORDER BY il.code, p.name;
$$;

-- SOURCE: 20260817130000_simplify_store_bin_card_flow.sql statement 5
CREATE OR REPLACE FUNCTION public.record_inventory_receipt(
  _receipt_kind text,
  _location_code text,
  _items jsonb,
  _supplier_name text DEFAULT NULL,
  _supplier_reference text DEFAULT NULL,
  _note text DEFAULT NULL,
  _received_on date DEFAULT current_date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _receipt_id uuid;
  _location_id uuid;
  _batch_id uuid;
  _product_id uuid;
  _expiry_date date;
  _quantity numeric;
  _unit_cost numeric;
  _existing_opening boolean;
  _batch_number text;
  _user_id uuid := public.hms_current_user_id();
  _row jsonb;
BEGIN
  IF NOT public.has_any_role(_user_id, ARRAY['store'::public.app_role, 'admin'::public.app_role]) THEN
    RAISE EXCEPTION 'Only Store or Admin can record Stock';
  END IF;
  IF _receipt_kind NOT IN ('opening_count', 'supplier_delivery')
     OR _location_code NOT IN ('main_store', 'store_2')
     OR jsonb_typeof(_items) <> 'array'
     OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'A valid Stock type, Store location, and at least one line are required';
  END IF;
  IF _receipt_kind = 'supplier_delivery' AND NULLIF(btrim(_supplier_name), '') IS NULL THEN
    RAISE EXCEPTION 'Supplier name is required for a delivery';
  END IF;

  SELECT id INTO _location_id FROM public.inventory_locations
  WHERE code = _location_code AND active;
  IF _location_id IS NULL THEN RAISE EXCEPTION 'Selected Store location is unavailable'; END IF;

  IF _receipt_kind = 'opening_count' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.stock_movements sm
      WHERE sm.location_id = _location_id AND sm.movement_type = 'opening_count'
    ) INTO _existing_opening;
    IF _existing_opening THEN RAISE EXCEPTION 'Opening Stock has already been recorded for this Store'; END IF;
  END IF;

  INSERT INTO public.stock_receipts (
    receipt_kind, supplier_name, supplier_reference, received_on,
    location_id, note, received_by
  ) VALUES (
    _receipt_kind, NULLIF(btrim(_supplier_name), ''), NULLIF(btrim(_supplier_reference), ''),
    COALESCE(_received_on, current_date), _location_id, NULLIF(btrim(_note), ''), _user_id
  ) RETURNING id INTO _receipt_id;

  FOR i IN 0 .. jsonb_array_length(_items) - 1 LOOP
    _row := _items->i;
    _product_id := NULLIF(_row->>'product_id', '')::uuid;
    _expiry_date := NULLIF(_row->>'expiry_date', '')::date;
    _quantity := NULLIF(_row->>'quantity', '')::numeric;
    _unit_cost := NULLIF(_row->>'unit_cost', '')::numeric;

    IF _product_id IS NULL OR _expiry_date IS NULL OR _quantity IS NULL OR _quantity <= 0
       OR _unit_cost IS NULL OR _unit_cost < 0 THEN
      RAISE EXCEPTION 'Each Stock line requires medicine, expiry date, positive quantity, and cost price';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.inventory_bin_cards
      WHERE product_id = _product_id AND location_id = _location_id
    ) THEN
      RAISE EXCEPTION 'Register this medicine Bin Card in the selected Store before recording Stock';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.inventory_products WHERE id = _product_id AND active) THEN
      RAISE EXCEPTION 'The selected Bin Card is inactive';
    END IF;

    _batch_number := 'RECEIPT-' || replace(_receipt_id::text, '-', '') || '-' || (i + 1)::text;
    INSERT INTO public.inventory_batches (
      product_id, location_id, batch_number, expiry_date, unit_cost,
      quantity_on_hand, status
    ) VALUES (
      _product_id, _location_id, _batch_number, _expiry_date, _unit_cost,
      _quantity, CASE WHEN _expiry_date < current_date THEN 'expired' ELSE 'active' END
    ) RETURNING id INTO _batch_id;

    INSERT INTO public.stock_receipt_items (receipt_id, batch_id, product_id, quantity, unit_cost)
    VALUES (_receipt_id, _batch_id, _product_id, _quantity, _unit_cost);

    INSERT INTO public.stock_movements (
      movement_type, product_id, batch_id, location_id, quantity_delta,
      unit_cost, receipt_id, performed_by, reason
    ) VALUES (
      CASE WHEN _receipt_kind = 'opening_count' THEN 'opening_count' ELSE 'receipt' END,
      _product_id, _batch_id, _location_id, _quantity, _unit_cost,
      _receipt_id, _user_id, NULLIF(btrim(_supplier_name), '')
    );
  END LOOP;
  RETURN _receipt_id;
END;
$$;

-- SOURCE: 20260817130000_simplify_store_bin_card_flow.sql statement 6
DROP FUNCTION IF EXISTS public.create_store_to_pharmacy_transfer(jsonb, text);

-- SOURCE: 20260817130000_simplify_store_bin_card_flow.sql statement 7
CREATE OR REPLACE FUNCTION public.create_store_to_pharmacy_transfer(
  _items jsonb,
  _note text DEFAULT NULL,
  _source_location_code text DEFAULT 'main_store'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _transfer_id uuid;
  _to_location uuid;
  _from_location uuid;
  _product_id uuid;
  _remaining numeric;
  _take numeric;
  _user_id uuid := public.hms_current_user_id();
  _row jsonb;
  _batch_ids uuid[];
  _batch_id uuid;
  _batch_product_id uuid;
  _batch_unit_cost numeric;
  _batch_quantity numeric;
BEGIN
  IF NOT public.has_any_role(_user_id, ARRAY['store'::public.app_role, 'admin'::public.app_role]) THEN
    RAISE EXCEPTION 'Only Store or Admin can send Stock to Pharmacy';
  END IF;
  IF _source_location_code NOT IN ('main_store', 'store_2')
     OR jsonb_typeof(_items) <> 'array'
     OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Select a Store and at least one medicine to send';
  END IF;

  SELECT id INTO _from_location FROM public.inventory_locations WHERE code = _source_location_code AND active;
  SELECT id INTO _to_location FROM public.inventory_locations WHERE code = 'pharmacy' AND active;
  IF _from_location IS NULL OR _to_location IS NULL THEN RAISE EXCEPTION 'Store or Pharmacy location is unavailable'; END IF;

  FOR i IN 0 .. jsonb_array_length(_items) - 1 LOOP
    _row := _items->i;
    _product_id := NULLIF(_row->>'product_id', '')::uuid;
    _remaining := NULLIF(_row->>'quantity', '')::numeric;
    IF _product_id IS NULL OR _remaining IS NULL OR _remaining <= 0 THEN
      RAISE EXCEPTION 'Each Pharmacy issue requires a medicine and positive quantity';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.inventory_bin_cards WHERE product_id = _product_id AND location_id = _from_location) THEN
      RAISE EXCEPTION 'The medicine is not registered in the selected Store';
    END IF;

    SELECT array_agg(b.id ORDER BY b.expiry_date ASC, b.received_at ASC, b.id)
    INTO _batch_ids
    FROM public.inventory_batches b
    WHERE b.product_id = _product_id AND b.location_id = _from_location
      AND b.status = 'active' AND b.expiry_date >= current_date AND b.quantity_on_hand > 0;

    IF COALESCE(array_length(_batch_ids, 1), 0) > 0 THEN
      FOR j IN 1 .. array_length(_batch_ids, 1) LOOP
        EXIT WHEN _remaining <= 0;
        SELECT id, product_id, unit_cost, quantity_on_hand
        INTO _batch_id, _batch_product_id, _batch_unit_cost, _batch_quantity
        FROM public.inventory_batches WHERE id = _batch_ids[j] FOR UPDATE;
        _take := LEAST(_remaining, _batch_quantity);
        IF _transfer_id IS NULL THEN
          INSERT INTO public.stock_transfers (from_location_id, to_location_id, note, created_by)
          VALUES (_from_location, _to_location, NULLIF(btrim(_note), ''), _user_id)
          RETURNING id INTO _transfer_id;
        END IF;
        INSERT INTO public.stock_transfer_items (transfer_id, source_batch_id, product_id, quantity_sent)
        VALUES (_transfer_id, _batch_id, _batch_product_id, _take);
        _remaining := _remaining - _take;
      END LOOP;
    END IF;
    IF _remaining > 0 THEN RAISE EXCEPTION 'Insufficient available balance for one or more medicines'; END IF;
  END LOOP;

  IF _transfer_id IS NULL THEN RAISE EXCEPTION 'No transferable Stock was found'; END IF;
  RETURN _transfer_id;
END;
$$;

-- SOURCE: 20260817130000_simplify_store_bin_card_flow.sql statement 8
CREATE OR REPLACE FUNCTION public.receive_store_transfer(_transfer_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _status text;
  _from_location uuid;
  _to_location uuid;
  _note text;
  _user_id uuid := public.hms_current_user_id();
  _item_ids uuid[];
  _item_id uuid;
  _product_id uuid;
  _source_batch_id uuid;
  _quantity_sent numeric;
  _quantity_received numeric;
  _quantity numeric;
  _source_expiry date;
  _source_batch_number text;
  _source_unit_cost numeric;
  _source_quantity numeric;
  _source_status text;
  _destination_batch_id uuid;
BEGIN
  IF NOT public.has_any_role(_user_id, ARRAY['pharmacist'::public.app_role, 'admin'::public.app_role]) THEN
    RAISE EXCEPTION 'Only Pharmacy or Admin can confirm receipt from Store';
  END IF;
  SELECT status, from_location_id, to_location_id, note
  INTO _status, _from_location, _to_location, _note
  FROM public.stock_transfers WHERE id = _transfer_id FOR UPDATE;
  IF _status IS NULL OR _status NOT IN ('sent', 'partially_received') THEN
    RAISE EXCEPTION 'This transfer is not awaiting Pharmacy confirmation';
  END IF;

  SELECT array_agg(id ORDER BY id) INTO _item_ids
  FROM public.stock_transfer_items
  WHERE transfer_id = _transfer_id AND quantity_received < quantity_sent;
  IF COALESCE(array_length(_item_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'This transfer has no outstanding items';
  END IF;

  FOR i IN 1 .. array_length(_item_ids, 1) LOOP
    _item_id := _item_ids[i];
    SELECT product_id, source_batch_id, quantity_sent, quantity_received
    INTO _product_id, _source_batch_id, _quantity_sent, _quantity_received
    FROM public.stock_transfer_items WHERE id = _item_id FOR UPDATE;
    _quantity := _quantity_sent - _quantity_received;

    SELECT batch_number, expiry_date, unit_cost, quantity_on_hand, status
    INTO _source_batch_number, _source_expiry, _source_unit_cost, _source_quantity, _source_status
    FROM public.inventory_batches WHERE id = _source_batch_id FOR UPDATE;
    IF _source_batch_number IS NULL OR _source_status <> 'active'
       OR _source_expiry < current_date OR _source_quantity < _quantity THEN
      RAISE EXCEPTION 'The transfer cannot be accepted because Store balance or expiry changed';
    END IF;

    UPDATE public.inventory_batches
    SET quantity_on_hand = quantity_on_hand - _quantity, updated_at = now()
    WHERE id = _source_batch_id;
    INSERT INTO public.stock_movements (
      movement_type, product_id, batch_id, location_id, quantity_delta,
      unit_cost, transfer_id, performed_by, reason
    ) VALUES ('transfer_out', _product_id, _source_batch_id, _from_location,
              -_quantity, _source_unit_cost, _transfer_id, _user_id, _note);

    INSERT INTO public.inventory_batches (
      product_id, location_id, batch_number, expiry_date, unit_cost,
      quantity_on_hand, source_batch_id, status
    ) VALUES (
      _product_id, _to_location, _source_batch_number, _source_expiry,
      _source_unit_cost, _quantity, _source_batch_id,
      CASE WHEN _source_expiry < current_date THEN 'expired' ELSE 'active' END
    )
    ON CONFLICT (product_id, location_id, batch_number, expiry_date) DO UPDATE
      SET quantity_on_hand = public.inventory_batches.quantity_on_hand + EXCLUDED.quantity_on_hand,
          status = CASE WHEN public.inventory_batches.expiry_date < current_date THEN 'expired' ELSE 'active' END,
          updated_at = now()
    RETURNING id INTO _destination_batch_id;

    UPDATE public.stock_transfer_items
    SET quantity_received = quantity_sent, destination_batch_id = _destination_batch_id
    WHERE id = _item_id;
    INSERT INTO public.stock_movements (
      movement_type, product_id, batch_id, location_id, quantity_delta,
      unit_cost, transfer_id, performed_by, reason
    ) VALUES ('transfer_in', _product_id, _destination_batch_id, _to_location,
              _quantity, _source_unit_cost, _transfer_id, _user_id, _note);
  END LOOP;

  UPDATE public.stock_transfers
  SET status = 'received', received_by = _user_id, received_at = now()
  WHERE id = _transfer_id;
  RETURN _transfer_id;
END;
$$;

-- SOURCE: 20260817130000_simplify_store_bin_card_flow.sql statement 9
CREATE OR REPLACE FUNCTION public.dispense_inventory_invoice_item(_invoice_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _item_id uuid;
  _invoice_status text;
  _dispensing_status text;
  _user_id uuid := public.hms_current_user_id();
BEGIN
  IF NOT public.has_any_role(_user_id, ARRAY['pharmacist'::public.app_role, 'admin'::public.app_role]) THEN
    RAISE EXCEPTION 'Only Pharmacy or Admin can dispense medicine';
  END IF;
  SELECT ii.id, i.status, COALESCE(ii.dispensing_status, 'pending')
  INTO _item_id, _invoice_status, _dispensing_status
  FROM public.invoice_items ii JOIN public.invoices i ON i.id = ii.invoice_id
  WHERE ii.id = _invoice_item_id FOR UPDATE;
  IF _item_id IS NULL THEN RAISE EXCEPTION 'Invoice item not found'; END IF;
  IF _invoice_status <> 'paid' THEN RAISE EXCEPTION 'Only a paid invoice item can be dispensed'; END IF;
  IF _dispensing_status <> 'pending' THEN RAISE EXCEPTION 'This invoice item has already been processed'; END IF;

  UPDATE public.invoice_items
  SET dispensing_status = 'dispensed',
      dispensing_notes = 'Dispensed; Pharmacy balance is controlled by accepted Store transfers, not patient dispensing units.',
      dispensing_updated_at = now(), dispensing_updated_by = _user_id
  WHERE id = _item_id;
  RETURN jsonb_build_object(
    'invoice_item_id', _item_id,
    'stock_controlled', false,
    'message', 'Dispensed without changing Pharmacy inventory balance.'
  );
END;
$$;

-- SOURCE: 20260817130000_simplify_store_bin_card_flow.sql statement 10
GRANT EXECUTE ON FUNCTION public.register_inventory_bin_card(uuid, text) TO authenticated;

-- SOURCE: 20260817130000_simplify_store_bin_card_flow.sql statement 11
GRANT EXECUTE ON FUNCTION public.get_store_bin_cards() TO authenticated;

-- SOURCE: 20260817130000_simplify_store_bin_card_flow.sql statement 12
GRANT EXECUTE ON FUNCTION public.record_inventory_receipt(text, text, jsonb, text, text, text, date) TO authenticated;

-- SOURCE: 20260817130000_simplify_store_bin_card_flow.sql statement 13
GRANT EXECUTE ON FUNCTION public.create_store_to_pharmacy_transfer(jsonb, text, text) TO authenticated;

-- SOURCE: 20260817130000_simplify_store_bin_card_flow.sql statement 14
GRANT EXECUTE ON FUNCTION public.receive_store_transfer(uuid) TO authenticated;

-- SOURCE: 20260817130000_simplify_store_bin_card_flow.sql statement 15
GRANT EXECUTE ON FUNCTION public.dispense_inventory_invoice_item(uuid) TO authenticated;

-- SOURCE: 20260817191500_pharmacy_store_delivery_accept_reject.sql statement 1
ALTER TABLE public.stock_transfers
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- SOURCE: 20260817191500_pharmacy_store_delivery_accept_reject.sql statement 2
ALTER TABLE public.stock_transfers DROP CONSTRAINT IF EXISTS stock_transfers_status_check;

-- SOURCE: 20260817191500_pharmacy_store_delivery_accept_reject.sql statement 3
ALTER TABLE public.stock_transfers ADD CONSTRAINT stock_transfers_status_check
  CHECK (status IN ('sent', 'partially_received', 'received', 'cancelled', 'rejected'));

-- SOURCE: 20260817191500_pharmacy_store_delivery_accept_reject.sql statement 4
CREATE OR REPLACE FUNCTION public.get_pending_store_transfers()
RETURNS TABLE (
  transfer_id uuid,
  status text,
  note text,
  sent_at timestamptz,
  from_location_name text,
  from_location_code text,
  item_id uuid,
  product_id uuid,
  quantity_sent numeric,
  quantity_received numeric,
  medicine_name text,
  size text
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT st.id,
         st.status,
         st.note,
         st.sent_at,
         from_loc.name,
         from_loc.code,
         sti.id,
         sti.product_id,
         sti.quantity_sent,
         sti.quantity_received,
         p.name,
         p.size
  FROM public.stock_transfers st
  JOIN public.inventory_locations from_loc ON from_loc.id = st.from_location_id
  JOIN public.stock_transfer_items sti ON sti.transfer_id = st.id
  JOIN public.inventory_products ip ON ip.id = sti.product_id
  JOIN public.pricelist p ON p.id = ip.pricelist_item_id
  WHERE st.status IN ('sent', 'partially_received')
    AND public.has_any_role(public.hms_current_user_id(), ARRAY['store'::public.app_role, 'pharmacist'::public.app_role, 'accountant'::public.app_role, 'admin'::public.app_role])
  ORDER BY st.sent_at DESC, sti.created_at ASC;
$$;

-- SOURCE: 20260817191500_pharmacy_store_delivery_accept_reject.sql statement 5
CREATE OR REPLACE FUNCTION public.reject_store_transfer(
  _transfer_id uuid,
  _reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE PLPGSQL
SECURITY DEFINER
AS $$
DECLARE
  _status text;
  _user_id uuid := public.hms_current_user_id();
BEGIN
  IF NOT public.has_any_role(_user_id, ARRAY['pharmacist'::public.app_role, 'admin'::public.app_role]) THEN
    RAISE EXCEPTION 'Only Pharmacy or Admin can reject a Store delivery';
  END IF;

  SELECT status INTO _status
  FROM public.stock_transfers
  WHERE id = _transfer_id
  FOR UPDATE;

  IF _status IS NULL OR _status NOT IN ('sent', 'partially_received') THEN
    RAISE EXCEPTION 'This delivery is no longer awaiting Pharmacy decision';
  END IF;

  UPDATE public.stock_transfers
  SET status = 'rejected',
      rejected_by = _user_id,
      rejected_at = clock_timestamp(),
      rejection_reason = NULLIF(btrim(_reason), '')
  WHERE id = _transfer_id;

  RETURN _transfer_id;
END;
$$;

-- SOURCE: 20260817191500_pharmacy_store_delivery_accept_reject.sql statement 6
GRANT EXECUTE ON FUNCTION public.get_pending_store_transfers() TO authenticated;

-- SOURCE: 20260817191500_pharmacy_store_delivery_accept_reject.sql statement 7
GRANT EXECUTE ON FUNCTION public.reject_store_transfer(uuid, text) TO authenticated;

-- SOURCE: 20260817203000_remove_inventory_expiry_logic.sql statement 1
UPDATE public.inventory_batches
SET status = 'active',
    expiry_date = DATE '9999-12-31',
    updated_at = clock_timestamp()
WHERE status = 'expired';

-- SOURCE: 20260817203000_remove_inventory_expiry_logic.sql statement 2
DROP FUNCTION IF EXISTS public.get_store_bin_cards();

-- SOURCE: 20260817203000_remove_inventory_expiry_logic.sql statement 3
CREATE FUNCTION public.get_store_bin_cards()
RETURNS TABLE (
  bin_card_id uuid,
  product_id uuid,
  location_id uuid,
  location_code text,
  location_name text,
  pricelist_item_id uuid,
  medicine_name text,
  category text,
  size text,
  sale_price numeric,
  sku text,
  unit_label text,
  current_balance numeric,
  active boolean
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT bc.id, ip.id, il.id, il.code, il.name, p.id, p.name, p.category,
         p.size, p.price, ip.sku, ip.unit_label,
         COALESCE(SUM(b.quantity_on_hand) FILTER (WHERE b.status = 'active'), 0),
         (bc.id IS NOT NULL AND ip.active AND p.active)
  FROM public.inventory_bin_cards bc
  JOIN public.inventory_products ip ON ip.id = bc.product_id
  JOIN public.inventory_locations il ON il.id = bc.location_id
  JOIN public.pricelist p ON p.id = ip.pricelist_item_id
  LEFT JOIN public.inventory_batches b
    ON b.product_id = bc.product_id AND b.location_id = bc.location_id
  WHERE il.code IN ('main_store', 'store_2')
    AND il.active
    AND public.has_any_role(public.hms_current_user_id(), ARRAY[
      'store'::public.app_role, 'pharmacist'::public.app_role,
      'accountant'::public.app_role, 'admin'::public.app_role
    ])
  GROUP BY bc.id, ip.id, il.id, il.code, il.name, p.id, p.name, p.category,
           p.size, p.price, ip.sku, ip.unit_label, ip.active, p.active
  ORDER BY il.code, p.name;
$$;

-- SOURCE: 20260817203000_remove_inventory_expiry_logic.sql statement 4
CREATE OR REPLACE FUNCTION public.record_inventory_receipt(
  _receipt_kind text,
  _location_code text,
  _items jsonb,
  _supplier_name text DEFAULT NULL,
  _supplier_reference text DEFAULT NULL,
  _note text DEFAULT NULL,
  _received_on date DEFAULT current_date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _receipt_id uuid;
  _location_id uuid;
  _batch_id uuid;
  _product_id uuid;
  _quantity numeric;
  _unit_cost numeric;
  _existing_opening boolean;
  _batch_number text;
  _user_id uuid := public.hms_current_user_id();
  _row jsonb;
BEGIN
  IF NOT public.has_any_role(_user_id, ARRAY['store'::public.app_role, 'admin'::public.app_role]) THEN
    RAISE EXCEPTION 'Only Store or Admin can record Stock';
  END IF;
  IF _receipt_kind NOT IN ('opening_count', 'supplier_delivery')
     OR _location_code NOT IN ('main_store', 'store_2')
     OR jsonb_typeof(_items) <> 'array'
     OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'A valid Stock type, Store location, and at least one line are required';
  END IF;
  IF _receipt_kind = 'supplier_delivery' AND NULLIF(btrim(_supplier_name), '') IS NULL THEN
    RAISE EXCEPTION 'Supplier name is required for a delivery';
  END IF;

  SELECT id INTO _location_id FROM public.inventory_locations
  WHERE code = _location_code AND active;
  IF _location_id IS NULL THEN RAISE EXCEPTION 'Selected Store location is unavailable'; END IF;

  IF _receipt_kind = 'opening_count' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.stock_movements sm
      WHERE sm.location_id = _location_id AND sm.movement_type = 'opening_count'
    ) INTO _existing_opening;
    IF _existing_opening THEN RAISE EXCEPTION 'Opening Stock has already been recorded for this Store'; END IF;
  END IF;

  INSERT INTO public.stock_receipts (
    receipt_kind, supplier_name, supplier_reference, received_on,
    location_id, note, received_by
  ) VALUES (
    _receipt_kind, NULLIF(btrim(_supplier_name), ''), NULLIF(btrim(_supplier_reference), ''),
    COALESCE(_received_on, current_date), _location_id, NULLIF(btrim(_note), ''), _user_id
  ) RETURNING id INTO _receipt_id;

  FOR i IN 0 .. jsonb_array_length(_items) - 1 LOOP
    _row := _items->i;
    _product_id := NULLIF(_row->>'product_id', '')::uuid;
    _quantity := NULLIF(_row->>'quantity', '')::numeric;
    _unit_cost := NULLIF(_row->>'unit_cost', '')::numeric;

    IF _product_id IS NULL OR _quantity IS NULL OR _quantity <= 0
       OR _unit_cost IS NULL OR _unit_cost < 0 THEN
      RAISE EXCEPTION 'Each Stock line requires medicine, positive quantity, and cost price';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.inventory_bin_cards
      WHERE product_id = _product_id AND location_id = _location_id
    ) THEN
      RAISE EXCEPTION 'Register this medicine Bin Card in the selected Store before recording Stock';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.inventory_products WHERE id = _product_id AND active) THEN
      RAISE EXCEPTION 'The selected Bin Card is inactive';
    END IF;

    _batch_number := 'RECEIPT-' || replace(_receipt_id::text, '-', '') || '-' || (i + 1)::text;
    INSERT INTO public.inventory_batches (
      product_id, location_id, batch_number, expiry_date, unit_cost,
      quantity_on_hand, status
    ) VALUES (
      _product_id, _location_id, _batch_number, DATE '9999-12-31', _unit_cost,
      _quantity, 'active'
    ) RETURNING id INTO _batch_id;

    INSERT INTO public.stock_receipt_items (receipt_id, batch_id, product_id, quantity, unit_cost)
    VALUES (_receipt_id, _batch_id, _product_id, _quantity, _unit_cost);

    INSERT INTO public.stock_movements (
      movement_type, product_id, batch_id, location_id, quantity_delta,
      unit_cost, receipt_id, performed_by, reason
    ) VALUES (
      CASE WHEN _receipt_kind = 'opening_count' THEN 'opening_count' ELSE 'receipt' END,
      _product_id, _batch_id, _location_id, _quantity, _unit_cost,
      _receipt_id, _user_id, NULLIF(btrim(_supplier_name), '')
    );
  END LOOP;
  RETURN _receipt_id;
END;
$$;

-- SOURCE: 20260817203000_remove_inventory_expiry_logic.sql statement 5
CREATE OR REPLACE FUNCTION public.create_store_to_pharmacy_transfer(
  _items jsonb,
  _note text DEFAULT NULL,
  _source_location_code text DEFAULT 'main_store'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _transfer_id uuid;
  _to_location uuid;
  _from_location uuid;
  _product_id uuid;
  _remaining numeric;
  _take numeric;
  _user_id uuid := public.hms_current_user_id();
  _row jsonb;
  _batch_ids uuid[];
  _batch_id uuid;
  _batch_product_id uuid;
  _batch_unit_cost numeric;
  _batch_quantity numeric;
BEGIN
  IF NOT public.has_any_role(_user_id, ARRAY['store'::public.app_role, 'admin'::public.app_role]) THEN
    RAISE EXCEPTION 'Only Store or Admin can send Stock to Pharmacy';
  END IF;
  IF _source_location_code NOT IN ('main_store', 'store_2')
     OR jsonb_typeof(_items) <> 'array'
     OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Select a Store and at least one medicine to send';
  END IF;

  SELECT id INTO _from_location FROM public.inventory_locations WHERE code = _source_location_code AND active;
  SELECT id INTO _to_location FROM public.inventory_locations WHERE code = 'pharmacy' AND active;
  IF _from_location IS NULL OR _to_location IS NULL THEN RAISE EXCEPTION 'Store or Pharmacy location is unavailable'; END IF;

  FOR i IN 0 .. jsonb_array_length(_items) - 1 LOOP
    _row := _items->i;
    _product_id := NULLIF(_row->>'product_id', '')::uuid;
    _remaining := NULLIF(_row->>'quantity', '')::numeric;
    IF _product_id IS NULL OR _remaining IS NULL OR _remaining <= 0 THEN
      RAISE EXCEPTION 'Each Pharmacy issue requires a medicine and positive quantity';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.inventory_bin_cards WHERE product_id = _product_id AND location_id = _from_location) THEN
      RAISE EXCEPTION 'The medicine is not registered in the selected Store';
    END IF;

    SELECT array_agg(b.id ORDER BY b.received_at ASC, b.id)
    INTO _batch_ids
    FROM public.inventory_batches b
    WHERE b.product_id = _product_id AND b.location_id = _from_location
      AND b.status = 'active' AND b.quantity_on_hand > 0;

    IF COALESCE(array_length(_batch_ids, 1), 0) > 0 THEN
      FOR j IN 1 .. array_length(_batch_ids, 1) LOOP
        EXIT WHEN _remaining <= 0;
        SELECT id, product_id, unit_cost, quantity_on_hand
        INTO _batch_id, _batch_product_id, _batch_unit_cost, _batch_quantity
        FROM public.inventory_batches WHERE id = _batch_ids[j] FOR UPDATE;
        _take := LEAST(_remaining, _batch_quantity);
        IF _transfer_id IS NULL THEN
          INSERT INTO public.stock_transfers (from_location_id, to_location_id, note, created_by)
          VALUES (_from_location, _to_location, NULLIF(btrim(_note), ''), _user_id)
          RETURNING id INTO _transfer_id;
        END IF;
        INSERT INTO public.stock_transfer_items (transfer_id, source_batch_id, product_id, quantity_sent)
        VALUES (_transfer_id, _batch_id, _batch_product_id, _take);
        _remaining := _remaining - _take;
      END LOOP;
    END IF;
    IF _remaining > 0 THEN RAISE EXCEPTION 'Insufficient available balance for one or more medicines'; END IF;
  END LOOP;

  IF _transfer_id IS NULL THEN RAISE EXCEPTION 'No transferable Stock was found'; END IF;
  RETURN _transfer_id;
END;
$$;

-- SOURCE: 20260817203000_remove_inventory_expiry_logic.sql statement 6
CREATE OR REPLACE FUNCTION public.receive_store_transfer(_transfer_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _status text;
  _from_location uuid;
  _to_location uuid;
  _note text;
  _user_id uuid := public.hms_current_user_id();
  _item_ids uuid[];
  _item_id uuid;
  _product_id uuid;
  _source_batch_id uuid;
  _quantity_sent numeric;
  _quantity_received numeric;
  _quantity numeric;
  _source_batch_number text;
  _source_unit_cost numeric;
  _source_quantity numeric;
  _source_status text;
  _destination_batch_id uuid;
BEGIN
  IF NOT public.has_any_role(_user_id, ARRAY['pharmacist'::public.app_role, 'admin'::public.app_role]) THEN
    RAISE EXCEPTION 'Only Pharmacy or Admin can confirm receipt from Store';
  END IF;
  SELECT status, from_location_id, to_location_id, note
  INTO _status, _from_location, _to_location, _note
  FROM public.stock_transfers WHERE id = _transfer_id FOR UPDATE;
  IF _status IS NULL OR _status NOT IN ('sent', 'partially_received') THEN
    RAISE EXCEPTION 'This transfer is not awaiting Pharmacy confirmation';
  END IF;

  SELECT array_agg(id ORDER BY id) INTO _item_ids
  FROM public.stock_transfer_items
  WHERE transfer_id = _transfer_id AND quantity_received < quantity_sent;
  IF COALESCE(array_length(_item_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'This transfer has no outstanding items';
  END IF;

  FOR i IN 1 .. array_length(_item_ids, 1) LOOP
    _item_id := _item_ids[i];
    SELECT product_id, source_batch_id, quantity_sent, quantity_received
    INTO _product_id, _source_batch_id, _quantity_sent, _quantity_received
    FROM public.stock_transfer_items WHERE id = _item_id FOR UPDATE;
    _quantity := _quantity_sent - _quantity_received;

    SELECT batch_number, unit_cost, quantity_on_hand, status
    INTO _source_batch_number, _source_unit_cost, _source_quantity, _source_status
    FROM public.inventory_batches WHERE id = _source_batch_id FOR UPDATE;
    IF _source_batch_number IS NULL OR _source_status <> 'active' OR _source_quantity < _quantity THEN
      RAISE EXCEPTION 'The transfer cannot be accepted because Store balance changed';
    END IF;

    UPDATE public.inventory_batches
    SET quantity_on_hand = quantity_on_hand - _quantity, updated_at = clock_timestamp()
    WHERE id = _source_batch_id;
    INSERT INTO public.stock_movements (
      movement_type, product_id, batch_id, location_id, quantity_delta,
      unit_cost, transfer_id, performed_by, reason
    ) VALUES ('transfer_out', _product_id, _source_batch_id, _from_location,
              -_quantity, _source_unit_cost, _transfer_id, _user_id, _note);

    INSERT INTO public.inventory_batches (
      product_id, location_id, batch_number, expiry_date, unit_cost,
      quantity_on_hand, source_batch_id, status
    ) VALUES (
      _product_id, _to_location, _source_batch_number, DATE '9999-12-31',
      _source_unit_cost, _quantity, _source_batch_id, 'active'
    )
    ON CONFLICT (product_id, location_id, batch_number, expiry_date) DO UPDATE
      SET quantity_on_hand = public.inventory_batches.quantity_on_hand + EXCLUDED.quantity_on_hand,
          status = 'active',
          updated_at = clock_timestamp()
    RETURNING id INTO _destination_batch_id;

    UPDATE public.stock_transfer_items
    SET quantity_received = quantity_sent, destination_batch_id = _destination_batch_id
    WHERE id = _item_id;
    INSERT INTO public.stock_movements (
      movement_type, product_id, batch_id, location_id, quantity_delta,
      unit_cost, transfer_id, performed_by, reason
    ) VALUES ('transfer_in', _product_id, _destination_batch_id, _to_location,
              _quantity, _source_unit_cost, _transfer_id, _user_id, _note);
  END LOOP;

  UPDATE public.stock_transfers
  SET status = 'received', received_by = _user_id, received_at = clock_timestamp()
  WHERE id = _transfer_id;
  RETURN _transfer_id;
END;
$$;

-- SOURCE: 20260817203000_remove_inventory_expiry_logic.sql statement 7
GRANT EXECUTE ON FUNCTION public.get_store_bin_cards() TO authenticated;

-- SOURCE: 20260817203000_remove_inventory_expiry_logic.sql statement 8
GRANT EXECUTE ON FUNCTION public.record_inventory_receipt(text, text, jsonb, text, text, text, date) TO authenticated;

-- SOURCE: 20260817203000_remove_inventory_expiry_logic.sql statement 9
GRANT EXECUTE ON FUNCTION public.create_store_to_pharmacy_transfer(jsonb, text, text) TO authenticated;

-- SOURCE: 20260817203000_remove_inventory_expiry_logic.sql statement 10
GRANT EXECUTE ON FUNCTION public.receive_store_transfer(uuid) TO authenticated;

-- SOURCE: 20260817203000_remove_inventory_expiry_logic.sql statement 11
GRANT EXECUTE ON FUNCTION public.dispense_inventory_invoice_item(uuid) TO authenticated;

-- SOURCE: 20260818203000_fix_crdb_rpc_overloads.sql statement 1
DROP FUNCTION IF EXISTS public.settle_invoice_atomic(
  uuid,
  numeric,
  numeric,
  numeric,
  text,
  text,
  boolean
);

-- SOURCE: 20260818203000_fix_crdb_rpc_overloads.sql statement 2
SELECT 1;

-- SOURCE: 20260818203000_fix_crdb_rpc_overloads.sql statement 3
GRANT EXECUTE ON FUNCTION public.settle_invoice_atomic(
  uuid,
  numeric,
  numeric,
  numeric,
  text,
  text,
  boolean,
  boolean
) TO authenticated;

-- SOURCE: 20260819120000_crdb_workflow_compatibility.sql statement 1
ALTER TABLE public.snap_orders ADD COLUMN IF NOT EXISTS result_text STRING;

-- SOURCE: 20260819120000_crdb_workflow_compatibility.sql statement 3
CREATE INDEX IF NOT EXISTS idx_snap_orders_result_text ON public.snap_orders (result_text) WHERE result_text IS NOT NULL;

-- SOURCE: 20260819120000_crdb_workflow_compatibility.sql statement 4
ALTER TABLE public.patients DROP CONSTRAINT IF EXISTS check_balance_non_negative;

-- SOURCE: 20260819120000_crdb_workflow_compatibility.sql statement 5
ALTER TABLE public.balance_transactions DROP CONSTRAINT IF EXISTS check_transaction_type;

-- SOURCE: 20260819120000_crdb_workflow_compatibility.sql statement 6
ALTER TABLE public.balance_transactions DROP CONSTRAINT IF EXISTS balance_transactions_transaction_type_check;

-- SOURCE: 20260819120000_crdb_workflow_compatibility.sql statement 7
ALTER TABLE public.balance_transactions ADD CONSTRAINT balance_transactions_transaction_type_check CHECK (transaction_type IN ('topup','refund','invoice_deduction','staff_family_coverage','staff_coverage','adjustment','debt_incurred','debt_cleared','admitted_deduction','overpayment_credit','manual_adjustment'));
