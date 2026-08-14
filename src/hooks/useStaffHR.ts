import { useState, useEffect, useCallback } from 'react';
import { createRealtimeChannel, supabase } from '@/integrations/supabase/client';
import { logError } from '@/lib/errorHandler';

export interface StaffLeave {
  id: string;
  staff_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days_count: number;
  reason: string | null;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StaffAttendance {
  id: string;
  staff_id: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  status: string;
  notes: string | null;
  
  created_at: string;
}

export function useStaffHR() {
  const [leaves, setLeaves] = useState<StaffLeave[]>([]);
  const [attendance, setAttendance] = useState<StaffAttendance[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLeaves = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('staff_leave')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setLeaves((data || []) as unknown as StaffLeave[]);
    } catch (err) { logError('Error fetching leaves', err); }
  }, []);

  const fetchAttendance = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('staff_attendance')
        .select('*')
        .order('date', { ascending: false })
        .limit(200);
      if (error) throw error;
      setAttendance((data || []) as unknown as StaffAttendance[]);
    } catch (err) { logError('Error fetching attendance', err); }
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchLeaves(), fetchAttendance()]);
      setLoading(false);
    };
    load();

    const channel = createRealtimeChannel('staff-hr-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_leave' }, () => fetchLeaves())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_attendance' }, () => fetchAttendance())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchLeaves, fetchAttendance]);

  const addLeave = async (leave: Partial<StaffLeave>): Promise<boolean> => {
    try {
      const { error } = await supabase.from('staff_leave').insert([leave as any]);
      if (error) throw error;
      await fetchLeaves();
      return true;
    } catch (err) { logError('Error adding leave', err); return false; }
  };

  const updateLeave = async (id: string, updates: Partial<StaffLeave>): Promise<boolean> => {
    try {
      const { error } = await supabase.from('staff_leave')
        .update({ ...updates, updated_at: new Date().toISOString() } as any)
        .eq('id', id);
      if (error) throw error;
      await fetchLeaves();
      return true;
    } catch (err) { logError('Error updating leave', err); return false; }
  };

  const recordAttendance = async (att: Partial<StaffAttendance>): Promise<boolean> => {
    try {
      const { error } = await supabase.from('staff_attendance').insert([att as any]);
      if (error) throw error;
      await fetchAttendance();
      return true;
    } catch (err) { logError('Error recording attendance', err); return false; }
  };

  const getPendingLeaves = () => leaves.filter(l => l.status === 'pending');
  const getStaffLeaves = (staffId: string) => leaves.filter(l => l.staff_id === staffId);
  const getAttendanceByDate = (date: string) => attendance.filter(a => a.date === date);

  return {
    leaves, attendance, loading,
    addLeave, updateLeave, recordAttendance,
    getPendingLeaves, getStaffLeaves, getAttendanceByDate,
    refresh: async () => { await Promise.all([fetchLeaves(), fetchAttendance()]); },
  };
}
