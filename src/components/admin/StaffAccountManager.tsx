import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth, AppRole } from '@/contexts/AuthContext';
import {
  Users, UserPlus, Key, Trash2, Eye, EyeOff, Loader2, RefreshCw, Mail, Printer, Download, Edit
} from 'lucide-react';
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

interface StaffUser {
  id: string;
  email: string;
  role: AppRole | null;
  created_at: string;
  last_sign_in_at: string | null;
}

interface CreatedCredential {
  email: string;
  password: string;
  role: string;
  createdAt: string;
}

const roleOptions: { value: AppRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'doctor1', label: 'Doctor 1' },
  { value: 'doctor2', label: 'Doctor 2' },
  { value: 'nurse', label: 'Nurse' },
  { value: 'receptionist', label: 'Receptionist' },
  { value: 'lab_tech', label: 'Lab Tech' },
  { value: 'pharmacist', label: 'Pharmacist' },
  { value: 'store', label: 'Store' },
  { value: 'billing', label: 'Billing' },
  { value: 'cashier', label: 'Cashier' },
  { value: 'claims_manager', label: 'Claims Manager' },
  { value: 'accountant', label: 'Accountant' },
  
];

const roleBadgeColor: Record<string, string> = {
  admin: 'bg-destructive/10 text-destructive border-destructive/30',
  doctor: 'bg-blue-500/10 text-blue-600 border-blue-200',
  nurse: 'bg-green-500/10 text-green-600 border-green-200',
  receptionist: 'bg-purple-500/10 text-purple-600 border-purple-200',
  lab_tech: 'bg-orange-500/10 text-orange-600 border-orange-200',
  pharmacist: 'bg-teal-500/10 text-teal-600 border-teal-200',
  billing: 'bg-yellow-500/10 text-yellow-600 border-yellow-200',
  cashier: 'bg-amber-500/10 text-amber-600 border-amber-200',
  claims_manager: 'bg-rose-500/10 text-rose-600 border-rose-200',
  accountant: 'bg-emerald-500/10 text-emerald-600 border-emerald-200',
  store: 'bg-indigo-500/10 text-indigo-600 border-indigo-200',
};

const getRoleLabel = (role: string) => roleOptions.find(r => r.value === role)?.label || role;

