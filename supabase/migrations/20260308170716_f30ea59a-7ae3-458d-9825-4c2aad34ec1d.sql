
-- Create shift_periods table
CREATE TABLE public.shift_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create shift_assignments table
CREATE TABLE public.shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shift_period_id uuid NOT NULL REFERENCES public.shift_periods(id) ON DELETE CASCADE,
  shift_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(staff_user_id, shift_date)
);

-- Create shift_logs table
CREATE TABLE public.shift_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shift_period_id uuid NOT NULL REFERENCES public.shift_periods(id) ON DELETE CASCADE,
  shift_date date NOT NULL,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  handover_notes text,
  status text NOT NULL DEFAULT 'clocked_in',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(staff_user_id, shift_date)
);

-- Enable RLS
ALTER TABLE public.shift_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_logs ENABLE ROW LEVEL SECURITY;

-- shift_periods policies
CREATE POLICY "Authenticated staff can read shift_periods"
  ON public.shift_periods FOR SELECT
  USING (is_authenticated_staff());

CREATE POLICY "Admin can insert shift_periods"
  ON public.shift_periods FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can update shift_periods"
  ON public.shift_periods FOR UPDATE
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can delete shift_periods"
  ON public.shift_periods FOR DELETE
  USING (has_role(auth.uid(), 'admin'));

-- shift_assignments policies
CREATE POLICY "Staff can read own assignments"
  ON public.shift_assignments FOR SELECT
  USING (staff_user_id = auth.uid() OR has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can insert shift_assignments"
  ON public.shift_assignments FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can update shift_assignments"
  ON public.shift_assignments FOR UPDATE
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can delete shift_assignments"
  ON public.shift_assignments FOR DELETE
  USING (has_role(auth.uid(), 'admin'));

-- shift_logs policies
CREATE POLICY "Staff can read own logs and admin can read all"
  ON public.shift_logs FOR SELECT
  USING (staff_user_id = auth.uid() OR has_role(auth.uid(), 'admin'));

CREATE POLICY "Staff can insert own shift_logs"
  ON public.shift_logs FOR INSERT
  WITH CHECK (staff_user_id = auth.uid());

CREATE POLICY "Staff can update own shift_logs"
  ON public.shift_logs FOR UPDATE
  USING (staff_user_id = auth.uid() OR has_role(auth.uid(), 'admin'));

-- Enable realtime on shift_logs
ALTER PUBLICATION supabase_realtime ADD TABLE public.shift_logs;

-- Seed default shift periods
INSERT INTO public.shift_periods (name, start_time, end_time) VALUES
  ('Morning', '07:00', '14:00'),
  ('Afternoon', '14:00', '21:00'),
  ('Night', '21:00', '07:00');
