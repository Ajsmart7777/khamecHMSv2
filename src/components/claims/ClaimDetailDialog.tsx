import { useEffect, useMemo, useState } from 'react';
import { format, differenceInYears } from 'date-fns';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import {
  Loader2, X, Download, CheckCircle2, XCircle, HelpCircle, RotateCcw,
  FileText, Activity, Receipt, Paperclip, History, ShieldCheck, User, Phone, Calendar, KeyRound, Save,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Visit } from '@/hooks/useVisits';
import { usePatients, type Patient } from '@/contexts/PatientContext';
import { usePatientVisits } from '@/hooks/useVisits';
import { splitInvoice, sponsorLabel } from '@/lib/copay';
import { evaluateClaimRequirements, isReadyToSubmit } from '@/lib/claimRequirements';
import { ClaimDocsChecklist } from './ClaimDocsChecklist';
import { CopyButton } from './CopyButton';
import { ExpiryBadge } from './ExpiryBadge';
import {
  detectHmoCode, encounterCodeLabel, encounterCodePlaceholder,
  type SponsorAuth,
} from '@/lib/hmoAuth';
import { downloadClaimsPacketPdf } from '@/lib/claimsPacketPdf';
import { signedUrl } from '@/hooks/useVisitAttachments';
import { cn } from '@/lib/utils';

type Tab = 'summary' | 'clinical' | 'financial' | 'documents' | 'history';

export interface ClaimDetailDialogProps {
  visit: Visit | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSettle: (v: Visit) => void;
  onReject: (v: Visit) => void;
  onRequestInfo: (v: Visit) => void;
  onReopen: (v: Visit) => void;
}

interface Bundle {
  patient: any;
  invoices: any[];
  vitals: any[];
  prescriptions: any[];
  labs: any[];
  attachments: any[];
  emrAttachments: any[];
  audit: any[];
  provider: { name: string | null; hmo_code: string | null } | null;
}

