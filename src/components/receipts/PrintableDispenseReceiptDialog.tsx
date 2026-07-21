import { useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, CheckCircle2 } from 'lucide-react';
import { PharmacyDispenseReceipt } from './PharmacyDispenseReceipt';
import { Patient } from '@/contexts/PatientContext';
import { toast } from 'sonner';

interface DispensedItem {
  name: string;
  dosage: string;
  quantity: number;
  instructions?: string;
}

interface PrintableDispenseReceiptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient;
  items: DispensedItem[];
  receiptNumber: string;
  date: Date;
}

export function PrintableDispenseReceiptDialog({
  open,
  onOpenChange,
  patient,
  items,
  receiptNumber,
  date,
}: PrintableDispenseReceiptDialogProps) {
  const receiptRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    if (!receiptRef.current) return;

    const printContent = receiptRef.current.innerHTML;
    const printWindow = window.open('', '_blank', 'width=370,height=650');
    
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Dispense Receipt - ${receiptNumber}</title>
            <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body { 
                font-family: 'Courier New', monospace; 
                padding: 10px;
                background: white;
              }
              .receipt-container { 
                max-width: 320px; 
                margin: 0 auto; 
                font-size: 12px;
              }
              @media print {
                body { padding: 0; }
                @page { margin: 10mm; size: 80mm auto; }
              }
            </style>
          </head>
          <body>
            <div class="receipt-container">
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
    } else {
      toast.error('Unable to open print window. Please check your popup settings.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-success" />
            Medication Dispensed
          </DialogTitle>
          <DialogDescription>
            Print the receipt as proof of medication collection
          </DialogDescription>
        </DialogHeader>

        {/* Receipt Preview */}
        <div className="flex justify-center py-4 bg-muted rounded-lg overflow-auto max-h-[400px]">
          <div className="transform scale-[0.85] origin-top">
            <PharmacyDispenseReceipt
              ref={receiptRef}
              patient={patient}
              items={items}
              receiptNumber={receiptNumber}
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
            Print Receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
