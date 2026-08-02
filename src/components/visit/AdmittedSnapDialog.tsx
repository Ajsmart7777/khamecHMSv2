import { useMemo, useRef, useState } from 'react';
import { Camera, Plus, Send, Trash2, Wallet, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { usePricelist } from '@/hooks/usePricelist';
import { InAppCameraDialog } from './InAppCameraDialog';
import { SnapCropDialog } from './SnapCropDialog';
import { hasInAppCamera } from '@/lib/isMobile';
import { copayPercent, sponsorLabel, hasWallet } from '@/lib/copay';

type OrderType = 'prescription' | 'lab' | 'treatment';
type Target = 'pharmacy' | 'lab' | 'nurse' | 'doctor';

interface Line {
  pricelist_id: string;
  name: string;
  size: string | null;
  category: string;
  unit_price: number;
  qty: number;
}

const fmt = (n: number) => `₦${Number(n || 0).toLocaleString()}`;

interface Props {
  patientId: string;
  patientName: string;
  patientBalance: number;
  sourceStation: 'nurse' | 'doctor';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
  /**
   * 'items' — pick what was prescribed/ordered straight from the pricelist;
   *           photo is optional. The order goes directly to Pharmacy/Lab.
   * 'snap'  — the classic paper-photo flow (photo required).
   */
  mode?: 'items' | 'snap';
  /** Locks the order type (and therefore the destination) when provided. */
  orderType?: OrderType;
  accountType?: string | null;
  insurancePlan?: string | null;
}

/**
 * In-ward order for ADMITTED patients — bypasses Billing.
 * Cost is priced from the pricelist; the patient's own share (copay for
 * sponsored accounts, 100% for cash) is deducted from their balance.
 */
export function AdmittedSnapDialog({
  patientId, patientName, patientBalance, sourceStation, open, onOpenChange, onCreated,
  mode = 'snap', orderType: fixedOrderType, accountType, insurancePlan,
}: Props) {
  const { items: pricelist, loading } = usePricelist();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [orderTypeState, setOrderType] = useState<OrderType>(fixedOrderType ?? 'prescription');
  const orderType = fixedOrderType ?? orderTypeState;
  const target: Target = orderType === 'lab' ? 'lab' : orderType === 'treatment' ? 'nurse' : 'pharmacy';
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [allowDebt, setAllowDebt] = useState(false);
  const [debtReason, setDebtReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const hasCam = hasInAppCamera();
  const photoRequired = mode === 'snap';

  const acceptFile = (f: File) => {
    if (!f.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    if (rawUrl) URL.revokeObjectURL(rawUrl);
    setRawFile(f);
    setRawUrl(URL.createObjectURL(f));
    setCameraOpen(false);
    setCropOpen(true);
  };

  const total = useMemo(() => lines.reduce((s, l) => s + l.unit_price * l.qty, 0), [lines]);
  const pct = copayPercent({ account_type: accountType, insurance_plan: insurancePlan });
  const patientShare = Math.round((total * pct) / 100 * 100) / 100;
  const covered = Math.max(0, Math.round((total - patientShare) * 100) / 100);
  const walletPatient = hasWallet({ account_type: accountType });
  const shortfall = walletPatient ? Math.max(0, patientShare - patientBalance) : 0;
  const insufficient = shortfall > 0;

  const filteredPricelist = useMemo(() => {
    const active = pricelist.filter((p: any) => p.active !== false);
    if (orderType === 'lab') return active.filter((p: any) => ['lab', 'imaging'].includes(p.category));
    if (orderType === 'prescription') return active.filter((p: any) => String(p.category ?? '').startsWith('drug') || p.category === 'consumable');
    return active;
  }, [pricelist, orderType]);

  const reset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (rawUrl) URL.revokeObjectURL(rawUrl);
    setFile(null); setPreviewUrl(null); setNote(''); setLines([]);
    setRawFile(null); setRawUrl(null); setCropOpen(false);
    setAllowDebt(false); setDebtReason('');
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) { e.target.value = ''; return; }
    acceptFile(f);
    requestAnimationFrame(() => { try { e.target.value = ''; } catch {} });
  };

  const addLine = (item: any) => {
    const packQty = Number(item.pack_qty ?? 1) || 1;
    const unit = Number(item.price ?? 0) / packQty;
    setLines((prev) => [...prev, {
      pricelist_id: item.id,
      name: item.name,
      size: item.size ?? null,
      category: item.category ?? '',
      unit_price: Math.round(unit * 100) / 100,
      qty: 1,
    }]);
    setPickerOpen(false);
  };

  const changeQty = (idx: number, qty: number) => {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, qty: Math.max(1, qty) } : l));
  };

  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const submit = async () => {
    if (photoRequired && !file) { toast.error('Take a photo of the order first'); return; }
    if (lines.length === 0) {
      toast.error(orderType === 'lab' ? 'Add at least one lab test' : 'Add at least one item from the pricelist');
      return;
    }
    if (insufficient && !allowDebt) {
      toast.error('Insufficient balance', {
        description: `Patient needs ${fmt(shortfall)} more. Ask reception to top up, or tick "Proceed as debt" with a reason.`,
      });
      return;
    }
    if (insufficient && allowDebt && debtReason.trim().length < 3) {
      toast.error('Reason required for debt override');
      return;
    }

    setBusy(true);
    try {
      let path: string | null = null;
      if (file) {
        path = `admitted/${patientId}/${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await supabase.storage
          .from('visit-cards')
          .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
        if (upErr) throw upErr;
      }

      const { error } = await supabase.rpc('create_admitted_snap', {
        _patient_id: patientId,
        _order_type: orderType,
        _target_station: target,
        _photo_path: path as any,
        _note: note.trim() || null,
        _items: lines as any,
        _total: total,
        _allow_debt: allowDebt,
        _debt_reason: allowDebt ? debtReason.trim() : null,
      });

      if (error) {
        if (error.message?.includes('INSUFFICIENT_BALANCE')) {
          toast.error('Insufficient balance', {
            description: `Send patient to reception to top up ${fmt(shortfall)}.`,
          });
        } else {
          toast.error(error.message);
        }
        return;
      }

      toast.success('Sent to ' + target, {
        description: `${fmt(patientShare)} deducted from patient balance${covered > 0 ? ` · ${fmt(covered)} covered by sponsor` : ''}${insufficient ? ` (₦${shortfall.toLocaleString()} debt)` : ''}.`,
      });
      onCreated?.();
      reset();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to send');
    } finally {
      setBusy(false);
    }
  };

  const heading = mode === 'items'
    ? (orderType === 'lab' ? 'Order Lab Tests' : orderType === 'treatment' ? 'Ward Treatment' : 'Dispense Order · Pharmacy')
    : 'In-Ward Snap';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{heading} · {patientName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Balance banner */}
          <div className={`p-3 rounded-lg border flex items-center gap-2 ${insufficient ? 'bg-amber-50 border-amber-300 dark:bg-amber-950/20' : 'bg-emerald-50 border-emerald-300 dark:bg-emerald-950/20'}`}>
            <Wallet className="h-4 w-4" />
            <div className="text-sm flex-1">
              <p className="font-medium">
                {walletPatient ? `Balance: ${fmt(patientBalance)}` : 'Sponsored account — no wallet'}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {sponsorLabel({ account_type: accountType, insurance_plan: insurancePlan })} · patient pays {pct}%
                </span>
              </p>
              {insufficient ? (
                <p className="text-xs">Patient share {fmt(patientShare)} exceeds balance by {fmt(shortfall)}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Order {fmt(total)} → patient {fmt(patientShare)}{covered > 0 ? ` · sponsor ${fmt(covered)}` : ''}
                  {walletPatient ? ` — balance left ${fmt(patientBalance - patientShare)}` : ' — settled at discharge / claim'}
                </p>
              )}
            </div>
          </div>

          {/* Photo */}
          <div className="space-y-2">
            <Label>{photoRequired ? 'Photo of the paper order *' : 'Photo (optional)'}</Label>
            <input ref={inputRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
            <InAppCameraDialog open={cameraOpen} onCancel={() => setCameraOpen(false)} onCapture={acceptFile} />
            {rawUrl && rawFile && (
              <SnapCropDialog
                open={cropOpen}
                imageUrl={rawUrl}
                originalFile={rawFile}
                onCancel={() => { setCropOpen(false); if (rawUrl) URL.revokeObjectURL(rawUrl); setRawUrl(null); setRawFile(null); }}
                onConfirm={(croppedFile, croppedUrl) => {
                  if (previewUrl) URL.revokeObjectURL(previewUrl);
                  setFile(croppedFile);
                  setPreviewUrl(croppedUrl);
                  setCropOpen(false);
                }}
              />
            )}
            {previewUrl ? (
              <div className="relative rounded-lg overflow-hidden bg-muted max-h-64">
                <img src={previewUrl} alt="preview" className="w-full max-h-64 object-contain" />
                <Button size="sm" variant="secondary" className="absolute top-2 right-2" onClick={() => { if (previewUrl) URL.revokeObjectURL(previewUrl); setFile(null); setPreviewUrl(null); }}>
                  <X className="h-3 w-3 mr-1" /> Retake
                </Button>
              </div>
            ) : (
              <Button variant="outline" className="w-full" onClick={() => {
                if (hasCam) setCameraOpen(true);
                else inputRef.current?.click();
              }}>
                <Camera className="h-4 w-4 mr-2" />
                {photoRequired ? 'Take photo' : 'Attach photo (optional)'}
              </Button>
            )}
          </div>

          {/* Order type — only when not locked by the caller */}
          {!fixedOrderType && (
            <div className="space-y-2">
              <Label>Order type</Label>
              <RadioGroup value={orderType} onValueChange={(v) => setOrderType(v as OrderType)} className="grid grid-cols-3 gap-2">
                <label className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-muted">
                  <RadioGroupItem value="prescription" /><span className="text-sm">Prescription</span>
                </label>
                <label className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-muted">
                  <RadioGroupItem value="lab" /><span className="text-sm">Lab</span>
                </label>
                <label className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-muted">
                  <RadioGroupItem value="treatment" /><span className="text-sm">Treatment</span>
                </label>
              </RadioGroup>
            </div>
          )}

          {/* Items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{orderType === 'lab' ? 'Lab tests ordered *' : 'Items prescribed (from pricelist) *'}</Label>
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Plus className="h-3 w-3 mr-1" /> {orderType === 'lab' ? 'Add test' : 'Add item'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0" align="end">
                  <Command>
                    <CommandInput placeholder={loading ? 'Loading pricelist…' : orderType === 'lab' ? 'Search lab test…' : 'Search item…'} />
                    <CommandList>
                      <CommandEmpty>No items found.</CommandEmpty>
                      <CommandGroup>
                        {filteredPricelist.slice(0, 200).map((item: any) => (
                          <CommandItem key={item.id} value={`${item.name} ${item.size ?? ''}`} onSelect={() => addLine(item)}>
                            <div className="flex items-center justify-between w-full gap-2">
                              <span className="truncate">{item.name} {item.size && <span className="text-muted-foreground">· {item.size}</span>}</span>
                              <Badge variant="outline" className="text-[10px]">{fmt(item.unit_price ?? item.price ?? 0)}</Badge>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {lines.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">
                {orderType === 'lab' ? 'No tests added yet.' : 'No items added yet.'}
              </p>
            ) : (
              <div className="space-y-1">
                {lines.map((l, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 border rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{l.name}{l.size && <span className="text-muted-foreground"> · {l.size}</span>}</p>
                      <p className="text-xs text-muted-foreground">{fmt(l.unit_price)} × {l.qty} = {fmt(l.unit_price * l.qty)}</p>
                    </div>
                    <Input type="number" min={1} value={l.qty} onChange={(e) => changeQty(i, parseInt(e.target.value) || 1)} className="w-16" />
                    <Button size="sm" variant="ghost" onClick={() => removeLine(i)}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                ))}
                <div className="flex items-center justify-end pt-1 text-sm font-semibold">
                  Total: {fmt(total)}
                </div>
              </div>
            )}
          </div>

          {/* Note */}
          <div className="space-y-1.5">
            <Label>Note (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. bedside, urgent" />
          </div>

          {/* Debt override */}
          {insufficient && (
            <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <Checkbox checked={allowDebt} onCheckedChange={(v) => setAllowDebt(!!v)} className="mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium">Proceed as debt (balance → negative)</p>
                  <p className="text-xs text-muted-foreground">Ask patient to top up later, or reconcile at discharge.</p>
                </div>
              </label>
              {allowDebt && (
                <div className="space-y-1">
                  <Label className="text-xs">Reason *</Label>
                  <Textarea rows={2} value={debtReason} onChange={(e) => setDebtReason(e.target.value)} placeholder="e.g. emergency antibiotics, family will deposit today" />
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            <Send className="h-4 w-4 mr-2" />
            {busy ? 'Sending…' : `Send to ${target}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
