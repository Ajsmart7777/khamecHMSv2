import { useEffect, useState } from 'react';
import { AlertTriangle, Beaker, CheckCircle2, Clock, Loader2, Pill, Plus, Receipt, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Props {
  patientId: string;
  patientName: string;
  visitId?: string | null;
  admissionId?: string | null;
  allowMedicine?: boolean;
  canAdmit?: boolean;
  onRequestAdmission?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

type Entry = { id: string; text: string };
type SavedItem = {
  id: string;
  item_type: 'medication' | 'lab';
  description: string;
  quantity?: number;
  status: string;
  administered_now?: boolean;
  created_at?: string;
};

const newEntry = (): Entry => ({ id: crypto.randomUUID(), text: '' });

export function EmergencyEpisodeDialog({ patientId, patientName, visitId = null, admissionId = null, allowMedicine = true, canAdmit = false, onRequestAdmission, open, onOpenChange, onSaved }: Props) {
  const [episodeId, setEpisodeId] = useState<string | null>(null);
  const [episodeNote, setEpisodeNote] = useState('');
  const [medicine, setMedicine] = useState<Entry>(newEntry());
  const [lab, setLab] = useState<Entry>(newEntry());
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [finalized, setFinalized] = useState<{ draft_id?: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const loadOpenEpisode = async () => {
      const { data, error } = await supabase
        .from('emergency_episodes')
        .select('id, notes')
        .eq('patient_id', patientId)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1);
      if (cancelled || error || !data?.[0]) return;
      const current = data[0] as any;
      setEpisodeId(String(current.id));
      setEpisodeNote(current.notes || '');
      const { data: itemRows } = await supabase
        .from('emergency_episode_items')
        .select('id, item_type, description, quantity, status, administered_now, created_at')
        .eq('episode_id', current.id)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: true });
      if (!cancelled) setSavedItems((itemRows ?? []) as SavedItem[]);
    };
    void loadOpenEpisode();
    return () => { cancelled = true; };
  }, [open, patientId]);

  const reset = () => {
    setEpisodeId(null);
    setEpisodeNote('');
    setMedicine(newEntry());
    setLab(newEntry());
    setSavedItems([]);
    setFinalized(null);
    setBusy(false);
  };
  const close = () => { if (!busy) { reset(); onOpenChange(false); } };

  const startNewEpisode = () => {
    if (busy) return;
    // The previous episode is already finalized and remains immutable in the
    // database. Clear only this dialog's local selection so start_emergency_episode
    // creates a separate episode instead of reopening or mixing old items.
    setEpisodeId(null);
    setEpisodeNote('');
    setMedicine(newEntry());
    setLab(newEntry());
    setSavedItems([]);
    setFinalized(null);
  };

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

  const saveMedicine = async () => {
    const text = medicine.text.trim();
    if (!text) { toast.error('Write the emergency medicine details first'); return; }
    setBusy(true);
    try {
      const id = await ensureEpisode();
      const { data, error } = await (supabase.rpc as any)('record_emergency_medication', {
        _episode_id: id,
        _pricelist_id: null,
        _description: text,
        _strength: null,
        _route: null,
        _quantity: 1,
        _unit_price: 0,
        _administered_now: true,
        _notes: 'Plain-text emergency medicine received/administered before billing.',
      });
      if (error) throw error;
      setSavedItems(prev => [...prev, { id: String(data), item_type: 'medication', description: text, quantity: 1, status: 'given_now', administered_now: true, created_at: new Date().toISOString() }]);
      setMedicine(newEntry());
      toast.success('Emergency medicine saved', { description: 'It has been recorded and will be matched to the pricelist in Billing later.' });
      onSaved?.();
    } catch (error: any) { toast.error(error?.message || 'Could not save emergency medicine'); }
    finally { setBusy(false); }
  };

  const saveLab = async () => {
    const text = lab.text.trim();
    if (!text) { toast.error('Write the emergency laboratory test first'); return; }
    setBusy(true);
    try {
      const id = await ensureEpisode();
      const { data, error } = await (supabase.rpc as any)('record_emergency_lab_request', {
        _episode_id: id,
        _tests: [text],
        _diagnosis: null,
        _total: 0,
        _notes: 'Plain-text emergency laboratory request; authorized before billing.',
      });
      if (error) throw error;
      setSavedItems(prev => [...prev, { id: crypto.randomUUID(), item_type: 'lab', description: text, quantity: 1, status: 'authorized', administered_now: false, created_at: new Date().toISOString() }]);
      setLab(newEntry());
      toast.success('Emergency lab request sent to Lab', { description: 'Lab can perform it immediately; billing remains pending.' });
      onSaved?.();
      void id;
    } catch (error: any) { toast.error(error?.message || 'Could not send emergency lab request'); }
    finally { setBusy(false); }
  };

  const finalize = async () => {
    if (!episodeId) { toast.error('Save at least one emergency medicine or laboratory test first'); return; }
    if (savedItems.length === 0) { toast.error('Save at least one emergency item first'); return; }
    setBusy(true);
    try {
      const { data, error } = await (supabase.rpc as any)('reconcile_emergency_episode', {
        _episode_id: episodeId,
        _billing_note: 'Emergency Episode billing draft' + (episodeNote.trim() ? ` — ${episodeNote.trim()}` : ''),
      });
      if (error) throw error;
      const result = (data || {}) as any;
      setFinalized({ draft_id: result.billing_draft_id || result.draft_id });
      toast.success('Emergency Episode finalized to Billing draft', { description: 'Billing will match each text line to the pricelist before creating one invoice.' });
      onSaved?.();
    } catch (error: any) { toast.error(error?.message || 'Could not finalize Emergency Episode'); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) close(); else onOpenChange(value); }}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" /> Emergency Episode · {patientName}</DialogTitle>
        </DialogHeader>

        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm">
          <p className="font-semibold text-amber-900 dark:text-amber-200">Record urgent care now. Do not wait for payment.</p>
          <p className="text-xs text-amber-800/80 dark:text-amber-200/80 mt-1">Write what was received or requested in plain text. Medicines are treated as already received/administered and will not be sent to Pharmacy again. Lab requests go to Lab immediately while payment remains pending.</p>
        </div>

        <div className="space-y-2">
          <Label>Emergency summary (optional)</Label>
          <Textarea value={episodeNote} onChange={e => setEpisodeNote(e.target.value)} placeholder="Brief emergency reason or stabilization note…" rows={2} disabled={!!episodeId || busy || !!finalized} />
        </div>

        {allowMedicine && <section className="rounded-xl border p-4 space-y-3">
          <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Pill className="h-4 w-4 text-module-pharmacy" /><h3 className="font-semibold text-sm">Emergency medicine</h3><Badge variant="outline">Plain text</Badge></div><Button type="button" size="sm" variant="outline" onClick={() => setMedicine(newEntry())} disabled={busy || !!finalized}><Plus className="h-3.5 w-3.5 mr-1" /> New line</Button></div>
          <Textarea value={medicine.text} onChange={e => setMedicine(prev => ({ ...prev, text: e.target.value }))} placeholder="Write the complete medicine details, e.g. IV Aminophylline 250mg stat — 1 ampoule given" rows={3} disabled={busy || !!finalized} />
          <div className="flex justify-end"><Button type="button" onClick={saveMedicine} disabled={busy || !!finalized || !medicine.text.trim()}><CheckCircle2 className="h-4 w-4 mr-2" /> Save medicine</Button></div>
        </section>}

        <section className="rounded-xl border p-4 space-y-3">
          <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Beaker className="h-4 w-4 text-module-laboratory" /><h3 className="font-semibold text-sm">Emergency laboratory test</h3><Badge variant="outline">Plain text</Badge></div><Button type="button" size="sm" variant="outline" onClick={() => setLab(newEntry())} disabled={busy || !!finalized}><Plus className="h-3.5 w-3.5 mr-1" /> New line</Button></div>
          <Textarea value={lab.text} onChange={e => setLab(prev => ({ ...prev, text: e.target.value }))} placeholder="Write the test required, e.g. FBC and electrolytes" rows={3} disabled={busy || !!finalized} />
          <div className="flex justify-end"><Button type="button" onClick={saveLab} disabled={busy || !!finalized || !lab.text.trim()}><Send className="h-4 w-4 mr-2" /> Send to Lab</Button></div>
        </section>

        <section className="rounded-xl border bg-muted/20 p-4 space-y-2">
          <div className="flex items-center justify-between"><h3 className="font-semibold text-sm">Saved items in this episode</h3><Badge variant="outline">{savedItems.length}</Badge></div>
          {savedItems.length === 0 ? <p className="text-xs text-muted-foreground">Saved medicine and laboratory lines will appear here in the order they were added.</p> : <div className="space-y-2">{savedItems.map((item, index) => <div key={item.id} className="flex items-start gap-2 rounded-md border bg-background p-2 text-xs"><span className="font-mono text-muted-foreground w-5">{index + 1}.</span>{item.item_type === 'lab' ? <Beaker className="h-3.5 w-3.5 mt-0.5 text-module-laboratory" /> : <Pill className="h-3.5 w-3.5 mt-0.5 text-module-pharmacy" />}<div className="min-w-0 flex-1"><p className="font-medium whitespace-pre-wrap break-words">{item.description}</p><p className="text-muted-foreground mt-0.5 capitalize">{item.item_type} · {item.status.replaceAll('_', ' ')}</p></div></div>)}</div>}
        </section>

        {episodeId && !finalized && <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs"><div className="flex items-center gap-2 font-semibold"><Clock className="h-4 w-4" /> Episode saved and still open</div><p className="mt-1 text-muted-foreground">You may Save for later, refer the patient to Doctor 1 or Doctor 2, or Finalize when urgent care is complete. Finalize locks the episode and sends a billing draft to Billing.</p></div>}
        {finalized && <div className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 p-3 text-sm"><p className="font-semibold text-emerald-800 dark:text-emerald-200">Sent to Billing as a draft</p><p className="text-xs mt-1">Billing will match each plain-text line to the Pricelist and generate one invoice. The episode is now locked, but you may start a separate emergency episode if needed.</p>{finalized.draft_id && <p className="text-[11px] font-mono mt-1">Draft: {finalized.draft_id}</p>}<Button type="button" size="sm" variant="outline" className="mt-3" onClick={startNewEpisode} disabled={busy}><Plus className="h-4 w-4 mr-2" /> Start new emergency episode</Button></div>}

        <DialogFooter className="gap-2"><Button variant="ghost" onClick={close} disabled={busy}>{finalized ? 'Close' : 'Save for later'}</Button>{canAdmit && !finalized && onRequestAdmission && <Button variant="secondary" onClick={onRequestAdmission} disabled={busy}><Plus className="h-4 w-4 mr-2" /> Admit patient</Button>}{episodeId && !finalized && <Button onClick={finalize} disabled={busy || savedItems.length === 0}>{busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Receipt className="h-4 w-4 mr-2" />} Finalize → Billing draft</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
