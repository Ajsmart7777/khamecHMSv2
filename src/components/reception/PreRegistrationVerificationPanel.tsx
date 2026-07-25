import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  ShieldCheck, Camera, Upload, Loader2, CheckCircle2, Clock, XCircle,
  ChevronRight, User, Phone, RefreshCw, ImageIcon,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  useEligibilityVerifications, getEligibilitySnapUrl,
  type EligibilityVerification,
} from '@/hooks/useEligibilityVerifications';
import { InAppCameraDialog } from '@/components/visit/InAppCameraDialog';

type SponsorType = 'nhis' | 'hmo' | 'katchma';

interface Props {
  onStartRegistration: (v: EligibilityVerification) => void;
}

export function PreRegistrationVerificationPanel({ onStartRegistration }: Props) {
  const { pending, readyToRegister, rejected, requestPreRegistrationVerification, refresh } =
    useEligibilityVerifications();
  const [open, setOpen] = useState(false);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [sponsorType, setSponsorType] = useState<SponsorType>('nhis');
  const [details, setDetails] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const reset = () => {
    setName(''); setPhone(''); setSponsorType('nhis');
    setDetails(''); setNotes(''); setFile(null);
  };

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error('Patient name is required'); return; }
    if (!file) { toast.error('Snap the insurance card first'); return; }
    setSubmitting(true);
    const id = await requestPreRegistrationVerification({
      prospective_patient_name: name,
      prospective_patient_phone: phone || null,
      sponsor_type: sponsorType,
      insurance_details: details || null,
      notes: notes || null,
      snap_file: file,
    });
    setSubmitting(false);
    if (id) {
      toast.success('Sent to Claims Manager — waiting for verification');
      reset();
      setOpen(false);
    } else {
      toast.error('Could not send verification request');
    }
  };

  return (
    <>
      <Card className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 font-semibold text-sm">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Insurance Verification
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Snap the card & send to Claims Manager before registering an insured patient.
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={refresh} className="h-7 w-7 p-0" title="Refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        <Button size="sm" className="w-full gap-1" onClick={() => setOpen(true)}>
          <Camera className="h-4 w-4" /> New Verification Request
        </Button>

        {readyToRegister.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11px] uppercase font-semibold text-emerald-700 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> Ready to Register ({readyToRegister.length})
            </div>
            {readyToRegister.map((v) => (
              <button
                key={v.id}
                onClick={() => onStartRegistration(v)}
                className="w-full text-left p-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{v.prospective_patient_name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {v.verified_provider_name || v.provider_name || '—'}
                      {v.verified_enrollee_id && <span className="ml-1 font-mono">· {v.verified_enrollee_id}</span>}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] uppercase">{v.sponsor_type}</Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </button>
            ))}
          </div>
        )}

        {pending.filter((v) => !v.patient_id).length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11px] uppercase font-semibold text-amber-700 flex items-center gap-1">
              <Clock className="h-3 w-3" /> Awaiting Claims Manager
            </div>
            {pending.filter((v) => !v.patient_id).map((v) => (
              <div key={v.id} className="p-2 rounded-md border border-amber-500/30 bg-amber-500/5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium truncate flex-1">{v.prospective_patient_name}</div>
                  <Badge variant="outline" className="text-[10px] uppercase">{v.sponsor_type}</Badge>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Sent {format(new Date(v.created_at), 'HH:mm')}
                </div>
              </div>
            ))}
          </div>
        )}

        {rejected.filter((v) => !v.patient_id && !v.consumed_at).slice(0, 3).length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11px] uppercase font-semibold text-red-700 flex items-center gap-1">
              <XCircle className="h-3 w-3" /> Rejected
            </div>
            {rejected.filter((v) => !v.patient_id && !v.consumed_at).slice(0, 3).map((v) => (
              <div key={v.id} className="p-2 rounded-md border border-red-500/30 bg-red-500/5">
                <div className="text-sm font-medium truncate">{v.prospective_patient_name}</div>
                <div className="text-[11px] text-red-700 truncate">{v.rejection_reason || 'Rejected'}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" /> New Insurance Verification
            </DialogTitle>
            <DialogDescription>
              Capture the patient's insurance card and send it to the Claims Manager for verification.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="pname">Patient Name *</Label>
                <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pphone">Phone (optional)</Label>
                <Input id="pphone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="080..." />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Sponsor Type *</Label>
              <Select value={sponsorType} onValueChange={(v) => setSponsorType(v as SponsorType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nhis">NHIA / NHIS</SelectItem>
                  <SelectItem value="hmo">HMO</SelectItem>
                  <SelectItem value="katchma">KATCHMA</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="details">Insurance details</Label>
              <Textarea
                id="details"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder={
                  sponsorType === 'hmo'
                    ? 'HMO name, member ID, plan, encounter/auth code — anything on the card.'
                    : sponsorType === 'nhis'
                      ? 'NHIA enrollee number, dependant info, plan tier.'
                      : 'KATCHMA ID / any relevant codes.'
                }
                rows={3}
              />
              <p className="text-[11px] text-muted-foreground">
                For NYSC: include Call-up number + State code. Include anything printed on the card.
              </p>
            </div>

            <div className="space-y-1">
              <Label>Insurance Card Snap *</Label>
              {previewUrl ? (
                <div className="relative border rounded-lg overflow-hidden bg-muted/40">
                  <img src={previewUrl} alt="Insurance card" className="w-full max-h-48 object-contain" />
                  <Button
                    size="sm"
                    variant="secondary"
                    className="absolute top-2 right-2 h-7"
                    onClick={() => setFile(null)}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setCameraOpen(true)}>
                    <Camera className="h-4 w-4 mr-1" /> Camera
                  </Button>
                  <label className="flex-1">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                    />
                    <Button asChild variant="outline" size="sm" className="w-full">
                      <span><Upload className="h-4 w-4 mr-1" /> Upload</span>
                    </Button>
                  </label>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="notes">Note to Claims Manager (optional)</Label>
              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending…</> : 'Send to Claims Manager'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InAppCameraDialog
        open={cameraOpen}
        onCancel={() => setCameraOpen(false)}
        onCapture={(f) => { setFile(f); setCameraOpen(false); }}
      />
    </>
  );
}