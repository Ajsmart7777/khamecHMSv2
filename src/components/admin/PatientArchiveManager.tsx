import { useCallback, useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import { format } from 'date-fns';
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileArchive,
  FileCheck2,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { createArchiveLedgerPdf } from '@/lib/archiveLedgerPdf';
import { deleteFile, getFileUrl, type StorageBucket } from '@/lib/storage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type ArchiveAttachment = {
  bucket: 'visit-cards' | 'emr-attachments' | 'external-url';
  path: string;
  source?: string;
};

type ArchiveEligibility = {
  patient_id: string;
  patient_card_number: string | null;
  patient_name: string;
  is_eligible: boolean;
  reasons: string[] | null;
  closed_at: string | null;
  row_counts: Record<string, number> | null;
  attachment_paths: ArchiveAttachment[] | string | null;
  case_fingerprint: string | null;
};

type Candidate = ArchiveEligibility & {
  patient: any;
  journeyUpdatedAt?: string | null;
};

type ArchiveRecordRow = {
  patient_id: string;
  patient_card_number: string;
  patient_name: string;
  archive_reference: string;
  status: 'pending_download' | 'download_confirmed' | 'purged';
  archived_at: string;
  attachment_paths: ArchiveAttachment[] | string | null;
};

type ArchiveBatch = {
  reference: string;
  status: ArchiveRecordRow['status'];
  archivedAt: string;
  patients: Array<{
    id: string;
    name: string;
    cardNumber: string;
    attachments: ArchiveAttachment[];
  }>;
};

type ProgressState = {
  label: string;
  current: number;
  total: number;
} | null;

const rpc = supabase.rpc as unknown as (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: any; error: { message?: string } | null }>;

function normaliseAttachments(value: ArchiveAttachment[] | string | null | undefined): ArchiveAttachment[] {
  if (Array.isArray(value)) return value.filter((entry) => entry?.path && entry?.bucket) as ArchiveAttachment[];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? normaliseAttachments(parsed) : [];
  } catch {
    return [];
  }
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') || 'file';
}

function archiveReferenceForNow() {
  const stamp = format(new Date(), 'yyyyMMdd-HHmmss');
  return `KMC-ARCHIVE-${stamp}`;
}

function prettyDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : format(date, 'dd MMM yyyy, HH:mm');
}

function countSummary(counts: Record<string, number> | null | undefined) {
  if (!counts) return 'No case count available';
  const ordered = ['visits', 'invoices', 'prescriptions', 'lab_requests', 'snap_orders', 'attachments'];
  return ordered
    .filter((key) => Number(counts[key] ?? 0) > 0)
    .map((key) => `${counts[key]} ${key.replace('_', ' ')}`)
    .join(' · ') || 'No detailed records';
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function sha256(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, '0')).join('');
}

function attachmentArchivePath(patient: any, attachment: ArchiveAttachment) {
  const patientDirectory = `${safeName(`${patient.card_number ?? 'patient'}_${patient.first_name ?? ''}_${patient.last_name ?? ''}`)}`;
  const sourcePath = attachment.path.split('/').filter(Boolean).map(safeName).join('/') || 'attachment';
  return `attachments/${patientDirectory}/${safeName(attachment.bucket)}/${sourcePath}`;
}

async function resolveAttachmentUrl(attachment: ArchiveAttachment): Promise<string | null> {
  if (!attachment.path) return null;
  if (attachment.bucket === 'external-url') return attachment.path;
  return getFileUrl(attachment.bucket as StorageBucket, attachment.path, 7_200);
}

