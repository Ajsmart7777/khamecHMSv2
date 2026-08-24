import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search, Edit2, Trash2, Loader2, CheckCircle2 } from 'lucide-react';
import { Staff } from '@/types/hms';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  staff: Staff[];
  loading: boolean;
  onRefetch: () => void;
}

const NIGERIAN_BANKS = [
  'Access Bank', 'Citibank', 'Ecobank', 'Fidelity Bank', 'First Bank',
  'First City Monument Bank', 'Globus Bank', 'Guaranty Trust Bank',
  'Heritage Bank', 'Keystone Bank', 'Polaris Bank', 'Providus Bank',
  'Stanbic IBTC Bank', 'Standard Chartered', 'Sterling Bank', 'SunTrust Bank',
  'Titan Trust Bank', 'Union Bank', 'United Bank for Africa', 'Unity Bank',
  'Wema Bank', 'Zenith Bank', 'Jaiz Bank', 'Kuda Bank', 'Moniepoint MFB',
  'OPay', 'PalmPay', 'VFD MFB',
];

const DESIGNATIONS = [
  'Manager', 'Asst. Manager', 'Medical Officer', 'Cashier', 'Auditor', 'Driver', 'Cleaner',
  'HOD. Account', 'Asst. HOD Accountant', 'Revenue Accountant', 'Receptionist', 'Expenditure Accountant',
  'Asst. Exp. Accountant', 'Chief Medical Officer', 'Nurse', 'Substaff', 'Security', 'Immunization',
  'Pharmacy', 'Lab Technician', 'Lab Scientist',
];

const QUALIFICATIONS = ['BSc', 'MSc', 'MBBS', 'NCE', 'ND', 'HND', 'RN', 'RM', 'RN/RM', 'B.Pharm', 'Pharm.D', 'MLS', 'SSCE', 'Diploma', 'Other'];

const FLUTTERWAVE_BANK_CODES: Record<string, string> = {
  'Access Bank': '044', 'Citibank': '023', 'Ecobank': '050', 'Fidelity Bank': '070',
  'First Bank': '011', 'First City Monument Bank': '214', 'Globus Bank': '00103',
  'Guaranty Trust Bank': '058', 'Heritage Bank': '030', 'Keystone Bank': '082',
  'Polaris Bank': '076', 'Providus Bank': '101', 'Stanbic IBTC Bank': '221',
  'Standard Chartered': '068', 'Sterling Bank': '232', 'SunTrust Bank': '100',
  'Titan Trust Bank': '000025', 'Union Bank': '032', 'United Bank for Africa': '033',
  'Unity Bank': '215', 'Wema Bank': '035', 'Zenith Bank': '057', 'Jaiz Bank': '301',
  'Kuda Bank': '090267', 'Moniepoint MFB': '110007', 'OPay': '100004',
  'PalmPay': '100033', 'VFD MFB': '090110',
};

