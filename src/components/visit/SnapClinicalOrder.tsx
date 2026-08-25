import React, { useRef, useState } from 'react';
import { Camera, Send, Lock, Crop, Type, Pill, Beaker, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { toast } from 'sonner';
import { uploadFile } from '@/lib/storage';
import { useActiveVisit, openOrResumeVisit } from '@/hooks/useVisits';
import { uploadVisitAttachment, VisitStation } from '@/hooks/useVisitAttachments';
import { createSnapOrder, SnapOrderType, SnapTargetStation } from '@/hooks/useSnapOrders';
import { useAuth } from '@/contexts/AuthContext';
import { useSearchParams } from 'react-router-dom';
import { useCanSnap } from '@/hooks/useCanSnap';
import { usePatients } from '@/contexts/PatientContext';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SnapCropDialog } from './SnapCropDialog';
import { InAppCameraDialog } from './InAppCameraDialog';
import { hasInAppCamera } from '@/lib/isMobile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TypedPrescriptionEditor } from '@/components/prescription/TypedPrescriptionEditor';
import { TypedLabRequestEditor } from '@/components/lab/TypedLabRequestEditor';
import { ReferralEditorDialog } from '@/components/referral/ReferralEditorDialog';
import { statusAfterClinicalOrder } from '@/lib/clinicWorkflowRouting';

interface Props {
  patientId: string;
  sourceStation: VisitStation; // 'nurse' | 'doctor'
  defaultOrderType?: SnapOrderType;
  defaultTarget?: SnapTargetStation;
  variant?: 'default' | 'outline' | 'secondary';
  size?: 'sm' | 'default' | 'lg';
  className?: string;
  label?: string;
  emergencyEpisodeId?: string | null;
  onSent?: () => void;
}

