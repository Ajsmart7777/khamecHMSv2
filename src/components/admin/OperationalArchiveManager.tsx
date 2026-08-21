import { useMemo, useState } from 'react';
import { Archive, CheckCircle2, ClipboardCheck, Loader2, ShieldAlert } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

type ArchiveScope = 'all_closed' | 'payroll' | 'sponsor' | 'claims' | 'eligibility';

type ArchivePreview = {
  scope: ArchiveScope;
  cutoff_date: string;
  payroll_periods: number;
  sponsor_statements: number;
  claim_visits: number;
  eligibility_requests: number;
  total_rows: number;
};

const scopeLabels: Record<ArchiveScope, string> = {
  all_closed: 'All closed operational records',
  payroll: 'Closed payroll periods',
  sponsor: 'Paid/printed corporate and retainer statements',
  claims: 'Settled insurance claim visits',
  eligibility: 'Resolved insurance verification requests',
};

function defaultCutoff() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

export function OperationalArchiveManager() {
  const [scope, setScope] = useState<ArchiveScope>('all_closed');
  const [cutoffDate, setCutoffDate] = useState(defaultCutoff);
  const [preview, setPreview] = useState<ArchivePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const rows = useMemo(() => {
    if (!preview) return [];
    return [
      ['Payroll periods', preview.payroll_periods],
      ['Sponsor statements', preview.sponsor_statements],
      ['Settled claim visits', preview.claim_visits],
      ['Resolved verification requests', preview.eligibility_requests],
    ] as const;
  }, [preview]);

  const loadPreview = async () => {
    setLoading(true);
    setPreview(null);
    const moduleName = scope === 'all_closed' ? 'all_closed' : scope === 'sponsor' ? 'corporate_retainer' : scope === 'claims' ? 'insurance_claims' : scope === 'eligibility' ? 'insurance_verification' : scope;
    const { data, error } = await (supabase as any).rpc('preview_operational_archive', {
      _module: moduleName,
      _before_date: cutoffDate,
    });
    setLoading(false);
    if (error) {
      toast.error('Archive preview failed', { description: error.message });
      return;
    }
    const counts = data?.counts ?? {};
    const payroll_periods = Number(counts.payroll_periods ?? 0);
    const sponsor_statements = Number(counts.sponsor_statements ?? 0);
    const claim_visits = Number(counts.visits ?? 0);
    const eligibility_requests = Number(counts.eligibility_verifications ?? 0);
    setPreview({
      scope,
      cutoff_date: String(data?.before_date ?? cutoffDate),
      payroll_periods,
      sponsor_statements,
      claim_visits,
      eligibility_requests,
      total_rows: payroll_periods + sponsor_statements + claim_visits + eligibility_requests,
    });
    toast.success('Archive preview ready');
  };

  const applyArchive = async () => {
    if (!preview) {
      toast.error('Preview the records first');
      return;
    }
    if (preview.total_rows === 0) {
      toast.info('There are no eligible records in this scope');
      return;
    }
    const confirmed = window.confirm(
      `Archive ${preview.total_rows} closed records dated before ${preview.cutoff_date}? Active and unresolved work will be protected.`
    );
    if (!confirmed) return;

    setApplying(true);
    const moduleName = scope === 'all_closed' ? 'all_closed' : scope === 'sponsor' ? 'corporate_retainer' : scope === 'claims' ? 'insurance_claims' : scope === 'eligibility' ? 'insurance_verification' : scope;
    const { data, error } = await (supabase as any).rpc('archive_operational_data', {
      _module: moduleName,
      _before_date: cutoffDate,
      _confirmation: `ARCHIVE ${scope.toUpperCase()} ${cutoffDate}`,
    });
    setApplying(false);
    if (error) {
      toast.error('Archive failed', { description: error.message });
      return;
    }
    setPreview(null);
    toast.success('Operational records archived', {
      description: `${Number(data?.archived_rows ?? (Object.values(data?.counts ?? {}).reduce((sum: number, value: unknown) => sum + Number(value || 0), 0) || preview.total_rows)).toLocaleString()} records removed from active workspaces.`,
    });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Archive className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold">Operational Archive &amp; Cleanup</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Archive closed historical records without touching active patients, open visits, unpaid invoices, pending claims, or pending verification work.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-[1.5fr_1fr_auto] md:items-end">
          <label className="space-y-2 text-sm">
            <span className="font-medium">Record group</span>
            <Select value={scope} onValueChange={(value) => setScope(value as ArchiveScope)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(scopeLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-medium">Older than</span>
            <Input type="date" value={cutoffDate} onChange={(e) => setCutoffDate(e.target.value)} />
          </label>
          <Button onClick={loadPreview} disabled={loading || applying}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardCheck className="mr-2 h-4 w-4" />}
            Preview
          </Button>
        </div>
      </div>

      {preview && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Preview: {scopeLabels[preview.scope]}</p>
              <p className="text-xs text-muted-foreground">Records before {preview.cutoff_date}; active work is protected.</p>
            </div>
            <span className="rounded-full bg-muted px-3 py-1 text-sm font-semibold">
              {preview.total_rows.toLocaleString()} eligible rows
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {rows.map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border/70 bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-xl font-semibold">{value.toLocaleString()}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted-foreground">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p>This action records an archive batch and removes these rows from active workspaces. It does not delete patient master accounts, sponsor master accounts, staff, beds, or configuration.</p>
          </div>

          <Button className="mt-4" onClick={applyArchive} disabled={applying || loading}>
            {applying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Confirm archive
          </Button>
        </div>
      )}
    </div>
  );
}
