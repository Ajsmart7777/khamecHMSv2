import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { History, Loader2 } from 'lucide-react';
import { PatientJourneyTimeline } from './PatientJourneyTimeline';
import { Patient } from '@/contexts/PatientContext';

interface JourneyEvent {
  id: string;
  type: 'registration' | 'vitals' | 'consultation' | 'lab_test' | 'billing' | 'pharmacy' | 'payment';
  title: string;
  description: string;
  timestamp: Date;
  status: 'completed' | 'in_progress' | 'pending';
  details?: Record<string, string | number>;
}

interface PatientJourneyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient;
}

const STATE_TO_EVENT: Record<string, { type: JourneyEvent['type']; title: string; description: string }> = {
  registered:       { type: 'registration', title: 'Registered',          description: 'Patient registered at Reception' },
  waiting:          { type: 'registration', title: 'Waiting',             description: 'Awaiting triage' },
  with_nurse:       { type: 'vitals',       title: 'With Nurse',          description: 'Vitals / triage at Nurse Station' },
  with_doctor:      { type: 'consultation', title: 'With Doctor',         description: 'Consultation in progress' },
  in_lab:           { type: 'lab_test',     title: 'In Laboratory',       description: 'Lab tests requested / running' },
  awaiting_billing: { type: 'billing',      title: 'Awaiting Billing',    description: 'Order sent to Billing' },
  awaiting_payment: { type: 'billing',      title: 'Awaiting Cashier',    description: 'Invoice awaiting payment at Cashier' },
  at_pharmacy:      { type: 'pharmacy',     title: 'At Pharmacy',         description: 'Prescription awaiting dispense' },
  admitted:         { type: 'consultation', title: 'Admitted',            description: 'Patient admitted to ward' },
  discharged:       { type: 'payment',      title: 'Discharged',          description: 'Patient discharged' },
};

export function PatientJourneyDialog({
  open,
  onOpenChange,
  patient,
}: PatientJourneyDialogProps) {
  const [events, setEvents] = useState<JourneyEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const list: JourneyEvent[] = [{
        id: `reg-${patient.id}`,
        type: 'registration',
        title: 'Patient Registration',
        description: 'Patient registered at Reception',
        timestamp: new Date(patient.registered_at),
        status: 'completed',
        details: { 'Card Number': patient.card_number, 'Account Type': patient.account_type },
      }];

      const { data } = await supabase
        .from('patient_journey_history')
        .select('id, to_state, to_owner_role, department, location, reason, created_at')
        .eq('patient_id', patient.id)
        .order('created_at', { ascending: true });

      const rows = data ?? [];
      rows.forEach((row, idx) => {
        const meta = STATE_TO_EVENT[row.to_state] ?? {
          type: 'consultation' as const,
          title: row.to_state,
          description: row.reason ?? '',
        };
        const isLast = idx === rows.length - 1;
        list.push({
          id: row.id,
          type: meta.type,
          title: meta.title,
          description: meta.description,
          timestamp: new Date(row.created_at),
          status: isLast && patient.status !== 'discharged' ? 'in_progress' : 'completed',
          details: {
            ...(row.to_owner_role ? { 'Owner': row.to_owner_role } : {}),
            ...(row.department ? { 'Department': row.department } : {}),
            ...(row.location ? { 'Location': row.location } : {}),
            ...(row.reason ? { 'Reason': row.reason } : {}),
          },
        });
      });

      if (!cancelled) {
        setEvents(list);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, patient.id, patient.status, patient.registered_at, patient.card_number, patient.account_type]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Patient Journey
          </DialogTitle>
        </DialogHeader>
        
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading journey…
          </div>
        ) : (
          <PatientJourneyTimeline
            patientName={`${patient.first_name} ${patient.last_name}`}
            cardNumber={patient.card_number}
            events={events}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
