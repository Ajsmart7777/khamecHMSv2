import { useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, FlaskConical } from 'lucide-react';
import { LabTestRequest } from './LabTestRequest';
import { Patient } from '@/contexts/PatientContext';
import { toast } from 'sonner';

interface PrintableLabRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient;
  tests: string[];
  diagnosis: string;
  requestNumber: string;
  date: Date;
  onPrintComplete?: () => void;
}

export function PrintableLabRequestDialog({
  open,
  onOpenChange,
  patient,
  tests,
  diagnosis,
  requestNumber,
  date,
  onPrintComplete,
}: PrintableLabRequestDialogProps) {
  const requestRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    if (!requestRef.current) return;

    const printContent = requestRef.current.innerHTML;
    const printWindow = window.open('', '_blank', 'width=400,height=700');
    
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Lab Request - ${requestNumber}</title>
            <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body { 
                font-family: 'Courier New', monospace; 
                padding: 10px;
                background: white;
              }
              .request-container { 
                max-width: 350px; 
                margin: 0 auto; 
                font-size: 12px;
              }
              @media print {
                body { padding: 0; }
                @page { margin: 10mm; size: A5; }
              }
            </style>
          </head>
          <body>
            <div class="request-container">
              ${printContent}
            </div>
            <script>
              window.onload = function() {
                window.print();
                window.onafterprint = function() { window.close(); }
              }
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
      onPrintComplete?.();
    } else {
      toast.error('Unable to open print window. Please check your popup settings.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-module-lab" />
            Lab Tests Requested
          </DialogTitle>
          <DialogDescription>
            Print the request form for the patient to present at Laboratory
          </DialogDescription>
        </DialogHeader>

        {/* Request Preview */}
        <div className="flex justify-center py-4 bg-muted rounded-lg overflow-auto max-h-[450px]">
          <div className="transform scale-[0.85] origin-top">
            <LabTestRequest
              ref={requestRef}
              patient={patient}
              tests={tests}
              diagnosis={diagnosis}
              requestNumber={requestNumber}
              date={date}
            />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            Close
          </Button>
          <Button variant="hero" onClick={handlePrint} className="w-full sm:w-auto">
            <Printer className="h-4 w-4 mr-2" />
            Print Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
