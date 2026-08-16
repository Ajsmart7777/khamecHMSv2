-- SOURCE: 20260722123425_8ad87bf1-0b64-4709-b1c0-469452ad5b0f.sql statement 2
REVOKE EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) FROM public, anon;

-- SOURCE: 20260722123425_8ad87bf1-0b64-4709-b1c0-469452ad5b0f.sql statement 3
GRANT EXECUTE ON FUNCTION public.discharge_admission(uuid, text, text, numeric, text) TO authenticated;

-- SOURCE: 20260722145620_a5f6b050-69e9-4627-8c4f-0fe2a77da966.sql statement 1
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS occupation TEXT;

-- SOURCE: 20260722145620_a5f6b050-69e9-4627-8c4f-0fe2a77da966.sql statement 2
ALTER TABLE public.patients
  ALTER COLUMN last_name DROP NOT NULL,
  ALTER COLUMN emergency_contact DROP NOT NULL;

-- SOURCE: 20260722161443_6cbd436f-4745-4e96-9540-6aeef8950bc0.sql statement 1
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'anc';

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 1
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
  created_by UUID REFERENCES neon_auth.user(id),
  closed_at TIMESTAMPTZ,
  delivery_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 2
CREATE INDEX idx_anc_programs_patient ON public.anc_programs(patient_id);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 3
CREATE INDEX idx_anc_programs_status ON public.anc_programs(status);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 4
CREATE UNIQUE INDEX uniq_active_anc_per_patient ON public.anc_programs(patient_id) WHERE status='active';

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 5
GRANT SELECT, INSERT, UPDATE, DELETE ON public.anc_programs TO authenticated;

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 6
GRANT ALL ON public.anc_programs TO service_role;

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 7
ALTER TABLE public.anc_programs ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 8
CREATE POLICY "anc_programs_view" ON public.anc_programs FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'anc') OR public.has_role(auth.uid(),'nurse') OR
  public.has_role(auth.uid(),'doctor') OR public.has_role(auth.uid(),'doctor1') OR public.has_role(auth.uid(),'doctor2') OR
  public.has_role(auth.uid(),'lab_tech') OR public.has_role(auth.uid(),'pharmacist') OR
  public.has_role(auth.uid(),'receptionist') OR public.has_role(auth.uid(),'billing') OR
  public.has_role(auth.uid(),'admin')
);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 9
CREATE POLICY "anc_programs_insert" ON public.anc_programs FOR INSERT TO authenticated WITH CHECK (
  public.has_role(auth.uid(),'anc') OR public.has_role(auth.uid(),'nurse') OR public.has_role(auth.uid(),'admin')
);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 10
CREATE POLICY "anc_programs_update" ON public.anc_programs FOR UPDATE TO authenticated USING (
  public.has_role(auth.uid(),'anc') OR public.has_role(auth.uid(),'nurse') OR
  public.has_role(auth.uid(),'doctor1') OR public.has_role(auth.uid(),'doctor2') OR public.has_role(auth.uid(),'admin')
);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 11
CREATE POLICY "anc_programs_delete" ON public.anc_programs FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 12
CREATE OR REPLACE FUNCTION public.anc_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 13
CREATE TRIGGER trg_anc_programs_updated BEFORE UPDATE ON public.anc_programs
FOR EACH ROW EXECUTE FUNCTION public.anc_touch_updated_at();

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 14
CREATE TABLE public.anc_visits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  anc_program_id UUID NOT NULL REFERENCES public.anc_programs(id) ON DELETE CASCADE,
  visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  week_of_pregnancy INTEGER,
  weight NUMERIC, blood_pressure TEXT, urine TEXT, hb TEXT, oedema TEXT,
  fundal_height TEXT, presentation TEXT, fetal_heart_rate TEXT,
  comment TEXT, next_visit DATE,
  staff_id UUID REFERENCES neon_auth.user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 15
