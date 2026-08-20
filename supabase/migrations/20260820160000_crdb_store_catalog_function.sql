-- CockroachDB compatibility: restore the Store catalog RPC using the HMS session context.
-- The Supabase foundation migration used auth.uid(), and that function was never
-- present in the clone. Store refresh therefore failed after registration with
-- "unknown function: public.get_inventory_catalog()".

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
         p.name,
         p.category,
         p.size,
         p.price,
         ip.sku,
         ip.unit_label,
         ip.minimum_level,
         ip.active
  FROM public.inventory_products ip
  JOIN public.pricelist p ON p.id = ip.pricelist_item_id
  WHERE public.has_any_role(
    public.hms_current_user_id(),
    ARRAY[
      'store'::public.app_role,
      'pharmacist'::public.app_role,
      'accountant'::public.app_role,
      'admin'::public.app_role
    ]
  )
  ORDER BY p.name;
$$;

GRANT EXECUTE ON FUNCTION public.get_inventory_catalog() TO authenticated;
