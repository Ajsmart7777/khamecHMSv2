import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Wallet, ArrowDownCircle, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useBalanceRequests, BalanceRequest } from '@/hooks/useBalanceRequests';
import { usePatients } from '@/contexts/PatientContext';
import { toast } from 'sonner';

type PanelType = 'topup' | 'refund';

export function BalanceRequestsPanel({ type }: { type: PanelType }) {
  const { getPendingByType, confirmRequest, rejectRequest } = useBalanceRequests();
  const { patients } = usePatients();
  const [active, setActive] = useState<BalanceRequest | null>(null);
  const [action, setAction] = useState<'confirm' | 'reject' | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const pending = getPendingByType(type);
  const isTopup = type === 'topup';
  const Icon = isTopup ? Wallet : ArrowDownCircle;
  const title = isTopup ? 'Top-Up Requests' : 'Refund Requests';
  const accent = isTopup ? 'text-primary' : 'text-warning';

  const openConfirm = (r: BalanceRequest) => {
    const p = patients.find(x => x.id === r.patient_id);
    setActive(r);
    setAction('confirm');
    setAmount('');
    setMethod(isTopup ? 'cash' : 'cash');
    setReason('');
    // For refund, prefill max to current balance
    if (!isTopup && p) setAmount(String(p.balance));
  };

  const openReject = (r: BalanceRequest) => {
    setActive(r);
    setAction('reject');
    setReason('');
  };

  const close = () => { setActive(null); setAction(null); };

  const handleConfirm = async () => {
    if (!active) return;
    const patient = patients.find(p => p.id === active.patient_id);
    if (!patient) return;
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    if (!isTopup && amt > Number(patient.balance)) {
      toast.error(`Cannot exceed available balance (₦${Number(patient.balance).toLocaleString()})`);
      return;
    }
    setBusy(true);
    const ok = await confirmRequest(active, amt, method, `${patient.first_name} ${patient.last_name}`);
    setBusy(false);
    if (ok) close();
  };

  const handleReject = async () => {
    if (!active) return;
    if (!reason.trim()) { toast.error('Reason is required'); return; }
    setBusy(true);
    const ok = await rejectRequest(active.id, reason.trim());
    setBusy(false);
    if (ok) close();
  };

  return (
    <>
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <Icon className={`h-4 w-4 ${accent}`} />
            {title}
          </h3>
          <Badge variant={pending.length ? 'warning' : 'outline'}>{pending.length}</Badge>
        </div>

        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {pending.map(r => {
            const p = patients.find(x => x.id === r.patient_id);
            const mins = Math.max(0, Math.floor((new Date(r.expires_at).getTime() - Date.now()) / 60000));
            return (
              <div key={r.id} className="p-3 rounded-lg border border-border hover:border-primary/40 transition">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">
                      {p ? `${p.first_name} ${p.last_name}` : 'Unknown patient'}
                    </p>
                    <p className="text-[11px] text-muted-foreground font-mono">{p?.card_number}</p>
                    {r.notes && <p className="text-xs mt-1 text-muted-foreground line-clamp-2">"{r.notes}"</p>}
                    <p className="text-xs mt-1">
                      Balance: <span className="font-semibold">₦{Number(p?.balance ?? 0).toLocaleString()}</span>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <Badge variant="outline" className="text-[10px]">
                      <Clock className="h-3 w-3 mr-1" /> {mins}m left
                    </Badge>
                  </div>
                </div>
                <div className="flex gap-2 mt-2">
                  <Button size="sm" variant="hero" className="flex-1" onClick={() => openConfirm(r)}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    {isTopup ? 'Payment Received' : 'Cash Out'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openReject(r)}>
                    <XCircle className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
          {pending.length === 0 && (
            <div className="text-center py-6 text-muted-foreground">
              <Icon className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No pending {isTopup ? 'top-ups' : 'refunds'}</p>
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!active && action === 'confirm'} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon className={`h-5 w-5 ${accent}`} />
              {isTopup ? 'Confirm Deposit' : 'Confirm Refund'}
            </DialogTitle>
            <DialogDescription>
              {isTopup
                ? 'Enter the amount received from the patient. On confirmation it will be added to their balance instantly.'
                : 'Enter the amount to hand back to the patient. It will be deducted from their balance instantly.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Amount (₦)</label>
              <Input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                {isTopup ? 'Payment Method' : 'Payout Method'}
              </label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  {isTopup && <SelectItem value="pos">POS</SelectItem>}
                  {isTopup && <SelectItem value="transfer">Bank Transfer</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
            <Button variant="hero" onClick={handleConfirm} disabled={busy}>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              {isTopup ? 'Confirm & Credit Balance' : 'Confirm & Cash Out'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!active && action === 'reject'} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Request</DialogTitle>
            <DialogDescription>Provide a reason so reception knows why.</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for rejection" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={busy}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
