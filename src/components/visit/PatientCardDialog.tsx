import { useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { BookOpen } from 'lucide-react';
import { PatientLedgerCard } from './PatientLedgerCard';
import { Patient } from '@/contexts/PatientContext';

export function PatientCardDialog({
  patient, open, onOpenChange,
}: {
  patient: Patient;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto p-0 bg-slate-50 border-none">
        <PatientLedgerCard patient={patient} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Compact trigger button — use anywhere a patient row/card is shown. */
export function ViewCardButton({
  patient, size = 'sm', label = 'View Card', variant = 'outline',
}: {
  patient: Patient;
  size?: 'sm' | 'default' | 'lg' | 'icon';
  label?: string;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={variant} size={size}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="gap-1.5"
      >
        <BookOpen className="h-3.5 w-3.5" />
        {label}
      </Button>
      <PatientCardDialog patient={patient} open={open} onOpenChange={setOpen} />
    </>
  );
}
