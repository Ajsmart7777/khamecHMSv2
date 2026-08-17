-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 8
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_deductions TO authenticated;

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 9
GRANT ALL ON public.payroll_deductions TO service_role;

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 10
ALTER TABLE public.payroll_deductions ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 11
CREATE POLICY "Admins & accountants view deductions"
  ON public.payroll_deductions FOR SELECT
  TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['admin','accountant']::app_role[]));

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 12
CREATE POLICY "Admins & accountants manage deductions"
  ON public.payroll_deductions FOR ALL
  TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['admin','accountant']::app_role[]))
  WITH CHECK (public.has_any_role(public.hms_current_user_id(), ARRAY['admin','accountant']::app_role[]));

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 13
CREATE TRIGGER trg_payroll_deductions_updated
  BEFORE UPDATE ON public.payroll_deductions
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 14
CREATE OR REPLACE FUNCTION public.queue_family_deduction_after_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER

AS $$
DECLARE
  _acct text;
  _staff_id uuid;
  _consent boolean;
  _patient_share numeric(12,2);
BEGIN
  SELECT p.account_type, sfm.staff_id, s.family_deduction_consent
    INTO _acct, _staff_id, _consent
  FROM public.patients p
  LEFT JOIN public.staff_family_members sfm ON sfm.patient_id = p.id
  LEFT JOIN public.staff s ON s.id = sfm.staff_id
  WHERE p.id = (NEW).patient_id;

  IF _acct = 'staff_family' AND _staff_id IS NOT NULL AND COALESCE(_consent,false) THEN
    _patient_share := ROUND(COALESCE((NEW).total_amount,0) * 0.5, 2);
    IF _patient_share > 0 THEN
      INSERT INTO public.payroll_deductions
        (staff_id, amount, reason, source_invoice_id, status)
      VALUES
        (_staff_id, _patient_share, 'Family invoice ' || COALESCE((NEW).invoice_number,''), (NEW).id, 'pending');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 15
REVOKE EXECUTE ON FUNCTION public.queue_family_deduction_after_invoice() FROM PUBLIC, anon, authenticated;

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 16
DROP TRIGGER IF EXISTS trg_queue_family_deduction ON public.invoices;

-- SOURCE: 20260721092758_ca46cf83-debd-43e2-bf82-5cad140d1227.sql statement 17
CREATE TRIGGER trg_queue_family_deduction
  AFTER INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.queue_family_deduction_after_invoice();

-- SOURCE: 20260721094415_2bbafb1d-d46a-48ef-8e0f-9db8b029da89.sql statement 1
ALTER TABLE public.corporate_accounts ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'corporate';

-- SOURCE: 20260721094415_2bbafb1d-d46a-48ef-8e0f-9db8b029da89.sql statement 2
UPDATE public.corporate_accounts SET account_type = 'corporate' WHERE account_type IS NULL;

-- SOURCE: 20260721094415_2bbafb1d-d46a-48ef-8e0f-9db8b029da89.sql statement 3
ALTER TABLE public.corporate_accounts DROP CONSTRAINT IF EXISTS corporate_accounts_account_type_check;

-- SOURCE: 20260721094415_2bbafb1d-d46a-48ef-8e0f-9db8b029da89.sql statement 4
ALTER TABLE public.corporate_accounts ADD CONSTRAINT corporate_accounts_account_type_check CHECK (account_type IN ('corporate','retainer'));

