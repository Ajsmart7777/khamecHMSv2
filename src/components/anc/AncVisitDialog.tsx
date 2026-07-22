import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAnc, AncProgram, calculateWeeks } from '@/hooks/useAnc';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  program: AncProgram;
}

export function AncVisitDialog({ open, onOpenChange, program }: Props) {
  const { addVisit } = useAnc();
  const [saving, setSaving] = useState(false);
  const defaultWeek = program.lmp ? String(calculateWeeks(program.lmp)) : '';
  const [f, setF] = useState({
    visit_date: new Date().toISOString().slice(0, 10),
    week_of_pregnancy: defaultWeek,
    weight: '', blood_pressure: '', urine: '', hb: '', oedema: '',
    fundal_height: '', presentation: '', fetal_heart_rate: '',
    comment: '', next_visit: '',
  });
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  const submit = async () => {
    setSaving(true);
    const ok = await addVisit(program.id, {
      visit_date: f.visit_date,
      week_of_pregnancy: f.week_of_pregnancy ? parseInt(f.week_of_pregnancy) : null,
      weight: f.weight ? parseFloat(f.weight) : null,
      blood_pressure: f.blood_pressure || null,
      urine: f.urine || null,
      hb: f.hb || null,
      oedema: f.oedema || null,
      fundal_height: f.fundal_height || null,
      presentation: f.presentation || null,
      fetal_heart_rate: f.fetal_heart_rate || null,
      comment: f.comment || null,
      next_visit: f.next_visit || null,
    } as any);
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add ANC Visit · {program.anc_number}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <div><Label>Date</Label><Input type="date" value={f.visit_date} onChange={e => set('visit_date', e.target.value)} /></div>
          <div><Label>Week of Preg</Label><Input value={f.week_of_pregnancy} onChange={e => set('week_of_pregnancy', e.target.value)} /></div>
          <div><Label>Weight (kg)</Label><Input value={f.weight} onChange={e => set('weight', e.target.value)} /></div>
          <div><Label>BP</Label><Input placeholder="120/80" value={f.blood_pressure} onChange={e => set('blood_pressure', e.target.value)} /></div>
          <div><Label>Urine</Label><Input value={f.urine} onChange={e => set('urine', e.target.value)} /></div>
          <div><Label>HB</Label><Input value={f.hb} onChange={e => set('hb', e.target.value)} /></div>
          <div><Label>Oedema</Label><Input value={f.oedema} onChange={e => set('oedema', e.target.value)} /></div>
          <div><Label>Height of Fundus</Label><Input value={f.fundal_height} onChange={e => set('fundal_height', e.target.value)} /></div>
          <div><Label>Presentation & Position</Label><Input value={f.presentation} onChange={e => set('presentation', e.target.value)} /></div>
          <div><Label>Fetal Heart Rate</Label><Input value={f.fetal_heart_rate} onChange={e => set('fetal_heart_rate', e.target.value)} /></div>
          <div><Label>Next Visit</Label><Input type="date" value={f.next_visit} onChange={e => set('next_visit', e.target.value)} /></div>
          <div className="col-span-3"><Label>Comment</Label><Textarea rows={2} value={f.comment} onChange={e => set('comment', e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save Visit'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
