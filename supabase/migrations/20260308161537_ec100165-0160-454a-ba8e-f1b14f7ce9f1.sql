
-- Create invoices table
CREATE TABLE public.invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES public.patients(id),
  invoice_number TEXT NOT NULL UNIQUE,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  paid_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_method TEXT,
  notes TEXT,
  created_by TEXT DEFAULT 'Billing',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  paid_at TIMESTAMP WITH TIME ZONE
);

-- Create invoice_items table
CREATE TABLE public.invoice_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  category TEXT DEFAULT 'general',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

-- RLS policies for invoices
CREATE POLICY "Authenticated staff can read invoices"
  ON public.invoices FOR SELECT
  TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Billing and admin can insert invoices"
  ON public.invoices FOR INSERT
  TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing receptionist and admin can update invoices"
  ON public.invoices FOR UPDATE
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['billing'::app_role, 'receptionist'::app_role, 'admin'::app_role]));

-- RLS policies for invoice_items
CREATE POLICY "Authenticated staff can read invoice_items"
  ON public.invoice_items FOR SELECT
  TO authenticated
  USING (public.is_authenticated_staff());

CREATE POLICY "Billing and admin can insert invoice_items"
  ON public.invoice_items FOR INSERT
  TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing and admin can update invoice_items"
  ON public.invoice_items FOR UPDATE
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- Enable realtime for invoices
ALTER PUBLICATION supabase_realtime ADD TABLE public.invoices;
