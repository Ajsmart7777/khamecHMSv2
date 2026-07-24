import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTasks, TaskSource } from '@/hooks/useTasks';
import { usePatients } from '@/contexts/PatientContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, ListChecks, Hand, X, Search, FilterX, ExternalLink } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
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
 * Map a task to the role page that owns it, so a row can deep-link into the
 * correct workspace with the patient pre-selected.
 */
function taskTargetRoute(task: { source: TaskSource; payload?: any }): string {
  if (task.source === 'lab_requests') return '/lab';
  if (task.source === 'prescriptions') return '/pharmacy';
  if (task.source === 'admissions') return '/nurse';
  if (task.source === 'stock_requests') return '/store';
  if (task.source === 'snap_orders') {
    const target = String(task.payload?.target_station ?? '').toLowerCase();
    switch (target) {
      case 'billing': return '/billing';
      case 'cashier': return '/cashier';
      case 'pharmacy': return '/pharmacy';
      case 'lab': return '/lab';
      case 'nurse': return '/nurse';
      case 'doctor': return '/doctor';
      case 'reception': return '/reception';
      default: return '/billing';
    }
  }
  return '/';
}

type AssignFilter = 'all' | 'mine' | 'unclaimed' | 'others';
type UrgencyFilter = 'all' | 'urgent' | 'soon' | 'fresh';

// Urgency buckets by age since created_at
const URGENCY_THRESHOLDS = {
  urgent: 24 * 60 * 60 * 1000, // > 24h waiting
  soon: 4 * 60 * 60 * 1000, // > 4h waiting
};

function urgencyOf(createdAt: string): UrgencyFilter {
  const age = Date.now() - new Date(createdAt).getTime();
  if (age >= URGENCY_THRESHOLDS.urgent) return 'urgent';
  if (age >= URGENCY_THRESHOLDS.soon) return 'soon';
  return 'fresh';
}

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
  const navigate = useNavigate();
  const location = useLocation();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [assignFilter, setAssignFilter] = useState<AssignFilter>('all');
  const [statusFilter, setStatusFilter] = useState<string | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<TaskSource | 'all'>('all');
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>('all');

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

  const statusOptions = useMemo(
    () => Array.from(new Set(tasks.map(t => t.status).filter(Boolean))).sort(),
    [tasks],
  );
  const sourceOptions = useMemo(
    () => Array.from(new Set(tasks.map(t => t.source))) as TaskSource[],
    [tasks],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter(t => {
      // Assignment
      if (assignFilter === 'mine') {
        if (!user?.id || t.payload?.claimed_by !== user.id) return false;
      } else if (assignFilter === 'unclaimed') {
        if (t.payload?.claimed) return false;
      } else if (assignFilter === 'others') {
        if (!t.payload?.claimed) return false;
        if (user?.id && t.payload?.claimed_by === user.id) return false;
      }
      // Status
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      // Source
      if (sourceFilter !== 'all' && t.source !== sourceFilter) return false;
      // Urgency
      if (urgencyFilter !== 'all' && urgencyOf(t.created_at) !== urgencyFilter) return false;
      // Text search
      if (q) {
        const p = t.patient_id ? patientById.get(t.patient_id) : null;
        const label = String(t.payload?.label || t.payload?.title || t.payload?.description || '');
        const hay = `${p?.name ?? ''} ${p?.card ?? ''} ${label} ${t.source} ${t.status}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tasks, query, assignFilter, statusFilter, sourceFilter, urgencyFilter, user?.id, patientById]);

  const filtersActive =
    !!query || assignFilter !== 'all' || statusFilter !== 'all' || sourceFilter !== 'all' || urgencyFilter !== 'all';
  const clearFilters = () => {
    setQuery('');
    setAssignFilter('all');
    setStatusFilter('all');
    setSourceFilter('all');
    setUrgencyFilter('all');
  };

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

  const openTask = (t: (typeof tasks)[number]) => {
    const route = taskTargetRoute(t);
    const params = new URLSearchParams();
    if (t.patient_id) params.set('patient', t.patient_id);
    params.set('task', t.source_id);
    const url = `${route}?${params.toString()}`;
    // Same-page: just update the URL so the hook re-selects without a full nav
    if (location.pathname === route) {
      navigate(url, { replace: true });
    } else {
      navigate(url);
    }
  };

  return (
    <Card className="mb-4">
      <CardHeader className="flex flex-row items-center justify-between py-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ListChecks className="w-4 h-4" />
          {title}
          <Badge variant="secondary" className="ml-1">{visible.length}</Badge>
          {filtersActive && visible.length !== tasks.length && (
            <span className="text-[10px] text-muted-foreground font-normal">of {tasks.length}</span>
          )}
        </CardTitle>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="mine-only"
              checked={assignFilter === 'mine'}
              onCheckedChange={(v) => setAssignFilter(v ? 'mine' : 'all')}
            />
            <Label htmlFor="mine-only" className="text-xs">Mine only</Label>
          </div>
          <Button size="sm" variant="ghost" onClick={refresh} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="mb-3 space-y-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search patient, card, or task…"
              className="h-8 pl-8 text-sm"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Assignment chips */}
            {(['all', 'mine', 'unclaimed', 'others'] as AssignFilter[]).map(a => (
              <Badge
                key={`asg-${a}`}
                variant={assignFilter === a ? 'default' : 'outline'}
                className="cursor-pointer capitalize"
                onClick={() => setAssignFilter(a)}
              >
                {a}
              </Badge>
            ))}
            <span className="mx-1 h-4 w-px bg-border" />
            {/* Urgency chips */}
            {([
              { key: 'all', label: 'Any age' },
              { key: 'urgent', label: '>24h' },
              { key: 'soon', label: '>4h' },
              { key: 'fresh', label: 'Fresh' },
            ] as { key: UrgencyFilter; label: string }[]).map(u => (
              <Badge
                key={`urg-${u.key}`}
                variant={urgencyFilter === u.key ? 'default' : 'outline'}
                className="cursor-pointer"
                onClick={() => setUrgencyFilter(u.key)}
              >
                {u.label}
              </Badge>
            ))}
            {statusOptions.length > 1 && (
              <>
                <span className="mx-1 h-4 w-px bg-border" />
                <Badge
                  variant={statusFilter === 'all' ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => setStatusFilter('all')}
                >
                  All status
                </Badge>
                {statusOptions.map(s => (
                  <Badge
                    key={`st-${s}`}
                    variant={statusFilter === s ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => setStatusFilter(s)}
                  >
                    {s}
                  </Badge>
                ))}
              </>
            )}
            {sourceOptions.length > 1 && (
              <>
                <span className="mx-1 h-4 w-px bg-border" />
                <Badge
                  variant={sourceFilter === 'all' ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => setSourceFilter('all')}
                >
                  All types
                </Badge>
                {sourceOptions.map(s => (
                  <Badge
                    key={`src-${s}`}
                    variant={sourceFilter === s ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => setSourceFilter(s)}
                  >
                    {SOURCE_LABEL[s]}
                  </Badge>
                ))}
              </>
            )}
            {filtersActive && (
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs ml-auto" onClick={clearFilters}>
                <FilterX className="w-3 h-3 mr-1" /> Clear
              </Button>
            )}
          </div>
        </div>
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
                    onClick={() => {
                      if (onSelectPatient && t.patient_id) {
                        onSelectPatient(t.patient_id);
                      } else {
                        openTask(t);
                      }
                    }}
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
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 mr-1"
                      title={`Open in ${taskTargetRoute(t).replace('/', '') || 'workspace'}`}
                      onClick={(e) => { e.stopPropagation(); openTask(t); }}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Button>
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