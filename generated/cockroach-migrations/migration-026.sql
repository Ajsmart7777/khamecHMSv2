-- Create the corporate_manual_patient_records table for manual service/billing records
-- for enrolled patients under Corporate/Retainer accounts.
-- These records appear indistinguishably from normal patient records in the
-- end-of-month claims view.

CREATE TABLE IF NOT EXISTS public.corporate_manual_patient_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sponsor_id UUID NOT NULL,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL,
  patient_name TEXT NOT NULL,
  card_number TEXT,
  visits INTEGER NOT NULL DEFAULT 0,
  medication NUMERIC NOT NULL DEFAULT 0,
  lab_test NUMERIC NOT NULL DEFAULT 0,
  delivery NUMERIC NOT NULL DEFAULT 0,
  bed NUMERIC NOT NULL DEFAULT 0,
  others NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup by sponsor and period
CREATE INDEX IF NOT EXISTS idx_manual_patient_records_sponsor_period
  ON public.corporate_manual_patient_records (sponsor_id, period_year, period_month);

-- Enable RLS (matches project convention)
ALTER TABLE public.corporate_manual_patient_records ENABLE ROW LEVEL SECURITY;

-- Authenticated staff can read
CREATE POLICY "Authenticated staff can read manual patient records"
  ON public.corporate_manual_patient_records
  FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated staff can insert
CREATE POLICY "Authenticated staff can insert manual patient records"
  ON public.corporate_manual_patient_records
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Authenticated staff can update
CREATE POLICY "Authenticated staff can update manual patient records"
  ON public.corporate_manual_patient_records
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Authenticated staff can delete
CREATE POLICY "Authenticated staff can delete manual patient records"
  ON public.corporate_manual_patient_records
  FOR DELETE
  TO authenticated
  USING (true);
