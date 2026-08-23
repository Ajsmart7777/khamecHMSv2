import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Patient } from '@/contexts/PatientContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Props {
  patients: Patient[];
  onResume: (patientId: string) => void;
  doctorRole?: 'doctor1' | 'doctor2' | null;
}

export function EmergencyEpisodeQueue({ patients, onResume, doctorRole = null }: Props) {
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const { data } = await supabase.from('emergency_episodes').select('*').eq('status', 'open').order('created_at', { ascending: false });
    setEpisodes((data ?? []) as any[]);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 5000); return () => window.clearInterval(timer); }, [load]);
  const visibleEpisodes = episodes.filter(episode => {
    if (!doctorRole) return true;
    const patient = patients.find(item => item.id === episode.patient_id);
    return patient?.assigned_doctor === doctorRole;
  });
  if (!loading && visibleEpisodes.length === 0) return null;
  return (
    <div className="bg-card rounded-xl border-2 border-amber-300/60 p-4 mb-4">
      <div className="flex items-center gap-2 mb-3"><AlertTriangle className="h-4 w-4 text-amber-600" /><h3 className="font-semibold text-sm">Open Emergency Episodes</h3><Badge variant="warning" className="text-[10px]">{visibleEpisodes.length}</Badge><Button variant="ghost" size="sm" className="h-7 px-2 ml-auto" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" /></Button></div>
      <p className="text-[11px] text-muted-foreground mb-2">Doctor can review and continue the episode before Billing. Reconcile only when all urgent medicine and lab actions are complete.</p>
      <div className="space-y-2">{visibleEpisodes.map(episode => { const patient = patients.find(item => item.id === episode.patient_id); return <div key={episode.id} className="flex flex-col md:flex-row md:items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/30 p-2.5"><div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{patient ? `${patient.first_name} ${patient.last_name}` : 'Patient'}</p><p className="text-[11px] text-muted-foreground">Started {new Date(episode.created_at).toLocaleString()} · awaiting reconciliation</p></div><Button size="sm" variant="outline" onClick={() => onResume(episode.patient_id)}>Continue episode</Button></div>; })}</div>
    </div>
  );
}
