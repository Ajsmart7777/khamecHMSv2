import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileText, Filter, Eye, Download, Loader2 } from 'lucide-react';
import { useClaimsQueue, Visit } from '@/hooks/useVisits';
import { usePatients } from '@/contexts/PatientContext';
import { VisitEnvelopeDialog } from '@/components/visit/VisitEnvelopeDialog';
import { downloadClaimsPacketPdf, downloadBulkClaimsPacketsPdf } from '@/lib/claimsPacketPdf';
import { toast } from 'sonner';

const SPONSORS = ['corporate', 'retainer', 'nhia', 'hmo', 'katchma', 'staff', 'staff_family'] as const;

export function ClaimsQueue() {
  const { getPatientById } = usePatients();
  const [sponsorType, setSponsorType] = useState<string>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState<Visit | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);

  async function handleSingle(v: Visit) {
    setDownloadingId(v.id);
    try {
      await downloadClaimsPacketPdf(v);
      toast.success('Claims packet downloaded');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to build packet');
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleBulk(list: Visit[], label: string) {
    if (list.length === 0) return;
    setBulk({ done: 0, total: list.length });
    try {
      await downloadBulkClaimsPacketsPdf(list, label, (done, total) => setBulk({ done, total }));
      toast.success(`Exported ${list.length} packets`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Bulk export failed');
    } finally {
      setBulk(null);
    }
  }


  const filters = useMemo(
    () => ({
      sponsorType: sponsorType === 'all' ? null : sponsorType,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(new Date(to).setHours(23, 59, 59, 999)).toISOString() : undefined,
    }),
    [sponsorType, from, to]
  );

  const { visits, loading } = useClaimsQueue(filters);

  const grouped = useMemo(() => {
    const map: Record<string, Visit[]> = {};
    for (const v of visits) {
      const key = v.sponsor_type ?? 'other';
      (map[key] ||= []).push(v);
    }
    return map;
  }, [visits]);

  const totalCharged = visits.reduce((s, v) => s + Number(v.total_charged), 0);
  const totalPaid = visits.reduce((s, v) => s + Number(v.total_paid), 0);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Filters</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Select value={sponsorType} onValueChange={setSponsorType}>
            <SelectTrigger><SelectValue placeholder="Sponsor type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sponsors</SelectItem>
              {SPONSORS.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">
                  {s.replace('_', ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div>
            <label className="text-xs text-muted-foreground">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={() => { setSponsorType('all'); setFrom(''); setTo(''); }}>
              Reset
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Settled visits</p>
          <p className="text-2xl font-bold">{visits.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total charged</p>
          <p className="text-2xl font-bold">₦{totalCharged.toLocaleString()}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Patient share collected</p>
          <p className="text-2xl font-bold">₦{totalPaid.toLocaleString()}</p>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {bulk ? `Building packets… ${bulk.done}/${bulk.total}` : `Export claims packets for all visits in view.`}
        </p>
        <Button
          size="sm"
          onClick={() => handleBulk(visits, `claims-packets-${new Date().toISOString().slice(0,10)}`)}
          disabled={!!bulk || visits.length === 0}
        >
          {bulk ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
          Export all packets ({visits.length})
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-8">Loading claims…</p>
      ) : visits.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No settled sponsored visits in this range.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([sponsor, list]) => {
            const grp = list.reduce((s, v) => s + Number(v.total_charged), 0);
            return (
              <Card key={sponsor} className="p-4">
                <div className="flex justify-between items-center mb-3 gap-2 flex-wrap">
                  <div>
                    <h3 className="font-semibold capitalize">{sponsor.replace('_', ' ')}</h3>
                    <p className="text-xs text-muted-foreground">{list.length} visits</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-semibold">₦{grp.toLocaleString()}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleBulk(list, `${sponsor}-packets-${new Date().toISOString().slice(0,10)}`)}
                      disabled={!!bulk}
                    >
                      <Download className="h-3 w-3 mr-1" /> Export group
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  {list.map((v) => {
                    const p = getPatientById(v.patient_id);
                    return (
                      <div
                        key={v.id}
                        className="flex items-center justify-between gap-3 p-2 rounded-md border border-border hover:bg-muted/50 flex-wrap"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {p ? `${p.first_name} ${p.last_name}` : '—'}{' '}
                            <span className="text-xs text-muted-foreground">({p?.card_number ?? '—'})</span>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            <span className="font-mono">{v.visit_number}</span> ·{' '}
                            {v.closed_at && format(new Date(v.closed_at), 'MMM d, yyyy')}
                            {v.insurance_plan && ` · ${v.insurance_plan}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="text-sm font-semibold">₦{Number(v.total_charged).toLocaleString()}</p>
                            {Number(v.total_paid) > 0 && (
                              <p className="text-[10px] text-muted-foreground">paid ₦{Number(v.total_paid).toLocaleString()}</p>
                            )}
                          </div>
                          <Badge variant="secondary" className="text-[10px]">pending</Badge>
                          <Button size="sm" variant="outline" onClick={() => setOpen(v)}>
                            <Eye className="h-3 w-3 mr-1" /> View
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <VisitEnvelopeDialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} visit={open} />
    </div>
  );
}
