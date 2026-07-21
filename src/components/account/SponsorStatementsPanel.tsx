import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, FileText, Printer, RefreshCw, Wand2, CheckCircle2, XCircle, DollarSign, Download, FileDown } from 'lucide-react';
import { useSponsorStatements, SponsorStatement } from '@/hooks/useSponsorStatements';
import { useCorporateAccounts } from '@/hooks/useCorporateAccounts';
import { SponsorStatementPrintDialog } from './SponsorStatementPrintDialog';
import { downloadStatementPdf, downloadBulkStatementsPdf } from '@/lib/sponsorStatementPdf';
import { toast } from '@/hooks/use-toast';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function statusVariant(s: SponsorStatement['status']): 'default' | 'outline' | 'success' | 'warning' | 'destructive' {
  switch (s) {
    case 'draft': return 'outline';
    case 'finalized': return 'warning';
    case 'printed': return 'default';
    case 'paid': return 'success';
    case 'void': return 'destructive';
  }
}

export function SponsorStatementsPanel({ accountType }: { accountType: 'corporate' | 'retainer' }) {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [year, setYear] = useState(prev.getFullYear());
  const [month, setMonth] = useState(prev.getMonth() + 1);
  const [busy, setBusy] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [selected, setSelected] = useState<SponsorStatement | null>(null);

  const { statements, loading, generateAll, generateForSponsor, updateStatus, fetchStatements } = useSponsorStatements(accountType);
  const { accounts } = useCorporateAccounts(accountType);

  const filtered = useMemo(
    () => statements.filter(s => s.period_year === year && s.period_month === month),
    [statements, year, month],
  );

  const years = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, [now]);

  const activeSponsors = accounts.filter(a => a.status === 'active');
  const missingSponsors = activeSponsors.filter(a => !filtered.some(s => s.sponsor_id === a.id));

  const handleGenerateAll = async () => {
    setBusy(true);
    await generateAll(year, month);
    setBusy(false);
  };

  const handleGenerateOne = async (sponsorId: string) => {
    setBusy(true);
    await generateForSponsor(sponsorId, year, month);
    setBusy(false);
  };

  const openPrint = (s: SponsorStatement) => {
    setSelected(s);
    setPrintOpen(true);
  };

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const handleDownloadOne = async (s: SponsorStatement) => {
    setDownloadingId(s.id);
    try {
      await downloadStatementPdf(s);
      toast({ title: 'PDF downloaded', description: s.statement_number });
    } catch (e) {
      toast({ title: 'PDF failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleBulkDownload = async () => {
    if (filtered.length === 0) return;
    setBulkProgress({ done: 0, total: filtered.length });
    try {
      await downloadBulkStatementsPdf(
        filtered,
        `${label}-Statements-${year}-${String(month).padStart(2, '0')}`,
        (done, total) => setBulkProgress({ done, total }),
      );
      toast({ title: 'Bulk PDF ready', description: `${filtered.length} statements combined` });
    } catch (e) {
      toast({ title: 'Bulk PDF failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBulkProgress(null);
    }
  };

  const label = accountType === 'retainer' ? 'Retainer' : 'Corporate';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">{label} Monthly Statements</h3>
          <Badge variant="outline">{filtered.length}</Badge>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={String(month)} onValueChange={v => setMonth(Number(v))}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchStatements}>
            <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
          </Button>
          <Button size="sm" onClick={handleGenerateAll} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1.5" />}
            Generate all for {MONTHS[month - 1]} {year}
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Generates one consolidated statement per {label.toLowerCase()} sponsor for the selected month —
        includes every invoice raised for their linked patients. Draft statements can be regenerated;
        finalized, printed, or paid statements must be voided first. The system also auto-runs on the
        1st of each month for the previous month.
      </p>

      {missingSponsors.length > 0 && (
        <div className="border border-dashed rounded-md p-3 bg-muted/30">
          <p className="text-xs font-medium mb-2">
            {missingSponsors.length} active {label.toLowerCase()} sponsor(s) have no statement yet for {MONTHS[month - 1]} {year}:
          </p>
          <div className="flex flex-wrap gap-2">
            {missingSponsors.map(s => (
              <Button key={s.id} variant="outline" size="sm" onClick={() => handleGenerateOne(s.id)} disabled={busy}>
                <Wand2 className="h-3 w-3 mr-1" /> {s.company_name}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Statement #</TableHead>
              <TableHead>Sponsor</TableHead>
              <TableHead className="text-right">Patients</TableHead>
              <TableHead className="text-right">Invoices</TableHead>
              <TableHead className="text-right">Total (₦)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8"><Loader2 className="h-5 w-5 mx-auto animate-spin" /></TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8 text-sm">
                No statements for {MONTHS[month - 1]} {year}. Click "Generate all" to create them.
              </TableCell></TableRow>
            ) : filtered.map(s => (
              <TableRow key={s.id}>
                <TableCell className="font-mono text-xs">{s.statement_number}</TableCell>
                <TableCell>{s.sponsor?.company_name || '—'}</TableCell>
                <TableCell className="text-right">{s.patient_count}</TableCell>
                <TableCell className="text-right">{s.invoice_count}</TableCell>
                <TableCell className="text-right font-mono">{s.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                <TableCell><Badge variant={statusVariant(s.status)} className="uppercase text-[10px]">{s.status}</Badge></TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="sm" variant="outline" onClick={() => openPrint(s)}>
                    <Printer className="h-3.5 w-3.5 mr-1" /> View / Print
                  </Button>
                  {s.status === 'draft' && (
                    <Button size="sm" variant="outline" onClick={() => updateStatus(s.id, 'finalized')}>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Finalize
                    </Button>
                  )}
                  {(s.status === 'finalized' || s.status === 'printed') && (
                    <Button size="sm" variant="outline" onClick={() => updateStatus(s.id, 'paid')}>
                      <DollarSign className="h-3.5 w-3.5 mr-1" /> Mark paid
                    </Button>
                  )}
                  {s.status !== 'void' && s.status !== 'paid' && (
                    <Button size="sm" variant="ghost" onClick={async () => {
                      if (!confirm('Void this statement? It can then be regenerated.')) return;
                      const ok = await updateStatus(s.id, 'void');
                      if (ok) toast({ title: 'Voided', description: s.statement_number });
                    }}>
                      <XCircle className="h-3.5 w-3.5 mr-1" /> Void
                    </Button>
                  )}
                  {s.status === 'draft' && (
                    <Button size="sm" variant="ghost" onClick={() => handleGenerateOne(s.sponsor_id)} disabled={busy}>
                      <RefreshCw className="h-3.5 w-3.5 mr-1" /> Regenerate
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <SponsorStatementPrintDialog
        statement={selected}
        open={printOpen}
        onOpenChange={setPrintOpen}
        onPrinted={fetchStatements}
      />
    </div>
  );
}
