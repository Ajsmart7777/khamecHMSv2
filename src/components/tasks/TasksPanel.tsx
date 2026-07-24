import { useMemo } from 'react';
import { useTasks, TaskSource } from '@/hooks/useTasks';
import { usePatients } from '@/contexts/PatientContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, ListChecks } from 'lucide-react';
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
  const { tasks, loading, error, refresh } = useTasks({ role, userId, status, source, patientId });
  const { patients } = usePatients();

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

  return (
    <Card className="mb-4">
      <CardHeader className="flex flex-row items-center justify-between py-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ListChecks className="w-4 h-4" />
          {title}
          <Badge variant="secondary" className="ml-1">{tasks.length}</Badge>
        </CardTitle>
        <Button size="sm" variant="ghost" onClick={refresh} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {error && <div className="text-sm text-destructive mb-2">{error}</div>}
        {tasks.length === 0 && !loading ? (
          <div className="text-sm text-muted-foreground py-4 text-center">{emptyMessage}</div>
        ) : (
          <div className="space-y-1 overflow-y-auto" style={{ maxHeight }}>
            {tasks.map(t => {
              const p = t.patient_id ? patientById.get(t.patient_id) : null;
              const label = t.payload?.label || t.payload?.title || t.payload?.description || t.source;
              return (
                <button
                  key={t.task_id}
                  onClick={() => t.patient_id && onSelectPatient?.(t.patient_id)}
                  className="w-full text-left px-3 py-2 rounded-md border hover:bg-accent transition-colors flex items-center gap-3"
                >
                  <Badge variant="outline" className="shrink-0">{SOURCE_LABEL[t.source]}</Badge>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {p ? `${p.name} · ${p.card}` : 'Unknown patient'}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {String(label).slice(0, 90)}
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
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}