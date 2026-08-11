import { useSelectedPatientParam } from '@/hooks/useSelectedPatientParam';
import { useState, useMemo } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { UniversalPatientHeader } from '@/components/patient/UniversalPatientHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Activity, 
  Send, 
  Wifi,
  RefreshCw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { SnapClinicalOrder } from '@/components/visit/SnapClinicalOrder';
import { usePatients, Patient } from '@/contexts/PatientContext';
import { PatientStatusIndicator } from '@/components/patients/PatientStatusIndicator';
import { supabase } from '@/integrations/supabase/client';
import { logError } from '@/lib/errorHandler';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AdmissionCaptureDialog } from '@/components/nurse/AdmissionCaptureDialog';
import { useAdmissionPerms } from '@/lib/admissionPermissions';
import { LabResultInbox } from '@/components/doctor/LabResultInbox';
import { NurseTreatmentInbox } from '@/components/nurse/NurseTreatmentInbox';
import { AdmittedPatientsPanel } from '@/components/visit/AdmittedPatientsPanel';
import { AwaitingRoomPanel } from '@/components/nurse/AwaitingRoomPanel';
import { QuickDischargeButton } from '@/components/patient/QuickDischargeButton';
import { BedDouble } from 'lucide-react';

const NurseStation = () => {
  const { patients, loading, refreshPatients, updatePatientStatus, getPatientsByStatus } = usePatients();
  const [selectedPatientId, setSelectedPatientId] = useSelectedPatientParam();
  const [admitOpen, setAdmitOpen] = useState(false);
  const canAct = useAdmissionPerms();
  
  // Filter patients that are waiting or with nurse
  // Patients returned from lab are set back to 'with_nurse' so their card
  // stays in the queue and the nurse can take the next action (another lab
  // request, prescription, route to doctor, etc.).
  // Deduplicate by patient id so concurrent lab returns / status flips
  // (which can briefly emit multiple realtime events for the same patient)
  // never render the same card twice in the queue.
  const nurseQueue = useMemo(() => {
    const allNursePatients = getPatientsByStatus(['waiting', 'with_nurse']);
    return Array.from(
      new Map(
        allNursePatients.map((p) => [p.id, p])
      ).values()
    );
  }, [patients, getPatientsByStatus]);
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
        <AwaitingRoomPanel />
        <LabResultInbox />
        <NurseTreatmentInbox />
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
                {canAct('admit') && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9"
                    onClick={() => setAdmitOpen(true)}
                  >
                    <BedDouble className="h-4 w-4 mr-1.5" />
                    Snap to Admit
                  </Button>
                )}
                <QuickDischargeButton
                  patientId={selectedPatient.id}
                  patientName={`${selectedPatient.first_name} ${selectedPatient.last_name}`}
                  onDischarged={() => setSelectedPatientId(null)}
                  variant="outline"
                  className="h-9"
                  label="Discharge"
                />
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

      {selectedPatient && (
        <AdmissionCaptureDialog
          open={admitOpen}
          onOpenChange={setAdmitOpen}
          patientId={selectedPatient.id}
          patientName={`${selectedPatient.first_name} ${selectedPatient.last_name}`}
          onAdmitted={() => setSelectedPatientId(null)}
        />
      )}
    </MainLayout>
  );
};

interface VitalsFormProps {
  patient: Patient;
  onComplete: (patientId: string, assignedDoctor: 'doctor1' | 'doctor2') => void;
}

