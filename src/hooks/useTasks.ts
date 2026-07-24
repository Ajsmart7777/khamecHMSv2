import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type TaskSource =
  | 'lab_requests'
  | 'prescriptions'
  | 'admissions'
  | 'snap_orders'
  | 'stock_requests';

export interface Task {
  task_id: string;
  source: TaskSource;
  source_id: string;
  patient_id: string | null;
  visit_id: string | null;
  assigned_role: string | null;
  assigned_user_id: string | null;
  status: string;
  priority: number;
  created_at: string;
  updated_at: string;
  payload: Record<string, any>;
}

interface UseTasksOpts {
  role?: string;
  userId?: string;
  status?: string | string[];
  source?: TaskSource | TaskSource[];
  patientId?: string;
  enabled?: boolean;
}

/**
 * Unified task queue built on the `v_tasks` DB view.
 * Reads across lab_requests, prescriptions, admissions, snap_orders, stock_requests.
 * Row-level security on the underlying tables still applies (view is security_invoker).
 */
export function useTasks(opts: UseTasksOpts = {}) {
  const { role, userId, status, source, patientId, enabled = true } = opts;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = async () => {
    setLoading(true);
    setError(null);
    let q = supabase.from('v_tasks' as any).select('*').order('priority', { ascending: false }).order('created_at', { ascending: false });
    if (role) q = q.eq('assigned_role', role);
    if (userId) q = q.eq('assigned_user_id', userId);
    if (patientId) q = q.eq('patient_id', patientId);
    if (status) q = Array.isArray(status) ? q.in('status', status) : q.eq('status', status);
    if (source) q = Array.isArray(source) ? q.in('source', source) : q.eq('source', source);
    const { data, error } = await q;
    if (error) setError(error.message);
    else setTasks((data ?? []) as unknown as Task[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!enabled) return;
    fetchTasks();

    // Refresh on any change to the source tables.
    const channel = supabase
      .channel('v_tasks_watch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lab_requests' }, fetchTasks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prescriptions' }, fetchTasks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admissions' }, fetchTasks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'snap_orders' }, fetchTasks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_requests' }, fetchTasks)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, userId, patientId, JSON.stringify(status), JSON.stringify(source), enabled]);

  return { tasks, loading, error, refresh: fetchTasks };
}