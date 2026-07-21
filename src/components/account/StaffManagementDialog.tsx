import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Upload,
  Download,
  Edit,
  Save,
  X,
  Plus,
  Minus,
  UserPlus,
  Loader2,
  Trash2,
} from 'lucide-react';
import { Staff, UserRole } from '@/types/hms';
import { toast } from '@/hooks/use-toast';

interface StaffManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staff: Staff[];
  loading?: boolean;
  onAddStaff: (staff: Omit<Staff, 'id'>) => Promise<boolean>;
  onUpdateStaff: (id: string, updates: Partial<Staff>) => Promise<boolean>;
  onDeleteStaff: (id: string) => Promise<boolean>;
  onImportStaff: (staffList: Omit<Staff, 'id'>[]) => Promise<number>;
}

const ROLES: UserRole[] = ['reception', 'nurse', 'doctor', 'lab', 'billing', 'pharmacy', 'store', 'account', 'auditing', 'admin'];

const emptyNewStaff = {
  employeeId: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  role: 'reception' as UserRole,
  department: '',
  salary: 0,
  hireDate: new Date().toISOString().split('T')[0],
  status: 'active' as const,
};

export function StaffManagementDialog({
  open,
  onOpenChange,
  staff,
  loading = false,
  onAddStaff,
  onUpdateStaff,
  onDeleteStaff,
  onImportStaff,
}: StaffManagementDialogProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Staff>>({});
  const [adjustmentType, setAdjustmentType] = useState<'bonus' | 'deduct'>('bonus');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newStaff, setNewStaff] = useState(emptyNewStaff);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleEdit = (staffMember: Staff) => {
    setEditingId(staffMember.id);
    setEditData({
      role: staffMember.role,
      salary: staffMember.salary,
    });
    setAdjustmentAmount('');
  };

  const handleSave = async (staffId: string) => {
    setSaving(true);
    const adjustment = parseInt(adjustmentAmount) || 0;
    const salaryChange = adjustmentType === 'bonus' ? adjustment : -adjustment;
    const currentStaff = staff.find(s => s.id === staffId);
    
    const updates: Partial<Staff> = {
      role: editData.role as UserRole,
      salary: (editData.salary || currentStaff?.salary || 0) + salaryChange,
    };
    
    const success = await onUpdateStaff(staffId, updates);
    setSaving(false);
    
    if (success) {
      setEditingId(null);
      setEditData({});
      setAdjustmentAmount('');
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditData({});
    setAdjustmentAmount('');
  };

  const handleAddNewStaff = async () => {
    if (!newStaff.firstName || !newStaff.lastName || !newStaff.employeeId) {
      toast({ 
        title: "Validation Error", 
        description: "Please fill in Employee ID, First Name, and Last Name.", 
        variant: "destructive" 
      });
      return;
    }

    setSaving(true);
    const success = await onAddStaff(newStaff);
    setSaving(false);

    if (success) {
      setNewStaff(emptyNewStaff);
      setShowAddForm(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this staff member?')) return;
    await onDeleteStaff(id);
  };

  const handleExport = () => {
    const headers = ['Employee ID', 'First Name', 'Last Name', 'Email', 'Phone', 'Role', 'Department', 'Salary', 'Hire Date', 'Status'];
    const csvContent = [
      headers.join(','),
      ...staff.map(s => [
        s.employeeId,
        s.firstName,
        s.lastName,
        s.email,
        s.phone,
        s.role,
        s.department,
        s.salary,
        s.hireDate,
        s.status,
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `staff_list_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    
    toast({ title: "Export Complete", description: `Exported ${staff.length} staff records.` });
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) {
          toast({ title: "Import Error", description: "CSV file is empty or invalid.", variant: "destructive" });
          return;
        }

        const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/\s+/g, ''));
        const requiredHeaders = ['employeeid', 'firstname', 'lastname', 'role', 'salary'];
        const hasRequired = requiredHeaders.every(h => 
          headers.some(header => header.includes(h))
        );

        if (!hasRequired) {
          toast({ 
            title: "Import Error", 
            description: "CSV must contain: Employee ID, First Name, Last Name, Role, Salary columns.", 
            variant: "destructive" 
          });
          return;
        }

        const importedStaff: Omit<Staff, 'id'>[] = [];
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim());
          if (values.length >= 5) {
            const getVal = (col: string) => {
              const idx = headers.findIndex(h => h.includes(col));
              return idx >= 0 ? values[idx] : '';
            };
            
            const staffRecord: Omit<Staff, 'id'> = {
              employeeId: getVal('employeeid') || `EMP-${Date.now()}-${i}`,
              firstName: getVal('firstname') || '',
              lastName: getVal('lastname') || '',
              email: getVal('email') || '',
              phone: getVal('phone') || '',
              role: (getVal('role') || 'reception') as UserRole,
              department: getVal('department') || 'General',
              salary: parseInt(getVal('salary')) || 0,
              hireDate: getVal('hiredate') || new Date().toISOString().split('T')[0],
              status: (getVal('status') || 'active') as 'active' | 'inactive' | 'on_leave',
            };
            if (staffRecord.firstName && staffRecord.lastName) {
              importedStaff.push(staffRecord);
            }
          }
        }

        if (importedStaff.length > 0) {
          setSaving(true);
          const count = await onImportStaff(importedStaff);
          setSaving(false);
          if (count > 0) {
            toast({ 
              title: "Import Successful", 
              description: `Imported ${count} staff records.` 
            });
          }
        } else {
          toast({ 
            title: "Import Error", 
            description: "No valid staff records found in CSV.", 
            variant: "destructive" 
          });
        }
      } catch (error) {
        toast({ 
          title: "Import Error", 
          description: "Failed to parse CSV file. Please check the format.", 
          variant: "destructive" 
        });
      }
    };
    reader.readAsText(file);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="animate-scale-in max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Staff Management</DialogTitle>
          <DialogDescription>
            Import, export, and manage staff records including roles and salary adjustments
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 mb-4 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="hidden"
          />
          <Button variant="outline" onClick={handleImportClick} className="press-effect" disabled={saving}>
            <Upload className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
          <Button variant="outline" onClick={handleExport} className="press-effect" disabled={saving}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Button variant="hero" onClick={() => setShowAddForm(true)} className="press-effect" disabled={saving || showAddForm}>
            <UserPlus className="h-4 w-4 mr-2" />
            Add Staff
          </Button>
        </div>

        {/* Add Staff Form */}
        {showAddForm && (
          <div className="border rounded-lg p-4 mb-4 bg-muted/30 animate-fade-in">
            <h4 className="font-medium mb-3 flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Add New Staff Member
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Employee ID *</label>
                <Input
                  placeholder="EMP-001"
                  value={newStaff.employeeId}
                  onChange={(e) => setNewStaff({ ...newStaff, employeeId: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">First Name *</label>
                <Input
                  placeholder="John"
                  value={newStaff.firstName}
                  onChange={(e) => setNewStaff({ ...newStaff, firstName: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Last Name *</label>
                <Input
                  placeholder="Doe"
                  value={newStaff.lastName}
                  onChange={(e) => setNewStaff({ ...newStaff, lastName: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Email</label>
                <Input
                  type="email"
                  placeholder="john@clinic.com"
                  value={newStaff.email}
                  onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Phone</label>
                <Input
                  placeholder="+234..."
                  value={newStaff.phone}
                  onChange={(e) => setNewStaff({ ...newStaff, phone: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Role</label>
                <Select
                  value={newStaff.role}
                  onValueChange={(value) => setNewStaff({ ...newStaff, role: value as UserRole })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map(role => (
                      <SelectItem key={role} value={role} className="capitalize">
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Department</label>
                <Input
                  placeholder="Medical"
                  value={newStaff.department}
                  onChange={(e) => setNewStaff({ ...newStaff, department: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Salary (₦)</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={newStaff.salary}
                  onChange={(e) => setNewStaff({ ...newStaff, salary: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Hire Date</label>
                <Input
                  type="date"
                  value={newStaff.hireDate}
                  onChange={(e) => setNewStaff({ ...newStaff, hireDate: e.target.value })}
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button onClick={handleAddNewStaff} disabled={saving} className="press-effect">
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                Add Staff
              </Button>
              <Button variant="outline" onClick={() => { setShowAddForm(false); setNewStaff(emptyNewStaff); }}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : staff.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No staff records found. Add staff using the form above or import from CSV.</p>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead className="text-right">Salary</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      {s.firstName} {s.lastName}
                      <p className="text-xs text-muted-foreground">{s.employeeId}</p>
                    </TableCell>
                    <TableCell>
                      {editingId === s.id ? (
                        <Select
                          value={editData.role as string}
                          onValueChange={(value) => setEditData({ ...editData, role: value as UserRole })}
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLES.map(role => (
                              <SelectItem key={role} value={role} className="capitalize">
                                {role}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="capitalize">{s.role}</span>
                      )}
                    </TableCell>
                    <TableCell>{s.department}</TableCell>
                    <TableCell className="text-right">
                      {editingId === s.id ? (
                        <div className="space-y-2">
                          <Input
                            type="number"
                            value={editData.salary}
                            onChange={(e) => setEditData({ ...editData, salary: parseInt(e.target.value) || 0 })}
                            className="w-28 text-right"
                          />
                          <div className="flex gap-1 items-center">
                            <Select
                              value={adjustmentType}
                              onValueChange={(v) => setAdjustmentType(v as 'bonus' | 'deduct')}
                            >
                              <SelectTrigger className="w-20 h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="bonus">
                                  <span className="flex items-center gap-1">
                                    <Plus className="h-3 w-3 text-success" /> Bonus
                                  </span>
                                </SelectItem>
                                <SelectItem value="deduct">
                                  <span className="flex items-center gap-1">
                                    <Minus className="h-3 w-3 text-destructive" /> Deduct
                                  </span>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                            <Input
                              type="number"
                              placeholder="Amount"
                              value={adjustmentAmount}
                              onChange={(e) => setAdjustmentAmount(e.target.value)}
                              className="w-20 h-8 text-xs"
                            />
                          </div>
                        </div>
                      ) : (
                        `₦${s.salary.toLocaleString()}`
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={s.status === 'active' ? 'success' : 'warning'}>
                        {s.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {editingId === s.id ? (
                        <div className="flex gap-1 justify-center">
                          <Button size="sm" variant="success" onClick={() => handleSave(s.id)} className="h-8 w-8 p-0" disabled={saving}>
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          </Button>
                          <Button size="sm" variant="outline" onClick={handleCancel} className="h-8 w-8 p-0">
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-1 justify-center">
                          <Button size="sm" variant="ghost" onClick={() => handleEdit(s)} className="h-8 w-8 p-0">
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(s.id)} className="h-8 w-8 p-0 text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
