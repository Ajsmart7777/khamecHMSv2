import { useState } from 'react';
import { Beaker, Camera, CheckCircle2, Clock, Play, Send, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { uploadFile } from '@/lib/storage';
import { LabRequest } from '@/hooks/useLabRequests';
import { Patient } from '@/contexts/PatientContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InAppCameraDialog } from '@/components/visit/InAppCameraDialog';
import { SnapCropDialog } from '@/components/visit/SnapCropDialog';
import { hasInAppCamera } from '@/lib/isMobile';

interface Props {
  requests: LabRequest[];
  patients: Patient[];
  updateLabRequest: (id: string, updates: Partial<LabRequest>) => Promise<boolean>;
  refreshLabRequests: () => Promise<void>;
  updatePatientStatus: (patientId: string, status: any) => Promise<boolean>;
}

export function EmergencyLabQueue({ requests, patients, updateLabRequest, refreshLabRequests, updatePatientStatus }: Props) {
  const [selected, setSelected] = useState<LabRequest | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const hasCam = hasInAppCamera();

  const patientName = (id: string) => {
    const p = patients.find(item => item.id === id);
    return p ? `${p.first_name} ${p.last_name}` : 'Unknown patient';
  };
  const active = requests.filter(request => ['emergency_authorized', 'emergency_in_progress'].includes(String(request.status)));
  const completed = requests.filter(request => String(request.status) === 'completed' && request.emergency_episode_id);

  const closeResultDialog = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (rawUrl) URL.revokeObjectURL(rawUrl);
    setSelected(null);
    setFile(null);
    setPreviewUrl(null);
    setRawFile(null);
    setRawUrl(null);
    setCropOpen(false);
    setCameraOpen(false);
    setNote('');
  };

  const acceptFile = (candidate: File) => {
    if (!candidate.type.startsWith('image/')) {
      toast.error('Please select an image of the paper laboratory result');
      return;
    }
    if (rawUrl) URL.revokeObjectURL(rawUrl);
    setRawFile(candidate);
    setRawUrl(URL.createObjectURL(candidate));
    setCameraOpen(false);
    setCropOpen(true);
  };

  const openSnapCapture = () => {
    if (hasCam) setCameraOpen(true);
    else document.getElementById('emergency-lab-result-file')?.click();
  };

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
    setNote('');
    setFile(null);
    setPreviewUrl(null);
  };

  const saveResults = async () => {
    if (!selected || !file) {
      toast.error('Snap the paper laboratory result before sending');
      return;
    }
    setBusy(true);
    try {
      const path = `${selected.visit_id ?? selected.patient_id}/emergency-lab-result-${crypto.randomUUID()}.jpg`;
      await uploadFile('visit-cards', path, file, file.type || 'image/jpeg');
      const { error } = await (supabase.rpc as any)('complete_emergency_lab_request', {
        _lab_request_id: selected.id,
        _results: { value: 'See snapped result', note: note.trim() || null },
        _result_path: path,
      });
      if (error) throw error;
      toast.success('Emergency result snap sent', { description: 'The result is now linked to the Emergency Episode and available to Nurse, Doctor 1, and Doctor 2.' });
      closeResultDialog();
      await refreshLabRequests();
    } catch (error: any) { toast.error(error?.message || 'Could not send emergency result snap'); }
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
      <p className="text-xs text-muted-foreground mb-3">These tests may be performed immediately without payment. Results must be captured as a paper snap, then returned to the shared Nurse, Doctor 1, and Doctor 2 clinical queue.</p>
      <div className="space-y-2">
        {active.map(request => (
          <div key={request.id} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{patientName(request.patient_id)}</p><p className="text-xs text-muted-foreground">{request.tests.join(', ')} · {request.request_number}</p></div>
            <Badge variant={request.status === 'emergency_in_progress' ? 'info' : 'warning'} className="text-[10px] self-start md:self-center">{request.status === 'emergency_in_progress' ? <><Play className="h-3 w-3 mr-1" /> In progress</> : <><Clock className="h-3 w-3 mr-1" /> Authorized</>}</Badge>
            {request.status === 'emergency_authorized' && <Button size="sm" variant="outline" onClick={() => start(request)} disabled={busy}><Play className="h-3.5 w-3.5 mr-1" /> Start test</Button>}
            <Button size="sm" onClick={() => openResults(request)} disabled={busy}><Camera className="h-3.5 w-3.5 mr-1" /> Snap result</Button>
          </div>
        ))}
        {completed.map(request => (
          <div key={`done-${request.id}`} className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 flex flex-col md:flex-row md:items-center gap-3"><div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{patientName(request.patient_id)}</p><p className="text-xs text-muted-foreground">{request.tests.join(', ')} · emergency result completed</p></div><Badge variant="success" className="text-[10px]">Completed</Badge><Button size="sm" variant="outline" onClick={() => sendToClinicalTeam(request)} disabled={busy}><Send className="h-3.5 w-3.5 mr-1" /> Send to clinical team</Button></div>
        ))}
      </div>

      {selected && <>
        <input id="emergency-lab-result-file" type="file" accept="image/*" onChange={event => { const candidate = event.target.files?.[0]; if (candidate) acceptFile(candidate); event.currentTarget.value = ''; }} className="hidden" />
        <InAppCameraDialog open={cameraOpen} onCancel={() => setCameraOpen(false)} onCapture={acceptFile} />
        {rawUrl && rawFile && <SnapCropDialog open={cropOpen} imageUrl={rawUrl} originalFile={rawFile} onCancel={closeResultDialog} onConfirm={(croppedFile, croppedUrl) => { if (previewUrl) URL.revokeObjectURL(previewUrl); setFile(croppedFile); setPreviewUrl(croppedUrl); setCropOpen(false); }} />}
        <Dialog open={Boolean(selected) && !cropOpen} onOpenChange={open => !open && !busy && closeResultDialog()}>
          <DialogContent><DialogHeader><DialogTitle>Snap Emergency Lab Result · {patientName(selected.patient_id)}</DialogTitle></DialogHeader><div className="space-y-3"><p className="text-xs text-muted-foreground">Tests: {selected.tests.join(', ')}</p>{previewUrl ? <div className="rounded-lg overflow-hidden bg-muted flex items-center justify-center max-h-[42vh]"><img src={previewUrl} alt="Emergency laboratory result preview" className="max-h-[42vh] object-contain" /></div> : <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Use the camera or image picker to snap the paper result.</div>}<div><Label htmlFor="emergency-lab-result-note">Note (optional)</Label><Input id="emergency-lab-result-note" value={note} onChange={event => setNote(event.target.value)} placeholder="Optional urgent finding or note" disabled={busy} /></div><p className="text-xs text-muted-foreground">Typing the laboratory result is disabled. The uploaded snap is the result record and will be delivered to Nurse, Doctor 1, and Doctor 2 together.</p></div><DialogFooter><Button variant="outline" onClick={closeResultDialog} disabled={busy}><X className="h-4 w-4 mr-1" /> Cancel</Button>{!file && <Button variant="outline" onClick={openSnapCapture} disabled={busy}><Camera className="h-4 w-4 mr-1" /> Snap result</Button>}<Button onClick={saveResults} disabled={busy || !file}><Upload className="h-4 w-4 mr-1" /> {busy ? 'Sending…' : 'Send result snap'}</Button></DialogFooter></DialogContent>
        </Dialog>
      </>}
    </div>
  );
}
