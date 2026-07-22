import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAnc, AncProgram } from '@/hooks/useAnc';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  program: AncProgram;
}

export function AncDeliveryDialog({ open, onOpenChange, program }: Props) {
  const { completeProgram } = useAnc();
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    delivery_date: new Date().toISOString().slice(0, 10),
    mode: 'normal',
    outcome: 'live_birth',
    complications: '',
    baby_weight: '',
    baby_sex: 'male',
    mother_status: 'stable',
    baby_status: 'stable',
    notes: '',
  });
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));

  const submit = async () => {
    setSaving(true);
    const ok = await completeProgram(program.id, f);
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Complete Delivery · {program.anc_number}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Delivery Date</Label><Input type="date" value={f.delivery_date} onChange={e => set('delivery_date', e.target.value)} /></div>
          <div>
            <Label>Mode</Label>
            <Select value={f.mode} onValueChange={v => set('mode', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="caesarean">Caesarean Section</SelectItem>
                <SelectItem value="vacuum">Vacuum</SelectItem>
                <SelectItem value="forceps">Forceps</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Outcome</Label>
            <Select value={f.outcome} onValueChange={v => set('outcome', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="live_birth">Live Birth</SelectItem>
                <SelectItem value="still_birth">Still Birth</SelectItem>
                <SelectItem value="twins">Twins</SelectItem>
                <SelectItem value="triplets">Triplets</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Baby Weight (kg)</Label><Input value={f.baby_weight} onChange={e => set('baby_weight', e.target.value)} /></div>
          <div>
            <Label>Sex of Baby</Label>
            <Select value={f.baby_sex} onValueChange={v => set('baby_sex', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Mother Status</Label><Input value={f.mother_status} onChange={e => set('mother_status', e.target.value)} /></div>
          <div><Label>Baby Status</Label><Input value={f.baby_status} onChange={e => set('baby_status', e.target.value)} /></div>
          <div className="col-span-2"><Label>Complications</Label><Textarea rows={2} value={f.complications} onChange={e => set('complications', e.target.value)} /></div>
          <div className="col-span-2"><Label>Notes</Label><Textarea rows={2} value={f.notes} onChange={e => set('notes', e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Complete Delivery'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
