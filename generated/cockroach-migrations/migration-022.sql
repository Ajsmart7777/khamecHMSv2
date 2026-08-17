-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 7
CREATE TABLE public.stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  to_location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'partially_received', 'received', 'cancelled')),
  note text,
  created_by uuid NOT NULL REFERENCES public.auth_users(id) ON DELETE RESTRICT,
  received_by uuid REFERENCES public.auth_users(id) ON DELETE SET NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_location_id <> to_location_id)
);

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 8
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
  performed_by uuid NOT NULL REFERENCES public.auth_users(id) ON DELETE RESTRICT,
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
  dispensed_by uuid NOT NULL REFERENCES public.auth_users(id) ON DELETE RESTRICT,
  dispensed_at timestamptz NOT NULL DEFAULT now()
);

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 11
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS pricelist_item_id uuid REFERENCES public.pricelist(id) ON DELETE SET NULL;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 12
CREATE INDEX IF NOT EXISTS inventory_batches_stock_lookup_idx ON public.inventory_batches (location_id, product_id, status, expiry_date, quantity_on_hand);

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 13
CREATE INDEX IF NOT EXISTS stock_movements_product_date_idx ON public.stock_movements (product_id, created_at DESC);

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 14
CREATE INDEX IF NOT EXISTS stock_movements_invoice_item_idx ON public.stock_movements (invoice_item_id) WHERE invoice_item_id IS NOT NULL;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 15
CREATE INDEX IF NOT EXISTS stock_transfer_items_transfer_idx ON public.stock_transfer_items (transfer_id);

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 16
CREATE INDEX IF NOT EXISTS invoice_items_pricelist_item_idx ON public.invoice_items (pricelist_item_id) WHERE pricelist_item_id IS NOT NULL;

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
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['store', 'pharmacist', 'accountant', 'admin']::public.app_role[]));

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 27
CREATE POLICY "Inventory products visible to authorised inventory staff" ON public.inventory_products
  FOR SELECT TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['store', 'pharmacist', 'accountant', 'admin']::public.app_role[]));

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 28
CREATE POLICY "Inventory batches visible to Store, Accountant and Admin" ON public.inventory_batches
  FOR SELECT TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['store', 'accountant', 'admin']::public.app_role[]));

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 29
CREATE POLICY "Inventory receipt records visible to Store, Accountant and Admin" ON public.stock_receipts
  FOR SELECT TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['store', 'accountant', 'admin']::public.app_role[]));

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 30
CREATE POLICY "Inventory receipt lines visible to Store, Accountant and Admin" ON public.stock_receipt_items
  FOR SELECT TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['store', 'accountant', 'admin']::public.app_role[]));

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 31
CREATE POLICY "Inventory transfers visible to Store, Pharmacy, Accountant and Admin" ON public.stock_transfers
  FOR SELECT TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['store', 'pharmacist', 'accountant', 'admin']::public.app_role[]));

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 32
CREATE POLICY "Inventory transfer lines visible to Store, Pharmacy, Accountant and Admin" ON public.stock_transfer_items
  FOR SELECT TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['store', 'pharmacist', 'accountant', 'admin']::public.app_role[]));

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 33
CREATE POLICY "Inventory movements visible to Store, Accountant and Admin" ON public.stock_movements
  FOR SELECT TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['store', 'accountant', 'admin']::public.app_role[]));

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 34
CREATE POLICY "Dispense allocations visible to Pharmacy, Store, Accountant and Admin" ON public.dispense_stock_allocations
  FOR SELECT TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['store', 'pharmacist', 'accountant', 'admin']::public.app_role[]));

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

