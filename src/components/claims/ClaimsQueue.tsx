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
import { FileText, Filter, Eye, Download, Loader2, CheckCircle2, ShieldCheck, XCircle, HelpCircle, RotateCcw } from 'lucide-react';
import {
  useClaimsQueue,
  Visit,
  markClaimSettled,
  markClaimRejected,
  requestClaimInfo,
  reopenClaim,
  CLAIM_REJECT_REASON_CODES,
  CLAIM_INFO_REASON_CODES,
} from '@/hooks/useVisits';
import { usePatients } from '@/contexts/PatientContext';
import { VisitEnvelopeDialog } from '@/components/visit/VisitEnvelopeDialog';
import { Patient } from '@/contexts/PatientContext';
import { ClaimDetailDialog } from './ClaimDetailDialog';
import { ExpiryBadge } from './ExpiryBadge';
import { downloadClaimsPacketPdf, downloadBulkClaimsPacketsPdf } from '@/lib/claimsPacketPdf';
import { toast } from 'sonner';

// Claims manager scope: external insurance schemes only (NHIA, HMO, Katchma).
// Corporate & retainer are handled by the Accountant module.
// Staff care is free (no claim). Staff family pays 50% out-of-pocket (no claim).
const INSURED_SPONSORS = ['nhia', 'hmo', 'katchma'] as const;

