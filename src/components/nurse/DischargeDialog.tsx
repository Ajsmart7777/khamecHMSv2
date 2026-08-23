import { useEffect, useState } from 'react';
import { LogOut, Wallet, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

type Method = 'cash' | 'pos' | 'transfer' | 'carry' | 'salary';

interface Props {
  admissionId: string;
  patientId: string;
  patientName: string;
  patientBalance: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDischarged?: () => void;
  deceased?: boolean;
}

interface Preview {
  admitted_at: string | null;
  account_type: string | null;
  insurance_plan: string | null;
  has_wallet: boolean;
  nights: number;
  daily_rate: number;
  bed_total: number;
  bed_already_billed: boolean;
  copay_pct: number;
  sponsor_covered: number;
  bed_patient_share: number;
  current_balance: number;
  prior_outstanding: number;
  gross_total: number;
  wallet_credit: number;
  wallet_applied: number;
  total_due: number;
  balance_after_bed: number;
}

const fmt = (n: number) => `₦${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/**
 * Discharge dialog — shows the exact server-side bill (bed nights + prior debt)
 * and settles it. Partial payment is allowed; the remainder is carried as debt.
 */
export function DischargeDialog({
  admissionId, patientId, patientName, patientBalance, open, onOpenChange, onDischarged, deceased = false,
}: Props) {

  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);

  const [notes, setNotes] = useState('');
  const [method, setMethod] = useState<Method>('cash');
  const [amount, setAmount] = useState<string>('');
  const [settlementNotes, setSettlementNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase.rpc('admission_discharge_preview', {
        _admission_id: admissionId,
      });
      if (!active) return;
      setLoading(false);
      if (error) { toast.error(error.message); return; }
      setPreview(data as unknown as Preview);
    })();
    return () => { active = false; };
  }, [open, admissionId]);

  const due = Number(preview?.total_due ?? 0);
  const hasDebt = due > 0;

  useEffect(() => { setAmount(due ? String(due) : ''); }, [due]);


  const payMethods: Method[] = ['cash', 'pos', 'transfer'];
  const amountNum = Number(amount) || 0;
  const isPay = payMethods.includes(method);
  const shortfall = isPay && hasDebt ? Math.max(0, Math.round((due - amountNum) * 100) / 100) : 0;
  const needsReason = hasDebt && (method === 'carry' || shortfall > 0);
  const reasonMissing = false;
  const invalidAmount = isPay && hasDebt && (amountNum <= 0 || (deceased && amountNum < due));

  // Change owed back to the patient: leftover wallet credit + any overpayment.
  const walletLeft = preview?.has_wallet
    ? Math.max(0, Math.round(((preview.wallet_credit ?? 0) - (preview.wallet_applied ?? 0)) * 100) / 100)
    : 0;
  const overpay = isPay && hasDebt ? Math.max(0, Math.round((amountNum - due) * 100) / 100) : 0;
  const changeDue = Math.round((walletLeft + overpay) * 100) / 100;

  const [refund, setRefund] = useState(false);
  const refundRequired = deceased && changeDue > 0;
  useEffect(() => {
    if (changeDue <= 0) setRefund(false);
    else if (deceased) setRefund(true);
  }, [changeDue, deceased]);

  const [done, setDone] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);

  const cancelSettlement = async () => {
    if (busy || cancelBusy || done) return;
    setCancelBusy(true);
    const { error } = await (supabase as any).rpc('cancel_admission_discharge', {
      _admission_id: admissionId,
      _reason: settlementNotes.trim() || notes.trim() || null,
    });
    setCancelBusy(false);
    if (error) {
      const msg = error.message ?? 'Unable to cancel settlement';
      if (msg.includes('NOT_IN_CASHIER_QUEUE')) {
        toast.info('Settlement already left the queue', { description: 'Refreshing the Cashier list.' });
        onDischarged?.();
        onOpenChange(false);
      } else {
        toast.error('Could not cancel settlement', { description: msg });
      }
      return;
    }
    toast.success('Settlement cancelled', {
      description: 'The patient remains admitted and the bed stays occupied. The ward can send the patient to Cashier again when ready.',
    });
    onDischarged?.();
    onOpenChange(false);
  };

  const submit = async () => {
    // Guard against double submits (double click / re-entry): one settlement only.
    if (busy || done) return;
    if (deceased && changeDue > 0 && !refund) {
      toast.error('Refund decision required', { description: 'Refund the remaining wallet credit before final death settlement.' });
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc(deceased ? 'finalize_deceased_admission' : 'discharge_admission', {
      _admission_id: admissionId,
      _notes: notes.trim() || null,
      _settlement_method: hasDebt ? method : null,
      _settlement_amount: hasDebt && isPay ? amountNum : 0,
      _settlement_notes: settlementNotes.trim() || null,
      _refund_amount: refund ? changeDue : 0,
    });
    setBusy(false);
    if (error) {
      const msg = error.message ?? '';
      if (msg.includes('ALREADY_DISCHARGED')) {
        setDone(true);
        toast.error('Already settled', { description: 'This admission has already been discharged. Refreshing the queue.' });
        onDischarged?.();
        onOpenChange(false);
      } else if (msg.includes('DISCHARGE_IN_PROGRESS')) {
        toast.error('Settlement already in progress', { description: 'Another cashier is settling this discharge right now.' });
      } else if (msg.includes('NOT_IN_CASHIER_QUEUE')) {
        setDone(true);
        toast.error('Not ready for settlement', { description: 'The ward has not confirmed this discharge yet.' });
        onDischarged?.();
        onOpenChange(false);
      } else if (msg.includes('PENDING_WORKFLOW:')) {
        const detail = msg.split('PENDING_WORKFLOW:')[1]?.trim() || 'Complete all pending Billing, Laboratory, and Pharmacy work first.';
        const emergencyDetail = detail.toLowerCase().includes('emergency_episode')
          ? 'Finalize the open Emergency Episode first. Its deferred medicines and laboratory work must be added to billing before discharge settlement.'
          : detail;
        toast.error('Complete pending work first', { description: emergencyDetail });
        onDischarged?.();
      } else if (msg.includes('PAYMENT_REQUIRED:')) {
        toast.error('Payment is required first', { description: 'The related order must be processed by Billing before discharge settlement.' });
        onDischarged?.();
      } else if (msg.includes('NOT_DEATH_REPORTED')) {
        toast.error('Death report is missing', { description: 'The ward must report the patient death before final settlement.' });
        onDischarged?.();
      } else if (msg.includes('DEATH_SETTLEMENT_BUSY')) {
        toast.error('Settlement is already in progress', { description: 'Refresh the Cashier queue and try again.' });
        onDischarged?.();
      } else if (msg.includes('DEATH_ALREADY_REPORTED')) {
        toast.error('Death report already exists', { description: 'This case is already awaiting final settlement.' });
        onDischarged?.();
      } else if (msg.includes('CANNOT_DISCHARGE')) {
        toast.error('Discharge is not ready', { description: 'Close all open visits and complete pending orders before settlement.' });
        onDischarged?.();
      } else {
        toast.error(msg || 'Failed to complete discharge');
      }
      return;
    }
    setDone(true);
    const res = (data ?? {}) as { collected?: number; outstanding?: number; refunded?: number };
    const outstanding = Number(res.outstanding ?? 0);
    const refunded = Number(res.refunded ?? 0);
    toast.success(
      deceased
        ? `Final death settlement completed${refunded > 0 ? ` — ${fmt(refunded)} refunded` : ''}`
        : outstanding > 0
          ? `Discharged — collected ${fmt(Number(res.collected ?? 0))}, ${fmt(outstanding)} carried as debt`
          : refunded > 0
            ? `Discharged — ${fmt(refunded)} change paid back to patient`
            : 'Patient discharged — account settled',
    );
    onDischarged?.();
    onOpenChange(false);
  };



  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{deceased ? 'Deceased Patient Final Settlement' : 'Discharge'} · {patientName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Calculating bill…</p>}

          {preview && (
            <div className="p-3 rounded-lg border text-sm space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Sponsor</span>
                <Badge variant="outline" className="text-[10px] uppercase">
                  {(preview.account_type || 'cash')}{preview.insurance_plan ? ` · ${preview.insurance_plan}` : ''} · patient {preview.copay_pct}%
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Admitted</span>
                <span>{preview.admitted_at ? new Date(preview.admitted_at).toLocaleDateString() : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Discharge date</span>
                <span>{new Date().toLocaleDateString()}</span>
              </div>
              {preview.nights === 0 ? (
                <>
                  <div className="flex justify-between font-medium">
                    <span>Stay duration</span>
                    <span>Same-day admission (0 nights)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Observation fee (flat)
                    </span>
                    <span>{fmt(preview.bed_total)}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between font-medium">
                    <span>Bed nights</span>
                    <span>{preview.nights} night{preview.nights === 1 ? '' : 's'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {fmt(preview.daily_rate)}/night × {preview.nights}
                    </span>
                    <span>{fmt(preview.bed_total)}</span>
                  </div>
                </>
              )}
              {preview.sponsor_covered > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Sponsor covers ({100 - preview.copay_pct}%)</span>
                  <span>−{fmt(preview.sponsor_covered)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bed charge (patient share)</span>
                <span>{fmt(preview.bed_patient_share)}</span>
              </div>
              {preview.bed_already_billed && (
                <p className="text-[11px] text-muted-foreground">Bed charge already billed for this admission.</p>
              )}
              {preview.prior_outstanding > 0 && (
                <div className="flex justify-between text-amber-700 dark:text-amber-400">
                  <span>Outstanding (drugs / tests while admitted)</span>
                  <span>{fmt(preview.prior_outstanding)}</span>
                </div>
              )}
              <div className="flex justify-between pt-1.5 border-t font-medium">
                <span>Grand total</span>
                <span>{fmt(preview.gross_total)}</span>
              </div>
              {preview.has_wallet && (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Wallet balance</span>
                    <span>{fmt(preview.current_balance)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                    <span>Applied from balance</span>
                    <span>−{fmt(preview.wallet_applied)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between pt-1.5 border-t font-semibold">
                <span>{hasDebt ? 'Balance to pay' : 'Nothing to pay'}</span>
                <span className={hasDebt ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-600'}>
                  {fmt(due)}
                </span>
              </div>

            </div>
          )}

          <div className={`p-3 rounded-lg border flex items-center gap-2 ${
            hasDebt ? 'bg-amber-50 border-amber-300 dark:bg-amber-950/20'
                    : 'bg-emerald-50 border-emerald-300 dark:bg-emerald-950/20'
          }`}>
            <Wallet className="h-4 w-4" />
            <div className="text-sm flex-1">
              <p className="font-medium">
                {preview && !preview.has_wallet
                  ? `Sponsored account — no wallet`
                  : `Balance: ${fmt(patientBalance)}`}
              </p>
              <p className="text-xs">
                  {hasDebt
                  ? deceased
                    ? `Final settlement requires full payment of ${fmt(due)}`
                    : `Patient owes ${fmt(due)} — collect or carry as debt`
                  : preview && !preview.has_wallet
                    ? 'Sponsor covers the bill — nothing to collect'
                    : (preview?.balance_after_bed ?? 0) > 0
                      ? `Refund ${fmt(preview?.balance_after_bed ?? 0)} available at Reception`
                      : 'Zero balance — ready to discharge'}
              </p>
            </div>
          </div>

          {hasDebt && (
            <>
              <div className="space-y-2">
                  <Label>{deceased ? 'Final payment (no debt carry)' : 'Settlement'}</Label>
                <RadioGroup value={method} onValueChange={(v) => setMethod(v as Method)} className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-muted">
                    <RadioGroupItem value="cash" /><span className="text-sm">Cash</span>
                  </label>
                  <label className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-muted">
                    <RadioGroupItem value="pos" /><span className="text-sm">POS</span>
                  </label>
                  <label className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-muted">
                    <RadioGroupItem value="transfer" /><span className="text-sm">Transfer</span>
                  </label>
                  {!deceased && (
                    <label className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-muted">
                      <RadioGroupItem value="carry" /><span className="text-sm">Carry as debt</span>
                    </label>
                  )}
                  {!deceased && preview?.account_type === 'staff_family' && (
                    <label className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-muted border-emerald-200 bg-emerald-50/30">
                      <RadioGroupItem value="salary" /><span className="text-sm">Salary Deduction</span>
                    </label>
                  )}
                </RadioGroup>
              </div>

              {isPay && (
                <div className="space-y-1.5">
                  <Label>Amount collected *</Label>
                  <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  {invalidAmount && (
                    <p className="text-xs text-destructive">Enter an amount greater than zero.</p>
                  )}
                  {shortfall > 0 && !invalidAmount && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      {deceased ? `Collect the full ${fmt(due)} before final settlement.` : `Collecting ${fmt(amountNum)} · ${fmt(shortfall)} will stay as debt on the patient's balance.`}
                    </p>
                  )}
                  {amountNum > due && (
                    <p className="text-xs text-muted-foreground">
                      Excess {fmt(amountNum - due)} will remain as credit on the patient balance.
                    </p>
                  )}
                </div>
              )}

              {method === 'carry' && (
                <p className="text-xs text-muted-foreground">
                  Debt of {fmt(due)} stays on the patient's balance. Cleared on next top-up.
                </p>
              )}

              {method === 'salary' && (
                <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                  The remaining {fmt(due)} will be deducted from the linked staff member's salary.
                </p>
              )}

              <div className="space-y-1.5">
                <Label>{needsReason ? 'Reason for outstanding debt (optional)' : 'Settlement notes (optional)'}</Label>
                <Input
                  value={settlementNotes}
                  onChange={(e) => setSettlementNotes(e.target.value)}
                  placeholder={needsReason ? 'e.g. patient to pay balance next week' : 'e.g. paid to cashier Amina'}
                />
              </div>
            </>
          )}

          {changeDue > 0 && (
              <div className="p-3 rounded-lg border space-y-2">
                <p className="text-sm font-medium">{deceased ? 'Refund due to patient' : 'Change due to patient'}: {fmt(changeDue)}</p>
                <RadioGroup
                  value={refund ? 'refund' : 'keep'}
                  onValueChange={(v) => !refundRequired && setRefund(v === 'refund')}
                  className="grid grid-cols-1 gap-2"
                >
                  {!deceased && (
                    <label className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-muted">
                      <RadioGroupItem value="keep" />
                      <span className="text-sm">Leave on patient balance</span>
                    </label>
                  )}
                  <label className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-muted">
                    <RadioGroupItem value="refund" />
                    <span className="text-sm">{deceased ? 'Refund to patient now (required)' : 'Pay change back to patient now'}</span>
                  </label>
                </RadioGroup>
              </div>
          )}



          <div className="space-y-1.5">
            <Label>Discharge notes (optional)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. stable, follow-up in 1 week" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy || cancelBusy}>Close</Button>
          {!deceased && (
            <Button
              type="button"
              variant="outline"
              onClick={cancelSettlement}
              disabled={busy || cancelBusy || done || loading}
              className="mr-auto"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              {cancelBusy ? 'Cancelling…' : 'Cancel Settlement'}
            </Button>
          )}
          <Button onClick={submit} disabled={busy || cancelBusy || done || loading || invalidAmount || reasonMissing || (deceased && refundRequired && !refund)}>
            <LogOut className="h-4 w-4 mr-2" />
            {busy ? 'Finalizing…' : done ? 'Settled' : deceased ? 'Confirm Final Settlement' : 'Confirm Discharge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