CREATE INDEX idx_anc_visits_program ON public.anc_visits(anc_program_id);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 16
CREATE INDEX idx_anc_visits_date ON public.anc_visits(visit_date);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 17
GRANT SELECT, INSERT, UPDATE, DELETE ON public.anc_visits TO authenticated;

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 18
GRANT ALL ON public.anc_visits TO service_role;

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 19
ALTER TABLE public.anc_visits ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 20
CREATE POLICY "anc_visits_view" ON public.anc_visits FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'anc') OR public.has_role(auth.uid(),'nurse') OR
  public.has_role(auth.uid(),'doctor') OR public.has_role(auth.uid(),'doctor1') OR public.has_role(auth.uid(),'doctor2') OR
  public.has_role(auth.uid(),'lab_tech') OR public.has_role(auth.uid(),'pharmacist') OR
  public.has_role(auth.uid(),'billing') OR public.has_role(auth.uid(),'admin')
);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 21
CREATE POLICY "anc_visits_insert" ON public.anc_visits FOR INSERT TO authenticated WITH CHECK (
  public.has_role(auth.uid(),'anc') OR public.has_role(auth.uid(),'nurse') OR
  public.has_role(auth.uid(),'doctor1') OR public.has_role(auth.uid(),'doctor2') OR public.has_role(auth.uid(),'admin')
);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 22
CREATE POLICY "anc_visits_update" ON public.anc_visits FOR UPDATE TO authenticated USING (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'anc')
);

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 23
CREATE POLICY "anc_visits_delete" ON public.anc_visits FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- SOURCE: 20260722162851_2eb749a8-db27-4a17-b769-c749f4b49fcb.sql statement 26
CREATE OR REPLACE FUNCTION public.generate_anc_number()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE yr TEXT := to_char(CURRENT_DATE,'YYYY'); seq INTEGER;
BEGIN
  SELECT COUNT(*)+1 INTO seq FROM public.anc_programs WHERE anc_number LIKE 'ANC-'||yr||'-%';
  RETURN 'ANC-'||yr||'-'||lpad(seq::text,5,'0');
END; $$;

