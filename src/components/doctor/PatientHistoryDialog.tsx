import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Thermometer, Pill, FlaskConical, FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Patient } from '@/contexts/PatientContext';

interface PatientHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient;
}

interface HistoryEntry {
  date: string;
  type: 'vitals' | 'prescription' | 'lab';
  data: Record<string, unknown>;
}

export function PatientHistoryDialog({ open, onOpenChange, patient }: PatientHistoryDialogProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetchHistory();
    }
  }, [open, patient.id]);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const [vitalsRes, prescriptionsRes, labRes] = await Promise.all([
        supabase.from('vitals').select('*').eq('patient_id', patient.id).order('created_at', { ascending: false }),
        supabase.from('prescriptions').select('*, prescription_items(*)').eq('patient_id', patient.id).order('created_at', { ascending: false }),
        supabase.from('lab_requests').select('*').eq('patient_id', patient.id).order('created_at', { ascending: false }),
      ]);

      const entries: HistoryEntry[] = [];

      (vitalsRes.data || []).forEach(v => {
        entries.push({ date: (v as any).created_at, type: 'vitals', data: v });
      });
      (prescriptionsRes.data || []).forEach(p => {
        entries.push({ date: (p as any).created_at, type: 'prescription', data: p });
      });
      (labRes.data || []).forEach(l => {
        entries.push({ date: (l as any).created_at, type: 'lab', data: l });
      });

      entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setHistory(entries);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  const renderEntry = (entry: HistoryEntry, index: number) => {
    const d = entry.data as Record<string, any>;
    const dateStr = format(new Date(entry.date), 'MMM dd, yyyy • h:mm a');

    if (entry.type === 'vitals') {
      return (
        <div key={`v-${index}`} className="p-4 border border-border rounded-lg">
          <div className="flex justify-between items-start mb-2">
            <div className="flex items-center gap-2">
              <Thermometer className="h-4 w-4 text-destructive" />
              <h4 className="font-medium text-sm">Vitals Recorded</h4>
            </div>
            <span className="text-xs text-muted-foreground">{dateStr}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
            {d.temperature && <span>Temp: {d.temperature}°C</span>}
            {d.blood_pressure && <span>BP: {d.blood_pressure}</span>}
            {d.pulse && <span>Pulse: {d.pulse} bpm</span>}
            {d.respiratory_rate && <span>RR: {d.respiratory_rate}</span>}
            {d.weight && <span>Weight: {d.weight} kg</span>}
            {d.height && <span>Height: {d.height} cm</span>}
          </div>
          {d.notes && <p className="text-xs text-muted-foreground mt-2">Notes: {d.notes}</p>}
        </div>
      );
    }

    if (entry.type === 'prescription') {
      const items = d.prescription_items || [];
      return (
        <div key={`p-${index}`} className="p-4 border border-border rounded-lg">
          <div className="flex justify-between items-start mb-2">
            <div className="flex items-center gap-2">
              <Pill className="h-4 w-4 text-primary" />
              <h4 className="font-medium text-sm">Prescription</h4>
              <Badge variant="outline" className="text-xs">{d.status}</Badge>
            </div>
            <span className="text-xs text-muted-foreground">{dateStr}</span>
          </div>
          {d.diagnosis && <p className="text-xs text-muted-foreground mb-1">Diagnosis: {d.diagnosis}</p>}
          {items.length > 0 && (
            <div className="text-xs text-muted-foreground">
              Medications: {items.map((i: any) => `${i.medication} (${i.dosage})`).join(', ')}
            </div>
          )}
        </div>
      );
    }

    if (entry.type === 'lab') {
      return (
        <div key={`l-${index}`} className="p-4 border border-border rounded-lg">
          <div className="flex justify-between items-start mb-2">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-accent" />
              <h4 className="font-medium text-sm">Lab Request</h4>
              <Badge variant="outline" className="text-xs">{d.status}</Badge>
            </div>
            <span className="text-xs text-muted-foreground">{dateStr}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Tests: {(d.tests as string[] || []).join(', ')}
          </p>
        </div>
      );
    }

    return null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="animate-scale-in max-w-2xl">
        <DialogHeader>
          <DialogTitle>Patient Medical History</DialogTitle>
          <DialogDescription>{patient.first_name} {patient.last_name} - {patient.card_number}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-4 max-h-96 overflow-y-auto">
          {loading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Loading history...</div>
          ) : history.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No previous visits recorded</p>
            </div>
          ) : (
            history.map((entry, i) => renderEntry(entry, i))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
