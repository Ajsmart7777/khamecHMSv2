import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { 
  Plus, Shield, Building2, Edit, Trash2, Search
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useInsurance, InsuranceProvider } from '@/hooks/useInsurance';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MemberIdFieldsEditor } from '@/components/insurance/MemberIdFieldsEditor';
import { normaliseFields, type ProviderField } from '@/lib/providerFields';

export function InsuranceManager() {
  const { providers, claims, loading, addProvider, updateProvider, deleteProvider, updateClaim, getProviderById } = useInsurance();
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', type: 'hmo', code: '', hmo_code: '', contact_person: '', email: '', phone: '',
    address: '', notes: '',
  });
  const [memberFields, setMemberFields] = useState<ProviderField[]>([]);
  const [editId, setEditId] = useState<string | null>(null);

  const filtered = searchQuery
    ? providers.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.type.includes(searchQuery.toLowerCase()))
    : providers;

  const resetForm = () => {
    setForm({ name: '', type: 'hmo', code: '', hmo_code: '', contact_person: '', email: '', phone: '', address: '', notes: '' });
    setMemberFields([]);
  };

  const handleAdd = async () => {
    if (!form.name) { toast.error('Provider name is required'); return; }
    const ok = await addProvider({
      name: form.name, type: form.type, code: form.code || null,
      hmo_code: form.hmo_code || null,
      contact_person: form.contact_person || null, email: form.email || null,
      phone: form.phone || null, address: form.address || null,
      notes: form.notes || null,
      member_id_fields: memberFields,
    } as any);
    if (ok) { toast.success('Provider added'); setIsAddOpen(false); resetForm(); }
  };

  const handleEdit = (p: InsuranceProvider) => {
    setEditId(p.id);
    setForm({
      name: p.name, type: p.type, code: p.code || '', hmo_code: p.hmo_code || '', contact_person: p.contact_person || '',
      email: p.email || '', phone: p.phone || '', address: p.address || '',
      notes: p.notes || '',
    });
    setMemberFields(normaliseFields(p.member_id_fields));
    setIsEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editId) return;
    const ok = await updateProvider(editId, {
      name: form.name, type: form.type, code: form.code || null,
      hmo_code: form.hmo_code || null,
      contact_person: form.contact_person || null, email: form.email || null,
      phone: form.phone || null, notes: form.notes || null,
      member_id_fields: memberFields,
    } as any);
    if (ok) { toast.success('Provider updated'); setIsEditOpen(false); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const ok = await deleteProvider(deleteId);
    if (ok) { toast.success('Provider deleted'); setDeleteId(null); }
  };

  const handleClaimAction = async (claimId: string, action: 'approved' | 'rejected' | 'paid', reason?: string) => {
    const updates: any = { status: action };
    if (action === 'approved') updates.approved_at = new Date().toISOString();
    if (action === 'paid') updates.paid_at = new Date().toISOString();
    if (action === 'rejected' && reason) updates.rejection_reason = reason;
    const ok = await updateClaim(claimId, updates);
    if (ok) toast.success(`Claim ${action}`);
  };

  const typeVariant = (type: string): "default" | "secondary" | "destructive" | "outline" => {
    if (type === 'nhis') return 'default';
    if (type === 'hmo') return 'secondary';
    return 'outline';
  };

  return (
    <Tabs defaultValue="providers" className="w-full">
      <TabsList className="mb-4">
        <TabsTrigger value="providers">Providers & NHIS</TabsTrigger>
        <TabsTrigger value="claims">
          Claims
          {claims.filter(c => c.status === 'submitted').length > 0 && (
            <Badge variant="warning" className="ml-1 h-5 px-1.5 text-xs">
              {claims.filter(c => c.status === 'submitted').length}
            </Badge>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="providers">
        <div className="bg-card rounded-xl border border-border">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Insurance & NHIS Providers
            </h3>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search..." className="pl-10 w-48" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              </div>
              <Button size="sm" onClick={() => { resetForm(); setIsAddOpen(true); }} className="press-effect">
                <Plus className="h-4 w-4 mr-1" /> Add Provider
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Code</th>
                  <th>Member ID fields</th>
                  <th>Contact</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No providers found</td></tr>
                ) : (
                  filtered.map(p => (
                    <tr key={p.id}>
                      <td className="font-medium">{p.name}</td>
                      <td><Badge variant={typeVariant(p.type)}>{p.type.toUpperCase()}</Badge></td>
                      <td className="font-mono text-sm">{p.code || '—'}</td>
                      <td className="text-sm text-muted-foreground">
                        {normaliseFields(p.member_id_fields).map(f => f.label).join(', ') || '—'}
                      </td>
                      <td className="text-sm text-muted-foreground">{p.contact_person || '—'}</td>
                      <td><Badge variant={p.status === 'active' ? 'success' : 'secondary'}>{p.status}</Badge></td>
                      <td>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => handleEdit(p)}><Edit className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="sm" onClick={() => setDeleteId(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="claims">
        <div className="bg-card rounded-xl border border-border">
          <div className="p-4 border-b border-border">
            <h3 className="font-semibold flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Insurance Claims
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Claim #</th>
                  <th>Provider</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Covered</th>
                  <th className="text-right">Co-pay</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {claims.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">No claims yet</td></tr>
                ) : (
                  claims.map(c => {
                    const provider = getProviderById(c.provider_id);
                    return (
                      <tr key={c.id}>
                        <td className="font-mono text-sm">{c.claim_number}</td>
                        <td>{provider?.name || '—'}</td>
                        <td className="text-right">₦{c.total_amount.toLocaleString()}</td>
                        <td className="text-right">₦{c.covered_amount.toLocaleString()}</td>
                        <td className="text-right">₦{c.patient_copay.toLocaleString()}</td>
                        <td>
                          <Badge variant={
                            c.status === 'paid' ? 'success' :
                            c.status === 'approved' ? 'default' :
                            c.status === 'rejected' ? 'destructive' : 'warning'
                          }>{c.status}</Badge>
                        </td>
                        <td className="text-sm">{new Date(c.submitted_at).toLocaleDateString()}</td>
                        <td>
                          {c.status === 'submitted' && (
                            <div className="flex gap-1">
                              <Button size="sm" variant="success" onClick={() => handleClaimAction(c.id, 'approved')}>Approve</Button>
                              <Button size="sm" variant="outline" onClick={() => handleClaimAction(c.id, 'rejected', 'Not covered')}>Reject</Button>
                            </div>
                          )}
                          {c.status === 'approved' && (
                            <Button size="sm" variant="default" onClick={() => handleClaimAction(c.id, 'paid')}>Mark Paid</Button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </TabsContent>

      {/* Add/Edit Dialog */}
      <Dialog open={isAddOpen || isEditOpen} onOpenChange={(open) => { if (!open) { setIsAddOpen(false); setIsEditOpen(false); } }}>
        <DialogContent className="animate-scale-in max-w-lg">
          <DialogHeader>
            <DialogTitle>{isEditOpen ? 'Edit Provider' : 'Add Insurance Provider'}</DialogTitle>
            <DialogDescription>
              {isEditOpen ? 'Update provider details' : 'Register a new insurance provider or NHIS scheme'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Provider Name *</label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. NHIS Federal" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Type</label>
                <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nhis">NHIA</SelectItem>
                    <SelectItem value="katchma">KATCHMA</SelectItem>
                    <SelectItem value="hmo">HMO</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Provider Code</label>
                <Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="e.g. NHIS-001" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Contact Person</label>
                <Input value={form.contact_person} onChange={e => setForm({ ...form, contact_person: e.target.value })} />
              </div>
            </div>
            {form.type === 'hmo' && (
              <div className="space-y-2">
                <label className="text-sm font-medium">HMO scheme (drives Claims workspace label)</label>
                <Select value={form.hmo_code || 'generic'} onValueChange={v => setForm({ ...form, hmo_code: v === 'generic' ? '' : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="generic">Generic HMO (default)</SelectItem>
                    <SelectItem value="hygeia">Hygeia HMO</SelectItem>
                    <SelectItem value="axa_mansard">AXA Mansard</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Hygeia → "Pre-Auth / Token Number". AXA Mansard → "Encounter Code / OTP".
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Email</label>
                <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Phone</label>
                <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Notes</label>
              <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Additional notes..." rows={2} />
            </div>
            <div className="border-t pt-4">
              <MemberIdFieldsEditor value={memberFields} onChange={setMemberFields} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsAddOpen(false); setIsEditOpen(false); }}>Cancel</Button>
            <Button onClick={isEditOpen ? handleSaveEdit : handleAdd} className="press-effect">
              {isEditOpen ? 'Save Changes' : 'Add Provider'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Provider?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove this insurance provider. Claims linked to this provider won't be deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
  );
}
