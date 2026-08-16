-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 9
GRANT ALL ON public.sponsor_statement_items TO service_role;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 10
ALTER TABLE public.sponsor_statement_items ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 11
CREATE POLICY "Accountants & admins can view items" ON public.sponsor_statement_items
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]));

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 12
CREATE POLICY "Accountants & admins can manage items" ON public.sponsor_statement_items
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]));

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 13
CREATE INDEX idx_sponsor_statement_items_statement ON public.sponsor_statement_items(statement_id);

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 14
CREATE INDEX idx_sponsor_statements_period ON public.sponsor_statements(period_year, period_month);

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 15
CREATE INDEX idx_sponsor_statements_sponsor ON public.sponsor_statements(sponsor_id);

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 16
CREATE OR REPLACE FUNCTION public.touch_sponsor_statement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 17
REVOKE EXECUTE ON FUNCTION public.touch_sponsor_statement() FROM PUBLIC, anon, authenticated;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 18
CREATE TRIGGER trg_touch_sponsor_statement BEFORE UPDATE ON public.sponsor_statements
  FOR EACH ROW EXECUTE FUNCTION public.touch_sponsor_statement();

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 19
CREATE OR REPLACE FUNCTION public.next_statement_number(_year INT, _month INT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _seq INT; BEGIN
  SELECT COUNT(*) + 1 INTO _seq FROM public.sponsor_statements
    WHERE period_year = _year AND period_month = _month;
  RETURN 'STM-' || _year::TEXT || LPAD(_month::TEXT, 2, '0') || '-' || LPAD(_seq::TEXT, 4, '0');
END; $$;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 20
REVOKE EXECUTE ON FUNCTION public.next_statement_number(INT, INT) FROM PUBLIC, anon, authenticated;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 21
CREATE OR REPLACE FUNCTION public.generate_sponsor_statement(
  _sponsor_id UUID, _year INT, _month INT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _sponsor RECORD;
  _start DATE;
  _end DATE;
  _statement_id UUID;
  _existing_status TEXT;
  _total NUMERIC(14,2) := 0;
  _inv_count INT := 0;
  _pat_count INT := 0;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT id, account_type, company_name INTO _sponsor
    FROM public.corporate_accounts WHERE id = _sponsor_id;
  IF _sponsor.id IS NULL THEN RAISE EXCEPTION 'Sponsor not found'; END IF;
  IF _sponsor.account_type NOT IN ('corporate','retainer') THEN
    RAISE EXCEPTION 'Sponsor is not a corporate or retainer account';
  END IF;

  _start := make_date(_year, _month, 1);
  _end   := (_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  SELECT id, status INTO _statement_id, _existing_status
    FROM public.sponsor_statements
    WHERE sponsor_id = _sponsor_id AND period_year = _year AND period_month = _month;

  IF _statement_id IS NOT NULL THEN
    IF _existing_status IN ('finalized','printed','paid') THEN
      RAISE EXCEPTION 'Statement for % (%-%) is % and cannot be regenerated. Void it first.',
        _sponsor.company_name, _year, _month, _existing_status;
    END IF;
    DELETE FROM public.sponsor_statement_items WHERE statement_id = _statement_id;
  ELSE
    _statement_id := gen_random_uuid();
    INSERT INTO public.sponsor_statements
      (id, statement_number, sponsor_id, sponsor_type, period_year, period_month,
       period_start, period_end, generated_by)
    VALUES
      (_statement_id, public.next_statement_number(_year, _month), _sponsor_id,
       _sponsor.account_type, _year, _month, _start, _end, auth.uid());
  END IF;

  -- Insert every invoice in the period for patients linked to this sponsor
  INSERT INTO public.sponsor_statement_items
    (statement_id, invoice_id, patient_id, amount, service_date)
  SELECT
    _statement_id, i.id, i.patient_id, i.total_amount, i.created_at::date
  FROM public.invoices i
  JOIN public.patients p ON p.id = i.patient_id
  WHERE p.corporate_id = _sponsor_id
    AND p.account_type = _sponsor.account_type
    AND i.created_at >= _start
    AND i.created_at <  (_end + INTERVAL '1 day');

  SELECT COALESCE(SUM(amount),0), COUNT(*), COUNT(DISTINCT patient_id)
    INTO _total, _inv_count, _pat_count
  FROM public.sponsor_statement_items WHERE statement_id = _statement_id;

  UPDATE public.sponsor_statements
    SET total_amount = _total,
        invoice_count = _inv_count,
        patient_count = _pat_count,
        generated_at = now(),
        generated_by = COALESCE(auth.uid(), generated_by),
        status = 'draft'
    WHERE id = _statement_id;

  RETURN _statement_id;
END; $$;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 22
REVOKE EXECUTE ON FUNCTION public.generate_sponsor_statement(UUID, INT, INT) FROM PUBLIC, anon;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 23
GRANT  EXECUTE ON FUNCTION public.generate_sponsor_statement(UUID, INT, INT) TO authenticated;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 24
CREATE OR REPLACE FUNCTION public.generate_all_sponsor_statements(_year INT, _month INT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _rec RECORD; _count INT := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_any_role(auth.uid(), ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  FOR _rec IN
    SELECT id FROM public.corporate_accounts
    WHERE status = 'active' AND account_type IN ('corporate','retainer')
  LOOP
    BEGIN
      PERFORM public.generate_sponsor_statement(_rec.id, _year, _month);
      _count := _count + 1;
    EXCEPTION WHEN OTHERS THEN
      -- skip finalized/existing; keep going
      NULL;
    END;
  END LOOP;
  RETURN _count;
END; $$;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 25
REVOKE EXECUTE ON FUNCTION public.generate_all_sponsor_statements(INT, INT) FROM PUBLIC, anon;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 26
GRANT  EXECUTE ON FUNCTION public.generate_all_sponsor_statements(INT, INT) TO authenticated, service_role;

-- SOURCE: 20260721102532_c96243d9-01c9-4ec5-891d-4cf859b0f11f.sql statement 1
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS insurance_plan TEXT;

-- SOURCE: 20260721102532_c96243d9-01c9-4ec5-891d-4cf859b0f11f.sql statement 2
DO $$ BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'claims_manager';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 1
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

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 2
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultation_notes TO authenticated;

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 3
GRANT ALL ON public.consultation_notes TO service_role;

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 4
ALTER TABLE public.consultation_notes ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 5
CREATE POLICY "Clinical roles read consultation notes"
  ON public.consultation_notes FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','nurse','lab_tech','pharmacist','admin']::app_role[])
  );

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 6
CREATE POLICY "Doctors insert consultation notes"
  ON public.consultation_notes FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','admin']::app_role[])
    AND doctor_id = auth.uid()
  );

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 7
CREATE POLICY "Doctors update own consultation notes"
  ON public.consultation_notes FOR UPDATE TO authenticated
  USING (
    doctor_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 8
CREATE TRIGGER update_consultation_notes_updated_at
  BEFORE UPDATE ON public.consultation_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 9
CREATE INDEX idx_consultation_notes_patient ON public.consultation_notes(patient_id, visit_date DESC);

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 10
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

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 11
GRANT SELECT, INSERT, UPDATE, DELETE ON public.emr_attachments TO authenticated;

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 12
GRANT ALL ON public.emr_attachments TO service_role;

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 13
ALTER TABLE public.emr_attachments ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 14
CREATE POLICY "Clinical roles read EMR attachments"
  ON public.emr_attachments FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','nurse','lab_tech','pharmacist','admin']::app_role[])
  );

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 15
CREATE POLICY "Doctors and nurses upload EMR attachments"
  ON public.emr_attachments FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['doctor','doctor1','doctor2','nurse','admin']::app_role[])
    AND uploaded_by = auth.uid()
  );

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 16
CREATE POLICY "Uploader or admin delete EMR attachments"
  ON public.emr_attachments FOR DELETE TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 17
CREATE INDEX idx_emr_attachments_patient ON public.emr_attachments(patient_id, created_at DESC);

-- SOURCE: 20260721105403_38bdcd76-3e93-4cdc-b8bc-a565a920c4be.sql statement 1
ALTER TABLE public.consultation_notes
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','finalized')),
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;

-- SOURCE: 20260721105403_38bdcd76-3e93-4cdc-b8bc-a565a920c4be.sql statement 2
CREATE INDEX IF NOT EXISTS idx_consultation_notes_status
  ON public.consultation_notes(patient_id, status);

-- SOURCE: 20260721105403_38bdcd76-3e93-4cdc-b8bc-a565a920c4be.sql statement 3
DROP POLICY IF EXISTS "Doctors update own consultation notes" ON public.consultation_notes;

-- SOURCE: 20260721105403_38bdcd76-3e93-4cdc-b8bc-a565a920c4be.sql statement 4
DROP POLICY IF EXISTS "Doctor updates own consultation" ON public.consultation_notes;

-- SOURCE: 20260721105403_38bdcd76-3e93-4cdc-b8bc-a565a920c4be.sql statement 5
CREATE POLICY "Author edits own draft"
  ON public.consultation_notes FOR UPDATE TO authenticated
  USING (doctor_id = auth.uid() AND status = 'draft')
  WITH CHECK (doctor_id = auth.uid());

-- SOURCE: 20260721105554_690fca6a-052a-495f-a060-18e384419eff.sql statement 1
DROP TABLE IF EXISTS public.consultation_notes CASCADE;

-- SOURCE: 20260721105809_452b631b-1f1f-43ae-8f63-fc11b01ff5ac.sql statement 1
CREATE POLICY "Staff can read own record"
ON public.staff
FOR SELECT
TO authenticated
USING (auth_user_id = auth.uid());

-- SOURCE: 20260721105809_452b631b-1f1f-43ae-8f63-fc11b01ff5ac.sql statement 2
DROP POLICY IF EXISTS "Users can read own notifications" ON public.notifications;

-- SOURCE: 20260721105809_452b631b-1f1f-43ae-8f63-fc11b01ff5ac.sql statement 3
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;

-- SOURCE: 20260721105809_452b631b-1f1f-43ae-8f63-fc11b01ff5ac.sql statement 4
CREATE POLICY "Users can read own or targeted notifications"
ON public.notifications
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR (
    user_id IS NULL
    AND target_role IS NOT NULL
    AND public.has_role(auth.uid(), target_role::public.app_role)
  )
);

