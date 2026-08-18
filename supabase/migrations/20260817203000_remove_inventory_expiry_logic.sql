-- Remove expiration behavior from Store and Pharmacy inventory.
-- expiry_date remains only as a legacy compatibility column because existing
-- CockroachDB constraints and historical rows still reference it. It is no
-- longer entered, checked, filtered, displayed, or used for ordering.

UPDATE public.inventory_batches
SET status = 'active',
    expiry_date = DATE '9999-12-31',
    updated_at = clock_timestamp()
WHERE status = 'expired';

DROP FUNCTION IF EXISTS public.get_store_bin_cards();
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

GRANT EXECUTE ON FUNCTION public.get_store_bin_cards() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_inventory_receipt(text, text, jsonb, text, text, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_store_to_pharmacy_transfer(jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_store_transfer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dispense_inventory_invoice_item(uuid) TO authenticated;