async function fetchArchivePatientData(patientId: string) {
  const [patientResult, visitsResult, vitalsResult, attachmentsResult, snapsResult, invoicesResult, admissionsResult] = await Promise.all([
    supabase.from('patients').select('*').eq('id', patientId).single(),
    supabase.from('visits').select('*').eq('patient_id', patientId).order('opened_at', { ascending: true }),
    supabase.from('vitals').select('*').eq('patient_id', patientId).order('created_at', { ascending: true }),
    supabase.from('visit_attachments').select('*').eq('patient_id', patientId).order('created_at', { ascending: true }),
    supabase.from('snap_orders').select('*').eq('patient_id', patientId).order('created_at', { ascending: true }),
    supabase.from('invoices').select('*, invoice_items(*)').eq('patient_id', patientId).order('created_at', { ascending: true }),
    supabase.from('admissions').select('*, wards(name), beds(bed_number), rooms(room_number)').eq('patient_id', patientId).order('created_at', { ascending: true }),
  ]);

  const error = [patientResult.error, visitsResult.error, vitalsResult.error, attachmentsResult.error, snapsResult.error, invoicesResult.error, admissionsResult.error].find(Boolean);
  if (error) throw new Error(error.message);
  if (!patientResult.data) throw new Error('Patient identity could not be loaded');
  return {
    patient: patientResult.data,
    visits: visitsResult.data ?? [],
    vitals: vitalsResult.data ?? [],
    visitAttachments: attachmentsResult.data ?? [],
    snapOrders: snapsResult.data ?? [],
    invoices: invoicesResult.data ?? [],
    admissions: admissionsResult.data ?? [],
  };
}