-- SOURCE: 20260722190607_916ae97b-63d7-45e0-848b-b60ba03f8a47.sql statement 1
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS enrollee_id TEXT;

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 1
ALTER TABLE public.snap_orders
  ADD COLUMN IF NOT EXISTS ocr_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS ocr_text text,
  ADD COLUMN IF NOT EXISTS ocr_confidence numeric,
  ADD COLUMN IF NOT EXISTS ocr_model text,
  ADD COLUMN IF NOT EXISTS ocr_matches jsonb,
  ADD COLUMN IF NOT EXISTS ocr_error text,
  ADD COLUMN IF NOT EXISTS ocr_corrected_text text,
  ADD COLUMN IF NOT EXISTS ocr_corrected_by uuid,
  ADD COLUMN IF NOT EXISTS ocr_corrected_at timestamptz;

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 2
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 3
GRANT SELECT ON public.app_settings TO authenticated;

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 4
GRANT ALL ON public.app_settings TO service_role;

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 5
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 6
DROP POLICY IF EXISTS "read settings" ON public.app_settings;

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 7
CREATE POLICY "read settings" ON public.app_settings
  FOR SELECT TO authenticated USING (true);

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 8
DROP POLICY IF EXISTS "admin writes settings" ON public.app_settings;

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 9
CREATE POLICY "admin writes settings" ON public.app_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 10
DROP TRIGGER IF EXISTS app_settings_touch ON public.app_settings;

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 11
CREATE TRIGGER app_settings_touch
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 12
INSERT INTO public.app_settings (key, value)
VALUES ('ocr', jsonb_build_object('model', 'google/gemini-3.1-pro-preview'))
ON CONFLICT (key) DO NOTHING;

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 13
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 14
CREATE INDEX IF NOT EXISTS pricelist_name_trgm ON public.pricelist USING gin (name gin_trgm_ops);

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 15
CREATE INDEX IF NOT EXISTS inventory_items_name_trgm ON public.inventory_items USING gin (name gin_trgm_ops);

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 16
CREATE OR REPLACE FUNCTION public.match_catalogue(_query text, _limit int DEFAULT 3)
RETURNS TABLE (
  source text,
  id uuid,
  name text,
  price numeric,
  score real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  (SELECT 'pricelist'::text AS source, p.id, p.name,
          COALESCE(p.price, 0)::numeric AS price,
          similarity(p.name, _query) AS score
     FROM public.pricelist p
     WHERE p.name % _query
     ORDER BY score DESC
     LIMIT _limit)
  UNION ALL
  (SELECT 'inventory'::text AS source, i.id, i.name,
          COALESCE(i.unit_price, 0)::numeric AS price,
          similarity(i.name, _query) AS score
     FROM public.inventory_items i
     WHERE i.name % _query
     ORDER BY score DESC
     LIMIT _limit)
  ORDER BY score DESC
  LIMIT _limit;
$$;

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 17
REVOKE ALL ON FUNCTION public.match_catalogue(text, int) FROM PUBLIC, anon;

-- SOURCE: 20260722194303_8d8e616f-046f-4451-afcf-2d2b4ca24f10.sql statement 18
GRANT EXECUTE ON FUNCTION public.match_catalogue(text, int) TO authenticated, service_role;

-- SOURCE: 20260722194538_ad8616f2-3796-4b28-aba4-c1b6f0217fd8.sql statement 1
CREATE OR REPLACE FUNCTION public.can_add_snap_for_patient(_patient_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _status text;
  _is_admitted boolean;
BEGIN
  IF _user_id IS NULL OR _patient_id IS NULL THEN RETURN false; END IF;

  -- Admin always allowed.
  IF public.has_role(_user_id, 'admin'::app_role) THEN RETURN true; END IF;

  SELECT status::text INTO _status FROM public.patients WHERE id = _patient_id;
  IF _status IS NULL THEN RETURN false; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.admissions
     WHERE patient_id = _patient_id AND status = 'active'
  ) INTO _is_admitted;

  -- Admitted patients: nursing/doctor roles retain ownership in the ward.
  IF _is_admitted OR _status = 'admitted' THEN
    RETURN public.has_any_role(_user_id,
      ARRAY['nurse','doctor','doctor1','doctor2']::app_role[]);
  END IF;

  RETURN CASE _status
    WHEN 'with_nurse'   THEN public.has_role(_user_id, 'nurse'::app_role)
    WHEN 'with_doctor'  THEN public.has_any_role(_user_id,
                              ARRAY['doctor','doctor1','doctor2']::app_role[])
    WHEN 'in_lab'       THEN public.has_role(_user_id, 'lab_tech'::app_role)
    WHEN 'at_pharmacy'  THEN public.has_role(_user_id, 'pharmacist'::app_role)
    ELSE false
  END;
END;
$$;

-- SOURCE: 20260722194538_ad8616f2-3796-4b28-aba4-c1b6f0217fd8.sql statement 2
REVOKE EXECUTE ON FUNCTION public.can_add_snap_for_patient(uuid, uuid) FROM PUBLIC, anon;

-- SOURCE: 20260722194538_ad8616f2-3796-4b28-aba4-c1b6f0217fd8.sql statement 3
GRANT EXECUTE ON FUNCTION public.can_add_snap_for_patient(uuid, uuid) TO authenticated;

-- SOURCE: 20260722194538_ad8616f2-3796-4b28-aba4-c1b6f0217fd8.sql statement 4
DROP POLICY IF EXISTS "Clinicians create snap orders" ON public.snap_orders;

-- SOURCE: 20260722194538_ad8616f2-3796-4b28-aba4-c1b6f0217fd8.sql statement 5
CREATE POLICY "Owner station can create snap orders"
ON public.snap_orders
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_any_role(auth.uid(),
    ARRAY['nurse','doctor','doctor1','doctor2','lab_tech','pharmacist','admin']::app_role[])
  AND public.can_add_snap_for_patient(patient_id, auth.uid())
);

-- SOURCE: 20260722195524_3fac40c0-504d-42e3-8726-cc9d15c53bdc.sql statement 1
ALTER TABLE public.snap_orders
  ADD COLUMN IF NOT EXISTS ocr_reviewed_lines jsonb,
  ADD COLUMN IF NOT EXISTS ocr_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ocr_reviewed_by uuid;

-- SOURCE: 20260723100418_c1f18793-7e24-465a-a798-5d165562bf18.sql statement 1
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS actor_role text;

-- SOURCE: 20260723100418_c1f18793-7e24-465a-a798-5d165562bf18.sql statement 2
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_role ON public.audit_logs(actor_role);

