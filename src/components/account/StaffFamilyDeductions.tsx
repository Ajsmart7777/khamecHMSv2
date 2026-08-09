import { useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { usePatients, Patient } from '@/contexts/PatientContext';
import { useStaff } from '@/hooks/useStaff';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Search, Printer, FileText, BadgeCheck, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface DeductionInvoice {
  id: string;
  invoice_number: string;
  total_amount: number;
  paid_amount: number;
  paid_at: string;
  patient_id: string;
  staff_sponsor_id: string;
  notes: string;
}

export function StaffFamilyDeductions() {
  const [invoices, setInvoices] = useState<DeductionInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const { patients } = usePatients();
  const { staff } = useStaff();

  const fetchDeductions = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('invoices')
      .select('id, invoice_number, total_amount, paid_amount, paid_at, patient_id, staff_sponsor_id, notes')
      .eq('is_salary_deduction', true)
      .eq('status', 'paid')
      .order('paid_at', { ascending: false });

    if (error) {
      toast.error('Failed to fetch deductions');
    } else {
      setInvoices(data as DeductionInvoice[]);
    }
    setLoading(false);
  };

  useState(() => {
    fetchDeductions();
  });

  const getPatientName = (id: string) => {
    const p = patients.find(pp => pp.id === id);
    return p ? `${p.first_name} ${p.last_name}` : 'Unknown';
  };

  const getStaffName = (id: string) => {
    const s = staff.find(ss => ss.id === id);
    return s ? `${s.firstName} ${s.lastName} (${s.employeeId})` : 'Unknown';
  };

  const filtered = invoices.filter(inv => {
    const pName = getPatientName(inv.patient_id).toLowerCase();
    const sName = getStaffName(inv.staff_sponsor_id).toLowerCase();
    const q = search.toLowerCase();
    return pName.includes(q) || sName.includes(q) || inv.invoice_number.toLowerCase().includes(q);
  });

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-module-billing">
                <FileText className="h-5 w-5" />
                Staff Family Deductions
              </CardTitle>
              <CardDescription>
                List of family member bills marked for payroll deduction
              </CardDescription>
            </div>
            <div className="flex gap-2 print:hidden">
              <Button variant="outline" size="sm" onClick={fetchDeductions}>
                Refresh
              </Button>
              <Button size="sm" onClick={handlePrint}>
                <Printer className="h-4 w-4 mr-2" /> Print Report
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="relative mb-6 print:hidden">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by invoice, patient, or staff sponsor..."
              className="pl-9"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="border rounded-xl overflow-hidden print:border-none">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Patient (Family)</TableHead>
                  <TableHead>Staff Sponsor</TableHead>
                  <TableHead>Date Paid</TableHead>
                  <TableHead className="text-right">Deduction Amount</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                      Loading deductions...
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                      No salary deduction records found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map(inv => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-xs">{inv.invoice_number}</TableCell>
                      <TableCell className="font-medium">{getPatientName(inv.patient_id)}</TableCell>
                      <TableCell>{getStaffName(inv.staff_sponsor_id)}</TableCell>
                      <TableCell className="text-sm">
                        {inv.paid_at ? format(new Date(inv.paid_at), 'dd MMM yyyy HH:mm') : '—'}
                      </TableCell>
                      <TableCell className="text-right font-bold text-destructive">
                        ₦{Number(inv.paid_amount).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {inv.notes || '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
                {filtered.length > 0 && (
                  <TableRow className="bg-muted/50 font-bold">
                    <TableCell colSpan={4} className="text-right">Total Outstanding Deductions:</TableCell>
                    <TableCell className="text-right text-destructive text-lg">
                      ₦{filtered.reduce((s, i) => s + Number(i.paid_amount), 0).toLocaleString()}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="mt-8 hidden print:block border-t pt-4">
            <div className="flex justify-between text-sm text-muted-foreground">
              <p>Generated on: {format(new Date(), 'PPP p')}</p>
              <p>Accounting Department — Khadija Medical Center</p>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 flex gap-3 print:hidden">
        <BadgeCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-semibold text-primary">Payroll Integration</p>
          <p className="text-muted-foreground mt-1">
            These deductions will be automatically calculated when you generate the next payroll 
            period for the respective staff members.
          </p>
        </div>
      </div>
    </div>
  );
}
