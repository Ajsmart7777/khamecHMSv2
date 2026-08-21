import { FlaskConical, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FlaskConical, X } from 'lucide-react';
import { SnapLabResults } from '@/components/doctor/SnapLabResults';

interface PatientLabResultsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  patientName: string;
}

/**
 * Patient-scoped returned laboratory results.
 *
 * The result source is the same snap_orders record written by the Lab station
 * for both typed and photographed returns. Keeping one view prevents typed
 * results from being hidden behind the old generic lab_requests search UI.
 */
export function PatientLabResultsDialog({
  open,
  onOpenChange,
  patientId,
  patientName,
}: PatientLabResultsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <FlaskConical className="h-6 w-6 text-module-laboratory" />
            Lab Results · {patientName}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Returned laboratory results for this patient. Typed reports appear exactly as entered by the laboratory officer.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6">
          <SnapLabResults patientId={patientId} />
        </div>

        <DialogFooter className="p-4 border-t bg-muted/20">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4 mr-2" />
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