-- SOURCE: 20260723100418_c1f18793-7e24-465a-a798-5d165562bf18.sql statement 3
CREATE OR REPLACE FUNCTION public.current_actor_role(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT string_agg(role::text, ',' ORDER BY role::text)
  FROM public.user_roles
  WHERE user_id = _user_id
$$;

-- SOURCE: 20260723100418_c1f18793-7e24-465a-a798-5d165562bf18.sql statement 4
REVOKE EXECUTE ON FUNCTION public.current_actor_role(uuid) FROM PUBLIC, anon;

-- SOURCE: 20260723100418_c1f18793-7e24-465a-a798-5d165562bf18.sql statement 5
GRANT EXECUTE ON FUNCTION public.current_actor_role(uuid) TO authenticated, service_role;

-- SOURCE: 20260723100418_c1f18793-7e24-465a-a798-5d165562bf18.sql statement 6
CREATE OR REPLACE FUNCTION public.write_audit_log(
  _action text,
  _resource_type text,
  _resource_id text,
  _details jsonb,
  _status text DEFAULT 'success'::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid  uuid := auth.uid();
  _role text := public.current_actor_role(auth.uid());
BEGIN
  INSERT INTO public.audit_logs
    (user_id, action, resource_type, resource_id, details, status, actor_role)
  VALUES
    (_uid, _action, _resource_type, _resource_id,
     COALESCE(_details, '{}'::jsonb) || jsonb_build_object('actor_role', _role),
     _status, _role);
END;
$$;

-- SOURCE: 20260723101414_686957d0-9e4f-4469-b6b8-e6c32402456c.sql statement 1
ALTER TABLE public.patients DROP CONSTRAINT patients_status_check;

-- SOURCE: 20260723101414_686957d0-9e4f-4469-b6b8-e6c32402456c.sql statement 2
ALTER TABLE public.patients ADD CONSTRAINT patients_status_check CHECK (status = ANY (ARRAY['registered'::text, 'waiting'::text, 'with_nurse'::text, 'with_doctor'::text, 'in_lab'::text, 'awaiting_billing'::text, 'awaiting_payment'::text, 'at_pharmacy'::text, 'admitted'::text, 'discharged'::text, 'awaiting_room'::text]));

-- SOURCE: 20260723102306_7722fdd0-b982-4c1e-88ce-1a32145f2a82.sql statement 1
DROP POLICY IF EXISTS "Ops update snap orders" ON public.snap_orders;

-- SOURCE: 20260723102306_7722fdd0-b982-4c1e-88ce-1a32145f2a82.sql statement 2
CREATE POLICY "Billing update snap orders"
  ON public.snap_orders FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['billing','accountant','admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(),
    ARRAY['billing','accountant','admin']::app_role[]));

-- SOURCE: 20260723102306_7722fdd0-b982-4c1e-88ce-1a32145f2a82.sql statement 3
CREATE POLICY "Fulfillers update only paid snap orders"
  ON public.snap_orders FOR UPDATE TO authenticated
  USING (
    public.has_any_role(auth.uid(),
      ARRAY['pharmacist','lab_tech']::app_role[])
    AND status = 'paid'
  )
  WITH CHECK (
    public.has_any_role(auth.uid(),
      ARRAY['pharmacist','lab_tech']::app_role[])
    AND status IN ('paid','fulfilled','rejected')
  );

-- SOURCE: 20260723102306_7722fdd0-b982-4c1e-88ce-1a32145f2a82.sql statement 4
CREATE OR REPLACE FUNCTION public.enforce_snap_paid_before_fulfill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'fulfilled'
     AND COALESCE(OLD.status,'') <> 'fulfilled'
     AND COALESCE(OLD.status,'') <> 'paid' THEN
    RAISE EXCEPTION 'PAYMENT_REQUIRED: snap % must be paid before it can be fulfilled (current status: %)',
      NEW.id, OLD.status;
  END IF;
  RETURN NEW;
END;
$$;

-- SOURCE: 20260723102306_7722fdd0-b982-4c1e-88ce-1a32145f2a82.sql statement 5
REVOKE EXECUTE ON FUNCTION public.enforce_snap_paid_before_fulfill() FROM PUBLIC, anon;

-- SOURCE: 20260723102306_7722fdd0-b982-4c1e-88ce-1a32145f2a82.sql statement 6
DROP TRIGGER IF EXISTS trg_snap_paid_before_fulfill ON public.snap_orders;

-- SOURCE: 20260723102306_7722fdd0-b982-4c1e-88ce-1a32145f2a82.sql statement 7
CREATE TRIGGER trg_snap_paid_before_fulfill
  BEFORE UPDATE ON public.snap_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_snap_paid_before_fulfill();

-- SOURCE: 20260723110404_8593a75f-69a4-41f8-9146-671d5ae24a12.sql statement 1
DROP POLICY IF EXISTS "read settings" ON public.app_settings;

-- SOURCE: 20260723110404_8593a75f-69a4-41f8-9146-671d5ae24a12.sql statement 2
CREATE POLICY "Admin reads settings"
  ON public.app_settings
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260723110404_8593a75f-69a4-41f8-9146-671d5ae24a12.sql statement 3
DROP POLICY IF EXISTS "Admin manages wards" ON public.wards;

-- SOURCE: 20260723110404_8593a75f-69a4-41f8-9146-671d5ae24a12.sql statement 4
CREATE POLICY "Admin manages wards"
  ON public.wards
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260723110404_8593a75f-69a4-41f8-9146-671d5ae24a12.sql statement 5
DROP POLICY IF EXISTS "Admin manages rooms" ON public.rooms;

-- SOURCE: 20260723110404_8593a75f-69a4-41f8-9146-671d5ae24a12.sql statement 6
CREATE POLICY "Admin manages rooms"
  ON public.rooms
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- SOURCE: 20260723110404_8593a75f-69a4-41f8-9146-671d5ae24a12.sql statement 7
DROP POLICY IF EXISTS "Admin & nurses manage bed status" ON public.beds;

-- SOURCE: 20260723110404_8593a75f-69a4-41f8-9146-671d5ae24a12.sql statement 8
CREATE POLICY "Admin & nurses manage bed status"
  ON public.beds
  FOR ALL
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','nurse']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','nurse']::app_role[]));

