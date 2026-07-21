-- Create lab_requests table
CREATE TABLE public.lab_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  request_number TEXT NOT NULL UNIQUE,
  tests TEXT[] NOT NULL,
  diagnosis TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT DEFAULT 'Doctor',
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  printed BOOLEAN NOT NULL DEFAULT false,
  results JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.lab_requests ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for public access (no auth yet)
CREATE POLICY "Allow public read access to lab_requests" 
ON public.lab_requests 
FOR SELECT 
USING (true);

CREATE POLICY "Allow public insert access to lab_requests" 
ON public.lab_requests 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Allow public update access to lab_requests" 
ON public.lab_requests 
FOR UPDATE 
USING (true)
WITH CHECK (true);

-- Create trigger for updated_at
CREATE TRIGGER update_lab_requests_updated_at
BEFORE UPDATE ON public.lab_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_patients_updated_at();

-- Enable realtime
ALTER TABLE public.lab_requests REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.lab_requests;

-- Create index for faster queries
CREATE INDEX idx_lab_requests_patient_id ON public.lab_requests(patient_id);
CREATE INDEX idx_lab_requests_status ON public.lab_requests(status);