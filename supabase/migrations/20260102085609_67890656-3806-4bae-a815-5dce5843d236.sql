-- Create patients table for real-time tracking
CREATE TABLE public.patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_number TEXT NOT NULL UNIQUE,
  mini_card_number TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('male', 'female')),
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  emergency_contact TEXT NOT NULL,
  blood_group TEXT,
  allergies TEXT[],
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'waiting', 'with_nurse', 'with_doctor', 'in_lab', 'awaiting_billing', 'awaiting_payment', 'at_pharmacy', 'admitted', 'discharged')),
  account_type TEXT NOT NULL DEFAULT 'normal' CHECK (account_type IN ('normal', 'insurance', 'corporate', 'nhis', 'hmo', 'retainer')),
  corporate_id TEXT,
  insurance_provider TEXT,
  insurance_policy_number TEXT,
  balance DECIMAL(12, 2) NOT NULL DEFAULT 0,
  registered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_visit TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for faster status queries
CREATE INDEX idx_patients_status ON public.patients(status);
CREATE INDEX idx_patients_card_number ON public.patients(card_number);

-- Enable Row Level Security
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

-- Create policy for public read access (HMS system - all staff can view patients)
CREATE POLICY "Allow public read access to patients"
ON public.patients
FOR SELECT
TO anon, authenticated
USING (true);

-- Create policy for public insert (reception can register patients)
CREATE POLICY "Allow public insert access to patients"
ON public.patients
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Create policy for public update (all modules can update patient status)
CREATE POLICY "Allow public update access to patients"
ON public.patients
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_patients_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_patients_updated_at
BEFORE UPDATE ON public.patients
FOR EACH ROW
EXECUTE FUNCTION public.update_patients_updated_at();

-- Enable realtime for patients table
ALTER PUBLICATION supabase_realtime ADD TABLE public.patients;