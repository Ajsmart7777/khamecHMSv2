
CREATE TABLE public.anc_programs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  anc_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','archived')),
  registration_date DATE NOT NULL DEFAULT CURRENT_DATE,
  lmp DATE, edd DATE,
  gravida INTEGER, para INTEGER,
  height NUMERIC, weight NUMERIC,
  religion TEXT, tribe TEXT,
  occupation TEXT, husband_occupation TEXT,
  previous_pregnancies JSONB DEFAULT '[]'::jsonb,
  remarks TEXT, pelvic_assessment TEXT, special_considerations TEXT,
  high_risk BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  closed_at TIMESTAMPTZ,
  delivery_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_anc_programs_patient ON public.anc_programs(patient_id);
CREATE INDEX idx_anc_programs_status ON public.anc_programs(status);
CREATE UNIQUE INDEX uniq_active_anc_per_patient ON public.anc_programs(patient_id) WHERE status='active';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.anc_programs TO authenticated;
GRANT ALL ON public.anc_programs TO service_role;
ALTER TABLE public.anc_programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anc_programs_view" ON public.anc_programs FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'anc') OR public.has_role(auth.uid(),'nurse') OR
  public.has_role(auth.uid(),'doctor') OR public.has_role(auth.uid(),'doctor1') OR public.has_role(auth.uid(),'doctor2') OR
  public.has_role(auth.uid(),'lab_tech') OR public.has_role(auth.uid(),'pharmacist') OR
  public.has_role(auth.uid(),'receptionist') OR public.has_role(auth.uid(),'billing') OR
  public.has_role(auth.uid(),'admin')
);
CREATE POLICY "anc_programs_insert" ON public.anc_programs FOR INSERT TO authenticated WITH CHECK (
  public.has_role(auth.uid(),'anc') OR public.has_role(auth.uid(),'nurse') OR public.has_role(auth.uid(),'admin')
);
CREATE POLICY "anc_programs_update" ON public.anc_programs FOR UPDATE TO authenticated USING (
  public.has_role(auth.uid(),'anc') OR public.has_role(auth.uid(),'nurse') OR
  public.has_role(auth.uid(),'doctor1') OR public.has_role(auth.uid(),'doctor2') OR public.has_role(auth.uid(),'admin')
);
CREATE POLICY "anc_programs_delete" ON public.anc_programs FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.anc_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER trg_anc_programs_updated BEFORE UPDATE ON public.anc_programs
FOR EACH ROW EXECUTE FUNCTION public.anc_touch_updated_at();

CREATE TABLE public.anc_visits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  anc_program_id UUID NOT NULL REFERENCES public.anc_programs(id) ON DELETE CASCADE,
  visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  week_of_pregnancy INTEGER,
  weight NUMERIC, blood_pressure TEXT, urine TEXT, hb TEXT, oedema TEXT,
  fundal_height TEXT, presentation TEXT, fetal_heart_rate TEXT,
  comment TEXT, next_visit DATE,
  staff_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_anc_visits_program ON public.anc_visits(anc_program_id);
CREATE INDEX idx_anc_visits_date ON public.anc_visits(visit_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.anc_visits TO authenticated;
GRANT ALL ON public.anc_visits TO service_role;
ALTER TABLE public.anc_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anc_visits_view" ON public.anc_visits FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'anc') OR public.has_role(auth.uid(),'nurse') OR
  public.has_role(auth.uid(),'doctor') OR public.has_role(auth.uid(),'doctor1') OR public.has_role(auth.uid(),'doctor2') OR
  public.has_role(auth.uid(),'lab_tech') OR public.has_role(auth.uid(),'pharmacist') OR
  public.has_role(auth.uid(),'billing') OR public.has_role(auth.uid(),'admin')
);
CREATE POLICY "anc_visits_insert" ON public.anc_visits FOR INSERT TO authenticated WITH CHECK (
  public.has_role(auth.uid(),'anc') OR public.has_role(auth.uid(),'nurse') OR
  public.has_role(auth.uid(),'doctor1') OR public.has_role(auth.uid(),'doctor2') OR public.has_role(auth.uid(),'admin')
);
CREATE POLICY "anc_visits_update" ON public.anc_visits FOR UPDATE TO authenticated USING (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'anc')
);
CREATE POLICY "anc_visits_delete" ON public.anc_visits FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

ALTER PUBLICATION supabase_realtime ADD TABLE public.anc_programs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.anc_visits;

CREATE OR REPLACE FUNCTION public.generate_anc_number()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE yr TEXT := to_char(CURRENT_DATE,'YYYY'); seq INTEGER;
BEGIN
  SELECT COUNT(*)+1 INTO seq FROM public.anc_programs WHERE anc_number LIKE 'ANC-'||yr||'-%';
  RETURN 'ANC-'||yr||'-'||lpad(seq::text,5,'0');
END; $$;
