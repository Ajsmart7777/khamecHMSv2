
-- Create corporate_accounts table
CREATE TABLE public.corporate_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name text NOT NULL,
  contact_person text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  address text DEFAULT '',
  treatment_limit numeric NOT NULL DEFAULT 0,
  balance numeric NOT NULL DEFAULT 0,
  discount_percentage numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.corporate_accounts ENABLE ROW LEVEL SECURITY;

-- RLS policies: billing and admin can manage corporate accounts
CREATE POLICY "Billing and admin can read corporate_accounts"
  ON public.corporate_accounts FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role, 'receptionist'::app_role]));

CREATE POLICY "Billing and admin can insert corporate_accounts"
  ON public.corporate_accounts FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing and admin can update corporate_accounts"
  ON public.corporate_accounts FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing and admin can delete corporate_accounts"
  ON public.corporate_accounts FOR DELETE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));
