import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Activity, 
  Send, 
  User,
  Thermometer,
  Heart,
  Wind,
  Scale,
  Ruler,
  ClipboardList,
  Bell,
  Save,
  Wifi,
  RefreshCw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
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
            <VitalsForm 
              patient={selectedPatient}
              onComplete={handlePatientComplete}
            />
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
  onComplete: (patientId: string) => void;
}

function VitalsForm({ patient, onComplete }: VitalsFormProps) {
  const { updatePatientStatus } = usePatients();
  const [vitals, setVitals] = useState({
    temperature: '',
    bloodPressure: '',
    pulse: '',
    respiratoryRate: '',
    weight: '',
    height: '',
    notes: ''
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isCallDialogOpen, setIsCallDialogOpen] = useState(false);

  const handleCallPatient = async () => {
    setIsCallDialogOpen(true);
    // Update status to with_nurse when called
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

  const saveVitalsToDb = async () => {
    try {
      const { error } = await supabase
        .from('vitals')
        .insert({
          patient_id: patient.id,
          temperature: vitals.temperature ? parseFloat(vitals.temperature) : null,
          blood_pressure: vitals.bloodPressure || null,
          pulse: vitals.pulse ? parseInt(vitals.pulse) : null,
          respiratory_rate: vitals.respiratoryRate ? parseInt(vitals.respiratoryRate) : null,
          weight: vitals.weight ? parseFloat(vitals.weight) : null,
          height: vitals.height ? parseFloat(vitals.height) : null,
          notes: vitals.notes || null,
        });
      if (error) throw error;
      return true;
    } catch (err) {
      logError('Error saving vitals', err);
      toast.error("Failed to save vitals to database");
      return false;
    }
  };

  const handleSaveDraft = async () => {
    setIsSaving(true);
    const saved = await saveVitalsToDb();
    setIsSaving(false);
    if (saved) {
      toast.success("Draft Saved", {
        description: "Vitals have been saved as draft.",
      });
    }
  };

  const handleSendToDoctor = async () => {
    if (!vitals.temperature || !vitals.bloodPressure || !vitals.pulse) {
      toast.error("Incomplete Vitals", {
        description: "Please record temperature, blood pressure, and pulse before sending.",
      });
      return;
    }
    const saved = await saveVitalsToDb();
    if (saved) {
      onComplete(patient.id);
    }
  };


  const age = new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear();

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Patient Info Header */}
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-module-nurse/10 flex items-center justify-center">
              <User className="h-6 w-6 text-module-nurse" />
            </div>
            <div>
              <h2 className="font-semibold">{patient.first_name} {patient.last_name}</h2>
              <p className="text-sm text-muted-foreground">{patient.card_number} • {patient.gender}, {age} years</p>
            </div>
            <PatientStatusIndicator status={patient.status} pulse />
          </div>
          <Button variant="outline" size="sm" onClick={handleCallPatient} className="press-effect">
            <Bell className="h-4 w-4 mr-2" />
            Call Patient
          </Button>
        </div>
      </div>

      {/* Vitals Form */}
      <div className="bg-card rounded-xl border border-border p-6">
        <h3 className="font-semibold mb-6 flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-module-nurse" />
          Record Vitals
        </h3>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Thermometer className="h-4 w-4 text-destructive" />
              Temperature (°C)
            </label>
            <Input 
              type="number" 
              step="0.1" 
              placeholder="36.5"
              value={vitals.temperature}
              onChange={(e) => setVitals({...vitals, temperature: e.target.value})}
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Heart className="h-4 w-4 text-destructive" />
              Blood Pressure
            </label>
            <Input 
              placeholder="120/80"
              value={vitals.bloodPressure}
              onChange={(e) => setVitals({...vitals, bloodPressure: e.target.value})}
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Heart className="h-4 w-4 text-accent" />
              Pulse (bpm)
            </label>
            <Input 
              type="number" 
              placeholder="72"
              value={vitals.pulse}
              onChange={(e) => setVitals({...vitals, pulse: e.target.value})}
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Wind className="h-4 w-4 text-info" />
              Respiratory Rate
            </label>
            <Input 
              type="number" 
              placeholder="16"
              value={vitals.respiratoryRate}
              onChange={(e) => setVitals({...vitals, respiratoryRate: e.target.value})}
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Scale className="h-4 w-4 text-primary" />
              Weight (kg)
            </label>
            <Input 
              type="number" 
              step="0.1" 
              placeholder="70"
              value={vitals.weight}
              onChange={(e) => setVitals({...vitals, weight: e.target.value})}
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Ruler className="h-4 w-4 text-primary" />
              Height (cm)
            </label>
            <Input 
              type="number" 
              placeholder="170"
              value={vitals.height}
              onChange={(e) => setVitals({...vitals, height: e.target.value})}
            />
          </div>
        </div>

        <div className="mt-6">
          <label className="text-sm font-medium mb-2 block">Nurse Notes</label>
          <textarea 
            className="w-full h-24 px-3 py-2 rounded-lg border border-input bg-background text-sm resize-none"
            placeholder="Enter any observations or notes..."
            value={vitals.notes}
            onChange={(e) => setVitals({...vitals, notes: e.target.value})}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={handleSaveDraft} disabled={isSaving} className="press-effect">
          <Save className="h-4 w-4 mr-2" />
          {isSaving ? 'Saving...' : 'Save as Draft'}
        </Button>
        <Button 
          variant="outline" 
          onClick={() => {
            toast.info("Skipping vitals", { description: "Sending patient directly to doctor without vitals." });
            onComplete(patient.id);
          }} 
          className="press-effect"
        >
          <Send className="h-4 w-4 mr-2" />
          Skip Vitals → Doctor
        </Button>
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