AS $$
DECLARE
  _product_id uuid;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['store', 'accountant', 'admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only Store, Accountant, or Admin can map a medicine to inventory';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.pricelist WHERE id = _pricelist_item_id AND active) THEN
    RAISE EXCEPTION 'Select an active pricelist medicine or consumable';
  END IF;

  IF btrim(COALESCE(_sku, '')) = '' OR btrim(COALESCE(_unit_label, '')) = '' OR COALESCE(_minimum_level, 0) < 0 THEN
    RAISE EXCEPTION 'SKU, unit label, and a non-negative minimum level are required';
  END IF;

  INSERT INTO public.inventory_products (pricelist_item_id, sku, unit_label, minimum_level, created_by)
  VALUES (_pricelist_item_id, btrim(_sku), btrim(_unit_label), _minimum_level, public.hms_current_user_id())
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
  IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['store', 'admin']::app_role[]) THEN
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
  VALUES (_receipt_kind, NULLIF(btrim(_supplier_name), ''), NULLIF(btrim(_supplier_reference), ''), COALESCE(_received_on, current_date), _location_id, NULLIF(btrim(_note), ''), public.hms_current_user_id())
  RETURNING id INTO _receipt_id;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_items) AS x(value)
    WHERE NULLIF(btrim(x.value->>'batch_number'), '') IS NULL
       OR NULLIF(x.value->>'expiry_date', '') IS NULL
       OR NULLIF(x.value->>'quantity', '') IS NULL
       OR (x.value->>'quantity')::numeric <= 0
       OR NULLIF(x.value->>'unit_cost', '') IS NULL
       OR (x.value->>'unit_cost')::numeric < 0
       OR (x.value->>'expiry_date')::date < current_date
       OR NOT EXISTS (SELECT 1 FROM public.inventory_products p WHERE p.id = (x.value->>'product_id')::uuid AND p.active)
  ) THEN
    RAISE EXCEPTION 'Each item requires an active product, batch number, future expiry date, positive quantity, and non-negative unit cost';
  END IF;

  INSERT INTO public.inventory_batches (product_id, location_id, batch_number, expiry_date, unit_cost, quantity_on_hand)
  SELECT (x.value->>'product_id')::uuid, _location_id, NULLIF(btrim(x.value->>'batch_number'), ''),
         (x.value->>'expiry_date')::date, (x.value->>'unit_cost')::numeric, (x.value->>'quantity')::numeric
  FROM jsonb_array_elements(_items) AS x(value)
  ON CONFLICT (product_id, location_id, batch_number, expiry_date) DO UPDATE
    SET quantity_on_hand = public.inventory_batches.quantity_on_hand + EXCLUDED.quantity_on_hand,
        unit_cost = EXCLUDED.unit_cost, status = 'active', updated_at = now();

  INSERT INTO public.stock_receipt_items (receipt_id, batch_id, product_id, quantity, unit_cost)
  SELECT _receipt_id, b.id, (x.value->>'product_id')::uuid, (x.value->>'quantity')::numeric, (x.value->>'unit_cost')::numeric
  FROM jsonb_array_elements(_items) AS x(value)
  JOIN public.inventory_batches b ON b.product_id = (x.value->>'product_id')::uuid
    AND b.location_id = _location_id AND b.batch_number = NULLIF(btrim(x.value->>'batch_number'), '')
    AND b.expiry_date = (x.value->>'expiry_date')::date;

  INSERT INTO public.stock_movements (movement_type, product_id, batch_id, location_id, quantity_delta, unit_cost, receipt_id, performed_by, reason)
  SELECT CASE WHEN _receipt_kind = 'opening_count' THEN 'opening_count' ELSE 'receipt' END,
         (x.value->>'product_id')::uuid, b.id, _location_id, (x.value->>'quantity')::numeric,
         (x.value->>'unit_cost')::numeric, _receipt_id, public.hms_current_user_id(), _note
  FROM jsonb_array_elements(_items) AS x(value)
  JOIN public.inventory_batches b ON b.product_id = (x.value->>'product_id')::uuid
    AND b.location_id = _location_id AND b.batch_number = NULLIF(btrim(x.value->>'batch_number'), '')
    AND b.expiry_date = (x.value->>'expiry_date')::date;

  RETURN _receipt_id;
