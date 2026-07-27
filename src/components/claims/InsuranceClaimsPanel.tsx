import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { ShieldCheck, Loader2, RefreshCw, CreditCard, Stethoscope, ReceiptText } from 'lucide-react';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const INSURANCE_TYPES = ['nhis', 'hmo', 'katchma'] as const;
type InsuranceType = typeof INSURANCE_TYPES[number];

const TYPE_LABEL: Record<InsuranceType, string> = { nhis: 'NHIA', hmo: 'HMO', katchma: 'KATCHMA' };

interface Patient {
  id: string;
  first_name: string;
  last_name: string | null;
  card_number: string | null;
  account_type: InsuranceType;
  insurance_provider: string | null;
  insurance_plan: string | null;
  enrollee_id: string | null;
  status: string;
}

interface Invoice {
  id: string;
  invoice_number: string;
  patient_id: string;
  visit_id: string | null;
  total_amount: number;
  paid_amount: number;
  status: string;
  created_at: string;
}

interface InvoiceItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

interface Visit {
  id: string;
  visit_number: string;
  patient_id: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  presenting_complaint: string | null;
}

function money(v: number) {
  return Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function InsuranceClaimsPanel() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [typeFilter, setTypeFilter] = useState<'all' | InsuranceType>('all');
  const [loading, setLoading] = useState(false);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [invoicesByPatient, setInvoicesByPatient] = useState<Record<string, Invoice[]>>({});
  const [itemsByInvoice, setItemsByInvoice] = useState<Record<string, InvoiceItem[]>>({});
  const [visitsByPatient, setVisitsByPatient] = useState<Record<string, Visit[]>>({});

  const periodStart = useMemo(() => new Date(year, month - 1, 1), [year, month]);
  const periodEnd = useMemo(() => new Date(year, month, 1), [year, month]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Only discharged insurance patients — as requested, cards only appear after full discharge.
      const { data: pats } = await supabase
        .from('patients')
        .select('id, first_name, last_name, card_number, account_type, insurance_provider, insurance_plan, enrollee_id, status')
        .in('account_type', INSURANCE_TYPES as unknown as string[])
        .eq('status', 'discharged');
      const patientRows = (pats || []) as Patient[];
      setPatients(patientRows);
      const ids = patientRows.map(p => p.id);
      if (ids.length === 0) {
        setInvoicesByPatient({}); setItemsByInvoice({}); setVisitsByPatient({});
        return;
      }

      const { data: invs } = await supabase
        .from('invoices')
        .select('id, invoice_number, patient_id, visit_id, total_amount, paid_amount, status, created_at')
        .in('patient_id', ids)
        .gte('created_at', periodStart.toISOString())
        .lt('created_at', periodEnd.toISOString())
        .order('created_at', { ascending: false });
      const invRows = (invs || []) as Invoice[];
      const byPatient: Record<string, Invoice[]> = {};
      invRows.forEach(i => { (byPatient[i.patient_id] ||= []).push({ ...i, total_amount: Number(i.total_amount)||0, paid_amount: Number(i.paid_amount)||0 }); });
      setInvoicesByPatient(byPatient);

      const invIds = invRows.map(i => i.id);
      if (invIds.length > 0) {
        const { data: items } = await supabase
          .from('invoice_items')
          .select('id, invoice_id, description, quantity, unit_price, total')
          .in('invoice_id', invIds);
        const byInv: Record<string, InvoiceItem[]> = {};
        (items || []).forEach(it => {
          (byInv[it.invoice_id] ||= []).push({
            ...it,
            quantity: Number(it.quantity)||0,
            unit_price: Number(it.unit_price)||0,
            total: Number(it.total)||0,
          });
        });
        setItemsByInvoice(byInv);
      } else {
        setItemsByInvoice({});
      }

      const { data: vs } = await supabase
        .from('visits')
        .select('id, visit_number, patient_id, status, opened_at, closed_at, presenting_complaint')
        .in('patient_id', ids)
        .gte('opened_at', periodStart.toISOString())
        .lt('opened_at', periodEnd.toISOString())
        .order('opened_at', { ascending: false });
      const byPatV: Record<string, Visit[]> = {};
      (vs || []).forEach(v => { (byPatV[v.patient_id] ||= []).push(v as Visit); });
      setVisitsByPatient(byPatV);
    } finally {
      setLoading(false);
    }
  }, [periodStart, periodEnd]);

  useEffect(() => { load(); }, [load]);

  const years = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show only patients that actually have invoices this month
  const visiblePatients = useMemo(() => {
    return patients
      .filter(p => (typeFilter === 'all' || p.account_type === typeFilter))
      .filter(p => (invoicesByPatient[p.id]?.length || 0) > 0);
  }, [patients, typeFilter, invoicesByPatient]);

  // Group by provider (fallback to scheme label)
  const groups = useMemo(() => {
    const map: Record<string, Patient[]> = {};
    visiblePatients.forEach(p => {
      const key = `${TYPE_LABEL[p.account_type]}${p.insurance_provider ? ' · ' + p.insurance_provider : ''}`;
      (map[key] ||= []).push(p);
    });
    return Object.entries(map).sort(([a],[b]) => a.localeCompare(b));
  }, [visiblePatients]);

  const totals = useMemo(() => {
    let billed = 0, paid = 0;
    visiblePatients.forEach(p => {
      (invoicesByPatient[p.id] || []).forEach(i => { billed += i.total_amount; paid += i.paid_amount; });
    });
    return { billed, paid, outstanding: billed - paid };
  }, [visiblePatients, invoicesByPatient]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Insurance Claims — discharged patient cards</h3>
          <Badge variant="outline">{visiblePatients.length} card(s)</Badge>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={typeFilter} onValueChange={v => setTypeFilter(v as 'all' | InsuranceType)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All schemes</SelectItem>
              {INSURANCE_TYPES.map(t => <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>)}
            </SelectContent>
          </Select>
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
        Kawai patients ɗin insurance (HMO / NHIA / KATCHMA) waɗanda suka riga suka <b>discharged</b> a wannan wata ke bayyana anan.
        Danna kan card don ganin duk visits da invoices tare da cikakken bayanin abinda aka yi ma patient.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border p-3 bg-card">
          <p className="text-xs text-muted-foreground">Billed this month</p>
          <p className="text-lg font-semibold mt-1">₦{money(totals.billed)}</p>
        </div>
        <div className="rounded-lg border p-3 bg-warning/5 border-warning/30">
          <p className="text-xs text-muted-foreground">Outstanding</p>
          <p className="text-lg font-semibold mt-1 text-warning">₦{money(totals.outstanding)}</p>
        </div>
        <div className="rounded-lg border p-3 bg-success/5 border-success/30">
          <p className="text-xs text-muted-foreground">Paid / copay</p>
          <p className="text-lg font-semibold mt-1 text-success">₦{money(totals.paid)}</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-10"><Loader2 className="h-5 w-5 mx-auto animate-spin" /></div>
      ) : visiblePatients.length === 0 ? (
        <div className="text-center py-10 border rounded-lg text-muted-foreground text-sm">
          Babu discharged insurance patient da yayi visit a wannan wata.
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(([groupKey, groupPatients]) => {
            const groupTotal = groupPatients.reduce((s, p) =>
              s + (invoicesByPatient[p.id] || []).reduce((ss, i) => ss + i.total_amount, 0), 0);
            return (
              <div key={groupKey} className="space-y-2">
                <div className="flex items-center justify-between border-b pb-1.5">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <h4 className="font-semibold text-sm">{groupKey}</h4>
                    <Badge variant="outline" className="text-[10px]">{groupPatients.length}</Badge>
                  </div>
                  <p className="text-xs font-semibold">₦{money(groupTotal)}</p>
                </div>
                <Accordion type="multiple" className="space-y-2">
                  {groupPatients.map(p => {
                    const invs = invoicesByPatient[p.id] || [];
                    const patTotal = invs.reduce((s, i) => s + i.total_amount, 0);
                    const patPaid = invs.reduce((s, i) => s + i.paid_amount, 0);
                    const visits = visitsByPatient[p.id] || [];
                    return (
                      <AccordionItem
                        key={p.id}
                        value={p.id}
                        className="border rounded-lg bg-card px-0 overflow-hidden"
                      >
                        <AccordionTrigger className="hover:no-underline px-4 py-3">
                          <div className="flex flex-1 items-center justify-between gap-3 pr-2">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                                <CreditCard className="h-4 w-4" />
                              </div>
                              <div className="min-w-0 text-left">
                                <p className="font-semibold text-sm truncate">
                                  {p.first_name} {p.last_name || ''}
                                </p>
                                <div className="flex gap-3 text-[11px] text-muted-foreground">
                                  <span className="font-mono">{p.card_number || '—'}</span>
                                  {p.enrollee_id && <span>ID: {p.enrollee_id}</span>}
                                  {p.insurance_plan && <span className="truncate">{p.insurance_plan}</span>}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              <div className="text-right">
                                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Visits</p>
                                <p className="text-sm font-semibold">{visits.length}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">This month</p>
                                <p className="text-sm font-semibold">₦{money(patTotal)}</p>
                              </div>
                              <Badge variant="success" className="uppercase text-[10px]">discharged</Badge>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-4 pb-4 pt-0">
                          <div className="border-t pt-3 space-y-4">
                            {/* Visits */}
                            {visits.length > 0 && (
                              <div>
                                <div className="flex items-center gap-1.5 mb-1.5">
                                  <Stethoscope className="h-3.5 w-3.5 text-primary" />
                                  <p className="text-xs font-semibold uppercase tracking-wide">Visits</p>
                                </div>
                                <div className="border rounded overflow-x-auto">
                                  <table className="w-full text-xs">
                                    <thead className="bg-muted/50 uppercase text-[10px] text-muted-foreground">
                                      <tr>
                                        <th className="px-2 py-1.5 text-left">Visit</th>
                                        <th className="px-2 py-1.5 text-left">Opened</th>
                                        <th className="px-2 py-1.5 text-left">Closed</th>
                                        <th className="px-2 py-1.5 text-left">Complaint</th>
                                        <th className="px-2 py-1.5 text-left">Status</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {visits.map(v => (
                                        <tr key={v.id} className="border-t">
                                          <td className="px-2 py-1.5 font-mono">{v.visit_number}</td>
                                          <td className="px-2 py-1.5">{new Date(v.opened_at).toLocaleDateString()}</td>
                                          <td className="px-2 py-1.5">{v.closed_at ? new Date(v.closed_at).toLocaleDateString() : '—'}</td>
                                          <td className="px-2 py-1.5 truncate max-w-[200px]">{v.presenting_complaint || '—'}</td>
                                          <td className="px-2 py-1.5">
                                            <Badge variant={v.status === 'closed' ? 'success' : 'outline'} className="text-[10px]">
                                              {v.status}
                                            </Badge>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}

                            {/* Invoices with items */}
                            <div>
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <ReceiptText className="h-3.5 w-3.5 text-primary" />
                                <p className="text-xs font-semibold uppercase tracking-wide">Invoices & services</p>
                              </div>
                              <div className="space-y-2">
                                {invs.map(inv => {
                                  const items = itemsByInvoice[inv.id] || [];
                                  return (
                                    <div key={inv.id} className="border rounded overflow-hidden">
                                      <div className="flex items-center justify-between bg-muted/40 px-2.5 py-1.5 text-xs">
                                        <div className="flex items-center gap-2">
                                          <span className="font-mono font-semibold">{inv.invoice_number}</span>
                                          <span className="text-muted-foreground">{new Date(inv.created_at).toLocaleDateString()}</span>
                                          <Badge variant={inv.status === 'completed' ? 'success' : inv.status === 'partial' ? 'warning' : 'outline'} className="text-[10px]">
                                            {inv.status}
                                          </Badge>
                                        </div>
                                        <div className="flex items-center gap-3">
                                          <span className="text-muted-foreground">Paid: ₦{money(inv.paid_amount)}</span>
                                          <span className="font-semibold">₦{money(inv.total_amount)}</span>
                                        </div>
                                      </div>
                                      {items.length > 0 && (
                                        <table className="w-full text-xs">
                                          <thead className="uppercase text-[10px] text-muted-foreground">
                                            <tr className="border-t">
                                              <th className="px-2 py-1 text-left">Service</th>
                                              <th className="px-2 py-1 text-right w-16">Qty</th>
                                              <th className="px-2 py-1 text-right w-24">Unit</th>
                                              <th className="px-2 py-1 text-right w-24">Total</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {items.map(it => (
                                              <tr key={it.id} className="border-t">
                                                <td className="px-2 py-1">{it.description}</td>
                                                <td className="px-2 py-1 text-right">{it.quantity}</td>
                                                <td className="px-2 py-1 text-right">₦{money(it.unit_price)}</td>
                                                <td className="px-2 py-1 text-right font-medium">₦{money(it.total)}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="flex justify-end gap-4 pt-2 text-xs">
                                <span className="text-muted-foreground">Paid/copay: <b className="text-foreground">₦{money(patPaid)}</b></span>
                                <span>Total: <b>₦{money(patTotal)}</b></span>
                              </div>
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}