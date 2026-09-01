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
import { Search, Printer, FileText, BadgeCheck, ChevronRight, Lock, History, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { PrintHeader } from '@/components/receipts/PrintHeader';
import { HOSPITAL } from '@/lib/hospital';

interface DeductionInvoice {
  id: string;
  invoice_number: string;
  paid_amount: number;
  paid_at: string | null;
  patient_id: string;
  staff_sponsor_id: string;
  notes: string | null;
  salary_deduction_batch_id: string | null;
  is_salary_deduction?: boolean;
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
  total: number;
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

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [openRes, batchRes] = await Promise.all([
        withTimeout(
          supabase
            .from('invoices')
            .select('id, invoice_number, paid_amount, paid_at, patient_id, staff_sponsor_id, notes, salary_deduction_batch_id, is_salary_deduction, payment_method')
            .eq('status', 'paid')
            .order('paid_at', { ascending: false }),
          'Current deductions',
        ),
        withTimeout(
          supabase
            .from('staff_deduction_batches')
            .select('id, batch_number, period_month, period_year, total_amount, staff_count, invoice_count, closed_at')
            .order('closed_at', { ascending: false }),
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
        setInvoices(currentCycle);
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

  const loadBatch = async (batch: Batch) => {
    setSelectedBatch(batch);
    const { data, error } = await supabase
      .from('invoices')
      .select('id, invoice_number, paid_amount, paid_at, patient_id, staff_sponsor_id, notes, salary_deduction_batch_id, is_salary_deduction, payment_method')
      .eq('salary_deduction_batch_id', batch.id)
      .order('paid_at', { ascending: false });
    if (error) toast.error('Failed to load batch details');
    else setBatchItems((data || []) as DeductionInvoice[]);
  };

  const patientName = (id: string) => {
    const p = patients.find(pp => pp.id === id);
    return p ? `${p.first_name} ${p.last_name || ''}`.trim() : 'Unknown patient';
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
          total: 0,
          items: [],
        });
      }
      const g = map.get(key)!;
      g.total += Number(inv.paid_amount || 0);
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
      g.department.toLowerCase().includes(q)
    );
  }, [invoices, staff, search]);

  const grandTotal = currentGroups.reduce((s, g) => s + g.total, 0);
  const batchGroups = useMemo(() => groupBy(batchItems), [batchItems, staff]);

  const handlePrint = () => window.print();

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
                    <FileText className="h-5 w-5" />
                    Staff Family Deductions — Current Cycle
                  </CardTitle>
                  <CardDescription>
                    Total owed per staff sponsor. Print this sheet, fill the payroll deduction column, then close the cycle.
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh'}
                  </Button>
                  <Button size="sm" onClick={handlePrint}>
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
              <div className="hidden print:block mb-4">
                <PrintHeader department="ACCOUNTS DEPARTMENT" />
                <h3 className="text-center font-bold text-base mt-2">
                  STAFF FAMILY MEDICAL DEDUCTIONS — PAYROLL SCHEDULE
                </h3>
                <p className="text-center text-xs text-muted-foreground">
                  Generated {format(new Date(), 'PPP p')}
                </p>
              </div>

              <div className="relative mb-6 print:hidden">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by staff name, employee ID or department..."
                  className="pl-9"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>

              <div className="border rounded-xl overflow-hidden print:border-none">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 print:hidden" />
                      <TableHead>Staff Sponsor</TableHead>
                      <TableHead>Employee ID</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead className="text-center">Bills</TableHead>
                      <TableHead className="text-right">Total to Deduct</TableHead>
                      <TableHead className="w-32 hidden print:table-cell">Deducted (✓)</TableHead>
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
                          No pending family deductions for this cycle. If a salary-deduction invoice was just settled, press Refresh.
                        </TableCell>
                      </TableRow>
                    ) : (
                      currentGroups.map(g => (
                        <Fragment key={g.staffId}>
                          <TableRow
                            className="cursor-pointer hover:bg-muted/40"

                            onClick={() => setExpanded(p => ({ ...p, [g.staffId]: !p[g.staffId] }))}
                          >
                            <TableCell className="print:hidden">
                              <ChevronRight className={`h-4 w-4 transition-transform ${expanded[g.staffId] ? 'rotate-90' : ''}`} />
                            </TableCell>
                            <TableCell className="font-medium">{g.name}</TableCell>
                            <TableCell className="font-mono text-xs">{g.employeeId}</TableCell>
                            <TableCell className="text-sm">{g.department}</TableCell>
                            <TableCell className="text-center">{g.items.length}</TableCell>
                            <TableCell className="text-right font-bold text-destructive">{naira(g.total)}</TableCell>
                            <TableCell className="hidden print:table-cell" />
                          </TableRow>
                          {expanded[g.staffId] && g.items.map(inv => (
                            <TableRow key={inv.id} className="bg-muted/20 print:hidden">
                              <TableCell />
                              <TableCell className="text-xs pl-6">{patientName(inv.patient_id)}</TableCell>
                              <TableCell className="font-mono text-xs">{inv.invoice_number}</TableCell>
                              <TableCell className="text-xs">
                                {inv.paid_at ? format(new Date(inv.paid_at), 'dd MMM yyyy') : '—'}
                              </TableCell>
                              <TableCell />
                              <TableCell className="text-right text-xs">{naira(inv.paid_amount)}</TableCell>
                              <TableCell className="hidden print:table-cell" />
                            </TableRow>
                          ))}
                        </Fragment>
                      ))
                    )}
                    {currentGroups.length > 0 && (
                      <TableRow className="bg-muted/50 font-bold">
                        <TableCell className="print:hidden" />
                        <TableCell colSpan={4} className="text-right">Grand Total:</TableCell>
                        <TableCell className="text-right text-destructive text-lg">{naira(grandTotal)}</TableCell>
                        <TableCell className="hidden print:table-cell" />
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-10 hidden print:block">
                <div className="flex justify-between gap-12 text-xs">
                  <div className="flex-1 border-t pt-1">Prepared by (Accountant)</div>
                  <div className="flex-1 border-t pt-1">Checked by</div>
                  <div className="flex-1 border-t pt-1">Approved by</div>
                </div>
                <p className="text-center text-[10px] text-muted-foreground mt-6">
                  {HOSPITAL.name} — Accounts Department
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 flex gap-3 print:hidden">
            <BadgeCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-primary">How this works</p>
              <p className="text-muted-foreground mt-1">
                Every family bill paid by salary deduction accumulates here per staff sponsor. Print the sheet,
                enter each amount in the payroll deductions column, then press <strong>Close Cycle</strong> — the
                bills are locked, removed from this list and kept under History. The next month starts from zero.
              </p>
            </div>
          </div>
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
              {invoices.length} bill(s) totalling {naira(grandTotal)} across {currentGroups.length} staff will be
              locked as deducted and moved to History. New bills will start a fresh cycle. Make sure you have
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
