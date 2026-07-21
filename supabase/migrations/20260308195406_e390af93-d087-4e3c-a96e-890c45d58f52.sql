-- Add bank details and payroll columns to staff table
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS account_number text,
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS designation text,
  ADD COLUMN IF NOT EXISTS staff_id_number text;

-- Create payroll_periods table
CREATE TABLE public.payroll_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month integer NOT NULL,
  year integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(month, year)
);

ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Billing and admin can read payroll_periods"
  ON public.payroll_periods FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing and admin can insert payroll_periods"
  ON public.payroll_periods FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing and admin can update payroll_periods"
  ON public.payroll_periods FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- Create payroll_entries table
CREATE TABLE public.payroll_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_period_id uuid NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  basic_salary numeric NOT NULL DEFAULT 0,
  allowances jsonb NOT NULL DEFAULT '{}',
  gross_pay numeric NOT NULL DEFAULT 0,
  deductions jsonb NOT NULL DEFAULT '{}',
  total_deductions numeric NOT NULL DEFAULT 0,
  net_pay numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  payment_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(payroll_period_id, staff_id)
);

ALTER TABLE public.payroll_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Billing and admin can read payroll_entries"
  ON public.payroll_entries FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing and admin can insert payroll_entries"
  ON public.payroll_entries FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing and admin can update payroll_entries"
  ON public.payroll_entries FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing and admin can delete payroll_entries"
  ON public.payroll_entries FOR DELETE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

-- Create payroll_payments table
CREATE TABLE public.payroll_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_period_id uuid NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
  payroll_entry_id uuid NOT NULL REFERENCES public.payroll_entries(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  paystack_transfer_code text,
  paystack_reference text,
  paystack_recipient_code text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payroll_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Billing and admin can read payroll_payments"
  ON public.payroll_payments FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing and admin can insert payroll_payments"
  ON public.payroll_payments FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));

CREATE POLICY "Billing and admin can update payroll_payments"
  ON public.payroll_payments FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role]));