export function StaffAccountManager() {
  const { session } = useAuth();
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isCredentialOpen, setIsCredentialOpen] = useState(false);
  const [isRoleChangeOpen, setIsRoleChangeOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<StaffUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [changingRole, setChangingRole] = useState(false);
  const [newRoleForChange, setNewRoleForChange] = useState<AppRole>('nurse');
  const [isAdminConfirmOpen, setIsAdminConfirmOpen] = useState(false);
  const [lastCreatedCredential, setLastCreatedCredential] = useState<CreatedCredential | null>(null);
  const [credentialHistory, setCredentialHistory] = useState<CreatedCredential[]>([]);

  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<AppRole>('nurse');
  const [showPassword, setShowPassword] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);

  const invokeManage = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('manage-staff-accounts', {
      headers: { Authorization: `Bearer ${session?.access_token}` },
      body,
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  }, [session]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invokeManage({ action: 'list' });
      setUsers(data.users || []);
    } catch (err: any) {
      toast.error('Failed to load users: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [invokeManage]);

  useEffect(() => {
    if (session) fetchUsers();
  }, [session, fetchUsers]);

  const handleCreate = async () => {
    if (!newEmail || !newPassword || !newRole) return;
    setCreating(true);
    try {
      await invokeManage({
        action: 'create',
        email: newEmail,
        password: newPassword,
        role: newRole,
      });

      const cred: CreatedCredential = {
        email: newEmail,
        password: newPassword,
        role: newRole,
        createdAt: new Date().toLocaleDateString(),
      };

      setLastCreatedCredential(cred);
      setCredentialHistory(prev => [...prev, cred]);
      setIsCreateOpen(false);
      setIsCredentialOpen(true);
      setNewEmail('');
      setNewPassword('');
      setNewRole('nurse');
      toast.success(`Account created for ${cred.email}`);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleResetPassword = async () => {
    if (!selectedUser || !resetPassword) return;
    setResetting(true);
    try {
      await invokeManage({
        action: 'reset_password',
        userId: selectedUser.id,
        password: resetPassword,
      });

      const cred: CreatedCredential = {
        email: selectedUser.email,
        password: resetPassword,
        role: selectedUser.role || 'unknown',
        createdAt: new Date().toLocaleDateString() + ' (reset)',
      };
      setLastCreatedCredential(cred);
      setCredentialHistory(prev => [...prev, cred]);
      setIsResetOpen(false);
      setIsCredentialOpen(true);
      setResetPassword('');
      toast.success(`Password reset for ${selectedUser.email}`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setResetting(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedUser) return;
    try {
      await invokeManage({ action: 'delete', userId: selectedUser.id });
      toast.success(`${selectedUser.email} has been deleted`);
      setIsDeleteOpen(false);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const initiateChangeRole = () => {
    if (newRoleForChange === 'admin') {
      setIsRoleChangeOpen(false);
      setIsAdminConfirmOpen(true);
    } else {
      handleChangeRole();
    }
  };

  const handleChangeRole = async () => {
    if (!selectedUser || !newRoleForChange) return;
    setChangingRole(true);
    try {
      await invokeManage({
        action: 'change_role',
        userId: selectedUser.id,
        role: newRoleForChange,
      });
      toast.success(`Role updated to ${getRoleLabel(newRoleForChange)} for ${selectedUser.email}`);
      setIsRoleChangeOpen(false);
      setIsAdminConfirmOpen(false);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setChangingRole(false);
    }
  };

  const handlePrint = () => {
    if (!lastCreatedCredential) return;
    const c = lastCreatedCredential;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Please allow popups to print');
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Staff Credentials - ${getRoleLabel(c.role)}</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; padding: 40px; color: #1a1a1a; }
          .card { border: 2px solid #e5e7eb; border-radius: 12px; padding: 32px; max-width: 420px; margin: 0 auto; }
          .header { text-align: center; margin-bottom: 20px; }
          .header h3 { font-size: 20px; font-weight: 700; margin: 0; }
          .header p { font-size: 13px; color: #6b7280; margin: 4px 0 0; }
          .divider { border-top: 1px dashed #d1d5db; margin: 16px 0; padding-top: 16px; }
          .row { display: flex; justify-content: space-between; margin-bottom: 12px; }
          .label { font-size: 14px; color: #6b7280; font-weight: 500; }
          .value { font-size: 14px; font-weight: 600; }
          .mono { font-family: 'Courier New', monospace; letter-spacing: 0.5px; }
          .footer { font-size: 11px; color: #9ca3af; text-align: center; margin-top: 16px; }
          @media print { body { padding: 20px; } }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="header">
            <h3>Khadija Medical Center</h3>
            <p>Staff Login Credentials</p>
          </div>
          <div class="divider">
            <div class="row"><span class="label">Role:</span><span class="value">${getRoleLabel(c.role)}</span></div>
            <div class="row"><span class="label">Email:</span><span class="value mono">${c.email}</span></div>
            <div class="row"><span class="label">Password:</span><span class="value mono">${c.password}</span></div>
            <div class="row"><span class="label">Date:</span><span class="value">${c.createdAt}</span></div>
          </div>
          <p class="footer">Please change your password after first login. Keep this document secure.</p>
        </div>
        <script>window.print(); window.close();<\/script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleDownloadTxt = () => {
    if (!lastCreatedCredential) return;
    const c = lastCreatedCredential;
    const content = [
      'Khadija Medical Center - Staff Login Credentials',
      '=================================================',
      '',
      `Role: ${getRoleLabel(c.role)}`,
      `Email: ${c.email}`,
      `Password: ${c.password}`,
      `Created: ${c.createdAt}`,
      '',
      'Please change your password after first login.',
      'Keep this document secure.',
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `credentials-${c.role}-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Credentials downloaded');
  };

  const handleDownloadAllTxt = () => {
    if (credentialHistory.length === 0) {
      toast.error('No credentials to download');
      return;
    }
    const content = [
      'Khadija Medical Center - All Staff Credentials',
      '================================================',
      `Generated: ${new Date().toLocaleString()}`,
      '',
      ...credentialHistory.map(c =>
        `${getRoleLabel(c.role)}:\n  Email: ${c.email}\n  Password: ${c.password}\n  Created: ${c.createdAt}\n`
      ),
      'Please change passwords after first login.',
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `all-credentials-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('All credentials downloaded');
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          Staff Accounts
        </h3>
        <div className="flex flex-wrap gap-2">
          {credentialHistory.length > 0 && (
            <Button size="sm" variant="outline" onClick={handleDownloadAllTxt} className="text-xs sm:text-sm">
              <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1" />
              <span className="hidden sm:inline">Download All ({credentialHistory.length})</span>
              <span className="sm:hidden">All ({credentialHistory.length})</span>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={fetchUsers} disabled={loading} className="text-xs sm:text-sm">
            <RefreshCw className={`h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setIsCreateOpen(true)} className="text-xs sm:text-sm">
            <UserPlus className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1" />
            <span className="hidden sm:inline">Create Account</span>
            <span className="sm:hidden">Create</span>
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
        {/* Mobile Card View */}
        <div className="md:hidden space-y-3">
          {users.map((u) => (
            <div key={u.id} className="bg-muted/30 rounded-lg p-3 border border-border/50">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <p className="font-medium text-sm truncate">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {u.role ? (
                      <Badge className={`${roleBadgeColor[u.role] || ''} text-[10px]`}>
                        {getRoleLabel(u.role)}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">No role</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-border/50">
                <div className="text-[10px] text-muted-foreground space-y-0.5">
                  <p>Created: {new Date(u.created_at).toLocaleDateString()}</p>
                  <p>Last login: {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : 'Never'}</p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Change Role"
                    onClick={() => { setSelectedUser(u); setNewRoleForChange(u.role || 'nurse'); setIsRoleChangeOpen(true); }}>
                    <Edit className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Reset Password"
                    onClick={() => { setSelectedUser(u); setResetPassword(''); setIsResetOpen(true); }}>
                    <Key className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Delete Account"
                    onClick={() => { setSelectedUser(u); setIsDeleteOpen(true); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <p className="text-center text-muted-foreground py-8 text-sm">No staff accounts found</p>
          )}
        </div>

        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Created</th>
                <th>Last Sign In</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{u.email}</span>
                    </div>
                  </td>
                  <td>
                    {u.role ? (
                      <Badge className={roleBadgeColor[u.role] || ''}>
                        {getRoleLabel(u.role)}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">No role</span>
                    )}
                  </td>
                  <td className="text-sm text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="text-sm text-muted-foreground">
                    {u.last_sign_in_at
                      ? new Date(u.last_sign_in_at).toLocaleDateString()
                      : 'Never'}
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Change Role"
                        onClick={() => { setSelectedUser(u); setNewRoleForChange(u.role || 'nurse'); setIsRoleChangeOpen(true); }}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Reset Password"
                        onClick={() => { setSelectedUser(u); setResetPassword(''); setIsResetOpen(true); }}>
                        <Key className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Delete Account"
                        onClick={() => { setSelectedUser(u); setIsDeleteOpen(true); }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-muted-foreground py-8">
                    No staff accounts found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* Create Account Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Staff Account</DialogTitle>
            <DialogDescription>
              Create a new login account. After creation you can print or download the credentials.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                placeholder="staff@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Password</label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Minimum 6 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              <select
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as AppRole)}
              >
                {roleOptions.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={creating || !newEmail || !newPassword || newPassword.length < 6}
            >
              {creating ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Creating...</>
              ) : (
                <><UserPlus className="h-4 w-4 mr-1" /> Create Account</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Credential Card Dialog */}
      <Dialog open={isCredentialOpen} onOpenChange={setIsCredentialOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Credentials Ready</DialogTitle>
            <DialogDescription>
              Print or download to hand to the staff member. The password won't be shown again.
            </DialogDescription>
          </DialogHeader>
          {lastCreatedCredential && (
            <div className="border border-border rounded-lg p-6 my-2">
              <div className="text-center mb-4">
                <h3 className="text-lg font-bold">Khadija Medical Center</h3>
                <p className="text-sm text-muted-foreground">Staff Login Credentials</p>
              </div>
              <div className="border-t border-dashed border-border pt-4 space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Role:</span>
                  <span className="text-sm font-semibold">{getRoleLabel(lastCreatedCredential.role)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Email:</span>
                  <span className="text-sm font-mono">{lastCreatedCredential.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Password:</span>
                  <span className="text-sm font-mono">{lastCreatedCredential.password}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Date:</span>
                  <span className="text-sm">{lastCreatedCredential.createdAt}</span>
                </div>
              </div>
              <div className="border-t border-dashed border-border mt-4 pt-3">
                <p className="text-xs text-muted-foreground text-center">
                  Please change your password after first login.
                </p>
              </div>
            </div>
          )}
          <DialogFooter className="flex gap-2 sm:gap-2">
            <Button variant="outline" onClick={handleDownloadTxt}>
              <Download className="h-4 w-4 mr-1" />
              Download
            </Button>
            <Button onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-1" />
              Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={isResetOpen} onOpenChange={setIsResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Set a new password for {selectedUser?.email}. You can print the new credentials after.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">New Password</label>
              <div className="relative">
                <Input
                  type={showResetPassword ? 'text' : 'password'}
                  placeholder="Minimum 6 characters"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowResetPassword(!showResetPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showResetPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsResetOpen(false)}>Cancel</Button>
            <Button
              onClick={handleResetPassword}
              disabled={resetting || resetPassword.length < 6}
            >
              {resetting ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Resetting...</>
              ) : (
                <><Key className="h-4 w-4 mr-1" /> Reset Password</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Role Dialog */}
      <Dialog open={isRoleChangeOpen} onOpenChange={setIsRoleChangeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Role</DialogTitle>
            <DialogDescription>
              Update the role for {selectedUser?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">New Role</label>
              <select
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
                value={newRoleForChange}
                onChange={(e) => setNewRoleForChange(e.target.value as AppRole)}
              >
                {roleOptions.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRoleChangeOpen(false)}>Cancel</Button>
            <Button onClick={initiateChangeRole} disabled={changingRole}>
              {changingRole ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Updating...</>
              ) : (
                <><Edit className="h-4 w-4 mr-1" /> Update Role</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Account</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete the account for{' '}
              <strong>{selectedUser?.email}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete Account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Admin Role Escalation Confirmation */}
      <AlertDialog open={isAdminConfirmOpen} onOpenChange={(open) => {
        setIsAdminConfirmOpen(open);
        if (!open) setIsRoleChangeOpen(true);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              ⚠️ Privilege Escalation Warning
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                You are about to grant <strong>Admin</strong> privileges to{' '}
                <strong>{selectedUser?.email}</strong>.
              </p>
              <p>
                Admin users have <strong>full system access</strong> including the ability to create/delete accounts,
                change roles, view audit logs, and manage all system settings.
              </p>
              <p className="font-medium">Are you sure you want to proceed?</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleChangeRole}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Yes, Grant Admin Access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
