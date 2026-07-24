import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { CheckCircle2, XCircle, ShieldCheck, Loader2, User, Phone, Clock, FileWarning } from 'lucide-react';
import { useEligibilityVerifications, EligibilityVerification } from '@/hooks/useEligibilityVerifications';
import { usePatients } from '@/contexts/PatientContext';
import { useInsurance } from '@/hooks/useInsurance';

const REJECTION_REASONS = [
  'Policy expired',
  'Enrollee not found in portal',
  'Plan does not cover this service',
  'Annual limit exhausted',
  'Pending premium payment',
  'Wrong provider / not on panel',
  'Other (see notes)',
];

function StatusBadge({ status }: { status: EligibilityVerification['status'] }) {
  const map = {
    pending: { label: 'Pending Review', className: 'bg-amber-500/15 text-amber-700 border-amber-500/30' },
    approved: { label: 'Approved', className: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30' },
    rejected: { label: 'Rejected', className: 'bg-red-500/15 text-red-700 border-red-500/30' },
    expired: { label: 'Expired', className: 'bg-muted text-muted-foreground' },
  } as const;
  const v = map[status];
  return <Badge variant="outline" className={v.className}>{v.label}</Badge>;
}

export function EligibilityQueue() {
  const { pending, approved, rejected, loading, approve, reject } = useEligibilityVerifications();
  const { getPatientById } = usePatients();
  const { providers } = useInsurance();

  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [active, setActive] = useState<EligibilityVerification | null>(null);
  const [rejectTarget, setRejectTarget] = useState<EligibilityVerification | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectNotes, setRejectNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // approval form state
  const [providerId, setProviderId] = useState<string>('');
  const [enrolleeId, setEnrolleeId] = useState('');
  const [plan, setPlan] = useState('');
  const [encounterCode, setEncounterCode] = useState('');
  const [notes, setNotes] = useState('');

  const openReview = (row: EligibilityVerification) => {
    setActive(row);
    setProviderId(row.provider_id || '');
    setEnrolleeId(row.enrollee_id || '');
    setPlan(row.plan || '');
    setEncounterCode(row.encounter_code || '');
    setNotes(row.notes || '');
  };

  const currentList = tab === 'pending' ? pending : tab === 'approved' ? approved : rejected;

  const availableProviders = useMemo(() => {
    if (!active) return providers;
    if (active.sponsor_type === 'nhis') return providers.filter((p) => p.type === 'nhis');
    if (active.sponsor_type === 'hmo') return providers.filter((p) => p.type === 'hmo');
    return providers;
  }, [providers, active]);

  const selectedProvider = providers.find((p) => p.id === providerId);
  const requiresEncounterCode = active?.sponsor_type === 'hmo';

  const handleApprove = async () => {
    if (!active) return;
    if (!enrolleeId.trim()) { toast.error('Enrollee ID is required'); return; }
    if (!providerId && active.sponsor_type !== 'katchma') { toast.error('Select the provider'); return; }
    if (requiresEncounterCode && !encounterCode.trim()) {
      toast.error('Encounter code required for HMO patients');
      return;
    }
    setSubmitting(true);
    const ok = await approve(active.id, {
      provider_id: providerId || null,
      provider_name: selectedProvider?.name || active.provider_name,
      enrollee_id: enrolleeId.trim(),
      plan: plan.trim() || null,
      encounter_code: encounterCode.trim() || null,
      encounter_code_captured_at: encounterCode.trim() ? new Date().toISOString() : null,
      notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (ok) {
      toast.success('Eligibility approved — patient can proceed to Reception');
      setActive(null);
    } else {
      toast.error('Failed to approve');
    }
  };

  const handleReject = async () => {
    if (!rejectTarget || !rejectReason) return;
    setSubmitting(true);
    const ok = await reject(rejectTarget.id, rejectReason, rejectNotes || undefined);
    setSubmitting(false);
    if (ok) {
      toast.success('Marked as rejected — patient will be treated as cash');
      setRejectTarget(null);
      setRejectReason('');
      setRejectNotes('');
      setActive(null);
    } else {
      toast.error('Failed to reject');
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 border-primary/20 bg-primary/5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-primary mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold">Eligibility gate</p>
            <p className="text-muted-foreground">
              Every insured patient (NHIA, HMO, KATCHMA) must be verified here before Reception can open an OPD card.
              Verify in the provider portal, capture enrollee ID and encounter code (for HMOs), then approve or reject.
            </p>
          </div>
        </div>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="pending">
            Pending {pending.length > 0 && <Badge variant="warning" className="ml-1.5 h-5 px-1.5">{pending.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4 space-y-2">
          {loading ? (
            <Card className="p-8 text-center text-muted-foreground">Loading…</Card>
          ) : currentList.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">
              {tab === 'pending' ? 'No pending verifications' : `No ${tab} verifications yet`}
            </Card>
          ) : (
            currentList.map((row) => {
              const patient = getPatientById(row.patient_id);
              return (
                <Card key={row.id} className="p-4 hover:border-primary/40 transition-colors">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="font-semibold">
                          {patient ? `${patient.first_name} ${patient.last_name || ''}`.trim() : 'Unknown patient'}
                        </span>
                        <Badge variant="outline" className="uppercase text-xs">{row.sponsor_type}</Badge>
                        <StatusBadge status={row.status} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-4 flex-wrap">
                        {patient?.card_number && <span>Card: <span className="font-mono">{patient.card_number}</span></span>}
                        {patient?.phone && (
                          <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {patient.phone}</span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {format(new Date(row.created_at), 'MMM d, HH:mm')}
                        </span>
                        {row.provider_name && <span>Provider: <span className="font-medium text-foreground">{row.provider_name}</span></span>}
                        {row.enrollee_id && <span>Enrollee: <span className="font-mono text-foreground">{row.enrollee_id}</span></span>}
                      </div>
                      {row.status === 'rejected' && row.rejection_reason && (
                        <div className="mt-2 text-xs text-red-700 flex items-center gap-1">
                          <FileWarning className="h-3.5 w-3.5" /> {row.rejection_reason}
                          {row.notes && <span className="text-muted-foreground"> — {row.notes}</span>}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {row.status === 'pending' ? (
                        <>
                          <Button size="sm" onClick={() => openReview(row)}>Review & Approve</Button>
                          <Button size="sm" variant="outline" onClick={() => setRejectTarget(row)}>
                            <XCircle className="h-4 w-4 mr-1" /> Reject
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => openReview(row)}>View</Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </TabsContent>
      </Tabs>

      {/* Review / Approve dialog */}
      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Eligibility Verification</DialogTitle>
            <DialogDescription>
              Confirm the patient's coverage in the provider portal, then record the details below.
            </DialogDescription>
          </DialogHeader>

          {active && (() => {
            const patient = getPatientById(active.patient_id);
            const isReadOnly = active.status !== 'pending';
            return (
              <div className="space-y-4">
                <Card className="p-3 bg-muted/40">
                  <div className="text-sm">
                    <div className="font-semibold">
                      {patient ? `${patient.first_name} ${patient.last_name || ''}`.trim() : 'Unknown patient'}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
                      {patient?.card_number && <span>Card: {patient.card_number}</span>}
                      {patient?.phone && <span>{patient.phone}</span>}
                      <Badge variant="outline" className="uppercase text-xs">{active.sponsor_type}</Badge>
                      <StatusBadge status={active.status} />
                    </div>
                  </div>
                </Card>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Provider *</label>
                    <Select value={providerId} onValueChange={setProviderId} disabled={isReadOnly}>
                      <SelectTrigger><SelectValue placeholder="Select provider" /></SelectTrigger>
                      <SelectContent>
                        {availableProviders.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Enrollee ID *</label>
                    <Input
                      value={enrolleeId}
                      onChange={(e) => setEnrolleeId(e.target.value)}
                      placeholder="e.g. NHIA-2024-00123"
                      disabled={isReadOnly}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Plan / Tier</label>
                    <Input value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="e.g. Bronze / Family" disabled={isReadOnly} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">
                      Encounter Code {requiresEncounterCode && <span className="text-red-600">*</span>}
                    </label>
                    <Input
                      value={encounterCode}
                      onChange={(e) => setEncounterCode(e.target.value)}
                      placeholder={requiresEncounterCode ? 'Pre-auth / OTP from HMO' : 'Optional'}
                      className="font-mono"
                      disabled={isReadOnly}
                    />
                    {requiresEncounterCode && (
                      <p className="text-[11px] text-muted-foreground">
                        Some HMOs issue a one-time code per visit. Capture it here if the plan requires it.
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Notes</label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Portal reference, exclusions, cap, etc."
                    rows={2}
                    disabled={isReadOnly}
                  />
                </div>
              </div>
            );
          })()}

          <DialogFooter>
            {active?.status === 'pending' ? (
              <>
                <Button variant="outline" onClick={() => { setActive(null); }} disabled={submitting}>Close</Button>
                <Button variant="outline" onClick={() => setRejectTarget(active)} disabled={submitting}>
                  <XCircle className="h-4 w-4 mr-1" /> Reject
                </Button>
                <Button onClick={handleApprove} disabled={submitting}>
                  {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                  Approve & Send to Reception
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setActive(null)}>Close</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Eligibility</DialogTitle>
            <DialogDescription>
              The patient will be flagged for cash payment. This action is logged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Reason *</label>
              <Select value={rejectReason} onValueChange={setRejectReason}>
                <SelectTrigger><SelectValue placeholder="Select rejection reason" /></SelectTrigger>
                <SelectContent>
                  {REJECTION_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Notes</label>
              <Textarea value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} disabled={submitting}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={!rejectReason || submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}