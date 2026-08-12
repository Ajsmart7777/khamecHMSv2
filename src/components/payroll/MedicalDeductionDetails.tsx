import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ReceiptText } from "lucide-react";
import { useMedicalDeductionDetails } from "@/hooks/usePayroll";
import { format } from "date-fns";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staffId: string | null;
  staffName: string;
  month: number | null;
  year: number | null;
}

export function MedicalDeductionDetails({ open, onOpenChange, staffId, staffName, month, year }: Props) {
  const { details, loading } = useMedicalDeductionDetails(staffId, month, year);

  const total = details.reduce((sum, inv) => sum + (Number(inv.paid_amount) || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ReceiptText className="h-5 w-5 text-primary" />
            Medical Bills: {staffName}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="border border-border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>Invoice #</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {details.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="text-xs">
                        {inv.paid_at ? format(new Date(inv.paid_at), "dd MMM yyyy HH:mm") : '-'}
                      </TableCell>
                      <TableCell className="text-xs">
                        {inv.patient ? `${inv.patient.first_name} ${inv.patient.last_name}` : 'Unknown'}
                      </TableCell>
                      <TableCell className="font-mono text-[10px]">
                        {inv.invoice_number}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ₦{(Number(inv.paid_amount) || 0).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                  {details.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        No matching medical bills found for this period.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {details.length > 0 && (
              <div className="flex justify-between items-center p-4 bg-muted/30 rounded-lg">
                <span className="text-sm font-medium">Total Family Medical Deduction</span>
                <span className="text-lg font-bold">₦{total.toLocaleString()}</span>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