-- SOURCE: 20260721105809_452b631b-1f1f-43ae-8f63-fc11b01ff5ac.sql statement 5
CREATE POLICY "Users can update own or targeted notifications"
ON public.notifications
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  OR (
    user_id IS NULL
    AND target_role IS NOT NULL
    AND public.has_role(auth.uid(), target_role::public.app_role)
  )
);

-- SOURCE: 20260721105809_452b631b-1f1f-43ae-8f63-fc11b01ff5ac.sql statement 6
DROP POLICY IF EXISTS "Billing and admin can read corporate_accounts" ON public.corporate_accounts;

-- SOURCE: 20260721105809_452b631b-1f1f-43ae-8f63-fc11b01ff5ac.sql statement 7
CREATE POLICY "Billing and admin can read corporate_accounts"
ON public.corporate_accounts
FOR SELECT
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['billing'::app_role, 'admin'::app_role, 'accountant'::app_role]));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 1
DROP POLICY IF EXISTS "Admin and account can read staff" ON public.staff;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 2
DROP POLICY IF EXISTS "Only admin can delete staff" ON public.staff;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 3
DROP POLICY IF EXISTS "Only admin can insert staff" ON public.staff;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 4
DROP POLICY IF EXISTS "Only admin can update staff" ON public.staff;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 5
CREATE POLICY "Admin and account can read staff" ON public.staff
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'billing'::app_role]));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 6
CREATE POLICY "Only admin can delete staff" ON public.staff
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 7
CREATE POLICY "Only admin can insert staff" ON public.staff
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 8
CREATE POLICY "Only admin can update staff" ON public.staff
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 9
DROP POLICY IF EXISTS "Admin can delete shift_periods" ON public.shift_periods;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 10
DROP POLICY IF EXISTS "Admin can insert shift_periods" ON public.shift_periods;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 11
DROP POLICY IF EXISTS "Admin can update shift_periods" ON public.shift_periods;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 12
DROP POLICY IF EXISTS "Authenticated staff can read shift_periods" ON public.shift_periods;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 13
CREATE POLICY "Admin can delete shift_periods" ON public.shift_periods
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 14
CREATE POLICY "Admin can insert shift_periods" ON public.shift_periods
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 15
CREATE POLICY "Admin can update shift_periods" ON public.shift_periods
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 16
CREATE POLICY "Authenticated staff can read shift_periods" ON public.shift_periods
  FOR SELECT TO authenticated USING (is_authenticated_staff());

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 17
DROP POLICY IF EXISTS "Admin can delete shift_assignments" ON public.shift_assignments;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 18
DROP POLICY IF EXISTS "Admin can insert shift_assignments" ON public.shift_assignments;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 19
DROP POLICY IF EXISTS "Admin can update shift_assignments" ON public.shift_assignments;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 20
DROP POLICY IF EXISTS "Staff can read own assignments" ON public.shift_assignments;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 21
CREATE POLICY "Admin can delete shift_assignments" ON public.shift_assignments
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 22
CREATE POLICY "Admin can insert shift_assignments" ON public.shift_assignments
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 23
CREATE POLICY "Admin can update shift_assignments" ON public.shift_assignments
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 24
CREATE POLICY "Staff can read own assignments" ON public.shift_assignments
  FOR SELECT TO authenticated
  USING ((staff_user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 25
DROP POLICY IF EXISTS "Staff can insert own shift_logs" ON public.shift_logs;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 26
DROP POLICY IF EXISTS "Staff can read own logs and admin can read all" ON public.shift_logs;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 27
DROP POLICY IF EXISTS "Staff can update own shift_logs" ON public.shift_logs;

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 28
CREATE POLICY "Staff can insert own shift_logs" ON public.shift_logs
  FOR INSERT TO authenticated WITH CHECK (staff_user_id = auth.uid());

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 29
CREATE POLICY "Staff can read own logs and admin can read all" ON public.shift_logs
  FOR SELECT TO authenticated
  USING ((staff_user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260721105952_58ab7cc2-df18-44aa-99c1-55deede07001.sql statement 30
CREATE POLICY "Staff can update own shift_logs" ON public.shift_logs
  FOR UPDATE TO authenticated
  USING ((staff_user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));
