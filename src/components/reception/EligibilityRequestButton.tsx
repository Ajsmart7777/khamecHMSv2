import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ShieldCheck, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useEligibilityVerifications } from '@/hooks/useEligibilityVerifications';
import type { Patient } from '@/contexts/PatientContext';

type SponsorType = 'nhis' | 'hmo' | 'katchma';

// Only insurance sponsors need eligibility verification.
// Corporate & retainer are created directly by the accountant during patient registration.
const SPONSOR_TYPES: Patient['account_type'][] = ['nhis', 'hmo', 'katchma'];

interface Props {
  patient: Patient;
}

/**
 * Lets Reception send an eligibility verification request to the Claims Manager
 * for insured patients (nhis, hmo, katchma) only.
 */
export function EligibilityRequestButton({ patient }: Props) {
  const { items, requestVerification } = useEligibilityVerifications();
  const [open, setOpen] = useState(false);
  const [encounterCode, setEncounterCode] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Only show for sponsored account types
  if (!SPONSOR_TYPES.includes(patient.account_type)) return null;

  // Latest verification for this patient
  const latest = useMemo(
    () => items.find((i) => i.patient_id === patient.id) ?? null,
    [items, patient.id],
  );

  const statusBadge = () => {
    if (!latest) return null;
    if (latest.status === 'pending') {
      return (
        <Badge variant="outline" className="bg-amber-500/15 text-amber-700 border-amber-500/30 gap-1">
          <Clock className="h-3 w-3" /> Awaiting Claims Manager
        </Badge>
      );
    }
    if (latest.status === 'approved') {
      return (
        <Badge variant="outline" className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 gap-1">
          <CheckCircle2 className="h-3 w-3" /> Eligibility Approved
        </Badge>
      );
    }
    if (latest.status === 'rejected') {
      return (
        <Badge variant="outline" className="bg-red-500/15 text-red-700 border-red-500/30 gap-1">
          <XCircle className="h-3 w-3" /> Rejected
        </Badge>
      );
    }
    return null;
  };

  const canRequest = !latest || latest.status === 'rejected' || latest.status === 'expired';

  const handleSubmit = async () => {
    setSubmitting(true);
    const id = await requestVerification({
      patient_id: patient.id,
      sponsor_type: patient.account_type as SponsorType,
      provider_name: patient.insurance_provider ?? null,
      enrollee_id: patient.insurance_policy_number ?? null,
      plan: patient.insurance_plan ?? null,
      encounter_code: encounterCode.trim() || null,
      notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (id) {
      toast.success('Verification request sent to Claims Manager');
      setOpen(false);
      setEncounterCode('');
      setNotes('');
    } else {
      toast.error('Could not send verification request');
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {statusBadge()}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            size="sm"
            variant={latest?.status === 'approved' ? 'outline' : 'default'}
            disabled={!canRequest && latest?.status !== 'approved'}
            className="gap-1"
          >
            <ShieldCheck className="h-4 w-4" />
            {latest?.status === 'approved' ? 'Re-verify' : latest?.status === 'pending' ? 'Awaiting…' : 'Request Verification'}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Request Eligibility Verification
            </DialogTitle>
            <DialogDescription>
              Send this patient's insurance details to the Claims Manager for verification before service.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="p-3 rounded-lg bg-muted/50 space-y-1">
              <div><span className="text-muted-foreground">Patient:</span> <span className="font-medium">{patient.first_name} {patient.last_name}</span></div>
              <div><span className="text-muted-foreground">Sponsor type:</span> <span className="font-medium uppercase">{patient.account_type}</span></div>
              {patient.insurance_provider && (
                <div><span className="text-muted-foreground">Provider:</span> <span className="font-medium">{patient.insurance_provider}</span></div>
              )}
              {patient.insurance_plan && (
                <div><span className="text-muted-foreground">Plan:</span> <span className="font-medium">{patient.insurance_plan}</span></div>
              )}
              {patient.insurance_policy_number && (
                <div><span className="text-muted-foreground">Enrollee ID:</span> <span className="font-mono text-xs">{patient.insurance_policy_number}</span></div>
              )}
            </div>

            {patient.account_type === 'hmo' && (
              <div className="space-y-1">
                <Label htmlFor="encounter">Encounter / Authorization Code <span className="text-muted-foreground text-xs">(if you already have one)</span></Label>
                <Input
                  id="encounter"
                  value={encounterCode}
                  onChange={(e) => setEncounterCode(e.target.value)}
                  placeholder="e.g. HMO-2026-XXXX"
                />
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="notes">Notes for Claims Manager <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything the claims manager should know"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending…</> : 'Send Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}