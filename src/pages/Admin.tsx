import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Shield, 
  Users,
  Settings,
  FileText,
  Bell,
  Lock,
  UserPlus,
  Eye,
  Edit,
  Trash2,
  X,
  Check,
  ClipboardList,
  AlertTriangle,
  AlertTriangle
} from 'lucide-react';
import { AuditLogsViewer } from '@/components/admin/AuditLogsViewer';
import { StaffAccountManager } from '@/components/admin/StaffAccountManager';
import { ErrorLogsViewer } from '@/components/admin/ErrorLogsViewer';

import { mockStaff } from '@/data/mockData';
import { Staff, UserRole } from '@/types/hms';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { toast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const systemAlerts = [
  { id: 1, message: 'Low stock alert: Insulin Syringes below minimum', type: 'warning', time: '10 mins ago' },
  { id: 2, message: 'New staff registration pending approval', type: 'info', time: '1 hour ago' },
  { id: 3, message: 'Daily backup completed successfully', type: 'success', time: '2 hours ago' },
];

const Admin = () => {
  const [staff, setStaff] = useState(mockStaff);
  const [selectedUser, setSelectedUser] = useState<typeof mockStaff[0] | null>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState<{ firstName: string; lastName: string; email: string; role: UserRole; department: string; phone: string }>({ firstName: '', lastName: '', email: '', role: 'nurse', department: '', phone: '' });

  const handleView = (user: typeof mockStaff[0]) => {
    setSelectedUser(user);
    setIsViewDialogOpen(true);
  };

  const handleEdit = (user: typeof mockStaff[0]) => {
    setSelectedUser(user);
    setEditForm({
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role as typeof editForm.role,
      department: user.department,
      phone: user.phone
    });
    setIsEditDialogOpen(true);
  };

  const handleSaveEdit = () => {
    if (selectedUser) {
      setStaff(staff.map(s => s.id === selectedUser.id ? { 
        ...s, 
        firstName: editForm.firstName,
        lastName: editForm.lastName,
        email: editForm.email,
        role: editForm.role as Staff['role'],
        department: editForm.department,
        phone: editForm.phone || s.phone
      } : s));
      toast({
        title: "User Updated",
        description: `${editForm.firstName} ${editForm.lastName}'s profile has been updated.`,
      });
      setIsEditDialogOpen(false);
    }
  };

  const handleDelete = (user: typeof mockStaff[0]) => {
    setSelectedUser(user);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (selectedUser) {
      setStaff(staff.filter(s => s.id !== selectedUser.id));
      toast({
        title: "User Deleted",
        description: `${selectedUser.firstName} ${selectedUser.lastName} has been removed from the system.`,
        variant: "destructive",
      });
      setIsDeleteDialogOpen(false);
    }
  };

  const handleAddUser = () => {
    setEditForm({ firstName: '', lastName: '', email: '', role: 'nurse', department: 'Nursing', phone: '' });
    setIsAddDialogOpen(true);
  };

  const confirmAddUser = () => {
    const newUser: Staff = {
      id: `staff-${Date.now()}`,
      employeeId: `EMP-${Date.now().toString().slice(-6)}`,
      firstName: editForm.firstName,
      lastName: editForm.lastName,
      email: editForm.email,
      phone: editForm.phone || '08000000000',
      role: editForm.role as Staff['role'],
      department: editForm.department,
      status: 'active',
      salary: 150000,
      hireDate: new Date().toISOString().split('T')[0],
    };
    setStaff([...staff, newUser]);
    toast({
      title: "User Added",
      description: `${editForm.firstName} ${editForm.lastName} has been added to the system.`,
    });
    setIsAddDialogOpen(false);
  };

  const handleSettingsClick = (setting: string) => {
    toast({
      title: `${setting}`,
      description: `Opening ${setting.toLowerCase()}...`,
    });
  };

  const handleGenerateReport = () => {
    toast({
      title: "Generating Report",
      description: "Admin report is being generated. This may take a moment.",
    });
    setTimeout(() => {
      toast({
        title: "Report Ready",
        description: "Admin report has been generated and is ready for download.",
      });
    }, 2000);
  };

  return (
    <MainLayout title="Admin Panel" subtitle="System administration and user management">
      <Tabs defaultValue="overview" className="space-y-6">
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="inline-flex w-auto min-w-full sm:grid sm:w-full sm:max-w-2xl sm:grid-cols-4">
            <TabsTrigger value="overview" className="flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap">
              <Shield className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Overview</span>
              <span className="sm:hidden">Overview</span>
            </TabsTrigger>
            <TabsTrigger value="accounts" className="flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap">
              <UserPlus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span>Accounts</span>
            </TabsTrigger>
            <TabsTrigger value="audit" className="flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap">
              <ClipboardList className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Audit Logs</span>
              <span className="sm:hidden">Audit</span>
            </TabsTrigger>
            <TabsTrigger value="errors" className="flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap">
              <AlertTriangle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Error Logs</span>
              <span className="sm:hidden">Errors</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total Users"
          value={staff.length}
          icon={Users}
          color="text-module-admin"
        />
        <StatsCard
          title="Active Sessions"
          value="8"
          icon={Eye}
          color="text-success"
        />
        <StatsCard
          title="Pending Approvals"
          value="3"
          icon={Bell}
          color="text-warning"
        />
        <StatsCard
          title="System Health"
          value="99.9%"
          icon={Shield}
          color="text-primary"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* User Management */}
        <div className="lg:col-span-2">
          <div className="bg-card rounded-xl border border-border">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <Users className="h-5 w-5 text-module-admin" />
                User Management
              </h3>
              <Button size="sm" onClick={handleAddUser} className="press-effect">
                <UserPlus className="h-4 w-4 mr-1" />
                Add User
              </Button>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden space-y-3 p-4">
              {staff.map((staffMember) => (
                <div key={staffMember.id} className="bg-muted/30 rounded-lg p-3 border border-border/50 animate-fade-in">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{staffMember.firstName} {staffMember.lastName}</p>
                      <p className="text-xs text-muted-foreground truncate">{staffMember.email}</p>
                    </div>
                    <Badge variant={staffMember.status === 'active' ? 'success' : 'warning'} className="text-[10px] shrink-0">
                      {staffMember.status}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-border/50">
                    <div className="flex items-center gap-2">
                      <Badge variant={staffMember.role as any} className="text-[10px]">{staffMember.role}</Badge>
                      <span className="text-xs text-muted-foreground">{staffMember.department}</span>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleView(staffMember)}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(staffMember)}>
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(staffMember)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Role</th>
                    <th>Department</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((staffMember) => (
                    <tr key={staffMember.id} className="animate-fade-in">
                      <td>
                        <div>
                          <p className="font-medium">{staffMember.firstName} {staffMember.lastName}</p>
                          <p className="text-xs text-muted-foreground">{staffMember.email}</p>
                        </div>
                      </td>
                      <td>
                        <Badge variant={staffMember.role as any}>{staffMember.role}</Badge>
                      </td>
                      <td>{staffMember.department}</td>
                      <td>
                        <Badge variant={staffMember.status === 'active' ? 'success' : 'warning'}>
                          {staffMember.status}
                        </Badge>
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8 hover-lift" onClick={() => handleView(staffMember)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 hover-lift" onClick={() => handleEdit(staffMember)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover-lift" onClick={() => handleDelete(staffMember)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* System Alerts & Settings */}
        <div className="space-y-6">
          {/* System Alerts */}
          <div className="bg-card rounded-xl border border-border p-4">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Bell className="h-5 w-5 text-module-admin" />
              System Alerts
            </h3>

            <div className="space-y-3">
              {systemAlerts.map((alert) => (
                <div 
                  key={alert.id} 
                  className={`p-3 rounded-lg border cursor-pointer transition-all hover:scale-[1.02] ${
                    alert.type === 'warning' ? 'bg-warning/10 border-warning/30' :
                    alert.type === 'success' ? 'bg-success/10 border-success/30' :
                    'bg-info/10 border-info/30'
                  }`}
                  onClick={() => toast({ title: "Alert Details", description: alert.message })}
                >
                  <p className="text-sm font-medium">{alert.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">{alert.time}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Settings */}
          <div className="bg-card rounded-xl border border-border p-4">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Settings className="h-5 w-5 text-module-admin" />
              Quick Settings
            </h3>

            <div className="space-y-2">
              <Button 
                variant="outline" 
                className="w-full justify-start hover-lift"
                onClick={() => handleSettingsClick('Security Settings')}
              >
                <Lock className="h-4 w-4 mr-2" />
                Security Settings
              </Button>
              <Button 
                variant="outline" 
                className="w-full justify-start hover-lift"
                onClick={() => handleSettingsClick('System Logs')}
              >
                <FileText className="h-4 w-4 mr-2" />
                System Logs
              </Button>
              <Button 
                variant="outline" 
                className="w-full justify-start hover-lift"
                onClick={() => handleSettingsClick('General Settings')}
              >
                <Settings className="h-4 w-4 mr-2" />
                General Settings
              </Button>
            </div>
          </div>

          <Button variant="hero" className="w-full press-effect" onClick={handleGenerateReport}>
            <FileText className="h-4 w-4 mr-2" />
            Generate Admin Report
          </Button>
        </div>
      </div>
        </TabsContent>

        <TabsContent value="accounts" className="space-y-6">
          <div className="bg-card rounded-xl border border-border p-6">
            <StaffAccountManager />
          </div>
        </TabsContent>




        <TabsContent value="audit" className="space-y-6">
          <div className="bg-card rounded-xl border border-border p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-module-admin" />
              Audit Logs
            </h3>
            <AuditLogsViewer />
          </div>
        </TabsContent>

        <TabsContent value="errors" className="space-y-6">
          <div className="bg-card rounded-xl border border-border p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Error Logs
            </h3>
            <ErrorLogsViewer />
          </div>
        </TabsContent>
      </Tabs>

      {/* View User Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="animate-scale-in">
          <DialogHeader>
            <DialogTitle>User Details</DialogTitle>
            <DialogDescription>Viewing user profile information</DialogDescription>
          </DialogHeader>
          {selectedUser && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-module-admin/10 flex items-center justify-center">
                  <Users className="h-8 w-8 text-module-admin" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">{selectedUser.firstName} {selectedUser.lastName}</h3>
                  <p className="text-muted-foreground">{selectedUser.email}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                <div>
                  <p className="text-sm text-muted-foreground">Role</p>
                  <p className="font-medium capitalize">{selectedUser.role}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Department</p>
                  <p className="font-medium">{selectedUser.department}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <Badge variant={selectedUser.status === 'active' ? 'success' : 'warning'}>
                    {selectedUser.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Hire Date</p>
                  <p className="font-medium">{selectedUser.hireDate}</p>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsViewDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="animate-scale-in">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>Update user profile information</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">First Name</label>
                <Input 
                  value={editForm.firstName}
                  onChange={(e) => setEditForm({...editForm, firstName: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Last Name</label>
                <Input 
                  value={editForm.lastName}
                  onChange={(e) => setEditForm({...editForm, lastName: e.target.value})}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input 
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({...editForm, email: e.target.value})}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Role</label>
                <select 
                  className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
                  value={editForm.role}
                  onChange={(e) => setEditForm({...editForm, role: e.target.value as UserRole})}
                >
                  <option value="doctor">Doctor</option>
                  <option value="nurse">Nurse</option>
                  <option value="reception">Reception</option>
                  <option value="pharmacy">Pharmacy</option>
                  <option value="lab">Lab</option>
                  <option value="admin">Admin</option>
                  <option value="billing">Billing</option>
                  <option value="store">Store</option>
                  <option value="account">Account</option>
                  <option value="auditing">Auditing</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Department</label>
                <Input 
                  value={editForm.department}
                  onChange={(e) => setEditForm({...editForm, department: e.target.value})}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveEdit} className="press-effect">
              <Check className="h-4 w-4 mr-1" />
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add User Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="animate-scale-in">
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
            <DialogDescription>Create a new user account</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">First Name</label>
                <Input 
                  value={editForm.firstName}
                  onChange={(e) => setEditForm({...editForm, firstName: e.target.value})}
                  placeholder="Enter first name"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Last Name</label>
                <Input 
                  value={editForm.lastName}
                  onChange={(e) => setEditForm({...editForm, lastName: e.target.value})}
                  placeholder="Enter last name"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input 
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({...editForm, email: e.target.value})}
                placeholder="Enter email address"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Role</label>
                <select 
                  className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
                  value={editForm.role}
                  onChange={(e) => setEditForm({...editForm, role: e.target.value as UserRole})}
                >
                  <option value="doctor">Doctor</option>
                  <option value="nurse">Nurse</option>
                  <option value="reception">Reception</option>
                  <option value="pharmacy">Pharmacy</option>
                  <option value="lab">Lab</option>
                  <option value="admin">Admin</option>
                  <option value="billing">Billing</option>
                  <option value="store">Store</option>
                  <option value="account">Account</option>
                  <option value="auditing">Auditing</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Department</label>
                <Input 
                  value={editForm.department}
                  onChange={(e) => setEditForm({...editForm, department: e.target.value})}
                  placeholder="Enter department"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>Cancel</Button>
            <Button onClick={confirmAddUser} className="press-effect" disabled={!editForm.firstName || !editForm.lastName || !editForm.email}>
              <UserPlus className="h-4 w-4 mr-1" />
              Add User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent className="animate-scale-in">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedUser?.firstName} {selectedUser?.lastName}? 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              <Trash2 className="h-4 w-4 mr-1" />
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
};

export default Admin;