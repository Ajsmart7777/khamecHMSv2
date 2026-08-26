import { useState } from 'react';
import { Beaker, CheckCircle2, Clock, Play, Send } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { LabRequest } from '@/hooks/useLabRequests';
import { Patient } from '@/contexts/PatientContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Props {
  requests: LabRequest[];
  patients: Patient[];
  updateLabRequest: (id: string, updates: Partial<LabRequest>) => Promise<boolean>;
  refreshLabRequests: () => Promise<void>;
  updatePatientStatus: (patientId: string, status: any) => Promise<boolean>;
}

export function EmergencyLabQueue({ requests, patients, updateLabRequest, refreshLabRequests, updatePatientStatus }: Props) {
  const [selected, setSelected] = useState<LabRequest | null>(null);
  const [results, setResults] = useState('');
  const [interpretation, setInterpretation] = useState('Normal');
  const [busy, setBusy] = useState(false);
  const patientName = (id: string) => {
    const p = patients.find(item => item.id === id);
    return p ? `${p.first_name} ${p.last_name}` : 'Unknown patient';
  };
  const active = requests.filter(request => ['emergency_authorized', 'emergency_in_progress'].includes(String(request.status)));
  const completed = requests.filter(request => String(request.status) === 'completed' && request.emergency_episode_id);

  const start = async (request: LabRequest) => {
    setBusy(true);
    try {
      const ok = await updateLabRequest(request.id, { status: 'emergency_in_progress' });
      if (!ok) throw new Error('Could not start emergency lab request');
      toast.success('Emergency test started');
      await refreshLabRequests();
    } catch (error: any) { toast.error(error?.message || 'Could not start test'); }
    finally { setBusy(false); }
  };

  const openResults = (request: LabRequest) => {
    setSelected(request);
    const current = request.results as any;
    setResults(typeof current === 'string' ? current : current?.value || '');
    setInterpretation(current?.interpretation || 'Normal');
  };

  const saveResults = async () => {
    if (!selected || !results.trim()) { toast.error('Enter the laboratory result'); return; }
    setBusy(true);
    try {
      const { error } = await (supabase.rpc as any)('complete_emergency_lab_request', {
        _lab_request_id: selected.id,
        _results: { value: results.trim(), interpretation },
        _result_path: null,
      });
      if (error) throw error;
      toast.success('Emergency result saved', { description: 'The result is now linked to the Emergency Episode ledger.' });
      setSelected(null);
      await refreshLabRequests();
    } catch (error: any) { toast.error(error?.message || 'Could not save result'); }
    finally { setBusy(false); }
  };

  const sendToClinicalTeam = async (request: LabRequest) => {
    const patient = patients.find(item => item.id === request.patient_id);
    if (!patient) return;
    setBusy(true);
    try {
      const wardStatus = ['admitted', 'in_ward', 'ready_for_discharge'].includes(String(patient.status));
      if (!wardStatus) {
        const ok = await updatePatientStatus(patient.id, 'with_clinical_team');
        if (!ok) throw new Error('Could not route patient to the clinical team');
      }
      toast.success('Emergency results sent to clinical team', { description: wardStatus ? 'Ward location preserved; Nurse, Doctor 1, and Doctor 2 can review the linked result.' : 'Patient is now available to Nurse, Doctor 1, and Doctor 2.' });
    } catch (error: any) { toast.error(error?.message || 'Could not route results'); }
    finally { setBusy(false); }
  };

  if (active.length === 0 && completed.length === 0) return null;

  return (
    <div className="bg-card rounded-xl border-2 border-amber-300/70 p-4 mb-6">
      <div className="flex items-center gap-2 mb-3"><Beaker className="h-5 w-5 text-amber-600" /><h3 className="font-semibold">Emergency Lab — Authorized to Perform</h3><Badge variant="outline" className="text-[10px]">{active.length} active</Badge></div>
      <p className="text-xs text-muted-foreground mb-3">These tests may be performed immediately. They are not financially marked paid; billing remains pending until the combined Emergency Episode is reconciled at Cashier.</p>
      <div className="space-y-2">
        {active.map(request => (
          <div key={request.id} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{patientName(request.patient_id)}</p><p className="text-xs text-muted-foreground">{request.tests.join(', ')} · {request.request_number}</p></div>
            <Badge variant={request.status === 'emergency_in_progress' ? 'info' : 'warning'} className="text-[10px] self-start md:self-center">{request.status === 'emergency_in_progress' ? <><Play className="h-3 w-3 mr-1" /> In progress</> : <><Clock className="h-3 w-3 mr-1" /> Authorized</>}</Badge>
            {request.status === 'emergency_authorized' && <Button size="sm" variant="outline" onClick={() => start(request)} disabled={busy}><Play className="h-3.5 w-3.5 mr-1" /> Start test</Button>}
            <Button size="sm" onClick={() => openResults(request)} disabled={busy}><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Enter result</Button>
          </div>
        ))}
        {completed.map(request => (
          <div key={`done-${request.id}`} className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 flex flex-col md:flex-row md:items-center gap-3"><div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{patientName(request.patient_id)}</p><p className="text-xs text-muted-foreground">{request.tests.join(', ')} · emergency result completed</p></div><Badge variant="success" className="text-[10px]">Completed</Badge><Button size="sm" variant="outline" onClick={() => sendToClinicalTeam(request)} disabled={busy}><Send className="h-3.5 w-3.5 mr-1" /> Send to clinical team</Button></div>
        ))}
      </div>

      {selected && <Dialog open onOpenChange={(open) => !open && setSelected(null)}><DialogContent><DialogHeader><DialogTitle>Emergency Lab Result · {patientName(selected.patient_id)}</DialogTitle></DialogHeader><div className="space-y-3"><p className="text-xs text-muted-foreground">Tests: {selected.tests.join(', ')}</p><div><Label>Result details *</Label><Textarea value={results} onChange={e => setResults(e.target.value)} rows={8} placeholder="Enter the laboratory findings…" disabled={busy} /></div><div><Label>Interpretation</Label><select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={interpretation} onChange={e => setInterpretation(e.target.value)} disabled={busy}><option>Normal</option><option>Abnormal - Low</option><option>Abnormal - High</option><option>Critical</option></select></div></div><DialogFooter><Button variant="outline" onClick={() => setSelected(null)} disabled={busy}>Cancel</Button><Button onClick={saveResults} disabled={busy}>{busy ? 'Saving…' : 'Save result'}</Button></DialogFooter></DialogContent></Dialog>}
    </div>
  );
}