export function ClaimDetailDialog({
  visit, open, onOpenChange, onSettle, onReject, onRequestInfo, onReopen,
}: ClaimDetailDialogProps) {
  const { getPatientById } = usePatients();
  const [tab, setTab] = useState<Tab>('summary');
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const patient = visit ? getPatientById(visit.patient_id) : null;

  useEffect(() => {
    if (!open || !visit) return;
    setTab('summary');
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [pRes, iRes, itRes, vRes, rxRes, rxIRes, lRes, aRes, eaRes, auRes, prRes] = await Promise.all([
          supabase.from('patients').select('*').eq('id', visit.patient_id).maybeSingle(),
          supabase.from('invoices').select('*').eq('visit_id', visit.id).order('created_at'),
          supabase.from('invoice_items').select('*'),
          supabase.from('vitals').select('*').eq('visit_id', visit.id).order('created_at', { ascending: false }),
          supabase.from('prescriptions').select('*').eq('visit_id', visit.id).order('created_at'),
          supabase.from('prescription_items').select('*'),
          supabase.from('lab_requests').select('*').eq('visit_id', visit.id).order('created_at'),
          supabase.from('visit_attachments').select('*').eq('visit_id', visit.id).order('captured_at', { ascending: false }),
          supabase.from('emr_attachments').select('*').eq('patient_id', visit.patient_id).order('created_at', { ascending: false }),
          supabase.rpc('get_visit_audit_trail', { _visit_id: visit.id }),
          supabase.from('insurance_providers').select('name, hmo_code'),
        ]);
        if (cancelled) return;
        const patientRow: any = pRes.data;
        const providers = (prRes.data ?? []) as Array<{ name: string; hmo_code: string | null }>;
        const providerName = patientRow?.insurance_provider ?? visit.insurance_plan ?? null;
        const matched = providerName
          ? providers.find((p) => p.name?.toLowerCase().trim() === String(providerName).toLowerCase().trim())
          : null;
        setBundle({
          patient: patientRow,
          invoices: (iRes.data ?? []).map((inv: any) => ({
            ...inv,
            items: (itRes.data ?? []).filter((it: any) => it.invoice_id === inv.id),
          })),
          vitals: vRes.data ?? [],
          prescriptions: (rxRes.data ?? []).map((rx: any) => ({
            ...rx,
            items: (rxIRes.data ?? []).filter((it: any) => it.prescription_id === rx.id),
          })),
          labs: lRes.data ?? [],
          attachments: aRes.data ?? [],
          emrAttachments: eaRes.data ?? [],
          audit: auRes.data ?? [],
          provider: matched ? { name: matched.name, hmo_code: matched.hmo_code } : null,
        });
      } catch (e: any) {
        toast.error(e?.message ?? 'Failed to load claim details');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, visit]);

  const requirements = useMemo(() => {
    if (!visit || !bundle || !patient) return [];
    const diagnosis =
      bundle.prescriptions.find((p: any) => p.diagnosis)?.diagnosis ??
      (visit.presenting_complaint || null);
    return evaluateClaimRequirements({
      visit,
      patient: { ...(patient as Patient), enrollee_id: bundle.patient?.enrollee_id ?? null },
      invoices: bundle.invoices,
      attachments: bundle.attachments,
      emrAttachments: bundle.emrAttachments,
      prescriptions: bundle.prescriptions,
      labs: bundle.labs,
      vitalsCount: bundle.vitals.length,
      diagnosis,
    });
  }, [visit, bundle, patient]);

  const ready = requirements.length > 0 && isReadyToSubmit(requirements);

  async function handleDownload() {
    if (!visit) return;
    setDownloading(true);
    try {
      await downloadClaimsPacketPdf(visit);
      toast.success('Claims packet downloaded');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to build packet');
    } finally {
      setDownloading(false);
    }
  }

  if (!visit) return null;

  const totalCharged = Number(visit.total_charged) || 0;
  const totalPaid = Number(visit.total_paid) || 0;
  const split = splitInvoice(totalCharged, {
    account_type: visit.sponsor_type ?? patient?.account_type,
    insurance_plan: visit.insurance_plan ?? patient?.insurance_plan,
  });
  const age = patient?.date_of_birth ? differenceInYears(new Date(), new Date(patient.date_of_birth)) : null;
  const enrolleeId = bundle?.patient?.enrollee_id ?? patient?.insurance_policy_number ?? null;

  const isTerminal = visit.claim_status === 'settled' || visit.claim_status === 'rejected';
  const canSettle = visit.claim_status === 'pending' || visit.claim_status === 'info_requested';
  const canReopen = visit.claim_status === 'rejected' || visit.claim_status === 'settled';

  const hmoCode = detectHmoCode({
    providerHmoCode: bundle?.provider?.hmo_code,
    providerName: bundle?.provider?.name ?? bundle?.patient?.insurance_provider ?? null,
    insurancePlan: visit.insurance_plan,
  });
  const codeLabel = encounterCodeLabel(hmoCode, visit.sponsor_type);
  const sponsorAuth: SponsorAuth = ((visit as any).sponsor_auth ?? {}) as SponsorAuth;
  const savedCode = sponsorAuth.code ?? '';

  const claimBadgeTone: Record<string, string> = {
    pending: 'bg-blue-100 text-blue-800',
    info_requested: 'bg-amber-100 text-amber-800',
    rejected: 'bg-red-100 text-red-800',
    settled: 'bg-emerald-100 text-emerald-800',
    not_applicable: 'bg-slate-100 text-slate-700',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[95vh] overflow-hidden p-0 bg-slate-50 border-none flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-bold truncate">
                  {patient ? `${patient.first_name} ${patient.last_name}` : 'Patient'}
                </h2>
                <Badge variant="outline" className="font-mono text-xs">
                  {patient?.card_number}
                </Badge>
                <Badge className={cn('capitalize', claimBadgeTone[visit.claim_status ?? 'pending'])}>
                  {(visit.claim_status ?? 'pending').replace('_', ' ')}
                </Badge>
              </div>
              <div className="mt-1 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                {age != null && <span className="flex items-center gap-1"><User className="h-3 w-3" />{age}y · {patient?.gender}</span>}
                {patient?.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{patient.phone}</span>}
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Visit {visit.visit_number} · {visit.closed_at ? format(new Date(visit.closed_at), 'MMM d, yyyy') : '—'}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="text-xs">{sponsorLabel({
                  account_type: visit.sponsor_type ?? patient?.account_type,
                  insurance_plan: visit.insurance_plan ?? patient?.insurance_plan,
                })}</Badge>
                {enrolleeId ? (
                  <Badge variant="outline" className="text-xs font-mono">Enrollee: {enrolleeId}</Badge>
                ) : (
                  <Badge variant="outline" className="text-xs border-amber-500 text-amber-700">No enrollee ID</Badge>
                )}
                {visit.claim_reason_code && (
                  <Badge variant="outline" className="text-xs">{visit.claim_reason_code.replace(/_/g, ' ')}</Badge>
                )}
                {(canSettle || !isTerminal) && <ExpiryBadge openedAt={visit.opened_at} />}
              </div>
              <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="uppercase">Patient ID</span>
                  <span className="font-mono text-foreground">{patient?.card_number ?? '—'}</span>
                  <CopyButton value={patient?.card_number} label="Patient ID" />
                </span>
                <span className="flex items-center gap-1">
                  <span className="uppercase">Visit</span>
                  <span className="font-mono text-foreground">{visit.visit_number}</span>
                  <CopyButton value={visit.visit_number} label="Visit number" />
                </span>
                <span className="flex items-center gap-1">
                  <span className="uppercase">Bill Total</span>
                  <span className="text-foreground">₦{totalCharged.toLocaleString()}</span>
                  <CopyButton value={String(totalCharged)} label="Bill total" />
                </span>
                {savedCode && (
                  <span className="flex items-center gap-1">
                    <span className="uppercase">Code</span>
                    <span className="font-mono text-foreground">{savedCode}</span>
                    <CopyButton value={savedCode} label={codeLabel} />
                  </span>
                )}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* HMO Encounter / Pre-Auth Code panel */}
          {(visit.sponsor_type ?? '').toLowerCase() === 'hmo' || hmoCode ? (
            <EncounterCodePanel
              visitId={visit.id}
              label={codeLabel}
              placeholder={encounterCodePlaceholder(hmoCode)}
              initial={sponsorAuth}
              readOnly={isTerminal}
            />
          ) : null}

          {/* Financial summary strip */}
          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="bg-slate-100 rounded p-2">
              <p className="text-[10px] uppercase text-muted-foreground">Total</p>
              <p className="text-sm font-bold">₦{totalCharged.toLocaleString()}</p>
            </div>
            <div className="bg-emerald-50 rounded p-2">
              <p className="text-[10px] uppercase text-muted-foreground">Sponsor</p>
              <p className="text-sm font-bold text-emerald-700">₦{split.coveredAmount.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">{100 - split.copayPct}%</p>
            </div>
            <div className="bg-orange-50 rounded p-2">
              <p className="text-[10px] uppercase text-muted-foreground">Patient copay</p>
              <p className="text-sm font-bold text-orange-700">₦{split.copayAmount.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">{split.copayPct}%</p>
            </div>
            <div className={cn('rounded p-2', totalPaid >= split.copayAmount ? 'bg-emerald-50' : 'bg-amber-50')}>
              <p className="text-[10px] uppercase text-muted-foreground">Collected</p>
              <p className="text-sm font-bold">₦{totalPaid.toLocaleString()}</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {requirements.length > 0 && (
                ready ? (
                  <span className="flex items-center gap-1 text-emerald-700">
                    <CheckCircle2 className="h-3 w-3" /> All required documents present
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-amber-700">
                    <XCircle className="h-3 w-3" /> Complete required documents (see Documents tab)
                  </span>
                )
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={handleDownload} disabled={downloading}>
                {downloading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
                Packet
              </Button>
              {canSettle && (
                <>
                  <Button
                    size="sm" variant="outline"
                    className="border-amber-500 text-amber-700 hover:bg-amber-50"
                    onClick={() => onRequestInfo(visit)}
                  >
                    <HelpCircle className="h-3 w-3 mr-1" /> Request Info
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    className="border-red-500 text-red-700 hover:bg-red-50"
                    onClick={() => onReject(visit)}
                  >
                    <XCircle className="h-3 w-3 mr-1" /> Reject
                  </Button>
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
                    onClick={() => onSettle(visit)}
                    disabled={!ready}
                    title={ready ? 'Mark this claim as settled' : 'Complete required documents first'}
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Mark Settled
                  </Button>
                </>
              )}
              {canReopen && (
                <Button size="sm" variant="outline" onClick={() => onReopen(visit)}>
                  <RotateCcw className="h-3 w-3 mr-1" /> Reopen
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Tabs body */}
        <div className="overflow-y-auto flex-1 p-4">
          {loading || !bundle ? (
            <div className="text-center py-12 text-muted-foreground">
              <Loader2 className="h-6 w-6 mx-auto animate-spin mb-2" />
              Loading claim details…
            </div>
          ) : (
            <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
              <TabsList className="mb-4">
                <TabsTrigger value="summary" className="gap-1"><FileText className="h-3 w-3" /> Summary</TabsTrigger>
                <TabsTrigger value="clinical" className="gap-1"><Activity className="h-3 w-3" /> Clinical</TabsTrigger>
                <TabsTrigger value="financial" className="gap-1"><Receipt className="h-3 w-3" /> Financial</TabsTrigger>
                <TabsTrigger value="documents" className="gap-1"><Paperclip className="h-3 w-3" /> Documents</TabsTrigger>
                <TabsTrigger value="history" className="gap-1"><History className="h-3 w-3" /> History</TabsTrigger>
              </TabsList>

              <TabsContent value="summary" className="space-y-3 mt-0">
                <SummaryTab visit={visit} bundle={bundle} />
              </TabsContent>
              <TabsContent value="clinical" className="space-y-3 mt-0">
                <ClinicalTab bundle={bundle} />
              </TabsContent>
              <TabsContent value="financial" className="space-y-3 mt-0">
                <FinancialTab visit={visit} bundle={bundle} split={split} totalPaid={totalPaid} />
              </TabsContent>
              <TabsContent value="documents" className="space-y-3 mt-0">
                <ClaimDocsChecklist requirements={requirements} />
                <DocumentsTab bundle={bundle} />
              </TabsContent>
              <TabsContent value="history" className="space-y-3 mt-0">
                <SponsorHistoryTab
                  patientId={visit.patient_id}
                  currentVisitId={visit.id}
                  sponsorType={visit.sponsor_type}
                />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// -------- Summary --------
function SummaryTab({ visit, bundle }: { visit: Visit; bundle: Bundle }) {
  const dx = bundle.prescriptions.find((p: any) => p.diagnosis)?.diagnosis ?? visit.presenting_complaint ?? '—';
  const doctors = Array.from(new Set(
    bundle.audit
      .filter((a: any) => a.action?.includes('doctor') || a.action?.includes('prescription'))
      .map((a: any) => a.user_id)
      .filter(Boolean)
  ));
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Card className="p-4 space-y-2">
        <h4 className="text-sm font-semibold">Presenting complaint</h4>
        <p className="text-sm text-muted-foreground">{visit.presenting_complaint || '—'}</p>
        <Separator />
        <h4 className="text-sm font-semibold">Diagnosis</h4>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{dx}</p>
      </Card>
      <Card className="p-4 space-y-2">
        <h4 className="text-sm font-semibold">Visit outcome</h4>
        <div className="text-sm space-y-1">
          <div>Opened: <span className="text-muted-foreground">{format(new Date(visit.opened_at), 'MMM d, yyyy HH:mm')}</span></div>
          <div>Closed: <span className="text-muted-foreground">{visit.closed_at ? format(new Date(visit.closed_at), 'MMM d, yyyy HH:mm') : '—'}</span></div>
          <div>Rx count: <span className="text-muted-foreground">{bundle.prescriptions.length}</span></div>
          <div>Lab requests: <span className="text-muted-foreground">{bundle.labs.length}</span></div>
          <div>Vitals records: <span className="text-muted-foreground">{bundle.vitals.length}</span></div>
          <div>Clinicians involved: <span className="text-muted-foreground">{doctors.length || '—'}</span></div>
        </div>
      </Card>
    </div>
  );
}

// -------- Encounter Code panel --------
function EncounterCodePanel({
  visitId, label, placeholder, initial, readOnly,
}: {
  visitId: string;
  label: string;
  placeholder: string;
  initial: SponsorAuth;
  readOnly?: boolean;
}) {
  const [code, setCode] = useState(initial.code ?? '');
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [saving, setSaving] = useState(false);
  const dirty = (code ?? '') !== (initial.code ?? '') || (notes ?? '') !== (initial.notes ?? '');

  useEffect(() => {
    setCode(initial.code ?? '');
    setNotes(initial.notes ?? '');
  }, [initial.code, initial.notes, visitId]);

  async function handleSave() {
    setSaving(true);
    try {
      const payload: SponsorAuth = {
        code: code.trim() || undefined,
        notes: notes.trim() || undefined,
        captured_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('visits')
        .update({
          sponsor_auth: payload as any,
          sponsor_auth_captured_at: new Date().toISOString(),
        } as any)
        .eq('id', visitId);
      if (error) throw error;
      toast.success('Encounter code saved');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not save code');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-blue-200 bg-blue-50/40 p-3">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-semibold text-blue-900">
          <KeyRound className="h-4 w-4" />
          {label}
        </div>
        {initial.captured_at && (
          <span className="text-[10px] text-muted-foreground">
            Last updated {format(new Date(initial.captured_at), 'MMM d, yyyy HH:mm')}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr,1fr,auto] gap-2 items-start">
        <div className="flex items-center gap-1">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={placeholder}
            disabled={readOnly}
            className="font-mono"
          />
          <CopyButton value={code} label={label} />
        </div>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes for the sponsor portal (optional)"
          rows={1}
          disabled={readOnly}
          className="min-h-[38px]"
        />
        <Button
          size="sm"
          onClick={handleSave}
          disabled={readOnly || saving || !dirty}
          className="whitespace-nowrap"
        >
          {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
          Save code
        </Button>
      </div>
    </div>
  );
}

// -------- Clinical --------
function ClinicalTab({ bundle }: { bundle: Bundle }) {
  return (
    <div className="space-y-3">
      <Card className="p-4">
        <h4 className="text-sm font-semibold mb-2">Vitals ({bundle.vitals.length})</h4>
        {bundle.vitals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No vitals recorded for this visit.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr><th className="text-left p-1">When</th><th className="text-left p-1">Temp</th><th className="text-left p-1">BP</th><th className="text-left p-1">Pulse</th><th className="text-left p-1">RR</th><th className="text-left p-1">Wt/Ht</th></tr>
              </thead>
              <tbody>
                {bundle.vitals.map((v: any) => (
                  <tr key={v.id} className="border-t">
                    <td className="p-1">{format(new Date(v.created_at), 'MMM d HH:mm')}</td>
                    <td className="p-1">{v.temperature ?? '—'}</td>
                    <td className="p-1">{v.blood_pressure ?? '—'}</td>
                    <td className="p-1">{v.pulse ?? '—'}</td>
                    <td className="p-1">{v.respiratory_rate ?? '—'}</td>
                    <td className="p-1">{v.weight ?? '—'} / {v.height ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h4 className="text-sm font-semibold mb-2">Prescriptions ({bundle.prescriptions.length})</h4>
        {bundle.prescriptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No prescriptions issued.</p>
        ) : (
          <div className="space-y-3">
            {bundle.prescriptions.map((rx: any) => (
              <div key={rx.id} className="border rounded p-2 text-sm">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>{format(new Date(rx.created_at), 'MMM d, yyyy HH:mm')}</span>
                  <Badge variant="outline" className="text-[10px]">{rx.status}</Badge>
                </div>
                {rx.diagnosis && <p className="text-xs mb-1"><span className="font-semibold">Dx:</span> {rx.diagnosis}</p>}
                <ul className="text-xs space-y-0.5">
                  {(rx.items ?? []).map((it: any) => (
                    <li key={it.id}>
                      • <span className="font-medium">{it.medication}</span> — {it.dosage}, {it.frequency}, {it.duration} · qty {it.quantity}
                      {it.dispensed && <Badge variant="outline" className="ml-2 text-[9px]">dispensed</Badge>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h4 className="text-sm font-semibold mb-2">Lab requests ({bundle.labs.length})</h4>
        {bundle.labs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lab requests.</p>
        ) : (
          <div className="space-y-2">
            {bundle.labs.map((l: any) => (
              <div key={l.id} className="border rounded p-2 text-sm">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span className="font-mono">{l.request_number}</span>
                  <Badge variant="outline" className="text-[10px]">{l.status}</Badge>
                </div>
                <p className="text-xs mt-1">{(l.tests ?? []).join(', ')}</p>
                {l.diagnosis && <p className="text-xs text-muted-foreground mt-1">Dx: {l.diagnosis}</p>}
                {l.results && (
                  <pre className="mt-1 text-[11px] whitespace-pre-wrap bg-slate-50 p-2 rounded">
                    {typeof l.results === 'string' ? l.results : JSON.stringify(l.results, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// -------- Financial --------
function FinancialTab({
  visit, bundle, split, totalPaid,
}: { visit: Visit; bundle: Bundle; split: ReturnType<typeof splitInvoice>; totalPaid: number }) {
  return (
    <div className="space-y-3">
      <Card className="p-4">
        <h4 className="text-sm font-semibold mb-2">Invoices ({bundle.invoices.length})</h4>
        {bundle.invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices on this visit.</p>
        ) : (
          <div className="space-y-4">
            {bundle.invoices.map((inv: any) => (
              <div key={inv.id} className="border rounded">
                <div className="flex justify-between items-center p-2 bg-slate-50 border-b">
                  <div>
                    <p className="text-sm font-mono">{inv.invoice_number}</p>
                    <p className="text-[10px] text-muted-foreground">{format(new Date(inv.created_at), 'MMM d, yyyy HH:mm')}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{inv.status}</Badge>
                </div>
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr><th className="text-left p-2">Item</th><th className="text-left p-2">Qty</th><th className="text-right p-2">Unit</th><th className="text-right p-2">Total</th></tr>
                  </thead>
                  <tbody>
                    {(inv.items ?? []).map((it: any) => (
                      <tr key={it.id} className="border-t">
                        <td className="p-2">{it.description}</td>
                        <td className="p-2">{it.quantity}</td>
                        <td className="p-2 text-right">₦{Number(it.unit_price).toLocaleString()}</td>
                        <td className="p-2 text-right">₦{Number(it.total).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="font-semibold">
                    <tr className="border-t bg-slate-50">
                      <td colSpan={3} className="p-2 text-right">Total</td>
                      <td className="p-2 text-right">₦{Number(inv.total_amount).toLocaleString()}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h4 className="text-sm font-semibold mb-2">Sponsor split</h4>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div><p className="text-xs text-muted-foreground">Sponsor covers</p><p className="text-lg font-bold text-emerald-700">₦{split.coveredAmount.toLocaleString()}</p></div>
          <div><p className="text-xs text-muted-foreground">Patient copay</p><p className="text-lg font-bold text-orange-700">₦{split.copayAmount.toLocaleString()}</p></div>
          <div><p className="text-xs text-muted-foreground">Copay collected</p><p className="text-lg font-bold">₦{totalPaid.toLocaleString()}</p></div>
        </div>
        {totalPaid < split.copayAmount && split.copayAmount > 0 && (
          <p className="text-xs text-amber-700 mt-2">
            Copay short by ₦{(split.copayAmount - totalPaid).toLocaleString()} — cashier must collect before submitting.
          </p>
        )}
      </Card>

      <Card className="p-4">
        <h4 className="text-sm font-semibold mb-2">Audit trail ({bundle.audit.length})</h4>
        {bundle.audit.length === 0 ? (
          <p className="text-sm text-muted-foreground">No audit entries.</p>
        ) : (
          <ul className="space-y-1 text-xs max-h-64 overflow-y-auto">
            {bundle.audit.map((a: any) => (
              <li key={a.id} className="border-b py-1">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{a.action}</span>
                  <span className="text-muted-foreground">{format(new Date(a.created_at), 'MMM d HH:mm')}</span>
                </div>
                <p className="text-muted-foreground">{a.resource_type} · {a.status}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// -------- Documents --------
function DocumentsTab({ bundle }: { bundle: Bundle }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    (async () => {
      const entries = await Promise.all(
        bundle.attachments.map(async (a: any) => [a.id, (await signedUrl(a.storage_path)) ?? ''] as const)
      );
      setUrls(Object.fromEntries(entries));
    })();
  }, [bundle.attachments]);

  return (
    <>
      <Card className="p-4">
        <h4 className="text-sm font-semibold mb-2">Visit attachments ({bundle.attachments.length})</h4>
        {bundle.attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No attachments captured on this visit.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {bundle.attachments.map((a: any) => (
              <a key={a.id} href={urls[a.id]} target="_blank" rel="noreferrer" className="block border rounded overflow-hidden hover:ring-2 hover:ring-primary">
                {urls[a.id] ? (
                  <img src={urls[a.id]} alt={a.label ?? a.station} className="w-full h-24 object-cover" />
                ) : (
                  <div className="h-24 flex items-center justify-center bg-slate-100">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                )}
                <div className="p-1 text-[10px]">
                  <p className="truncate font-medium">{a.label || a.station}</p>
                  <p className="text-muted-foreground">{format(new Date(a.captured_at), 'MMM d HH:mm')}</p>
                </div>
              </a>
            ))}
          </div>
        )}
      </Card>

      {bundle.emrAttachments.length > 0 && (
        <Card className="p-4">
          <h4 className="text-sm font-semibold mb-2">Patient EMR files ({bundle.emrAttachments.length})</h4>
          <ul className="space-y-1 text-sm">
            {bundle.emrAttachments.map((a: any) => (
              <li key={a.id} className="flex justify-between border-b pb-1">
                <span>
                  <Badge variant="outline" className="mr-2 text-[10px]">{a.category}</Badge>
                  {a.file_name}
                </span>
                <span className="text-xs text-muted-foreground">{format(new Date(a.created_at), 'MMM d, yyyy')}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

// -------- Sponsor-scoped History --------
function SponsorHistoryTab({
  patientId, currentVisitId, sponsorType,
}: { patientId: string; currentVisitId: string; sponsorType: string | null }) {
  const { visits, loading } = usePatientVisits(patientId);
  const scoped = useMemo(
    () => visits.filter((v) => v.id !== currentVisitId && v.sponsor_type === sponsorType),
    [visits, currentVisitId, sponsorType]
  );

  if (loading) {
    return <div className="text-sm text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin mr-1" /> Loading…</div>;
  }

  return (
    <Card className="p-4">
      <h4 className="text-sm font-semibold mb-1">Prior {sponsorType?.toUpperCase() || 'sponsor'} visits</h4>
      <p className="text-xs text-muted-foreground mb-3">
        Only visits billed under this sponsor are shown. Cash and other sponsors are hidden.
      </p>
      {scoped.length === 0 ? (
        <p className="text-sm text-muted-foreground">No prior claims for this sponsor.</p>
      ) : (
        <ul className="divide-y">
          {scoped.map((v) => (
            <li key={v.id} className="py-2 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-mono">{v.visit_number}</p>
                <p className="text-xs text-muted-foreground">
                  {v.closed_at ? format(new Date(v.closed_at), 'MMM d, yyyy') : format(new Date(v.opened_at), 'MMM d, yyyy')}
                  {v.insurance_plan && ` · ${v.insurance_plan}`}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold">₦{Number(v.total_charged).toLocaleString()}</p>
                <Badge variant="outline" className="text-[10px] capitalize">
                  {(v.claim_status ?? v.status).replace('_', ' ')}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}