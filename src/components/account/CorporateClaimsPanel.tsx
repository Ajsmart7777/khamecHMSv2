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
  Building2, CheckCircle2, FileDown, FileText, Landmark, Loader2, Lock,
  MapPin, Pencil, Phone, Plus, ReceiptText, RefreshCw, Trash2, Wand2,
} from 'lucide-react';
import { useCorporateAccounts } from '@/hooks/useCorporateAccounts';
import { useSponsorStatements } from '@/hooks/useSponsorStatements';
import { downloadStatementPdf } from '@/lib/sponsorStatementPdf';
import {
  CorporateCoveringLetterData,
  CorporateCoveringLetterInvoiceLine,
  CorporateCoveringLetterManualService,
  CorporateCoveringLetterPayment,
  CorporateCoveringLetterStatement,
  downloadCorporateCoveringLetter,
} from '@/lib/corporateCoveringLetterPdf';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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

interface ManualServiceRow {
  id: string;
  sponsor_id: string;
  patient_name: string;
  service_description: string;
  service_date: string;
  amount: number;
  notes: string | null;
}

interface ManualServiceForm {
  patient_name: string;
  service_description: string;
  service_date: string;
  amount: string;
  notes: string;
}

interface PaymentForm {
  amount: string;
  payment_date: string;
  payment_method: string;
  bank_reference: string;
  notes: string;
}

