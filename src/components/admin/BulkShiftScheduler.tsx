import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useShiftPeriods, useShiftAssignments, ShiftAssignment } from '@/hooks/useShifts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronLeft, ChevronRight, Save, Loader2, Users, Calendar } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { addDays, startOfWeek, format, isSameDay } from 'date-fns';

interface StaffUser {
  id: string;
  email: string;
  role: string;
}

export function BulkShiftScheduler() {
  const { periods } = useShiftPeriods();
  const { assignments, fetchAssignments } = useShiftAssignments();
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selections, setSelections] = useState<Record<string, Record<string, string>>>({});
  // selections[staffId][dateStr] = periodId
  const [saving, setSaving] = useState(false);
  const [allAssignments, setAllAssignments] = useState<ShiftAssignment[]>([]);

  const activePeriods = periods.filter(p => p.is_active);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekDateStrings = weekDays.map(d => format(d, 'yyyy-MM-dd'));

  // Fetch staff
  useEffect(() => {
    const fetchStaff = async () => {
      const { data: roles } = await supabase.from('user_roles').select('user_id, role');
      if (!roles) return;
      try {
        const { data: funcData } = await supabase.functions.invoke('manage-staff-accounts', {
          body: { action: 'list' },
        });
        const usersMap = new Map<string, string>();
        if (funcData?.users) funcData.users.forEach((u: any) => usersMap.set(u.id, u.email));
        setStaffUsers(roles.map((r: any) => ({
          id: r.user_id,
          email: usersMap.get(r.user_id) || r.user_id.slice(0, 8) + '...',
          role: r.role,
        })));
      } catch {
        setStaffUsers(roles.map((r: any) => ({
          id: r.user_id,
          email: r.user_id.slice(0, 8) + '...',
          role: r.role,
        })));
      }
    };
    fetchStaff();
  }, []);

  // Fetch assignments for the week
  useEffect(() => {
    const fetchWeekAssignments = async () => {
      const { data } = await supabase
        .from('shift_assignments')
        .select('*, shift_periods(*)')
        .gte('shift_date', weekDateStrings[0])
        .lte('shift_date', weekDateStrings[6])
        .order('shift_date');
      if (data) setAllAssignments(data as any);
    };
    fetchWeekAssignments();
  }, [weekStart, weekDateStrings[0]]);

  // Initialize selections from existing assignments
  useEffect(() => {
    const sel: Record<string, Record<string, string>> = {};
    allAssignments.forEach(a => {
      if (!sel[a.staff_user_id]) sel[a.staff_user_id] = {};
      sel[a.staff_user_id][a.shift_date] = a.shift_period_id;
    });
    setSelections(sel);
  }, [allAssignments]);

  const toggleSelection = (staffId: string, dateStr: string, periodId: string) => {
    setSelections(prev => {
      const staff = prev[staffId] ? { ...prev[staffId] } : {};
      if (staff[dateStr] === periodId) {
        delete staff[dateStr];
      } else {
        staff[dateStr] = periodId;
      }
      return { ...prev, [staffId]: staff };
    });
  };

  const getSelection = (staffId: string, dateStr: string): string | undefined => {
    return selections[staffId]?.[dateStr];
  };

  const getExistingAssignment = (staffId: string, dateStr: string) => {
    return allAssignments.find(a => a.staff_user_id === staffId && a.shift_date === dateStr);
  };

  const handleSave = async () => {
    setSaving(true);
    let added = 0, removed = 0, errors = 0;

    for (const staffId of Object.keys(selections)) {
      for (const dateStr of weekDateStrings) {
        const selected = selections[staffId]?.[dateStr];
        const existing = getExistingAssignment(staffId, dateStr);

        if (selected && !existing) {
          // New assignment
          const { error } = await supabase.from('shift_assignments').insert({
            staff_user_id: staffId,
            shift_period_id: selected,
            shift_date: dateStr,
          });
          if (error) { errors++; console.error(error); } else added++;
        } else if (selected && existing && selected !== existing.shift_period_id) {
          // Changed - delete old, insert new
          await supabase.from('shift_assignments').delete().eq('id', existing.id);
          const { error } = await supabase.from('shift_assignments').insert({
            staff_user_id: staffId,
            shift_period_id: selected,
            shift_date: dateStr,
          });
          if (error) { errors++; console.error(error); } else { added++; removed++; }
        } else if (!selected && existing) {
          // Removed
          const { error } = await supabase.from('shift_assignments').delete().eq('id', existing.id);
          if (error) { errors++; console.error(error); } else removed++;
        }
      }
    }

    // Also handle staff that were in allAssignments but removed from selections
    for (const a of allAssignments) {
      if (!selections[a.staff_user_id]?.[a.shift_date]) {
        const { error } = await supabase.from('shift_assignments').delete().eq('id', a.id);
        if (error) errors++; else removed++;
      }
    }

    setSaving(false);
    toast({
      title: 'Schedule Saved',
      description: `${added} added, ${removed} removed${errors ? `, ${errors} errors` : ''}`,
    });

    // Refresh
    const { data } = await supabase
      .from('shift_assignments')
      .select('*, shift_periods(*)')
      .gte('shift_date', weekDateStrings[0])
      .lte('shift_date', weekDateStrings[6]);
    if (data) setAllAssignments(data as any);
  };

  const navigateWeek = (dir: number) => {
    setWeekStart(prev => addDays(prev, dir * 7));
  };

  return (
    <div className="space-y-4">
      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => navigateWeek(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h3 className="text-sm font-semibold">
            {format(weekDays[0], 'MMM d')} — {format(weekDays[6], 'MMM d, yyyy')}
          </h3>
          <Button variant="outline" size="icon" onClick={() => navigateWeek(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
          Save Schedule
        </Button>
      </div>

      {staffUsers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>No staff users found</p>
        </div>
      ) : (
        <ScrollArea className="border rounded-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 min-w-[180px] sticky left-0 bg-muted/50 z-10">Staff</th>
                  {weekDays.map((day, i) => (
                    <th key={i} className="text-center p-2 min-w-[120px]">
                      <div className="font-medium">{format(day, 'EEE')}</div>
                      <div className="text-xs text-muted-foreground">{format(day, 'MMM d')}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {staffUsers.filter(s => s.role !== 'admin').map(staff => (
                  <tr key={staff.id} className="border-b hover:bg-muted/30">
                    <td className="p-3 sticky left-0 bg-background z-10">
                      <div className="font-medium text-xs">{staff.email}</div>
                      <Badge variant="outline" className="text-[10px] capitalize mt-0.5">{staff.role}</Badge>
                    </td>
                    {weekDateStrings.map((dateStr, i) => {
                      const selected = getSelection(staff.id, dateStr);
                      return (
                        <td key={i} className="p-1 text-center">
                          <div className="flex flex-col gap-0.5">
                            {activePeriods.map(period => {
                              const isSelected = selected === period.id;
                              return (
                                <button
                                  key={period.id}
                                  onClick={() => toggleSelection(staff.id, dateStr, period.id)}
                                  className={`px-1.5 py-1 rounded text-[10px] font-medium transition-colors ${
                                    isSelected
                                      ? 'bg-primary text-primary-foreground'
                                      : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                                  }`}
                                >
                                  {period.name.slice(0, 3)}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ScrollArea>
      )}

      {/* Legend */}
      <div className="flex gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-primary" /> Assigned
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-muted" /> Available
        </span>
        {activePeriods.map(p => (
          <span key={p.id}>
            {p.name}: {p.start_time.slice(0, 5)} - {p.end_time.slice(0, 5)}
          </span>
        ))}
      </div>
    </div>
  );
}
