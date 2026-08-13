import { useState } from 'react';
import { FlaskConical, Beaker, FileText, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { SnapLabResults } from '@/components/doctor/SnapLabResults';
import { LabResultsViewer } from '@/components/doctor/LabResultsViewer';

interface PatientLabResultsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  patientName: string;
}

/**
 * A unified dialog to view all lab results for a patient:
 * 1. Photo-based snaps (SnapLabResults)
 * 2. Typed structured results (LabResultsViewer)
 */
export function PatientLabResultsDialog({
  open,
  onOpenChange,
  patientId,
  patientName
}: PatientLabResultsDialogProps) {
  const [activeTab, setActiveTab] = useState<'photos' | 'typed'>('photos');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <FlaskConical className="h-6 w-6 text-module-laboratory" />
            Lab Results · {patientName}
          </DialogTitle>
        </DialogHeader>

        <div className="flex px-6 border-b">
          <button
            onClick={() => setActiveTab('photos')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'photos' 
                ? 'border-module-laboratory text-module-laboratory' 
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Beaker className="h-4 w-4" />
            Photo Results
          </button>
          <button
            onClick={() => setActiveTab('typed')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'typed' 
                ? 'border-module-laboratory text-module-laboratory' 
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileText className="h-4 w-4" />
            Typed Results
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {activeTab === 'photos' ? (
            <SnapLabResults patientId={patientId} />
          ) : (
            <LabResultsViewer patientId={patientId} />
          )}
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
