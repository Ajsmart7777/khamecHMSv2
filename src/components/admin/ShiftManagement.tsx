import { useState, useEffect } from 'react';
import { useShiftPeriods, useShiftAssignments, useShiftLogs } from '@/hooks/useShifts';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BulkShiftScheduler } from './BulkShiftScheduler';
import { ShiftReports } from './ShiftReports';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Clock, Plus, Edit, Trash2, Users, Monitor, CalendarDays,
  LogIn, LogOut, AlertTriangle, Eye, CalendarRange, FileBarChart
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface UserRoleRow {
  user_id: string;
  role: string;
}

export function ShiftManagement() {
  const { periods, loading: periodsLoading, createPeriod, updatePeriod, deletePeriod } = useShiftPeriods();
  const { assignments, loading: assignLoading, fetchAssignments, assignStaff, removeAssignment } = useShiftAssignments();
  const { logs, loading: logsLoading, fetchLogs } = useShiftLogs();

  const [staffUsers, setStaffUsers] = useState<{ id: string; email: string; role: string }[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [monitorDate, setMonitorDate] = useState(new Date().toISOString().split('T')[0]);

  // Dialogs
  const [addPeriodOpen, setAddPeriodOpen] = useState(false);
  const [editPeriodOpen, setEditPeriodOpen] = useState(false);
  const [deletePeriodOpen, setDeletePeriodOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [viewHandoverOpen, setViewHandoverOpen] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<any>(null);
  const [selectedLog, setSelectedLog] = useState<any>(null);

  // Form state
  const [periodForm, setPeriodForm] = useState({ name: '', start_time: '', end_time: '' });
  const [assignForm, setAssignForm] = useState({ staff_user_id: '', shift_period_id: '' });

  // Fetch staff users with roles and emails
  useEffect(() => {
    const fetchStaff = async () => {
      // Get user_roles
      const { data: roles } = await supabase.from('user_roles').select('user_id, role');
      if (!roles) return;

      // Try to get emails from the manage-staff-accounts edge function
      try {
        const { data: funcData } = await supabase.functions.invoke('manage-staff-accounts', {
          body: { action: 'list' },
        });
        
        const usersMap = new Map<string, string>();
        if (funcData?.users) {
          funcData.users.forEach((u: any) => usersMap.set(u.id, u.email));
        }

        setStaffUsers(roles.map((r: UserRoleRow) => ({
          id: r.user_id,
          email: usersMap.get(r.user_id) || r.user_id.slice(0, 8) + '...',
          role: r.role,
        })));
      } catch {
        // Fallback: just use truncated IDs
        setStaffUsers(roles.map((r: UserRoleRow) => ({
          id: r.user_id,
          email: r.user_id.slice(0, 8) + '...',
          role: r.role,
        })));
      }
    };
    fetchStaff();
  }, []);

  // Realtime monitor updates
  useEffect(() => {
    const channel = supabase
      .channel('admin-shift-monitor')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_logs' }, () => {
        fetchLogs(monitorDate);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [monitorDate, fetchLogs]);

  useEffect(() => { fetchAssignments(selectedDate); }, [selectedDate]);
  useEffect(() => { fetchLogs(monitorDate); }, [monitorDate]);

  const handleCreatePeriod = async () => {
    const ok = await createPeriod(periodForm.name, periodForm.start_time, periodForm.end_time);
    if (ok) { setAddPeriodOpen(false); setPeriodForm({ name: '', start_time: '', end_time: '' }); }
  };

  const handleEditPeriod = async () => {
    if (!selectedPeriod) return;
    const ok = await updatePeriod(selectedPeriod.id, periodForm);
    if (ok) { setEditPeriodOpen(false); }
  };

  const handleDeletePeriod = async () => {
    if (!selectedPeriod) return;
    await deletePeriod(selectedPeriod.id);
    setDeletePeriodOpen(false);
  };

  const handleAssign = async () => {
    const ok = await assignStaff(assignForm.staff_user_id, assignForm.shift_period_id, selectedDate);
    if (ok) {
      setAssignOpen(false);
      setAssignForm({ staff_user_id: '', shift_period_id: '' });
      fetchAssignments(selectedDate);
    }
  };

  const getStaffDisplay = (userId: string) => {
    const s = staffUsers.find(u => u.id === userId);
    return s ? `${s.email} (${s.role})` : userId.slice(0, 8) + '...';
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'clocked_in': return <Badge className="bg-primary/10 text-primary border-primary/30">Clocked In</Badge>;
      case 'handed_over': return <Badge variant="outline" className="bg-muted text-muted-foreground">Handed Over</Badge>;
      case 'overtime': return <Badge variant="destructive">Overtime</Badge>;
      case 'auto_signout': return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />Auto Sign-out</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="periods" className="space-y-4">
        <TabsList className="grid w-full max-w-2xl grid-cols-5">
          <TabsTrigger value="periods" className="flex items-center gap-1.5">
            <Clock className="h-4 w-4" /> Periods
          </TabsTrigger>
          <TabsTrigger value="assignments" className="flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4" /> Assignments
          </TabsTrigger>
          <TabsTrigger value="bulk" className="flex items-center gap-1.5">
            <CalendarRange className="h-4 w-4" /> Weekly
          </TabsTrigger>
          <TabsTrigger value="monitor" className="flex items-center gap-1.5">
            <Monitor className="h-4 w-4" /> Live Monitor
          </TabsTrigger>
          <TabsTrigger value="reports" className="flex items-center gap-1.5">
            <FileBarChart className="h-4 w-4" /> Reports
          </TabsTrigger>
        </TabsList>

        {/* SHIFT PERIODS */}
        <TabsContent value="periods" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Shift Periods</h3>
            <Button size="sm" onClick={() => { setPeriodForm({ name: '', start_time: '', end_time: '' }); setAddPeriodOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Add Period
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {periods.map((p) => (
              <div key={p.id} className={`rounded-xl border p-4 bg-card ${!p.is_active ? 'opacity-50' : ''}`}>
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h4 className="font-semibold text-lg">{p.name}</h4>
                    <p className="text-sm text-muted-foreground">{p.start_time.slice(0, 5)} — {p.end_time.slice(0, 5)}</p>
                  </div>
                  <Badge variant={p.is_active ? 'default' : 'outline'}>{p.is_active ? 'Active' : 'Inactive'}</Badge>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                    setSelectedPeriod(p);
                    setPeriodForm({ name: p.name, start_time: p.start_time.slice(0, 5), end_time: p.end_time.slice(0, 5) });
                    setEditPeriodOpen(true);
                  }}>
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                    updatePeriod(p.id, { is_active: !p.is_active });
                  }}>
                    {p.is_active ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => {
                    setSelectedPeriod(p);
                    setDeletePeriodOpen(true);
                  }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* SHIFT ASSIGNMENTS */}
        <TabsContent value="assignments" className="space-y-4">
          <div className="flex flex-wrap justify-between items-center gap-3">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-semibold">Assignments</h3>
              <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="w-auto" />
            </div>
            <Button size="sm" onClick={() => { setAssignForm({ staff_user_id: '', shift_period_id: '' }); setAssignOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Assign Staff
            </Button>
          </div>

          {assignments.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No assignments for this date</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Staff ID</th>
                    <th>Shift</th>
                    <th>Date</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((a) => (
                    <tr key={a.id}>
                      <td className="text-sm">{getStaffDisplay(a.staff_user_id)}</td>
                      <td>
                        <Badge variant="outline">{a.shift_periods?.name || 'Unknown'}</Badge>
                      </td>
                      <td>{a.shift_date}</td>
                      <td className="text-right">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeAssignment(a.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* LIVE MONITOR */}
        <TabsContent value="monitor" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-lg font-semibold">Shift Monitor</h3>
            <Input type="date" value={monitorDate} onChange={(e) => setMonitorDate(e.target.value)} className="w-auto" />
            <Button variant="outline" size="sm" onClick={() => fetchLogs(monitorDate)}>Refresh</Button>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="rounded-lg border bg-card p-3 text-center">
              <p className="text-2xl font-bold">{logs.length}</p>
              <p className="text-xs text-muted-foreground">Total Logs</p>
            </div>
            <div className="rounded-lg border bg-primary/5 p-3 text-center">
              <p className="text-2xl font-bold text-primary">{logs.filter(l => l.status === 'clocked_in').length}</p>
              <p className="text-xs text-muted-foreground">Currently In</p>
            </div>
            <div className="rounded-lg border bg-muted p-3 text-center">
              <p className="text-2xl font-bold">{logs.filter(l => l.status === 'handed_over').length}</p>
              <p className="text-xs text-muted-foreground">Handed Over</p>
            </div>
            <div className="rounded-lg border bg-destructive/5 p-3 text-center">
              <p className="text-2xl font-bold text-destructive">{logs.filter(l => l.status === 'overtime').length}</p>
              <p className="text-xs text-muted-foreground">Overtime</p>
            </div>
            <div className="rounded-lg border bg-destructive/10 p-3 text-center">
              <p className="text-2xl font-bold text-destructive">{logs.filter(l => l.status === 'auto_signout').length}</p>
              <p className="text-xs text-muted-foreground">Auto Sign-out</p>
            </div>
          </div>

          {logs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Monitor className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No shift logs for this date</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Staff ID</th>
                    <th>Shift</th>
                    <th>Clock In</th>
                    <th>Clock Out</th>
                    <th>Status</th>
                    <th className="text-right">Handover</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} className={l.status === 'overtime' ? 'bg-destructive/5' : ''}>
                      <td className="text-sm">{getStaffDisplay(l.staff_user_id)}</td>
                      <td>{l.shift_periods?.name || '—'}</td>
                      <td className="text-sm">{l.clock_in_at ? new Date(l.clock_in_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                      <td className="text-sm">{l.clock_out_at ? new Date(l.clock_out_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                      <td>{getStatusBadge(l.status)}</td>
                      <td className="text-right">
                        {l.handover_notes ? (
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setSelectedLog(l); setViewHandoverOpen(true); }}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* BULK SCHEDULER */}
        <TabsContent value="bulk" className="space-y-4">
          <h3 className="text-lg font-semibold">Weekly Bulk Scheduling</h3>
          <BulkShiftScheduler />
        </TabsContent>

        {/* REPORTS */}
        <TabsContent value="reports" className="space-y-4">
          <h3 className="text-lg font-semibold">Shift Reports</h3>
          <ShiftReports />
        </TabsContent>
      </Tabs>

      {/* Add Period Dialog */}
      <Dialog open={addPeriodOpen} onOpenChange={setAddPeriodOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Shift Period</DialogTitle>
            <DialogDescription>Create a new fixed shift period</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Shift Name</label>
              <Input value={periodForm.name} onChange={(e) => setPeriodForm({ ...periodForm, name: e.target.value })} placeholder="e.g. Morning" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Start Time</label>
                <Input type="time" value={periodForm.start_time} onChange={(e) => setPeriodForm({ ...periodForm, start_time: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">End Time</label>
                <Input type="time" value={periodForm.end_time} onChange={(e) => setPeriodForm({ ...periodForm, end_time: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddPeriodOpen(false)}>Cancel</Button>
            <Button onClick={handleCreatePeriod} disabled={!periodForm.name || !periodForm.start_time || !periodForm.end_time}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Period Dialog */}
      <Dialog open={editPeriodOpen} onOpenChange={setEditPeriodOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Shift Period</DialogTitle>
            <DialogDescription>Update the shift period details</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Shift Name</label>
              <Input value={periodForm.name} onChange={(e) => setPeriodForm({ ...periodForm, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Start Time</label>
                <Input type="time" value={periodForm.start_time} onChange={(e) => setPeriodForm({ ...periodForm, start_time: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">End Time</label>
                <Input type="time" value={periodForm.end_time} onChange={(e) => setPeriodForm({ ...periodForm, end_time: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPeriodOpen(false)}>Cancel</Button>
            <Button onClick={handleEditPeriod}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Period Confirm */}
      <AlertDialog open={deletePeriodOpen} onOpenChange={setDeletePeriodOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Shift Period</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the "{selectedPeriod?.name}" shift period? This will also remove all related assignments.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeletePeriod} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Assign Staff Dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Staff to Shift</DialogTitle>
            <DialogDescription>Assign a staff member to a shift on {selectedDate}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Staff Member</label>
              <select
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
                value={assignForm.staff_user_id}
                onChange={(e) => setAssignForm({ ...assignForm, staff_user_id: e.target.value })}
              >
                <option value="">Select staff...</option>
                {staffUsers.map((s) => (
                  <option key={s.id} value={s.id}>{s.role} — {s.email}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Shift Period</label>
              <select
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
                value={assignForm.shift_period_id}
                onChange={(e) => setAssignForm({ ...assignForm, shift_period_id: e.target.value })}
              >
                <option value="">Select shift...</option>
                {periods.filter(p => p.is_active).map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.start_time.slice(0, 5)} - {p.end_time.slice(0, 5)})</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button onClick={handleAssign} disabled={!assignForm.staff_user_id || !assignForm.shift_period_id}>Assign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Handover Notes */}
      <Dialog open={viewHandoverOpen} onOpenChange={setViewHandoverOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Handover Notes</DialogTitle>
            <DialogDescription>
              {selectedLog && `Staff: ${selectedLog.staff_user_id.slice(0, 8)}... — ${selectedLog.shift_periods?.name || ''} shift`}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <div className="rounded-lg bg-muted p-4 text-sm whitespace-pre-wrap">
              {selectedLog?.handover_notes || 'No notes provided.'}
            </div>
            {selectedLog?.clock_out_at && (
              <p className="text-xs text-muted-foreground mt-2">
                Handed over at: {new Date(selectedLog.clock_out_at).toLocaleString('en-NG')}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewHandoverOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
