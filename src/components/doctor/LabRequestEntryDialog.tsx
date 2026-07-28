import { useEffect, useMemo, useState } from 'react';
import { FlaskConical, Loader2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useLabRequests } from '@/hooks/useLabRequests';
import { usePricelist } from '@/hooks/usePricelist';
import { supabase } from '@/integrations/supabase/client';
import { findOpenVisit } from '@/hooks/useVisits';

const COMMON_TESTS = [
  'FBC', 'Malaria Parasite', 'Widal', 'H. Pylori', 'HIV Screen',
  'HBsAg', 'HCV', 'Blood Sugar (FBS)', 'Blood Sugar (RBS)',
  'Urinalysis', 'Stool M/C/S', 'Urine M/C/S', 'PCV',
  'ESR', 'LFT', 'E/U/Cr', 'Lipid Profile', 'Pregnancy Test',
];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  patientId: string;
  patientName: string;
  onCreated?: () => void;
}

export function LabRequestEntryDialog({ open, onOpenChange, patientId, patientName, onCreated }: Props) {
  const { createLabRequest } = useLabRequests();
  const { items: pricelist } = usePricelist();
  const [diagnosis, setDiagnosis] = useState('');
  const [tests, setTests] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDiagnosis('');
      setTests([]);
      setSearch('');
    }
  }, [open]);

  const labCatalog = useMemo(
    () => pricelist.filter((i) => i.category === 'lab' && i.active),
    [pricelist],
  );

  const suggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const fromCatalog = labCatalog
      .filter((i) => i.name.toLowerCase().includes(q))
      .map((i) => i.name);
    const fromCommon = COMMON_TESTS.filter((t) => t.toLowerCase().includes(q));
    return Array.from(new Set([...fromCatalog, ...fromCommon])).slice(0, 8);
  }, [labCatalog, search]);

  const addTest = (t: string) => {
    const name = t.trim();
    if (!name) return;
    if (tests.includes(name)) return;
    setTests((prev) => [...prev, name]);
    setSearch('');
  };
  const removeTest = (t: string) => setTests((prev) => prev.filter((x) => x !== t));

  const submit = async () => {
    if (tests.length === 0) {
      toast.error('Add at least one test');
      return;
    }
    setSaving(true);
    try {
      const requestNumber = `LAB-${Date.now().toString().slice(-8)}`;
      const created = await createLabRequest({
        patient_id: patientId,
        request_number: requestNumber,
        tests,
        diagnosis: diagnosis.trim() || undefined,
      });
      if (!created) throw new Error('Failed to create lab request');

      const visit = await findOpenVisit(patientId).catch(() => null);
      if (visit?.id) {
        await supabase.from('lab_requests').update({ visit_id: visit.id }).eq('id', created.id);
      }

      toast.success('Lab request created', {
        description: `${tests.length} test${tests.length === 1 ? '' : 's'} routed to Laboratory`,
      });
      onCreated?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create lab request');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-module-doctor" />
            New Lab Request
          </DialogTitle>
          <DialogDescription>{patientName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="dx">Clinical indication / Diagnosis</Label>
            <Input
              id="dx"
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              placeholder="e.g. Fever ? malaria"
            />
          </div>

          <div>
            <Label>Tests</Label>
            <div className="relative mt-1">
              <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
              <Input
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && search.trim()) {
                    e.preventDefault();
                    addTest(search);
                  }
                }}
                placeholder="Search or type a test, press Enter"
              />
              {suggestions.length > 0 && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => addTest(s)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {tests.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {tests.map((t) => (
                  <Badge key={t} variant="secondary" className="gap-1 py-1">
                    {t}
                    <button type="button" onClick={() => removeTest(t)} className="ml-1 hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            <div className="mt-3">
              <p className="text-xs text-muted-foreground mb-2">Quick add:</p>
              <div className="flex flex-wrap gap-1.5">
                {COMMON_TESTS.slice(0, 10).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => addTest(t)}
                    disabled={tests.includes(t)}
                  >
                    {t}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || tests.length === 0}>
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : `Send to Lab (${tests.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}