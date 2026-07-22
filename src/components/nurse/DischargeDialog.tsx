import { useState } from 'react';
import { LogOut, Wallet } from 'lucide-react';
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
import { useAuth } from '@/contexts/AuthContext';

type Method = 'cash' | 'pos' | 'transfer' | 'waive' | 'carry';

interface Props {
  admissionId: string;
  patientId: string;
  patientName: string;
  patientBalance: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDischarged?: () => void;
}

const fmt = (n: number) => `₦${Number(n || 0).toLocaleString()}`;

/**
 * Discharge dialog — reconciles patient balance before discharge.
 * If balance is negative, cashier collects the shortfall, or accountant/admin waives it,
 * or the debt is carried on the patient balance.
 */
export function DischargeDialog({
  admissionId, patientId, patientName, patientBalance, open, onOpenChange, onDischarged,
}: Props) {
  const { role } = useAuth();
  const debt = Math.max(0, -patientBalance);
  const hasDebt = debt > 0;

  const [notes, setNotes] = useState('');
  const [method, setMethod] = useState<Method>('cash');
  const [amount, setAmount] = useState<string>(debt.toString());
  const [settlementNotes, setSettlementNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const canWaive = role === 'accountant' || role === 'admin';
  const payMethods: Method[] = ['cash', 'pos', 'transfer'];
  const amountNum = Number(amount) || 0;
  const collectShort = payMethods.includes(method) && hasDebt && amountNum < debt;

  const submit = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('discharge_admission', {
      _admission_id: admissionId,
      _notes: notes.trim() || null,
      _settlement_method: hasDebt ? method : null,
      _settlement_amount: hasDebt && payMethods.includes(method) ? amountNum : 0,
      _settlement_notes: settlementNotes.trim() || null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Patient discharged');
    onDischarged?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Discharge · {patientName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className={`p-3 rounded-lg border flex items-center gap-2 ${
            hasDebt ? 'bg-amber-50 border-amber-300 dark:bg-amber-950/20'
                    : 'bg-emerald-50 border-emerald-300 dark:bg-emerald-950/20'
          }`}>
            <Wallet className="h-4 w-4" />
            <div className="text-sm flex-1">
              <p className="font-medium">Balance: {fmt(patientBalance)}</p>
              <p className="text-xs">
                {hasDebt ? `Patient owes ${fmt(debt)} — settle before discharge`
                         : patientBalance > 0 ? `Refund ${fmt(patientBalance)} available at Reception`
                         : 'Zero balance — ready to discharge'}
              </p>
            </div>
          </div>

          {hasDebt && (
            <>
              <div className="space-y-2">
                <Label>Settlement</Label>
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
                  <label className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-muted">
                    <RadioGroupItem value="carry" /><span className="text-sm">Carry as debt</span>
                  </label>
                  {canWaive && (
                    <label className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-muted col-span-2">
                      <RadioGroupItem value="waive" />
                      <span className="text-sm">Waive debt <Badge variant="outline" className="ml-1 text-[10px]">Accountant</Badge></span>
                    </label>
                  )}
                </RadioGroup>
              </div>

              {payMethods.includes(method) && (
                <div className="space-y-1.5">
                  <Label>Amount collected *</Label>
                  <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  {collectShort && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Must be at least {fmt(debt)}.
                    </p>
                  )}
                  {amountNum > debt && (
                    <p className="text-xs text-muted-foreground">
                      Excess {fmt(amountNum - debt)} will remain on patient balance.
                    </p>
                  )}
                </div>
              )}

              {method === 'carry' && (
                <p className="text-xs text-muted-foreground">
                  Debt of {fmt(debt)} stays on the patient's balance. Cleared on next top-up.
                </p>
              )}

              <div className="space-y-1.5">
                <Label>Settlement notes (optional)</Label>
                <Input value={settlementNotes} onChange={(e) => setSettlementNotes(e.target.value)} placeholder="e.g. paid to cashier Amina" />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label>Discharge notes (optional)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. stable, follow-up in 1 week" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || (hasDebt && payMethods.includes(method) && collectShort)}>
            <LogOut className="h-4 w-4 mr-2" />
            {busy ? 'Discharging…' : 'Confirm Discharge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
