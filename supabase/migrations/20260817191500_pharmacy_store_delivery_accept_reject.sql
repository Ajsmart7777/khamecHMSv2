-- Pharmacy Store-delivery decision flow.
-- A pending delivery is accepted or rejected after physical verification.
-- Rejection is audit-only and changes neither Store nor Pharmacy stock.

ALTER TABLE public.stock_transfers
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE public.stock_transfers DROP CONSTRAINT IF EXISTS stock_transfers_status_check;
ALTER TABLE public.stock_transfers ADD CONSTRAINT stock_transfers_status_check
  CHECK (status IN ('sent', 'partially_received', 'received', 'cancelled', 'rejected'));

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

GRANT EXECUTE ON FUNCTION public.get_pending_store_transfers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_store_transfer(uuid, text) TO authenticated;
