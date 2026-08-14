import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, Loader2, Download } from 'lucide-react';
import type { SponsorStatement, SponsorStatementItem } from '@/hooks/useSponsorStatements';
import { useSponsorStatements } from '@/hooks/useSponsorStatements';
import { downloadStatementPdf } from '@/lib/sponsorStatementPdf';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

interface ManualStatementItem {
  id: string;
  patient_name: string;
  service_description: string;
  service_date: string;
  amount: number;
  notes: string | null;
}

function money(v: number) {
  return `₦${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function amountInWords(n: number) {
  // simple Naira in-words up to millions — good enough for a printout footer
  const a = ['','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const b = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  const toWords = (num: number): string => {
    if (num < 20) return a[num];
    if (num < 100) return b[Math.floor(num/10)] + (num%10 ? '-' + a[num%10] : '');
    if (num < 1000) return a[Math.floor(num/100)] + ' hundred' + (num%100 ? ' ' + toWords(num%100) : '');
    if (num < 1_000_000) return toWords(Math.floor(num/1000)) + ' thousand' + (num%1000 ? ' ' + toWords(num%1000) : '');
    return toWords(Math.floor(num/1_000_000)) + ' million' + (num%1_000_000 ? ' ' + toWords(num%1_000_000) : '');
  };
  const whole = Math.floor(n);
  const kobo = Math.round((n - whole) * 100);
  const w = whole === 0 ? 'zero' : toWords(whole);
  const cap = w.charAt(0).toUpperCase() + w.slice(1);
  return `${cap} naira${kobo ? ` and ${toWords(kobo)} kobo` : ''} only`;
}

export function SponsorStatementPrintDialog({ statement, open, onOpenChange, onPrinted }: {
  statement: SponsorStatement | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPrinted?: () => void;
}) {
  const { getItems, updateStatus } = useSponsorStatements();
  const [items, setItems] = useState<SponsorStatementItem[]>([]);
  const [manualItems, setManualItems] = useState<ManualStatementItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (statement && open) {
      setLoading(true);
      void Promise.all([
        getItems(statement.id),
        supabase
          .from('corporate_statement_manual_items')
          .select('manual:corporate_manual_service_rows(id,patient_name,service_description,service_date,amount,notes)')
          .eq('statement_id', statement.id),
      ]).then(([statementItems, manualResponse]) => {
        setItems(statementItems);
        const manual = (manualResponse.data || []).flatMap(row => {
          const item = row.manual as unknown as ManualStatementItem | null;
          return item ? [{ ...item, amount: Number(item.amount) }] : [];
        }).sort((a, b) => a.service_date.localeCompare(b.service_date));
        setManualItems(manual);
      }).finally(() => setLoading(false));
    }
  }, [statement, open]);

  if (!statement) return null;

  const grouped: Record<string, SponsorStatementItem[]> = {};
  items.forEach(it => {
    const key = it.patient_id;
    (grouped[key] ||= []).push(it);
  });

  const handlePrint = async () => {
    window.print();
    if (statement.status === 'draft' || statement.status === 'finalized') {
      await updateStatus(statement.id, 'printed');
      onPrinted?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto print:max-w-full print:max-h-none print:shadow-none print:border-0">
        <DialogHeader className="print:hidden">
          <DialogTitle className="flex items-center justify-between gap-2">
            <span>Statement — {statement.statement_number}</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={downloading || loading}
                onClick={async () => {
                  setDownloading(true);
                  try {
                    await downloadStatementPdf(statement, items);
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

        {loading ? (
          <div className="text-center py-10"><Loader2 className="h-6 w-6 mx-auto animate-spin" /></div>
        ) : (
          <div id="print-statement" className="bg-white text-black p-6 print:p-4">
            {/* Header */}
            <div className="text-center border-b-2 border-black pb-3">
              <h1 className="text-2xl font-bold">KHADIJA MEDICAL CENTER</h1>
              <p className="text-xs">Comprehensive healthcare services</p>
              <p className="text-xs">Address • Phone • Email</p>
            </div>

            <div className="text-center mt-4">
              <h2 className="text-lg font-bold uppercase tracking-wider">
                {statement.sponsor_type === 'retainer' ? 'Retainer' : 'Corporate'} Monthly Statement
              </h2>
              <p className="text-xs mt-0.5">Statement #: {statement.statement_number}</p>
            </div>

            {/* Meta */}
            <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
              <div className="border p-3">
                <p className="text-[10px] uppercase text-gray-600 mb-1">Billed to</p>
                <p className="font-bold">{statement.sponsor?.company_name}</p>
                {statement.sponsor?.contact_person && <p>Attn: {statement.sponsor.contact_person}</p>}
                {statement.sponsor?.address && <p className="text-xs">{statement.sponsor.address}</p>}
                {statement.sponsor?.phone && <p className="text-xs">Tel: {statement.sponsor.phone}</p>}
                {statement.sponsor?.email && <p className="text-xs">{statement.sponsor.email}</p>}
              </div>
              <div className="border p-3">
                <p className="text-[10px] uppercase text-gray-600 mb-1">Period</p>
                <p className="font-bold">{MONTHS[statement.period_month - 1]} {statement.period_year}</p>
                <p className="text-xs">
                  {new Date(statement.period_start).toLocaleDateString()} — {new Date(statement.period_end).toLocaleDateString()}
                </p>
                <p className="text-xs mt-2">Generated: {new Date(statement.generated_at).toLocaleDateString()}</p>
                <p className="text-xs">Patients: {statement.patient_count} · Invoices: {statement.invoice_count}{statement.manual_service_count ? ` · Walk-ins: ${statement.manual_service_count}` : ''}</p>
              </div>
            </div>

            {/* Items */}
            <div className="mt-5">
              {items.length === 0 && manualItems.length === 0 ? (
                <p className="text-center text-sm text-gray-500 py-8 border">No billable invoices or walk-in paper services in this period.</p>
              ) : (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-100 border-y-2 border-black">
                      <th className="text-left p-1.5">Date</th>
                      <th className="text-left p-1.5">Patient</th>
                      <th className="text-left p-1.5">Card #</th>
                      <th className="text-left p-1.5">Invoice #</th>
                      <th className="text-right p-1.5">Amount (₦)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(grouped).map(([pid, list]) => {
                      const subtotal = list.reduce((s, x) => s + x.amount, 0);
                      const p = list[0].patient;
                      return (
                        <>
                          {list.map(it => (
                            <tr key={it.id} className="border-b border-gray-300">
                              <td className="p-1.5">{new Date(it.service_date).toLocaleDateString()}</td>
                              <td className="p-1.5">{p?.first_name} {p?.last_name}</td>
                              <td className="p-1.5 font-mono">{p?.card_number}</td>
                              <td className="p-1.5 font-mono">{it.invoice?.invoice_number}</td>
                              <td className="p-1.5 text-right">{Number(it.amount).toLocaleString(undefined,{minimumFractionDigits:2})}</td>
                            </tr>
                          ))}
                          <tr key={`sub-${pid}`} className="bg-gray-50 border-b border-gray-400">
                            <td colSpan={4} className="p-1.5 text-right italic">Subtotal for {p?.first_name} {p?.last_name}</td>
                            <td className="p-1.5 text-right font-semibold">{subtotal.toLocaleString(undefined,{minimumFractionDigits:2})}</td>
                          </tr>
                        </>
                      );
                    })}
                    {manualItems.map(item => (
                      <tr key={`manual-${item.id}`} className="border-b border-gray-300 bg-amber-50">
                        <td className="p-1.5">{new Date(`${item.service_date}T12:00:00`).toLocaleDateString()}</td>
                        <td className="p-1.5">{item.patient_name}<span className="block text-[9px] text-amber-700 uppercase">Walk-in paper service</span></td>
                        <td className="p-1.5 font-mono">WALK-IN</td>
                        <td className="p-1.5">{item.service_description}</td>
                        <td className="p-1.5 text-right">{Number(item.amount).toLocaleString(undefined,{minimumFractionDigits:2})}</td>
                      </tr>
                    ))}
                    <tr className="border-y-2 border-black bg-gray-100">
                      <td colSpan={4} className="p-2 text-right font-bold uppercase">Grand Total</td>
                      <td className="p-2 text-right font-bold text-base">{money(statement.total_amount)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>

            {(items.length > 0 || manualItems.length > 0) && (
              <p className="text-xs italic mt-2">
                Amount in words: <span className="font-semibold">{amountInWords(statement.total_amount)}</span>.
              </p>
            )}

            {/* Footer */}
            <div className="mt-6 text-xs">
              <p className="border-t pt-2">
                <strong>Payment terms:</strong> Kindly settle the above amount within 30 days of receipt of this statement.
                Payments should be made to the hospital's designated account. Reference this statement number on all payments.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-8 mt-10 text-xs">
              <div>
                <div className="border-t border-black pt-1">Prepared by (Accountant)</div>
                <p className="mt-8">Signature & Date</p>
              </div>
              <div>
                <div className="border-t border-black pt-1">Received by ({statement.sponsor?.company_name})</div>
                <p className="mt-8">Signature, Stamp & Date</p>
              </div>
            </div>
          </div>
        )}
      </DialogContent>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-statement, #print-statement * { visibility: visible; }
          #print-statement { position: absolute; inset: 0; width: 100%; }
        }
      `}</style>
    </Dialog>
  );
}
