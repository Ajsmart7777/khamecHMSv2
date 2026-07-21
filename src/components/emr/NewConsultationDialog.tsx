import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ConsultationNote } from '@/hooks/useConsultationNotes';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  patientId: string;
  onSubmit: (
    payload: Omit<ConsultationNote, 'id' | 'created_at' | 'updated_at' | 'doctor_id'>,
  ) => Promise<ConsultationNote | null>;
}

export function NewConsultationDialog({ open, onOpenChange, patientId, onSubmit }: Props) {
  const [subjective, setSubjective] = useState('');
  const [objective, setObjective] = useState('');
  const [assessment, setAssessment] = useState('');
  const [plan, setPlan] = useState('');
  const [icd, setIcd] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setSubjective(''); setObjective(''); setAssessment(''); setPlan(''); setIcd(''); setFollowUp('');
  };

  const handleSave = async () => {
    if (!assessment.trim() && !subjective.trim()) return;
    setSaving(true);
    const res = await onSubmit({
      patient_id: patientId,
      visit_date: new Date().toISOString(),
      subjective: subjective || null,
      objective: objective || null,
      assessment: assessment || null,
      plan: plan || null,
      icd10_code: icd || null,
      follow_up_date: followUp || null,
      prescription_id: null,
    });
    setSaving(false);
    if (res) {
      reset();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Consultation Note</DialogTitle>
          <DialogDescription>Record a structured SOAP entry for this visit.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
          <div className="space-y-1.5">
            <Label>Subjective</Label>
            <Textarea rows={4} value={subjective} onChange={(e) => setSubjective(e.target.value)} placeholder="Patient-reported symptoms, history..." />
          </div>
          <div className="space-y-1.5">
            <Label>Objective</Label>
            <Textarea rows={4} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Exam findings, measurements..." />
          </div>
          <div className="space-y-1.5">
            <Label>Assessment</Label>
            <Textarea rows={4} value={assessment} onChange={(e) => setAssessment(e.target.value)} placeholder="Diagnosis, clinical impression..." />
          </div>
          <div className="space-y-1.5">
            <Label>Plan</Label>
            <Textarea rows={4} value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="Treatment plan, referrals, follow-up..." />
          </div>
          <div className="space-y-1.5">
            <Label>ICD-10 Code (optional)</Label>
            <Input value={icd} onChange={(e) => setIcd(e.target.value)} placeholder="e.g. J06.9" />
          </div>
          <div className="space-y-1.5">
            <Label>Follow-up date (optional)</Label>
            <Input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || (!assessment.trim() && !subjective.trim())}>
            {saving ? 'Saving...' : 'Save consultation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