END;
$$;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 37
CREATE OR REPLACE FUNCTION public.create_store_to_pharmacy_transfer(_items jsonb, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _transfer_id uuid;
  _from_location uuid;
  _to_location uuid;
  _row jsonb;
  _batch public.inventory_batches;
  _quantity numeric;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['store', 'admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only Store or Admin can send stock to Pharmacy';
  END IF;
  IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Select at least one batch and quantity to transfer';
  END IF;

  SELECT id INTO _from_location FROM public.inventory_locations WHERE code = 'main_store';
  SELECT id INTO _to_location FROM public.inventory_locations WHERE code = 'pharmacy';

  INSERT INTO public.stock_transfers (from_location_id, to_location_id, note, created_by)
  VALUES (_from_location, _to_location, NULLIF(btrim(_note), ''), public.hms_current_user_id())
  RETURNING id INTO _transfer_id;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_items) AS x(value) WHERE NULLIF(x.value->>'quantity', '') IS NULL OR (x.value->>'quantity')::numeric <= 0) THEN
    RAISE EXCEPTION 'Transfer quantities must be positive';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_items) AS x(value)
    LEFT JOIN public.inventory_batches b ON b.id = (x.value->>'batch_id')::uuid
      AND b.location_id = _from_location AND b.status = 'active' AND b.expiry_date >= current_date
    WHERE b.id IS NULL OR b.quantity_on_hand < (x.value->>'quantity')::numeric
  ) THEN
    RAISE EXCEPTION 'Insufficient available Main Store quantity for one or more selected batches';
  END IF;
  UPDATE public.inventory_batches b
  SET quantity_on_hand = b.quantity_on_hand - (x.value->>'quantity')::numeric, updated_at = now()
  FROM jsonb_array_elements(_items) AS x(value)
  WHERE b.id = (x.value->>'batch_id')::uuid;
  INSERT INTO public.stock_transfer_items (transfer_id, source_batch_id, product_id, quantity_sent)
  SELECT _transfer_id, b.id, b.product_id, (x.value->>'quantity')::numeric
  FROM jsonb_array_elements(_items) AS x(value) JOIN public.inventory_batches b ON b.id = (x.value->>'batch_id')::uuid;
  INSERT INTO public.stock_movements (movement_type, product_id, batch_id, location_id, quantity_delta, unit_cost, transfer_id, performed_by, reason)
  SELECT 'transfer_out', b.product_id, b.id, _from_location, -(x.value->>'quantity')::numeric, b.unit_cost, _transfer_id, public.hms_current_user_id(), _note
  FROM jsonb_array_elements(_items) AS x(value) JOIN public.inventory_batches b ON b.id = (x.value->>'batch_id')::uuid;

  RETURN _transfer_id;
