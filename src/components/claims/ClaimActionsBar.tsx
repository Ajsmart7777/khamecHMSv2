import { useState } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, XCircle, HelpCircle, RotateCcw, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  Visit,
  markClaimSettled, markClaimRejected, requestClaimInfo, reopenClaim,
  CLAIM_REJECT_REASON_CODES, CLAIM_INFO_REASON_CODES,
} from '@/hooks/useVisits';
import { isSponsored } from '@/lib/copay';
import { Patient } from '@/contexts/PatientContext';

// Claims Manager scope: external insurance schemes only.
// staff = 100% free; staff_family = 50% patient / 50% payroll deduction (handled by trigger).
const INSURED_SPONSORS = new Set(['nhia', 'hmo', 'katchma']);

function statusTone(s?: string | null) {
  switch (s) {
    case 'settled': return { cls: 'bg-emerald-100 text-emerald-800 border-emerald-300', label: 'Settled' };
    case 'rejected': return { cls: 'bg-red-100 text-red-800 border-red-300', label: 'Rejected' };
    case 'info_requested': return { cls: 'bg-amber-100 text-amber-800 border-amber-300', label: 'Info Requested' };
    case 'pending': return { cls: 'bg-blue-100 text-blue-800 border-blue-300', label: 'Pending' };
    default: return null;
  }
}

export function ClaimActionsBar({ visit, patient }: { visit: Visit; patient: Patient }) {
  const { hasRole } = useAuth();
  const [action, setAction] = useState<null | 'reject' | 'info' | 'settle' | 'reopen'>(null);
  const [reasonCode, setReasonCode] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const eligible =
    isSponsored(patient) &&
    INSURED_SPONSORS.has(String(visit.sponsor_type ?? '').toLowerCase()) &&
    visit.status === 'settled';
  if (!eligible) return null;

  const status = visit.claim_status ?? 'pending';
  const tone = statusTone(status);
  const canAct = hasRole(['claims_manager', 'admin']);
  const codes = action === 'reject' ? CLAIM_REJECT_REASON_CODES : CLAIM_INFO_REASON_CODES;

  async function submit() {
    if (!action) return;
    if ((action === 'reject' || action === 'info') && !reasonCode) {
      toast.error('Select a reason code'); return;
    }
    if ((action === 'settle' || action === 'reopen') && action === 'reopen' && notes.trim().length < 3) {
      toast.error('Provide a reason (min 3 chars)'); return;
    }
    setBusy(true);
    try {
      if (action === 'reject') await markClaimRejected(visit.id, reasonCode, notes.trim() || undefined);
      else if (action === 'info') await requestClaimInfo(visit.id, reasonCode, notes.trim() || undefined);
      else if (action === 'settle') await markClaimSettled(visit.id, notes.trim() || undefined);
      else if (action === 'reopen') await reopenClaim(visit.id, notes.trim());
      toast.success('Claim updated');
      setAction(null); setReasonCode(''); setNotes('');
    } catch (e: any) {
      toast.error(e?.message ?? 'Action failed');
    } finally { setBusy(false); }
  }

  return (
    <div className="bg-indigo-50 border-y border-indigo-200 px-4 py-2 flex items-center justify-between gap-2 flex-wrap text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <ShieldCheck className="h-3.5 w-3.5 text-indigo-700" />
        <span className="font-semibold text-indigo-900 uppercase tracking-wide">Insurance Claim</span>
        {tone && (
          <Badge variant="outline" className={`${tone.cls} text-[10px]`}>{tone.label}</Badge>
        )}
        {visit.claim_reason_code && (
          <Badge variant="outline" className="text-[10px]">
            {visit.claim_reason_code.replace(/_/g, ' ')}
          </Badge>
        )}
        {visit.claim_last_action_at && (
          <span className="text-[10px] text-muted-foreground">
            · updated {format(new Date(visit.claim_last_action_at), 'dd MMM · HH:mm')}
          </span>
        )}
      </div>
      {canAct && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {(status === 'pending' || status === 'info_requested') && (
            <>
              <Button size="sm" variant="outline" className="h-7 border-amber-500 text-amber-800 hover:bg-amber-50"
                onClick={() => { setAction('info'); setReasonCode(''); setNotes(''); }}>
                <HelpCircle className="h-3 w-3 mr-1" /> Request Info
              </Button>
              <Button size="sm" variant="outline" className="h-7 border-red-500 text-red-800 hover:bg-red-50"
                onClick={() => { setAction('reject'); setReasonCode(''); setNotes(''); }}>
                <XCircle className="h-3 w-3 mr-1" /> Reject
              </Button>
              <Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => { setAction('settle'); setNotes(''); }}>
                <CheckCircle2 className="h-3 w-3 mr-1" /> Mark Settled
              </Button>
            </>
          )}
          {(status === 'rejected' || status === 'settled') && (
            <Button size="sm" variant="outline" className="h-7"
              onClick={() => { setAction('reopen'); setNotes(''); }}>
              <RotateCcw className="h-3 w-3 mr-1" /> Reopen
            </Button>
          )}
        </div>
      )}

      <AlertDialog open={!!action} onOpenChange={(o) => !o && setAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {action === 'reject' && 'Reject this claim?'}
              {action === 'info' && 'Request more information?'}
              {action === 'settle' && 'Mark claim as settled?'}
              {action === 'reopen' && 'Reopen this claim?'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  Visit <span className="font-mono">{visit.visit_number}</span>
                  {visit.insurance_plan && ` · ${visit.insurance_plan}`} · Charged{' '}
                  <span className="font-semibold">₦{Number(visit.total_charged).toLocaleString()}</span>
                </p>
                {(action === 'reject' || action === 'info') && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Reason code *</label>
                    <Select value={reasonCode} onValueChange={setReasonCode}>
                      <SelectTrigger><SelectValue placeholder="Select a reason code" /></SelectTrigger>
                      <SelectContent>
                        {codes.map((r) => (
                          <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    {action === 'reopen' ? 'Reason (required)' : 'Notes'}
                    {action === 'reopen' ? ' *' : ' (optional)'}
                  </label>
                  <Textarea
                    placeholder={
                      action === 'reject' ? 'Rejection details for the audit log…' :
                      action === 'info'   ? 'What info is needed from patient / scheme?' :
                      action === 'settle' ? 'Reconciliation notes — remittance ref, batch #…' :
                      'Why is this claim being reopened?'
                    }
                    value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                  />
                </div>
                <p className="text-[11px] text-amber-700">
                  This action is written to the audit log with your user, timestamp, and reason.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); submit(); }}
              disabled={busy}
              className={
                action === 'reject' ? 'bg-red-600 hover:bg-red-700' :
                action === 'info'   ? 'bg-amber-600 hover:bg-amber-700' :
                action === 'settle' ? 'bg-emerald-600 hover:bg-emerald-700' : ''
              }
            >
              {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}