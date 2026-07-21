-- Create prescriptions table
CREATE TABLE public.prescriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL,
  diagnosis TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by TEXT DEFAULT 'Doctor',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create prescription_items table for individual medications
CREATE TABLE public.prescription_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  prescription_id UUID NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
  medication TEXT NOT NULL,
  dosage TEXT NOT NULL,
  frequency TEXT NOT NULL,
  duration TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  dispensed BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on prescriptions
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;

-- Prescriptions RLS policies
CREATE POLICY "Allow public read access to prescriptions"
ON public.prescriptions FOR SELECT
USING (true);

CREATE POLICY "Allow public insert access to prescriptions"
ON public.prescriptions FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow public update access to prescriptions"
ON public.prescriptions FOR UPDATE
USING (true)
WITH CHECK (true);

-- Enable RLS on prescription_items
ALTER TABLE public.prescription_items ENABLE ROW LEVEL SECURITY;

-- Prescription items RLS policies
CREATE POLICY "Allow public read access to prescription_items"
ON public.prescription_items FOR SELECT
USING (true);

CREATE POLICY "Allow public insert access to prescription_items"
ON public.prescription_items FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow public update access to prescription_items"
ON public.prescription_items FOR UPDATE
USING (true)
WITH CHECK (true);

-- Add updated_at trigger for prescriptions
CREATE TRIGGER update_prescriptions_updated_at
  BEFORE UPDATE ON public.prescriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_patients_updated_at();

-- Enable realtime for prescriptions
ALTER PUBLICATION supabase_realtime ADD TABLE public.prescriptions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.prescription_items;