export function PayrollStaffManagement({ staff, loading, onRefetch }: Props) {
  const [search, setSearch] = useState('');
  const [bankSearch, setBankSearch] = useState('');
  const [beneficiaryName, setBeneficiaryName] = useState<string | null>(null);
  const [verifyingBank, setVerifyingBank] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [editStaff, setEditStaff] = useState<Staff | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [designation, setDesignation] = useState('');
  const [qualification, setQualification] = useState('');
  const [saving, setSaving] = useState(false);
  const [detailsStaff, setDetailsStaff] = useState<Staff | null>(null);

  const filtered = staff.filter(s =>
    `${s.firstName} ${s.lastName} ${s.employeeId}`.toLowerCase().includes(search.toLowerCase())
  );

  const openEdit = (s: Staff) => {
    setEditStaff(s);
    setFirstName(s.firstName);
    setLastName(s.lastName);
    setBankSearch('');
    setBeneficiaryName(null);
    // We need to fetch the extra fields from DB
    supabase.from('staff').select('bank_name, account_number, payment_method, designation, qualification').eq('id', s.id).single()
      .then(({ data }) => {
        setBankName(data?.bank_name || '');
        setAccountNumber(data?.account_number || '');
        setPaymentMethod(data?.payment_method || 'cash');
        setDesignation(data?.designation || s.designation || '');
        setQualification(data?.qualification || s.qualification || '');
        setEditDialog(true);
      });
  };

  const handleSave = async () => {
    if (!editStaff) return;
    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();
    if (!trimmedFirstName || !trimmedLastName) {
      toast({ title: 'Name required', description: 'Enter both first name and last name before saving.', variant: 'destructive' });
      return;
    }
    if (paymentMethod === 'bank') {
      if (!bankName || accountNumber.length !== 10) {
        toast({ title: 'Incomplete bank details', description: 'Select a bank and enter the full 10-digit account number.', variant: 'destructive' });
        return;
      }
      if (!beneficiaryName) {
        toast({ title: 'Verify bank account first', description: 'Confirm the beneficiary before saving bank-transfer details.', variant: 'destructive' });
        return;
      }
    }
    setSaving(true);
    const updates: Record<string, unknown> = {
      first_name: trimmedFirstName,
      last_name: trimmedLastName,
      bank_name: paymentMethod === 'bank' ? bankName : null,
      account_number: paymentMethod === 'bank' ? accountNumber : null,
      payment_method: paymentMethod,
      designation: designation || null,
      qualification: qualification || null,
    };

    const { error } = await supabase.from('staff').update(updates).eq('id', editStaff.id);
    setSaving(false);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Staff updated', description: 'Name, designation, qualification, and payment details saved.' });
    setEditDialog(false);
    onRefetch();
  };

  const maskAccount = (acc: string | null) => {
    if (!acc || acc.length < 4) return acc || '—';
    return '****' + acc.slice(-4);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search staff..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <Table className="min-w-[980px] table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Staff ID</TableHead>
                <TableHead className="w-56">Staff Name</TableHead>
                <TableHead className="w-48">Designation</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead className="hidden lg:table-cell">Bank</TableHead>
                <TableHead className="hidden lg:table-cell">Account</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(s => (
                  <TableRow key={s.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setDetailsStaff(s)}>
                    <TableCell className="w-28 whitespace-nowrap font-mono text-xs">{s.employeeId}</TableCell>
                    <TableCell className="w-56 whitespace-normal break-words font-medium">{s.firstName} {s.lastName}</TableCell>
                    <TableCell className="w-48 whitespace-normal break-words text-muted-foreground">{s.designation || s.department || '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs capitalize">
                        {s.paymentMethod || 'cash'}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-muted-foreground text-xs">{s.bankName || '—'}</TableCell>
                    <TableCell className="hidden lg:table-cell text-muted-foreground text-xs">{s.accountNumber ? maskAccount(s.accountNumber) : '—'}</TableCell>
                    <TableCell>
                      <Badge variant={s.status === 'active' ? 'success' : 'warning'}>{s.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={(event) => { event.stopPropagation(); openEdit(s); }}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">No staff found</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={Boolean(detailsStaff)} onOpenChange={open => { if (!open) setDetailsStaff(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Staff Information</DialogTitle></DialogHeader>
          {detailsStaff && (
            <div className="grid grid-cols-1 gap-3 py-2 text-sm sm:grid-cols-2">
              <Detail label="Staff ID" value={detailsStaff.employeeId} />
              <Detail label="Full Name" value={`${detailsStaff.firstName} ${detailsStaff.lastName}`} />
              <Detail label="Designation" value={detailsStaff.designation || '—'} />
              <Detail label="Qualification" value={detailsStaff.qualification || '—'} />
              <Detail label="System Role" value={detailsStaff.role || '—'} />
              <Detail label="Department" value={detailsStaff.department || '—'} />
              <Detail label="Email" value={detailsStaff.email || '—'} />
              <Detail label="Phone" value={detailsStaff.phone || '—'} />
              <Detail label="Salary" value={`₦${Number(detailsStaff.salary || 0).toLocaleString()}`} />
              <Detail label="Hire Date" value={detailsStaff.hireDate || '—'} />
              <Detail label="Payment Method" value={detailsStaff.paymentMethod || 'cash'} />
              <Detail label="Bank" value={detailsStaff.bankName || '—'} />
              <Detail label="Account Number" value={detailsStaff.accountNumber || '—'} />
              <Detail label="Status" value={detailsStaff.status} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Staff Details</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm font-medium">Editing: {editStaff?.firstName} {editStaff?.lastName} ({editStaff?.employeeId})</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2"><label className="text-sm font-medium">First Name</label><Input value={firstName} onChange={event => setFirstName(event.target.value)} placeholder="First name" /></div>
              <div className="space-y-2"><label className="text-sm font-medium">Last Name</label><Input value={lastName} onChange={event => setLastName(event.target.value)} placeholder="Last name" /></div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Designation</label>
              <Select value={designation} onValueChange={setDesignation}>
                <SelectTrigger><SelectValue placeholder="Select designation" /></SelectTrigger>
                <SelectContent>{DESIGNATIONS.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Qualification</label>
              <Select value={qualification} onValueChange={setQualification}>
                <SelectTrigger><SelectValue placeholder="Select qualification" /></SelectTrigger>
                <SelectContent>{QUALIFICATIONS.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Payment Method</label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank">Bank Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {paymentMethod === 'bank' && (
              <>
                <p className="text-xs text-muted-foreground">Search the bank, verify the account, and save only after the beneficiary is displayed. The beneficiary does not need to match the staff name.</p>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Bank Name</label>
                  <Input value={bankSearch} onChange={e => setBankSearch(e.target.value)} placeholder="Search bank name…" />
                  <Select value={bankName} onValueChange={value => { setBankName(value); setBeneficiaryName(null); }}>
                    <SelectTrigger><SelectValue placeholder="Select bank" /></SelectTrigger>
                    <SelectContent>
                      {NIGERIAN_BANKS.filter(bank => bank.toLowerCase().includes(bankSearch.toLowerCase())).map(b => (
                        <SelectItem key={b} value={b}>{b}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Account Number</label>
                  <div className="flex gap-2">
                    <Input value={accountNumber} onChange={e => { setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 10)); setBeneficiaryName(null); }} placeholder="0123456789" inputMode="numeric" maxLength={10} />
                    <Button type="button" variant="outline" disabled={verifyingBank || !bankName || accountNumber.length !== 10} onClick={async () => {
                      const bankCode = FLUTTERWAVE_BANK_CODES[bankName];
                      if (!bankCode) {
                        toast({ title: 'Bank verification unavailable', description: 'This bank is not currently configured for verification.', variant: 'destructive' });
                        return;
                      }
                      setVerifyingBank(true);
                      try {
                        const { data, error } = await supabase.functions.invoke('payroll-payment', {
                          body: { action: 'resolve_account', account_number: accountNumber, account_bank: bankCode },
                        });
                        if (error || data?.error || !data?.account?.account_name) throw error || new Error(data?.error || 'Account verification failed.');
                        setBeneficiaryName(data.account.account_name);
                        toast({ title: 'Account verified', description: `Beneficiary: ${data.account.account_name}` });
                      } catch (error) {
                        setBeneficiaryName(null);
                        toast({ title: 'Account verification failed', description: error instanceof Error ? error.message : 'Check the bank and account number, then try again.', variant: 'destructive' });
                      } finally {
                        setVerifyingBank(false);
                      }
                    }}>{verifyingBank ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify Account'}</Button>
                  </div>
                  {beneficiaryName && <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Verified beneficiary: <strong>{beneficiaryName}</strong></div>}
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <Card className="border-border/70"><CardHeader className="pb-1 pt-3"><CardTitle className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</CardTitle></CardHeader><CardContent className="break-words pb-3 text-sm font-medium">{value}</CardContent></Card>;
}
