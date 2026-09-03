import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { usePatients } from '@/contexts/PatientContext';
import { useStaff } from '@/hooks/useStaff';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Search, Printer, FileText, BadgeCheck, ChevronRight, Lock, History, Loader2, Wallet } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { HOSPITAL } from '@/lib/hospital';

interface DeductionInvoice {
  id: string;
  invoice_number: string;
  total_amount: number;
  paid_amount: number;
  paid_at: string | null;
  patient_id: string;
  staff_sponsor_id: string | null;
  notes: string | null;
  salary_deduction_batch_id: string | null;
  is_salary_deduction?: boolean | null;
  payment_method?: string | null;
}

interface Batch {
  id: string;
  batch_number: string;
  period_month: number | null;
  period_year: number | null;
  total_amount: number;
  staff_count: number;
  invoice_count: number;
  closed_at: string;
}

interface StaffGroup {
  staffId: string;
  name: string;
  employeeId: string;
  department: string;
  totalBilled: number;
  total: number; // exact amount to deduct from salary (patient share)
  items: DeductionInvoice[];
}

const naira = (n: number) => `₦${Number(n || 0).toLocaleString()}`;
const LOAD_TIMEOUT_MS = 12000;

function withTimeout<T>(request: PromiseLike<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${label} request timed out`));
    }, LOAD_TIMEOUT_MS);

    Promise.resolve(request).then(
      value => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      },
      error => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const INVOICE_COLUMNS =
  'id, invoice_number, total_amount, paid_amount, paid_at, patient_id, staff_sponsor_id, notes, salary_deduction_batch_id, is_salary_deduction, payment_method';

/**
 * The deployed settlement RPC writes payment_method = salary_deduction but does
 * not always persist staff_sponsor_id (CockroachDB compatibility). The backend
 * trigger backfills it on the same write, but this component must not depend on
 * that trigger existing: any salary-deduction invoice whose sponsor id is still
 * empty is resolved here from the staff_family_members link table so it always
 * groups under the correct staff sponsor.
 */
async function linkMissingSponsors(rows: DeductionInvoice[]): Promise<DeductionInvoice[]> {
  const missingIds = Array.from(
    new Set(rows.filter(inv => !inv.staff_sponsor_id).map(inv => inv.patient_id)),
  );
  if (missingIds.length === 0) return rows;

  const { data, error } = await supabase
    .from('staff_family_members')
    .select('patient_id, staff_id')
    .in('patient_id', missingIds);
  if (error || !data) return rows;

  const staffByPatient = new Map<string, string>();
  (data as Array<{ patient_id: string; staff_id: string | null }>).forEach(link => {
    if (link.staff_id && !staffByPatient.has(link.patient_id)) {
      staffByPatient.set(link.patient_id, link.staff_id);
    }
  });
  if (staffByPatient.size === 0) return rows;

  return rows.map(inv =>
    inv.staff_sponsor_id || staffByPatient.get(inv.patient_id)
      ? { ...inv, staff_sponsor_id: inv.staff_sponsor_id ?? staffByPatient.get(inv.patient_id) ?? null }
      : inv,
  );
}

export function StaffFamilyDeductions() {
  const [invoices, setInvoices] = useState<DeductionInvoice[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchItems, setBatchItems] = useState<DeductionInvoice[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { patients } = usePatients();
  const { staff } = useStaff();

  // Resolved family-member names (context patients plus a targeted fetch for
  // any invoice whose patient is not in the context list).
  const [patientNames, setPatientNames] = useState<Record<string, string>>({});

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [openRes, batchRes] = await Promise.all([
        withTimeout(
          supabase
            .from('invoices')
            .select(INVOICE_COLUMNS)
            .eq('status', 'paid')
            .order('paid_at', { ascending: false }) as unknown as Promise<{ data: any; error: any }>,
          'Current deductions',
        ),
        withTimeout(
          supabase
            .from('staff_deduction_batches')
            .select('id, batch_number, period_month, period_year, total_amount, staff_count, invoice_count, closed_at')
            .order('closed_at', { ascending: false }) as unknown as Promise<{ data: any; error: any }>,
          'Deduction history',
        ),
      ]);

      if (openRes.error) {
        toast.error(`Failed to load current deductions: ${openRes.error.message}`);
      } else {
        // The deployed Supabase wrapper does not expose `.is()`. Keep the
        // current-cycle rule identical by filtering unbatched rows locally.
        const currentCycle = ((openRes.data || []) as DeductionInvoice[])
          .filter(invoice => (
            invoice.is_salary_deduction === true
            || ['salary', 'salary_deduction'].includes(String(invoice.payment_method || '').toLowerCase())
          ))
          .filter(invoice => !invoice.salary_deduction_batch_id);
        setInvoices(await linkMissingSponsors(currentCycle));
      }

      if (batchRes.error) toast.error(`Failed to load deduction history: ${batchRes.error.message}`);
      else setBatches((batchRes.data || []) as Batch[]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The request could not be completed';
      toast.error(`Staff Family Deductions: ${message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Resolve family-member patient names for every bill in the cycle.
  useEffect(() => {
    if (invoices.length === 0) return;
    const contextNames: Record<string, string> = {};
    patients.forEach(p => {
      contextNames[p.id] = `${p.first_name} ${p.last_name || ''}`.trim();
    });
    const missingIds = Array.from(new Set(invoices.map(inv => inv.patient_id)))
      .filter(id => !contextNames[id]);
    if (missingIds.length === 0) {
      setPatientNames(prev => {
        const merged = { ...prev, ...contextNames };
        return Object.keys(merged).length === Object.keys(prev).length && Object.keys(prev).length > 0 ? prev : merged;
      });
      return;
    }
    let cancelled = false;
    void supabase
      .from('patients')
      .select('id, first_name, last_name')
      .in('id', missingIds)
      .then(({ data, error }) => {
        if (cancelled || error) return;
        const fetched: Record<string, string> = {};
        (data || []).forEach((p: any) => {
          fetched[p.id] = `${p.first_name} ${p.last_name || ''}`.trim();
        });
        setPatientNames(prev => ({ ...prev, ...contextNames, ...fetched }));
      });
    return () => { cancelled = true; };
  }, [invoices, patients]);

  const loadBatch = async (batch: Batch) => {
    setSelectedBatch(batch);
    const { data, error } = await supabase
      .from('invoices')
      .select(INVOICE_COLUMNS)
      .eq('salary_deduction_batch_id', batch.id)
      .order('paid_at', { ascending: false });
    if (error) toast.error('Failed to load batch details');
    else setBatchItems(await linkMissingSponsors((data || []) as DeductionInvoice[]));
  };

  const patientName = (id: string) => {
    const ctx = patients.find(pp => pp.id === id);
    if (ctx) return `${ctx.first_name} ${ctx.last_name || ''}`.trim();
    if (patientNames[id]) return patientNames[id];
    return 'Unknown patient';
  };

  const groupBy = (list: DeductionInvoice[]): StaffGroup[] => {
    const map = new Map<string, StaffGroup>();
    list.forEach(inv => {
      const key = inv.staff_sponsor_id || 'unknown';
      const s = staff.find(ss => ss.id === key);
      if (!map.has(key)) {
        map.set(key, {
          staffId: key,
          name: s ? `${s.firstName} ${s.lastName}` : 'Unknown staff',
          employeeId: s?.employeeId || '—',
          department: s?.department || '—',
          totalBilled: 0,
          total: 0,
          items: [],
        });
      }
      const g = map.get(key)!;
      g.total += Number(inv.paid_amount || 0);
      g.totalBilled += Number(inv.total_amount || 0);
      g.items.push(inv);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  };

  const currentGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const groups = groupBy(invoices);
    if (!q) return groups;
    return groups.filter(g =>
      g.name.toLowerCase().includes(q) ||
      g.employeeId.toLowerCase().includes(q) ||
      g.department.toLowerCase().includes(q) ||
      g.items.some(inv => patientName(inv.patient_id).toLowerCase().includes(q))
    );
  }, [invoices, staff, search, patientNames, patients]);

  const grandTotalBilled = currentGroups.reduce((s, g) => s + g.totalBilled, 0);
  const grandTotal = currentGroups.reduce((s, g) => s + g.total, 0);
  const grandConcession = grandTotalBilled - grandTotal;
  const grandBillCount = currentGroups.reduce((s, g) => s + g.items.length, 0);
  const batchGroups = useMemo(() => groupBy(batchItems), [batchItems, staff]);

  /**
   * Opens a dedicated print window containing ONLY the payroll schedule — a
   * clean, self-contained document that never includes the app shell, so the
   * print preview shows just this record.
   */
  const handlePrint = () => {
    if (currentGroups.length === 0) return;

    const dateCell = (d: string | null) => (d ? format(new Date(d), 'dd MMM yyyy') : '—');
    const groupRows = currentGroups.map(g => {
      const concession = Math.max(g.totalBilled - g.total, 0);
      const bills = g.items.map(inv => {
        const invConcession = Math.max(Number(inv.total_amount || 0) - Number(inv.paid_amount || 0), 0);
        return (
          '<tr class="bill-row">' +
          `<td>${patientName(inv.patient_id)}<span class="muted">${inv.invoice_number} · ${dateCell(inv.paid_at)}</span></td>` +
          `<td></td>` +
          `<td></td>` +
          `<td></td>` +
          `<td class="num">${naira(inv.total_amount)}</td>` +
          `<td class="num muted">${naira(invConcession)}</td>` +
          `<td class="num strong">${naira(inv.paid_amount)}</td>` +
          `<td></td>` +
          '</tr>'
        );
      }).join('');
      return (
        '<tr class="staff-row">' +
        `<td>${g.name}</td>` +
        `<td class="mono">${g.employeeId}</td>` +
        `<td>${g.department}</td>` +
        `<td class="num">${g.items.length}</td>` +
        `<td class="num">${naira(g.totalBilled)}</td>` +
        `<td class="num">${naira(concession)}</td>` +
        `<td class="num strong">${naira(g.total)}</td>` +
        `<td></td>` +
        '</tr>' +
        bills
      );
    }).join('');

    const printWindow = window.open('', '_blank', 'width=980,height=760');
    if (!printWindow) {
      toast.error('Pop-up blocked — allow pop-ups for this site to print.');
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Staff Family Medical Deductions — ${HOSPITAL.name}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: Arial, Helvetica, sans-serif; color: #111; padding: 24px; }
            .sheet { max-width: 900px; margin: 0 auto; }
            .masthead { text-align: center; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
            .masthead h1 { font-size: 19px; letter-spacing: 0.4px; text-transform: uppercase; }
            .masthead p { font-size: 10.5px; color: #333; line-height: 1.5; margin-top: 2px; }
            h2 { text-align: center; font-size: 14px; text-transform: uppercase; margin: 10px 0 2px; }
            .generated { text-align: center; font-size: 10.5px; color: #444; margin-bottom: 12px; }
            table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
            th { border: 1px solid #222; background: #e5e5e5; padding: 5px 6px; text-align: left; font-size: 10px; text-transform: uppercase; }
            th.num, td.num { text-align: right; }
            th.center { text-align: center; }
            td { border: 1px solid #777; padding: 5px 6px; vertical-align: top; }
            tr { page-break-inside: avoid; }
            tr.staff-row td { background: #eee; font-weight: 700; border-color: #333; }
            tr.bill-row td { border-color: #ccc; color: #222; }
            tr.bill-row td:first-child span { display: block; font-weight: normal; color: #555; font-size: 9.5px; }
            tr.grand-row td { background: #e5e5e5; font-weight: 700; border-top: 2px solid #111; font-size: 11px; }
            .mono { font-family: 'Courier New', monospace; font-size: 9.5px; }
            .muted { color: #555; }
            .num.strong { font-weight: 700; }
            .note { font-size: 9.5px; color: #333; margin-top: 6px; line-height: 1.45; }
            .signatures { display: flex; justify-content: space-between; gap: 36px; margin-top: 60px; font-size: 10.5px; }
            .signature { flex: 1; border-top: 1px solid #111; padding-top: 4px; }
            .footer { text-align: center; font-size: 9px; color: #555; margin-top: 34px; }
            @media print {
              body { padding: 0; }
              @page { margin: 12mm 10mm; }
            }
          </style>
        </head>
        <body>
          <div class="sheet">
            <div class="masthead">
              <h1>${HOSPITAL.name}</h1>
              <p>${HOSPITAL.address}</p>
              <p>${HOSPITAL.rc}</p>
              <p>${HOSPITAL.email} · ${HOSPITAL.phone}</p>
            </div>
            <h2>Staff Family Medical Deductions — Payroll Schedule</h2>
            <p class="generated">Current cycle · generated ${format(new Date(), 'PPP p')}</p>

            <table>
              <thead>
                <tr>
                  <th>Staff Sponsor</th>
                  <th>Emp ID</th>
                  <th>Department</th>
                  <th class="num">Family Bill</th>
                  <th class="num">Billed (₦)</th>
                  <th class="num">Concession 50% (₦)</th>
                  <th class="num">To Deduct (₦)</th>
                  <th class="center">Deducted ✓</th>
                </tr>
              </thead>
              <tbody>
                ${groupRows}
                <tr class="grand-row">
                  <td colspan="3">GRAND TOTAL</td>
                  <td class="num">${grandBillCount}</td>
                  <td class="num">${naira(grandTotalBilled)}</td>
                  <td class="num">${naira(grandConcession)}</td>
                  <td class="num">${naira(grandTotal)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>

            <p class="note">
              Every staff-family bill carries a 50% hospital concession. The <strong>To Deduct</strong> column is the
              patient's share that was recorded for deduction from the sponsor's salary when the cashier chose salary
              deduction at settlement.
            </p>

            <div class="signatures">
              <div class="signature">Prepared by (Accountant)</div>
              <div class="signature">Checked by</div>
              <div class="signature">Approved by</div>
            </div>

            <p class="footer">${HOSPITAL.name} — Accounts Department</p>
          </div>
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
                window.onafterprint = function() { window.close(); };
              }, 200);              };
          </script>

        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleClose = async () => {
    setClosing(true);
    const now = new Date();
    const ids = invoices.map(i => i.id);
    const { error } = await supabase.rpc('close_family_deduction_batch', {
      _invoice_ids: ids,
      _period_month: now.getMonth() + 1,
      _period_year: now.getFullYear(),
      _notes: null,
    });
    setClosing(false);
    setConfirmOpen(false);
    if (error) {
      toast.error(`Could not close cycle: ${error.message}`);
      return;
    }
    toast.success('Cycle closed — these bills moved to history. Counting starts fresh.');
    fetchAll();
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="current">
        <TabsList className="print:hidden">
          <TabsTrigger value="current" className="gap-1.5">
            <FileText className="h-4 w-4" /> Current Cycle
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="h-4 w-4" /> History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="current" className="space-y-6">
          <Card>
            <CardHeader className="print:hidden">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-module-billing">
                    <Wallet className="h-5 w-5" />
                    Staff Family Deductions — Current Cycle
                  </CardTitle>
                  <CardDescription>
                    Every family bill settled by salary deduction, grouped under its staff sponsor. Print the sheet
                    for payroll, then close the cycle.
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh'}
                  </Button>
                  <Button size="sm" onClick={handlePrint} disabled={currentGroups.length === 0}>
                    <Printer className="h-4 w-4 mr-2" /> Print
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={invoices.length === 0 || closing}
                    onClick={() => setConfirmOpen(true)}
                  >
                    <Lock className="h-4 w-4 mr-2" /> Close Cycle
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <div className="rounded-lg border bg-muted/30 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Family bills</p>
                  <p className="text-lg font-bold">{grandBillCount}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Billed total</p>
                  <p className="text-lg font-bold">{naira(grandTotalBilled)}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Hospital concession (50%)</p>
                  <p className="text-lg font-bold text-success">{naira(grandConcession)}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">To deduct from salaries</p>
                  <p className="text-lg font-bold text-destructive">{naira(grandTotal)}</p>
                </div>
              </div>

              <div className="relative mb-6">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by staff name, employee ID, department or family member..."
                  className="pl-9"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>

              <div className="border rounded-xl overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>Staff Sponsor</TableHead>
                      <TableHead>Employee ID</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead className="text-center">Bills</TableHead>
                      <TableHead className="text-right">Billed Total</TableHead>
                      <TableHead className="text-right">To Deduct</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Loading…</TableCell>
                      </TableRow>
                    ) : currentGroups.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                          No pending family deductions for this cycle. If a salary-deduction invoice was just settled,
                          press Refresh.
                        </TableCell>
                      </TableRow>
                    ) : (
                      currentGroups.map(g => {
                        const isOpen = expanded[g.staffId] !== false; // open by default so every bill is visible
                        return (
                          <Fragment key={g.staffId}>
                            <TableRow
                              className="cursor-pointer hover:bg-muted/40"
                              onClick={() => setExpanded(p => ({ ...p, [g.staffId]: !isOpen }))}
                            >
                              <TableCell>
                                <ChevronRight className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                              </TableCell>
                              <TableCell className="font-medium">{g.name}</TableCell>
                              <TableCell className="font-mono text-xs">{g.employeeId}</TableCell>
                              <TableCell className="text-sm">{g.department}</TableCell>
                              <TableCell className="text-center">{g.items.length}</TableCell>
                              <TableCell className="text-right">{naira(g.totalBilled)}</TableCell>
                              <TableCell className="text-right font-bold text-destructive">{naira(g.total)}</TableCell>
                            </TableRow>
                            {isOpen && (
                              <TableRow className="bg-muted/20">
                                <TableCell />
                                <TableCell colSpan={6} className="p-0">
                                  <div className="px-3 py-2">
                                    <Table>
                                      <TableHeader>
                                        <TableRow className="hover:bg-transparent">
                                          <TableHead className="text-xs">Family Member</TableHead>
                                          <TableHead className="text-xs">Invoice</TableHead>
                                          <TableHead className="text-xs">Date</TableHead>
                                          <TableHead className="text-xs text-right">Billed (₦)</TableHead>
                                          <TableHead className="text-xs text-right">Concession (₦)</TableHead>
                                          <TableHead className="text-xs text-right">To Deduct (₦)</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {g.items.map(inv => (
                                          <TableRow key={inv.id} className="hover:bg-transparent">
                                            <TableCell className="text-xs font-medium">
                                              {patientName(inv.patient_id)}
                                            </TableCell>
                                            <TableCell className="font-mono text-[11px]">{inv.invoice_number}</TableCell>
                                            <TableCell className="text-xs">
                                              {inv.paid_at ? format(new Date(inv.paid_at), 'dd MMM yyyy') : '—'}
                                            </TableCell>
                                            <TableCell className="text-xs text-right">{naira(inv.total_amount)}</TableCell>
                                            <TableCell className="text-xs text-right text-success">
                                              {naira(Math.max(Number(inv.total_amount || 0) - Number(inv.paid_amount || 0), 0))}
                                            </TableCell>
                                            <TableCell className="text-xs text-right font-semibold text-destructive">
                                              {naira(inv.paid_amount)}
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        );
                      })
                    )}
                    {currentGroups.length > 0 && (
                      <TableRow className="bg-muted/50 font-bold">
                        <TableCell />
                        <TableCell colSpan={4} className="text-right">Grand Total:</TableCell>
                        <TableCell className="text-right">{naira(grandTotalBilled)}</TableCell>
                        <TableCell className="text-right text-destructive text-lg">{naira(grandTotal)}</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-6 bg-primary/5 border border-primary/20 rounded-lg p-4 flex gap-3">
                <BadgeCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold text-primary">How this works</p>
                  <p className="text-muted-foreground mt-1">
                    Every staff-family bill gets a <strong>50% hospital concession</strong> — for a ₦5,000 bill the
                    patient pays ₦2,500 and the hospital forgives ₦2,500. When the cashier settles that share as a
                    <strong> salary deduction</strong>, the exact patient share appears here under the staff sponsor,
                    next to the family member it was billed for. Print the sheet, enter each amount in the payroll
                    deductions column, then press <strong>Close Cycle</strong> — the bills are locked, removed from
                    this list and kept under History. The next month starts from zero.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" /> Closed Cycles
              </CardTitle>
              <CardDescription>Previously printed and deducted batches.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border rounded-xl overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Batch</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Closed</TableHead>
                      <TableHead className="text-center">Staff</TableHead>
                      <TableHead className="text-center">Bills</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batches.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                          No closed cycles yet.
                        </TableCell>
                      </TableRow>
                    ) : batches.map(b => (
                      <TableRow
                        key={b.id}
                        className={`cursor-pointer hover:bg-muted/40 ${selectedBatch?.id === b.id ? 'bg-muted/40' : ''}`}
                        onClick={() => loadBatch(b)}
                      >
                        <TableCell className="font-mono text-xs">{b.batch_number}</TableCell>
                        <TableCell>
                          {b.period_month && b.period_year
                            ? format(new Date(b.period_year, b.period_month - 1, 1), 'MMMM yyyy')
                            : '—'}
                        </TableCell>
                        <TableCell className="text-sm">{format(new Date(b.closed_at), 'dd MMM yyyy HH:mm')}</TableCell>
                        <TableCell className="text-center">{b.staff_count}</TableCell>
                        <TableCell className="text-center">{b.invoice_count}</TableCell>
                        <TableCell className="text-right font-semibold">{naira(b.total_amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {selectedBatch && (
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">Batch {selectedBatch.batch_number}</CardTitle>
                  <CardDescription>Per-staff breakdown of this closed cycle</CardDescription>
                </div>
                <Badge variant="secondary">{naira(selectedBatch.total_amount)}</Badge>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Staff</TableHead>
                      <TableHead>Employee ID</TableHead>
                      <TableHead className="text-center">Bills</TableHead>
                      <TableHead className="text-right">Deducted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batchGroups.map(g => (
                      <TableRow key={g.staffId}>
                        <TableCell className="font-medium">{g.name}</TableCell>
                        <TableCell className="font-mono text-xs">{g.employeeId}</TableCell>
                        <TableCell className="text-center">{g.items.length}</TableCell>
                        <TableCell className="text-right font-semibold">{naira(g.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close this deduction cycle?</AlertDialogTitle>
            <AlertDialogDescription>
              {invoices.length} bill(s) totalling {naira(grandTotal)} to deduct across {currentGroups.length} staff
              will be locked as deducted and moved to History. New bills will start a fresh cycle. Make sure you have
              printed the schedule first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closing}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); handleClose(); }} disabled={closing}>
              {closing ? 'Closing…' : 'Yes, close cycle'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
