import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { 
  Plus, Calendar, CheckCircle, XCircle, Clock
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useStaffHR, StaffLeave } from '@/hooks/useStaffHR';
import { useStaff } from '@/hooks/useStaff';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format, differenceInDays } from 'date-fns';

export function StaffHRManager() {
  const { leaves, attendance, loading, addLeave, updateLeave } = useStaffHR();
  const { staff } = useStaff();
  const [isAddLeaveOpen, setIsAddLeaveOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    staff_id: '', leave_type: 'annual', start_date: '', end_date: '', reason: '',
  });

  const getStaffName = (staffId: string) => {
    const s = staff.find(st => st.id === staffId);
    return s ? `${s.firstName} ${s.lastName}` : 'Unknown';
  };

  const handleAddLeave = async () => {
    if (!leaveForm.staff_id || !leaveForm.start_date || !leaveForm.end_date) {
      toast.error('Please fill all required fields');
      return;
    }
    const days = differenceInDays(new Date(leaveForm.end_date), new Date(leaveForm.start_date)) + 1;
    if (days < 1) { toast.error('End date must be after start date'); return; }

    const ok = await addLeave({
      staff_id: leaveForm.staff_id,
      leave_type: leaveForm.leave_type,
      start_date: leaveForm.start_date,
      end_date: leaveForm.end_date,
      days_count: days,
      reason: leaveForm.reason || null,
    } as any);
    if (ok) {
      toast.success('Leave request submitted');
      setIsAddLeaveOpen(false);
      setLeaveForm({ staff_id: '', leave_type: 'annual', start_date: '', end_date: '', reason: '' });
    }
  };

  const handleLeaveAction = async (id: string, action: 'approved' | 'rejected') => {
    const ok = await updateLeave(id, {
      status: action,
      approved_at: new Date().toISOString(),
      approved_by: 'Admin',
    } as any);
    if (ok) toast.success(`Leave ${action}`);
  };

  const leaveTypeColor = (type: string): "default" | "secondary" | "destructive" | "outline" => {
    if (type === 'sick') return 'destructive';
    if (type === 'annual') return 'default';
    if (type === 'maternity') return 'secondary';
    return 'outline';
  };

  return (
    <Tabs defaultValue="leave" className="w-full">
      <TabsList className="mb-4">
        <TabsTrigger value="leave" className="flex items-center gap-1.5">
          <Calendar className="h-4 w-4" /> Leave Management
          {leaves.filter(l => l.status === 'pending').length > 0 && (
            <Badge variant="warning" className="ml-1 h-5 px-1.5 text-xs">
              {leaves.filter(l => l.status === 'pending').length}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="attendance" className="flex items-center gap-1.5">
          <Clock className="h-4 w-4" /> Attendance
        </TabsTrigger>
      </TabsList>

      {/* Leave Tab */}
      <TabsContent value="leave">
        <div className="bg-card rounded-xl border border-border">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold">Staff Leave Requests</h3>
            <Button size="sm" onClick={() => setIsAddLeaveOpen(true)} className="press-effect">
              <Plus className="h-4 w-4 mr-1" /> New Leave
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Type</th>
                  <th>From</th>
                  <th>To</th>
                  <th className="text-center">Days</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">Loading...</td></tr>
                ) : leaves.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">No leave records</td></tr>
                ) : (
                  leaves.map(l => (
                    <tr key={l.id}>
                      <td className="font-medium">{getStaffName(l.staff_id)}</td>
                      <td><Badge variant={leaveTypeColor(l.leave_type)}>{l.leave_type}</Badge></td>
                      <td className="text-sm">{format(new Date(l.start_date), 'dd MMM yyyy')}</td>
                      <td className="text-sm">{format(new Date(l.end_date), 'dd MMM yyyy')}</td>
                      <td className="text-center font-mono">{l.days_count}</td>
                      <td className="text-sm text-muted-foreground max-w-[150px] truncate">{l.reason || '—'}</td>
                      <td>
                        <Badge variant={
                          l.status === 'approved' ? 'success' :
                          l.status === 'rejected' ? 'destructive' : 'warning'
                        }>{l.status}</Badge>
                      </td>
                      <td>
                        {l.status === 'pending' && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => handleLeaveAction(l.id, 'approved')}>
                              <CheckCircle className="h-4 w-4 text-emerald-500" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => handleLeaveAction(l.id, 'rejected')}>
                              <XCircle className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </TabsContent>

      {/* Attendance Tab */}
      <TabsContent value="attendance">
        <div className="bg-card rounded-xl border border-border">
          <div className="p-4 border-b border-border">
            <h3 className="font-semibold">Staff Attendance Records</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Date</th>
                  <th>Clock In</th>
                  <th>Clock Out</th>
                  <th>Status</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {attendance.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No attendance records.</td></tr>
                ) : (
                  attendance.map(a => (
                    <tr key={a.id}>
                      <td className="font-medium">{getStaffName(a.staff_id)}</td>
                      <td className="text-sm">{format(new Date(a.date), 'dd MMM yyyy')}</td>
                      <td className="text-sm">{a.clock_in ? format(new Date(a.clock_in), 'HH:mm') : '—'}</td>
                      <td className="text-sm">{a.clock_out ? format(new Date(a.clock_out), 'HH:mm') : '—'}</td>
                      <td>
                        <Badge variant={
                          a.status === 'present' ? 'success' :
                          a.status === 'late' ? 'warning' :
                          a.status === 'absent' ? 'destructive' : 'secondary'
                        }>{a.status}</Badge>
                      </td>
                      <td className="text-sm text-muted-foreground">{a.notes || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </TabsContent>

      {/* Add Leave Dialog */}
      <Dialog open={isAddLeaveOpen} onOpenChange={setIsAddLeaveOpen}>
        <DialogContent className="animate-scale-in">
          <DialogHeader>
            <DialogTitle>New Leave Request</DialogTitle>
            <DialogDescription>Submit a leave request for a staff member</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Staff Member *</label>
              <Select value={leaveForm.staff_id} onValueChange={v => setLeaveForm({ ...leaveForm, staff_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                <SelectContent>
                  {staff.filter(s => s.status === 'active').map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.firstName} {s.lastName} ({s.role})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Leave Type</label>
              <Select value={leaveForm.leave_type} onValueChange={v => setLeaveForm({ ...leaveForm, leave_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="annual">Annual Leave</SelectItem>
                  <SelectItem value="sick">Sick Leave</SelectItem>
                  <SelectItem value="maternity">Maternity Leave</SelectItem>
                  <SelectItem value="emergency">Emergency Leave</SelectItem>
                  <SelectItem value="unpaid">Unpaid Leave</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Start Date *</label>
                <Input type="date" value={leaveForm.start_date} onChange={e => setLeaveForm({ ...leaveForm, start_date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">End Date *</label>
                <Input type="date" value={leaveForm.end_date} onChange={e => setLeaveForm({ ...leaveForm, end_date: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Reason</label>
              <Textarea value={leaveForm.reason} onChange={e => setLeaveForm({ ...leaveForm, reason: e.target.value })} placeholder="Reason for leave..." rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddLeaveOpen(false)}>Cancel</Button>
            <Button onClick={handleAddLeave} className="press-effect">Submit Leave</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
