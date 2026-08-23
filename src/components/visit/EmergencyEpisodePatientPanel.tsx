import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Beaker, CheckCircle2, Clock, Pill, Receipt } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Patient } from '@/contexts/PatientContext';
import { EmergencyEpisodeDialog } from './EmergencyEpisodeDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Props {
  patient: Patient;
  onEpisodeChange?: (episodeId: string | null) => void;
  onRequestAdmission?: () => void;
}

type Episode = {
  id: string;
  admission_id?: string | null;
  created_at: string;
  notes?: string | null;
};

type EpisodeItem = {
  id: string;
  item_type: 'medication' | 'lab';
  description: string;
  strength?: string | null;
  route?: string | null;
  quantity: number;
  unit_price: number;
  administered_now: boolean;
  status: string;
  lab_request_id?: string | null;
  created_at: string;
};

type LabRequest = {
  id: string;
  status: string;
};

export function EmergencyEpisodePatientPanel({ patient, onEpisodeChange, onRequestAdmission }: Props) {
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [items, setItems] = useState<EpisodeItem[]>([]);
  const [labs, setLabs] = useState<LabRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: episodes, error } = await supabase
        .from('emergency_episodes')
        .select('id, admission_id, created_at, notes')
        .eq('patient_id', patient.id)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      const current = (episodes?.[0] ?? null) as Episode | null;
      setEpisode(current);
      onEpisodeChange?.(current?.id ?? null);
      if (!current) {
        setItems([]);
        setLabs([]);
        return;
      }

      const [itemsResult, labsResult] = await Promise.all([
        supabase.from('emergency_episode_items').select('*').eq('episode_id', current.id).neq('status', 'cancelled').order('created_at', { ascending: true }),
        supabase.from('lab_requests').select('id, status').eq('emergency_episode_id', current.id).order('created_at', { ascending: true }),
      ]);
      if (itemsResult.error) throw itemsResult.error;
      if (labsResult.error) throw labsResult.error;
      setItems((itemsResult.data ?? []) as EpisodeItem[]);
      setLabs((labsResult.data ?? []) as LabRequest[]);
    } catch {
      setEpisode(null);
      setItems([]);
      setLabs([]);
      onEpisodeChange?.(null);
    } finally {
      setLoading(false);
    }
  }, [onEpisodeChange, patient.id]);

  useEffect(() => {
    setEpisode(null);
    setItems([]);
    setLabs([]);
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (loading && !episode) return null;
  if (!episode) return null;

  const medicationCount = items.filter(item => item.item_type === 'medication').length;
  const labCount = items.filter(item => item.item_type === 'lab').length;

  return (
    <section className="rounded-xl border-2 border-amber-300/70 bg-amber-50/30 dark:bg-amber-950/10 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <h3 className="font-semibold text-sm">Emergency Episode</h3>
        <Badge variant="warning" className="text-[10px]">Open · before billing</Badge>
        <Button size="sm" className="ml-auto" onClick={() => setDialogOpen(true)}>Continue Emergency Care</Button>
        {onRequestAdmission && !['admitted', 'in_ward', 'ready_for_discharge'].includes(String(patient.status)) && <Button size="sm" variant="secondary" onClick={onRequestAdmission}>Admit under episode</Button>}
      </div>
        <p className="text-xs text-muted-foreground">
          Started {new Date(episode.created_at).toLocaleString()}. These plain-text emergency items remain unbilled until the episode is finalized or handled at discharge.
        </p>
      {episode.notes && <p className="text-xs rounded-md border bg-background/70 p-2"><strong>Emergency note:</strong> {episode.notes}</p>}

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md border bg-background/70 p-2"><Pill className="h-3.5 w-3.5 inline mr-1 text-module-pharmacy" />{medicationCount} medicine item{medicationCount === 1 ? '' : 's'}</div>
        <div className="rounded-md border bg-background/70 p-2"><Beaker className="h-3.5 w-3.5 inline mr-1 text-module-laboratory" />{labCount} lab item{labCount === 1 ? '' : 's'}</div>
      </div>

      <div className="space-y-2">
        {items.map(item => {
          const lab = item.lab_request_id ? labs.find(request => request.id === item.lab_request_id) : null;
          return (
            <div key={item.id} className="rounded-lg border bg-background/80 p-2.5 text-xs">
              <div className="flex items-start gap-2">
                {item.item_type === 'lab' ? <Beaker className="h-3.5 w-3.5 mt-0.5 text-module-laboratory" /> : <Pill className="h-3.5 w-3.5 mt-0.5 text-module-pharmacy" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{item.description}</span>
                    <Badge variant="outline" className="text-[10px] capitalize">{item.status.replaceAll('_', ' ')}</Badge>
                    {item.item_type === 'medication' && <Badge variant={item.administered_now ? 'success' : 'warning'} className="text-[10px]">{item.administered_now ? 'Given now' : 'Pharmacy later'}</Badge>}
                  </div>
                  <p className="text-muted-foreground mt-0.5">
                    {item.item_type === 'medication' ? 'Recorded as emergency care; Billing will match the plain-text line to the Pricelist.' : 'Authorized lab work — not financially paid'}
                  </p>
                  {item.item_type === 'lab' && lab?.status === 'completed' && (
                    <div className="mt-2 rounded-md border border-emerald-300/60 bg-emerald-50/60 p-2"><CheckCircle2 className="h-3.5 w-3.5 inline mr-1 text-emerald-700" /><strong>Result returned.</strong> See Patient Header → Lab Results for the full result.</div>
                  )}
                  {item.item_type === 'lab' && lab?.status !== 'completed' && <p className="mt-1 text-amber-700"><Clock className="h-3.5 w-3.5 inline mr-1" />Awaiting laboratory result</p>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p className="text-[11px] text-muted-foreground"><Receipt className="h-3.5 w-3.5 inline mr-1" />Finalizing later creates one combined invoice for this episode.</p>
        <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>Add medicine or lab</Button>
      </div>

      <EmergencyEpisodeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        patientId={patient.id}
        patientName={`${patient.first_name} ${patient.last_name}`}
        admissionId={episode.admission_id ?? null}
        allowMedicine={['admitted', 'in_ward', 'ready_for_discharge'].includes(String(patient.status))}
        canAdmit={Boolean(onRequestAdmission) && !['admitted', 'in_ward', 'ready_for_discharge'].includes(String(patient.status))}
        onRequestAdmission={onRequestAdmission}
        onSaved={load}
      />
    </section>
  );
}
