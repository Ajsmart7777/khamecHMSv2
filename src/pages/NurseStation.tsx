import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { UniversalPatientHeader } from '@/components/patient/UniversalPatientHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Activity, 
  Send, 
  Bell,
  Camera,
  Wifi,
  RefreshCw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { SnapToCard } from '@/components/visit/SnapToCard';
import { SnapClinicalOrder } from '@/components/visit/SnapClinicalOrder';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePatients, Patient } from '@/contexts/PatientContext';
import { PatientStatusIndicator } from '@/components/patients/PatientStatusIndicator';
import { supabase } from '@/integrations/supabase/client';
import { logError } from '@/lib/errorHandler';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AdmissionQueue } from '@/components/nurse/AdmissionQueue';
import { LabResultInbox } from '@/components/doctor/LabResultInbox';
import { NurseTreatmentInbox } from '@/components/nurse/NurseTreatmentInbox';
import { AdmittedPatientsPanel } from '@/components/visit/AdmittedPatientsPanel';

const NurseStation = () => {
  const { patients, loading, refreshPatients, updatePatientStatus, getPatientsByStatus } = usePatients();
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  
  // Filter patients that are waiting or with nurse
  const nurseQueue = getPatientsByStatus(['waiting', 'with_nurse']);
  const selectedPatient = selectedPatientId ? patients.find(p => p.id === selectedPatientId) : null;

  const handlePatientComplete = async (patientId: string, assignedDoctor: 'doctor1' | 'doctor2') => {
    const patient = patients.find(p => p.id === patientId);
    const { error: assignError } = await supabase
      .from('patients')
      .update({ assigned_doctor: assignedDoctor })
      .eq('id', patientId);
    if (assignError) {
      logError('Failed to assign doctor', assignError);
      toast.error('Failed to assign doctor');
      return;
    }
    const success = await updatePatientStatus(patientId, 'with_doctor');
    if (success && patient) {
      toast.success("Patient Sent to Doctor", {
        description: `${patient.first_name} ${patient.last_name} sent to ${assignedDoctor === 'doctor1' ? 'Doctor 1' : 'Doctor 2'}.`,
      });
      setSelectedPatientId(null);
    }
  };

  return (
    <MainLayout title="Nurse Station" subtitle="Record vitals and patient notes">
      {/* Real-time indicator */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center gap-1.5 text-xs text-success">
          <Wifi className="h-3.5 w-3.5 animate-pulse" />
          <span>Real-time updates active</span>
        </div>
        <Button variant="ghost" size="sm" onClick={refreshPatients} className="h-7 px-2">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Badge variant="nurse" className="ml-auto">{nurseQueue.length} in queue</Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <AdmissionQueue />
        <LabResultInbox />
        <NurseTreatmentInbox />
        <AdmittedPatientsPanel sourceStation="nurse" title="Admitted Patients (In-Ward Snap)" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Patient Queue */}
        <div className="lg:col-span-1">

          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Patient Queue</h3>
            </div>

            <div className="space-y-2">
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">
                  <RefreshCw className="h-8 w-8 mx-auto mb-2 animate-spin" />
                  <p className="text-sm">Loading...</p>
                </div>
              ) : nurseQueue.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No patients in queue</p>
                </div>
              ) : (
                nurseQueue.map((patient, index) => (
                  <div
                    key={patient.id}
                    onClick={() => setSelectedPatientId(patient.id)}
                    className={cn(
                      "p-3 rounded-lg border cursor-pointer transition-all hover-lift animate-fade-in",
                      selectedPatientId === patient.id 
                        ? "border-module-nurse bg-module-nurse/5" 
                        : "border-border hover:border-module-nurse/50"
                    )}
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-module-nurse/10 flex items-center justify-center text-module-nurse font-medium text-sm">
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{patient.first_name} {patient.last_name}</p>
                        <p className="text-xs text-muted-foreground">{patient.card_number}</p>
                      </div>
                      <PatientStatusIndicator status={patient.status} size="sm" showIcon={false} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Vitals Recording */}
        <div className="lg:col-span-3">
          {selectedPatient ? (
            <div className="space-y-3">
              <UniversalPatientHeader patient={selectedPatient} />
              <div className="flex flex-wrap justify-end gap-2">
                <SnapClinicalOrder
                  patientId={selectedPatient.id}
                  sourceStation="nurse"
                  defaultOrderType="lab"
                  label="Snap Lab Request"
                  variant="outline"
                  size="sm"
                />
                <SnapClinicalOrder
                  patientId={selectedPatient.id}
                  sourceStation="nurse"
                  defaultOrderType="prescription"
                  label="Snap Rx / Treatment"
                  variant="outline"
                  size="sm"
                />
                <SnapToCard patientId={selectedPatient.id} station="nurse" defaultLabel="Nurse vitals note" />
              </div>
              <VitalsForm
                patient={selectedPatient}
                onComplete={handlePatientComplete}
              />
            </div>
          ) : (
            <div className="bg-card rounded-xl border border-border p-12 text-center animate-fade-in">
              <Activity className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="font-semibold text-lg mb-2">Select a Patient</h3>
              <p className="text-muted-foreground">Choose a patient from the queue to record vitals</p>
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
};

interface VitalsFormProps {
  patient: Patient;
  onComplete: (patientId: string, assignedDoctor: 'doctor1' | 'doctor2') => void;
}

function VitalsForm({ patient, onComplete }: VitalsFormProps) {
  const { updatePatientStatus } = usePatients();
  const [assignedDoctor, setAssignedDoctor] = useState<'doctor1' | 'doctor2' | ''>('');
  const [isCallDialogOpen, setIsCallDialogOpen] = useState(false);

  const handleCallPatient = async () => {
    setIsCallDialogOpen(true);
    await updatePatientStatus(patient.id, 'with_nurse');
    toast.info("Calling Patient", {
      description: `Calling ${patient.first_name} ${patient.last_name} to the nurse station...`,
    });
    setTimeout(() => {
      setIsCallDialogOpen(false);
      toast.success("Patient Called", {
        description: `${patient.first_name} ${patient.last_name} has been notified.`,
      });
    }, 2000);
  };

  const handleSendToDoctor = () => {
    if (!assignedDoctor) {
      toast.error("Select a doctor", { description: "Choose Doctor 1 or Doctor 2 before sending." });
      return;
    }
    onComplete(patient.id, assignedDoctor);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Snap-first vitals capture */}
      <div className="bg-card rounded-xl border border-border p-6 text-center space-y-3">
        <div className="mx-auto w-12 h-12 rounded-full bg-module-nurse/10 flex items-center justify-center">
          <Camera className="h-6 w-6 text-module-nurse" />
        </div>
        <h3 className="font-semibold">Snap the vitals card</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Write vitals & notes on the paper card, then take a photo. The snap is the record — no typing required.
        </p>
        <div className="flex flex-wrap justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={handleCallPatient} className="press-effect">
            <Bell className="h-4 w-4 mr-2" />
            Call Patient
          </Button>
          <SnapToCard patientId={patient.id} station="nurse" defaultLabel="Nurse vitals & notes" />
        </div>
      </div>

      {/* Assign Doctor */}
      <div className="bg-card rounded-xl border border-border p-4">
        <label className="text-sm font-medium mb-2 block flex items-center gap-2">
          <Send className="h-4 w-4 text-module-nurse" />
          Assign to Doctor *
        </label>
        <Select value={assignedDoctor} onValueChange={(v) => setAssignedDoctor(v as 'doctor1' | 'doctor2')}>
          <SelectTrigger><SelectValue placeholder="Select Doctor 1 or Doctor 2" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="doctor1">Doctor 1</SelectItem>
            <SelectItem value="doctor2">Doctor 2</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Button variant="module" onClick={handleSendToDoctor} className="press-effect">
          <Send className="h-4 w-4 mr-2" />
          Send to Doctor
        </Button>
      </div>

      {/* Call Patient Dialog */}
      <Dialog open={isCallDialogOpen} onOpenChange={setIsCallDialogOpen}>
        <DialogContent className="animate-scale-in">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-module-nurse animate-pulse" />
              Calling Patient
            </DialogTitle>
            <DialogDescription>
              Notifying {patient.first_name} {patient.last_name} to come to the nurse station...
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-8">
            <div className="w-16 h-16 rounded-full bg-module-nurse/20 flex items-center justify-center animate-pulse">
              <Bell className="h-8 w-8 text-module-nurse" />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default NurseStation;
