import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, Loader2, Download, Info } from 'lucide-react';
import type { SponsorStatement } from '@/hooks/useSponsorStatements';
import { useSponsorStatements } from '@/hooks/useSponsorStatements';
import { downloadStatementPdf, loadStatementReport, buildStatementHtml, STATEMENT_CSS } from '@/lib/sponsorStatementPdf';
import type { SponsorStatementReport } from '@/lib/sponsorStatementPdf';
import { toast } from '@/hooks/use-toast';

export function SponsorStatementPrintDialog({ statement, open, onOpenChange, onPrinted }: {
  statement: SponsorStatement | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPrinted?: () => void;
}) {
  const { updateStatus } = useSponsorStatements();
  const [report, setReport] = useState<SponsorStatementReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (statement && open) {
      setLoading(true);
      loadStatementReport(statement.id)
        .then(setReport)
        .catch(error => {
          toast({ title: 'Could not load statement', description: (error as Error).message, variant: 'destructive' });
          setReport(null);
        })
        .finally(() => setLoading(false));
    }
  }, [statement, open]);

  if (!statement) return null;

  const isDraft = statement.status === 'draft';

  const handlePrint = async () => {
    window.print();
    // Reports may only be issued through Close & Issue (finalized statements
    // carry finalized_at). Printing a draft is a preview only.
    if (statement.status === 'finalized' || statement.status === 'printed') {
      await updateStatus(statement.id, 'printed');
      onPrinted?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto print:max-w-full print:max-h-none print:shadow-none print:border-0">
        <DialogHeader className="print:hidden">
          <DialogTitle className="flex items-center justify-between gap-2">
            <span>Statement — {statement.statement_number}</span>
            <div className="flex gap-2">
              {isDraft && (
                <span className="inline-flex items-center gap-1.5 text-xs text-warning mr-1">
                  <Info className="h-3.5 w-3.5" /> Draft — issue it from the {statement.sponsor_type === 'retainer' ? 'Retainer' : 'Corporate'} Month-End tab
                </span>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={downloading || loading}
                onClick={async () => {
                  setDownloading(true);
                  try {
                    await downloadStatementPdf(statement);
                    toast({ title: 'PDF downloaded', description: statement.statement_number });
                  } catch (e) {
                    toast({ title: 'PDF failed', description: (e as Error).message, variant: 'destructive' });
                  } finally { setDownloading(false); }
                }}
              >
                {downloading
                  ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  : <Download className="h-4 w-4 mr-1.5" />}
                Download PDF
              </Button>
              <Button onClick={handlePrint} size="sm">
                <Printer className="h-4 w-4 mr-1.5" /> Print
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        {loading || !report ? (
          <div className="text-center py-10"><Loader2 className="h-6 w-6 mx-auto animate-spin" /></div>
        ) : (
          <div id="print-statement" className="overflow-x-auto">
            <div dangerouslySetInnerHTML={{ __html: buildStatementHtml(report) }} />
          </div>
        )}
      </DialogContent>

      <style>{`
        ${STATEMENT_CSS}
        @page { size: A4; margin: 0; }
        @media print {
          body * { visibility: hidden; }
          #print-statement, #print-statement * { visibility: visible; }
          #print-statement { position: absolute; inset: 0; width: 100%; overflow: visible; }
          #print-statement .st-doc { width: 100%; }
          .st-items tr, .st-pre, .st-tail { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>
    </Dialog>
  );
}
