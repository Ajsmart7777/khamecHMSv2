import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Camera, Upload, X, Loader2, Stethoscope } from 'lucide-react';
import { usePatients } from '@/contexts/PatientContext';
import { useExternalDoctors } from '@/hooks/useExternalDoctors';
import { useStandingOrders } from '@/hooks/useStandingOrders';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetPatientId?: string;
}

export function StandingOrderCaptureDialog({ open, onOpenChange, presetPatientId }: Props) {
  const { patients } = usePatients();
  const { doctors } = useExternalDoctors();
  const { createOrder } = useStandingOrders();

  const [patientId, setPatientId] = useState<string>(presetPatientId || '');
  const [doctorId, setDoctorId] = useState<string>('');
  const [doctorNameFallback, setDoctorNameFallback] = useState('');
  const [notes, setNotes] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPatientId(presetPatientId || '');
      setDoctorId('');
      setDoctorNameFallback('');
      setNotes('');
      setExpiryDate('');
      setPhoto(null);
      setPreview(null);
      setSearch('');
    }
  }, [open, presetPatientId]);

  const handleFile = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
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

  const canSave = patientId && photo && (doctorId || doctorNameFallback.trim());

  const handleSave = async () => {
    if (!canSave || !photo) return;
    setSaving(true);
    const result = await createOrder({
      patient_id: patientId,
      external_doctor_id: doctorId || null,
      external_doctor_name: doctorId ? null : doctorNameFallback.trim(),
      photo,
      notes: notes || null,
      expiry_date: expiryDate || null,
    });
    setSaving(false);
    if (result) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope className="h-5 w-5 text-primary" />
            Capture External Prescription
          </DialogTitle>
          <DialogDescription>
            Snap or upload a photo of the prescription from an external doctor. It will be queued for pharmacy fulfillment.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Patient *</Label>
            {!presetPatientId && (
              <Input
                placeholder="Search by name or card number"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="mb-2"
              />
            )}
            <Select value={patientId} onValueChange={setPatientId} disabled={!!presetPatientId}>
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

          <div>
            <Label>External Doctor *</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger><SelectValue placeholder="Select registered external doctor" /></SelectTrigger>
              <SelectContent>
                {doctors.filter(d => d.status === 'active').map(d => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}{d.specialty ? ` — ${d.specialty}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!doctorId && (
              <Input
                placeholder="Or type doctor's name (if not registered)"
                value={doctorNameFallback}
                onChange={(e) => setDoctorNameFallback(e.target.value)}
                className="mt-2"
              />
            )}
          </div>

          <div>
            <Label>Prescription Photo *</Label>
            <div className="flex gap-2 mt-1">
              <Button type="button" variant="outline" onClick={() => cameraRef.current?.click()} className="flex-1">
                <Camera className="h-4 w-4 mr-1.5" /> Camera
              </Button>
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} className="flex-1">
                <Upload className="h-4 w-4 mr-1.5" /> Upload
              </Button>
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] || null)}
              />
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] || null)}
              />
            </div>
            {preview && (
              <div className="relative mt-2 rounded-lg border overflow-hidden bg-muted">
                <img src={preview} alt="Prescription preview" className="w-full max-h-72 object-contain" />
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
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Expiry date</Label>
              <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saving</> : 'Save standing order'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}