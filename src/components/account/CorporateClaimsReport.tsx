import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, Download, Loader2, TrendingUp } from 'lucide-react';
import { useCorporateAccounts } from '@/hooks/useCorporateAccounts';

interface ClaimRow {
  id: string;
  claim_number: string;
  patient_id: string;
  invoice_id: string;
  sponsor_type: string;
  corporate_account_id: string | null;
  total_amount: number;
  covered_amount: number;
  patient_copay: number;
  status: string;
  submitted_at: string;
  paid_at: string | null;
  patient?: { first_name: string; last_name: string } | null;
  corporate?: { company_name: string; sponsor_type: string } | null;
}

function money(v: number) {
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CorporateClaimsReport({ fixedSponsorType }: { fixedSponsorType?: 'corporate' | 'retainer' } = {}) {
  const { accounts } = useCorporateAccounts(fixedSponsorType);
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sponsorType, setSponsorType] = useState<string>(fixedSponsorType || 'all');
  const [accountId, setAccountId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      let q = supabase
        .from('insurance_claims')
        .select('*, patient:patients(first_name,last_name), corporate:corporate_accounts(company_name,sponsor_type)')
        .order('submitted_at', { ascending: false });
      if (fixedSponsorType) q = q.eq('sponsor_type', fixedSponsorType);
      else q = q.in('sponsor_type', ['corporate', 'retainer']);
      const { data, error } = await q;
      if (!error) setClaims((data || []) as unknown as ClaimRow[]);
      setLoading(false);
    };
    load();
  }, [fixedSponsorType]);

  const filtered = useMemo(() => claims.filter(c => {
    if (sponsorType !== 'all' && c.sponsor_type !== sponsorType) return false;
    if (accountId !== 'all' && c.corporate_account_id !== accountId) return false;
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    return true;
  }), [claims, sponsorType, accountId, statusFilter]);

  const totals = useMemo(() => {
    const t = { total: 0, covered: 0, copay: 0, outstanding: 0 };
    filtered.forEach(c => {
      t.total += Number(c.total_amount) || 0;
      t.covered += Number(c.covered_amount) || 0;
      t.copay += Number(c.patient_copay) || 0;
      if (c.status !== 'paid') t.outstanding += Number(c.covered_amount) || 0;
    });
    return t;
  }, [filtered]);

  const exportCsv = () => {
    const rows = [
      ['Claim #', 'Sponsor type', 'Sponsor', 'Patient', 'Total', 'Covered', 'Copay', 'Status', 'Submitted', 'Paid at'],
      ...filtered.map(c => [
        c.claim_number,
        c.sponsor_type,
        c.corporate?.company_name || '',
        `${c.patient?.first_name || ''} ${c.patient?.last_name || ''}`.trim(),
        c.total_amount, c.covered_amount, c.patient_copay,
        c.status,
        c.submitted_at,
        c.paid_at || '',
      ]),
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `corporate-retainer-claims-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Corporate & Retainer Claims</h3>
          <Badge variant="outline">{filtered.length}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={sponsorType} onValueChange={setSponsorType}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Sponsor type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sponsors</SelectItem>
              <SelectItem value="corporate">Corporate</SelectItem>
              <SelectItem value="retainer">Retainer</SelectItem>
            </SelectContent>
          </Select>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Account" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              {accounts.map(a => (<SelectItem key={a.id} value={a.id}>{a.company_name}</SelectItem>))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any status</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4 mr-1.5" /> CSV</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Billed" value={money(totals.total)} />
        <StatCard label="Covered" value={money(totals.covered)} />
        <StatCard label="Patient copay" value={money(totals.copay)} />
        <StatCard label="Outstanding" value={money(totals.outstanding)} accent />
      </div>

      {loading ? (
        <div className="text-center py-10"><Loader2 className="h-5 w-5 mx-auto animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 border rounded-lg text-muted-foreground text-sm">
          <TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-50" />
          No claims match the current filters. Corporate/retainer invoices raised in billing will appear here.
        </div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Claim #</th>
                <th className="text-left px-3 py-2">Sponsor</th>
                <th className="text-left px-3 py-2">Patient</th>
                <th className="text-right px-3 py-2">Total</th>
                <th className="text-right px-3 py-2">Covered</th>
                <th className="text-right px-3 py-2">Copay</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{c.claim_number}</td>
                  <td className="px-3 py-2">
                    <div>{c.corporate?.company_name || '—'}</div>
                    <Badge variant="outline" className="text-[10px]">{c.sponsor_type}</Badge>
                  </td>
                  <td className="px-3 py-2">{c.patient?.first_name} {c.patient?.last_name}</td>
                  <td className="px-3 py-2 text-right">{money(c.total_amount)}</td>
                  <td className="px-3 py-2 text-right">{money(c.covered_amount)}</td>
                  <td className="px-3 py-2 text-right">{money(c.patient_copay)}</td>
                  <td className="px-3 py-2"><Badge variant="outline">{c.status}</Badge></td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(c.submitted_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? 'bg-warning/5 border-warning/30' : 'bg-card'}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold mt-1">{value}</p>
    </div>
  );
}