export function ClaimsQueue() {
  const { getPatientById } = usePatients();
  const [sponsorType, setSponsorType] = useState<string>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tab, setTab] = useState<'pending' | 'info_requested' | 'rejected' | 'settled'>('pending');
  const [open, setOpen] = useState<Visit | null>(null);
  const [detailVisit, setDetailVisit] = useState<Visit | null>(null);
  const [settleTarget, setSettleTarget] = useState<Visit | null>(null);
  const [settleNotes, setSettleNotes] = useState('');
  const [settling, setSettling] = useState(false);
  const [actionTarget, setActionTarget] = useState<{ visit: Visit; kind: 'reject' | 'info' } | null>(null);
  const [reasonCode, setReasonCode] = useState('');
  const [reasonNotes, setReasonNotes] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);
  const [reopenTarget, setReopenTarget] = useState<Visit | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [reopening, setReopening] = useState(false);
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

  async function confirmAction() {
    if (!actionTarget) return;
    if (!reasonCode) {
      toast.error('Please select a reason code');
      return;
    }
    setSubmittingAction(true);
    try {
      if (actionTarget.kind === 'reject') {
        await markClaimRejected(actionTarget.visit.id, reasonCode, reasonNotes.trim() || undefined);
        toast.success('Claim marked as rejected');
      } else {
        await requestClaimInfo(actionTarget.visit.id, reasonCode, reasonNotes.trim() || undefined);
        toast.success('Information request logged');
      }
      setActionTarget(null);
      setReasonCode('');
      setReasonNotes('');
    } catch (e: any) {
      toast.error(e?.message ?? 'Action failed');
    } finally {
      setSubmittingAction(false);
    }
  }

  async function confirmReopen() {
    if (!reopenTarget) return;
    if (reopenReason.trim().length < 3) {
      toast.error('Please provide a reason (min 3 chars)');
      return;
    }
    setReopening(true);
    try {
      await reopenClaim(reopenTarget.id, reopenReason.trim());
      toast.success('Claim reopened to pending');
      setReopenTarget(null);
      setReopenReason('');
    } catch (e: any) {
      toast.error(e?.message ?? 'Reopen failed');
    } finally {
      setReopening(false);
    }
  }

  const activeReasonCodes =
    actionTarget?.kind === 'reject' ? CLAIM_REJECT_REASON_CODES : CLAIM_INFO_REASON_CODES;

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

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="pending">Pending Claims</TabsTrigger>
          <TabsTrigger value="info_requested">Info Requested</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
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
          <p className="text-xs text-muted-foreground capitalize">
            {tab.replace('_', ' ')} claims
          </p>
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
          <p className="text-sm capitalize">
            No {tab.replace('_', ' ')} claims in this range.
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
                          {(tab === 'pending' || tab === 'info_requested') && (
                            <div className="mt-1">
                              <ExpiryBadge openedAt={v.opened_at} />
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="text-sm font-semibold">₦{Number(v.total_charged).toLocaleString()}</p>
                            {Number(v.total_paid) > 0 && (
                              <p className="text-[10px] text-muted-foreground">paid ₦{Number(v.total_paid).toLocaleString()}</p>
                            )}
                          </div>
                          <Badge
                            variant={
                              tab === 'settled' ? 'default'
                              : tab === 'rejected' ? 'destructive'
                              : 'secondary'
                            }
                            className="text-[10px] capitalize"
                          >
                            {tab.replace('_', ' ')}
                          </Badge>
                          {v.claim_reason_code && tab !== 'pending' && tab !== 'settled' && (
                            <Badge variant="outline" className="text-[10px]">
                              {v.claim_reason_code.replace(/_/g, ' ')}
                            </Badge>
                          )}
                          <Button size="sm" variant="outline" onClick={() => setDetailVisit(v)}>
                            <Eye className="h-3 w-3 mr-1" /> Review Claim
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
                          {(tab === 'pending' || tab === 'info_requested') && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => { setActionTarget({ visit: v, kind: 'info' }); setReasonCode(''); setReasonNotes(''); }}
                                className="border-amber-500 text-amber-700 hover:bg-amber-50"
                              >
                                <HelpCircle className="h-3 w-3 mr-1" /> Request Info
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => { setActionTarget({ visit: v, kind: 'reject' }); setReasonCode(''); setReasonNotes(''); }}
                                className="border-red-500 text-red-700 hover:bg-red-50"
                              >
                                <XCircle className="h-3 w-3 mr-1" /> Reject
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => { setSettleTarget(v); setSettleNotes(''); }}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" /> Mark Settled
                              </Button>
                            </>
                          )}
                          {(tab === 'rejected' || tab === 'settled') && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => { setReopenTarget(v); setReopenReason(''); }}
                            >
                              <RotateCcw className="h-3 w-3 mr-1" /> Reopen
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
      <ClaimDetailDialog
        visit={detailVisit}
        open={!!detailVisit}
        onOpenChange={(o) => !o && setDetailVisit(null)}
        onSettle={(v) => { setSettleTarget(v); setSettleNotes(''); }}
        onReject={(v) => { setActionTarget({ visit: v, kind: 'reject' }); setReasonCode(''); setReasonNotes(''); }}
        onRequestInfo={(v) => { setActionTarget({ visit: v, kind: 'info' }); setReasonCode(''); setReasonNotes(''); }}
        onReopen={(v) => { setReopenTarget(v); setReopenReason(''); }}
      />

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

      <AlertDialog open={!!actionTarget} onOpenChange={(o) => !o && setActionTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {actionTarget?.kind === 'reject' ? 'Reject this claim?' : 'Request more information?'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  Visit <span className="font-mono">{actionTarget?.visit.visit_number}</span>
                  {actionTarget?.visit.insurance_plan && ` · ${actionTarget.visit.insurance_plan}`}
                </p>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Reason code *</label>
                  <Select value={reasonCode} onValueChange={setReasonCode}>
                    <SelectTrigger><SelectValue placeholder="Select a reason code" /></SelectTrigger>
                    <SelectContent>
                      {activeReasonCodes.map((r) => (
                        <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
                  <Textarea
                    placeholder={
                      actionTarget?.kind === 'reject'
                        ? 'Detailed rejection notes for the audit log & patient card…'
                        : 'What information is needed from the patient / scheme?'
                    }
                    value={reasonNotes}
                    onChange={(e) => setReasonNotes(e.target.value)}
                    rows={3}
                  />
                </div>
                <p className="text-xs text-amber-700">
                  This action will be written to the audit log and shown on the patient card.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submittingAction}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmAction(); }}
              disabled={submittingAction || !reasonCode}
              className={
                actionTarget?.kind === 'reject'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-amber-600 hover:bg-amber-700'
              }
            >
              {submittingAction
                ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                : actionTarget?.kind === 'reject'
                  ? <XCircle className="h-3 w-3 mr-1" />
                  : <HelpCircle className="h-3 w-3 mr-1" />}
              {actionTarget?.kind === 'reject' ? 'Confirm Reject' : 'Send Info Request'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!reopenTarget} onOpenChange={(o) => !o && setReopenTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reopen this claim?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  This will move visit <span className="font-mono">{reopenTarget?.visit_number}</span> back
                  to <strong>pending</strong> for re-review. A reason is required and audit-logged.
                </p>
                <Textarea
                  placeholder="Reason for reopening (required)"
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  rows={3}
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reopening}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmReopen(); }}
              disabled={reopening || reopenReason.trim().length < 3}
            >
              {reopening ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RotateCcw className="h-3 w-3 mr-1" />}
              Confirm Reopen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
