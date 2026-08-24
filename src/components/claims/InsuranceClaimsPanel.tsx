import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShieldCheck, Loader2, RefreshCw, CreditCard, CheckCircle2, CalendarCheck } from 'lucide-react';
import { PatientCardDialog } from '@/components/visit/PatientCardDialog';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { settleClaimsMonth } from '@/hooks/useVisits';
import type { Patient as CtxPatient } from '@/contexts/PatientContext';

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
  claim_submitted_at?: string | null;
  invoice_items?: any[];
}

interface ClaimVisit {
  id: string;
  patient_id: string;
  claim_status?: string | null;
  claim_settled_at?: string | null;
  opened_at: string;
}

const CLOSED_CLAIM_STATUSES = new Set(['settled', 'rejected', 'not_applicable']);


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
  const [openPatient, setOpenPatient] = useState<CtxPatient | null>(null);
  const [claimVisitsByPatient, setClaimVisitsByPatient] = useState<Record<string, ClaimVisit[]>>({});
  const [settlingGroup, setSettlingGroup] = useState<string | null>(null);
  const { hasRole } = useAuth();

  const periodStart = useMemo(() => new Date(year, month - 1, 1), [year, month]);
  const periodEnd = useMemo(() => new Date(year, month, 1), [year, month]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Only discharged insurance patients — as requested, cards only appear after full discharge.
      const { data: pats } = await supabase
        .from('patients')
        .select('*')
        .in('account_type', INSURANCE_TYPES as unknown as string[])
        .eq('status', 'discharged');
      const patientRows = (pats || []) as any[] as Patient[];
      setPatients(patientRows);
      const ids = patientRows.map(p => p.id);
      if (ids.length === 0) {
        setInvoicesByPatient({});
        return;
      }

      // CockroachDB compatibility: load invoices and invoice items separately.
      // Supabase nested relation selects are not supported by the clone gateway.
      const { data: invs, error: invoiceErr } = await supabase
        .from('invoices')
        .select('id, invoice_number, patient_id, visit_id, total_amount, paid_amount, status, created_at, claim_submitted_at')
        .in('patient_id', ids)
        .gte('created_at', periodStart.toISOString())
        .lt('created_at', periodEnd.toISOString())
        .order('created_at', { ascending: false });
      if (invoiceErr) throw invoiceErr;

      const invRows = (invs || []) as any[] as Invoice[];
      const { data: visitRows, error: visitErr } = await supabase
        .from('visits')
        .select('id, patient_id, claim_status, claim_settled_at, opened_at')
        .in('patient_id', ids)
        .gte('opened_at', periodStart.toISOString())
        .lt('opened_at', periodEnd.toISOString());
      if (visitErr) throw visitErr;
      const claimsByPatient: Record<string, ClaimVisit[]> = {};
      (visitRows || []).forEach((v: any) => { (claimsByPatient[v.patient_id] ||= []).push(v as ClaimVisit); });
      setClaimVisitsByPatient(claimsByPatient);

      // A patient can have a second visit in the same month. Once the first
      // visit is settled, its invoices belong to immutable history and must
      // not be added to the new active card. Keep only invoices linked to an
      // active claim visit; retain unlinked legacy invoices only when the
      // patient has no settled claim visit in this period.
      const claimVisitById = new Map<string, ClaimVisit>();
      (visitRows || []).forEach((v: any) => claimVisitById.set(String(v.id), v as ClaimVisit));
      const invoiceIds = invRows.map(i => i.id);
      const { data: itemRows, error: itemErr } = invoiceIds.length
        ? await supabase
            .from('invoice_items')
            .select('id, invoice_id, total, dispensing_status')
            .in('invoice_id', invoiceIds)
        : { data: [], error: null } as any;
      if (itemErr) throw itemErr;
      const itemsByInvoice = new Map<string, any[]>();
      (itemRows || []).forEach((it: any) => {
        const list = itemsByInvoice.get(it.invoice_id) || [];
        list.push(it);
        itemsByInvoice.set(it.invoice_id, list);
      });

      const byPatient: Record<string, Invoice[]> = {};
      invRows.forEach(i => {
        const patientClaimVisits = claimsByPatient[i.patient_id] || [];
        const hasSettledClaimVisit = patientClaimVisits.some(v => CLOSED_CLAIM_STATUSES.has(String(v.claim_status || 'pending')));
        const linkedVisit = i.visit_id ? claimVisitById.get(String(i.visit_id)) : undefined;
        const belongsToActiveCard = linkedVisit
          ? !CLOSED_CLAIM_STATUSES.has(String(linkedVisit.claim_status || 'pending'))
          : !hasSettledClaimVisit;
        if (!belongsToActiveCard) return;

        // Exclude unavailable/refunded items from sponsor claims; refund_pending
        // and refund_requested are also not billable while awaiting Cashier action.
        const activeItems = (itemsByInvoice.get(i.id) || []).filter((it: any) =>
          !['unavailable', 'refund_requested', 'refund_pending', 'not_given', 'refunded'].includes(it.dispensing_status)
        );
        const activeTotal = activeItems.reduce((s: number, it: any) => s + (Number(it.total) || 0), 0);

        (byPatient[i.patient_id] ||= []).push({
          ...i,
          invoice_items: itemsByInvoice.get(i.id) || [],
          total_amount: activeTotal,
          paid_amount: Number(i.paid_amount) || 0,
        });
      });

      setInvoicesByPatient(byPatient);
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
      .filter(p => (invoicesByPatient[p.id]?.length || 0) > 0)
      .filter(p => {
        const claims = claimVisitsByPatient[p.id] || [];
        // A card remains active only while at least one monthly claim visit is
        // unresolved. Historical settled/rejected visits remain in the ledger
        // but never keep an active card visible.
        return claims.length === 0 || claims.some(v => !CLOSED_CLAIM_STATUSES.has(String(v.claim_status || 'pending')));
      });
  }, [patients, typeFilter, invoicesByPatient, claimVisitsByPatient]);

  // Group by provider (fallback to scheme label)
  const groups = useMemo(() => {
    const map: Record<string, { key: string; sponsorType: InsuranceType; providerName: string | null; patients: Patient[] }> = {};
    visiblePatients.forEach(p => {
      const providerName = p.insurance_provider || null;
      const key = `${TYPE_LABEL[p.account_type]}${providerName ? ' · ' + providerName : ''}`;
      (map[key] ||= { key, sponsorType: p.account_type, providerName, patients: [] }).patients.push(p);
    });
    return Object.values(map).sort((a, b) => a.key.localeCompare(b.key));
  }, [visiblePatients]);

  async function settleGroup(group: { key: string; sponsorType: InsuranceType; providerName: string | null }) {
    if (!hasRole(['claims_manager'])) return;
    if (!window.confirm(`Mark all eligible claims for ${group.key} for ${MONTHS[month - 1]} ${year} as Settled? Settled cards will leave this active workspace, while their ledger history remains preserved.`)) return;
    setSettlingGroup(group.key);
    try {
      const result = await settleClaimsMonth({ sponsorType: group.sponsorType, providerName: group.providerName, year, month });
      toast.success(`${result.settled_count} monthly claim${result.settled_count === 1 ? '' : 's'} settled`, { description: `₦${money(result.settled_amount)} recorded for ${group.key}.` });
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Monthly claim settlement failed');
    } finally {
      setSettlingGroup(null);
    }
  }

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
        Only insurance patients (HMO / NHIA / KATCHMA) who have been <b>discharged</b> this month appear here.
        Click a card to see all visits and invoices with a full breakdown of services provided to the patient.
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
          No discharged insurance patient with a visit in this month.
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => {
            const groupTotal = group.patients.reduce((s, p) =>
              s + (invoicesByPatient[p.id] || []).reduce((ss, i) => ss + i.total_amount, 0), 0);
            return (
              <div key={group.key} className="space-y-2">
                <div className="flex items-center justify-between border-b pb-1.5 gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <ShieldCheck className="h-4 w-4 text-primary flex-shrink-0" />
                    <h4 className="font-semibold text-sm truncate">{group.key}</h4>
                    <Badge variant="outline" className="text-[10px]">{group.patients.length} patients</Badge>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <p className="text-xs font-semibold">₦{money(groupTotal)}</p>
                    {hasRole(['claims_manager']) && (
                      <Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => settleGroup(group)} disabled={settlingGroup === group.key}>
                        {settlingGroup === group.key ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <CalendarCheck className="h-3 w-3 mr-1" />}
                        Mark {MONTHS[month - 1]} as Settled
                      </Button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {group.patients.map(p => {
                    const invs = invoicesByPatient[p.id] || [];
                    const patTotal = invs.reduce((s, i) => s + i.total_amount, 0);
                    const submitted = invs.filter(i => i.claim_submitted_at).length;
                    const allSubmitted = invs.length > 0 && submitted === invs.length;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setOpenPatient(p as unknown as CtxPatient)}
                        className="text-left border rounded-lg bg-card px-4 py-3 hover:border-primary hover:shadow-sm transition"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                              <CreditCard className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-sm truncate">
                                {p.first_name} {p.last_name || ''}
                              </p>
                              <div className="flex gap-2 text-[11px] text-muted-foreground flex-wrap">
                                <span className="font-mono">{p.card_number || '—'}</span>
                                {p.enrollee_id && <span>ID: {p.enrollee_id}</span>}
                                {p.insurance_plan && <span className="truncate">{p.insurance_plan}</span>}
                              </div>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">This month</p>
                            <p className="text-sm font-semibold">₦{money(patTotal)}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{invs.length} invoice{invs.length === 1 ? '' : 's'}</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-2 pt-2 border-t text-[11px]">
                          {allSubmitted ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                              <CheckCircle2 className="h-3.5 w-3.5" /> All claims submitted
                            </span>
                          ) : submitted > 0 ? (
                            <span className="text-amber-700 font-semibold">{submitted}/{invs.length} claims submitted</span>
                          ) : (
                            <span className="text-muted-foreground">Not submitted</span>
                          )}
                          <span className="text-primary font-medium">Open card →</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {openPatient && (
        <PatientCardDialog
          patient={openPatient}
          open={!!openPatient}
          onOpenChange={(o) => { if (!o) { setOpenPatient(null); load(); } }}
        />
      )}
    </div>
  );
}