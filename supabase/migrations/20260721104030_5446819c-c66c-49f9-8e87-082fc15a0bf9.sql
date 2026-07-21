
CREATE TABLE public.consultation_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL,
  visit_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  subjective TEXT,
  objective TEXT,
  assessment TEXT,
  plan TEXT,
  icd10_code TEXT,
  follow_up_date DATE,
  prescription_id UUID REFERENCES public.prescriptions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultation_notes TO authenticated;
GRANT ALL ON public.consultation_notes TO service_role;

ALTER TABLE public.consultation_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clinical roles read consultation notes"
  ON public.consultation_notes FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','nurse','lab_tech','pharmacist','admin']::app_role[])
  );

CREATE POLICY "Doctors insert consultation notes"
  ON public.consultation_notes FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','admin']::app_role[])
    AND doctor_id = auth.uid()
  );

CREATE POLICY "Doctors update own consultation notes"
  ON public.consultation_notes FOR UPDATE TO authenticated
  USING (
    doctor_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE TRIGGER update_consultation_notes_updated_at
  BEFORE UPDATE ON public.consultation_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

CREATE INDEX idx_consultation_notes_patient ON public.consultation_notes(patient_id, visit_date DESC);


CREATE TABLE public.emr_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  category TEXT NOT NULL DEFAULT 'other',
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.emr_attachments TO authenticated;
GRANT ALL ON public.emr_attachments TO service_role;

ALTER TABLE public.emr_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clinical roles read EMR attachments"
  ON public.emr_attachments FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','nurse','lab_tech','pharmacist','admin']::app_role[])
  );

CREATE POLICY "Doctors and nurses upload EMR attachments"
  ON public.emr_attachments FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','nurse','admin']::app_role[])
    AND uploaded_by = auth.uid()
  );

CREATE POLICY "Uploader or admin delete EMR attachments"
  ON public.emr_attachments FOR DELETE TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE INDEX idx_emr_attachments_patient ON public.emr_attachments(patient_id, created_at DESC);


CREATE POLICY "Clinical roles read EMR files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'emr-attachments'
    AND public.has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','nurse','lab_tech','pharmacist','admin']::app_role[])
  );

CREATE POLICY "Doctors and nurses upload EMR files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'emr-attachments'
    AND public.has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','nurse','admin']::app_role[])
  );

CREATE POLICY "Admin delete EMR files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'emr-attachments'
    AND public.has_role(auth.uid(), 'admin')
  );
