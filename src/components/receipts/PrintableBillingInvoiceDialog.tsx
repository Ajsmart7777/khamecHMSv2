import { useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, Download } from 'lucide-react';
import { BillingInvoice } from './BillingInvoice';

interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface PrintableBillingInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientName: string;
  cardNumber: string;
  invoiceNumber: string;
  date: Date;
  items: InvoiceItem[];
  totalAmount: number;
  amountPaid: number;
  balance: number;
  paymentMethod: string;
  onPrintComplete?: () => void;
}

export function PrintableBillingInvoiceDialog({
  open,
  onOpenChange,
  patientName,
  cardNumber,
  invoiceNumber,
  date,
  items,
  totalAmount,
  amountPaid,
  balance,
  paymentMethod,
  onPrintComplete,
}: PrintableBillingInvoiceDialogProps) {
  const invoiceRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    if (invoiceRef.current) {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Invoice - ${invoiceNumber}</title>
              <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Courier New', monospace; font-size: 12px; }
                @media print {
                  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                }
              </style>
            </head>
            <body>
              ${invoiceRef.current.innerHTML}
            </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
          printWindow.print();
          printWindow.close();
          onPrintComplete?.();
        }, 250);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-primary" />
            Invoice Preview
          </DialogTitle>
        </DialogHeader>
        
        <div className="border rounded-lg overflow-hidden bg-white">
          <BillingInvoice
            ref={invoiceRef}
            patientName={patientName}
            cardNumber={cardNumber}
            invoiceNumber={invoiceNumber}
            date={date}
            items={items}
            totalAmount={totalAmount}
            amountPaid={amountPaid}
            balance={balance}
            paymentMethod={paymentMethod}
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
          <Button variant="hero" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />
            Print Invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
