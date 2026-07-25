import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Shield, Save, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MemberIdFieldsEditor } from '@/components/insurance/MemberIdFieldsEditor';
import type { ProviderField } from '@/lib/providerFields';
import {
  useInsuranceTemplates,
  TEMPLATE_LABELS,
  DEFAULT_TEMPLATES,
  type InsuranceTemplateKey,
} from '@/hooks/useInsuranceTemplates';

const TYPES: InsuranceTemplateKey[] = ['nhis', 'katchma', 'hmo'];

const DESCRIPTIONS: Record<InsuranceTemplateKey, string> = {
  nhis: 'NHIA scheme ne kai tsaye — babu wani sub-provider. Saita fields ɗin da Reception zai cika (misali Enrollee ID).',
  katchma: 'KATCHMA scheme ne kai tsaye — babu sub-provider. Saita fields ɗin da Reception zai cika.',
  hmo: 'HMO na iya zama Hygeia, Axa Mansard, da sauransu. Ka saka field ɗin "Provider Name" domin Reception ta rubuta sunan HMO, sa\'annan sauran fields kamar Enrollee Code, Call-Up Number, etc.',
};

export function InsuranceManager() {
  const { templates, loading, save } = useInsuranceTemplates();
  const [draft, setDraft] = useState<Record<InsuranceTemplateKey, ProviderField[]>>(templates);
  const [saving, setSaving] = useState<InsuranceTemplateKey | null>(null);

  useEffect(() => { setDraft(templates); }, [templates]);

  const handleSave = async (key: InsuranceTemplateKey) => {
    setSaving(key);
    const next = { ...templates, [key]: draft[key] };
    const ok = await save(next);
    setSaving(null);
    if (ok) toast.success(`${TEMPLATE_LABELS[key]} template saved`);
    else toast.error('Failed to save template');
  };

  const handleReset = (key: InsuranceTemplateKey) => {
    setDraft((prev) => ({ ...prev, [key]: DEFAULT_TEMPLATES[key] }));
  };

  return (
    <div className="bg-card rounded-xl border border-border">
      <div className="p-4 border-b border-border">
        <h3 className="font-semibold flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          Insurance Registration Templates
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Saita fields ɗin da Reception zata cika sanda take register din insured patient. Kowane insurance type yana da template ɗinsa.
        </p>
      </div>

      <Tabs defaultValue="nhis" className="p-4">
        <TabsList className="mb-4">
          {TYPES.map((k) => (
            <TabsTrigger key={k} value={k}>{TEMPLATE_LABELS[k]}</TabsTrigger>
          ))}
        </TabsList>

        {TYPES.map((key) => (
          <TabsContent key={key} value={key} className="space-y-4">
            <div className="text-sm p-3 rounded-lg bg-primary/5 border border-primary/20">
              {DESCRIPTIONS[key]}
            </div>

            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
            ) : (
              <>
                <MemberIdFieldsEditor
                  value={draft[key] || []}
                  onChange={(fields) => setDraft((prev) => ({ ...prev, [key]: fields }))}
                />
                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button variant="outline" size="sm" onClick={() => handleReset(key)}>
                    <RotateCcw className="h-4 w-4 mr-1" /> Reset to defaults
                  </Button>
                  <Button size="sm" onClick={() => handleSave(key)} disabled={saving === key}>
                    <Save className="h-4 w-4 mr-1" /> {saving === key ? 'Saving…' : 'Save template'}
                  </Button>
                </div>
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