export function SnapClinicalOrder({
  patientId,
  sourceStation,
  defaultOrderType = 'prescription',
  defaultTarget,
  variant = 'default',
  size = 'default',
  className,
  label = 'Snap & Send to Billing',
  emergencyEpisodeId = null,
  onSent,
}: Props) {
  const { role } = useAuth();
  const [searchParams] = useSearchParams();
  const asParam = searchParams.get('as');
  const senderRole: 'nurse' | 'doctor1' | 'doctor2' =
    role === 'nurse' || role === 'doctor1' || role === 'doctor2'
      ? role
      : asParam === 'nurse' || asParam === 'doctor1' || asParam === 'doctor2'
        ? asParam
        : sourceStation === 'nurse' ? 'nurse' : 'doctor1';
  const { visit, refresh } = useActiveVisit(patientId);
  const { allowed, reason, loading: checking, debugLog } = useCanSnap(patientId);
  const { updatePatientStatus, getPatientById } = usePatients();
  const patient = getPatientById(patientId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'snap' | 'type'>('snap');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [orderType] = useState<SnapOrderType>(defaultOrderType);
  const [target] = useState<SnapTargetStation>(
    defaultTarget ?? (defaultOrderType === 'lab' ? 'lab' : 'pharmacy'),
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isReferral = defaultOrderType === 'treatment' && defaultTarget === 'nurse';

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) {
      e.target.value = '';
      return;
    }
    if (!f.type.startsWith('image/')) {
      toast.error('Please select an image file');
      e.target.value = '';
      return;
    }
    acceptFile(f);
    requestAnimationFrame(() => {
      try { e.target.value = ''; } catch {}
    });
  };

  const acceptFile = (f: File) => {
    try {
      const url = URL.createObjectURL(f);
      if (rawUrl) URL.revokeObjectURL(rawUrl);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setFile(null);
      setRawFile(f);
      setRawUrl(url);
      setCameraOpen(false);
      setCropOpen(true);
    } catch (err) {
      console.error('[SnapClinicalOrder] failed to open captured photo', err);
      toast.error('Could not open the photo — please try again');
    }
  };

  const hasCam = hasInAppCamera();

  const close = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (rawUrl) URL.revokeObjectURL(rawUrl);
    setPreviewUrl(null);
    setFile(null);
    setRawUrl(null);
    setRawFile(null);
    setCropOpen(false);
    setCameraOpen(false);
    setNote('');
    setConfirmOpen(false);
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      let visitId = visit?.id;
      if (!visitId) {
        visitId = await openOrResumeVisit({ patientId });
        await refresh();
      }
      if (!visitId) throw new Error('Could not open a visit');

      const path = `${visitId}/${crypto.randomUUID()}.jpg`;
      await uploadFile('visit-cards', path, file, file.type || 'image/jpeg');

      await uploadVisitAttachment({
        visitId,
        patientId,
        file,
        label: `${orderType} → ${target}`,
        station: sourceStation,
      }).catch(() => null);

      if (emergencyEpisodeId) {
        const { data, error } = await (supabase.rpc as any)('record_emergency_admitted_order', {
          _episode_id: emergencyEpisodeId,
          _order_type: orderType === 'treatment' ? 'prescription' : orderType,
          _target_station: target,
          _photo_path: path,
          _note: note.trim() || null,
          _items: [],
        });
        if (error) throw error;
        toast.success(orderType === 'lab' ? 'Emergency lab snap recorded — billing deferred' : 'Emergency prescription snap recorded — billing deferred');
        close();
        onSent?.();
        return;
      }

      const snap = await createSnapOrder({
        patientId,
        visitId,
        orderType,
        targetStation: target,
        // Persist the actual clinical owner, not Admin when an administrator
        // is viewing a station through the `as` workspace parameter.
        sourceRole: senderRole,
        photoPath: path,
        note: note.trim(),
      });
      if (!snap) throw new Error('Snap order not created');
      
      if (target === 'nurse') {
        // A Doctor→Nurse treatment referral is a real station transition.
        // Move outpatient patients out of the Doctor queue immediately; the
        // PatientContext inpatient guard keeps admitted patients in the ward.
        const routed = await updatePatientStatus(patientId, statusAfterClinicalOrder('nurse'));
        if (!routed) throw new Error('Could not route patient to Nurse review');
        toast.success('Sent to Nurse for Review');
      } else {
        const routed = await updatePatientStatus(patientId, statusAfterClinicalOrder(target));
        if (!routed) throw new Error('Could not route patient to Billing');
        toast.success('Sent to Billing');
      }
      close();
      onSent?.();
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to send snap');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <Tabs value={mode} onValueChange={(v) => setMode(v as any)} className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-2">
          <TabsTrigger value="snap" className="text-xs">
            <Camera className="h-3 w-3 mr-1.5" /> Snap
          </TabsTrigger>
          <TabsTrigger value="type" className="text-xs">
            <Type className="h-3 w-3 mr-1.5" /> Type
          </TabsTrigger>
        </TabsList>

        <TabsContent value="snap" className="mt-0 pt-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex flex-col gap-1.5">
                  <Button
                    variant={variant}
                    size={size}
                    className="w-full"
                    onClick={() => {
                      if (hasCam) setCameraOpen(true);
                      else inputRef.current?.click();
                    }}
                    disabled={!allowed || checking}
                  >
                    {allowed ? <Camera className="h-4 w-4 mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
                    {label}
                  </Button>
                  {allowed && (
                    <div className="flex justify-center">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-7 text-[10px] text-muted-foreground font-normal hover:bg-transparent"
                        onClick={() => inputRef.current?.click()}
                      >
                        <Crop className="h-3 w-3 mr-1" /> Choose from files
                      </Button>
                    </div>
                  )}
                </div>
              </TooltipTrigger>
              {!allowed && reason && (
                <TooltipContent side="top" className="max-w-xs p-3">
                  <div className="space-y-2">
                    <p className="font-medium text-destructive">{reason}</p>
                    {debugLog.length > 0 && (
                      <div className="pt-2 border-t border-border/50">
                        <p className="text-[9px] text-muted-foreground uppercase font-bold mb-1">Debug Info</p>
                        <div className="space-y-0.5 max-h-32 overflow-y-auto font-mono text-[9px] opacity-70">
                          {debugLog.map((log, i) => <div key={i}>{log}</div>)}
                        </div>
                      </div>
                    )}
                  </div>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </TabsContent>

        <TabsContent value="type" className="mt-0 pt-1 space-y-2">
          {defaultOrderType === 'prescription' && (
            <div className="border rounded-xl p-4 bg-card shadow-sm">
              {emergencyEpisodeId && <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">Emergency Episode active: this prescription stays linked and unbilled until finalization.</p>}
              <div className="flex items-center gap-2 mb-4 border-b pb-2">
                <Pill className="h-4 w-4 text-module-pharmacy" />
                <h4 className="font-semibold text-sm">Type Prescription</h4>
              </div>
              <TypedPrescriptionEditor 
                patientId={patientId}
                visitId={visit?.id || null}
                emergencyEpisodeId={emergencyEpisodeId}
                onSuccess={() => { onSent?.(); close(); }}
                onCancel={() => setMode('snap')}
              />
            </div>
          )}
          {defaultOrderType === 'lab' && (
            <div className="border rounded-xl p-4 bg-card shadow-sm">
              {emergencyEpisodeId && <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">Emergency Episode active: this lab request may be performed now and remains unbilled until finalization.</p>}
              <div className="flex items-center gap-2 mb-4 border-b pb-2">
                <Beaker className="h-4 w-4 text-module-laboratory" />
                <h4 className="font-semibold text-sm">Type Lab Order</h4>
              </div>
              <TypedLabRequestEditor 
                patientId={patientId}
                visitId={visit?.id || null}
                emergencyEpisodeId={emergencyEpisodeId}
                onSuccess={() => { onSent?.(); close(); }}
                onCancel={() => setMode('snap')}
              />
            </div>
          )}
          {isReferral && (
            <div className="flex flex-col items-center justify-center py-6 border rounded-xl bg-card dashed">
              <FileText className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <Button onClick={() => setReferralOpen(true)}>
                <FileText className="h-4 w-4 mr-2" /> Open Referral Editor
              </Button>
              <ReferralEditorDialog 
                open={referralOpen}
                onOpenChange={setReferralOpen}
                patientId={patientId}
                visitId={visit?.id || null}
                onSuccess={() => onSent?.()}
              />
            </div>
          )}
        </TabsContent>
      </Tabs>

      <input ref={inputRef} type="file" accept="image/*" onChange={onFile} className="hidden" />

      {rawUrl && rawFile && (
        <SnapCropDialog
          open={cropOpen}
          imageUrl={rawUrl}
          originalFile={rawFile}
          onCancel={close}
          onConfirm={(croppedFile, croppedUrl) => {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setFile(croppedFile);
            setPreviewUrl(croppedUrl);
            setCropOpen(false);
            setTimeout(() => {
              if (typeof document !== 'undefined') document.body.style.pointerEvents = '';
              setConfirmOpen(true);
            }, 150);
          }}
        />
      )}

      <InAppCameraDialog open={cameraOpen} onCancel={() => setCameraOpen(false)} onCapture={acceptFile} />

      <AlertDialog open={confirmOpen} onOpenChange={(o) => { if (!busy && !o) close(); }}>
        <AlertDialogContent className="sm:max-w-lg max-h-[95vh] overflow-y-auto p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Order</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4 text-sm mt-2">
                {previewUrl && (
                  <div className="rounded-lg overflow-hidden bg-muted flex items-center justify-center max-h-[35vh]">
                    <img src={previewUrl} alt="cropped snap" className="max-h-[35vh] object-contain" />
                  </div>
                )}
                <div className="rounded-md border p-3 bg-muted/40 space-y-1">
                  <div>
                    <span className="text-muted-foreground">Patient: </span>
                    <span className="font-semibold text-foreground">{patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Type: </span>
                    <span className="font-medium capitalize text-foreground">{orderType}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Station: </span>
                    <span className="font-medium capitalize text-foreground">{target}</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Note (optional)</Label>
                  <Input placeholder="e.g. urgent" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => { setConfirmOpen(false); setCropOpen(true); }} disabled={busy}>Re-crop</Button>
            <AlertDialogCancel disabled={busy} onClick={close}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={async (e) => { e.preventDefault(); await submit(); }}>
              {busy ? 'Sending...' : 'Confirm & Send'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
