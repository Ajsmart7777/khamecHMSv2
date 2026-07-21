
-- Create vitals table to persist nurse recordings
CREATE TABLE public.vitals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  temperature numeric,
  blood_pressure text,
  pulse integer,
  respiratory_rate integer,
  weight numeric,
  height numeric,
  notes text,
  recorded_by text DEFAULT 'Nurse',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.vitals ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated staff can read vitals"
  ON public.vitals FOR SELECT
  TO authenticated
  USING (is_authenticated_staff());

CREATE POLICY "Nurses and doctors can insert vitals"
  ON public.vitals FOR INSERT
  TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['nurse'::app_role, 'doctor'::app_role, 'admin'::app_role]));

CREATE POLICY "Nurses and doctors can update vitals"
  ON public.vitals FOR UPDATE
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['nurse'::app_role, 'doctor'::app_role, 'admin'::app_role]));

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.vitals;