function VitalsForm({ patient, onComplete }: VitalsFormProps) {
  const [assignedDoctor, setAssignedDoctor] = useState<'doctor1' | 'doctor2' | ''>(
    (patient.assigned_doctor as 'doctor1' | 'doctor2' | undefined) ?? ''
  );
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [temperature, setTemperature] = useState('');
  const [pulse, setPulse] = useState('');
  const [respiratoryRate, setRespiratoryRate] = useState('');
  const [spo2, setSpo2] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const bmi = (() => {
    const w = parseFloat(weight);
    const h = parseFloat(height);
    if (!w || !h) return null;
    const m = h / 100;
    return +(w / (m * m)).toFixed(1);
  })();

  const bmiCategory = (() => {
    if (bmi == null) return '';
    if (bmi < 18.5) return 'Underweight';
    if (bmi < 25) return 'Normal';
    if (bmi < 30) return 'Overweight';
    return 'Obese';
  })();

  const resetForm = () => {
    setWeight(''); setHeight(''); setSystolic(''); setDiastolic('');
    setTemperature(''); setPulse(''); setRespiratoryRate(''); setSpo2(''); setNotes('');
  };

  const handleSaveVitals = async () => {
    // Require at least one field
    if (!weight && !height && !systolic && !diastolic && !temperature && !pulse && !respiratoryRate && !spo2 && !notes) {
      toast.error('Enter at least one vital before saving');
      return;
    }
    setSaving(true);
    const { data: userRes } = await supabase.auth.getUser();
    const bp = systolic && diastolic ? `${systolic}/${diastolic}` : (systolic || diastolic || null);
    const composedNotes = [
      spo2 ? `SpO2: ${spo2}%` : null,
      bmi != null ? `BMI: ${bmi} (${bmiCategory})` : null,
      notes.trim() || null,
    ].filter(Boolean).join(' • ') || null;

    const { error } = await supabase.from('vitals').insert({
      patient_id: patient.id,
      weight: weight ? parseFloat(weight) : null,
      height: height ? parseFloat(height) : null,
      blood_pressure: bp,
      temperature: temperature ? parseFloat(temperature) : null,
      pulse: pulse ? parseInt(pulse) : null,
      respiratory_rate: respiratoryRate ? parseInt(respiratoryRate) : null,
      notes: composedNotes,
      recorded_by: userRes.user?.id ?? null,
    });
    setSaving(false);
    if (error) {
      logError('Failed to save vitals', error);
      toast.error('Failed to save vitals', { description: error.message });
      return;
    }
    toast.success('Vitals saved to patient card');
    setLastSavedAt(new Date());
    resetForm();
  };

  const handleSendToDoctor = () => {
    if (!assignedDoctor) {
      toast.error('Select a doctor', { description: 'Choose Doctor 1 or Doctor 2 before sending.' });
      return;
    }
    onComplete(patient.id, assignedDoctor);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Typed vitals capture */}
      <div className="bg-card rounded-xl border border-border p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4 text-module-nurse" /> Record Vitals
            </h3>
            <p className="text-xs text-muted-foreground">Fill any subset — leave unknown fields blank.</p>
          </div>
          {lastSavedAt && (
            <span className="text-xs text-success">Saved {lastSavedAt.toLocaleTimeString()}</span>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">Weight (kg)</Label>
            <Input type="number" inputMode="decimal" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="70" />
          </div>
          <div>
            <Label className="text-xs">Height (cm)</Label>
            <Input type="number" inputMode="decimal" step="0.1" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="170" />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Blood Pressure (mmHg)</Label>
            <div className="flex items-center gap-2">
              <Input type="number" inputMode="numeric" value={systolic} onChange={(e) => setSystolic(e.target.value)} placeholder="120" />
              <span className="text-muted-foreground">/</span>
              <Input type="number" inputMode="numeric" value={diastolic} onChange={(e) => setDiastolic(e.target.value)} placeholder="80" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Temp (°C)</Label>
            <Input type="number" inputMode="decimal" step="0.1" value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder="36.8" />
          </div>
          <div>
            <Label className="text-xs">Pulse (bpm)</Label>
            <Input type="number" inputMode="numeric" value={pulse} onChange={(e) => setPulse(e.target.value)} placeholder="72" />
          </div>
          <div>
            <Label className="text-xs">Resp. Rate</Label>
            <Input type="number" inputMode="numeric" value={respiratoryRate} onChange={(e) => setRespiratoryRate(e.target.value)} placeholder="16" />
          </div>
          <div>
            <Label className="text-xs">SpO₂ (%)</Label>
            <Input type="number" inputMode="numeric" value={spo2} onChange={(e) => setSpo2(e.target.value)} placeholder="98" />
          </div>
        </div>

        {bmi != null && (
          <div className="text-sm bg-muted/40 rounded-md px-3 py-2">
            <span className="font-medium">BMI:</span> {bmi} <span className="text-muted-foreground">({bmiCategory})</span>
          </div>
        )}

        <div>
          <Label className="text-xs">Notes (optional)</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any observations..." />
        </div>

        <div className="flex justify-end">
          <Button variant="module" onClick={handleSaveVitals} disabled={saving} className="press-effect">
            {saving ? 'Saving...' : 'Save Vitals to Card'}
          </Button>
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

      <div className="flex justify-end gap-3">
        <Button variant="module" onClick={handleSendToDoctor} className="press-effect">
          <Send className="h-4 w-4 mr-2" />
          Send to Doctor
        </Button>
      </div>
    </div>
  );
}

export default NurseStation;
