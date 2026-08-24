-- Allow Store to register a Bin Card for an item that is not yet in Pricelist.
-- Manual products remain inventory-only; they are not silently added to the selling Pricelist.
ALTER TABLE public.inventory_products
  ALTER COLUMN pricelist_item_id DROP NOT NULL;

ALTER TABLE public.inventory_products
  ADD COLUMN IF NOT EXISTS manual_name text,
  ADD COLUMN IF NOT EXISTS manual_category text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS manual_size text,
  ADD COLUMN IF NOT EXISTS manual_sale_price numeric(14,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.register_manual_inventory_bin_card(
  _medicine_name text,
  _category text DEFAULT 'manual',
  _size text DEFAULT NULL,
  _sale_price numeric DEFAULT 0,
  _location_code text DEFAULT 'main_store'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER AS $$
DECLARE
  _product_id uuid;
  _location_id uuid;
  _card_id uuid;
  _user_id uuid := public.hms_current_user_id();
  _name text := NULLIF(btrim(COALESCE(_medicine_name, '')), '');
  _category_value text := COALESCE(NULLIF(btrim(COALESCE(_category, '')), ''), 'manual');
  _size_value text := NULLIF(btrim(COALESCE(_size, '')), '');
  _sale_price_value numeric := COALESCE(_sale_price, 0);
BEGIN
  IF NOT public.has_any_role(_user_id, ARRAY['store'::public.app_role, 'admin'::public.app_role]) THEN
    RAISE EXCEPTION 'Only Store or Admin can register a Bin Card';
  END IF;
  IF _location_code NOT IN ('main_store', 'store_2') THEN
    RAISE EXCEPTION 'A Bin Card can only be registered in Store 1 or Store 2';
  END IF;
  IF _name IS NULL OR length(_name) > 250 THEN
    RAISE EXCEPTION 'Manual medicine name is required and must be 250 characters or fewer';
  END IF;
  IF _sale_price_value < 0 THEN RAISE EXCEPTION 'Selling price cannot be negative'; END IF;

  SELECT id INTO _location_id
  FROM public.inventory_locations
  WHERE code = _location_code AND active;
  IF _location_id IS NULL THEN RAISE EXCEPTION 'Selected Store location is unavailable'; END IF;

  SELECT id INTO _product_id
  FROM public.inventory_products
  WHERE pricelist_item_id IS NULL
    AND lower(btrim(manual_name)) = lower(_name)
    AND COALESCE(lower(btrim(manual_size)), '') = COALESCE(lower(_size_value), '')
  ORDER BY active DESC, created_at ASC
  LIMIT 1;

  IF _product_id IS NULL THEN
    INSERT INTO public.inventory_products (
      pricelist_item_id, manual_name, manual_category, manual_size,
      manual_sale_price, sku, unit_label, minimum_level, created_by
    ) VALUES (
      NULL, _name, _category_value, _size_value, _sale_price_value,
      'MANUAL-' || replace(gen_random_uuid()::text, '-', ''), 'unit', 0, _user_id
    ) RETURNING id INTO _product_id;
  ELSE
    UPDATE public.inventory_products
    SET manual_category = _category_value,
        manual_sale_price = _sale_price,
        active = true,
        updated_at = now()
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
  SELECT ip.id,
         p.id,
         COALESCE(p.name, ip.manual_name),
         COALESCE(p.category, ip.manual_category),
         COALESCE(p.size, ip.manual_size),
         COALESCE(p.price, ip.manual_sale_price),
         ip.sku,
         ip.unit_label,
         ip.minimum_level,
         ip.active AND COALESCE(p.active, true)
  FROM public.inventory_products ip
  LEFT JOIN public.pricelist p ON p.id = ip.pricelist_item_id
  WHERE public.has_any_role(
    public.hms_current_user_id(),
    ARRAY['store'::public.app_role, 'pharmacist'::public.app_role, 'accountant'::public.app_role, 'admin'::public.app_role]
  )
  ORDER BY COALESCE(p.name, ip.manual_name);
$$;

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
  active boolean
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT bc.id, ip.id, il.id, il.code, il.name, p.id,
         COALESCE(p.name, ip.manual_name),
         COALESCE(p.category, ip.manual_category),
         COALESCE(p.size, ip.manual_size),
         COALESCE(p.price, ip.manual_sale_price),
         ip.sku, ip.unit_label,
         COALESCE(SUM(b.quantity_on_hand) FILTER (WHERE b.status = 'active'), 0),
         (bc.id IS NOT NULL AND ip.active AND COALESCE(p.active, true))
  FROM public.inventory_bin_cards bc
  JOIN public.inventory_products ip ON ip.id = bc.product_id
  JOIN public.inventory_locations il ON il.id = bc.location_id
  LEFT JOIN public.pricelist p ON p.id = ip.pricelist_item_id
  LEFT JOIN public.inventory_batches b
    ON b.product_id = bc.product_id AND b.location_id = bc.location_id
  WHERE il.code IN ('main_store', 'store_2')
    AND il.active
    AND public.has_any_role(public.hms_current_user_id(), ARRAY['store'::public.app_role, 'pharmacist'::public.app_role, 'accountant'::public.app_role, 'admin'::public.app_role])
  GROUP BY bc.id, ip.id, il.id, il.code, il.name, p.id, p.name, p.category,
           p.size, p.price, ip.manual_name, ip.manual_category, ip.manual_size,
           ip.manual_sale_price, ip.sku, ip.unit_label, ip.active, p.active
  ORDER BY il.code, COALESCE(p.name, ip.manual_name);
$$;

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
  SELECT st.id, st.status, st.note, st.sent_at, from_loc.name, from_loc.code,
         sti.id, sti.product_id, sti.quantity_sent, sti.quantity_received,
         COALESCE(p.name, ip.manual_name), COALESCE(p.size, ip.manual_size)
  FROM public.stock_transfers st
  JOIN public.inventory_locations from_loc ON from_loc.id = st.from_location_id
  JOIN public.stock_transfer_items sti ON sti.transfer_id = st.id
  JOIN public.inventory_products ip ON ip.id = sti.product_id
  LEFT JOIN public.pricelist p ON p.id = ip.pricelist_item_id
  WHERE st.status IN ('sent', 'partially_received')
    AND public.has_any_role(public.hms_current_user_id(), ARRAY['store'::public.app_role, 'pharmacist'::public.app_role, 'accountant'::public.app_role, 'admin'::public.app_role])
  ORDER BY st.sent_at DESC, sti.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.register_manual_inventory_bin_card(text,text,text,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_inventory_catalog() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_store_bin_cards() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_store_transfers() TO authenticated;
