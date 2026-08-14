import React, { useRef, useState } from 'react';
import { Loader2, Beaker } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { createLabRequestFromTyped } from '@/integrations/supabase/rpcs';

interface TypedLabRequestEditorProps {
  patientId: string;
  visitId: string | null;
  onSuccess?: (labRequestId: string) => void;
  onCancel?: () => void;
}

export function TypedLabRequestEditor({
  patientId,
  visitId,
  onSuccess,
  onCancel
}: TypedLabRequestEditorProps) {
  const [text, setText] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const submitLockRef = useRef(false);

  const handleSubmit = async () => {
    if (submitLockRef.current || loading || submitted) return;
    if (!text.trim()) {
      return toast.error('Lab order details are required');
    }

    submitLockRef.current = true;
    setLoading(true);
    try {
      const id = await createLabRequestFromTyped({
        patientId,
        visitId,
        diagnosis: diagnosis.trim() || undefined,
        tests: [text.trim()] // Store the whole block as one "test" item
      });
      setSubmitted(true);
      toast.success('Lab request created — patient moved to Billing');
      onSuccess?.(id);
    } catch (err: any) {
      submitLockRef.current = false;
      setSubmitted(false);
      toast.error(err.message || 'Failed to create lab request');
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
            placeholder="Reason for tests..." 
            value={diagnosis} 
            onChange={e => setDiagnosis(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-base font-semibold">Requested Tests</Label>
          <Textarea 
            placeholder="Type all requested tests here..." 
            value={text}
            onChange={e => setText(e.target.value)}
            rows={8}
            className="min-h-[200px]"
          />
          <p className="text-xs text-muted-foreground">
            List all tests in plain text.
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-3 border-t pt-4">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
        )}
        <Button onClick={handleSubmit} disabled={loading || submitted} className="min-w-[120px]">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Beaker className="h-4 w-4 mr-2" />}
          {submitted ? 'Lab Order Sent' : 'Submit Lab Order'}
        </Button>
      </div>
    </div>
  );
}