function money(value: number) {
  return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function isoDateToday() {
  return new Date().toISOString().slice(0, 10);
}

function statusVariant(status: string): 'default' | 'outline' | 'success' | 'warning' | 'destructive' {
  switch (status) {
    case 'paid': return 'success';
    case 'finalized':
    case 'printed': return 'warning';
    case 'draft': return 'outline';
    case 'void': return 'destructive';
    default: return 'default';
  }
}

function emptyManualForm(): ManualServiceForm {
  return { patient_name: '', service_description: '', service_date: isoDateToday(), amount: '', notes: '' };
}

function emptyPaymentForm(): PaymentForm {
  return { amount: '', payment_date: isoDateToday(), payment_method: 'bank_transfer', bank_reference: '', notes: '' };
}

export function CorporateClaimsPanel() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [patients, setPatients] = useState<Record<string, PatientRow[]>>({});
  const [invoices, setInvoices] = useState<Record<string, InvoiceRow[]>>({});
  const [visitCounts, setVisitCounts] = useState<Record<string, Record<string, number>>>({});
  const [manualRows, setManualRows] = useState<Record<string, ManualServiceRow[]>>({});
  const [paymentTotals, setPaymentTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [closeDialog, setCloseDialog] = useState<string | null>(null);
  const [closeNotes, setCloseNotes] = useState('');
  const [manualDialog, setManualDialog] = useState<string | null>(null);
  const [editingManual, setEditingManual] = useState<ManualServiceRow | null>(null);
  const [manualForm, setManualForm] = useState<ManualServiceForm>(emptyManualForm());
  const [paymentDialog, setPaymentDialog] = useState<string | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentForm>(emptyPaymentForm());

  const { accounts } = useCorporateAccounts('corporate');
  const { statements, fetchStatements } = useSponsorStatements('corporate');

  const periodStart = useMemo(() => new Date(year, month - 1, 1), [year, month]);
  const periodEnd = useMemo(() => new Date(year, month, 1), [year, month]);
  const activeCorps = useMemo(() => accounts.filter(account => account.status === 'active'), [accounts]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: pats, error: patientsError } = await supabase
        .from('patients')
        .select('id, first_name, last_name, card_number, corporate_id')
        .eq('account_type', 'corporate');
      if (patientsError) throw patientsError;

      const byCorp: Record<string, PatientRow[]> = {};
      (pats || []).forEach(patient => {
        if (patient.corporate_id) {
          (byCorp[patient.corporate_id] ||= []).push({
            id: patient.id,
            first_name: patient.first_name,
            last_name: patient.last_name,
            card_number: patient.card_number,
          });
        }
      });
      setPatients(byCorp);

      const patientIds = (pats || []).map(patient => patient.id);
      if (patientIds.length === 0) {
        setInvoices({});
        setVisitCounts({});
      } else {
        const [{ data: invs, error: invoicesError }, { data: visits, error: visitsError }] = await Promise.all([
          supabase
            .from('invoices')
            .select('id, invoice_number, patient_id, total_amount, visit_id, created_at')
            .in('patient_id', patientIds)
            .gte('created_at', periodStart.toISOString())
            .lt('created_at', periodEnd.toISOString()),
          supabase
            .from('visits')
            .select('id, patient_id, corporate_id, opened_at')
            .in('patient_id', patientIds)
            .gte('opened_at', periodStart.toISOString())
            .lt('opened_at', periodEnd.toISOString()),
        ]);
        if (invoicesError) throw invoicesError;
        if (visitsError) throw visitsError;

        const byPatient: Record<string, InvoiceRow[]> = {};
        (invs || []).forEach(invoice => {
          (byPatient[invoice.patient_id] ||= []).push({ ...invoice, total_amount: Number(invoice.total_amount) || 0 });
        });
        setInvoices(byPatient);

        const bySponsorVisitCount: Record<string, Record<string, number>> = {};
        (visits || []).forEach(visit => {
          if (visit.corporate_id) {
            bySponsorVisitCount[visit.corporate_id] ||= {};
            bySponsorVisitCount[visit.corporate_id][visit.patient_id] = (bySponsorVisitCount[visit.corporate_id][visit.patient_id] || 0) + 1;
          }
        });
        setVisitCounts(bySponsorVisitCount);
      }

      const [{ data: manualData, error: manualError }, { data: paymentData, error: paymentError }] = await Promise.all([
        supabase
          .from('corporate_manual_service_rows')
          .select('id, sponsor_id, patient_name, service_description, service_date, amount, notes')
          .eq('period_year', year)
          .eq('period_month', month)
          .order('service_date', { ascending: true }),
        supabase
          .from('corporate_statement_payments')
          .select('statement_id, amount'),
      ]);
      if (manualError) throw manualError;
      if (paymentError) throw paymentError;

      const manualBySponsor: Record<string, ManualServiceRow[]> = {};
      (manualData || []).forEach(row => {
        (manualBySponsor[row.sponsor_id] ||= []).push({ ...row, amount: Number(row.amount) || 0 });
      });
      setManualRows(manualBySponsor);

      const paidByStatement: Record<string, number> = {};
      (paymentData || []).forEach(payment => {
        paidByStatement[payment.statement_id] = (paidByStatement[payment.statement_id] || 0) + Number(payment.amount || 0);
      });
      setPaymentTotals(paidByStatement);
      await fetchStatements();
    } catch (error) {
      toast({ title: 'Could not load corporate claims', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [fetchStatements, month, periodEnd, periodStart, year]);

  useEffect(() => { void load(); }, [load]);

  const years = useMemo(() => {
    const currentYear = now.getFullYear();
    return [currentYear - 2, currentYear - 1, currentYear, currentYear + 1];
    // The selector should remain stable throughout the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statementBySponsor = useMemo(() => {
    const map: Record<string, typeof statements[number]> = {};
    statements.forEach(statement => {
      if (statement.period_year === year && statement.period_month === month) map[statement.sponsor_id] = statement;
    });
    return map;
  }, [month, statements, year]);

  const overallTotals = useMemo(() => {
    let billed = 0;
    let outstanding = 0;
    let received = 0;
    activeCorps.forEach(corporate => {
      const patientTotal = (patients[corporate.id] || []).reduce((sum, patient) => {
        return sum + (invoices[patient.id] || []).reduce((invoiceSum, invoice) => invoiceSum + invoice.total_amount, 0);
      }, 0);
      const manualTotal = (manualRows[corporate.id] || []).reduce((sum, row) => sum + row.amount, 0);
      const statement = statementBySponsor[corporate.id];
      billed += statement ? Number(statement.total_amount) : patientTotal + manualTotal;
      if (statement) {
        const paid = paymentTotals[statement.id] || 0;
        received += paid;
        outstanding += Math.max(Number(statement.total_amount) - paid, 0);
      }
    });
    return { billed, outstanding, received };
  }, [activeCorps, invoices, manualRows, patients, paymentTotals, statementBySponsor]);

  const handleGenerate = async (sponsorId: string) => {
    setBusy(sponsorId);
    try {
      const { error } = await supabase.rpc('generate_sponsor_statement', { _sponsor_id: sponsorId, _year: year, _month: month });
      if (error) throw error;
      toast({ title: 'Statement generated', description: 'Registered invoices and walk-in paper services are now included.' });
      await load();
    } catch (error) {
      toast({ title: 'Generate failed', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const doClose = async (sponsorId: string) => {
    setBusy(sponsorId);
    try {
      const statement = statementBySponsor[sponsorId];
      let statementId = statement?.id;
      if (!statementId || statement?.status === 'draft') {
        const { data, error } = await supabase.rpc('generate_sponsor_statement', { _sponsor_id: sponsorId, _year: year, _month: month });
        if (error) throw error;
        statementId = data as string;
      }
      if (!statementId) throw new Error('The monthly statement could not be created.');

      const update: Record<string, unknown> = { status: 'finalized', finalized_at: new Date().toISOString() };
      if (closeNotes.trim()) update.notes = closeNotes.trim();
      const { error } = await supabase.from('sponsor_statements').update(update).eq('id', statementId);
      if (error) throw error;

      toast({ title: 'Month closed', description: 'The statement is finalized. Record each payment received instead of marking the claim paid manually.' });
      setCloseDialog(null);
      setCloseNotes('');
      await load();
    } catch (error) {
      toast({ title: 'Close failed', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const openManualDialog = (sponsorId: string, row?: ManualServiceRow) => {
    setManualDialog(sponsorId);
    setEditingManual(row || null);
    setManualForm(row
      ? { patient_name: row.patient_name, service_description: row.service_description, service_date: row.service_date, amount: String(row.amount), notes: row.notes || '' }
      : emptyManualForm());
  };

  const saveManualService = async () => {
    if (!manualDialog) return;
    const amount = Number(manualForm.amount);
    if (!manualForm.patient_name.trim() || !manualForm.service_description.trim() || !manualForm.service_date || !Number.isFinite(amount) || amount <= 0) {
      toast({ title: 'Complete the walk-in service fields', description: 'Patient name, service, date, and a positive amount are required.', variant: 'destructive' });
      return;
    }

    setBusy(manualDialog);
    try {
      const payload = {
        sponsor_id: manualDialog,
        period_year: year,
        period_month: month,
        patient_name: manualForm.patient_name.trim(),
        service_description: manualForm.service_description.trim(),
        service_date: manualForm.service_date,
        amount,
        notes: manualForm.notes.trim() || null,
      };
      const request = editingManual
        ? supabase.from('corporate_manual_service_rows').update(payload).eq('id', editingManual.id)
        : supabase.from('corporate_manual_service_rows').insert(payload);
      const { error } = await request;
      if (error) throw error;
      toast({ title: editingManual ? 'Walk-in service updated' : 'Walk-in service added', description: 'Generate or regenerate the draft statement to include the revised total.' });
      setManualDialog(null);
      setEditingManual(null);
      await load();
    } catch (error) {
      toast({ title: 'Could not save walk-in service', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const deleteManualService = async (row: ManualServiceRow) => {
    if (!window.confirm(`Remove the walk-in service for ${row.patient_name}?`)) return;
    setBusy(row.id);
    try {
      const { error } = await supabase.from('corporate_manual_service_rows').delete().eq('id', row.id);
      if (error) throw error;
      toast({ title: 'Walk-in service removed', description: 'Regenerate the draft statement to update its total.' });
      await load();
    } catch (error) {
      toast({ title: 'Could not remove walk-in service', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const openPaymentDialog = (statementId: string) => {
    setPaymentDialog(statementId);
    setPaymentForm(emptyPaymentForm());
  };

  const recordPayment = async () => {
    if (!paymentDialog) return;
    const amount = Number(paymentForm.amount);
    if (!paymentForm.payment_date || !Number.isFinite(amount) || amount <= 0) {
      toast({ title: 'Enter a valid payment', description: 'A positive amount and payment date are required.', variant: 'destructive' });
      return;
    }
    setBusy(paymentDialog);
    try {
      const { data, error } = await supabase.rpc('record_corporate_statement_payment', {
        _statement_id: paymentDialog,
        _payment_date: paymentForm.payment_date,
        _amount: amount,
        _payment_method: paymentForm.payment_method,
        _bank_reference: paymentForm.bank_reference.trim() || null,
        _notes: paymentForm.notes.trim() || null,
      });
      if (error) throw error;
      const result = data as { balance?: number; credit?: number; status?: string } | null;
      const balance = Number(result?.balance || 0);
      const credit = Number(result?.credit || 0);
      toast({
        title: result?.status === 'paid' ? 'Payment recorded — statement settled' : 'Partial payment recorded',
        description: credit > 0 ? `An overpayment credit of ₦${money(credit)} is shown in the covering letter.` : balance > 0 ? `₦${money(balance)} remains on this statement.` : undefined,
      });
      setPaymentDialog(null);
      await load();
    } catch (error) {
      toast({ title: 'Could not record payment', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const downloadMonthlyReport = async (statement: typeof statements[number]) => {
    setBusy(statement.id);
    try {
      await downloadStatementPdf(statement);
      toast({ title: 'Monthly report downloaded', description: statement.statement_number });
    } catch (error) {
      toast({ title: 'Monthly report failed', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const downloadCoveringLetter = async (sponsorId: string) => {
    const statement = statementBySponsor[sponsorId];
    if (!statement) {
      toast({ title: 'Generate the monthly statement first', description: 'The covering letter requires a statement for the selected month.', variant: 'destructive' });
      return;
    }
    setBusy(sponsorId);
    try {
      const [{ data: reconciliation, error: reconciliationError }, { data: invoiceItems, error: itemsError }] = await Promise.all([
        supabase.rpc('get_corporate_covering_letter_data', { _sponsor_id: sponsorId, _as_of_year: year, _as_of_month: month }),
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
        payment_history: CorporateCoveringLetterPayment[];
        current_manual_services: CorporateCoveringLetterManualService[];
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
          patient_name: `${row.patient?.first_name || ''} ${row.patient?.last_name || ''}`.trim() || 'Registered patient',
          card_number: row.patient?.card_number,
          invoice_number: row.invoice?.invoice_number,
        };
      });

      await downloadCorporateCoveringLetter({
        reference: `COV-${year}${String(month).padStart(2, '0')}-${statement.statement_number}`,
        generated_at: new Date().toISOString(),
        as_of_year: year,
        as_of_month: month,
        sponsor: raw.sponsor,
        statements: (raw.statements || []).map(row => ({ ...row, total_amount: Number(row.total_amount), paid_amount: Number(row.paid_amount), balance: Number(row.balance) })),
        payments: (raw.payment_history || []).map(row => ({ ...row, amount: Number(row.amount) })),
        current_invoice_items: currentInvoiceItems,
        current_manual_services: (raw.current_manual_services || []).map(row => ({ ...row, amount: Number(row.amount) })),
        summary: {
          total_billed: Number(raw.summary?.total_billed || 0),
          total_paid: Number(raw.summary?.total_paid || 0),
          net_balance_due: Number(raw.summary?.net_balance_due || 0),
          credit_amount: Number(raw.summary?.credit_amount || 0),
        },
      });
      toast({ title: 'Covering letter downloaded' });
    } catch (error) {
      toast({ title: 'Covering letter failed', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const manualDialogCorporate = manualDialog ? accounts.find(account => account.id === manualDialog) : null;
  const paymentStatement = paymentDialog ? statements.find(statement => statement.id === paymentDialog) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Corporate Month-End Claims</h3>
          <Badge variant="outline">{activeCorps.length} corporate(s)</Badge>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={String(month)} onValueChange={value => setMonth(Number(value))}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>{MONTHS.map((name, index) => <SelectItem key={name} value={String(index + 1)}>{name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={value => setYear(Number(value))}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>{years.map(option => <SelectItem key={option} value={String(option)}>{option}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Follow one monthly sequence for every Corporate account: <b>1. Review registered services</b>, <b>2. Add walk-in paper slips</b>, <b>3. Prepare report</b>, <b>4. Close and issue report</b>, then <b>5. Record company payment</b>. Once issued, later services are counted in the next month. Use the covering letter only when unpaid months, partial payments, or credit need reconciliation.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border p-3 bg-card"><p className="text-xs text-muted-foreground">Billed this month</p><p className="text-lg font-semibold mt-1">₦{money(overallTotals.billed)}</p></div>
        <div className="rounded-lg border p-3 bg-warning/5 border-warning/30"><p className="text-xs text-muted-foreground">Outstanding (selected month)</p><p className="text-lg font-semibold mt-1 text-warning">₦{money(overallTotals.outstanding)}</p></div>
        <div className="rounded-lg border p-3 bg-success/5 border-success/30"><p className="text-xs text-muted-foreground">Payments received</p><p className="text-lg font-semibold mt-1 text-success">₦{money(overallTotals.received)}</p></div>
      </div>

      {loading ? (
        <div className="text-center py-10"><Loader2 className="h-5 w-5 mx-auto animate-spin" /></div>
      ) : activeCorps.length === 0 ? (
        <div className="text-center py-10 border rounded-lg text-muted-foreground text-sm">No corporates registered. Go to the “Corporate” tab to create one.</div>
      ) : (
        <Accordion type="multiple" className="space-y-2">
          {activeCorps.map(corporate => {
            const sponsorPatients = patients[corporate.id] || [];
            const manual = manualRows[corporate.id] || [];
            const registeredTotal = sponsorPatients.reduce((sum, patient) => sum + (invoices[patient.id] || []).reduce((invoiceSum, invoice) => invoiceSum + invoice.total_amount, 0), 0);
            const manualTotal = manual.reduce((sum, row) => sum + row.amount, 0);
            const statement = statementBySponsor[corporate.id];
            const shownTotal = statement ? Number(statement.total_amount) : registeredTotal + manualTotal;
            const paid = statement ? paymentTotals[statement.id] || 0 : 0;
            const balance = Math.max(shownTotal - paid, 0);
            const locked = ['finalized', 'printed', 'paid'].includes(statement?.status || '');
            const isPaid = statement?.status === 'paid';

            return (
              <AccordionItem key={corporate.id} value={corporate.id} className="border rounded-lg bg-card px-0 overflow-hidden">
                <AccordionTrigger className="hover:no-underline px-4 py-3">
                  <div className="flex flex-1 items-center justify-between gap-3 pr-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0"><Building2 className="h-4 w-4" /></div>
                      <div className="min-w-0 text-left">
                        <p className="font-semibold text-sm truncate">{corporate.company_name}</p>
                        <div className="flex gap-3 text-[11px] text-muted-foreground">
                          {corporate.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{corporate.phone}</span>}
                          {corporate.address && <span className="flex items-center gap-1 truncate"><MapPin className="h-3 w-3" />{corporate.address}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Walk-ins</p><p className="text-sm font-semibold">{manual.length}</p></div>
                      <div className="text-right"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">This month</p><p className="text-sm font-semibold">₦{money(shownTotal)}</p></div>
                      {statement && <Badge variant={statusVariant(statement.status)} className="uppercase text-[10px]">{statement.status}</Badge>}
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 pt-0">
                  <div className="border-t pt-3 space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {!locked && <Button size="sm" variant="outline" onClick={() => openManualDialog(corporate.id)} disabled={busy === corporate.id}><Plus className="h-3.5 w-3.5 mr-1" /> Add walk-in paper slip</Button>}
                      {!locked && <Button size="sm" variant="outline" onClick={() => void handleGenerate(corporate.id)} disabled={busy === corporate.id}><Wand2 className="h-3.5 w-3.5 mr-1" /> {statement ? 'Refresh draft report' : 'Prepare monthly report'}</Button>}
                      {statement && <Button size="sm" variant="outline" onClick={() => void downloadMonthlyReport(statement)} disabled={busy === statement.id}><FileDown className="h-3.5 w-3.5 mr-1" /> Download monthly report</Button>}
                      {!locked && <Button size="sm" onClick={() => { setCloseDialog(corporate.id); setCloseNotes(''); }} disabled={busy === corporate.id}><Lock className="h-3.5 w-3.5 mr-1" /> Close & issue report</Button>}
                      {statement && ['finalized', 'printed'].includes(statement.status) && <Button size="sm" variant="secondary" onClick={() => openPaymentDialog(statement.id)} disabled={busy === statement.id}><Landmark className="h-3.5 w-3.5 mr-1" /> Record payment</Button>}
                      {statement && <Button size="sm" variant="outline" onClick={() => void downloadCoveringLetter(corporate.id)} disabled={busy === corporate.id}><FileText className="h-3.5 w-3.5 mr-1" /> Covering letter</Button>}
                      {statement && <span className={`text-xs flex items-center gap-1 ${balance > 0 ? 'text-warning' : 'text-success'}`}><CheckCircle2 className="h-3.5 w-3.5" /> {balance > 0 ? `Issued report balance: ₦${money(balance)}` : isPaid ? 'Report settled' : 'No balance due'}</span>}
                    </div>

                    <div className="border rounded overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground"><tr><th className="text-left px-3 py-2">Registered patient</th><th className="text-left px-3 py-2">Card #</th><th className="text-center px-3 py-2">Visits</th><th className="text-left px-3 py-2">Invoices</th><th className="text-right px-3 py-2">Amount (₦)</th></tr></thead>
                        <tbody>
                          {sponsorPatients.length === 0 ? <tr><td className="px-3 py-4 text-center text-muted-foreground" colSpan={5}>No registered patients under this corporate.</td></tr> : sponsorPatients.map(patient => {
                            const patientInvoices = invoices[patient.id] || [];
                            const subtotal = patientInvoices.reduce((sum, invoice) => sum + invoice.total_amount, 0);
                            return <tr key={patient.id} className="border-t"><td className="px-3 py-2">{patient.first_name} {patient.last_name || ''}</td><td className="px-3 py-2 font-mono text-xs text-muted-foreground">{patient.card_number || '—'}</td><td className="px-3 py-2 text-center">{(visitCounts[corporate.id] || {})[patient.id] || <span className="text-muted-foreground">0</span>}</td><td className="px-3 py-2 text-xs font-mono text-muted-foreground">{patientInvoices.length ? patientInvoices.map(invoice => invoice.invoice_number).join(', ') : '—'}</td><td className="px-3 py-2 text-right font-medium">{money(subtotal)}</td></tr>;
                          })}
                          <tr className="border-t bg-muted/30 font-semibold"><td className="px-3 py-2" colSpan={4}>Registered-patient services</td><td className="px-3 py-2 text-right">₦{money(registeredTotal)}</td></tr>
                        </tbody>
                      </table>
                    </div>

                    <div className="border rounded overflow-x-auto">
                      <div className="flex items-center justify-between gap-3 border-b px-3 py-2 bg-muted/30"><div><p className="text-sm font-medium">Walk-in paper services</p><p className="text-xs text-muted-foreground">Non-registered company patients received from pharmacy or laboratory slips.</p></div>{!locked && <Button size="sm" variant="ghost" onClick={() => openManualDialog(corporate.id)}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>}</div>
                      <table className="w-full text-sm"><thead className="bg-muted/50 text-xs uppercase text-muted-foreground"><tr><th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Patient / recipient</th><th className="text-left px-3 py-2">Service</th><th className="text-right px-3 py-2">Amount (₦)</th><th className="w-20 px-3 py-2"></th></tr></thead><tbody>
                        {manual.length === 0 ? <tr><td className="px-3 py-4 text-center text-muted-foreground" colSpan={5}>No walk-in paper services entered for this month.</td></tr> : manual.map(row => <tr key={row.id} className="border-t"><td className="px-3 py-2 whitespace-nowrap">{new Date(`${row.service_date}T12:00:00`).toLocaleDateString()}</td><td className="px-3 py-2">{row.patient_name}{row.notes && <p className="text-xs text-muted-foreground mt-0.5">{row.notes}</p>}</td><td className="px-3 py-2">{row.service_description}</td><td className="px-3 py-2 text-right font-medium">{money(row.amount)}</td><td className="px-3 py-2 text-right">{!locked && <div className="inline-flex gap-1"><Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openManualDialog(corporate.id, row)}><Pencil className="h-3.5 w-3.5" /></Button><Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => void deleteManualService(row)} disabled={busy === row.id}><Trash2 className="h-3.5 w-3.5" /></Button></div>}</td></tr>)}
                        <tr className="border-t bg-muted/30 font-semibold"><td className="px-3 py-2" colSpan={3}>Walk-in services total</td><td className="px-3 py-2 text-right">₦{money(manualTotal)}</td><td /></tr>
                      </tbody></table>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      <Dialog open={!!closeDialog} onOpenChange={open => !open && setCloseDialog(null)}>
        <DialogContent><DialogHeader><DialogTitle className="flex items-center gap-2"><Lock className="h-5 w-5 text-primary" /> Close and issue {MONTHS[month - 1]} {year} report</DialogTitle><DialogDescription>The system totals registered services and walk-in paper slips, then locks and issues the monthly report. Record actual company payments afterwards; partial payments and overpayments remain visible for reconciliation.</DialogDescription></DialogHeader><div className="space-y-2"><label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Notes (optional)</label><Textarea value={closeNotes} onChange={event => setCloseNotes(event.target.value)} placeholder="E.g. monthly report sent by email on…" rows={2} /></div><DialogFooter><Button variant="outline" onClick={() => setCloseDialog(null)}>Cancel</Button><Button onClick={() => closeDialog && void doClose(closeDialog)} disabled={busy === closeDialog}>{busy === closeDialog && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}<ReceiptText className="h-4 w-4 mr-1.5" /> Close and issue report</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={!!manualDialog} onOpenChange={open => !open && setManualDialog(null)}>
        <DialogContent><DialogHeader><DialogTitle>{editingManual ? 'Edit walk-in service' : 'Add walk-in service'}</DialogTitle><DialogDescription>{manualDialogCorporate?.company_name || 'Corporate account'} · {MONTHS[month - 1]} {year}. Enter the paper prescription or laboratory request exactly as received.</DialogDescription></DialogHeader><div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div className="sm:col-span-2 space-y-1.5"><label className="text-sm font-medium">Patient / recipient name</label><Input value={manualForm.patient_name} onChange={event => setManualForm(form => ({ ...form, patient_name: event.target.value }))} placeholder="Name on the company paper slip" /></div><div className="sm:col-span-2 space-y-1.5"><label className="text-sm font-medium">Service description</label><Input value={manualForm.service_description} onChange={event => setManualForm(form => ({ ...form, service_description: event.target.value }))} placeholder="E.g. malaria test, prescription medicines" /></div><div className="space-y-1.5"><label className="text-sm font-medium">Service date</label><Input type="date" value={manualForm.service_date} onChange={event => setManualForm(form => ({ ...form, service_date: event.target.value }))} /></div><div className="space-y-1.5"><label className="text-sm font-medium">Amount (₦)</label><Input type="number" min="0" step="0.01" value={manualForm.amount} onChange={event => setManualForm(form => ({ ...form, amount: event.target.value }))} placeholder="0.00" /></div><div className="sm:col-span-2 space-y-1.5"><label className="text-sm font-medium">Paper-slip note (optional)</label><Textarea value={manualForm.notes} onChange={event => setManualForm(form => ({ ...form, notes: event.target.value }))} placeholder="E.g. Pharmacy slip retained; company stamp visible" rows={2} /></div></div><DialogFooter><Button variant="outline" onClick={() => setManualDialog(null)}>Cancel</Button><Button onClick={() => void saveManualService()} disabled={busy === manualDialog}>{busy === manualDialog && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{editingManual ? 'Save changes' : 'Add service'}</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={!!paymentDialog} onOpenChange={open => !open && setPaymentDialog(null)}>
        <DialogContent><DialogHeader><DialogTitle className="flex items-center gap-2"><Landmark className="h-5 w-5 text-primary" /> Record corporate payment</DialogTitle><DialogDescription>{paymentStatement?.statement_number || 'Statement'} · Record the actual payment received. Partial payments and amounts exceeding the statement are preserved for the covering letter.</DialogDescription></DialogHeader><div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div className="space-y-1.5"><label className="text-sm font-medium">Amount received (₦)</label><Input type="number" min="0" step="0.01" value={paymentForm.amount} onChange={event => setPaymentForm(form => ({ ...form, amount: event.target.value }))} placeholder="0.00" /></div><div className="space-y-1.5"><label className="text-sm font-medium">Payment date</label><Input type="date" value={paymentForm.payment_date} onChange={event => setPaymentForm(form => ({ ...form, payment_date: event.target.value }))} /></div><div className="space-y-1.5"><label className="text-sm font-medium">Payment method</label><Select value={paymentForm.payment_method} onValueChange={value => setPaymentForm(form => ({ ...form, payment_method: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bank_transfer">Bank transfer</SelectItem><SelectItem value="cash">Cash</SelectItem><SelectItem value="cheque">Cheque</SelectItem><SelectItem value="pos">POS</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div><div className="space-y-1.5"><label className="text-sm font-medium">Bank/reference no. (optional)</label><Input value={paymentForm.bank_reference} onChange={event => setPaymentForm(form => ({ ...form, bank_reference: event.target.value }))} placeholder="Transfer reference or cheque no." /></div><div className="sm:col-span-2 space-y-1.5"><label className="text-sm font-medium">Notes (optional)</label><Textarea value={paymentForm.notes} onChange={event => setPaymentForm(form => ({ ...form, notes: event.target.value }))} rows={2} placeholder="Any reconciliation or supporting note" /></div></div><DialogFooter><Button variant="outline" onClick={() => setPaymentDialog(null)}>Cancel</Button><Button onClick={() => void recordPayment()} disabled={busy === paymentDialog}>{busy === paymentDialog && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Record payment</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  );
}
