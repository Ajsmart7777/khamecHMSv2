
-- Create inventory_items table
CREATE TABLE public.inventory_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  quantity INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 10,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  location TEXT NOT NULL DEFAULT 'store',
  expiry_date DATE,
  supplier TEXT,
  last_restocked TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create stock_requests table
CREATE TABLE public.stock_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  requested_by TEXT NOT NULL DEFAULT 'Pharmacy',
  item_id UUID REFERENCES public.inventory_items(id),
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  fulfilled_at TIMESTAMP WITH TIME ZONE
);

-- Create stock_movements table for audit trail
CREATE TABLE public.stock_movements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id UUID NOT NULL REFERENCES public.inventory_items(id),
  movement_type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  reference TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

-- RLS for inventory_items
CREATE POLICY "Authenticated staff can read inventory"
  ON public.inventory_items FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Store and admin can insert inventory"
  ON public.inventory_items FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['store'::app_role, 'admin'::app_role]));

CREATE POLICY "Store and admin can update inventory"
  ON public.inventory_items FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store'::app_role, 'admin'::app_role]));

CREATE POLICY "Store and admin can delete inventory"
  ON public.inventory_items FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store'::app_role, 'admin'::app_role]));

-- RLS for stock_requests
CREATE POLICY "Authenticated staff can read stock_requests"
  ON public.stock_requests FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Staff can insert stock_requests"
  ON public.stock_requests FOR INSERT TO authenticated
  WITH CHECK (public.is_authenticated_staff());

CREATE POLICY "Store and admin can update stock_requests"
  ON public.stock_requests FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['store'::app_role, 'admin'::app_role]));

-- RLS for stock_movements
CREATE POLICY "Authenticated staff can read stock_movements"
  ON public.stock_movements FOR SELECT TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Store and admin can insert stock_movements"
  ON public.stock_movements FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['store'::app_role, 'admin'::app_role]));

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_requests;