-- SOURCE: 20260721094415_2bbafb1d-d46a-48ef-8e0f-9db8b029da89.sql statement 5
CREATE INDEX IF NOT EXISTS idx_corporate_accounts_account_type ON public.corporate_accounts(account_type);

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 1
CREATE TABLE public.sponsor_statements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  statement_number TEXT NOT NULL UNIQUE,
  sponsor_id UUID NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE RESTRICT,
  sponsor_type TEXT NOT NULL CHECK (sponsor_type IN ('corporate','retainer')),
  period_year INT NOT NULL,
  period_month INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  invoice_count INT NOT NULL DEFAULT 0,
  patient_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized','printed','paid','void')),
  notes TEXT,
  generated_by UUID REFERENCES public.auth_users(id),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at TIMESTAMPTZ,
  printed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sponsor_id, period_year, period_month)
);

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 2
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sponsor_statements TO authenticated;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 3
GRANT ALL ON public.sponsor_statements TO service_role;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 4
ALTER TABLE public.sponsor_statements ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 5
CREATE POLICY "Accountants & admins can view statements" ON public.sponsor_statements
  FOR SELECT TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]));

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 6
CREATE POLICY "Accountants & admins can manage statements" ON public.sponsor_statements
  FOR ALL TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]))
  WITH CHECK (public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]));

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 7
CREATE TABLE public.sponsor_statement_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  statement_id UUID NOT NULL REFERENCES public.sponsor_statements(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  amount NUMERIC(14,2) NOT NULL,
  service_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (statement_id, invoice_id)
);

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 8
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sponsor_statement_items TO authenticated;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 9
GRANT ALL ON public.sponsor_statement_items TO service_role;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 10
ALTER TABLE public.sponsor_statement_items ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 11
CREATE POLICY "Accountants & admins can view items" ON public.sponsor_statement_items
  FOR SELECT TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]));

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 12
CREATE POLICY "Accountants & admins can manage items" ON public.sponsor_statement_items
  FOR ALL TO authenticated
  USING (public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]))
  WITH CHECK (public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]));

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 13
CREATE INDEX IF NOT EXISTS idx_sponsor_statement_items_statement ON public.sponsor_statement_items(statement_id);

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 14
CREATE INDEX IF NOT EXISTS idx_sponsor_statements_period ON public.sponsor_statements(period_year, period_month);

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 15
CREATE INDEX IF NOT EXISTS idx_sponsor_statements_sponsor ON public.sponsor_statements(sponsor_id);

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 16
CREATE OR REPLACE FUNCTION public.touch_sponsor_statement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER  AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 17
REVOKE EXECUTE ON FUNCTION public.touch_sponsor_statement() FROM PUBLIC, anon, authenticated;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 18
CREATE TRIGGER trg_touch_sponsor_statement BEFORE UPDATE ON public.sponsor_statements
  FOR EACH ROW EXECUTE FUNCTION public.touch_sponsor_statement();

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 19
CREATE OR REPLACE FUNCTION public.next_statement_number(_year INT, _month INT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER  AS $$
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
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER  AS $$
DECLARE
  _sponsor public.corporate_accounts;
  _start DATE;
  _end DATE;
  _statement_id UUID;
  _existing_status TEXT;
  _total NUMERIC(14,2) := 0;
  _inv_count INT := 0;
  _pat_count INT := 0;
BEGIN
  IF NOT public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _sponsor FROM public.corporate_accounts WHERE id = _sponsor_id;
  IF (_sponsor).id IS NULL THEN RAISE EXCEPTION 'Sponsor not found'; END IF;
  IF (_sponsor).account_type NOT IN ('corporate','retainer') THEN
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
        (_sponsor).company_name, _year, _month, _existing_status;
    END IF;
    DELETE FROM public.sponsor_statement_items WHERE statement_id = _statement_id;
  ELSE
    _statement_id := gen_random_uuid();
    INSERT INTO public.sponsor_statements
      (id, statement_number, sponsor_id, sponsor_type, period_year, period_month,
       period_start, period_end, generated_by)
    VALUES
      (_statement_id, public.next_statement_number(_year, _month), _sponsor_id,
       (_sponsor).account_type, _year, _month, _start, _end, public.hms_current_user_id());
  END IF;

  -- Insert every invoice in the period for patients linked to this sponsor
  INSERT INTO public.sponsor_statement_items
    (statement_id, invoice_id, patient_id, amount, service_date)
  SELECT
    _statement_id, i.id, i.patient_id, i.total_amount, i.created_at::date
  FROM public.invoices i
  JOIN public.patients p ON p.id = i.patient_id
  WHERE p.corporate_id = _sponsor_id::text
    AND p.account_type = (_sponsor).account_type
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
        generated_by = COALESCE(public.hms_current_user_id(), generated_by),
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
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER  AS $$
DECLARE _count INT := 0;
BEGIN
  IF public.hms_current_user_id() IS NOT NULL AND NOT public.has_any_role(public.hms_current_user_id(), ARRAY['accountant','admin']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT COUNT(*) INTO _count FROM (SELECT public.generate_sponsor_statement(id, _year, _month) FROM public.corporate_accounts WHERE status = 'active' AND account_type IN ('corporate','retainer')) AS generated;
  RETURN _count;
END; $$;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 25
REVOKE EXECUTE ON FUNCTION public.generate_all_sponsor_statements(INT, INT) FROM PUBLIC, anon;

-- SOURCE: 20260721095435_05125dbb-de1f-4c52-bd69-0581cc66a8a5.sql statement 26
GRANT  EXECUTE ON FUNCTION public.generate_all_sponsor_statements(INT, INT) TO authenticated, service_role;

-- SOURCE: 20260721102532_c96243d9-01c9-4ec5-891d-4cf859b0f11f.sql statement 1
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS insurance_plan TEXT;

-- SOURCE: 20260721102532_c96243d9-01c9-4ec5-891d-4cf859b0f11f.sql statement 2
ALTER TYPE public.app_role ADD VALUE 'claims_manager';

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
    public.has_any_role(public.hms_current_user_id(), ARRAY['doctor','doctor1','doctor2','nurse','lab_tech','pharmacist','admin']::app_role[])
  );

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 6
CREATE POLICY "Doctors insert consultation notes"
  ON public.consultation_notes FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(public.hms_current_user_id(), ARRAY['doctor','doctor1','doctor2','admin']::app_role[])
    AND doctor_id = public.hms_current_user_id()
  );

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 7
CREATE POLICY "Doctors update own consultation notes"
  ON public.consultation_notes FOR UPDATE TO authenticated
  USING (
    doctor_id = public.hms_current_user_id()
    OR public.has_role(public.hms_current_user_id(), 'admin')
  );

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 8
CREATE TRIGGER update_consultation_notes_updated_at
  BEFORE UPDATE ON public.consultation_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_patients_updated_at();

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 9
CREATE INDEX IF NOT EXISTS idx_consultation_notes_patient ON public.consultation_notes(patient_id, visit_date DESC);

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
    public.has_any_role(public.hms_current_user_id(), ARRAY['doctor','doctor1','doctor2','nurse','lab_tech','pharmacist','admin']::app_role[])
  );

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 15
CREATE POLICY "Doctors and nurses upload EMR attachments"
  ON public.emr_attachments FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(public.hms_current_user_id(), ARRAY['doctor','doctor1','doctor2','nurse','admin']::app_role[])
    AND uploaded_by = public.hms_current_user_id()
  );

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 16
CREATE POLICY "Uploader or admin delete EMR attachments"
  ON public.emr_attachments FOR DELETE TO authenticated
  USING (
    uploaded_by = public.hms_current_user_id()
    OR public.has_role(public.hms_current_user_id(), 'admin')
  );

-- SOURCE: 20260721104030_5446819c-c66c-49f9-8e87-082fc15a0bf9.sql statement 17
CREATE INDEX IF NOT EXISTS idx_emr_attachments_patient ON public.emr_attachments(patient_id, created_at DESC);
