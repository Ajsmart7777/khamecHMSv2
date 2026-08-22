-- CockroachDB clone only: use the faster vision model for routine handwritten snaps.
-- The function also falls back safely if an older Pro preview value remains.
UPDATE public.app_settings
SET value = jsonb_build_object('model', 'google/gemini-2.5-flash'),
    updated_at = now()
WHERE key = 'ocr';
