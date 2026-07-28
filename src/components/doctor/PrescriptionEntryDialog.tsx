import { useEffect, useState } from 'react';
import { Plus, Trash2, Pill, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { usePrescriptions } from '@/hooks/usePrescriptions';
import { fuzzyMatchPricelist, PricelistItem } from '@/hooks/usePricelist';
import { supabase } from '@/integrations/supabase/client';
import { findOpenVisit } from '@/hooks/useVisits';

interface Line {
  medication: string;
  dosage: string;
  frequency: string;
  duration: string;
  quantity: number;
  suggestions?: PricelistItem[];
}

const EMPTY: Line = { medication: '', dosage: '', frequency: '', duration: '', quantity: 1 };

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  patientId: string;
  patientName: string;
  onCreated?: () => void;
}

export function PrescriptionEntryDialog({ open, onOpenChange, patientId, patientName, onCreated }: Props) {
  const { createPrescription } = usePrescriptions();
  const [diagnosis, setDiagnosis] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDiagnosis('');
      setNotes('');
      setLines([{ ...EMPTY }]);
    }
  }, [open]);

  const updateLine = (i: number, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  const runSuggest = async (i: number, q: string) => {
    if (q.trim().length < 2) {
      updateLine(i, { suggestions: [] });
      return;
    }
    const results = await fuzzyMatchPricelist(q, 5);
    const drugs = results.filter((r) => r.category.startsWith('drug_') || r.category === 'consumable');
    updateLine(i, { suggestions: drugs });
  };

  const pickSuggestion = (i: number, item: PricelistItem) => {
    updateLine(i, {
      medication: `${item.name}${item.size ? ` ${item.size}` : ''}`,
      suggestions: [],
    });
  };

  const addLine = () => setLines((prev) => [...prev, { ...EMPTY }]);
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    const valid = lines.filter((l) => l.medication.trim());
    if (valid.length === 0) {
      toast.error('Add at least one medication');
      return;
    }
    if (valid.some((l) => !l.dosage.trim() || !l.frequency.trim() || !l.duration.trim() || l.quantity <= 0)) {
      toast.error('Fill dosage, frequency, duration, and quantity for every medication');
      return;
    }
    setSaving(true);
    try {
      const created = await createPrescription(patientId, diagnosis.trim(), valid.map((l) => ({
        medication: l.medication.trim(),
        dosage: l.dosage.trim(),
        frequency: l.frequency.trim(),
        duration: l.duration.trim(),
        quantity: l.quantity,
      })));
      if (!created) throw new Error('Failed to create prescription');

      // Attach visit + notes if we have them (hook doesn't set these).
      const visit = await findOpenVisit(patientId).catch(() => null);
      const patch: Record<string, any> = {};
      if (notes.trim()) patch.notes = notes.trim();
      if (visit?.id) patch.visit_id = visit.id;
      if (Object.keys(patch).length > 0) {
        await supabase.from('prescriptions').update(patch).eq('id', created.id);
      }

      toast.success('Prescription created', {
        description: `${valid.length} medication${valid.length === 1 ? '' : 's'} sent to Pharmacy`,
      });
      onCreated?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create prescription');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pill className="h-5 w-5 text-module-doctor" />
            New Prescription
          </DialogTitle>
          <DialogDescription>{patientName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="dx">Diagnosis</Label>
            <Input
              id="dx"
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              placeholder="e.g. Malaria, URTI"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Medications</Label>
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            </div>

            {lines.map((l, i) => (
              <div key={i} className="border border-border rounded-lg p-3 space-y-2 relative">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <div className="sm:col-span-5 relative">
                    <Label className="text-xs">Medication</Label>
                    <Input
                      value={l.medication}
                      onChange={(e) => {
                        updateLine(i, { medication: e.target.value });
                        runSuggest(i, e.target.value);
                      }}
                      placeholder="Search drug…"
                    />
                    {l.suggestions && l.suggestions.length > 0 && (
                      <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                        {l.suggestions.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => pickSuggestion(i, s)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
                          >
                            <div className="font-medium">{s.name} {s.size ?? ''}</div>
                            <div className="text-xs text-muted-foreground">₦{Number(s.price).toLocaleString()}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Dosage</Label>
                    <Input value={l.dosage} onChange={(e) => updateLine(i, { dosage: e.target.value })} placeholder="500 mg" />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Frequency</Label>
                    <Input value={l.frequency} onChange={(e) => updateLine(i, { frequency: e.target.value })} placeholder="TDS" />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Duration</Label>
                    <Input value={l.duration} onChange={(e) => updateLine(i, { duration: e.target.value })} placeholder="5 days" />
                  </div>
                  <div className="sm:col-span-1">
                    <Label className="text-xs">Qty</Label>
                    <Input
                      type="number"
                      min={1}
                      value={l.quantity}
                      onChange={(e) => updateLine(i, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                    />
                  </div>
                </div>
                {lines.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute -top-2 -right-2 h-7 w-7 p-0 text-destructive"
                    onClick={() => removeLine(i)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          <div>
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : 'Send to Pharmacy'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}