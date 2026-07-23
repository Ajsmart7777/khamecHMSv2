import { useState, useRef, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Camera, X, Loader2, FileText } from 'lucide-react';
import { usePatients } from '@/contexts/PatientContext';
import { useStandingOrders } from '@/hooks/useStandingOrders';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { InAppCameraDialog } from '@/components/visit/InAppCameraDialog';
import { isMobileWithCamera } from '@/lib/isMobile';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetPatientId?: string;
}

type OrderType = 'prescription' | 'lab' | 'both';

const ORDER_TYPES: { value: OrderType; label: string }[] = [
  { value: 'prescription', label: 'Prescription' },
  { value: 'lab', label: 'Lab test' },
  { value: 'both', label: 'Both' },
];

export function StandingOrderCaptureDialog({ open, onOpenChange, presetPatientId }: Props) {
  const { patients } = usePatients();
  const { createOrder } = useStandingOrders();

  const [patientId, setPatientId] = useState<string>(presetPatientId || '');
  const [orderType, setOrderType] = useState<OrderType>('prescription');
  const [doctorName, setDoctorName] = useState('');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const cameraRef = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const isMobile = isMobileWithCamera();

  useEffect(() => {
    if (open) {
      setPatientId(presetPatientId || '');
      setOrderType('prescription');
      setDoctorName('');
      setNotes('');
      setPhoto(null);
      setPreview(null);
      setSearch('');
    }
  }, [open, presetPatientId]);

  const selectedPatient = useMemo(
    () => patients.find(p => p.id === patientId) || null,
    [patients, patientId]
  );

  const handleFile = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please attach an image');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image must be under 10MB');
      return;
    }
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  };

  const filteredPatients = patients.filter(p => {
    const q = search.toLowerCase();
    if (!q) return true;
    return `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) || (p.card_number || '').toLowerCase().includes(q);
  }).slice(0, 20);

  const canSend = !!patientId && !!photo;

  const handleSend = async () => {
    if (!canSend || !photo) return;
    setSaving(true);
    const result = await createOrder({
      patient_id: patientId,
      external_doctor_id: null,
      external_doctor_name: doctorName.trim() || null,
      photo,
      notes: notes.trim() || null,
      order_type: orderType,
    });
    setSaving(false);
    if (result) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Attach External Doctor Order
          </DialogTitle>
          <DialogDescription>
            Take a photo of the paper prescription or lab request written by the sponsor's doctor. It will be forwarded to Billing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Patient */}
          {selectedPatient ? (
            <div className="rounded-lg border bg-muted/40 px-3 py-2">
              <div className="font-medium">{selectedPatient.first_name} {selectedPatient.last_name}</div>
              <div className="text-xs text-muted-foreground">{selectedPatient.card_number}</div>
            </div>
          ) : (
            <div>
              <Label>Patient *</Label>
              <Input
                placeholder="Search by name or card number"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="mb-2"
              />
              <Select value={patientId} onValueChange={setPatientId}>
                <SelectTrigger><SelectValue placeholder="Select patient" /></SelectTrigger>
                <SelectContent>
                  {filteredPatients.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.first_name} {p.last_name} — {p.card_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Order type */}
          <div>
            <Label>Order type</Label>
            <div className="grid grid-cols-3 gap-2 mt-1.5">
              {ORDER_TYPES.map(opt => {
                const active = orderType === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setOrderType(opt.value)}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition",
                      active ? "border-primary bg-primary/5 text-foreground" : "border-input hover:bg-accent"
                    )}
                  >
                    <span className={cn(
                      "h-3.5 w-3.5 rounded-full border flex items-center justify-center",
                      active ? "border-primary" : "border-muted-foreground/40"
                    )}>
                      {active && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </span>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Doctor name */}
          <div>
            <Label htmlFor="ext-doctor-name">Doctor's name (optional)</Label>
            <Input
              id="ext-doctor-name"
              placeholder="e.g. Dr. Aliyu (Katchma corporate)"
              value={doctorName}
              onChange={(e) => setDoctorName(e.target.value)}
            />
          </div>

          {/* Photo */}
          <div>
            <Label>Order photo</Label>
            {!preview ? (
              <div
              onClick={() => { if (isMobile) setCameraOpen(true); else cameraRef.current?.click(); }}
                className="mt-1.5 flex flex-col items-start gap-2 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 px-4 py-4 cursor-pointer hover:bg-muted/40 transition"
              >
                <p className="text-sm text-muted-foreground">Attach photo of the paper order</p>
              <Button type="button" variant="outline" size="sm" onClick={(e) => {
                e.stopPropagation();
                if (isMobile) setCameraOpen(true);
                else cameraRef.current?.click();
              }}>
                  <Camera className="h-4 w-4 mr-1.5" /> Take photo
                </Button>
              </div>
            ) : (
              <div className="relative mt-1.5 rounded-lg border overflow-hidden bg-muted">
                <img src={preview} alt="Order preview" className="w-full max-h-64 object-contain" />
                <Button
                  type="button"
                  size="icon"
                  variant="destructive"
                  className="absolute top-2 right-2 h-7 w-7"
                  onClick={() => { setPhoto(null); setPreview(null); }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] || null)}
            />
            <InAppCameraDialog
              open={cameraOpen}
              onCancel={() => setCameraOpen(false)}
              onCapture={(f) => { handleFile(f); setCameraOpen(false); }}
            />
          </div>

          {/* Notes */}
          <div>
            <Label htmlFor="ext-notes">Notes (optional)</Label>
            <Textarea
              id="ext-notes"
              placeholder="Anything Billing should know"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSend} disabled={!canSend || saving}>
            {saving ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Sending</> : 'Send to Billing'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
