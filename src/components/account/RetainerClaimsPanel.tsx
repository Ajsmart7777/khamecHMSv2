import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Building2, FileDown, Landmark, Loader2, Lock, RefreshCw, ReceiptText,
  Users, Wallet, Wand2, Phone, MapPin,
} from 'lucide-react';
import { useCorporateAccounts } from '@/hooks/useCorporateAccounts';
import { useSponsorStatements } from '@/hooks/useSponsorStatements';
import { downloadStatementPdf } from '@/lib/sponsorStatementPdf';
import {
  buildPatientSponsorBreakdowns,
  emptySponsorServiceBreakdown,
  type SponsorServiceBreakdown,
} from '@/lib/sponsorStatementCategories';
import {
  downloadCorporateCoveringLetter,
  CorporateCoveringLetterData,
  CorporateCoveringLetterInvoiceLine,
  CorporateCoveringLetterPayment,
  CorporateCoveringLetterStatement,
} from '@/lib/corporateCoveringLetterPdf';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

interface PatientRow {
  id: string;
  first_name: string;
  last_name: string | null;
  card_number: string | null;
}

interface InvoiceRow {
  id: string;
  invoice_number: string;
  patient_id: string;
  total_amount: number;
  visit_id: string | null;
  created_at: string;
}

interface StatementRow {
  id: string;
  statement_number: string;
  sponsor_id: string;
  status: string;
  total_amount: number;
  paid_at: string | null;
  finalized_at: string | null;
}

interface RetainerCoveringTransaction {
  id: string;
  statement_id: string | null;
  statement_number: string | null;
  period_year: number | null;
  period_month: number | null;
  transaction_date: string;
  amount: number;
  transaction_type: string;
  payment_method: string | null;
  bank_reference: string | null;
  notes: string | null;
}

interface RetainerSettlementForm {
  amount_received: string;
  payment_date: string;
  payment_method: string;
  bank_reference: string;
  notes: string;
}

function isoDateToday() {
  return new Date().toISOString().slice(0, 10);
}

function emptySettlementForm(): RetainerSettlementForm {
  return {
    amount_received: '',
    payment_date: isoDateToday(),
    payment_method: 'bank_transfer',
    bank_reference: '',
    notes: '',
  };
}

