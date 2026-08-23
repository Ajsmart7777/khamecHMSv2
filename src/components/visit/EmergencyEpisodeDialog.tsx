import { useMemo, useState } from 'react';
import { AlertTriangle, Beaker, CheckCircle2, Loader2, Pill, Plus, Receipt, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { usePricelist } from '@/hooks/usePricelist';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Props {
  patientId: string;
  patientName: string;
  visitId?: string | null;
  admissionId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

type MedicationDraft = {
  id: string;
  pricelistId: string;
  description: string;
  strength: string;
  route: string;
  quantity: number;
  notes: string;
  administeredNow: boolean;
};

type LabDraft = { id: string; tests: string; diagnosis: string; total: string; notes: string };

const emptyMedication = (): MedicationDraft => ({
  id: crypto.randomUUID(), pricelistId: '', description: '', strength: '', route: '', quantity: 1, notes: '', administeredNow: true,
});
const emptyLab = (): LabDraft => ({ id: crypto.randomUUID(), tests: '', diagnosis: '', total: '', notes: '' });
const fmt = (n: number) => `₦${Number(n || 0).toLocaleString()}`;

export function EmergencyEpisodeDialog({ patientId, patientName, visitId = null, admissionId = null, open, onOpenChange, onSaved }: Props) {
  const { items: pricelist, loading: pricelistLoading } = usePricelist();
  const [episodeId, setEpisodeId] = useState<string | null>(null);
  const [medications, setMedications] = useState<MedicationDraft[]>([emptyMedication()]);
  const [labs, setLabs] = useState<LabDraft[]>([emptyLab()]);
  const [episodeNote, setEpisodeNote] = useState('');
  const [billingNote, setBillingNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [reconciled, setReconciled] = useState<{ invoice_id?: string; total?: number } | null>(null);

  const medicationPricelist = useMemo(() => pricelist.filter((item: any) => {
    const category = String(item.category ?? '').toLowerCase();
    return item.active !== false && (category.startsWith('drug') || category === 'consumable');
  }), [pricelist]);

  const reset = () => {
    setEpisodeId(null);
    setMedications([emptyMedication()]);
    setLabs([emptyLab()]);
    setEpisodeNote('');
    setBillingNote('');
    setReconciled(null);
    setBusy(false);
  };

  const close = () => { if (!busy) { reset(); onOpenChange(false); } };

  const ensureEpisode = async () => {
    if (episodeId) return episodeId;
    const { data, error } = await (supabase.rpc as any)('start_emergency_episode', {
      _patient_id: patientId,
      _visit_id: visitId,
      _admission_id: admissionId,
      _notes: episodeNote.trim() || null,
    });
    if (error) throw error;
    const id = String(data);
    setEpisodeId(id);
    return id;
  };

  const updateMedication = (id: string, patch: Partial<MedicationDraft>) =>
    setMedications(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item));
  const updateLab = (id: string, patch: Partial<LabDraft>) =>
    setLabs(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item));

  const saveMedication = async (draft: MedicationDraft) => {
    if (!draft.pricelistId && !draft.description.trim()) {
      toast.error('Select a medicine or enter its description'); return;
    }
    if (!draft.strength.trim() || !draft.route.trim()) {
      toast.error('Enter the medicine strength and route'); return;
    }
    setBusy(true);
    try {
      const id = await ensureEpisode();
      const selected = medicationPricelist.find((item: any) => item.id === draft.pricelistId);
      const { error } = await (supabase.rpc as any)('record_emergency_medication', {
        _episode_id: id,
        _pricelist_id: draft.pricelistId || null,
        _description: draft.description.trim() || selected?.name || null,
        _strength: draft.strength.trim(),
        _route: draft.route.trim(),
        _quantity: draft.quantity,
        _unit_price: draft.pricelistId ? null : 0,
        _administered_now: draft.administeredNow,
        _notes: draft.notes.trim() || null,
      });
      if (error) throw error;
      setMedications(prev => [...prev.filter(item => item.id !== draft.id), emptyMedication()]);
      toast.success(draft.administeredNow ? 'Emergency medication recorded' : 'Medicine added for pharmacy later', { description: draft.administeredNow ? 'Given now — will be billed during reconciliation and not re-dispensed.' : 'Will be billed and released to Pharmacy after payment.' });
    } catch (error: any) {
      toast.error(error?.message || 'Could not record emergency medication');
    } finally { setBusy(false); }
  };

  const saveLab = async (draft: LabDraft) => {
    const tests = draft.tests.split(/[\n,]+/).map(test => test.trim()).filter(Boolean);
    if (!tests.length) { toast.error('Enter at least one laboratory test'); return; }
    setBusy(true);
    try {
      const id = await ensureEpisode();
      const { error } = await (supabase.rpc as any)('record_emergency_lab_request', {
        _episode_id: id,
        _tests: tests,
        _diagnosis: draft.diagnosis.trim() || null,
        _total: draft.total.trim() ? Number(draft.total) : 0,
        _notes: draft.notes.trim() || null,
      });
      if (error) throw error;
      setLabs(prev => [...prev.filter(item => item.id !== draft.id), emptyLab()]);
      toast.success('Emergency lab request sent', { description: 'Lab may perform now — billing remains pending.' });
    } catch (error: any) {
      toast.error(error?.message || 'Could not record emergency lab request');
    } finally { setBusy(false); }
  };

  const reconcile = async () => {
    if (!episodeId) { toast.error('Record at least one emergency medication or lab request first'); return; }
    setBusy(true);
    try {
      const { data, error } = await (supabase.rpc as any)('reconcile_emergency_episode', {
        _episode_id: episodeId,
        _billing_note: billingNote.trim() || null,
      });
      if (error) throw error;
      setReconciled(data || {});
      toast.success('Emergency episode sent to Billing', { description: 'One invoice was created for the emergency episode.' });
      onSaved?.();
    } catch (error: any) {
      toast.error(error?.message || 'Could not reconcile emergency episode');
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) close(); else onOpenChange(value); }}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" /> Emergency Episode · {patientName}</DialogTitle>
        </DialogHeader>

        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm">
          <p className="font-semibold text-amber-900 dark:text-amber-200">Give/document urgent care now. Billing comes later.</p>
          <p className="text-xs text-amber-800/80 dark:text-amber-200/80 mt-1">Medication recorded here is marked administered and will not be sent for re-dispensing. Lab work is authorized for immediate processing while its invoice remains billing-pending.</p>
        </div>

        <div className="space-y-2">
          <Label>Emergency summary (optional)</Label>
          <Textarea value={episodeNote} onChange={e => setEpisodeNote(e.target.value)} placeholder="Brief emergency reason or stabilization note…" rows={2} disabled={!!episodeId || busy} />
        </div>

        <section className="rounded-xl border p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2"><Pill className="h-4 w-4 text-module-pharmacy" /><h3 className="font-semibold text-sm">Medication given now</h3><Badge variant="outline">{medications.length}</Badge></div>
            <Button type="button" size="sm" variant="outline" onClick={() => setMedications(prev => [...prev, emptyMedication()])} disabled={busy}><Plus className="h-3.5 w-3.5 mr-1" /> Add medicine</Button>
          </div>
          {medications.map((draft) => (
            <div key={draft.id} className="rounded-lg border bg-muted/20 p-3 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Medicine from pricelist</Label><select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={draft.pricelistId} onChange={e => updateMedication(draft.id, { pricelistId: e.target.value, description: '' })} disabled={busy || pricelistLoading}><option value="">Select medicine…</option>{medicationPricelist.map((item: any) => <option key={item.id} value={item.id}>{item.name}{item.size ? ` · ${item.size}` : ''} — {fmt(item.price)}</option>)}</select></div>
                <div className="space-y-1"><Label className="text-xs">Or description (if not listed)</Label><Input value={draft.description} onChange={e => updateMedication(draft.id, { description: e.target.value, pricelistId: '' })} placeholder="e.g. IV Aminophylline" disabled={busy} /></div>
                <div className="space-y-1"><Label className="text-xs">Strength *</Label><Input value={draft.strength} onChange={e => updateMedication(draft.id, { strength: e.target.value })} placeholder="250 mg" disabled={busy} /></div>
                <div className="space-y-1"><Label className="text-xs">Route *</Label><Input value={draft.route} onChange={e => updateMedication(draft.id, { route: e.target.value })} placeholder="IV / IM / oral" disabled={busy} /></div>
                <div className="space-y-1"><Label className="text-xs">Quantity</Label><Input type="number" min={1} value={draft.quantity} onChange={e => updateMedication(draft.id, { quantity: Math.max(1, Number(e.target.value) || 1) })} disabled={busy} /></div>
                <div className="space-y-1"><Label className="text-xs">Note (optional)</Label><Input value={draft.notes} onChange={e => updateMedication(draft.id, { notes: e.target.value })} placeholder="Emergency administration note" disabled={busy} /></div>
                <label className="md:col-span-2 flex items-start gap-2 rounded-md border bg-background p-2 text-xs"><Checkbox checked={draft.administeredNow} onCheckedChange={value => updateMedication(draft.id, { administeredNow: Boolean(value) })} disabled={busy} /><span><span className="font-medium">Already administered now</span><span className="block text-muted-foreground">Leave checked for emergency medicines already given. Untick for a medicine that should wait for Cashier payment and Pharmacy dispensing.</span></span></label>
              </div>
              <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => setMedications(prev => prev.filter(item => item.id !== draft.id))} disabled={busy || medications.length === 1}><Trash2 className="h-3.5 w-3.5 mr-1" /> Remove</Button><Button type="button" size="sm" onClick={() => saveMedication(draft)} disabled={busy}><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> {draft.administeredNow ? 'Record as given' : 'Add for pharmacy later'}</Button></div>
            </div>
          ))}
        </section>

        <section className="rounded-xl border p-4 space-y-3">
          <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Beaker className="h-4 w-4 text-module-laboratory" /><h3 className="font-semibold text-sm">Emergency laboratory request</h3><Badge variant="outline">{labs.length}</Badge></div><Button type="button" size="sm" variant="outline" onClick={() => setLabs(prev => [...prev, emptyLab()])} disabled={busy}><Plus className="h-3.5 w-3.5 mr-1" /> Add lab request</Button></div>
          {labs.map(draft => (
            <div key={draft.id} className="rounded-lg border bg-muted/20 p-3 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3"><div className="space-y-1 md:col-span-2"><Label className="text-xs">Tests * (comma or new line separated)</Label><Textarea value={draft.tests} onChange={e => updateLab(draft.id, { tests: e.target.value })} placeholder="FBC, electrolytes, malaria test" rows={2} disabled={busy} /></div><div className="space-y-1"><Label className="text-xs">Diagnosis/context</Label><Input value={draft.diagnosis} onChange={e => updateLab(draft.id, { diagnosis: e.target.value })} placeholder="Optional clinical context" disabled={busy} /></div><div className="space-y-1"><Label className="text-xs">Estimated lab total (optional)</Label><Input type="number" min={0} value={draft.total} onChange={e => updateLab(draft.id, { total: e.target.value })} placeholder="0" disabled={busy} /></div><div className="space-y-1 md:col-span-2"><Label className="text-xs">Note (optional)</Label><Input value={draft.notes} onChange={e => updateLab(draft.id, { notes: e.target.value })} placeholder="Emergency lab note" disabled={busy} /></div></div>
              <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => setLabs(prev => prev.filter(item => item.id !== draft.id))} disabled={busy || labs.length === 1}><Trash2 className="h-3.5 w-3.5 mr-1" /> Remove</Button><Button type="button" size="sm" onClick={() => saveLab(draft)} disabled={busy}><Beaker className="h-3.5 w-3.5 mr-1" /> Authorize lab now</Button></div>
            </div>
          ))}
        </section>

        {episodeId && !reconciled && <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2"><div className="flex items-center gap-2 text-sm font-semibold"><Receipt className="h-4 w-4" /> Episode is open</div><p className="text-xs text-muted-foreground">Add any further emergency medicine or lab request, then reconcile all recorded items into one invoice.</p><Label className="text-xs">Billing note (optional)</Label><Input value={billingNote} onChange={e => setBillingNote(e.target.value)} placeholder="Emergency episode billing note" disabled={busy} /></div>}
        {reconciled && <div className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 p-3 text-sm"><p className="font-semibold text-emerald-800 dark:text-emerald-200">Sent to Billing</p><p className="text-xs mt-1">Invoice: <span className="font-mono">{reconciled.invoice_id}</span> · Total: {fmt(Number(reconciled.total || 0))}</p></div>}

        <DialogFooter className="gap-2"><Button variant="ghost" onClick={close} disabled={busy}>{reconciled ? 'Close' : 'Save for later'}</Button>{episodeId && !reconciled && <Button onClick={reconcile} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Receipt className="h-4 w-4 mr-2" />}Reconcile & Send to Billing</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
