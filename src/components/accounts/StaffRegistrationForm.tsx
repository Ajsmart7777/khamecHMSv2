import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { UserPlus, Loader2, RefreshCw, Search, Trash2, KeyRound, ShieldCheck } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Staff, UserRole } from '@/types/hms';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  staff: Staff[];
  loading: boolean;
  onAddStaff: (staff: Omit<Staff, 'id'>) => Promise<boolean>;
  onDeleteStaff: (id: string) => Promise<boolean>;
  onRefetch: () => void;
}

// Roles that MUST match the app_role enum in the database (used for login accounts)
const SYSTEM_ROLES: { value: string; label: string }[] = [
  { value: 'receptionist', label: 'Receptionist' },
  { value: 'nurse', label: 'Nurse' },
  { value: 'doctor1', label: 'Doctor 1' },
  { value: 'doctor2', label: 'Doctor 2' },
  { value: 'lab_tech', label: 'Lab Technician' },
  { value: 'pharmacist', label: 'Pharmacist' },
  { value: 'billing', label: 'Billing / Cashier' },
  { value: 'cashier', label: 'Cashier' },
  { value: 'claims_manager', label: 'Claims Manager' },
  { value: 'store', label: 'Store' },
  { value: 'accountant', label: 'Accountant' },
  { value: 'admin', label: 'Admin' },
];

const DEPARTMENTS = [
  'General', 'Outpatient', 'Inpatient', 'Emergency', 'Laboratory',
  'Pharmacy', 'Radiology', 'Administration', 'Finance', 'Nursing',
];

const NIGERIAN_BANKS = [
  'Access Bank', 'Citibank', 'Ecobank', 'Fidelity Bank', 'First Bank',
  'First City Monument Bank', 'Globus Bank', 'Guaranty Trust Bank',
  'Heritage Bank', 'Keystone Bank', 'Polaris Bank', 'Providus Bank',
  'Stanbic IBTC Bank', 'Standard Chartered', 'Sterling Bank', 'SunTrust Bank',
  'Titan Trust Bank', 'Union Bank', 'United Bank for Africa', 'Unity Bank',
  'Wema Bank', 'Zenith Bank', 'Jaiz Bank', 'Kuda Bank', 'Moniepoint MFB',
  'OPay', 'PalmPay', 'VFD MFB',
];

