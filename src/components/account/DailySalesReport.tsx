import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Printer, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { HOSPITAL } from '@/lib/hospital';


type Row = {
  id: string;
  time: string;
  reference: string;
  patientName: string;
  cardNumber: string;
  patientType: string;
  paymentMethod: string;
  kind: string;
  amount: number;
};

const naira = (n: number) =>
  `₦${Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const label = (s?: string | null) =>
  (s || '—').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function DailySalesReport() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const from = new Date(`${date}T00:00:00`).toISOString();
      const to = new Date(`${date}T23:59:59.999`).toISOString();

      const [invRes, txRes] = await Promise.all([
        supabase
          .from('invoices')
          .select('id, invoice_number, total_amount, paid_amount, payment_method, sponsor_type, paid_at, patient_id, patients(first_name, last_name, card_number, account_type)')
          .eq('status', 'paid')
          .gte('paid_at', from)
          .lte('paid_at', to)
          .order('paid_at', { ascending: true }),
        supabase
          .from('balance_transactions')
          .select('id, transaction_type, amount, payment_method, created_at, patient_id, patients(first_name, last_name, card_number, account_type)')
          .in('transaction_type', ['topup', 'debt_cleared'])
          .gte('created_at', from)
          .lte('created_at', to)
          .order('created_at', { ascending: true }),
      ]);

      if (invRes.error) throw invRes.error;
      if (txRes.error) throw txRes.error;

      const invRows: Row[] = (invRes.data || []).map((i: any) => ({
        id: `inv-${i.id}`,
        time: i.paid_at,
        reference: i.invoice_number,
        patientName: `${i.patients?.first_name ?? ''} ${i.patients?.last_name ?? ''}`.trim() || 'Unknown',
        cardNumber: i.patients?.card_number ?? '—',
        patientType: i.sponsor_type || i.patients?.account_type || 'cash',
        paymentMethod: i.payment_method || 'cash',
        kind: 'Invoice',
        amount: Number(i.paid_amount || i.total_amount || 0),
      }));

      const txRows: Row[] = (txRes.data || []).map((t: any) => ({
        id: `tx-${t.id}`,
        time: t.created_at,
        reference: t.transaction_type === 'topup' ? 'Wallet Top-up' : 'Debt Cleared',
        patientName: `${t.patients?.first_name ?? ''} ${t.patients?.last_name ?? ''}`.trim() || 'Unknown',
        cardNumber: t.patients?.card_number ?? '—',
        patientType: t.patients?.account_type || 'cash',
        paymentMethod: t.payment_method || 'cash',
        kind: t.transaction_type === 'topup' ? 'Top-up' : 'Debt Payment',
        amount: Math.abs(Number(t.amount || 0)),
      }));

      setRows([...txRows, ...invRows].sort((a, b) => a.time.localeCompare(b.time)));
    } catch (e: any) {
      toast.error(e.message || 'Failed to load daily sales');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const totals = useMemo(() => {
    const byMethod: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let cashCollected = 0;
    let total = 0;
    for (const r of rows) {
      byMethod[r.paymentMethod] = (byMethod[r.paymentMethod] || 0) + r.amount;
      byType[r.patientType] = (byType[r.patientType] || 0) + r.amount;
      total += r.amount;
      if (['cash', 'pos', 'transfer', 'card'].includes(r.paymentMethod)) cashCollected += r.amount;
    }
    return { byMethod, byType, total, cashCollected };
  }, [rows]);

  const handlePrint = () => {
    const html = document.getElementById('daily-sales-print')?.innerHTML;
    if (!html) return;
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return toast.error('Unable to open print window. Check popup settings.');
    w.document.write(`<!DOCTYPE html><html><head><title>Daily Sales Report - ${date}</title>
      <style>
        *{box-sizing:border-box}
        body{font-family:Arial,Helvetica,sans-serif;padding:24px;color:#111}
        h1{font-size:18px;margin:0 0 4px;text-align:center}
        .hosp{text-align:center;margin-bottom:12px;border-bottom:2px solid #111;padding-bottom:8px}
        .hosp h2{font-size:17px;margin:0;text-transform:uppercase;letter-spacing:.5px}
        .hosp p{font-size:11px;color:#444;margin:2px 0}
        .sub{font-size:12px;color:#555;margin-bottom:16px;text-align:center}

        table{width:100%;border-collapse:collapse;font-size:11px}
        th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
        th{background:#f2f2f2}
        td.num,th.num{text-align:right}
        .totals{margin-top:16px;font-size:12px}
        .totals table{width:auto}
        .grand{font-weight:bold;font-size:14px;margin-top:10px}
        @media print{@page{size:A4 landscape;margin:12mm}}
      </style></head><body>${html}
      <script>window.onload=function(){window.print();window.onafterprint=function(){window.close()}}<\/script>
      </body></html>`);
    w.document.close();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Daily Sales Report</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="sales-date" className="text-xs">Date</Label>
            <Input id="sales-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
          </div>
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button variant="hero" onClick={handlePrint} disabled={rows.length === 0}>
            <Printer className="h-4 w-4 mr-1.5" /> Print Report
          </Button>
          <div className="ml-auto text-right">
            <p className="text-xs text-muted-foreground">Total Sales</p>
            <p className="text-xl font-bold">{naira(totals.total)}</p>
          </div>
        </CardContent>
      </Card>

      <div id="daily-sales-print">
        <div className="hosp text-center mb-3">
          <h2 className="text-base font-bold uppercase">{HOSPITAL.name}</h2>
          <p className="text-xs text-muted-foreground">{HOSPITAL.address}</p>
          <p className="text-xs text-muted-foreground">{HOSPITAL.rc} · {HOSPITAL.email} · {HOSPITAL.phone}</p>
        </div>
        <h1>Daily Sales Report</h1>
        <div className="sub text-xs text-muted-foreground mb-3">
          Date: {new Date(`${date}T00:00:00`).toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          {' · '}Generated: {new Date().toLocaleString('en-NG')}
        </div>


        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Card No.</TableHead>
              <TableHead>Patient Type</TableHead>
              <TableHead>Payment Method</TableHead>
              <TableHead>Entry</TableHead>
              <TableHead className="num text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  No sales recorded for this date.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r, idx) => (
              <TableRow key={r.id}>
                <TableCell>{idx + 1}</TableCell>
                <TableCell>{new Date(r.time).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}</TableCell>
                <TableCell>{r.reference}</TableCell>
                <TableCell>{r.patientName}</TableCell>
                <TableCell>{r.cardNumber}</TableCell>
                <TableCell>{label(r.patientType)}</TableCell>
                <TableCell>{label(r.paymentMethod)}</TableCell>
                <TableCell>{r.kind}</TableCell>
                <TableCell className="num text-right">{naira(r.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {rows.length > 0 && (
          <div className="totals mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="font-semibold text-sm mb-1">By Payment Method</p>
              <table>
                <tbody>
                  {Object.entries(totals.byMethod).map(([m, v]) => (
                    <tr key={m}>
                      <td>{label(m)}</td>
                      <td className="num text-right">{naira(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <p className="font-semibold text-sm mb-1">By Patient Type</p>
              <table>
                <tbody>
                  {Object.entries(totals.byType).map(([t, v]) => (
                    <tr key={t}>
                      <td>{label(t)}</td>
                      <td className="num text-right">{naira(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grand sm:col-span-2 flex flex-wrap gap-4">
              <Badge variant="secondary">Cash / POS / Transfer: {naira(totals.cashCollected)}</Badge>
              <Badge variant="secondary">Transactions: {rows.length}</Badge>
              <span>Grand Total: {naira(totals.total)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
