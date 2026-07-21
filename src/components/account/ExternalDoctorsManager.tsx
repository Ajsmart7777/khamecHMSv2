import { useState } from 'react';
import { useExternalDoctors, ExternalDoctor } from '@/hooks/useExternalDoctors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, Stethoscope, Loader2 } from 'lucide-react';

const empty = { name: '', phone: '', specialty: '', schedule_notes: '', status: 'active' };

export function ExternalDoctorsManager() {
  const { doctors, loading, createDoctor, updateDoctor, deleteDoctor } = useExternalDoctors();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ExternalDoctor | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  const openNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (d: ExternalDoctor) => {
    setEditing(d);
    setForm({ name: d.name, phone: d.phone || '', specialty: d.specialty || '', schedule_notes: d.schedule_notes || '', status: d.status });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    if (editing) {
      await updateDoctor(editing.id, form);
    } else {
      await createDoctor(form);
    }
    setSaving(false);
    setOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Stethoscope className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">External Doctors</h3>
          <Badge variant="outline">{doctors.length}</Badge>
        </div>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1.5" /> Add doctor</Button>
      </div>

      {loading ? (
        <div className="text-center py-8"><Loader2 className="h-5 w-5 mx-auto animate-spin" /></div>
      ) : doctors.length === 0 ? (
        <div className="text-center py-10 border rounded-lg text-muted-foreground text-sm">
          No external doctors yet. Add prescribers who write standing orders outside the hospital.
        </div>
      ) : (
        <div className="grid gap-2">
          {doctors.map(d => (
            <div key={d.id} className="border rounded-lg p-3 flex items-start justify-between gap-3 bg-card">
              <div className="min-w-0">
                <p className="font-medium">{d.name}
                  {d.status !== 'active' && <Badge variant="outline" className="ml-2 text-xs">{d.status}</Badge>}
                </p>
                <p className="text-sm text-muted-foreground">
                  {d.specialty || 'General'}{d.phone ? ` · ${d.phone}` : ''}
                </p>
                {d.schedule_notes && <p className="text-xs text-muted-foreground mt-1">{d.schedule_notes}</p>}
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => openEdit(d)}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => deleteDoctor(d.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Edit doctor' : 'Add external doctor'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div><Label>Specialty</Label><Input value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} /></div>
            </div>
            <div><Label>Schedule / notes</Label><Textarea rows={3} value={form.schedule_notes} onChange={(e) => setForm({ ...form, schedule_notes: e.target.value })} /></div>
            <div>
              <Label>Status</Label>
              <select className="w-full h-10 rounded-md border bg-background px-3 text-sm" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.name.trim()}>{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}