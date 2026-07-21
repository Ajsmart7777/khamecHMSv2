import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';

export interface ShiftPeriod {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  is_active: boolean;
  created_at: string;
}

export interface ShiftAssignment {
  id: string;
  staff_user_id: string;
  shift_period_id: string;
  shift_date: string;
  created_at: string;
  shift_periods?: ShiftPeriod;
}

export interface ShiftLog {
  id: string;
  staff_user_id: string;
  shift_period_id: string;
  shift_date: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  handover_notes: string | null;
  status: string;
  created_at: string;
  shift_periods?: ShiftPeriod;
}

export function useShiftPeriods() {
  const [periods, setPeriods] = useState<ShiftPeriod[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPeriods = useCallback(async () => {
    const { data, error } = await supabase
      .from('shift_periods')
      .select('*')
      .order('start_time');
    if (error) {
      console.error('Error fetching shift periods:', error);
    } else {
      setPeriods(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchPeriods(); }, [fetchPeriods]);

  const createPeriod = async (name: string, start_time: string, end_time: string) => {
    const { error } = await supabase.from('shift_periods').insert({ name, start_time, end_time });
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
    toast({ title: 'Shift Period Created', description: `${name} shift added successfully.` });
    fetchPeriods();
    return true;
  };

  const updatePeriod = async (id: string, updates: Partial<ShiftPeriod>) => {
    const { error } = await supabase.from('shift_periods').update(updates).eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
    fetchPeriods();
    return true;
  };

  const deletePeriod = async (id: string) => {
    const { error } = await supabase.from('shift_periods').delete().eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
    fetchPeriods();
    return true;
  };

  return { periods, loading, fetchPeriods, createPeriod, updatePeriod, deletePeriod };
}

export function useShiftAssignments() {
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAssignments = useCallback(async (date?: string) => {
    let query = supabase
      .from('shift_assignments')
      .select('*, shift_periods(*)')
      .order('shift_date', { ascending: false });
    
    if (date) {
      query = query.eq('shift_date', date);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching assignments:', error);
    } else {
      setAssignments((data as any) || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAssignments(); }, [fetchAssignments]);

  const assignStaff = async (staff_user_id: string, shift_period_id: string, shift_date: string) => {
    const { error } = await supabase.from('shift_assignments').insert({ staff_user_id, shift_period_id, shift_date });
    if (error) {
      if (error.code === '23505') {
        toast({ title: 'Already Assigned', description: 'This staff is already assigned for this date.', variant: 'destructive' });
      } else {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
      }
      return false;
    }
    toast({ title: 'Staff Assigned', description: 'Shift assignment created successfully.' });
    fetchAssignments();
    return true;
  };

  const removeAssignment = async (id: string) => {
    const { error } = await supabase.from('shift_assignments').delete().eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
    fetchAssignments();
    return true;
  };

  return { assignments, loading, fetchAssignments, assignStaff, removeAssignment };
}

export function useShiftLogs() {
  const [logs, setLogs] = useState<ShiftLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async (date?: string) => {
    let query = supabase
      .from('shift_logs')
      .select('*, shift_periods(*)')
      .order('created_at', { ascending: false });
    
    if (date) {
      query = query.eq('shift_date', date);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching shift logs:', error);
    } else {
      setLogs((data as any) || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  return { logs, loading, fetchLogs };
}

export function useMyShift() {
  const { user } = useAuth();
  const [todayAssignment, setTodayAssignment] = useState<ShiftAssignment | null>(null);
  const [todayLog, setTodayLog] = useState<ShiftLog | null>(null);
  const [loading, setLoading] = useState(true);

  const today = new Date().toISOString().split('T')[0];

  const fetchMyShift = useCallback(async () => {
    if (!user) { setLoading(false); return; }

    const [assignmentRes, logRes] = await Promise.all([
      supabase
        .from('shift_assignments')
        .select('*, shift_periods(*)')
        .eq('staff_user_id', user.id)
        .eq('shift_date', today)
        .maybeSingle(),
      supabase
        .from('shift_logs')
        .select('*, shift_periods(*)')
        .eq('staff_user_id', user.id)
        .eq('shift_date', today)
        .maybeSingle(),
    ]);

    if (assignmentRes.data) setTodayAssignment(assignmentRes.data as any);
    if (logRes.data) setTodayLog(logRes.data as any);
    setLoading(false);
  }, [user, today]);

  useEffect(() => { fetchMyShift(); }, [fetchMyShift]);

  // Subscribe to realtime changes on my shift log
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('my-shift-log')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'shift_logs',
        filter: `staff_user_id=eq.${user.id}`,
      }, () => { fetchMyShift(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, fetchMyShift]);

  const clockIn = async () => {
    if (!user || !todayAssignment) return false;
    const { error } = await supabase.from('shift_logs').insert({
      staff_user_id: user.id,
      shift_period_id: todayAssignment.shift_period_id,
      shift_date: today,
      clock_in_at: new Date().toISOString(),
      status: 'clocked_in',
    });
    if (error) {
      if (error.code === '23505') {
        toast({ title: 'Already Clocked In', description: 'You have already clocked in today.', variant: 'destructive' });
      } else {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
      }
      return false;
    }
    toast({ title: 'Clocked In', description: 'You have successfully clocked in for your shift.' });
    fetchMyShift();
    return true;
  };

  const handover = async (notes: string) => {
    if (!user || !todayLog) return false;
    const { error } = await supabase.from('shift_logs').update({
      clock_out_at: new Date().toISOString(),
      handover_notes: notes,
      status: 'handed_over',
    }).eq('id', todayLog.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
    toast({ title: 'Handover Complete', description: 'You have successfully handed over your shift.' });
    fetchMyShift();
    return true;
  };

  // Check if shift has ended (for overtime detection)
  const isShiftEnded = useCallback(() => {
    if (!todayAssignment?.shift_periods) return false;
    const now = new Date();
    const [endH, endM] = todayAssignment.shift_periods.end_time.split(':').map(Number);
    const endDate = new Date();
    endDate.setHours(endH, endM, 0, 0);
    
    // Handle overnight shifts (e.g., Night 21:00-07:00)
    const [startH] = todayAssignment.shift_periods.start_time.split(':').map(Number);
    if (endH < startH) {
      // Overnight shift - end is next day
      endDate.setDate(endDate.getDate() + 1);
    }
    
    return now > endDate;
  }, [todayAssignment]);

  return { todayAssignment, todayLog, loading, clockIn, handover, isShiftEnded, fetchMyShift };
}
