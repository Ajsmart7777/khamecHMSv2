ALTER TABLE public.consultation_notes
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','finalized')),
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_consultation_notes_status
  ON public.consultation_notes(patient_id, status);

-- Restrict edits to the author AND only while still draft
DROP POLICY IF EXISTS "Doctors update own consultation notes" ON public.consultation_notes;
DROP POLICY IF EXISTS "Doctor updates own consultation" ON public.consultation_notes;

CREATE POLICY "Author edits own draft"
  ON public.consultation_notes FOR UPDATE TO authenticated
  USING (doctor_id = auth.uid() AND status = 'draft')
  WITH CHECK (doctor_id = auth.uid());