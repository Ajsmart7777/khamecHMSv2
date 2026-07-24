import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { FileText, Filter, Eye, Download, Loader2, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useClaimsQueue, Visit, markClaimSettled } from '@/hooks/useVisits';
import { usePatients } from '@/contexts/PatientContext';
import { VisitEnvelopeDialog } from '@/components/visit/VisitEnvelopeDialog';
import { PatientCardDialog } from '@/components/visit/PatientCardDialog';
import { Patient } from '@/contexts/PatientContext';
import { downloadClaimsPacketPdf, downloadBulkClaimsPacketsPdf } from '@/lib/claimsPacketPdf';
import { toast } from 'sonner';

// Claims manager scope: insured/scheme patients only.
// Corporate & retainer are handled by the Accountant module.
const INSURED_SPONSORS = ['nhia', 'hmo', 'katchma', 'staff', 'staff_family'] as const;

export function ClaimsQueue() {
  const { getPatientById } = usePatients();
  const [sponsorType, setSponsorType] = useState<string>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tab, setTab] = useState<'pending' | 'settled'>('pending');
  const [open, setOpen] = useState<Visit | null>(null);
  const [cardPatient, setCardPatient] = useState<Patient | null>(null);
  const [settleTarget, setSettleTarget] = useState<Visit | null>(null);
  const [settleNotes, setSettleNotes] = useState('');
  const [settling, setSettling] = useState(false);
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
      claimStatus: tab,
      sponsors: [...INSURED_SPONSORS],
    }),
    [sponsorType, from, to, tab]
  );

  const { visits, loading } = useClaimsQueue(filters);

  async function confirmSettle() {
    if (!settleTarget) return;
    setSettling(true);
    try {
      await markClaimSettled(settleTarget.id, settleNotes.trim() || undefined);
      toast.success('Claim marked as settled');
      setSettleTarget(null);
      setSettleNotes('');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to settle claim');
    } finally {
      setSettling(false);
    }
  }

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
      <Card className="p-4 bg-primary/5 border-primary/20">
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-primary mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold">Insured Claims Desk</p>
            <p className="text-muted-foreground text-xs">
              Discharged insured patients (KATCHMA, NHIA, HMO, Staff, Staff Family) land here automatically.
              Open a patient's card, verify the invoices, then mark the claim as settled once your reconciliation is done.
              Corporate &amp; retainer accounts are handled by the Accountant module.
            </p>
          </div>
        </div>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'pending' | 'settled')}>
        <TabsList>
          <TabsTrigger value="pending">Pending Claims</TabsTrigger>
          <TabsTrigger value="settled">Settled</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="mt-4 space-y-4">
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
              {INSURED_SPONSORS.map((s) => (
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
          <p className="text-xs text-muted-foreground">{tab === 'pending' ? 'Pending claims' : 'Settled claims'}</p>
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
          <p className="text-sm">
            {tab === 'pending'
              ? 'No pending insured claims. Discharged insured patients appear here automatically.'
              : 'No settled claims in this range.'}
          </p>
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
                            {tab === 'settled' && v.claim_settled_at && ` · settled ${format(new Date(v.claim_settled_at), 'MMM d, yyyy')}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="text-sm font-semibold">₦{Number(v.total_charged).toLocaleString()}</p>
                            {Number(v.total_paid) > 0 && (
                              <p className="text-[10px] text-muted-foreground">paid ₦{Number(v.total_paid).toLocaleString()}</p>
                            )}
                          </div>
                          <Badge
                            variant={tab === 'settled' ? 'default' : 'secondary'}
                            className="text-[10px] capitalize"
                          >
                            {tab}
                          </Badge>
                          <Button size="sm" variant="outline" onClick={() => p && setCardPatient(p)} disabled={!p}>
                            <Eye className="h-3 w-3 mr-1" /> Card
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setOpen(v)}>
                            Envelope
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleSingle(v)}
                            disabled={downloadingId === v.id || !!bulk}
                          >
                            {downloadingId === v.id
                              ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              : <Download className="h-3 w-3 mr-1" />}
                            Packet
                          </Button>
                          {tab === 'pending' && (
                            <Button
                              size="sm"
                              onClick={() => { setSettleTarget(v); setSettleNotes(''); }}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Mark Settled
                            </Button>
                          )}
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
        </TabsContent>
      </Tabs>

      <VisitEnvelopeDialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} visit={open} />
      {cardPatient && (
        <PatientCardDialog
          patient={cardPatient}
          open={!!cardPatient}
          onOpenChange={(o) => !o && setCardPatient(null)}
        />
      )}

      <AlertDialog open={!!settleTarget} onOpenChange={(o) => !o && setSettleTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark claim as settled?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  You are settling the claim for visit{' '}
                  <span className="font-mono">{settleTarget?.visit_number}</span>
                  {settleTarget?.insurance_plan && ` · ${settleTarget.insurance_plan}`}.
                </p>
                <p className="text-muted-foreground">
                  Total charged:{' '}
                  <span className="font-semibold text-foreground">
                    ₦{Number(settleTarget?.total_charged ?? 0).toLocaleString()}
                  </span>{' '}
                  · Patient share collected:{' '}
                  <span className="font-semibold text-foreground">
                    ₦{Number(settleTarget?.total_paid ?? 0).toLocaleString()}
                  </span>
                </p>
                <p className="text-xs text-amber-700">
                  Confirm that you have reconciled the invoices with the scheme before continuing. This will be
                  written to the audit log.
                </p>
                <Textarea
                  placeholder="Reconciliation notes (optional) — remittance advice #, batch ref, etc."
                  value={settleNotes}
                  onChange={(e) => setSettleNotes(e.target.value)}
                  rows={3}
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={settling}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmSettle(); }}
              disabled={settling}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {settling ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
              Confirm Settle
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
