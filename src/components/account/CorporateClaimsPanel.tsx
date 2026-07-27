import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Building2, FileDown, Loader2, Lock, RefreshCw, ReceiptText,
  Wand2, Phone, MapPin, CheckCircle2,
} from 'lucide-react';
import { useCorporateAccounts } from '@/hooks/useCorporateAccounts';
import { useSponsorStatements } from '@/hooks/useSponsorStatements';
import { downloadRetainerLetter, RetainerLetterPatientRow } from '@/lib/retainerLetterPdf';

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

export function CorporateClaimsPanel() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [patients, setPatients] = useState<Record<string, PatientRow[]>>({});
  const [invoices, setInvoices] = useState<Record<string, InvoiceRow[]>>({});
  const [visitCounts, setVisitCounts] = useState<Record<string, Record<string, number>>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [closeDialog, setCloseDialog] = useState<string | null>(null);
  const [closeNotes, setCloseNotes] = useState('');

  const { accounts } = useCorporateAccounts('corporate');
  const { statements, fetchStatements, updateStatus } = useSponsorStatements('corporate');

  const periodStart = useMemo(() => new Date(year, month - 1, 1), [year, month]);
  const periodEnd = useMemo(() => new Date(year, month, 1), [year, month]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: pats } = await supabase
        .from('patients')
        .select('id, first_name, last_name, card_number, corporate_id')
        .eq('account_type', 'corporate');
      const byCorp: Record<string, PatientRow[]> = {};
      (pats || []).forEach(p => {
        if (p.corporate_id) {
          (byCorp[p.corporate_id] ||= []).push({
            id: p.id, first_name: p.first_name,
            last_name: p.last_name, card_number: p.card_number,
          });
        }
      });
      setPatients(byCorp);

      const patientIds = (pats || []).map(p => p.id);
      if (patientIds.length === 0) {
        setInvoices({}); setVisitCounts({});
      } else {
        const { data: invs } = await supabase
          .from('invoices')
          .select('id, invoice_number, patient_id, total_amount, visit_id, created_at')
          .in('patient_id', patientIds)
          .gte('created_at', periodStart.toISOString())
          .lt('created_at', periodEnd.toISOString());
        const byPatient: Record<string, InvoiceRow[]> = {};
        (invs || []).forEach(i => {
          (byPatient[i.patient_id] ||= []).push({
            ...i, total_amount: Number(i.total_amount) || 0,
          });
        });
        setInvoices(byPatient);

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

  const statementBySponsor = useMemo(() => {
    const map: Record<string, typeof statements[number]> = {};
    statements.forEach(s => {
      if (s.period_year === year && s.period_month === month) map[s.sponsor_id] = s;
    });
    return map;
  }, [statements, year, month]);

  const activeCorps = accounts.filter(a => a.status === 'active');

  const overallTotals = useMemo(() => {
    let billed = 0; let outstanding = 0; let paid = 0;
    activeCorps.forEach(r => {
      const pats = patients[r.id] || [];
      const monthTotal = pats.reduce((sum, p) => {
        const inv = invoices[p.id] || [];
        return sum + inv.reduce((s, i) => s + i.total_amount, 0);
      }, 0);
      billed += monthTotal;
      const stmt = statementBySponsor[r.id];
      if (stmt?.status === 'finalized') outstanding += Number(stmt.total_amount);
      if (stmt?.status === 'paid') paid += Number(stmt.total_amount);
    });
    return { billed, outstanding, paid };
  }, [activeCorps, patients, invoices, statementBySponsor]);

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
      // Ensure statement exists, then finalize + lock the month.
      const stmt = statementBySponsor[sponsorId];
      let stmtId = stmt?.id;
      if (!stmtId || stmt?.status === 'draft') {
        const { data, error } = await supabase.rpc('generate_sponsor_statement', {
          _sponsor_id: sponsorId, _year: year, _month: month,
        });
        if (error) throw error;
        stmtId = data as string;
      }
      if (!stmtId) throw new Error('No statement id');
      const patch: Record<string, unknown> = {
        status: 'finalized',
        finalized_at: new Date().toISOString(),
      };
      if (closeNotes) patch.notes = closeNotes;
      const { error: uerr } = await supabase.from('sponsor_statements').update(patch).eq('id', stmtId);
      if (uerr) throw uerr;
      toast({ title: 'Month closed', description: 'Statement finalized — send demand letter to the company.' });
      setCloseDialog(null);
      setCloseNotes('');
      await Promise.all([fetchStatements(), load()]);
    } catch (e) {
      toast({ title: 'Close failed', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  };

  const markPaid = async (statementId: string) => {
    setBusy(statementId);
    try {
      await updateStatus(statementId, 'paid');
      await load();
    } finally { setBusy(null); }
  };

  const downloadLetter = async (sponsorId: string) => {
    const corp = accounts.find(a => a.id === sponsorId);
    const stmt = statementBySponsor[sponsorId];
    if (!corp) return;
    setBusy(sponsorId);
    try {
      const pats = patients[sponsorId] || [];
      const rows: RetainerLetterPatientRow[] = pats.map(p => {
        const invs = invoices[p.id] || [];
        const subtotal = invs.reduce((s, i) => s + i.total_amount, 0);
        return {
          patient_id: p.id,
          patient_name: `${p.first_name} ${p.last_name || ''}`.trim(),
          card_number: p.card_number,
          visits: (visitCounts[sponsorId] || {})[p.id] || 0,
          invoices: invs.map(i => ({
            invoice_number: i.invoice_number, amount: i.total_amount,
            service_date: i.created_at,
          })),
          subtotal,
        };
      });
      const total = rows.reduce((s, r) => s + r.subtotal, 0);
      const mode: 'receipt' | 'demand' = stmt?.status === 'paid' ? 'receipt' : 'demand';
      await downloadRetainerLetter({
        statement_number: stmt?.statement_number || `PREVIEW-${year}${String(month).padStart(2,'0')}`,
        retainer: {
          company_name: corp.company_name,
          phone: corp.phone,
          address: corp.address,
          contact_person: corp.contact_person,
          email: corp.email,
        },
        period_year: year,
        period_month: month,
        period_start: periodStart.toISOString(),
        period_end: new Date(periodEnd.getTime() - 1).toISOString(),
        total_amount: total,
        deposit_applied: 0,
        balance_outstanding: mode === 'receipt' ? 0 : total,
        balance_after: 0,
        patients: rows,
        mode,
        sponsor_kind: 'corporate',
        generated_at: new Date().toISOString(),
      });
      toast({ title: 'Letter downloaded' });
    } catch (e) {
      toast({ title: 'Letter failed', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Corporate Claims — monthly view</h3>
          <Badge variant="outline">{activeCorps.length} corporate(s)</Badge>
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
        All patients registered under each corporate appear here, even if they did not visit this month.
        Corporates have no deposit — after closing the month, the system generates a demand letter to send to the company for payment. After payment, click "Mark paid".
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border p-3 bg-card">
          <p className="text-xs text-muted-foreground">Billed this month</p>
          <p className="text-lg font-semibold mt-1">₦{money(overallTotals.billed)}</p>
        </div>
        <div className="rounded-lg border p-3 bg-warning/5 border-warning/30">
          <p className="text-xs text-muted-foreground">Outstanding (finalized)</p>
          <p className="text-lg font-semibold mt-1 text-warning">₦{money(overallTotals.outstanding)}</p>
        </div>
        <div className="rounded-lg border p-3 bg-success/5 border-success/30">
          <p className="text-xs text-muted-foreground">Paid</p>
          <p className="text-lg font-semibold mt-1 text-success">₦{money(overallTotals.paid)}</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-10"><Loader2 className="h-5 w-5 mx-auto animate-spin" /></div>
      ) : activeCorps.length === 0 ? (
        <div className="text-center py-10 border rounded-lg text-muted-foreground text-sm">
          Babu corporate da aka rijista. Je "Corporate" tab don ƙirƙira.
        </div>
      ) : (
        <Accordion type="multiple" className="space-y-2">
          {activeCorps.map(r => {
            const pats = patients[r.id] || [];
            const monthTotal = pats.reduce((sum, p) => {
              const inv = invoices[p.id] || [];
              return sum + inv.reduce((s, i) => s + i.total_amount, 0);
            }, 0);
            const stmt = statementBySponsor[r.id];
            const locked = stmt?.status === 'paid' || stmt?.status === 'finalized';
            const isPaid = stmt?.status === 'paid';

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
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">This month</p>
                        <p className="text-sm font-semibold">₦{money(monthTotal)}</p>
                      </div>
                      {stmt && <Badge variant={statusVariant(stmt.status)} className="uppercase text-[10px]">{stmt.status}</Badge>}
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 pt-0">
                  <div className="border-t pt-3 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {!locked && (
                        <Button size="sm" variant="outline" onClick={() => handleGenerate(r.id)} disabled={busy === r.id}>
                          <Wand2 className="h-3.5 w-3.5 mr-1" /> {stmt ? 'Regenerate statement' : 'Generate statement'}
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => downloadLetter(r.id)} disabled={busy === r.id}>
                        {busy === r.id ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <FileDown className="h-3.5 w-3.5 mr-1" />}
                        {isPaid ? 'Download receipt letter' : 'Download demand letter'}
                      </Button>
                      {!locked && (
                        <Button size="sm" onClick={() => { setCloseDialog(r.id); setCloseNotes(''); }} disabled={busy === r.id}>
                          <Lock className="h-3.5 w-3.5 mr-1" /> Close month & send invoice
                        </Button>
                      )}
                      {stmt?.status === 'finalized' && (
                        <Button size="sm" variant="secondary" onClick={() => markPaid(stmt.id)} disabled={busy === stmt.id}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark paid
                        </Button>
                      )}
                      {isPaid && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Paid on {stmt?.paid_at ? new Date(stmt.paid_at).toLocaleDateString() : ''}
                        </span>
                      )}
                    </div>

                    {pats.length === 0 ? (
                      <div className="text-center py-6 text-sm text-muted-foreground border rounded">
                        No patients under this corporate. Enroll them during registration.
                      </div>
                    ) : (
                      <div className="border rounded overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                            <tr>
                              <th className="text-left px-3 py-2">Patient</th>
                              <th className="text-left px-3 py-2">Card #</th>
                              <th className="text-center px-3 py-2">Visits</th>
                              <th className="text-left px-3 py-2">Invoices</th>
                              <th className="text-right px-3 py-2">Amount (₦)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pats.map(p => {
                              const invs = invoices[p.id] || [];
                              const sub = invs.reduce((s, i) => s + i.total_amount, 0);
                              const vc = (visitCounts[r.id] || {})[p.id] || 0;
                              return (
                                <tr key={p.id} className="border-t">
                                  <td className="px-3 py-2">{p.first_name} {p.last_name || ''}</td>
                                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{p.card_number || '—'}</td>
                                  <td className="px-3 py-2 text-center">{vc || <span className="text-muted-foreground">0</span>}</td>
                                  <td className="px-3 py-2 text-xs font-mono text-muted-foreground">
                                    {invs.length === 0 ? '—' : invs.map(i => i.invoice_number).join(', ')}
                                  </td>
                                  <td className="px-3 py-2 text-right font-medium">
                                    {sub > 0 ? money(sub) : <span className="text-muted-foreground">0.00</span>}
                                  </td>
                                </tr>
                              );
                            })}
                            <tr className="border-t bg-muted/30 font-semibold">
                              <td className="px-3 py-2" colSpan={4}>Month total</td>
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

      <Dialog open={!!closeDialog} onOpenChange={o => !o && setCloseDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-primary" /> Close {MONTHS[month - 1]} {year}
            </DialogTitle>
            <DialogDescription>
              The system will total this month and lock the statement as <b>finalized</b>. New visits will roll into the next month. After the company pays, click <b>Mark paid</b>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Notes (optional)</label>
            <Textarea
              value={closeNotes}
              onChange={e => setCloseNotes(e.target.value)}
              placeholder="e.g. Invoice sent via email on..."
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialog(null)}>Cancel</Button>
            <Button onClick={() => closeDialog && doClose(closeDialog)} disabled={busy === closeDialog}>
              {busy === closeDialog && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <ReceiptText className="h-4 w-4 mr-1.5" /> Confirm close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}