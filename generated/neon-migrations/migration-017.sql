-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 9
CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_type text NOT NULL CHECK (movement_type IN ('opening_count', 'receipt', 'transfer_out', 'transfer_in', 'dispensed', 'return_to_store', 'damage', 'expiry', 'adjustment')),
  product_id uuid NOT NULL REFERENCES public.inventory_products(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES public.inventory_batches(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  quantity_delta numeric(14,3) NOT NULL CHECK (quantity_delta <> 0),
  unit_cost numeric(14,2) NOT NULL CHECK (unit_cost >= 0),
  receipt_id uuid REFERENCES public.stock_receipts(id) ON DELETE RESTRICT,
  transfer_id uuid REFERENCES public.stock_transfers(id) ON DELETE RESTRICT,
  invoice_item_id uuid REFERENCES public.invoice_items(id) ON DELETE RESTRICT,
  reason text,
  performed_by uuid NOT NULL REFERENCES neon_auth.user(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (movement_type IN ('opening_count', 'receipt') AND receipt_id IS NOT NULL)
    OR (movement_type IN ('transfer_out', 'transfer_in', 'return_to_store') AND transfer_id IS NOT NULL)
    OR movement_type IN ('dispensed', 'damage', 'expiry', 'adjustment')
  )
);

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 10
CREATE TABLE public.dispense_stock_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_item_id uuid NOT NULL REFERENCES public.invoice_items(id) ON DELETE RESTRICT,
  stock_movement_id uuid NOT NULL UNIQUE REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES public.inventory_batches(id) ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  dispensed_by uuid NOT NULL REFERENCES neon_auth.user(id) ON DELETE RESTRICT,
  dispensed_at timestamptz NOT NULL DEFAULT now()
);

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 11
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS pricelist_item_id uuid REFERENCES public.pricelist(id) ON DELETE SET NULL;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 12
CREATE INDEX inventory_batches_stock_lookup_idx ON public.inventory_batches (location_id, product_id, status, expiry_date, quantity_on_hand);

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 13
CREATE INDEX stock_movements_product_date_idx ON public.stock_movements (product_id, created_at DESC);

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 14
CREATE INDEX stock_movements_invoice_item_idx ON public.stock_movements (invoice_item_id) WHERE invoice_item_id IS NOT NULL;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 15
CREATE INDEX stock_transfer_items_transfer_idx ON public.stock_transfer_items (transfer_id);

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 16
CREATE INDEX invoice_items_pricelist_item_idx ON public.invoice_items (pricelist_item_id) WHERE pricelist_item_id IS NOT NULL;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 17
ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 18
ALTER TABLE public.inventory_products ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 19
ALTER TABLE public.inventory_batches ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 20
ALTER TABLE public.stock_receipts ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 21
ALTER TABLE public.stock_receipt_items ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 22
ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 23
ALTER TABLE public.stock_transfer_items ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 24
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 25
ALTER TABLE public.dispense_stock_allocations ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 26
CREATE POLICY "Inventory locations visible to authorised inventory staff" ON public.inventory_locations
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store', 'pharmacist', 'accountant', 'admin']::public.app_role[]));

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 27
CREATE POLICY "Inventory products visible to authorised inventory staff" ON public.inventory_products
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store', 'pharmacist', 'accountant', 'admin']::public.app_role[]));

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 28
CREATE POLICY "Inventory batches visible to Store, Accountant and Admin" ON public.inventory_batches
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store', 'accountant', 'admin']::public.app_role[]));

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 29
CREATE POLICY "Inventory receipt records visible to Store, Accountant and Admin" ON public.stock_receipts
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store', 'accountant', 'admin']::public.app_role[]));

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 30
CREATE POLICY "Inventory receipt lines visible to Store, Accountant and Admin" ON public.stock_receipt_items
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store', 'accountant', 'admin']::public.app_role[]));

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 31
CREATE POLICY "Inventory transfers visible to Store, Pharmacy, Accountant and Admin" ON public.stock_transfers
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store', 'pharmacist', 'accountant', 'admin']::public.app_role[]));

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 32
CREATE POLICY "Inventory transfer lines visible to Store, Pharmacy, Accountant and Admin" ON public.stock_transfer_items
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store', 'pharmacist', 'accountant', 'admin']::public.app_role[]));

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 33
CREATE POLICY "Inventory movements visible to Store, Accountant and Admin" ON public.stock_movements
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store', 'accountant', 'admin']::public.app_role[]));

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 34
CREATE POLICY "Dispense allocations visible to Pharmacy, Store, Accountant and Admin" ON public.dispense_stock_allocations
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store', 'pharmacist', 'accountant', 'admin']::public.app_role[]));

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 35
CREATE OR REPLACE FUNCTION public.create_inventory_product(
  _pricelist_item_id uuid,
  _sku text,
  _unit_label text DEFAULT 'unit',
  _minimum_level numeric DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _product_id uuid;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['store', 'accountant', 'admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only Store, Accountant, or Admin can map a medicine to inventory';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.pricelist WHERE id = _pricelist_item_id AND active) THEN
    RAISE EXCEPTION 'Select an active pricelist medicine or consumable';
  END IF;

  IF btrim(COALESCE(_sku, '')) = '' OR btrim(COALESCE(_unit_label, '')) = '' OR COALESCE(_minimum_level, 0) < 0 THEN
    RAISE EXCEPTION 'SKU, unit label, and a non-negative minimum level are required';
  END IF;

  INSERT INTO public.inventory_products (pricelist_item_id, sku, unit_label, minimum_level, created_by)
  VALUES (_pricelist_item_id, btrim(_sku), btrim(_unit_label), _minimum_level, auth.uid())
  ON CONFLICT (pricelist_item_id) DO UPDATE
    SET sku = EXCLUDED.sku,
        unit_label = EXCLUDED.unit_label,
        minimum_level = EXCLUDED.minimum_level,
        active = true,
        updated_at = now()
  RETURNING id INTO _product_id;

  RETURN _product_id;
END;
$$;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 36
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
SET search_path = public
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
  IF NOT public.has_any_role(auth.uid(), ARRAY['store', 'admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only Store or Admin can record an opening count or supplier delivery';
  END IF;

  IF _receipt_kind NOT IN ('opening_count', 'supplier_delivery') OR _location_code NOT IN ('main_store', 'pharmacy') OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'A valid receipt kind, location, and at least one item are required';
  END IF;

  IF _receipt_kind = 'supplier_delivery' AND _location_code <> 'main_store' THEN
    RAISE EXCEPTION 'Supplier deliveries must be received into Main Store; direct Pharmacy delivery is not enabled';
  END IF;

  SELECT id INTO _location_id FROM public.inventory_locations WHERE code = _location_code AND active;
  IF _location_id IS NULL THEN RAISE EXCEPTION 'Inventory location is unavailable'; END IF;

  IF _receipt_kind = 'opening_count' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.stock_movements sm
      JOIN public.inventory_locations il ON il.id = sm.location_id
      WHERE sm.movement_type = 'opening_count' AND il.id = _location_id
    ) INTO _existing_opening;
    IF _existing_opening THEN
      RAISE EXCEPTION 'Opening count has already been recorded for this location. Use an authorised adjustment for corrections.';
    END IF;
  END IF;

  INSERT INTO public.stock_receipts (receipt_kind, supplier_name, supplier_reference, received_on, location_id, note, received_by)
  VALUES (_receipt_kind, NULLIF(btrim(_supplier_name), ''), NULLIF(btrim(_supplier_reference), ''), COALESCE(_received_on, current_date), _location_id, NULLIF(btrim(_note), ''), auth.uid())
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
    IF _expiry_date < current_date THEN RAISE EXCEPTION 'Expired medicine cannot be received into active stock'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.inventory_products WHERE id = _product_id AND active) THEN
      RAISE EXCEPTION 'An item references an inactive or unknown inventory product';
    END IF;

    INSERT INTO public.inventory_batches (product_id, location_id, batch_number, expiry_date, unit_cost, quantity_on_hand)
    VALUES (_product_id, _location_id, _batch_number, _expiry_date, _unit_cost, _quantity)
    ON CONFLICT (product_id, location_id, batch_number, expiry_date) DO UPDATE
      SET quantity_on_hand = public.inventory_batches.quantity_on_hand + EXCLUDED.quantity_on_hand,
          unit_cost = EXCLUDED.unit_cost,
          status = 'active',
          updated_at = now()
    RETURNING id INTO _batch_id;

    INSERT INTO public.stock_receipt_items (receipt_id, batch_id, product_id, quantity, unit_cost)
    VALUES (_receipt_id, _batch_id, _product_id, _quantity, _unit_cost);

    INSERT INTO public.stock_movements (movement_type, product_id, batch_id, location_id, quantity_delta, unit_cost, receipt_id, performed_by, reason)
    VALUES (CASE WHEN _receipt_kind = 'opening_count' THEN 'opening_count' ELSE 'receipt' END, _product_id, _batch_id, _location_id, _quantity, _unit_cost, _receipt_id, auth.uid(), _note);
  END LOOP;

  RETURN _receipt_id;
END;
$$;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 37
CREATE OR REPLACE FUNCTION public.create_store_to_pharmacy_transfer(_items jsonb, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _transfer_id uuid;
  _from_location uuid;
  _to_location uuid;
  _row jsonb;
  _batch record;
  _quantity numeric;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['store', 'admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only Store or Admin can send stock to Pharmacy';
  END IF;
  IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Select at least one batch and quantity to transfer';
  END IF;

  SELECT id INTO _from_location FROM public.inventory_locations WHERE code = 'main_store';
  SELECT id INTO _to_location FROM public.inventory_locations WHERE code = 'pharmacy';

  INSERT INTO public.stock_transfers (from_location_id, to_location_id, note, created_by)
  VALUES (_from_location, _to_location, NULLIF(btrim(_note), ''), auth.uid())
  RETURNING id INTO _transfer_id;

  FOR _row IN SELECT value FROM jsonb_array_elements(_items)
  LOOP
    _quantity := (_row->>'quantity')::numeric;
    IF _quantity IS NULL OR _quantity <= 0 THEN RAISE EXCEPTION 'Transfer quantities must be positive'; END IF;

    SELECT b.id, b.product_id, b.unit_cost, b.quantity_on_hand
    INTO _batch
    FROM public.inventory_batches b
    WHERE b.id = (_row->>'batch_id')::uuid
      AND b.location_id = _from_location
      AND b.status = 'active'
      AND b.expiry_date >= current_date
    FOR UPDATE;

    IF _batch.id IS NULL OR _batch.quantity_on_hand < _quantity THEN
      RAISE EXCEPTION 'Insufficient available Main Store quantity for one or more selected batches';
    END IF;

    UPDATE public.inventory_batches
    SET quantity_on_hand = quantity_on_hand - _quantity, updated_at = now()
    WHERE id = _batch.id;

    INSERT INTO public.stock_transfer_items (transfer_id, source_batch_id, product_id, quantity_sent)
    VALUES (_transfer_id, _batch.id, _batch.product_id, _quantity);

    INSERT INTO public.stock_movements (movement_type, product_id, batch_id, location_id, quantity_delta, unit_cost, transfer_id, performed_by, reason)
    VALUES ('transfer_out', _batch.product_id, _batch.id, _from_location, -_quantity, _batch.unit_cost, _transfer_id, auth.uid(), _note);
  END LOOP;

  RETURN _transfer_id;
END;
$$;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 38
CREATE OR REPLACE FUNCTION public.receive_store_transfer(_transfer_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _transfer record;
  _item record;
  _source_batch record;
  _destination_batch_id uuid;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['pharmacist', 'admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only Pharmacy or Admin can confirm receipt from Store';
  END IF;

  SELECT * INTO _transfer FROM public.stock_transfers WHERE id = _transfer_id FOR UPDATE;
  IF _transfer.id IS NULL OR _transfer.status NOT IN ('sent', 'partially_received') THEN
    RAISE EXCEPTION 'This transfer is not awaiting Pharmacy confirmation';
  END IF;

  FOR _item IN
    SELECT * FROM public.stock_transfer_items
    WHERE transfer_id = _transfer_id AND quantity_received < quantity_sent
    FOR UPDATE
  LOOP
    SELECT * INTO _source_batch FROM public.inventory_batches WHERE id = _item.source_batch_id;

    INSERT INTO public.inventory_batches (product_id, location_id, batch_number, expiry_date, unit_cost, quantity_on_hand, source_batch_id)
    VALUES (_item.product_id, _transfer.to_location_id, _source_batch.batch_number, _source_batch.expiry_date, _source_batch.unit_cost, _item.quantity_sent - _item.quantity_received, _source_batch.id)
    ON CONFLICT (product_id, location_id, batch_number, expiry_date) DO UPDATE
      SET quantity_on_hand = public.inventory_batches.quantity_on_hand + EXCLUDED.quantity_on_hand,
          updated_at = now()
    RETURNING id INTO _destination_batch_id;

    UPDATE public.stock_transfer_items
    SET quantity_received = quantity_sent, destination_batch_id = _destination_batch_id
    WHERE id = _item.id;

    INSERT INTO public.stock_movements (movement_type, product_id, batch_id, location_id, quantity_delta, unit_cost, transfer_id, performed_by, reason)
    VALUES ('transfer_in', _item.product_id, _destination_batch_id, _transfer.to_location_id, _item.quantity_sent - _item.quantity_received, _source_batch.unit_cost, _transfer_id, auth.uid(), _transfer.note);
  END LOOP;

  UPDATE public.stock_transfers
  SET status = 'received', received_by = auth.uid(), received_at = now()
  WHERE id = _transfer_id;

  RETURN _transfer_id;
END;
$$;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 39
CREATE OR REPLACE FUNCTION public.dispense_inventory_invoice_item(_invoice_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _item record;
  _product_id uuid;
  _pharmacy_location uuid;
  _remaining numeric;
  _take numeric;
  _batch record;
  _movement_id uuid;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['pharmacist', 'admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only Pharmacy or Admin can dispense medicine';
  END IF;

  SELECT ii.*, i.status AS invoice_status
  INTO _item
  FROM public.invoice_items ii
  JOIN public.invoices i ON i.id = ii.invoice_id
  WHERE ii.id = _invoice_item_id
  FOR UPDATE OF ii;

  IF _item.id IS NULL THEN RAISE EXCEPTION 'Invoice item not found'; END IF;
  IF _item.invoice_status <> 'paid' THEN RAISE EXCEPTION 'Only a paid invoice item can be dispensed'; END IF;
  IF COALESCE(_item.dispensing_status, 'pending') <> 'pending' THEN RAISE EXCEPTION 'This invoice item has already been processed'; END IF;

  IF _item.pricelist_item_id IS NULL THEN
    UPDATE public.invoice_items
    SET dispensing_status = 'dispensed',
        dispensing_notes = 'Dispensed as a non-stock item; no pricelist inventory mapping exists.',
        dispensing_updated_at = now(),
        dispensing_updated_by = auth.uid()
    WHERE id = _item.id;
    RETURN jsonb_build_object('invoice_item_id', _item.id, 'stock_controlled', false, 'message', 'Dispensed without inventory deduction because no product mapping exists.');
  END IF;

  SELECT id INTO _product_id FROM public.inventory_products
  WHERE pricelist_item_id = _item.pricelist_item_id AND active;
  IF _product_id IS NULL THEN
    RAISE EXCEPTION 'This billed medicine is not mapped to active inventory. Ask Store or Accountant to map it before dispensing.';
  END IF;

  SELECT id INTO _pharmacy_location FROM public.inventory_locations WHERE code = 'pharmacy' AND active;
  _remaining := _item.quantity;

  FOR _batch IN
    SELECT * FROM public.inventory_batches
    WHERE product_id = _product_id
      AND location_id = _pharmacy_location
      AND status = 'active'
      AND expiry_date >= current_date
      AND quantity_on_hand > 0
    ORDER BY expiry_date ASC, received_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN _remaining <= 0;
    _take := LEAST(_remaining, _batch.quantity_on_hand);

    UPDATE public.inventory_batches
    SET quantity_on_hand = quantity_on_hand - _take, updated_at = now()
    WHERE id = _batch.id;

    INSERT INTO public.stock_movements (movement_type, product_id, batch_id, location_id, quantity_delta, unit_cost, invoice_item_id, performed_by, reason)
    VALUES ('dispensed', _product_id, _batch.id, _pharmacy_location, -_take, _batch.unit_cost, _item.id, auth.uid(), 'Patient dispensing')
    RETURNING id INTO _movement_id;

    INSERT INTO public.dispense_stock_allocations (invoice_item_id, stock_movement_id, batch_id, quantity, dispensed_by)
    VALUES (_item.id, _movement_id, _batch.id, _take, auth.uid());

    _remaining := _remaining - _take;
  END LOOP;

  IF _remaining > 0 THEN
    RAISE EXCEPTION 'Insufficient Pharmacy stock to dispense this item';
  END IF;

  UPDATE public.invoice_items
  SET dispensing_status = 'dispensed',
      dispensing_notes = NULL,
      dispensing_updated_at = now(),
      dispensing_updated_by = auth.uid()
  WHERE id = _item.id;

  RETURN jsonb_build_object('invoice_item_id', _item.id, 'stock_controlled', true, 'message', 'Dispensed and deducted from Pharmacy stock.');
END;
$$;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 40
CREATE OR REPLACE FUNCTION public.get_inventory_catalog()
RETURNS TABLE (
  product_id uuid,
  pricelist_item_id uuid,
  medicine_name text,
  category text,
  size text,
  sale_price numeric,
  sku text,
  unit_label text,
  minimum_level numeric,
  active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ip.id, p.id, p.name, p.category, p.size, p.price, ip.sku, ip.unit_label, ip.minimum_level, ip.active
  FROM public.inventory_products ip
  JOIN public.pricelist p ON p.id = ip.pricelist_item_id
  WHERE public.has_any_role(auth.uid(), ARRAY['store', 'pharmacist', 'accountant', 'admin']::app_role[])
  ORDER BY p.name;
$$;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 41
CREATE OR REPLACE FUNCTION public.get_pharmacy_stock()
RETURNS TABLE (
  product_id uuid,
  medicine_name text,
  size text,
  unit_label text,
  quantity_on_hand numeric,
  minimum_level numeric,
  next_expiry date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ip.id, p.name, p.size, ip.unit_label,
         COALESCE(SUM(b.quantity_on_hand) FILTER (WHERE b.status = 'active' AND b.expiry_date >= current_date), 0),
         ip.minimum_level,
         MIN(b.expiry_date) FILTER (WHERE b.status = 'active' AND b.quantity_on_hand > 0)
  FROM public.inventory_products ip
  JOIN public.pricelist p ON p.id = ip.pricelist_item_id
  LEFT JOIN public.inventory_locations l ON l.code = 'pharmacy'
  LEFT JOIN public.inventory_batches b ON b.product_id = ip.id AND b.location_id = l.id
  WHERE ip.active
    AND public.has_any_role(auth.uid(), ARRAY['store', 'pharmacist', 'accountant', 'admin']::app_role[])
  GROUP BY ip.id, p.name, p.size, ip.unit_label, ip.minimum_level
  ORDER BY p.name;
$$;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 42
GRANT EXECUTE ON FUNCTION public.create_inventory_product(uuid, text, text, numeric) TO authenticated;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 43
GRANT EXECUTE ON FUNCTION public.record_inventory_receipt(text, text, jsonb, text, text, text, date) TO authenticated;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 44
GRANT EXECUTE ON FUNCTION public.create_store_to_pharmacy_transfer(jsonb, text) TO authenticated;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 45
GRANT EXECUTE ON FUNCTION public.receive_store_transfer(uuid) TO authenticated;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 46
GRANT EXECUTE ON FUNCTION public.dispense_inventory_invoice_item(uuid) TO authenticated;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 47
GRANT EXECUTE ON FUNCTION public.get_inventory_catalog() TO authenticated;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 48
GRANT EXECUTE ON FUNCTION public.get_pharmacy_stock() TO authenticated;

-- SOURCE: 20260814195000_prevent_duplicate_typed_lab_requests.sql statement 1
WITH ranked_active AS (
  SELECT
    lr.id,
    row_number() OVER (
      PARTITION BY lr.patient_id, COALESCE(lr.visit_id, '00000000-0000-0000-0000-000000000000'::uuid)
      ORDER BY
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM public.snap_orders so
            WHERE so.order_type = 'lab'
              AND so.ocr_text = 'LINKED_LAB_REQUEST:' || lr.id::text
              AND so.status IN ('paid', 'fulfilled')
          ) THEN 0
          WHEN EXISTS (
            SELECT 1
            FROM public.snap_orders so
            WHERE so.order_type = 'lab'
              AND so.ocr_text = 'LINKED_LAB_REQUEST:' || lr.id::text
              AND so.status = 'awaiting_payment'
          ) THEN 1
          ELSE 2
        END,
        lr.requested_at DESC,
        lr.id DESC
    ) AS duplicate_rank
  FROM public.lab_requests lr
  WHERE lr.status IN ('pending', 'in_progress')
)
UPDATE public.lab_requests lr
SET
  status = 'cancelled',
  results = COALESCE(lr.results, '{}'::jsonb) || jsonb_build_object(
    'system_note', 'Cancelled automatically as a duplicate active lab request.',
    'cancelled_at', now()
  )
FROM ranked_active ra
WHERE ra.id = lr.id
  AND ra.duplicate_rank > 1;

-- SOURCE: 20260814195000_prevent_duplicate_typed_lab_requests.sql statement 2
UPDATE public.snap_orders so
SET
  status = 'cancelled',
  rejection_reason = COALESCE(so.rejection_reason, 'Duplicate lab request cancelled automatically.'),
  updated_at = now()
WHERE so.order_type = 'lab'
  AND so.status IN ('pending_billing', 'awaiting_payment')
  AND so.ocr_text LIKE 'LINKED_LAB_REQUEST:%'
  AND EXISTS (
    SELECT 1
    FROM public.lab_requests lr
    WHERE lr.id::text = substring(so.ocr_text FROM length('LINKED_LAB_REQUEST:') + 1)
      AND lr.status = 'cancelled'
      AND lr.results ->> 'system_note' = 'Cancelled automatically as a duplicate active lab request.'
  );

-- SOURCE: 20260814195000_prevent_duplicate_typed_lab_requests.sql statement 3
CREATE UNIQUE INDEX IF NOT EXISTS lab_requests_one_active_per_patient_visit_idx
  ON public.lab_requests (
    patient_id,
    COALESCE(visit_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status IN ('pending', 'in_progress');

-- SOURCE: 20260814195000_prevent_duplicate_typed_lab_requests.sql statement 4
CREATE OR REPLACE FUNCTION public.create_lab_request_from_typed(
  _patient_id uuid,
  _visit_id uuid,
  _diagnosis text,
  _tests text[]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lab_id uuid;
  v_req_num text;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT public.has_any_role(v_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Unauthorized role';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = _patient_id) THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;

  IF _visit_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.visits WHERE id = _visit_id AND patient_id = _patient_id) THEN
      RAISE EXCEPTION 'Invalid visit for patient';
    END IF;
  END IF;

  IF _tests IS NULL OR array_length(_tests, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one test is required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.lab_requests
    WHERE patient_id = _patient_id
      AND visit_id IS NOT DISTINCT FROM _visit_id
      AND status IN ('pending', 'in_progress')
  ) THEN
    RAISE EXCEPTION 'An active lab request already exists for this patient and visit. Use the existing request instead of submitting again.';
  END IF;

  v_req_num := 'LAB-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('public.lab_requests_number_seq')::text, 4, '0');

  INSERT INTO public.lab_requests
    (patient_id, visit_id, tests, diagnosis, status, requested_by, requested_at, printed, request_number)
  VALUES (
    _patient_id, _visit_id, _tests, _diagnosis,
    'pending', v_uid::text, now(), false, v_req_num
  )
  RETURNING id INTO v_lab_id;

  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;

  INSERT INTO public.snap_orders (
    patient_id,
    visit_id,
    order_type,
    target_station,
    source_role,
    status,
    created_by,
    original_sender_role,
    intent,
    note,
    ocr_text
  ) VALUES (
    _patient_id,
    _visit_id,
    'lab',
    'lab',
    COALESCE(v_role, 'doctor'),
    'pending_billing',
    v_uid,
    COALESCE(v_role, 'doctor'),
    'typed_order',
    'Typed Lab Order: ' || array_to_string(_tests, ', '),
    'LINKED_LAB_REQUEST:' || v_lab_id::text
  );

  -- Move the patient out of the Nurse queue in the same transaction as the request.
  UPDATE public.patients
  SET status = 'awaiting_billing'
  WHERE id = _patient_id
    AND status != 'admitted';

  PERFORM public.write_audit_log(
    'create_typed_lab_request',
    'lab_requests',
    v_lab_id::text,
    jsonb_build_object('patient_id', _patient_id),
    'success'
  );

  RETURN v_lab_id;
END;
$$;

-- SOURCE: 20260814195000_prevent_duplicate_typed_lab_requests.sql statement 5
GRANT EXECUTE ON FUNCTION public.create_lab_request_from_typed(uuid, uuid, text, text[]) TO authenticated;

-- SOURCE: 20260814202000_fix_settle_invoice_atomic_overload.sql statement 1
DROP FUNCTION IF EXISTS public.settle_invoice_atomic(
  uuid,
  numeric,
  numeric,
  numeric,
  text,
  text,
  boolean
);

-- SOURCE: 20260814202000_fix_settle_invoice_atomic_overload.sql statement 2
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

-- SOURCE: 20260814210000_add_typed_lab_result.sql statement 1
ALTER TABLE public.snap_orders
  ADD COLUMN IF NOT EXISTS result_text text;

-- SOURCE: 20260814210000_add_typed_lab_result.sql statement 2
COMMENT ON COLUMN public.snap_orders.result_text IS
  'Typed laboratory result returned to the requesting clinical station; optional when photo_path is used.';

-- SOURCE: 20260814210000_add_typed_lab_result.sql statement 3
CREATE INDEX IF NOT EXISTS idx_snap_orders_lab_result_text
  ON public.snap_orders (patient_id, order_type, created_at DESC)
  WHERE order_type = 'lab_result' AND result_text IS NOT NULL;

-- SOURCE: 20260814210000_add_typed_lab_result.sql statement 4
NOTIFY pgrst, 'reload schema';

-- SOURCE: 20260815160000_harden_treatment_forwarding.sql statement 1
CREATE OR REPLACE FUNCTION public.forward_snap_to_billing(
  _source_snap_id uuid,
  _target_station text,
  _note text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _src public.snap_orders%ROWTYPE;
  _new uuid;
  _role text;
  _order_type text;
BEGIN
  IF NOT public.has_any_role(_uid, ARRAY['nurse','doctor','doctor1','doctor2','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _target_station NOT IN ('pharmacy','lab') THEN
    RAISE EXCEPTION 'Target must be pharmacy or lab';
  END IF;

  SELECT * INTO _src
  FROM public.snap_orders
  WHERE id = _source_snap_id
  FOR UPDATE;

  IF _src.id IS NULL THEN
    RAISE EXCEPTION 'Source snap not found';
  END IF;

  -- A Nurse treatment-review row is single-use. Once acknowledged or
  -- fulfilled, a repeated click must not create another downstream order.
  IF _src.target_station IN ('nurse','doctor')
     AND _src.status <> 'pending_billing' THEN
    RAISE EXCEPTION 'SOURCE_SNAP_ALREADY_FORWARDED: this treatment has already been forwarded';
  END IF;

  -- Admission-order snaps are also single-use.
  IF _src.intent = 'admission_order' THEN
    IF _src.ack_at IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.snap_orders c WHERE c.parent_snap_id = _src.id) THEN
      RAISE EXCEPTION 'ADMISSION_SNAP_ALREADY_USED: this admission snap has already been used. Take a new snap.';
    END IF;
  END IF;

  _order_type := CASE _target_station WHEN 'lab' THEN 'lab' ELSE 'prescription' END;
  SELECT role::text INTO _role
  FROM public.user_roles
  WHERE user_id = _uid
  LIMIT 1;

  INSERT INTO public.snap_orders (
    patient_id, visit_id, order_type, target_station, source_role,
    photo_path, note, status, created_by, original_sender_role,
    parent_snap_id, matched_items, ocr_text, ocr_confidence
  ) VALUES (
    _src.patient_id, _src.visit_id, _order_type, _target_station,
    COALESCE(_role, _src.source_role),
    _src.photo_path,
    COALESCE(_note, 'Forwarded from treatment review'),
    'pending_billing', _uid, COALESCE(_role, _src.source_role),
    _src.id, COALESCE(_src.matched_items, '[]'::jsonb),
    _src.ocr_text, _src.ocr_confidence
  ) RETURNING id INTO _new;

  -- Consume every station-review source row after its child is created. This
  -- is intentionally in the same transaction as the insert above.
  UPDATE public.snap_orders
     SET status = 'acknowledged',
         ack_by = _uid,
         ack_at = now(),
         updated_at = now()
   WHERE id = _src.id
     AND status = 'pending_billing';

  PERFORM public.write_audit_log(
    'snap_forwarded_to_billing', 'snap_order', _new::text,
    jsonb_build_object(
      'source_snap_id', _src.id,
      'patient_id', _src.patient_id,
      'target_station', _target_station
    )
  );

  RETURN _new;
END
$function$;

-- SOURCE: 20260815160000_harden_treatment_forwarding.sql statement 2
REVOKE ALL ON FUNCTION public.forward_snap_to_billing(uuid, text, text) FROM PUBLIC, anon;

-- SOURCE: 20260815160000_harden_treatment_forwarding.sql statement 3
GRANT EXECUTE ON FUNCTION public.forward_snap_to_billing(uuid, text, text) TO authenticated, service_role;

-- SOURCE: 20260815160000_harden_treatment_forwarding.sql statement 4
COMMENT ON FUNCTION public.forward_snap_to_billing(uuid, text, text)
IS 'Creates one downstream billing snap and atomically consumes the source treatment-review snap.';

-- SOURCE: 20260815160000_harden_treatment_forwarding.sql statement 5
NOTIFY pgrst, 'reload schema';

-- SOURCE: 20260815173500_harden_discharge_archive_consistency.sql statement 1
CREATE OR REPLACE FUNCTION public.patient_pending_workflow_station(_patient_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.snap_orders so
      WHERE so.patient_id = _patient_id AND so.status = 'pending_billing'
    ) THEN 'awaiting_billing'
    WHEN EXISTS (
      SELECT 1 FROM public.snap_orders so
      WHERE so.patient_id = _patient_id AND so.status = 'awaiting_payment'
    ) THEN 'awaiting_payment'
    WHEN EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.patient_id = _patient_id AND i.status IN ('pending', 'partial')
    ) THEN 'awaiting_payment'
    WHEN EXISTS (
      SELECT 1 FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.target_station = 'lab'
        AND so.status = 'paid'
    ) THEN 'in_lab'
    WHEN EXISTS (
      SELECT 1 FROM public.lab_requests lr
      WHERE lr.patient_id = _patient_id AND lr.status = 'pending'
    ) THEN 'in_lab'
    WHEN EXISTS (
      SELECT 1 FROM public.snap_orders so
      WHERE so.patient_id = _patient_id
        AND so.target_station = 'pharmacy'
        AND so.status = 'paid'
    ) THEN 'at_pharmacy'
    WHEN EXISTS (
      SELECT 1 FROM public.prescriptions pr
      WHERE pr.patient_id = _patient_id AND pr.status = 'pending'
    ) THEN 'at_pharmacy'
    ELSE NULL
  END;
$$;

-- SOURCE: 20260815173500_harden_discharge_archive_consistency.sql statement 2
REVOKE EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) FROM PUBLIC, anon;

-- SOURCE: 20260815173500_harden_discharge_archive_consistency.sql statement 3
GRANT EXECUTE ON FUNCTION public.patient_pending_workflow_station(uuid) TO authenticated, service_role;

-- SOURCE: 20260815173500_harden_discharge_archive_consistency.sql statement 4
CREATE OR REPLACE FUNCTION public.discharge_admission(
  _admission_id uuid,
  _notes text DEFAULT NULL::text,
  _settlement_method text DEFAULT NULL::text,
  _settlement_amount numeric DEFAULT 0,
  _settlement_notes text DEFAULT NULL::text,
  _refund_amount numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _adm RECORD;
  _p RECORD;
  _wallet boolean;
  _debt numeric;
  _collected numeric := 0;
  _remaining numeric := 0;
  _inv RECORD;
  _apply numeric;
  _left numeric;
  _pct numeric;
  _share numeric;
  _wallet_used numeric := 0;
  _refund numeric := 0;
  _credit numeric := 0;
  _debt_cleared numeric := 0;
  _got_lock boolean;
  _journey public.patient_journey%ROWTYPE;
  _journey_id uuid;
BEGIN
  IF NOT public.has_any_role(
    auth.uid(),
    ARRAY['cashier','billing','accountant','admin']::app_role[]
  ) THEN
    RAISE EXCEPTION 'Only the cashier can settle and complete a discharge';
  END IF;

  _got_lock := pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('discharge_admission:' || _admission_id::text, 0)
  );
  IF NOT _got_lock THEN
    RAISE EXCEPTION 'DISCHARGE_IN_PROGRESS: this discharge is already being settled — refresh the queue';
  END IF;

  SELECT * INTO _adm
  FROM public.admissions
  WHERE id = _admission_id
  FOR UPDATE;

  IF _adm IS NULL THEN
    RAISE EXCEPTION 'Admission not found';
  END IF;
  IF _adm.status = 'discharged' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was already settled and discharged on %',
      COALESCE(to_char(_adm.discharged_at, 'DD Mon YYYY HH24:MI'), 'an earlier date');
  END IF;
  IF _adm.status = 'cancelled' THEN
    RAISE EXCEPTION 'ADMISSION_CANCELLED: this admission was cancelled and cannot be settled';
  END IF;
  IF _adm.status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'NOT_IN_CASHIER_QUEUE: the ward has not confirmed this discharge yet (%)', _adm.status;
  END IF;

  PERFORM public.bill_admission_bed_days(_admission_id);
  _wallet_used := public.apply_wallet_to_outstanding(
    _adm.patient_id,
    'Balance applied at discharge'
  );

  SELECT * INTO _p
  FROM public.patients
  WHERE id = _adm.patient_id
  FOR UPDATE;

  _wallet := public.has_wallet(_p.account_type);
  _pct := public.copay_percent(_p.account_type, _p.insurance_plan);
  _debt := public.patient_outstanding(_adm.patient_id);
  _remaining := _debt;

  IF _debt > 0 THEN
    IF _settlement_method IS NULL THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRED: patient owes % - pass _settlement_method', _debt;
    END IF;

    IF _settlement_method IN ('cash', 'pos', 'transfer') THEN
      _collected := ROUND(GREATEST(COALESCE(_settlement_amount, 0), 0), 2);
      IF _collected <= 0 THEN
        RAISE EXCEPTION 'Settlement amount must be greater than zero';
      END IF;
      IF _wallet AND _p.balance < 0 THEN
        _debt_cleared := ROUND(LEAST(_collected, -_p.balance), 2);
        PERFORM public.adjust_patient_balance(
          _adm.patient_id,
          _debt_cleared,
          'debt_cleared',
          _settlement_method,
          NULL,
          NULL,
          COALESCE(_settlement_notes, 'Discharge settlement')
        );
      END IF;
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
      IF _remaining > 0 THEN
        PERFORM public.write_audit_log(
          'discharge_partial_settlement',
          'admission',
          _admission_id::text,
          jsonb_build_object(
            'patient_id', _adm.patient_id,
            'debt', _debt,
            'collected', _collected,
            'outstanding', _remaining,
            'method', _settlement_method,
            'notes', _settlement_notes
          )
        );
      END IF;
    ELSIF _settlement_method = 'salary' THEN
      IF _p.staff_link_id IS NULL THEN
        RAISE EXCEPTION 'STAFF_LINK_REQUIRED: this patient is not linked to any staff member for salary deduction';
      END IF;
      _remaining := 0;
      PERFORM public.write_audit_log(
        'salary_deduction_on_discharge',
        'admission',
        _admission_id::text,
        jsonb_build_object(
          'patient_id', _adm.patient_id,
          'debt', _debt,
          'staff_id', _p.staff_link_id,
          'notes', _settlement_notes
        )
      );
    ELSIF _settlement_method = 'carry' THEN
      PERFORM public.write_audit_log(
        'debt_carried_on_discharge',
        'admission',
        _admission_id::text,
        jsonb_build_object(
          'patient_id', _adm.patient_id,
          'debt', _debt,
          'notes', _settlement_notes
        )
      );
    ELSE
      RAISE EXCEPTION 'Unknown settlement method %', _settlement_method;
    END IF;
  END IF;

  _left := CASE
    WHEN _settlement_method IN ('cash', 'pos', 'transfer')
      THEN ROUND(GREATEST(0, _collected - _debt_cleared), 2)
    WHEN _settlement_method = 'salary' THEN _debt
    ELSE 0
  END;

  IF _left > 0 THEN
    FOR _inv IN
      SELECT id, total_amount, COALESCE(paid_amount, 0) AS paid
      FROM public.invoices
      WHERE patient_id = _adm.patient_id
        AND status IN ('pending', 'partial')
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN _left <= 0;
      _share := ROUND(_inv.total_amount * _pct / 100.0, 2);
      _apply := ROUND(LEAST(_left, GREATEST(0, _share - _inv.paid)), 2);
      CONTINUE WHEN _apply <= 0;

      UPDATE public.invoices
      SET paid_amount = _inv.paid + _apply,
          status = CASE
            WHEN _inv.paid + _apply >= _share THEN 'paid'
            ELSE 'partial'
          END,
          paid_at = CASE
            WHEN _inv.paid + _apply >= _share THEN now()
            ELSE paid_at
          END,
          payment_method = COALESCE(payment_method, _settlement_method),
          is_salary_deduction = CASE
            WHEN _settlement_method = 'salary' THEN true
            ELSE is_salary_deduction
          END,
          staff_sponsor_id = CASE
            WHEN _settlement_method = 'salary' THEN _p.staff_link_id
            ELSE staff_sponsor_id
          END,
          updated_at = now()
      WHERE id = _inv.id;

      _left := ROUND(_left - _apply, 2);
    END LOOP;
  END IF;

  IF _wallet AND _left > 0 AND _settlement_method IN ('cash', 'pos', 'transfer') THEN
    PERFORM public.adjust_patient_balance(
      _adm.patient_id,
      _left,
      'topup',
      _settlement_method,
      NULL,
      NULL,
      'Change from discharge settlement left on balance'
    );
    _credit := _left;
  END IF;

  _refund := ROUND(GREATEST(COALESCE(_refund_amount, 0), 0), 2);
  IF _refund > 0 THEN
    IF NOT _wallet THEN
      RAISE EXCEPTION 'Sponsored accounts have no wallet to refund from';
    END IF;
    SELECT * INTO _p
    FROM public.patients
    WHERE id = _adm.patient_id
    FOR UPDATE;
    IF _refund > _p.balance THEN
      RAISE EXCEPTION 'Refund % exceeds available balance %', _refund, _p.balance;
    END IF;
    PERFORM public.adjust_patient_balance(
      _adm.patient_id,
      -_refund,
      'refund',
      _settlement_method,
      NULL,
      NULL,
      'Change paid out at discharge'
    );
  END IF;

  UPDATE public.admissions
  SET status = 'discharged',
      discharged_at = now(),
      discharged_by = auth.uid(),
      discharge_notes = COALESCE(_notes, discharge_notes),
      updated_at = now()
  WHERE id = _admission_id
    AND status = 'ready_for_discharge';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was settled by someone else — refresh the queue';
  END IF;

  -- A discharge is not complete until the visit that created the admission is
  -- closed. This prevents a discharged patient from being blocked in Archive
  -- by a stale open visit.
  UPDATE public.visits
  SET status = 'settled',
      closed_at = COALESCE(closed_at, now()),
      closed_by = COALESCE(closed_by, auth.uid()),
      updated_at = now()
  WHERE id = _adm.visit_id
    AND status <> 'settled';

  IF _adm.bed_id IS NOT NULL THEN
    UPDATE public.beds
    SET status = 'available', updated_at = now()
    WHERE id = _adm.bed_id;
  END IF;

  -- An inpatient cashier settlement is the authoritative terminal event for
  -- this admission. It writes the journey and its audit record directly so the
  -- new admission invoice cannot be misclassified as pending outpatient work.
  SELECT * INTO _journey
  FROM public.patient_journey
  WHERE patient_id = _adm.patient_id
  FOR UPDATE;

  IF _journey.id IS NULL THEN
    INSERT INTO public.patient_journey (
      patient_id, visit_id, current_state, owner_role, owner_user_id
    ) VALUES (
      _adm.patient_id, _adm.visit_id, 'discharged', 'reception', NULL
    )
    RETURNING id INTO _journey_id;

    INSERT INTO public.patient_journey_history (
      journey_id, patient_id, visit_id, from_state, to_state,
      from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
      reason
    ) VALUES (
      _journey_id, _adm.patient_id, _adm.visit_id, NULL, 'discharged',
      NULL, 'reception', NULL, NULL,
      'Inpatient cashier settlement completed'
    );
  ELSE
    UPDATE public.patient_journey
    SET visit_id = COALESCE(_adm.visit_id, _journey.visit_id),
        current_state = 'discharged',
        owner_role = 'reception',
        owner_user_id = NULL,
        updated_at = now()
    WHERE id = _journey.id;

    INSERT INTO public.patient_journey_history (
      journey_id, patient_id, visit_id, from_state, to_state,
      from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
      reason
    ) VALUES (
      _journey.id, _adm.patient_id, COALESCE(_adm.visit_id, _journey.visit_id),
      _journey.current_state, 'discharged',
      _journey.owner_role, 'reception', _journey.owner_user_id, NULL,
      'Inpatient cashier settlement completed'
    );
  END IF;

  UPDATE public.patients
  SET status = 'discharged',
      updated_at = now()
  WHERE id = _adm.patient_id;

  PERFORM public.write_audit_log(
    'admission_discharged',
    'admission',
    _admission_id::text,
    jsonb_build_object(
      'patient_id', _adm.patient_id,
      'notes', _notes,
      'debt', _debt,
      'wallet_applied', _wallet_used,
      'collected', _collected,
      'debt_cleared', _debt_cleared,
      'outstanding', _remaining,
      'credit_left', _credit,
      'refunded', _refund,
      'method', _settlement_method
    )
  );

  RETURN jsonb_build_object(
    'debt', _debt,
    'wallet_applied', _wallet_used,
    'collected', _collected,
    'outstanding', _remaining,
    'credit_left', _credit,
    'refunded', _refund
  );
END;
$function$;

-- SOURCE: 20260815173500_harden_discharge_archive_consistency.sql statement 5
WITH candidates AS (
  SELECT
    j.id AS journey_id,
    j.patient_id,
    j.visit_id,
    j.current_state AS from_state,
    j.owner_role AS from_owner_role,
    j.owner_user_id AS from_owner_user_id
  FROM public.patient_journey j
  JOIN public.patients p ON p.id = j.patient_id
  WHERE p.status = 'admitted'
    AND j.current_state = 'admitted'
    AND EXISTS (
      SELECT 1
      FROM public.admissions a
      WHERE a.patient_id = p.id
        AND a.status = 'discharged'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.admissions a
      WHERE a.patient_id = p.id
        AND a.status IN ('waiting_assignment', 'active', 'ready_for_discharge')
    )
), updated_journeys AS (
  UPDATE public.patient_journey j
  SET current_state = 'discharged',
      owner_role = 'reception',
      owner_user_id = NULL,
      updated_at = now()
  FROM candidates c
  WHERE j.id = c.journey_id
  RETURNING j.id, c.patient_id, c.visit_id, c.from_state, c.from_owner_role, c.from_owner_user_id
), history_written AS (
  INSERT INTO public.patient_journey_history (
    journey_id,
    patient_id,
    visit_id,
    from_state,
    to_state,
    from_owner_role,
    to_owner_role,
    from_owner_user_id,
    to_owner_user_id,
    reason
  )
  SELECT
    id,
    patient_id,
    visit_id,
    from_state,
    'discharged',
    from_owner_role,
    'reception',
    from_owner_user_id,
    NULL,
    'Repair: previously settled inpatient was left in admitted workflow state'
  FROM updated_journeys
  RETURNING patient_id
)
UPDATE public.patients p
SET status = 'discharged',
    updated_at = now()
FROM history_written h
WHERE p.id = h.patient_id;

-- SOURCE: 20260815173500_harden_discharge_archive_consistency.sql statement 6
REVOKE EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text, numeric) FROM PUBLIC, anon;

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
  IF NEW.status = 'discharged' AND (OLD.status IS NULL OR OLD.status <> 'discharged') THEN
    
    -- 1. Check for pending workflow stations (Labs, Pharmacy, Billing)
    -- This uses the hardened function that checks snap_orders, lab_requests, and prescriptions.
    _pending_station := public.patient_pending_workflow_station(NEW.id);
    IF _pending_station IS NOT NULL THEN
      RAISE EXCEPTION 'CANNOT_DISCHARGE: patient has pending workflow at %', _pending_station;
    END IF;

    -- 2. Check for open visits
    SELECT id INTO _open_visit_id
    FROM public.visits
    WHERE patient_id = NEW.id AND status = 'open'
    LIMIT 1;
    IF _open_visit_id IS NOT NULL THEN
      RAISE EXCEPTION 'CANNOT_DISCHARGE: patient has an open visit (ID: %)', _open_visit_id;
    END IF;

    -- 3. Check for active admissions
    SELECT id INTO _active_adm_id
    FROM public.admissions
    WHERE patient_id = NEW.id
      AND status IN ('waiting_assignment', 'active', 'ready_for_discharge')
    LIMIT 1;
    IF _active_adm_id IS NOT NULL THEN
      RAISE EXCEPTION 'CANNOT_DISCHARGE: patient has an active admission (ID: %)', _active_adm_id;
    END IF;

    -- 4. Check for unpaid invoices
    SELECT id INTO _pending_inv_id
    FROM public.invoices
    WHERE patient_id = NEW.id AND status IN ('pending', 'partial')
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
  IF NEW.current_state = 'discharged' AND (OLD.current_state IS NULL OR OLD.current_state <> 'discharged') THEN
    -- We can just call the patient check logic or rely on the fact that 
    -- advance_journey updates both. However, a direct update to patient_journey
    -- should also be guarded.
    IF EXISTS (
      SELECT 1 FROM public.visits WHERE patient_id = NEW.patient_id AND status = 'open'
    ) OR EXISTS (
      SELECT 1 FROM public.admissions WHERE patient_id = NEW.patient_id AND status IN ('waiting_assignment', 'active', 'ready_for_discharge')
    ) OR public.patient_pending_workflow_station(NEW.patient_id) IS NOT NULL THEN
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
SET search_path = public
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
SET search_path = public
AS $$
DECLARE
  v_photo_path text;
BEGIN
  SELECT NULLIF(btrim(p.photo_path), '')
  INTO v_photo_path
  FROM public.patients p
  WHERE p.id = NEW.patient_id;

  IF v_photo_path IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM jsonb_array_elements(COALESCE(NEW.attachment_paths, '[]'::jsonb)) item
       WHERE item ->> 'bucket' = 'patient-photos'
         AND item ->> 'path' = v_photo_path
     ) THEN
    NEW.attachment_paths := COALESCE(NEW.attachment_paths, '[]'::jsonb)
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
