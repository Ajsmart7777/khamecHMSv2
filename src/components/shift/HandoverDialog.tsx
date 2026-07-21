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
import { Textarea } from '@/components/ui/textarea';
import { ClipboardCheck } from 'lucide-react';

interface HandoverDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (notes: string) => Promise<boolean>;
}

export function HandoverDialog({ open, onOpenChange, onSubmit }: HandoverDialogProps) {
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!notes.trim()) return;
    setSubmitting(true);
    const success = await onSubmit(notes.trim());
    setSubmitting(false);
    if (success) {
      setNotes('');
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary" />
            Shift Handover
          </DialogTitle>
          <DialogDescription>
            Please provide handover notes before ending your shift. This ensures continuity for the next staff.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Handover Notes *</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Summarize pending tasks, important patient updates, and anything the next shift needs to know..."
              className="min-h-[120px]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!notes.trim() || submitting}>
            <ClipboardCheck className="h-4 w-4 mr-1" />
            {submitting ? 'Submitting...' : 'Complete Handover'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
