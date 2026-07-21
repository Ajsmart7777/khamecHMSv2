import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { History, X } from 'lucide-react';
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

// Generate mock journey events based on patient data
// In a real app, this would come from the database
function generateJourneyEvents(patient: Patient): JourneyEvent[] {
  const events: JourneyEvent[] = [];
  const now = new Date();
  
  // Registration event (always present)
  events.push({
    id: `reg-${patient.id}`,
    type: 'registration',
    title: 'Patient Registration',
    description: 'Patient registered at Reception',
    timestamp: new Date(patient.registered_at),
    status: 'completed',
    details: {
      'Card Number': patient.card_number,
      'Account Type': patient.account_type,
    },
  });

  // Generate events based on current status
  const statusFlow: PatientStatus[] = [
    'registered', 'waiting', 'with_nurse', 'with_doctor', 
    'in_lab', 'awaiting_billing', 'awaiting_payment', 'at_pharmacy', 'discharged'
  ];

  type PatientStatus = 'registered' | 'waiting' | 'with_nurse' | 'with_doctor' | 
    'in_lab' | 'awaiting_billing' | 'awaiting_payment' | 'at_pharmacy' | 'discharged' | 'admitted';

  const currentIndex = statusFlow.indexOf(patient.status as PatientStatus);

  // Add vitals if past waiting
  if (currentIndex >= 2) {
    events.push({
      id: `vitals-${patient.id}`,
      type: 'vitals',
      title: 'Vitals Recorded',
      description: 'Vitals taken at Nurse Station',
      timestamp: new Date(now.getTime() - 3600000),
      status: 'completed',
      details: {
        'Blood Pressure': '120/80 mmHg',
        'Temperature': '37.2°C',
        'Pulse': '72 bpm',
      },
    });
  }

  // Add consultation if past with_doctor
  if (currentIndex >= 3) {
    events.push({
      id: `consult-${patient.id}`,
      type: 'consultation',
      title: 'Doctor Consultation',
      description: 'Examined by attending physician',
      timestamp: new Date(now.getTime() - 2700000),
      status: 'completed',
      details: {
        'Doctor': 'Dr. Ahmed',
        'Duration': '15 mins',
      },
    });
  }

  // Add lab test if past in_lab
  if (currentIndex >= 4) {
    events.push({
      id: `lab-${patient.id}`,
      type: 'lab_test',
      title: 'Laboratory Tests',
      description: 'Blood work and urinalysis',
      timestamp: new Date(now.getTime() - 1800000),
      status: currentIndex === 4 ? 'in_progress' : 'completed',
      details: {
        'Tests': 'CBC, Urinalysis',
        'Lab Tech': 'Lab Staff',
      },
    });
  }

  // Add billing if past awaiting_billing
  if (currentIndex >= 5) {
    events.push({
      id: `billing-${patient.id}`,
      type: 'billing',
      title: 'Invoice Generated',
      description: 'Bill prepared for services',
      timestamp: new Date(now.getTime() - 900000),
      status: currentIndex === 5 ? 'in_progress' : 'completed',
      details: {
        'Total': `₦${(Math.random() * 50000 + 5000).toFixed(0)}`,
      },
    });
  }

  // Add payment if past awaiting_payment
  if (currentIndex >= 6) {
    events.push({
      id: `payment-${patient.id}`,
      type: 'payment',
      title: 'Payment Received',
      description: 'Payment processed at Reception',
      timestamp: new Date(now.getTime() - 600000),
      status: 'completed',
      details: {
        'Method': 'Cash',
        'Receipt': `RCP-${Date.now().toString(36).toUpperCase()}`,
      },
    });
  }

  // Add pharmacy if at_pharmacy or discharged
  if (currentIndex >= 7) {
    events.push({
      id: `pharmacy-${patient.id}`,
      type: 'pharmacy',
      title: 'Medication Dispensed',
      description: 'Prescription fulfilled at Pharmacy',
      timestamp: new Date(now.getTime() - 300000),
      status: currentIndex === 7 ? 'in_progress' : 'completed',
      details: {
        'Items': '3 medications',
        'Pharmacist': 'Pharmacy Staff',
      },
    });
  }

  return events;
}

export function PatientJourneyDialog({
  open,
  onOpenChange,
  patient,
}: PatientJourneyDialogProps) {
  const events = generateJourneyEvents(patient);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Patient Journey
          </DialogTitle>
        </DialogHeader>
        
        <PatientJourneyTimeline
          patientName={`${patient.first_name} ${patient.last_name}`}
          cardNumber={patient.card_number}
          events={events}
        />
      </DialogContent>
    </Dialog>
  );
}
