import { useCallback, useEffect, useState } from 'react';
import { createRealtimeChannel, supabase } from '@/integrations/supabase/client';
import { logError } from '@/lib/errorHandler';
import { normaliseFields, type ProviderField } from '@/lib/providerFields';

export type InsuranceTemplateKey = 'nhis' | 'katchma' | 'hmo';

export const TEMPLATE_LABELS: Record<InsuranceTemplateKey, string> = {
  nhis: 'NHIA',
  katchma: 'KATCHMA',
  hmo: 'HMO',
};

/** Defaults shown the first time a Claims Manager opens the editor. */
export const DEFAULT_TEMPLATES: Record<InsuranceTemplateKey, ProviderField[]> = {
  nhis: [
    { key: 'enrollee_id', label: 'Enrollee ID', required: true, primary: true },
  ],
  katchma: [
    { key: 'enrollee_id', label: 'Enrollee ID', required: true, primary: true },
  ],
  hmo: [
    { key: 'provider_name', label: 'Provider Name', required: true, placeholder: 'e.g. Hygeia, Axa Mansard' },
    { key: 'enrollee_id', label: 'Enrollee ID', required: true, primary: true },
    { key: 'call_up_number', label: 'Call-Up Number' },
  ],
};

const SETTINGS_KEY = 'insurance_templates';

export type InsuranceTemplates = Record<InsuranceTemplateKey, ProviderField[]>;

function coerceTemplates(raw: unknown): InsuranceTemplates {
  const obj = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  return {
    nhis: normaliseFieldsOr(obj.nhis, DEFAULT_TEMPLATES.nhis),
    katchma: normaliseFieldsOr(obj.katchma, DEFAULT_TEMPLATES.katchma),
    hmo: normaliseFieldsOr(obj.hmo, DEFAULT_TEMPLATES.hmo),
  };
}

function normaliseFieldsOr(raw: unknown, fallback: ProviderField[]): ProviderField[] {
  if (!Array.isArray(raw)) return fallback;
  const out = normaliseFields(raw);
  return out.length > 0 ? out : fallback;
}

export function useInsuranceTemplates() {
  const [templates, setTemplates] = useState<InsuranceTemplates>(DEFAULT_TEMPLATES);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', SETTINGS_KEY)
        .maybeSingle();
      if (error) throw error;
      setTemplates(coerceTemplates(data?.value));
    } catch (err) {
      logError('Error loading insurance templates', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const channel = createRealtimeChannel('insurance-templates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings', filter: `key=eq.${SETTINGS_KEY}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const save = useCallback(async (next: InsuranceTemplates): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('app_settings')
        .upsert({ key: SETTINGS_KEY, value: next as any, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw error;
      setTemplates(next);
      return true;
    } catch (err) {
      logError('Error saving insurance templates', err);
      return false;
    }
  }, []);

  const getFields = useCallback((type: string | null | undefined): ProviderField[] => {
    if (type === 'nhis' || type === 'katchma' || type === 'hmo') return templates[type];
    return [];
  }, [templates]);

  return { templates, loading, save, getFields };
}