import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Building2, Plus, Search, Edit3, Trash2, Users, Loader2, Eye, Wallet, RefreshCw,
  Phone, Mail, MapPin, AlertCircle, FileText
} from 'lucide-react';
import { useCorporateAccounts, CorporateAccount, SponsorAccountType } from '@/hooks/useCorporateAccounts';
import { toast } from '@/hooks/use-toast';

interface LinkedPatient {
  id: string;
  first_name: string;
  last_name: string;
  card_number: string;
  phone: string;
  balance: number;
  status: string;
}

interface CorporateTransaction {
  id: string;
  invoice_number: string;
  total_amount: number;
  paid_amount: number;
  status: string;
  payment_method: string | null;
  created_at: string;
  patient_name: string;
}

export function CorporateAccountsManager({ accountType = 'corporate' }: { accountType?: SponsorAccountType } = {}) {
  const isRetainer = accountType === 'retainer';
  const singular = isRetainer ? 'Retainer' : 'Corporate';
  const singularLower = isRetainer ? 'retainer' : 'corporate';
  const entityLabel = isRetainer ? 'Retainer' : 'Company';
  const { accounts, loading, createAccount, updateAccount, deleteAccount, topUpBalance, getLinkedPatients, getCorporateTransactions, refetch } = useCorporateAccounts(accountType);
  const [searchTerm, setSearchTerm] = useState('');
  const [addDialog, setAddDialog] = useState(false);
  const [editAccount, setEditAccount] = useState<CorporateAccount | null>(null);
  const [viewAccount, setViewAccount] = useState<CorporateAccount | null>(null);
  const [linkedPatients, setLinkedPatients] = useState<LinkedPatient[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [transactions, setTransactions] = useState<CorporateTransaction[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [topUpDialog, setTopUpDialog] = useState<CorporateAccount | null>(null);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [form, setForm] = useState({
    company_name: '',
    contact_person: '',
    email: '',
    phone: '',
    address: '',
    treatment_limit: 0,
    balance: 0,
    discount_percentage: 0,
    status: 'active',
    notes: '',
  });

  const filtered = accounts.filter(a =>
    a.company_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    a.contact_person.toLowerCase().includes(searchTerm.toLowerCase()) ||
    a.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);
  const activeCount = accounts.filter(a => a.status === 'active').length;
  const totalPatients = accounts.reduce((s, a) => s + (a.linked_patients_count || 0), 0);

  const resetForm = () => {
    setForm({
      company_name: '', contact_person: '', email: '', phone: '',
      address: '', treatment_limit: 0, balance: 0, discount_percentage: 0,
      status: 'active', notes: '',
    });
  };

  const openEdit = (account: CorporateAccount) => {
    setEditAccount(account);
    setForm({
      company_name: account.company_name,
      contact_person: account.contact_person,
      email: account.email,
      phone: account.phone,
      address: account.address,
      treatment_limit: account.treatment_limit,
      balance: account.balance,
      discount_percentage: account.discount_percentage,
      status: account.status,
      notes: account.notes || '',
    });
  };

  const openView = async (account: CorporateAccount) => {
    setViewAccount(account);
    setLoadingPatients(true);
    setLoadingTransactions(true);
    const patients = await getLinkedPatients(account.id);
    setLinkedPatients(patients as LinkedPatient[]);
    setLoadingPatients(false);
    const txns = await getCorporateTransactions(account.id);
    setTransactions(txns as CorporateTransaction[]);
    setLoadingTransactions(false);
  };

  const handleSave = async () => {
    if (!form.company_name || !form.contact_person || !form.email || !form.phone) {
      toast({ title: 'Error', description: 'Please fill all required fields.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const payload = { ...form, notes: form.notes || null, account_type: accountType } as any;
    if (editAccount) {
      await updateAccount(editAccount.id, payload);
      setEditAccount(null);
    } else {
      await createAccount(payload);
      setAddDialog(false);
    }
    resetForm();
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    await deleteAccount(deleteConfirm);
    setDeleteConfirm(null);
  };

  const handleTopUp = async () => {
    if (!topUpDialog || !topUpAmount) return;
    const amount = Number(topUpAmount);
    if (amount <= 0) {
      toast({ title: 'Error', description: 'Enter a valid amount.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    await topUpBalance(topUpDialog.id, amount);
    setTopUpDialog(null);
    setTopUpAmount('');
    setSaving(false);
  };

  const formFields = (
    <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">{entityLabel} Name *</label>
          <Input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} placeholder={isRetainer ? 'e.g. Dr. Musa Referral Clinic' : 'e.g. Dangote Industries'} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Contact Person *</label>
          <Input value={form.contact_person} onChange={e => setForm(f => ({ ...f, contact_person: e.target.value }))} placeholder={isRetainer ? 'Retainer contact' : 'HR Manager name'} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Email *</label>
          <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="contact@example.com" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Phone *</label>
          <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="080XXXXXXXX" />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Address</label>
        <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Address" />
      </div>
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground bg-muted/30">
        Post-paid arrangement — no wallet, no treatment limit, no discount. Every invoice raised for a linked patient is billed to this {singularLower} and consolidated into a monthly statement.
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Status</label>
          <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Notes</label>
        <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Additional notes..." rows={2} />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Building2 className="h-4 w-4 text-primary" />
            <p className="text-sm text-muted-foreground">Total Companies</p>
          </div>
          <p className="text-2xl font-bold">{accounts.length}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle className="h-4 w-4 text-success" />
            <p className="text-sm text-muted-foreground">Active</p>
          </div>
          <p className="text-2xl font-bold text-success">{activeCount}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Users className="h-4 w-4 text-primary" />
            <p className="text-sm text-muted-foreground">Total Linked Patients</p>
          </div>
          <p className="text-2xl font-bold">{totalPatients}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="h-4 w-4 text-primary" />
            <p className="text-sm text-muted-foreground">Total Balance</p>
          </div>
          <p className="text-2xl font-bold">₦{totalBalance.toLocaleString()}</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search companies..."
            className="pl-10"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refetch}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={() => { resetForm(); setAddDialog(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Add Company
          </Button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company Name</TableHead>
                  <TableHead>Contact Person</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Patients</TableHead>
                  <TableHead>Treatment Limit</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead>Discount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(account => (
                  <TableRow key={account.id}>
                    <TableCell className="font-medium">{account.company_name}</TableCell>
                    <TableCell className="text-sm">{account.contact_person}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{account.email}</TableCell>
                    <TableCell className="text-sm">{account.phone}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{account.linked_patients_count || 0}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">₦{account.treatment_limit.toLocaleString()}</TableCell>
                    <TableCell className={`font-mono text-sm font-medium ${account.balance > 0 ? 'text-success' : 'text-destructive'}`}>
                      ₦{account.balance.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm">{account.discount_percentage}%</TableCell>
                    <TableCell>
                      <Badge variant={account.status === 'active' ? 'success' : 'destructive'} className="text-xs">
                        {account.status.charAt(0).toUpperCase() + account.status.slice(1)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="View" onClick={() => openView(account)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Top Up" onClick={() => { setTopUpDialog(account); setTopUpAmount(''); }}>
                          <Wallet className="h-3.5 w-3.5 text-success" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" onClick={() => openEdit(account)}>
                          <Edit3 className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete" onClick={() => setDeleteConfirm(account.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                      {accounts.length === 0 ? 'No corporate accounts yet. Click "Add Company" to create one.' : 'No results found.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Add Dialog */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" /> Add Corporate Account
            </DialogTitle>
            <DialogDescription>Register a new company for corporate healthcare.</DialogDescription>
          </DialogHeader>
          {formFields}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialog(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editAccount} onOpenChange={open => !open && setEditAccount(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit3 className="h-5 w-5 text-primary" /> Edit Corporate Account
            </DialogTitle>
          </DialogHeader>
          {formFields}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditAccount(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Dialog - Company Details with linked patients */}
      <Dialog open={!!viewAccount} onOpenChange={open => !open && setViewAccount(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" /> {viewAccount?.company_name}
            </DialogTitle>
            <DialogDescription>Company details and linked patients</DialogDescription>
          </DialogHeader>
          {viewAccount && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2"><Users className="h-4 w-4 text-muted-foreground" /> {viewAccount.contact_person}</div>
                <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" /> {viewAccount.email}</div>
                <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" /> {viewAccount.phone}</div>
                <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" /> {viewAccount.address || 'N/A'}</div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">Treatment Limit</p>
                  <p className="font-bold">₦{viewAccount.treatment_limit.toLocaleString()}</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">Balance</p>
                  <p className={`font-bold ${viewAccount.balance > 0 ? 'text-success' : 'text-destructive'}`}>₦{viewAccount.balance.toLocaleString()}</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">Discount</p>
                  <p className="font-bold">{viewAccount.discount_percentage}%</p>
                </div>
              </div>

              <Tabs defaultValue="patients" className="w-full">
                <TabsList className="w-full">
                  <TabsTrigger value="patients" className="flex-1">
                    <Users className="h-3.5 w-3.5 mr-1" /> Patients ({linkedPatients.length})
                  </TabsTrigger>
                  <TabsTrigger value="transactions" className="flex-1">
                    <FileText className="h-3.5 w-3.5 mr-1" /> Transactions ({transactions.length})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="patients">
                  {loadingPatients ? (
                    <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                  ) : linkedPatients.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      No patients linked yet. Register patients with "Corporate" account type and select this company.
                    </p>
                  ) : (
                    <div className="border border-border rounded-lg overflow-hidden max-h-[250px] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Card #</TableHead>
                            <TableHead className="text-xs">Name</TableHead>
                            <TableHead className="text-xs">Phone</TableHead>
                            <TableHead className="text-xs">Balance</TableHead>
                            <TableHead className="text-xs">Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {linkedPatients.map(p => (
                            <TableRow key={p.id}>
                              <TableCell className="font-mono text-xs">{p.card_number}</TableCell>
                              <TableCell className="text-sm">{p.first_name} {p.last_name}</TableCell>
                              <TableCell className="text-sm">{p.phone}</TableCell>
                              <TableCell className="font-mono text-sm">₦{p.balance.toLocaleString()}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs">{p.status}</Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="transactions">
                  {loadingTransactions ? (
                    <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                  ) : transactions.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      No transactions yet for this corporate account.
                    </p>
                  ) : (
                    <div className="border border-border rounded-lg overflow-hidden max-h-[250px] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Invoice #</TableHead>
                            <TableHead className="text-xs">Patient</TableHead>
                            <TableHead className="text-xs">Amount</TableHead>
                            <TableHead className="text-xs">Status</TableHead>
                            <TableHead className="text-xs">Date</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {transactions.map(t => (
                            <TableRow key={t.id}>
                              <TableCell className="font-mono text-xs">{t.invoice_number}</TableCell>
                              <TableCell className="text-sm">{t.patient_name}</TableCell>
                              <TableCell className="font-mono text-sm">₦{t.total_amount.toLocaleString()}</TableCell>
                              <TableCell>
                                <Badge 
                                  variant={t.status === 'paid' ? 'success' : t.status === 'partial' ? 'warning' : 'outline'} 
                                  className="text-xs"
                                >
                                  {t.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {new Date(t.created_at).toLocaleDateString()}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewAccount(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Top Up Dialog */}
      <Dialog open={!!topUpDialog} onOpenChange={open => !open && setTopUpDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-success" /> Top Up Balance
            </DialogTitle>
            <DialogDescription>{topUpDialog?.company_name} — Current: ₦{topUpDialog?.balance.toLocaleString()}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <label className="text-sm font-medium">Amount (₦)</label>
            <Input type="number" value={topUpAmount} onChange={e => setTopUpAmount(e.target.value)} placeholder="Enter amount" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTopUpDialog(null)}>Cancel</Button>
            <Button onClick={handleTopUp} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Top Up
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={open => !open && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete Corporate Account?</DialogTitle>
            <DialogDescription>This action cannot be undone. All linked patients will need to be reassigned.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
