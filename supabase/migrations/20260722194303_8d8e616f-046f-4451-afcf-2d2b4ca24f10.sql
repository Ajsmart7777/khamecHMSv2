
-- Phase 1: OCR fields on snap_orders + app_settings + trigram indexes
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

CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read settings" ON public.app_settings;
CREATE POLICY "read settings" ON public.app_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admin writes settings" ON public.app_settings;
CREATE POLICY "admin writes settings" ON public.app_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS app_settings_touch ON public.app_settings;
CREATE TRIGGER app_settings_touch
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed default OCR model
INSERT INTO public.app_settings (key, value)
VALUES ('ocr', jsonb_build_object('model', 'google/gemini-3.1-pro-preview'))
ON CONFLICT (key) DO NOTHING;

-- Trigram indexes for fuzzy matching against catalogues
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS pricelist_name_trgm ON public.pricelist USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS inventory_items_name_trgm ON public.inventory_items USING gin (name gin_trgm_ops);

-- Fuzzy-match helper used by the snap-ocr edge function
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

REVOKE ALL ON FUNCTION public.match_catalogue(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_catalogue(text, int) TO authenticated, service_role;
