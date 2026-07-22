import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useAnc, calculateEdd } from '@/hooks/useAnc';
import { Patient } from '@/contexts/PatientContext';
import { Baby } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  patient: Patient;
  onEnrolled?: () => void;
}

export function AncEnrollDialog({ open, onOpenChange, patient, onEnrolled }: Props) {
  const { enroll } = useAnc();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    lmp: '', edd: '', gravida: '', para: '',
    height: '', weight: '', religion: '', tribe: '',
    occupation: patient.occupation || '', husband_occupation: '',
    remarks: '', pelvic_assessment: '', special_considerations: '',
    high_risk: false,
  });

  useEffect(() => {
    if (form.lmp) setForm(f => ({ ...f, edd: calculateEdd(f.lmp) }));
  }, [form.lmp]);

  const setF = (k: string, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async () => {
    setSaving(true);
    const result = await enroll(patient.id, {
      lmp: form.lmp || null,
      edd: form.edd || null,
      gravida: form.gravida ? parseInt(form.gravida) : null,
      para: form.para ? parseInt(form.para) : null,
      height: form.height ? parseFloat(form.height) : null,
      weight: form.weight ? parseFloat(form.weight) : null,
      religion: form.religion || null,
      tribe: form.tribe || null,
      occupation: form.occupation || null,
      husband_occupation: form.husband_occupation || null,
      remarks: form.remarks || null,
      pelvic_assessment: form.pelvic_assessment || null,
      special_considerations: form.special_considerations || null,
      high_risk: form.high_risk,
    } as any);
    setSaving(false);
    if (result) {
      onOpenChange(false);
      onEnrolled?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Baby className="h-5 w-5 text-pink-500" /> Enroll into ANC Program
          </DialogTitle>
          <DialogDescription>
            {patient.first_name} {patient.last_name} · {patient.card_number}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div><Label>LMP *</Label><Input type="date" value={form.lmp} onChange={e => setF('lmp', e.target.value)} /></div>
          <div><Label>EDD (auto)</Label><Input type="date" value={form.edd} onChange={e => setF('edd', e.target.value)} /></div>
          <div><Label>Gravida</Label><Input type="number" value={form.gravida} onChange={e => setF('gravida', e.target.value)} /></div>
          <div><Label>Para</Label><Input type="number" value={form.para} onChange={e => setF('para', e.target.value)} /></div>
          <div><Label>Height (cm)</Label><Input type="number" value={form.height} onChange={e => setF('height', e.target.value)} /></div>
          <div><Label>Weight (kg)</Label><Input type="number" value={form.weight} onChange={e => setF('weight', e.target.value)} /></div>
          <div><Label>Religion</Label><Input value={form.religion} onChange={e => setF('religion', e.target.value)} /></div>
          <div><Label>Tribe</Label><Input value={form.tribe} onChange={e => setF('tribe', e.target.value)} /></div>
          <div><Label>Occupation</Label><Input value={form.occupation} onChange={e => setF('occupation', e.target.value)} /></div>
          <div><Label>Husband's Occupation</Label><Input value={form.husband_occupation} onChange={e => setF('husband_occupation', e.target.value)} /></div>
          <div className="col-span-2"><Label>Pelvic Assessment</Label><Textarea rows={2} value={form.pelvic_assessment} onChange={e => setF('pelvic_assessment', e.target.value)} /></div>
          <div className="col-span-2"><Label>Special Considerations</Label><Textarea rows={2} value={form.special_considerations} onChange={e => setF('special_considerations', e.target.value)} /></div>
          <div className="col-span-2"><Label>Remarks</Label><Textarea rows={2} value={form.remarks} onChange={e => setF('remarks', e.target.value)} /></div>
          <div className="col-span-2 flex items-center gap-3 p-3 rounded-md bg-muted">
            <Switch checked={form.high_risk} onCheckedChange={v => setF('high_risk', v)} />
            <Label>Mark as High Risk Pregnancy</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving || !form.lmp}>
            {saving ? 'Enrolling…' : 'Enroll into ANC'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
