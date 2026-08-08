import React, { useState } from 'react';
import { Loader2, FileText, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { finalizeReferral } from '@/integrations/supabase/rpcs';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ReferralEditorDialogProps {
  patientId: string;
  visitId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (referralId: string) => void;
}

export function ReferralEditorDialog({
  patientId,
  visitId,
  open,
  onOpenChange,
  onSuccess
}: ReferralEditorDialogProps) {
  const { user } = useAuth();
  const [destination, setDestination] = useState('');
  const [specialist, setSpecialist] = useState('');
  const [reason, setReason] = useState('');
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  const handleSaveDraft = async () => {
    if (!destination.trim()) return toast.error('Destination is required');
    
    setLoading(true);
    try {
      const { data, error } = await (supabase.from('referral_letters' as any) as any)
        .insert({
          patient_id: patientId,
          visit_id: visitId,
          destination: destination.trim(),
          specialist: specialist.trim() || null,
          reason: reason.trim() || null,
          clinical_notes: clinicalNotes.trim() || null,
          typed_body: body.trim() || null,
          input_method: 'typed',
          status: 'draft',
          created_by: user?.id
        })
        .select()
        .single();

      if (error) throw error;
      toast.success('Referral draft saved');
      onSuccess?.((data as any).id);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save referral');
    } finally {
      setLoading(false);
    }
  };

  const handleFinalize = async () => {
    if (!destination.trim()) return toast.error('Destination is required');
    
    setFinalizing(true);
    try {
      // 1. Save draft first to get ID
      const { data: draft, error: draftError } = await (supabase.from('referral_letters' as any) as any)
        .insert({
          patient_id: patientId,
          visit_id: visitId,
          destination: destination.trim(),
          specialist: specialist.trim() || null,
          reason: reason.trim() || null,
          clinical_notes: clinicalNotes.trim() || null,
          typed_body: body.trim() || null,
          input_method: 'typed',
          status: 'draft',
          created_by: user?.id
        })
        .select()
        .single();

      if (draftError) throw draftError;

      // 2. Finalize
      const result = await finalizeReferral((draft as any).id);
      toast.success(`Referral finalized: ${result.ref_number}`);
      onSuccess?.((draft as any).id);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to finalize referral');
    } finally {
      setFinalizing(false);
    }
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            New Referral Letter
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Destination Hospital / Clinic*</Label>
              <Input 
                placeholder="e.g. Teaching Hospital A" 
                value={destination}
                onChange={e => setDestination(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Specialist Name (Optional)</Label>
              <Input 
                placeholder="e.g. Dr. Jane Smith" 
                value={specialist}
                onChange={e => setSpecialist(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Reason for Referral</Label>
            <Input 
              placeholder="e.g. Further management of chronic condition" 
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Clinical Summary / Notes</Label>
            <Textarea 
              placeholder="Vitals, history, current treatment..." 
              value={clinicalNotes}
              onChange={e => setClinicalNotes(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-2 border-t pt-4">
            <Label className="text-base font-semibold">Referral Letter Body</Label>
            <Textarea 
              placeholder="Type the full letter content here..." 
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={8}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t pt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading || finalizing}>
            Cancel
          </Button>
          <Button 
            variant="outline" 
            onClick={handleSaveDraft} 
            disabled={loading || finalizing}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save as Draft
          </Button>
          <Button 
            onClick={handleFinalize} 
            disabled={loading || finalizing}
          >
            {finalizing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            Finalize & Issue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