function money(v: number) {
  return Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusVariant(s: string): 'default' | 'outline' | 'success' | 'warning' | 'destructive' {
  switch (s) {
    case 'paid': return 'success';
    case 'finalized': return 'warning';
    case 'draft': return 'outline';
    case 'void': return 'destructive';
    default: return 'default';
  }
}

export function RetainerClaimsPanel() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [patients, setPatients] = useState<Record<string, PatientRow[]>>({});
  const [invoices, setInvoices] = useState<Record<string, InvoiceRow[]>>({});
  const [serviceBreakdowns, setServiceBreakdowns] = useState<Record<string, SponsorServiceBreakdown>>({});
  const [visitCounts, setVisitCounts] = useState<Record<string, Record<string, number>>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [closeDialog, setCloseDialog] = useState<string | null>(null);
  const [closeNotes, setCloseNotes] = useState('');
  const [settlementDialog, setSettlementDialog] = useState<string | null>(null);
  const [settlementForm, setSettlementForm] = useState<RetainerSettlementForm>(emptySettlementForm());

  const { accounts, refetch: refetchAccounts } = useCorporateAccounts('retainer');
  const { statements, fetchStatements } = useSponsorStatements('retainer');

  const periodStart = useMemo(() => new Date(year, month - 1, 1), [year, month]);
  const periodEnd = useMemo(() => new Date(year, month, 1), [year, month]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Patients under retainers
      const { data: pats } = await supabase
        .from('patients')
        .select('id, first_name, last_name, card_number, corporate_id')
        .eq('account_type', 'retainer');
      const byRetainer: Record<string, PatientRow[]> = {};
      (pats || []).forEach(p => {
        if (p.corporate_id) {
          (byRetainer[p.corporate_id] ||= []).push({
            id: p.id, first_name: p.first_name,
            last_name: p.last_name, card_number: p.card_number,
          });
        }
      });
      setPatients(byRetainer);

      const patientIds = (pats || []).map(p => p.id);
      if (patientIds.length === 0) {
        setInvoices({}); setServiceBreakdowns({}); setVisitCounts({});
      } else {
        const { data: invs, error: invoicesError } = await supabase
          .from('invoices')
          .select('id, invoice_number, patient_id, total_amount, visit_id, created_at')
          .in('patient_id', patientIds)
          .gte('created_at', periodStart.toISOString())
          .lt('created_at', periodEnd.toISOString());
        if (invoicesError) throw invoicesError;
        const invoiceIds = (invs || []).map(invoice => invoice.id);
        const { data: invoiceItems, error: invoiceItemsError } = invoiceIds.length
          ? await supabase.from('invoice_items').select('invoice_id, description, category, total').in('invoice_id', invoiceIds)
          : { data: [], error: null };
        if (invoiceItemsError) throw invoiceItemsError;
        const byPatient: Record<string, InvoiceRow[]> = {};
        (invs || []).forEach(i => {
          (byPatient[i.patient_id] ||= []).push({
            ...i, total_amount: Number(i.total_amount) || 0,
          });
        });
        setInvoices(byPatient);
        setServiceBreakdowns(buildPatientSponsorBreakdowns(invs || [], invoiceItems || []));

        // Visit counts per (retainer, patient)
        const { data: vs } = await supabase
          .from('visits')
          .select('id, patient_id, corporate_id, opened_at')
          .in('patient_id', patientIds)
          .gte('opened_at', periodStart.toISOString())
          .lt('opened_at', periodEnd.toISOString());
        const vc: Record<string, Record<string, number>> = {};
        (vs || []).forEach(v => {
          if (v.corporate_id) {
            vc[v.corporate_id] ||= {};
            vc[v.corporate_id][v.patient_id] = (vc[v.corporate_id][v.patient_id] || 0) + 1;
          }
        });
        setVisitCounts(vc);
      }

      await fetchStatements();
    } finally {
      setLoading(false);
    }
  }, [periodStart, periodEnd, fetchStatements]);

  useEffect(() => { load(); }, [load]);

  const years = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statementBySponsor: Record<string, StatementRow | undefined> = useMemo(() => {
    const map: Record<string, StatementRow> = {};
    statements.forEach(s => {
      if (s.period_year === year && s.period_month === month) {
        map[s.sponsor_id] = {
          id: s.id,
          statement_number: s.statement_number,
          sponsor_id: s.sponsor_id,
          status: s.status,
          total_amount: Number(s.total_amount),
          paid_at: s.paid_at,
          finalized_at: s.finalized_at,
        };
      }
    });
    return map;
  }, [statements, year, month]);

  const activeRetainers = accounts.filter(a => a.status === 'active');

  const overallTotals = useMemo(() => {
    let billed = 0; let deposit = 0; let due = 0;
    activeRetainers.forEach(r => {
      const pats = patients[r.id] || [];
      const monthTotal = pats.reduce((sum, p) => {
        const inv = invoices[p.id] || [];
        return sum + inv.reduce((s, i) => s + i.total_amount, 0);
      }, 0);
      billed += monthTotal;
      deposit += Math.max(0, r.balance);
      const stmt = statementBySponsor[r.id];
      if (stmt && stmt.status === 'finalized') due += Number(stmt.total_amount);
    });
    return { billed, deposit, due };
  }, [activeRetainers, patients, invoices, statementBySponsor]);

  const handleGenerate = async (sponsorId: string) => {
    setBusy(sponsorId);
    try {
      const { error } = await supabase.rpc('generate_sponsor_statement', {
        _sponsor_id: sponsorId, _year: year, _month: month,
      });
      if (error) throw error;
      toast({ title: 'Statement generated' });
      await fetchStatements();
    } catch (e) {
      toast({ title: 'Generate failed', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  };

  const doClose = async (sponsorId: string) => {
    setBusy(sponsorId);
    try {
      const { data, error } = await supabase.rpc('close_retainer_month', {
        _sponsor_id: sponsorId, _year: year, _month: month,
        _notes: closeNotes || null,
      });
      if (error) throw error;
      const res = data as { final_status: string; deducted: number; outstanding: number };
      toast({
        title: `Month closed — ${res.final_status.toUpperCase()}`,
        description: `Deducted ₦${money(res.deducted)} · Outstanding ₦${money(res.outstanding)}`,
      });
      setCloseDialog(null);
      setCloseNotes('');
      await Promise.all([fetchStatements(), refetchAccounts(), load()]);
    } catch (e) {
      toast({ title: 'Close failed', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  };

  const openSettlementDialog = (statementId: string) => {
    setSettlementDialog(statementId);
    setSettlementForm(emptySettlementForm());
  };

  const settleStatement = async () => {
    if (!settlementDialog) return;
    const amountReceived = Number(settlementForm.amount_received || 0);
    if (!settlementForm.payment_date || !Number.isFinite(amountReceived) || amountReceived < 0) {
      toast({ title: 'Check the settlement details', description: 'Enter a payment date and a valid received amount. Use 0.00 when only applying an existing Retainer balance.', variant: 'destructive' });
      return;
    }

    setBusy(settlementDialog);
    try {
      const { data, error } = await (supabase as any).rpc('settle_retainer_statement', {
        _statement_id: settlementDialog,
        _amount_received: amountReceived,
        _payment_date: settlementForm.payment_date,
        _payment_method: settlementForm.payment_method,
        _bank_reference: settlementForm.bank_reference.trim() || null,
        _notes: settlementForm.notes.trim() || null,
      });
      if (error) throw error;
      const result = data as { status?: string; applied?: number; outstanding?: number; credit?: number } | null;
      const outstanding = Number(result?.outstanding || 0);
      const credit = Number(result?.credit || 0);
      toast({
        title: result?.status === 'paid' ? 'Retainer claim settled' : 'Retainer funding recorded',
        description: credit > 0
          ? `₦${money(credit)} remains as available Retainer credit.`
          : outstanding > 0
            ? `₦${money(outstanding)} remains outstanding on this monthly claim.`
            : `₦${money(Number(result?.applied || 0))} was applied to the claim.`,
      });
      setSettlementDialog(null);
      await Promise.all([fetchStatements(), refetchAccounts(), load()]);
    } catch (error) {
      toast({ title: 'Could not settle Retainer claim', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const downloadMonthlyReport = async (statement: StatementRow) => {
    setBusy(statement.id);
    try {
      await downloadStatementPdf(statement as any);
      toast({ title: 'Monthly report downloaded', description: statement.statement_number });
    } catch (error) {
      toast({ title: 'Monthly report failed', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const downloadCoveringLetter = async (sponsorId: string) => {
    const retainer = accounts.find(account => account.id === sponsorId);
    const statement = statementBySponsor[sponsorId];
    if (!retainer) return;
    if (!statement) {
      toast({ title: 'Generate the monthly statement first', description: 'The covering letter requires a statement for the selected month.', variant: 'destructive' });
      return;
    }

    setBusy(sponsorId);
    try {
      const [{ data: reconciliation, error: reconciliationError }, { data: invoiceItems, error: itemsError }] = await Promise.all([
        (supabase as any).rpc('get_retainer_covering_letter_data', { _sponsor_id: sponsorId, _as_of_year: year, _as_of_month: month }),
        supabase
          .from('sponsor_statement_items')
          .select('service_date, amount, patient:patients(first_name,last_name,card_number), invoice:invoices(invoice_number)')
          .eq('statement_id', statement.id)
          .order('service_date', { ascending: true }),
      ]);
      if (reconciliationError) throw reconciliationError;
      if (itemsError) throw itemsError;

      const raw = reconciliation as unknown as {
        sponsor: CorporateCoveringLetterData['sponsor'];
        statements: CorporateCoveringLetterStatement[];
        transaction_history: RetainerCoveringTransaction[];
        summary: CorporateCoveringLetterData['summary'];
      };
      const currentInvoiceItems: CorporateCoveringLetterInvoiceLine[] = (invoiceItems || []).map(item => {
        const row = item as unknown as {
          service_date: string;
          amount: number;
          patient: { first_name: string; last_name: string | null; card_number: string | null } | null;
          invoice: { invoice_number: string } | null;
        };
        return {
          service_date: row.service_date,
          amount: Number(row.amount),
          patient_name: `${row.patient?.first_name || ''} ${row.patient?.last_name || ''}`.trim() || 'Registered beneficiary',
          card_number: row.patient?.card_number,
          invoice_number: row.invoice?.invoice_number,
        };
      });
      const transactionLabels: Record<string, string> = {
        deposit: 'Deposit received',
        monthly_deduction: 'Deposit applied to claim',
        refund: 'Refund issued',
        adjustment: 'Balance adjustment',
      };
      const transactions: CorporateCoveringLetterPayment[] = (raw.transaction_history || []).map(row => ({
        id: row.id,
        statement_id: row.statement_id || '',
        statement_number: row.statement_number || 'Retainer account',
        period_year: Number(row.period_year || year),
        period_month: Number(row.period_month || month),
        payment_date: row.transaction_date,
        amount: Number(row.amount),
        payment_method: transactionLabels[row.transaction_type] || row.transaction_type.replace(/_/g, ' '),
        bank_reference: row.bank_reference || null,
        notes: row.notes,
      }));

      await downloadCorporateCoveringLetter({
        account_kind: 'retainer',
        reference: `RET-COV-${year}${String(month).padStart(2, '0')}-${statement.statement_number}`,
        generated_at: new Date().toISOString(),
        as_of_year: year,
        as_of_month: month,
        sponsor: raw.sponsor,
        statements: (raw.statements || []).map(row => ({ ...row, total_amount: Number(row.total_amount), paid_amount: Number(row.paid_amount), balance: Number(row.balance) })),
        payments: transactions,
        current_invoice_items: currentInvoiceItems,
        current_manual_services: [],
        summary: {
          total_billed: Number(raw.summary?.total_billed || 0),
          total_paid: Number(raw.summary?.total_paid || 0),
          net_balance_due: Number(raw.summary?.net_balance_due || 0),
          credit_amount: Number(raw.summary?.credit_amount || 0),
          available_deposit_balance: Number(raw.summary?.available_deposit_balance || 0),
        },
      });
      toast({ title: 'Retainer covering letter downloaded' });
    } catch (error) {
      toast({ title: 'Covering letter failed', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const settlementStatement = settlementDialog
    ? statements.find(statement => statement.id === settlementDialog)
    : null;
  const settlementRetainer = settlementStatement
    ? accounts.find(account => account.id === settlementStatement.sponsor_id)
    : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Retainer Month-End Claims</h3>
          <Badge variant="outline">{activeRetainers.length} retainer(s)</Badge>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={String(month)} onValueChange={v => setMonth(Number(v))}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>{MONTHS.map((m, i) => (<SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>))}</SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>{years.map(y => (<SelectItem key={y} value={String(y)}>{y}</SelectItem>))}</SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

        <p className="text-xs text-muted-foreground">
          Follow one monthly sequence for every Retainer: <b>1. Review services</b>, <b>2. Prepare report</b>, <b>3. Close and issue report</b>, then <b>4. Record company funding or apply available credit</b>. Once a month is closed, all later services are counted in the next month. Use the covering letter only when reconciling unpaid months or Retainer credit across periods.
        </p>

      {/* Totals */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border p-3 bg-card">
          <p className="text-xs text-muted-foreground">Billed this month</p>
          <p className="text-lg font-semibold mt-1">₦{money(overallTotals.billed)}</p>
        </div>
        <div className="rounded-lg border p-3 bg-card">
          <p className="text-xs text-muted-foreground">Available Retainer credit</p>
          <p className="text-lg font-semibold mt-1 text-success">₦{money(overallTotals.deposit)}</p>
        </div>
        <div className="rounded-lg border p-3 bg-warning/5 border-warning/30">
          <p className="text-xs text-muted-foreground">Unpaid selected-month claims</p>
          <p className="text-lg font-semibold mt-1 text-warning">₦{money(overallTotals.due)}</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-10"><Loader2 className="h-5 w-5 mx-auto animate-spin" /></div>
      ) : activeRetainers.length === 0 ? (
        <div className="text-center py-10 border rounded-lg text-muted-foreground text-sm">
          No retainers registered. Go to the "Retainer" tab to create one.
        </div>
      ) : (
        <Accordion type="multiple" className="space-y-2">
          {activeRetainers.map(r => {
            const pats = patients[r.id] || [];
            const monthTotal = pats.reduce((sum, p) => {
              const inv = invoices[p.id] || [];
              return sum + inv.reduce((s, i) => s + i.total_amount, 0);
            }, 0);
            const stmt = statementBySponsor[r.id];
            const locked = stmt?.status === 'paid' || stmt?.status === 'finalized';

            return (
              <AccordionItem
                key={r.id}
                value={r.id}
                className="border rounded-lg bg-card px-0 overflow-hidden"
              >
                <AccordionTrigger className="hover:no-underline px-4 py-3">
                  <div className="flex flex-1 items-center justify-between gap-3 pr-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 text-left">
                        <p className="font-semibold text-sm truncate">{r.company_name}</p>
                        <div className="flex gap-3 text-[11px] text-muted-foreground">
                          {r.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{r.phone}</span>}
                          {r.address && <span className="flex items-center gap-1 truncate"><MapPin className="h-3 w-3" />{r.address}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Patients</p>
                        <p className="text-sm font-semibold">{pats.length}</p>
                      </div>
                      <div className="text-right">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Available credit</p>
                        <p className="text-sm font-semibold text-success">₦{money(r.balance)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">This month</p>
                        <p className="text-sm font-semibold">₦{money(monthTotal)}</p>
                      </div>
                      {stmt && <Badge variant={statusVariant(stmt.status)} className="uppercase text-[10px]">{stmt.status}</Badge>}
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 pt-0">
                  <div className="border-t pt-3 space-y-3">
                    {/* Actions */}
                    <div className="flex flex-wrap gap-2">
                      {!locked && (
                        <Button size="sm" variant="outline" onClick={() => handleGenerate(r.id)} disabled={busy === r.id}>
                          <Wand2 className="h-3.5 w-3.5 mr-1" /> {stmt ? 'Refresh draft report' : 'Prepare monthly report'}
                        </Button>
                      )}
                      {stmt && (
                        <Button size="sm" variant="outline" onClick={() => void downloadMonthlyReport(stmt)} disabled={busy === stmt.id}>
                          <FileDown className="h-3.5 w-3.5 mr-1" /> Download monthly report
                        </Button>
                      )}
                      {stmt && (
                        <Button size="sm" variant="outline" onClick={() => void downloadCoveringLetter(r.id)} disabled={busy === r.id}>
                          <FileDown className="h-3.5 w-3.5 mr-1" /> Covering letter
                        </Button>
                      )}
                      {!locked && (
                        <Button size="sm" onClick={() => { setCloseDialog(r.id); setCloseNotes(''); }} disabled={busy === r.id}>
                          <Lock className="h-3.5 w-3.5 mr-1" /> Close & issue report
                        </Button>
                      )}
                      {stmt?.status === 'finalized' && (
                        <Button size="sm" variant="secondary" onClick={() => openSettlementDialog(stmt.id)} disabled={busy === stmt.id}>
                          <Landmark className="h-3.5 w-3.5 mr-1" /> Record funding / apply credit
                        </Button>
                      )}
                      {locked && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Lock className="h-3.5 w-3.5" /> {stmt?.status === 'paid' ? `Settled${stmt.paid_at ? ` on ${new Date(stmt.paid_at).toLocaleDateString()}` : ''}` : 'Issued — settlement still required'}
                        </span>
                      )}
                    </div>

                    {/* Patient list */}
                    {pats.length === 0 ? (
                      <div className="text-center py-6 text-sm text-muted-foreground border rounded">
                        No patients under this retainer. Enroll them during registration.
                      </div>
                    ) : (
                      <div className="border rounded overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground">
                            <tr>
                              <th className="text-left px-3 py-2">Name</th>
                              <th className="text-left px-3 py-2">Card #</th>
                              <th className="text-center px-3 py-2">Visits</th>
                              <th className="text-right px-3 py-2">Medication</th>
                              <th className="text-right px-3 py-2">Lab Test</th>
                              <th className="text-right px-3 py-2">Delivery</th>
                              <th className="text-right px-3 py-2">Bed</th>
                              <th className="text-right px-3 py-2">Others</th>
                              <th className="text-right px-3 py-2">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pats.map(p => {
                              const invs = invoices[p.id] || [];
                              const sub = invs.reduce((s, i) => s + i.total_amount, 0);
                              const breakdown = serviceBreakdowns[p.id] || emptySponsorServiceBreakdown();
                              const vc = (visitCounts[r.id] || {})[p.id] || 0;
                              return (
                                <tr key={p.id} className="border-t">
                                  <td className="px-3 py-2">{p.first_name} {p.last_name || ''}<div className="text-[10px] text-muted-foreground font-mono">{invs.length ? invs.map(i => i.invoice_number).join(', ') : 'No invoice'}</div></td>
                                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{p.card_number || '—'}</td>
                                  <td className="px-3 py-2 text-center">{vc || <span className="text-muted-foreground">0</span>}</td>
                                  <td className="px-3 py-2 text-right">{money(breakdown.medication)}</td>
                                  <td className="px-3 py-2 text-right">{money(breakdown.lab_test)}</td>
                                  <td className="px-3 py-2 text-right">{money(breakdown.delivery)}</td>
                                  <td className="px-3 py-2 text-right">{money(breakdown.bed)}</td>
                                  <td className="px-3 py-2 text-right">{money(breakdown.others)}</td>
                                  <td className="px-3 py-2 text-right font-medium">{sub > 0 ? money(sub) : <span className="text-muted-foreground">0.00</span>}</td>
                                </tr>
                              );
                            })}
                            <tr className="border-t bg-muted/30 font-semibold">
                              <td className="px-3 py-2" colSpan={8}>Month total</td>
                              <td className="px-3 py-2 text-right">₦{money(monthTotal)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      {/* Close-month dialog */}
      <Dialog open={!!closeDialog} onOpenChange={o => !o && setCloseDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-primary" /> Close and issue {MONTHS[month - 1]} {year} report
            </DialogTitle>
            <DialogDescription>
              The system will lock this month’s services, issue the monthly report, and apply any Retainer credit already held. The report becomes <b>settled</b> if fully covered or <b>issued — settlement required</b> if a balance remains. New services are counted in the next month.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Notes (optional)</label>
            <Textarea
              value={closeNotes}
              onChange={e => setCloseNotes(e.target.value)}
              placeholder="e.g. Batch closed after retainer confirmation..."
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialog(null)}>Cancel</Button>
            <Button onClick={() => closeDialog && doClose(closeDialog)} disabled={busy === closeDialog}>
              {busy === closeDialog && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <ReceiptText className="h-4 w-4 mr-1.5" /> Close and issue report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!settlementDialog} onOpenChange={open => !open && setSettlementDialog(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Landmark className="h-5 w-5 text-primary" /> Record Retainer funding / apply credit
            </DialogTitle>
            <DialogDescription>
              Record what the company paid now, then the system applies available Retainer credit to this issued report. Enter <b>0.00</b> when no new money arrived and you only want to apply credit already held.
            </DialogDescription>
          </DialogHeader>

          {settlementStatement && (
            <div className="rounded-md border bg-muted/30 p-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Issued report</p>
                <p className="font-medium">{settlementStatement.statement_number}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Report total</p>
                <p className="font-medium">₦{money(settlementStatement.total_amount)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Available credit before settlement</p>
                <p className="font-medium text-success">₦{money(settlementRetainer?.balance || 0)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Selected period</p>
                <p className="font-medium">{MONTHS[settlementStatement.period_month - 1]} {settlementStatement.period_year}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Amount received now (₦)</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={settlementForm.amount_received}
                onChange={event => setSettlementForm(current => ({ ...current, amount_received: event.target.value }))}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Payment date</label>
              <Input
                type="date"
                value={settlementForm.payment_date}
                onChange={event => setSettlementForm(current => ({ ...current, payment_date: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Payment method</label>
              <Select value={settlementForm.payment_method} onValueChange={value => setSettlementForm(current => ({ ...current, payment_method: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Bank reference (optional)</label>
              <Input
                value={settlementForm.bank_reference}
                onChange={event => setSettlementForm(current => ({ ...current, bank_reference: event.target.value }))}
                placeholder="Transfer / receipt reference"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Notes (optional)</label>
            <Textarea
              value={settlementForm.notes}
              onChange={event => setSettlementForm(current => ({ ...current, notes: event.target.value }))}
              placeholder="Any company payment or settlement note..."
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSettlementDialog(null)}>Cancel</Button>
            <Button onClick={() => void settleStatement()} disabled={busy === settlementDialog}>
              {busy === settlementDialog && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Landmark className="h-4 w-4 mr-1.5" /> Record and apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}