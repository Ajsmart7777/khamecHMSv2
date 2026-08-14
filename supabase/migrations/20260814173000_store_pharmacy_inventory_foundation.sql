-- Khamec HMS Store and Pharmacy Inventory Foundation
-- Replaces the deliberately removed legacy inventory tables with a batch-aware,
-- append-only inventory ledger for Main Store -> Pharmacy -> Patient.

CREATE TABLE public.inventory_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code IN ('main_store', 'pharmacy')),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.inventory_locations (code, name)
VALUES ('main_store', 'Main Store'), ('pharmacy', 'Pharmacy')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

CREATE TABLE public.inventory_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pricelist_item_id uuid NOT NULL UNIQUE REFERENCES public.pricelist(id) ON DELETE RESTRICT,
  sku text NOT NULL UNIQUE,
  unit_label text NOT NULL DEFAULT 'unit',
  minimum_level numeric(14,3) NOT NULL DEFAULT 0 CHECK (minimum_level >= 0),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.inventory_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.inventory_products(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  batch_number text NOT NULL,
  expiry_date date NOT NULL,
  unit_cost numeric(14,2) NOT NULL CHECK (unit_cost >= 0),
  quantity_on_hand numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'quarantined', 'expired')),
  source_batch_id uuid REFERENCES public.inventory_batches(id) ON DELETE SET NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_batches_location_product_batch_expiry_key UNIQUE (product_id, location_id, batch_number, expiry_date)
);

CREATE TABLE public.stock_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_kind text NOT NULL CHECK (receipt_kind IN ('opening_count', 'supplier_delivery')),
  supplier_name text,
  supplier_reference text,
  received_on date NOT NULL DEFAULT current_date,
  location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  note text,
  received_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.stock_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.stock_receipts(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES public.inventory_batches(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.inventory_products(id) ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(14,2) NOT NULL CHECK (unit_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  to_location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'partially_received', 'received', 'cancelled')),
  note text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  received_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_location_id <> to_location_id)
);

CREATE TABLE public.stock_transfer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES public.stock_transfers(id) ON DELETE RESTRICT,
  source_batch_id uuid NOT NULL REFERENCES public.inventory_batches(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.inventory_products(id) ON DELETE RESTRICT,
  quantity_sent numeric(14,3) NOT NULL CHECK (quantity_sent > 0),
  quantity_received numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity_received >= 0 AND quantity_received <= quantity_sent),
  destination_batch_id uuid REFERENCES public.inventory_batches(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transfer_id, source_batch_id)
);

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
  performed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (movement_type IN ('opening_count', 'receipt') AND receipt_id IS NOT NULL)
    OR (movement_type IN ('transfer_out', 'transfer_in', 'return_to_store') AND transfer_id IS NOT NULL)
    OR movement_type IN ('dispensed', 'damage', 'expiry', 'adjustment')
  )
);

CREATE TABLE public.dispense_stock_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_item_id uuid NOT NULL REFERENCES public.invoice_items(id) ON DELETE RESTRICT,
  stock_movement_id uuid NOT NULL UNIQUE REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES public.inventory_batches(id) ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  dispensed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  dispensed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS pricelist_item_id uuid REFERENCES public.pricelist(id) ON DELETE SET NULL;

CREATE INDEX inventory_batches_stock_lookup_idx ON public.inventory_batches (location_id, product_id, status, expiry_date, quantity_on_hand);
CREATE INDEX stock_movements_product_date_idx ON public.stock_movements (product_id, created_at DESC);
CREATE INDEX stock_movements_invoice_item_idx ON public.stock_movements (invoice_item_id) WHERE invoice_item_id IS NOT NULL;
CREATE INDEX stock_transfer_items_transfer_idx ON public.stock_transfer_items (transfer_id);
CREATE INDEX invoice_items_pricelist_item_idx ON public.invoice_items (pricelist_item_id) WHERE pricelist_item_id IS NOT NULL;

ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispense_stock_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Inventory locations visible to authorised inventory staff" ON public.inventory_locations
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store', 'pharmacist', 'accountant', 'admin']::public.app_role[]));

CREATE POLICY "Inventory products visible to authorised inventory staff" ON public.inventory_products
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store', 'pharmacist', 'accountant', 'admin']::public.app_role[]));

CREATE POLICY "Inventory batches visible to Store, Accountant and Admin" ON public.inventory_batches
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store', 'accountant', 'admin']::public.app_role[]));

CREATE POLICY "Inventory receipt records visible to Store, Accountant and Admin" ON public.stock_receipts
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store', 'accountant', 'admin']::public.app_role[]));

CREATE POLICY "Inventory receipt lines visible to Store, Accountant and Admin" ON public.stock_receipt_items
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store', 'accountant', 'admin']::public.app_role[]));

CREATE POLICY "Inventory transfers visible to Store, Pharmacy, Accountant and Admin" ON public.stock_transfers
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store', 'pharmacist', 'accountant', 'admin']::public.app_role[]));

CREATE POLICY "Inventory transfer lines visible to Store, Pharmacy, Accountant and Admin" ON public.stock_transfer_items
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store', 'pharmacist', 'accountant', 'admin']::public.app_role[]));

CREATE POLICY "Inventory movements visible to Store, Accountant and Admin" ON public.stock_movements
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store', 'accountant', 'admin']::public.app_role[]));

CREATE POLICY "Dispense allocations visible to Pharmacy, Store, Accountant and Admin" ON public.dispense_stock_allocations
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store', 'pharmacist', 'accountant', 'admin']::public.app_role[]));

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

GRANT EXECUTE ON FUNCTION public.create_inventory_product(uuid, text, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_inventory_receipt(text, text, jsonb, text, text, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_store_to_pharmacy_transfer(jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_store_transfer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dispense_inventory_invoice_item(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_inventory_catalog() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pharmacy_stock() TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_batches;
ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_transfers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_transfer_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_movements;
