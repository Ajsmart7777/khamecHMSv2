-- Khamec HMS CockroachDB Migration: Store 1, Store 2, and Pharmacy workflow
INSERT INTO public.inventory_locations (code, name, active)
VALUES ('store_2', 'Store 2', true)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, active = true;

UPDATE public.inventory_locations SET name = 'Store 1' WHERE code = 'main_store';
UPDATE public.inventory_locations SET name = 'Store 2' WHERE code = 'store_2';
UPDATE public.inventory_locations SET name = 'Pharmacy' WHERE code = 'pharmacy';

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

  FOR _row IN SELECT value FROM jsonb_array_elements(_items)
  LOOP
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
  _batch record;
  _quantity numeric;
BEGIN
  IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Select at least one batch and quantity to transfer';
  END IF;

  SELECT id INTO _to_location FROM public.inventory_locations WHERE code = 'pharmacy' AND active;
  IF _to_location IS NULL THEN RAISE EXCEPTION 'Pharmacy location is unavailable'; END IF;

  FOR _row IN SELECT value FROM jsonb_array_elements(_items)
  LOOP
    _quantity := (_row->>'quantity')::numeric;
    IF _quantity IS NULL OR _quantity <= 0 THEN RAISE EXCEPTION 'Transfer quantities must be positive'; END IF;

    SELECT b.id, b.product_id, b.unit_cost, b.quantity_on_hand, b.location_id
    INTO _batch
    FROM public.inventory_batches b
    JOIN public.inventory_locations source_location ON source_location.id = b.location_id
    WHERE b.id = (_row->>'batch_id')::uuid
      AND source_location.code IN ('main_store', 'store_2')
      AND b.status = 'active'
      AND b.expiry_date >= current_date
    FOR UPDATE;

    IF _batch.id IS NULL OR _batch.quantity_on_hand < _quantity THEN
      RAISE EXCEPTION 'Insufficient available stock for one or more selected Store batches';
    END IF;
    IF _source_location IS NULL THEN
      _source_location := _batch.location_id;
    ELSIF _batch.location_id <> _source_location THEN
      RAISE EXCEPTION 'A transfer must contain stock from only one Store location';
    END IF;

    IF _transfer_id IS NULL THEN
      INSERT INTO public.stock_transfers (from_location_id, to_location_id, note)
      VALUES (_batch.location_id, _to_location, NULLIF(btrim(_note), ''))
      RETURNING id INTO _transfer_id;
    END IF;

    UPDATE public.inventory_batches
    SET quantity_on_hand = quantity_on_hand - _quantity, updated_at = clock_timestamp()
    WHERE id = _batch.id;

    INSERT INTO public.stock_transfer_items (transfer_id, source_batch_id, product_id, quantity_sent)
    VALUES (_transfer_id, _batch.id, _batch.product_id, _quantity);

    INSERT INTO public.stock_movements (movement_type, product_id, batch_id, location_id, quantity_delta, unit_cost, transfer_id, reason)
    VALUES ('transfer_out', _batch.product_id, _batch.id, _batch.location_id, -_quantity, _batch.unit_cost, _transfer_id, _note);
  END LOOP;

  RETURN _transfer_id;
END;
$$;