export function PatientArchiveManager() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [archiveReference, setArchiveReference] = useState(archiveReferenceForNow);
  const [archiveBatches, setArchiveBatches] = useState<ArchiveBatch[]>([]);
  const [activeBatch, setActiveBatch] = useState<ArchiveBatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [purging, setPurging] = useState(false);
  const [progress, setProgress] = useState<ProgressState>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);
  const [typedReference, setTypedReference] = useState('');
  const [showBlocked, setShowBlocked] = useState(false);

  const loadBatches = useCallback(async () => {
    const { data, error } = await (supabase.from('patient_archive_records' as any) as any)
      .select('patient_id, patient_card_number, patient_name, archive_reference, status, archived_at, attachment_paths')
      .order('archived_at', { ascending: false })
      .limit(250);
    if (error) throw error;

    const grouped = new Map<string, ArchiveBatch>();
    ((data ?? []) as ArchiveRecordRow[]).forEach((record) => {
      const batch = grouped.get(record.archive_reference) ?? {
        reference: record.archive_reference,
        status: record.status,
        archivedAt: record.archived_at,
        patients: [],
      };
      batch.patients.push({
        id: record.patient_id,
        name: record.patient_name,
        cardNumber: record.patient_card_number,
        attachments: normaliseAttachments(record.attachment_paths),
      });
      if (record.status === 'purged' || (record.status === 'download_confirmed' && batch.status === 'pending_download')) batch.status = record.status;
      grouped.set(record.archive_reference, batch);
    });
    setArchiveBatches([...grouped.values()]);
  }, []);

  const loadCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const { data: journeys, error: journeysError } = await supabase
        .from('patient_journey')
        .select('patient_id, updated_at')
        .eq('current_state', 'discharged')
        .order('updated_at', { ascending: false })
        .limit(250);
      if (journeysError) throw journeysError;

      const latestJourneyByPatient = new Map<string, string | null>();
      (journeys ?? []).forEach((journey: any) => {
        if (journey.patient_id && !latestJourneyByPatient.has(journey.patient_id)) latestJourneyByPatient.set(journey.patient_id, journey.updated_at ?? null);
      });
      const ids = [...latestJourneyByPatient.keys()];
      if (!ids.length) {
        setCandidates([]);
        setSelectedIds(new Set());
        await loadBatches();
        return;
      }

      const [{ data: patients, error: patientsError }, eligibilityResult] = await Promise.all([
        supabase.from('patients').select('*').in('id', ids),
        rpc('check_archive_eligibility', { _patient_ids: ids }),
      ]);
      if (patientsError) throw patientsError;
      if (eligibilityResult.error) throw new Error(eligibilityResult.error.message ?? 'Eligibility check failed');
      const patientById = new Map((patients ?? []).map((patient: any) => [patient.id, patient]));
      const nextCandidates = ((eligibilityResult.data ?? []) as ArchiveEligibility[])
        .map((eligibility) => ({ ...eligibility, patient: patientById.get(eligibility.patient_id), journeyUpdatedAt: latestJourneyByPatient.get(eligibility.patient_id) }))
        .filter((candidate) => candidate.patient)
        .sort((a, b) => Number(b.is_eligible) - Number(a.is_eligible) || String(b.closed_at ?? '').localeCompare(String(a.closed_at ?? '')));
      setCandidates(nextCandidates);
      setSelectedIds((current) => new Set([...current].filter((id) => nextCandidates.some((candidate) => candidate.patient_id === id && candidate.is_eligible))));
      await loadBatches();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load archive candidates');
    } finally {
      setLoading(false);
    }
  }, [loadBatches]);

  useEffect(() => { void loadCandidates(); }, [loadCandidates]);

  const eligibleCandidates = useMemo(() => candidates.filter((candidate) => candidate.is_eligible), [candidates]);
  const selectedCandidates = useMemo(() => candidates.filter((candidate) => selectedIds.has(candidate.patient_id)), [candidates, selectedIds]);
  const selectedCount = selectedCandidates.length;
  const allEligibleSelected = eligibleCandidates.length > 0 && eligibleCandidates.every((candidate) => selectedIds.has(candidate.patient_id));
  const progressPercent = progress ? Math.round((progress.current / Math.max(progress.total, 1)) * 100) : 0;

  const togglePatient = (patientId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      checked ? next.add(patientId) : next.delete(patientId);
      return next;
    });
  };

  const toggleAllEligible = (checked: boolean) => {
    setSelectedIds(checked ? new Set(eligibleCandidates.map((candidate) => candidate.patient_id)) : new Set());
  };

  const refreshCandidates = () => void loadCandidates();

  const prepareArchive = async () => {
    const reference = archiveReference.trim();
    if (!reference) {
      toast.error('Enter an archive reference before preparing the ZIP.');
      return;
    }
    if (!selectedCandidates.length) {
      toast.error('Select at least one eligible discharged patient.');
      return;
    }

    setPreparing(true);
    setProgress({ label: 'Rechecking archive eligibility', current: 0, total: selectedCandidates.length + 1 });
    try {
      const eligibilityResult = await rpc('check_archive_eligibility', { _patient_ids: selectedCandidates.map((candidate) => candidate.patient_id) });
      if (eligibilityResult.error) throw new Error(eligibilityResult.error.message ?? 'Eligibility check failed');
      const currentEligibility = (eligibilityResult.data ?? []) as ArchiveEligibility[];
      const blocked = currentEligibility.filter((entry) => !entry.is_eligible || !entry.case_fingerprint);
      if (blocked.length) {
        setCandidates((current) => current.map((candidate) => ({ ...candidate, ...(currentEligibility.find((entry) => entry.patient_id === candidate.patient_id) ?? {}) })));
        throw new Error(`Archive stopped: ${blocked.map((entry) => `${entry.patient_name}: ${(entry.reasons ?? ['no longer eligible']).join('; ')}`).join(' | ')}`);
      }

      const refreshed = new Map(currentEligibility.map((entry) => [entry.patient_id, entry]));
      const zip = new JSZip();
      const preparedManifests: any[] = [];
      const globalManifest: any = {
        archive_format: 'khamec-hms-patient-ledger-archive',
        format_version: 1,
        archive_reference: reference,
        generated_at: new Date().toISOString(),
        encryption: 'none',
        patient_count: selectedCandidates.length,
        patients: [],
      };

      for (let index = 0; index < selectedCandidates.length; index += 1) {
        const candidate = selectedCandidates[index];
        const eligibility = refreshed.get(candidate.patient_id)!;
        setProgress({ label: `Building ledger PDF for ${candidate.patient_name}`, current: index + 1, total: selectedCandidates.length + 1 });
        const data = await fetchArchivePatientData(candidate.patient_id);
        const attachments = normaliseAttachments(eligibility.attachment_paths);
        const imageUrls: Record<string, string> = {};
        for (const attachment of attachments) {
          const url = await resolveAttachmentUrl(attachment);
          if (url) imageUrls[attachment.path] = url;
        }

        const pdf = await createArchiveLedgerPdf({ ...data, imageUrls, archiveReference: reference });
        const patientFolder = `${safeName(`${data.patient.card_number}_${data.patient.first_name}_${data.patient.last_name}`)}`;
        const pdfPath = `ledgers/${patientFolder}/${pdf.filename}`;
        zip.file(pdfPath, pdf.blob);
        const patientFiles: any[] = [{
          kind: 'ledger_pdf',
          archive_path: pdfPath,
          original_path: null,
          bucket: null,
          bytes: pdf.blob.size,
          sha256: await sha256(pdf.blob),
        }];

        for (const attachment of attachments) {
          const url = await resolveAttachmentUrl(attachment);
          if (!url) throw new Error(`Attachment URL could not be prepared: ${attachment.source ?? attachment.path}`);
          let response: Response;
          try {
            response = await fetch(url);
          } catch (error) {
            throw new Error(`Attachment download failed for ${candidate.patient_name}: ${attachment.path}. ${error instanceof Error ? error.message : ''}`);
          }
          if (!response.ok) throw new Error(`Attachment download failed for ${candidate.patient_name}: ${attachment.path} (HTTP ${response.status})`);
          const blob = await response.blob();
          const archivePath = attachmentArchivePath(data.patient, attachment);
          zip.file(archivePath, blob);
          patientFiles.push({
            kind: 'original_attachment',
            archive_path: archivePath,
            original_path: attachment.path,
            bucket: attachment.bucket,
            source: attachment.source ?? null,
            content_type: blob.type || null,
            bytes: blob.size,
            sha256: await sha256(blob),
          });
        }

        const patientManifest = {
          patient_id: candidate.patient_id,
          patient_name: candidate.patient_name,
          patient_card_number: candidate.patient_card_number,
          case_closed_at: eligibility.closed_at,
          case_fingerprint: eligibility.case_fingerprint,
          row_counts: eligibility.row_counts ?? {},
          attachment_count: attachments.length,
          files: patientFiles,
        };
        zip.file(`manifests/${patientFolder}.json`, JSON.stringify(patientManifest, null, 2));
        globalManifest.patients.push(patientManifest);
        preparedManifests.push({ patient_id: candidate.patient_id, case_fingerprint: eligibility.case_fingerprint, manifest: patientManifest });
      }

      zip.file('manifest.json', JSON.stringify(globalManifest, null, 2));
      setProgress({ label: 'Compressing verified archive ZIP', current: selectedCandidates.length, total: selectedCandidates.length + 1 });
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });

      setProgress({ label: 'Recording prepared archive safeguards', current: selectedCandidates.length + 1, total: selectedCandidates.length + 1 });
      const prepareResult = await rpc('prepare_patient_archive', {
        _archive_reference: reference,
        _archives: preparedManifests,
      });
      if (prepareResult.error) throw new Error(prepareResult.error.message ?? 'Archive safety record could not be created');

      triggerDownload(zipBlob, `${safeName(reference)}.zip`);
      const batch: ArchiveBatch = {
        reference,
        status: 'pending_download',
        archivedAt: new Date().toISOString(),
        patients: selectedCandidates.map((candidate) => ({
          id: candidate.patient_id,
          name: candidate.patient_name,
          cardNumber: candidate.patient_card_number ?? '—',
          attachments: normaliseAttachments(refreshed.get(candidate.patient_id)?.attachment_paths ?? null),
        })),
      };
      setActiveBatch(batch);
      setArchiveReference(archiveReferenceForNow());
      setSelectedIds(new Set());
      toast.success(`Archive ZIP prepared for ${batch.patients.length} patient${batch.patients.length === 1 ? '' : 's'}. Save and open it before confirming.`);
      await loadBatches();
      await loadCandidates();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Archive preparation failed. No records were cleared.');
    } finally {
      setProgress(null);
      setPreparing(false);
    }
  };

  const confirmDownload = async () => {
    if (!activeBatch) return;
    if (typedReference.trim() !== activeBatch.reference) {
      toast.error('Type the exact archive reference to confirm that the ZIP was saved and opened.');
      return;
    }
    setConfirming(true);
    try {
      const { error } = await rpc('confirm_archive_download', { _archive_reference: activeBatch.reference });
      if (error) throw new Error(error.message ?? 'Archive confirmation failed');
      const confirmed = { ...activeBatch, status: 'download_confirmed' as const };
      setActiveBatch(confirmed);
      setConfirmDialogOpen(false);
      setTypedReference('');
      toast.success('Archive download confirmed. The final record-clearance step is now available.');
      await loadBatches();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Archive confirmation failed');
    } finally {
      setConfirming(false);
    }
  };

  const cleanR2Objects = async (batch: ArchiveBatch) => {
    const r2Attachments = batch.patients.flatMap((patient) => patient.attachments
      .filter((attachment) => attachment.bucket !== 'external-url')
      .map((attachment) => ({ ...attachment, patientName: patient.name })));
    if (!r2Attachments.length) return { failed: [] as typeof r2Attachments };
    const failed: typeof r2Attachments = [];
    for (let index = 0; index < r2Attachments.length; index += 1) {
      const attachment = r2Attachments[index];
      setProgress({ label: `Removing stored attachment ${index + 1} of ${r2Attachments.length}`, current: index + 1, total: r2Attachments.length });
      const success = await deleteFile(attachment.bucket as StorageBucket, attachment.path);
      if (!success) failed.push(attachment);
    }
    return { failed };
  };

  const purgeArchive = async () => {
    if (!activeBatch || activeBatch.status !== 'download_confirmed') return;
    setPurging(true);
    setProgress({ label: 'Performing final unchanged-case safety check', current: 0, total: 1 });
    try {
      const eligibilityResult = await rpc('check_archive_eligibility', { _patient_ids: activeBatch.patients.map((patient) => patient.id) });
      if (eligibilityResult.error) throw new Error(eligibilityResult.error.message ?? 'Final safety check failed');
      const blocked = ((eligibilityResult.data ?? []) as ArchiveEligibility[]).filter((entry) => !entry.is_eligible);
      if (blocked.length) throw new Error(`Clearance stopped: ${blocked.map((entry) => `${entry.patient_name}: ${(entry.reasons ?? []).join('; ')}`).join(' | ')}`);

      setProgress({ label: 'Clearing verified detailed Supabase case records', current: 1, total: 1 });
      const purgeResult = await rpc('purge_archived_cases', {
        _patient_ids: activeBatch.patients.map((patient) => patient.id),
        _archive_reference: activeBatch.reference,
      });
      if (purgeResult.error) throw new Error(purgeResult.error.message ?? 'Clinical history clearance failed');

      const { failed } = await cleanR2Objects(activeBatch);
      setPurgeDialogOpen(false);
      setActiveBatch({ ...activeBatch, status: 'purged' });
      if (failed.length) {
        toast.warning(`Patient records were cleared, but ${failed.length} R2 attachment${failed.length === 1 ? '' : 's'} could not be removed. Use Retry storage cleanup below.`);
      } else {
        toast.success(`Verified case history cleared for ${activeBatch.patients.length} patient${activeBatch.patients.length === 1 ? '' : 's'}, including stored R2 attachments.`);
      }
      await loadBatches();
      await loadCandidates();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Verified record clearance failed');
    } finally {
      setProgress(null);
      setPurging(false);
    }
  };

  const retryCleanup = async (batch: ArchiveBatch) => {
    setPurging(true);
    try {
      const { failed } = await cleanR2Objects(batch);
      if (failed.length) toast.warning(`${failed.length} attachment cleanup request${failed.length === 1 ? '' : 's'} still failed. Check R2 connectivity and try again.`);
      else toast.success('Stored R2 attachment cleanup completed.');
    } finally {
      setProgress(null);
      setPurging(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-amber-300/70 bg-amber-50/40">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-amber-950">
            <ShieldAlert className="h-5 w-5 text-amber-700" />
            Closed-case archive and verified clearance
          </CardTitle>
          <CardDescription className="text-amber-900/80">
            This creates a local ZIP containing ledger-card PDFs, original attachments, and checksum manifests. No clinical record is cleared until an administrator saves, opens, and explicitly confirms that exact archive.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-amber-950/85">
          <p><strong>Confidential records:</strong> the ZIP is not password-protected. Save it only to an approved encrypted hospital computer or external drive.</p>
          <p>Only discharged cases that have remained closed for at least 24 hours, with no outstanding workflow, finance, laboratory, pharmacy, referral, or claim blockers can be prepared.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Archive className="h-5 w-5 text-module-admin" />Archive candidates</CardTitle>
            <CardDescription>Eligibility is checked again immediately before the ZIP is prepared and once more before records are cleared.</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={refreshCandidates} disabled={loading || preparing || purging}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh eligibility
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="space-y-2">
              <Label htmlFor="archive-reference">Archive reference</Label>
              <Input id="archive-reference" value={archiveReference} onChange={(event) => setArchiveReference(event.target.value)} disabled={preparing || purging} placeholder="KMC-ARCHIVE-YYYYMMDD-HHMMSS" />
              <p className="text-xs text-muted-foreground">Use this exact reference in the ZIP filename and later confirmation. It is stored in the retained archive index.</p>
            </div>
            <Button type="button" onClick={prepareArchive} disabled={preparing || purging || selectedCount === 0} className="min-w-52">
              {preparing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileArchive className="mr-2 h-4 w-4" />}
              {preparing ? 'Preparing archive…' : `Prepare ZIP (${selectedCount})`}
            </Button>
          </div>

          {progress && (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="mb-2 flex items-center justify-between gap-3 text-sm"><span className="font-medium">{progress.label}</span><span className="font-mono text-xs text-muted-foreground">{progress.current}/{progress.total}</span></div>
              <Progress value={progressPercent} />
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-12 px-3 py-3 text-left"><Checkbox aria-label="Select all eligible patients" checked={allEligibleSelected} onCheckedChange={(checked) => toggleAllEligible(checked === true)} disabled={loading || !eligibleCandidates.length || preparing || purging} /></th>
                  <th className="px-3 py-3 text-left">Patient</th>
                  <th className="px-3 py-3 text-left">Closed case</th>
                  <th className="px-3 py-3 text-left">Archive decision</th>
                  <th className="px-3 py-3 text-left">Records preserved in ZIP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr><td colSpan={5} className="px-3 py-10 text-center text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading discharged cases…</td></tr>
                ) : candidates.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">No currently discharged patient journeys were found.</td></tr>
                ) : candidates.filter((candidate) => showBlocked || candidate.is_eligible).map((candidate) => {
                  const attachments = normaliseAttachments(candidate.attachment_paths);
                  return <tr key={candidate.patient_id} className={candidate.is_eligible ? 'bg-background' : 'bg-muted/20'}>
                    <td className="px-3 py-3 align-top"><Checkbox aria-label={`Select ${candidate.patient_name}`} checked={selectedIds.has(candidate.patient_id)} onCheckedChange={(checked) => togglePatient(candidate.patient_id, checked === true)} disabled={!candidate.is_eligible || preparing || purging} /></td>
                    <td className="px-3 py-3 align-top"><div className="font-medium">{candidate.patient_name}</div><div className="font-mono text-xs text-muted-foreground">{candidate.patient_card_number ?? candidate.patient?.card_number ?? '—'} · {String(candidate.patient?.account_type ?? 'normal').replace(/_/g, ' ')}</div></td>
                    <td className="px-3 py-3 align-top text-xs text-muted-foreground">{prettyDate(candidate.closed_at)}</td>
                    <td className="px-3 py-3 align-top">
                      {candidate.is_eligible ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Eligible</Badge> : <div className="space-y-1"><Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Blocked</Badge><p className="max-w-md text-xs text-muted-foreground">{(candidate.reasons ?? ['Eligibility could not be verified']).join(' · ')}</p></div>}
                    </td>
                    <td className="px-3 py-3 align-top text-xs text-muted-foreground"><div>{countSummary(candidate.row_counts)}</div><div className="mt-1">{attachments.length} original attachment{attachments.length === 1 ? '' : 's'}</div></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setShowBlocked((visible) => !visible)}>
            {showBlocked ? <ChevronUp className="mr-2 h-4 w-4" /> : <ChevronDown className="mr-2 h-4 w-4" />}
            {showBlocked ? 'Hide blocked cases' : `Show blocked cases (${candidates.length - eligibleCandidates.length})`}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileCheck2 className="h-5 w-5 text-primary" />Verification and clearance</CardTitle>
          <CardDescription>Preparation creates a protected database index entry but does not delete records. Clearance becomes available only after the exact ZIP reference has been confirmed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {activeBatch ? <div className="rounded-lg border border-border bg-muted/20 p-4"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><div className="font-semibold">{activeBatch.reference}</div><p className="mt-1 text-sm text-muted-foreground">{activeBatch.patients.length} patient{activeBatch.patients.length === 1 ? '' : 's'} · prepared {prettyDate(activeBatch.archivedAt)}</p><p className="mt-2 text-xs text-muted-foreground">{activeBatch.patients.map((patient) => `${patient.name} (${patient.cardNumber})`).join(' · ')}</p></div><Badge className={activeBatch.status === 'pending_download' ? 'bg-amber-100 text-amber-800 hover:bg-amber-100' : activeBatch.status === 'download_confirmed' ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100' : 'bg-slate-200 text-slate-800 hover:bg-slate-200'}>{activeBatch.status === 'pending_download' ? 'Awaiting download confirmation' : activeBatch.status === 'download_confirmed' ? 'Download confirmed' : 'Records cleared'}</Badge></div><div className="mt-4 flex flex-col gap-2 sm:flex-row">{activeBatch.status === 'pending_download' && <Button type="button" onClick={() => { setTypedReference(''); setConfirmDialogOpen(true); }} disabled={confirming || purging}><CheckCircle2 className="mr-2 h-4 w-4" />I saved and opened this archive</Button>}{activeBatch.status === 'download_confirmed' && <Button type="button" variant="destructive" onClick={() => setPurgeDialogOpen(true)} disabled={purging}><Trash2 className="mr-2 h-4 w-4" />Clear verified records</Button>}{activeBatch.status === 'purged' && <Button type="button" variant="outline" onClick={() => void retryCleanup(activeBatch)} disabled={purging}><HardDrive className="mr-2 h-4 w-4" />Retry storage cleanup</Button>}</div></div> : <div className="rounded-lg border border-dashed border-border px-4 py-7 text-center text-sm text-muted-foreground">Prepare an archive ZIP to begin the confirmation workflow, or select a recent archive below to continue it.</div>}

          {archiveBatches.length > 0 && <div className="space-y-2 border-t pt-4"><p className="text-sm font-medium">Recent archive references</p>{archiveBatches.slice(0, 8).map((batch) => <button key={batch.reference} type="button" onClick={() => setActiveBatch(batch)} className={`flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition hover:bg-muted/50 ${activeBatch?.reference === batch.reference ? 'border-primary bg-primary/5' : 'border-border'}`}><span><span className="block font-mono text-sm font-semibold">{batch.reference}</span><span className="block text-xs text-muted-foreground">{batch.patients.length} patient{batch.patients.length === 1 ? '' : 's'} · {prettyDate(batch.archivedAt)}</span></span><Badge variant="outline">{batch.status.replace(/_/g, ' ')}</Badge></button>)}</div>}
        </CardContent>
      </Card>

      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Confirm offline archive saved and opened</AlertDialogTitle><AlertDialogDescription>Before you can clear live clinical records, open the downloaded ZIP on the approved hospital storage device and verify that the PDFs, attachments, and manifest are present. Then type the exact archive reference below.</AlertDialogDescription></AlertDialogHeader>
          <div className="space-y-2"><Label htmlFor="confirm-reference">Exact archive reference</Label><Input id="confirm-reference" value={typedReference} onChange={(event) => setTypedReference(event.target.value)} placeholder={activeBatch?.reference ?? ''} /><p className="font-mono text-xs text-muted-foreground">Required: {activeBatch?.reference}</p></div>
          <AlertDialogFooter><AlertDialogCancel disabled={confirming}>Cancel</AlertDialogCancel><AlertDialogAction onClick={(event) => { event.preventDefault(); void confirmDownload(); }} disabled={confirming || typedReference.trim() !== activeBatch?.reference}>{confirming ? 'Confirming…' : 'Confirm saved archive'}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={purgeDialogOpen} onOpenChange={setPurgeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Clear verified detailed clinical records?</AlertDialogTitle><AlertDialogDescription>This action removes the selected patients’ case history from Supabase after one final unchanged-case check. Their patient identity, card number, and archive index remain. Stored R2 attachments are removed immediately after database clearance and can be retried if the storage network is unavailable.</AlertDialogDescription></AlertDialogHeader>
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"><div className="mb-1 flex items-center gap-2 font-semibold text-destructive"><TriangleAlert className="h-4 w-4" />{activeBatch?.patients.length ?? 0} patient case{(activeBatch?.patients.length ?? 0) === 1 ? '' : 's'} to clear</div><p className="text-muted-foreground">{activeBatch?.patients.map((patient) => `${patient.name} (${patient.cardNumber})`).join(' · ')}</p></div>
          <AlertDialogFooter><AlertDialogCancel disabled={purging}>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(event) => { event.preventDefault(); void purgeArchive(); }} disabled={purging}>{purging ? 'Clearing…' : 'Clear verified records'}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