-- SOURCE: 20260723160132_5a6d732f-8e2f-4619-a7d3-0e23b7a53e0e.sql statement 1
DO $$
DECLARE
  _ward_id uuid;
  _room_id uuid;
  _ward_letter text;
  _room_num int;
  _is_vip boolean;
  _daily numeric;
  _room_class text;
BEGIN
  FOREACH _ward_letter IN ARRAY ARRAY['A','B','C','D','E'] LOOP
    _is_vip := (_ward_letter = 'E');
    SELECT id INTO _ward_id FROM public.wards WHERE name = 'Ward ' || _ward_letter LIMIT 1;
    IF _ward_id IS NULL THEN
      INSERT INTO public.wards (name, ward_type, gender, description, active, min_admission_deposit)
      VALUES (
        'Ward ' || _ward_letter,
        CASE WHEN _is_vip THEN 'vip' ELSE 'general' END,
        'any',
        CASE WHEN _is_vip THEN 'VIP ward' ELSE NULL END,
        true,
        0
      )
      RETURNING id INTO _ward_id;
    END IF;

    _daily := CASE WHEN _is_vip THEN 25000 ELSE 5000 END;
    _room_class := CASE WHEN _is_vip THEN 'vip' ELSE 'general' END;

    FOR _room_num IN 1..3 LOOP
      SELECT id INTO _room_id
        FROM public.rooms
        WHERE ward_id = _ward_id AND room_number = _ward_letter || _room_num
        LIMIT 1;
      IF _room_id IS NULL THEN
        INSERT INTO public.rooms (ward_id, room_number, room_class, daily_rate, active)
        VALUES (_ward_id, _ward_letter || _room_num, _room_class, _daily, true)
        RETURNING id INTO _room_id;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM public.beds WHERE room_id = _room_id) THEN
        INSERT INTO public.beds (room_id, bed_label, status, active)
        VALUES (_room_id, 'Bed 1', 'available', true);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- SOURCE: 20260723160132_5a6d732f-8e2f-4619-a7d3-0e23b7a53e0e.sql statement 2
ALTER TABLE public.admissions
  ADD COLUMN IF NOT EXISTS admission_snap_path text,
  ADD COLUMN IF NOT EXISTS admission_note text,
  ADD COLUMN IF NOT EXISTS ready_for_discharge_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_for_discharge_by uuid,
  ADD COLUMN IF NOT EXISTS discharge_order_snap_id uuid;

-- SOURCE: 20260723160132_5a6d732f-8e2f-4619-a7d3-0e23b7a53e0e.sql statement 3
ALTER TABLE public.snap_orders
  ADD COLUMN IF NOT EXISTS intent text;
