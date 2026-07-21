import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Download, FileText, Clock, AlertTriangle, Users } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, parseISO, differenceInMinutes } from 'date-fns';
import { toast } from '@/hooks/use-toast';

interface ShiftLogRow {
  id: string;
  staff_user_id: string;
  shift_period_id: string;
  shift_date: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  handover_notes: string | null;
  status: string;
  shift_periods?: { name: string; start_time: string; end_time: string } | null;
}

interface StaffUser {
  id: string;
  email: string;
  role: string;
}

interface StaffReport {
  staffId: string;
  staffDisplay: string;
  role: string;
  totalShifts: number;
  attended: number;
  absent: number;
  overtimeCount: number;
  overtimeMinutes: number;
  autoSignouts: number;
  lateArrivals: number;
  avgClockInDelay: number;
  totalHoursWorked: number;
}

export function ShiftReports() {
  const [reportType, setReportType] = useState<'weekly' | 'monthly'>('monthly');
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [selectedWeekStart, setSelectedWeekStart] = useState(
    format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  );
  const [logs, setLogs] = useState<ShiftLogRow[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(false);

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

  // Fetch data based on date range
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      let dateFrom: string, dateTo: string;

      if (reportType === 'monthly') {
        const monthDate = parseISO(selectedMonth + '-01');
        dateFrom = format(startOfMonth(monthDate), 'yyyy-MM-dd');
        dateTo = format(endOfMonth(monthDate), 'yyyy-MM-dd');
      } else {
        const weekDate = parseISO(selectedWeekStart);
        dateFrom = format(startOfWeek(weekDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');
        dateTo = format(endOfWeek(weekDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      }

      const [logsRes, assignRes] = await Promise.all([
        supabase.from('shift_logs').select('*, shift_periods(*)').gte('shift_date', dateFrom).lte('shift_date', dateTo),
        supabase.from('shift_assignments').select('*, shift_periods(*)').gte('shift_date', dateFrom).lte('shift_date', dateTo),
      ]);

      setLogs((logsRes.data as any) || []);
      setAssignments(assignRes.data || []);
      setLoading(false);
    };
    fetchData();
  }, [reportType, selectedMonth, selectedWeekStart]);

  // Generate reports
  const reports = useMemo<StaffReport[]>(() => {
    const staffIds = new Set<string>();
    logs.forEach(l => staffIds.add(l.staff_user_id));
    assignments.forEach(a => staffIds.add(a.staff_user_id));

    return Array.from(staffIds).map(staffId => {
      const staffLogs = logs.filter(l => l.staff_user_id === staffId);
      const staffAssignments = assignments.filter((a: any) => a.staff_user_id === staffId);
      const staffInfo = staffUsers.find(s => s.id === staffId);

      let overtimeMinutes = 0;
      let lateArrivals = 0;
      let totalClockInDelayMinutes = 0;
      let totalHoursWorked = 0;
      let lateCount = 0;

      staffLogs.forEach(log => {
        // Calculate hours worked
        if (log.clock_in_at && log.clock_out_at) {
          totalHoursWorked += differenceInMinutes(new Date(log.clock_out_at), new Date(log.clock_in_at)) / 60;
        } else if (log.clock_in_at) {
          // Still clocked in or auto-signout - estimate from shift period
          const end = log.clock_out_at || new Date().toISOString();
          totalHoursWorked += differenceInMinutes(new Date(end), new Date(log.clock_in_at)) / 60;
        }

        // Check for late arrival
        if (log.clock_in_at && log.shift_periods?.start_time) {
          const clockIn = new Date(log.clock_in_at);
          const [h, m] = log.shift_periods.start_time.split(':').map(Number);
          const shiftStart = new Date(log.shift_date + 'T00:00:00');
          shiftStart.setHours(h, m, 0, 0);

          const delayMinutes = differenceInMinutes(clockIn, shiftStart);
          if (delayMinutes > 5) { // 5 min grace
            lateArrivals++;
            totalClockInDelayMinutes += delayMinutes;
            lateCount++;
          }
        }

        // Overtime
        if (log.status === 'overtime' || log.status === 'auto_signout') {
          if (log.clock_in_at && log.shift_periods?.end_time) {
            const [eh, em] = log.shift_periods.end_time.split(':').map(Number);
            const shiftEnd = new Date(log.shift_date + 'T00:00:00');
            shiftEnd.setHours(eh, em, 0, 0);
            const clockOut = log.clock_out_at ? new Date(log.clock_out_at) : new Date();
            const ot = differenceInMinutes(clockOut, shiftEnd);
            if (ot > 0) overtimeMinutes += ot;
          }
        }
      });

      // Absent = assigned but no log
      const attendedDates = new Set(staffLogs.map(l => l.shift_date));
      const assignedDates = new Set(staffAssignments.map((a: any) => a.shift_date));
      const absent = [...assignedDates].filter(d => !attendedDates.has(d)).length;

      return {
        staffId,
        staffDisplay: staffInfo?.email || staffId.slice(0, 8) + '...',
        role: staffInfo?.role || 'unknown',
        totalShifts: assignedDates.size,
        attended: staffLogs.length,
        absent,
        overtimeCount: staffLogs.filter(l => l.status === 'overtime' || l.status === 'auto_signout').length,
        overtimeMinutes,
        autoSignouts: staffLogs.filter(l => l.status === 'auto_signout').length,
        lateArrivals,
        avgClockInDelay: lateCount > 0 ? Math.round(totalClockInDelayMinutes / lateCount) : 0,
        totalHoursWorked: Math.round(totalHoursWorked * 10) / 10,
      };
    }).sort((a, b) => b.totalShifts - a.totalShifts);
  }, [logs, assignments, staffUsers]);

  // Summary stats
  const summary = useMemo(() => ({
    totalStaff: reports.length,
    totalShifts: reports.reduce((s, r) => s + r.totalShifts, 0),
    totalAbsent: reports.reduce((s, r) => s + r.absent, 0),
    totalOvertime: reports.reduce((s, r) => s + r.overtimeMinutes, 0),
    totalLate: reports.reduce((s, r) => s + r.lateArrivals, 0),
    totalAutoSignouts: reports.reduce((s, r) => s + r.autoSignouts, 0),
  }), [reports]);

  const exportCSV = () => {
    const headers = ['Staff', 'Role', 'Assigned Shifts', 'Attended', 'Absent', 'Late Arrivals', 'Avg Late (min)', 'Overtime Count', 'Overtime (hrs)', 'Auto Sign-outs', 'Hours Worked'];
    const rows = reports.map(r => [
      r.staffDisplay, r.role, r.totalShifts, r.attended, r.absent,
      r.lateArrivals, r.avgClockInDelay, r.overtimeCount,
      (r.overtimeMinutes / 60).toFixed(1), r.autoSignouts, r.totalHoursWorked,
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `shift_report_${reportType}_${reportType === 'monthly' ? selectedMonth : selectedWeekStart}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast({ title: 'Report Exported', description: 'CSV downloaded successfully.' });
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={reportType} onValueChange={(v) => setReportType(v as any)}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
          </SelectContent>
        </Select>

        {reportType === 'monthly' ? (
          <Input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="w-auto"
          />
        ) : (
          <Input
            type="date"
            value={selectedWeekStart}
            onChange={(e) => setSelectedWeekStart(e.target.value)}
            className="w-auto"
          />
        )}

        <Button variant="outline" size="sm" onClick={exportCSV} disabled={reports.length === 0}>
          <Download className="h-4 w-4 mr-1" /> Export CSV
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="rounded-lg border bg-card p-3 text-center">
          <p className="text-2xl font-bold">{summary.totalStaff}</p>
          <p className="text-xs text-muted-foreground">Staff</p>
        </div>
        <div className="rounded-lg border bg-card p-3 text-center">
          <p className="text-2xl font-bold">{summary.totalShifts}</p>
          <p className="text-xs text-muted-foreground">Shifts Assigned</p>
        </div>
        <div className="rounded-lg border bg-destructive/5 p-3 text-center">
          <p className="text-2xl font-bold text-destructive">{summary.totalAbsent}</p>
          <p className="text-xs text-muted-foreground">Absences</p>
        </div>
        <div className="rounded-lg border bg-accent/50 p-3 text-center">
          <p className="text-2xl font-bold">{summary.totalLate}</p>
          <p className="text-xs text-muted-foreground">Late Arrivals</p>
        </div>
        <div className="rounded-lg border bg-destructive/5 p-3 text-center">
          <p className="text-2xl font-bold text-destructive">{Math.round(summary.totalOvertime / 60)}h</p>
          <p className="text-xs text-muted-foreground">Overtime</p>
        </div>
        <div className="rounded-lg border bg-destructive/10 p-3 text-center">
          <p className="text-2xl font-bold text-destructive">{summary.totalAutoSignouts}</p>
          <p className="text-xs text-muted-foreground">Auto Sign-outs</p>
        </div>
      </div>

      {/* Report table */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : reports.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>No shift data for this period</p>
        </div>
      ) : (
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3">Staff</th>
                <th className="text-center p-3">Role</th>
                <th className="text-center p-3">Assigned</th>
                <th className="text-center p-3">Attended</th>
                <th className="text-center p-3">Absent</th>
                <th className="text-center p-3">Late</th>
                <th className="text-center p-3">Avg Late</th>
                <th className="text-center p-3">OT Count</th>
                <th className="text-center p-3">OT Hours</th>
                <th className="text-center p-3">Hours</th>
              </tr>
            </thead>
            <tbody>
              {reports.map(r => (
                <tr key={r.staffId} className="border-b hover:bg-muted/30">
                  <td className="p-3 font-medium text-xs">{r.staffDisplay}</td>
                  <td className="p-3 text-center">
                    <Badge variant="outline" className="text-[10px] capitalize">{r.role}</Badge>
                  </td>
                  <td className="p-3 text-center">{r.totalShifts}</td>
                  <td className="p-3 text-center">{r.attended}</td>
                  <td className="p-3 text-center">
                    {r.absent > 0 ? (
                      <Badge variant="destructive" className="text-[10px]">{r.absent}</Badge>
                    ) : '0'}
                  </td>
                  <td className="p-3 text-center">
                    {r.lateArrivals > 0 ? (
                      <span className="text-destructive font-medium">{r.lateArrivals}</span>
                    ) : '0'}
                  </td>
                  <td className="p-3 text-center text-muted-foreground">
                    {r.avgClockInDelay > 0 ? `${r.avgClockInDelay}m` : '—'}
                  </td>
                  <td className="p-3 text-center">
                    {r.overtimeCount > 0 ? (
                      <span className="text-destructive font-medium">{r.overtimeCount}</span>
                    ) : '0'}
                  </td>
                  <td className="p-3 text-center">
                    {r.overtimeMinutes > 0 ? `${(r.overtimeMinutes / 60).toFixed(1)}h` : '—'}
                  </td>
                  <td className="p-3 text-center font-medium">{r.totalHoursWorked}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
