import { useMemo, useState } from 'react';
import { useTasks, TaskSource } from '@/hooks/useTasks';
import { usePatients } from '@/contexts/PatientContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, ListChecks, Hand, X } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

interface TasksPanelProps {
  title?: string;
  role?: string;
  userId?: string;
  status?: string | string[];
  source?: TaskSource | TaskSource[];
  patientId?: string;
  onSelectPatient?: (patientId: string) => void;
  emptyMessage?: string;
  maxHeight?: string;
}

const SOURCE_LABEL: Record<TaskSource, string> = {
  lab_requests: 'Lab',
  prescriptions: 'Rx',
  admissions: 'Admission',
  snap_orders: 'Snap',
  stock_requests: 'Stock',
};

/**
 * Unified task queue driven by the `v_tasks` view via useTasks.
 * Mount inside a page to show live cross-source work items scoped to a role.
 */
export function TasksPanel({
  title = 'Live Tasks',
  role,
  userId,
  status,
  source,
  patientId,
  onSelectPatient,
  emptyMessage = 'No open tasks.',
  maxHeight = '420px',
}: TasksPanelProps) {
  const { tasks, loading, error, refresh, claimTask, releaseTask } = useTasks({ role, userId, status, source, patientId });
  const { patients } = usePatients();
  const { user } = useAuth();
  const [mineOnly, setMineOnly] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const patientById = useMemo(() => {
    const m = new Map<string, { name: string; card: string }>();
    for (const p of patients) {
      m.set(p.id, {
        name: `${p.first_name} ${p.last_name ?? ''}`.trim(),
        card: p.card_number,
      });
    }
    return m;
  }, [patients]);

  const visible = useMemo(() => {
    if (!mineOnly || !user?.id) return tasks;
    return tasks.filter(t => t.payload?.claimed_by === user.id);
  }, [tasks, mineOnly, user?.id]);

  const handleClaim = async (t: (typeof tasks)[number]) => {
    setBusyId(t.task_id);
    try {
      await claimTask(t.source, t.source_id);
      toast.success('Task claimed');
    } catch (e: any) {
      toast.error(String(e?.message ?? 'Failed to claim').replace(/^.*?:\s*/, ''));
    } finally {
      setBusyId(null);
    }
  };

  const handleRelease = async (t: (typeof tasks)[number]) => {
    setBusyId(t.task_id);
    try {
      await releaseTask(t.source, t.source_id);
      toast.success('Task released');
    } catch (e: any) {
      toast.error(String(e?.message ?? 'Failed to release'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card className="mb-4">
      <CardHeader className="flex flex-row items-center justify-between py-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ListChecks className="w-4 h-4" />
          {title}
          <Badge variant="secondary" className="ml-1">{visible.length}</Badge>
        </CardTitle>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch id="mine-only" checked={mineOnly} onCheckedChange={setMineOnly} />
            <Label htmlFor="mine-only" className="text-xs">Mine only</Label>
          </div>
          <Button size="sm" variant="ghost" onClick={refresh} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {error && <div className="text-sm text-destructive mb-2">{error}</div>}
        {visible.length === 0 && !loading ? (
          <div className="text-sm text-muted-foreground py-4 text-center">{emptyMessage}</div>
        ) : (
          <div className="space-y-1 overflow-y-auto" style={{ maxHeight }}>
            {visible.map(t => {
              const p = t.patient_id ? patientById.get(t.patient_id) : null;
              const label = t.payload?.label || t.payload?.title || t.payload?.description || t.source;
              const claimed: boolean = !!t.payload?.claimed;
              const claimedByMe = user?.id && t.payload?.claimed_by === user.id;
              const isBusy = busyId === t.task_id;
              return (
                <div
                  key={t.task_id}
                  className={`w-full px-3 py-2 rounded-md border flex items-center gap-3 ${claimedByMe ? 'bg-primary/5 border-primary/40' : 'hover:bg-accent'}`}
                >
                  <button
                    onClick={() => t.patient_id && onSelectPatient?.(t.patient_id)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  >
                    <Badge variant="outline" className="shrink-0">{SOURCE_LABEL[t.source]}</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {p ? `${p.name} · ${p.card}` : 'Unknown patient'}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {String(label).slice(0, 90)}
                        {claimed && !claimedByMe && ' · claimed'}
                        {claimedByMe && ' · claimed by you'}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge variant={t.status === 'pending' ? 'default' : 'secondary'} className="text-[10px]">
                        {t.status}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}
                      </span>
                    </div>
                  </button>
                  <div className="shrink-0">
                    {claimedByMe ? (
                      <Button size="sm" variant="ghost" disabled={isBusy}
                        onClick={(e) => { e.stopPropagation(); handleRelease(t); }}>
                        <X className="w-3.5 h-3.5 mr-1" /> Release
                      </Button>
                    ) : claimed ? (
                      <Badge variant="outline" className="text-[10px]">Taken</Badge>
                    ) : (
                      <Button size="sm" variant="default" disabled={isBusy}
                        onClick={(e) => { e.stopPropagation(); handleClaim(t); }}>
                        <Hand className="w-3.5 h-3.5 mr-1" /> Claim
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}