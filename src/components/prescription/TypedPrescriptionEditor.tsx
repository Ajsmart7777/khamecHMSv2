import React, { useState } from 'react';
import { Loader2, Pill } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { createPrescriptionFromTyped } from '@/integrations/supabase/rpcs';

interface TypedPrescriptionEditorProps {
  patientId: string;
  visitId: string | null;
  onSuccess?: (prescriptionId: string) => void;
  onCancel?: () => void;
}

export function TypedPrescriptionEditor({
  patientId,
  visitId,
  onSuccess,
  onCancel
}: TypedPrescriptionEditorProps) {
  const [text, setText] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!text.trim()) {
      return toast.error('Prescription text is required');
    }

    setLoading(true);
    try {
      // Use the generic notes field to store the plain text prescription
      // Since createPrescriptionFromTyped expects items, we provide a dummy item
      // but store the real text in the notes.
      const id = await createPrescriptionFromTyped({
        patientId,
        visitId,
        diagnosis,
        notes: text.trim(),
        items: [{
          medication: 'Typed Prescription (See Notes)',
          dosage: '-',
          frequency: '-',
          duration: '-',
          quantity: 1
        }]
      });
      toast.success('Prescription created');
      onSuccess?.(id);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create prescription');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Diagnosis (Optional)</Label>
          <Input 
            placeholder="Enter diagnosis..." 
            value={diagnosis} 
            onChange={e => setDiagnosis(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-base font-semibold">Prescription Details</Label>
          <Textarea 
            placeholder="Type medications, dosage, frequency etc. here..." 
            value={text}
            onChange={e => setText(e.target.value)}
            rows={8}
            className="min-h-[200px]"
          />
          <p className="text-xs text-muted-foreground">
            Enter the full prescription details in plain text.
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-3 border-t pt-4">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
        )}
        <Button onClick={handleSubmit} disabled={loading} className="min-w-[120px]">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Pill className="h-4 w-4 mr-2" />}
          Submit Prescription
        </Button>
      </div>
    </div>
  );
}