export function StaffRegistrationForm({ staff, loading, onAddStaff, onDeleteStaff, onRefetch }: Props) {
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    staffId: '',
    designation: '',
    fullName: '',
    email: '',
    phone: '',
    isSystemUser: false,
    role: '' as string,
    password: '',
    department: 'General',
    salary: '',
    hireDate: new Date().toISOString().split('T')[0],
    bankName: '',
    accountNumber: '',
    staffIdNumber: '',
    familyDeductionConsent: false,
  });

  const resetForm = () => {
    setForm({
      staffId: '',
      designation: '',
      fullName: '',
      email: '',
      phone: '',
      isSystemUser: false,
      role: '',
      password: '',
      department: 'General',
      salary: '',
      hireDate: new Date().toISOString().split('T')[0],
      bankName: '',
      accountNumber: '',
      staffIdNumber: '',
      familyDeductionConsent: false,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nameParts = form.fullName.trim().split(/\s+/);
    if (nameParts.length < 2 || !form.staffId || !form.designation) {
      toast({ title: 'Validation Error', description: 'Please fill Staff ID, Designation, and Full Name (first & last).', variant: 'destructive' });
      return;
    }

    if (form.isSystemUser) {
      if (!form.role) {
        toast({ title: 'Role required', description: 'Select a system role for this login account.', variant: 'destructive' });
        return;
      }
      if (!form.email.trim()) {
        toast({ title: 'Email required', description: 'System users need a login email.', variant: 'destructive' });
        return;
      }
      if (form.password.length < 8) {
        toast({ title: 'Password too short', description: 'Password must be at least 8 characters.', variant: 'destructive' });
        return;
      }
    }

    setSaving(true);
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ');
    let authUserId: string | null = null;

    // 1) If system user: create login via edge function (admin only)
    if (form.isSystemUser) {
      const { data, error } = await supabase.functions.invoke('manage-staff-accounts', {
        body: {
          action: 'create',
          email: form.email.trim().toLowerCase(),
          password: form.password,
          role: form.role,
        },
      });
      if (error || !data?.success) {
        setSaving(false);
        toast({ title: 'Login creation failed', description: error?.message || data?.error || 'Could not create login account.', variant: 'destructive' });
        return;
      }
      authUserId = data.userId ?? null;
    }

    const newStaff: Omit<Staff, 'id'> = {
      employeeId: form.staffId.trim(),
      firstName,
      lastName,
      email: form.email.trim() || `${form.staffId.toLowerCase()}@kmc.local`,
      phone: form.phone.trim() || '',
      role: (form.isSystemUser ? form.role : (form.role || 'receptionist')) as UserRole,
      department: form.department,
      salary: Number(form.salary) || 0,
      hireDate: form.hireDate,
      status: 'active',
      bankName: form.bankName || null,
      accountNumber: form.accountNumber || null,
      paymentMethod: form.bankName ? 'bank' : 'cash',
      designation: form.designation || null,
      staffIdNumber: form.staffIdNumber || null,
      isSystemUser: form.isSystemUser,
      familyDeductionConsent: form.familyDeductionConsent,
      authUserId,
    };

    const success = await onAddStaff(newStaff);
    setSaving(false);
    if (success) resetForm();
  };

  const filtered = staff.filter(s =>
    `${s.firstName} ${s.lastName} ${s.employeeId} ${s.role}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Registration Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Add New Staff
          </CardTitle>
          <CardDescription>Add a new staff member to the payroll system</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Row 1: Staff ID + Designation */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Staff ID <span className="text-destructive">*</span></Label>
                <Input value={form.staffId} onChange={e => setForm(f => ({ ...f, staffId: e.target.value }))} placeholder="e.g., KMC001" required />
              </div>
              <div className="space-y-2">
                <Label>Designation <span className="text-destructive">*</span></Label>
                <Input value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} placeholder="e.g., Nurse, Doctor" required />
              </div>
            </div>

            {/* Row 2: Full Name */}
            <div className="space-y-2">
              <Label>Full Name <span className="text-destructive">*</span></Label>
              <Input value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} placeholder="Enter full name" required />
            </div>

            {/* Row 3: Email + Phone */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@example.com" />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="080xxxxxxxx" />
              </div>
            </div>

            {/* System user toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/30">
              <div className="flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 text-primary mt-0.5" />
                <div>
                  <Label className="text-sm font-medium">System User (has login)</Label>
                  <p className="text-xs text-muted-foreground">Enable for staff who log into the app (nurse, reception, doctor, etc.)</p>
                </div>
              </div>
              <Switch checked={form.isSystemUser} onCheckedChange={v => setForm(f => ({ ...f, isSystemUser: v, role: v ? f.role : '' }))} />
            </div>

            {/* Row 4: Role + Department (Role only when system user) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {form.isSystemUser ? (
                <div className="space-y-2">
                  <Label>System Role <span className="text-destructive">*</span></Label>
                  <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                    <SelectContent>
                      {SYSTEM_ROLES.map(r => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Role</Label>
                  <Input value="Non-system staff" disabled />
                </div>
              )}
              <div className="space-y-2">
                <Label>Department</Label>
                <Select value={form.department} onValueChange={v => setForm(f => ({ ...f, department: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map(d => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Password (system users only) */}
            {form.isSystemUser && (
              <div className="space-y-2">
                <Label>Login Password <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="password"
                    className="pl-9"
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="At least 8 characters"
                    minLength={8}
                  />
                </div>
                <p className="text-xs text-muted-foreground">Staff will use their email + this password to sign in.</p>
              </div>
            )}

            {/* Row 5: Salary + Hire Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Monthly Salary (₦)</Label>
                <Input type="number" min={0} value={form.salary} onChange={e => setForm(f => ({ ...f, salary: e.target.value }))} placeholder="0" />
              </div>
              <div className="space-y-2">
                <Label>Hire Date</Label>
                <Input type="date" value={form.hireDate} onChange={e => setForm(f => ({ ...f, hireDate: e.target.value }))} />
              </div>
            </div>

            {/* Family salary-deduction consent */}
            <div className="flex items-start justify-between p-3 rounded-lg border border-warning/30 bg-warning/5">
              <div className="pr-3">
                <Label className="text-sm font-medium">Family salary-deduction consent</Label>
                <p className="text-xs text-muted-foreground">
                  Staff agrees the unpaid 50% share on family invoices may be deducted from their salary.
                </p>
              </div>
              <Switch
                checked={form.familyDeductionConsent}
                onCheckedChange={v => setForm(f => ({ ...f, familyDeductionConsent: v }))}
              />
            </div>


            <Separator />

            {/* Bank Details Section */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Bank Details</h3>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Select Bank</Label>
                  <Select value={form.bankName} onValueChange={v => setForm(f => ({ ...f, bankName: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select a bank" /></SelectTrigger>
                    <SelectContent>
                      {NIGERIAN_BANKS.map(b => (
                        <SelectItem key={b} value={b}>{b}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Account Number</Label>
                  <Input value={form.accountNumber} onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value }))} placeholder="10-digit account number" maxLength={10} />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={resetForm}>Clear</Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UserPlus className="h-4 w-4 mr-2" />}
                Add Staff
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Registered Staff List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Registered Staff ({staff.length})</CardTitle>
            <Button variant="outline" size="sm" onClick={onRefetch}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
          </div>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search staff..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="border border-border rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden md:table-cell">Designation</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="hidden lg:table-cell">Department</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-16">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(s => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">{s.employeeId}</TableCell>
                      <TableCell className="font-medium">{s.firstName} {s.lastName}</TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground text-xs">{s.designation || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">{s.role}</Badge>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-muted-foreground text-xs">{s.department}</TableCell>
                      <TableCell>
                        <Badge variant={s.status === 'active' ? 'success' : 'warning'}>{s.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => onDeleteStaff(s.id)} className="text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No staff found</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
