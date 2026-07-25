import { useEffect, useMemo, useState } from 'react';
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
import { CheckCircle2, XCircle, ShieldCheck, Loader2, User, Phone, Clock, FileWarning, Camera, Upload, ImageIcon } from 'lucide-react';
import {
  useEligibilityVerifications, getEligibilitySnapUrl,
  type EligibilityVerification,
} from '@/hooks/useEligibilityVerifications';
import { usePatients } from '@/contexts/PatientContext';
import { useInsurance } from '@/hooks/useInsurance';
import { InAppCameraDialog } from '@/components/visit/InAppCameraDialog';
import { Label } from '@/components/ui/label';
import { DynamicMemberIdForm } from '@/components/insurance/DynamicMemberIdForm';
import {
  normaliseFields,
  derivePrimaryEnrolleeId,
  validateMemberFields,
  type ProviderField,
} from '@/lib/providerFields';

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
  const { pending, approved, rejected, loading, approveWithSnap, reject } = useEligibilityVerifications();
  const { getPatientById } = usePatients();
  const { providers } = useInsurance();

  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [active, setActive] = useState<EligibilityVerification | null>(null);
  const [rejectTarget, setRejectTarget] = useState<EligibilityVerification | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectNotes, setRejectNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // approval form state
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [memberData, setMemberData] = useState<Record<string, string>>({});
  const [memberErrors, setMemberErrors] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [receptionSnapUrl, setReceptionSnapUrl] = useState<string | null>(null);
  const [verifySnap, setVerifySnap] = useState<File | null>(null);
  const [verifySnapPreview, setVerifySnapPreview] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  const openReview = (row: EligibilityVerification) => {
    setActive(row);
    // Auto-pick provider: for NHIA/KATCHMA there is a single scheme; for HMO
    // use whatever Reception already recorded (if any).
    let providerId = row.provider_id || '';
    if (!providerId) {
      const type = row.sponsor_type === 'nhis' ? 'nhis' : row.sponsor_type;
      if (type === 'nhis' || type === 'katchma') {
        const p = providers.find((pp) => pp.type === type && pp.status === 'active');
        if (p) providerId = p.id;
      }
    }
    setSelectedProviderId(providerId);
    setMemberData({
      ...(row.member_id_data || {}),
      ...(row.verified_enrollee_id && !row.member_id_data?.enrollee_id
        ? { enrollee_id: row.verified_enrollee_id }
        : {}),
    });
    setMemberErrors({});
    setNotes(row.notes || '');
    setVerifySnap(null);
  };

  useEffect(() => {
    let mounted = true;
    if (active?.reception_snap_path) {
      getEligibilitySnapUrl(active.reception_snap_path).then((u) => { if (mounted) setReceptionSnapUrl(u); });
    } else {
      setReceptionSnapUrl(null);
    }
    return () => { mounted = false; };
  }, [active]);

  useEffect(() => {
    if (!verifySnap) { setVerifySnapPreview(null); return; }
    const u = URL.createObjectURL(verifySnap);
    setVerifySnapPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [verifySnap]);

  const currentList = tab === 'pending' ? pending : tab === 'approved' ? approved : rejected;

  const activeProvider = providers.find((p) => p.id === selectedProviderId) || null;
  const activeFields: ProviderField[] = activeProvider
    ? normaliseFields(activeProvider.member_id_fields)
    : [];
  const isHmoFlow = active?.sponsor_type === 'hmo';
  const hmoProviders = providers.filter((p) => p.type === 'hmo' && p.status === 'active');

  const handleApprove = async () => {
    if (!active) return;
    if (!activeProvider) {
      toast.error(isHmoFlow ? 'Select the HMO provider' : 'No provider configured for this scheme');
      return;
    }
    const { ok: validOk, errors } = validateMemberFields(activeFields, memberData);
    if (!validOk) {
      setMemberErrors(errors);
      toast.error('Fill the required member details');
      return;
    }
    const enrolleeId = derivePrimaryEnrolleeId(activeFields, memberData) || '';
    if (!enrolleeId) { toast.error('At least one member ID field must be filled'); return; }
    const providerName = activeProvider.name;
    setSubmitting(true);
    const ok = await approveWithSnap(active.id, {
      verified_provider_name: providerName,
      verified_enrollee_id: enrolleeId,
      provider_name: providerName,
      provider_id: activeProvider.id,
      enrollee_id: enrolleeId,
      member_id_data: memberData,
      notes: notes.trim() || null,
    } as any, verifySnap);
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
                          {patient
                            ? `${patient.first_name} ${patient.last_name || ''}`.trim()
                            : row.prospective_patient_name || 'Unknown patient'}
                        </span>
                        <Badge variant="outline" className="uppercase text-xs">{row.sponsor_type}</Badge>
                        {!row.patient_id && (
                          <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-700 border-blue-500/30">
                            Pre-registration
                          </Badge>
                        )}
                        <StatusBadge status={row.status} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-4 flex-wrap">
                        {patient?.card_number && <span>Card: <span className="font-mono">{patient.card_number}</span></span>}
                        {(patient?.phone || row.prospective_patient_phone) && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" /> {patient?.phone || row.prospective_patient_phone}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {format(new Date(row.created_at), 'MMM d, HH:mm')}
                        </span>
                        {(row.verified_provider_name || row.provider_name) && (
                          <span>Provider: <span className="font-medium text-foreground">{row.verified_provider_name || row.provider_name}</span></span>
                        )}
                        {(row.verified_enrollee_id || row.enrollee_id) && (
                          <span>Enrollee: <span className="font-mono text-foreground">{row.verified_enrollee_id || row.enrollee_id}</span></span>
                        )}
                      </div>
                      {row.insurance_details && (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          <span className="font-medium">Details:</span> {row.insurance_details}
                        </div>
                      )}
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
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
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
                      {patient
                        ? `${patient.first_name} ${patient.last_name || ''}`.trim()
                        : active.prospective_patient_name || 'Unknown patient'}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
                      {patient?.card_number && <span>Card: {patient.card_number}</span>}
                      {(patient?.phone || active.prospective_patient_phone) && (
                        <span>{patient?.phone || active.prospective_patient_phone}</span>
                      )}
                      <Badge variant="outline" className="uppercase text-xs">{active.sponsor_type}</Badge>
                      {!active.patient_id && (
                        <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-700 border-blue-500/30">
                          Pre-registration
                        </Badge>
                      )}
                      <StatusBadge status={active.status} />
                    </div>
                  </div>
                </Card>

                {/* Reception's snap */}
                {receptionSnapUrl && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium flex items-center gap-1">
                      <ImageIcon className="h-4 w-4" /> Insurance card from Reception
                    </label>
                    <a href={receptionSnapUrl} target="_blank" rel="noopener noreferrer" className="block">
                      <img src={receptionSnapUrl} alt="Insurance card" className="w-full max-h-72 object-contain rounded-lg border bg-muted/40" />
                    </a>
                    <p className="text-[11px] text-muted-foreground">Tap the image to open full size. Then sign into the provider portal to verify.</p>
                  </div>
                )}

                {active.insurance_details && (
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Details from Reception</label>
                    <div className="text-sm p-2 rounded-md bg-muted/40 border whitespace-pre-wrap">
                      {active.insurance_details}
                    </div>
                  </div>
                )}

                <div className="border-t pt-3 space-y-3">
                  <p className="text-sm font-semibold">Verified details</p>
                  {isHmoFlow && (
                    <div className="space-y-1.5">
                      <Label>HMO Provider *</Label>
                      <Select
                        value={selectedProviderId}
                        onValueChange={(v) => { setSelectedProviderId(v); setMemberData({}); setMemberErrors({}); }}
                        disabled={isReadOnly}
                      >
                        <SelectTrigger><SelectValue placeholder="Pick the HMO the patient belongs to" /></SelectTrigger>
                        <SelectContent>
                          {hmoProviders.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {!isHmoFlow && activeProvider && (
                    <div className="text-xs text-muted-foreground">
                      Scheme: <span className="font-medium text-foreground">{activeProvider.name}</span>
                    </div>
                  )}
                  {activeProvider ? (
                    activeFields.length > 0 ? (
                      <DynamicMemberIdForm
                        fields={activeFields}
                        values={memberData}
                        errors={memberErrors}
                        onChange={setMemberData}
                        disabled={isReadOnly}
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No member ID fields configured for this provider. Set them under Insurance Providers.
                      </p>
                    )
                  ) : (
                    !isHmoFlow && (
                      <p className="text-xs text-destructive">
                        No active {active.sponsor_type.toUpperCase()} provider configured. Create it under Insurance Providers first.
                      </p>
                    )
                  )}

                  {!isReadOnly && (
                    <div className="space-y-1.5">
                      <Label>Portal proof snap (optional)</Label>
                      {verifySnapPreview ? (
                        <div className="relative border rounded-lg overflow-hidden bg-muted/40">
                          <img src={verifySnapPreview} alt="Portal proof" className="w-full max-h-48 object-contain" />
                          <Button size="sm" variant="secondary" className="absolute top-2 right-2 h-7" onClick={() => setVerifySnap(null)}>
                            Change
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" className="flex-1" type="button" onClick={() => setCameraOpen(true)}>
                            <Camera className="h-4 w-4 mr-1" /> Camera
                          </Button>
                          <label className="flex-1">
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => setVerifySnap(e.target.files?.[0] || null)} />
                            <Button asChild variant="outline" size="sm" className="w-full">
                              <span><Upload className="h-4 w-4 mr-1" /> Upload</span>
                            </Button>
                          </label>
                        </div>
                      )}
                    </div>
                  )}
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

      <InAppCameraDialog
        open={cameraOpen}
        onCancel={() => setCameraOpen(false)}
        onCapture={(f) => { setVerifySnap(f); setCameraOpen(false); }}
      />

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