END;
$$;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 38
CREATE OR REPLACE FUNCTION public.receive_store_transfer(_transfer_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _transfer public.stock_transfers;
  _item public.invoice_items;
  _source_batch public.inventory_batches;
  _destination_batch_id uuid;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['pharmacist', 'admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only Pharmacy or Admin can confirm receipt from Store';
  END IF;

  SELECT * INTO _transfer FROM public.stock_transfers WHERE id = _transfer_id FOR UPDATE;
  IF (_transfer).id IS NULL OR (_transfer).status NOT IN ('sent', 'partially_received') THEN
    RAISE EXCEPTION 'This transfer is not awaiting Pharmacy confirmation';
  END IF;

  INSERT INTO public.inventory_batches (product_id, location_id, batch_number, expiry_date, unit_cost, quantity_on_hand, source_batch_id)
  SELECT sti.product_id, st.to_location_id, sb.batch_number, sb.expiry_date, sb.unit_cost,
         sti.quantity_sent - sti.quantity_received, sb.id
  FROM public.stock_transfer_items sti
  JOIN public.stock_transfers st ON st.id = sti.transfer_id
  JOIN public.inventory_batches sb ON sb.id = sti.source_batch_id
  WHERE sti.transfer_id = _transfer_id AND sti.quantity_sent > sti.quantity_received
  ON CONFLICT (product_id, location_id, batch_number, expiry_date) DO UPDATE
    SET quantity_on_hand = public.inventory_batches.quantity_on_hand + EXCLUDED.quantity_on_hand,
        updated_at = now();

  UPDATE public.stock_transfer_items sti
  SET quantity_received = sti.quantity_sent,
      destination_batch_id = db.id
  FROM public.stock_transfers st
  JOIN public.inventory_batches sb ON sb.id = sti.source_batch_id
  JOIN public.inventory_batches db ON db.product_id = sti.product_id
    AND db.location_id = st.to_location_id AND db.batch_number = sb.batch_number AND db.expiry_date = sb.expiry_date
  WHERE sti.transfer_id = _transfer_id AND sti.quantity_sent > sti.quantity_received;

  INSERT INTO public.stock_movements (movement_type, product_id, batch_id, location_id, quantity_delta, unit_cost, transfer_id, performed_by, reason)
  SELECT 'transfer_in', sti.product_id, sti.destination_batch_id, st.to_location_id,
         sti.quantity_sent, sb.unit_cost,
         _transfer_id, public.hms_current_user_id(), st.note
  FROM public.stock_transfer_items sti
  JOIN public.stock_transfers st ON st.id = sti.transfer_id
  JOIN public.inventory_batches sb ON sb.id = sti.source_batch_id
  WHERE sti.transfer_id = _transfer_id AND sti.quantity_received > 0;

  UPDATE public.stock_transfers
  SET status = 'received', received_by = public.hms_current_user_id(), received_at = now()
  WHERE id = _transfer_id;

  RETURN _transfer_id;
END;
$$;

-- SOURCE: 20260814173000_store_pharmacy_inventory_foundation.sql statement 39
CREATE OR REPLACE FUNCTION public.dispense_inventory_invoice_item(_invoice_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _item public.invoice_items;
  _product_id uuid;
  _pharmacy_location uuid;
  _remaining numeric;
  _take numeric;
  _batch public.inventory_batches;
  _movement_id uuid;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['pharmacist', 'admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only Pharmacy or Admin can dispense medicine';
  END IF;

  SELECT * INTO _item FROM public.invoice_items ii
  JOIN public.invoices i ON i.id = ii.invoice_id
  WHERE ii.id = _invoice_item_id
  FOR UPDATE OF ii;

  IF (_item).id IS NULL THEN RAISE EXCEPTION 'Invoice item not found'; END IF;
  IF (_item).invoice_status <> 'paid' THEN RAISE EXCEPTION 'Only a paid invoice item can be dispensed'; END IF;
  IF COALESCE((_item).dispensing_status, 'pending') <> 'pending' THEN RAISE EXCEPTION 'This invoice item has already been processed'; END IF;

  IF (_item).pricelist_item_id IS NULL THEN
    UPDATE public.invoice_items
    SET dispensing_status = 'dispensed',
        dispensing_notes = 'Dispensed as a non-stock item; no pricelist inventory mapping exists.',
        dispensing_updated_at = now(),
        dispensing_updated_by = public.hms_current_user_id()
    WHERE id = (_item).id;
    RETURN jsonb_build_object('invoice_item_id', (_item).id, 'stock_controlled', false, 'message', 'Dispensed without inventory deduction because no product mapping exists.');
  END IF;

  SELECT id INTO _product_id FROM public.inventory_products
  WHERE pricelist_item_id = (_item).pricelist_item_id AND active;
  IF _product_id IS NULL THEN
    RAISE EXCEPTION 'This billed medicine is not mapped to active inventory. Ask Store or Accountant to map it before dispensing.';
  END IF;

  SELECT id INTO _pharmacy_location FROM public.inventory_locations WHERE code = 'pharmacy' AND active;
  _remaining := (_item).quantity;

  SELECT COALESCE(SUM(take), 0) INTO _taken
  FROM (
    SELECT LEAST(quantity_on_hand, GREATEST(_remaining - prior_qty, 0))::numeric AS take
    FROM (
      SELECT quantity_on_hand,
             COALESCE(SUM(quantity_on_hand) OVER (ORDER BY expiry_date ASC, received_at ASC, id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)::numeric AS prior_qty
      FROM public.inventory_batches
      WHERE product_id = _product_id AND location_id = _pharmacy_location
        AND status = 'active' AND expiry_date >= current_date AND quantity_on_hand > 0
    ) q
  ) allocated;
  IF _taken < _remaining THEN RAISE EXCEPTION 'Insufficient Pharmacy stock to dispense this item'; END IF;

  WITH ordered AS (
    SELECT id, quantity_on_hand,
           COALESCE(SUM(quantity_on_hand) OVER (ORDER BY expiry_date ASC, received_at ASC, id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)::numeric AS prior_qty
    FROM public.inventory_batches
    WHERE product_id = _product_id AND location_id = _pharmacy_location
      AND status = 'active' AND expiry_date >= current_date AND quantity_on_hand > 0
  ), allocated AS (
    SELECT id, LEAST(quantity_on_hand, GREATEST(_remaining - prior_qty, 0))::numeric AS take
    FROM ordered
  )
  UPDATE public.inventory_batches b
  SET quantity_on_hand = b.quantity_on_hand - a.take, updated_at = now()
  FROM allocated a WHERE b.id = a.id AND a.take > 0;

  WITH ordered AS (
    SELECT id, quantity_on_hand,
           COALESCE(SUM(quantity_on_hand) OVER (ORDER BY expiry_date ASC, received_at ASC, id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)::numeric AS prior_qty
    FROM public.inventory_batches
    WHERE product_id = _product_id AND location_id = _pharmacy_location
      AND status = 'active' AND expiry_date >= current_date AND quantity_on_hand > 0
  ), allocated AS (
    SELECT id, LEAST(quantity_on_hand, GREATEST(_remaining - prior_qty, 0))::numeric AS take
    FROM ordered
  )
  INSERT INTO public.stock_movements (movement_type, product_id, batch_id, location_id, quantity_delta, unit_cost, invoice_item_id, performed_by, reason)
  SELECT 'dispensed', _product_id, a.id, _pharmacy_location, -a.take, b.unit_cost, (_item).id, public.hms_current_user_id(), 'Patient dispensing'
  FROM allocated a JOIN public.inventory_batches b ON b.id = a.id WHERE a.take > 0;

  INSERT INTO public.dispense_stock_allocations (invoice_item_id, stock_movement_id, batch_id, quantity, dispensed_by)
  SELECT (_item).id, sm.id, sm.batch_id, -sm.quantity_delta, public.hms_current_user_id()
  FROM public.stock_movements sm
  WHERE sm.invoice_item_id = (_item).id AND sm.movement_type = 'dispensed'
    AND sm.created_at >= transaction_timestamp();

  IF _remaining > 0 THEN
    RAISE EXCEPTION 'Insufficient Pharmacy stock to dispense this item';
  END IF;

  UPDATE public.invoice_items
  SET dispensing_status = 'dispensed',
      dispensing_notes = NULL,
      dispensing_updated_at = now(),
      dispensing_updated_by = public.hms_current_user_id()
  WHERE id = (_item).id;

  RETURN jsonb_build_object('invoice_item_id', (_item).id, 'stock_controlled', true, 'message', 'Dispensed and deducted from Pharmacy stock.');
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

AS $$
  SELECT ip.id, p.id, p.name, p.category, p.size, p.price, ip.sku, ip.unit_label, ip.minimum_level, ip.active
  FROM public.inventory_products ip
  JOIN public.pricelist p ON p.id = ip.pricelist_item_id
  WHERE public.has_any_role(public.hms_current_user_id(), ARRAY['store', 'pharmacist', 'accountant', 'admin']::app_role[])
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
    AND public.has_any_role(public.hms_current_user_id(), ARRAY['store', 'pharmacist', 'accountant', 'admin']::app_role[])
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

AS $$
DECLARE
  v_uid uuid := public.hms_current_user_id();
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

  SELECT public.write_audit_log(
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

-- SOURCE: 20260814210000_add_typed_lab_result.sql statement 3
CREATE INDEX IF NOT EXISTS idx_snap_orders_lab_result_text
  ON public.snap_orders (patient_id, order_type, created_at DESC)
  WHERE order_type = 'lab_result' AND result_text IS NOT NULL;

-- SOURCE: 20260815160000_harden_treatment_forwarding.sql statement 1
CREATE OR REPLACE FUNCTION public.forward_snap_to_billing(
  _source_snap_id uuid,
  _target_station text,
  _note text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER

AS $function$
DECLARE
  _uid uuid := public.hms_current_user_id();
  _src public.snap_orders;
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

  IF (_src).id IS NULL THEN
    RAISE EXCEPTION 'Source snap not found';
  END IF;

  -- A Nurse treatment-review row is single-use. Once acknowledged or
  -- fulfilled, a repeated click must not create another downstream order.
  IF (_src).target_station IN ('nurse','doctor')
     AND (_src).status <> 'pending_billing' THEN
    RAISE EXCEPTION 'SOURCE_SNAP_ALREADY_FORWARDED: this treatment has already been forwarded';
  END IF;

  -- Admission-order snaps are also single-use.
  IF (_src).intent = 'admission_order' THEN
    IF (_src).ack_at IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.snap_orders c WHERE c.parent_snap_id = (_src).id) THEN
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
    (_src).patient_id, (_src).visit_id, _order_type, _target_station,
    COALESCE(_role, (_src).source_role),
    (_src).photo_path,
    COALESCE(_note, 'Forwarded from treatment review'),
    'pending_billing', _uid, COALESCE(_role, (_src).source_role),
    (_src).id, COALESCE((_src).matched_items, '[]'::jsonb),
    (_src).ocr_text, (_src).ocr_confidence
  ) RETURNING id INTO _new;

  -- Consume every station-review source row after its child is created. This
  -- is intentionally in the same transaction as the insert above.
  UPDATE public.snap_orders
     SET status = 'acknowledged',
         ack_by = _uid,
         ack_at = now(),
         updated_at = now()
   WHERE id = (_src).id
     AND status = 'pending_billing';

  SELECT public.write_audit_log('snap_forwarded_to_billing', 'snap_order', _new::text, jsonb_build_object(
      'source_snap_id', (_src).id,
      'patient_id', (_src).patient_id,
      'target_station', _target_station
    )
  , 'success');

  RETURN _new;
END
$function$;

-- SOURCE: 20260815160000_harden_treatment_forwarding.sql statement 2
REVOKE ALL ON FUNCTION public.forward_snap_to_billing(uuid, text, text) FROM PUBLIC, anon;

-- SOURCE: 20260815160000_harden_treatment_forwarding.sql statement 3
GRANT EXECUTE ON FUNCTION public.forward_snap_to_billing(uuid, text, text) TO authenticated, service_role;

-- SOURCE: 20260815173500_harden_discharge_archive_consistency.sql statement 1
CREATE OR REPLACE FUNCTION public.patient_pending_workflow_station(_patient_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER

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

AS $function$
DECLARE
  _adm public.admissions;
  _p public.patients;
  _wallet boolean;
  _debt numeric;
  _collected numeric := 0;
  _remaining numeric := 0;
  _inv public.invoices;
  _apply numeric;
  _left numeric;
  _applied numeric := 0;
  _pct numeric;
  _share numeric;
  _wallet_used numeric := 0;
  _refund numeric := 0;
  _credit numeric := 0;
  _debt_cleared numeric := 0;
  _got_lock boolean;
  _journey public.patient_journey;
  _journey_id uuid;
BEGIN
  IF NOT public.has_any_role(
    public.hms_current_user_id(),
    ARRAY['cashier','billing','accountant','admin']::app_role[]
  ) THEN
    RAISE EXCEPTION 'Only the cashier can settle and complete a discharge';
  END IF;

  _got_lock := true;
  IF NOT _got_lock THEN
    RAISE EXCEPTION 'DISCHARGE_IN_PROGRESS: this discharge is already being settled — refresh the queue';
  END IF;

  SELECT * INTO _adm FROM public.admissions
  WHERE id = _admission_id
  FOR UPDATE;

  IF _adm IS NULL THEN
    RAISE EXCEPTION 'Admission not found';
  END IF;
  IF (_adm).status = 'discharged' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was already settled and discharged on %',
      COALESCE(to_char((_adm).discharged_at, 'DD Mon YYYY HH24:MI'), 'an earlier date');
  END IF;
  IF (_adm).status = 'cancelled' THEN
    RAISE EXCEPTION 'ADMISSION_CANCELLED: this admission was cancelled and cannot be settled';
  END IF;
  IF (_adm).status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'NOT_IN_CASHIER_QUEUE: the ward has not confirmed this discharge yet (%)', (_adm).status;
  END IF;

  SELECT public.bill_admission_bed_days(_admission_id);
  _wallet_used := public.apply_wallet_to_outstanding(
    (_adm).patient_id,
    'Balance applied at discharge'
  );

  SELECT * INTO _p FROM public.patients
  WHERE id = (_adm).patient_id
  FOR UPDATE;

  _wallet := public.has_wallet((_p).account_type);
  _pct := public.copay_percent((_p).account_type, (_p).insurance_plan);
  _debt := public.patient_outstanding((_adm).patient_id);
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
      IF _wallet AND (_p).balance < 0 THEN
        _debt_cleared := ROUND(LEAST(_collected, -(_p).balance), 2);
        SELECT public.adjust_patient_balance((_adm).patient_id, _debt_cleared, 'debt_cleared', _settlement_method, NULL, NULL, COALESCE(_settlement_notes)
        );
      END IF;
      _remaining := ROUND(GREATEST(0, _debt - _collected), 2);
      IF _remaining > 0 THEN
        SELECT public.write_audit_log('discharge_partial_settlement', 'admission', _admission_id::text, jsonb_build_object(
            'patient_id', (_adm).patient_id,
            'debt', _debt,
            'collected', _collected,
            'outstanding', _remaining,
            'method', _settlement_method,
            'notes', _settlement_notes
          )
        , 'success');
      END IF;
    ELSIF _settlement_method = 'salary' THEN
      IF (_p).staff_link_id IS NULL THEN
        RAISE EXCEPTION 'STAFF_LINK_REQUIRED: this patient is not linked to any staff member for salary deduction';
      END IF;
      _remaining := 0;
      SELECT public.write_audit_log('salary_deduction_on_discharge', 'admission', _admission_id::text, jsonb_build_object(
          'patient_id', (_adm).patient_id,
          'debt', _debt,
          'staff_id', (_p).staff_link_id,
          'notes', _settlement_notes
        )
      , 'success');
    ELSIF _settlement_method = 'carry' THEN
      SELECT public.write_audit_log('debt_carried_on_discharge', 'admission', _admission_id::text, jsonb_build_object(
          'patient_id', (_adm).patient_id,
          'debt', _debt,
          'notes', _settlement_notes
        )
      , 'success');
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
    SELECT COALESCE(SUM(applied), 0) INTO _applied
    FROM (
      SELECT LEAST(due, GREATEST(_left - prior_due, 0))::numeric AS applied
      FROM (
        SELECT ROUND(total_amount * _pct / 100.0, 2)::numeric AS share,
               GREATEST((ROUND(total_amount * _pct / 100.0, 2)) - COALESCE(paid_amount, 0), 0)::numeric AS due,
               COALESCE(SUM(GREATEST((ROUND(total_amount * _pct / 100.0, 2)) - COALESCE(paid_amount, 0), 0)) OVER (
                 ORDER BY created_at ASC, id ASC
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ), 0)::numeric AS prior_due
        FROM public.invoices
        WHERE patient_id = (_adm).patient_id AND status IN ('pending', 'partial')
      ) unpaid
    ) allocation;

    WITH unpaid AS (
      SELECT id, total_amount, COALESCE(paid_amount, 0)::numeric AS paid,
             ROUND(total_amount * _pct / 100.0, 2)::numeric AS share,
             GREATEST((ROUND(total_amount * _pct / 100.0, 2)) - COALESCE(paid_amount, 0), 0)::numeric AS due,
             COALESCE(SUM(GREATEST((ROUND(total_amount * _pct / 100.0, 2)) - COALESCE(paid_amount, 0), 0)) OVER (
               ORDER BY created_at ASC, id ASC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0)::numeric AS prior_due
      FROM public.invoices
      WHERE patient_id = (_adm).patient_id AND status IN ('pending', 'partial')
    ), allocated AS (
      SELECT id, total_amount, paid, share,
             LEAST(due, GREATEST(_left - prior_due, 0))::numeric AS applied
      FROM unpaid
    )
    UPDATE public.invoices i
       SET paid_amount = a.paid + a.applied,
           status = CASE WHEN a.paid + a.applied >= a.share THEN 'paid' ELSE 'partial' END,
           paid_at = CASE WHEN a.paid + a.applied >= a.share THEN now() ELSE i.paid_at END,
           payment_method = COALESCE(i.payment_method, _settlement_method),
           is_salary_deduction = CASE WHEN _settlement_method = 'salary' THEN true ELSE is_salary_deduction END,
           staff_sponsor_id = CASE WHEN _settlement_method = 'salary' THEN (_p).staff_link_id ELSE staff_sponsor_id END,
           updated_at = now()
      FROM allocated a
     WHERE i.id = a.id AND a.applied > 0;

    _left := ROUND(_left - COALESCE(_applied, 0), 2);
  END IF;

  IF _wallet AND _left > 0 AND _settlement_method IN ('cash', 'pos', 'transfer') THEN
    SELECT public.adjust_patient_balance(
      (_adm).patient_id,
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
    SELECT * INTO _p FROM public.patients
    WHERE id = (_adm).patient_id
    FOR UPDATE;
    IF _refund > (_p).balance THEN
      RAISE EXCEPTION 'Refund % exceeds available balance %', _refund, (_p).balance;
    END IF;
    SELECT public.adjust_patient_balance(
      (_adm).patient_id,
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
      discharged_by = public.hms_current_user_id(),
      discharge_notes = COALESCE(_notes, discharge_notes),
      updated_at = now()
  WHERE id = _admission_id
    AND status = 'ready_for_discharge';

  IF (_adm).status <> 'ready_for_discharge' THEN
    RAISE EXCEPTION 'ALREADY_DISCHARGED: this admission was settled by someone else — refresh the queue';
  END IF;

  -- A discharge is not complete until the visit that created the admission is
  -- closed. This prevents a discharged patient from being blocked in Archive
  -- by a stale open visit.
  UPDATE public.visits
  SET status = 'settled',
      closed_at = COALESCE(closed_at, now()),
      closed_by = COALESCE(closed_by, public.hms_current_user_id()),
      updated_at = now()
  WHERE id = (_adm).visit_id
    AND status <> 'settled';

  IF (_adm).bed_id IS NOT NULL THEN
    UPDATE public.beds
    SET status = 'available', updated_at = now()
    WHERE id = (_adm).bed_id;
  END IF;

  -- An inpatient cashier settlement is the authoritative terminal event for
  -- this admission. It writes the journey and its audit record directly so the
  -- new admission invoice cannot be misclassified as pending outpatient work.
  SELECT * INTO _journey
  FROM public.patient_journey
  WHERE patient_id = (_adm).patient_id
  FOR UPDATE;

  IF (_journey).id IS NULL THEN
    INSERT INTO public.patient_journey (
      patient_id, visit_id, current_state, owner_role, owner_user_id
    ) VALUES (
      (_adm).patient_id, (_adm).visit_id, 'discharged', 'reception', NULL
    )
    RETURNING id INTO _journey_id;

    INSERT INTO public.patient_journey_history (
      journey_id, patient_id, visit_id, from_state, to_state,
      from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
      reason
    ) VALUES (
      _journey_id, (_adm).patient_id, (_adm).visit_id, NULL, 'discharged',
      NULL, 'reception', NULL, NULL,
      'Inpatient cashier settlement completed'
    );
  ELSE
    UPDATE public.patient_journey
    SET visit_id = COALESCE((_adm).visit_id, (_journey).visit_id),
        current_state = 'discharged',
        owner_role = 'reception',
        owner_user_id = NULL,
        updated_at = now()
    WHERE id = (_journey).id;

    INSERT INTO public.patient_journey_history (
      journey_id, patient_id, visit_id, from_state, to_state,
      from_owner_role, to_owner_role, from_owner_user_id, to_owner_user_id,
      reason
    ) VALUES (
      (_journey).id, (_adm).patient_id, COALESCE((_adm).visit_id, (_journey).visit_id),
      (_journey).current_state, 'discharged',
      (_journey).owner_role, 'reception', (_journey).owner_user_id, NULL,
      'Inpatient cashier settlement completed'
    );
  END IF;

  UPDATE public.patients
  SET status = 'discharged',
      updated_at = now()
  WHERE id = (_adm).patient_id;

  SELECT public.write_audit_log('admission_discharged', 'admission', _admission_id::text, jsonb_build_object(
      'patient_id', (_adm).patient_id,
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
  , 'success');

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
