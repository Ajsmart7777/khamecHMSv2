import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { UniversalPatientHeader } from '@/components/patient/UniversalPatientHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Stethoscope, 
  Send, 
  User,
  FileText,
  Plus,
  Trash2,
  FlaskConical,
  Pill,
  ClipboardList,
  BedDouble,
  CheckCircle,
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { usePatients, Patient } from '@/contexts/PatientContext';
import { PatientStatusIndicator } from '@/components/patients/PatientStatusIndicator';
import { PatientStatus } from '@/types/hms';
import { PrintableLabRequestDialog } from '@/components/receipts/PrintableLabRequestDialog';
import { useLabRequests } from '@/hooks/useLabRequests';
import { usePrescriptions } from '@/hooks/usePrescriptions';
import { LabRequestPrintQueue } from '@/components/doctor/LabRequestPrintQueue';
import { LabResultsViewer } from '@/components/doctor/LabResultsViewer';
import { LabResultInbox } from '@/components/doctor/LabResultInbox';
import { AdmittedPatientsPanel } from '@/components/visit/AdmittedPatientsPanel';
import { supabase } from '@/integrations/supabase/client';
import { logError } from '@/lib/errorHandler';
import { PatientHistoryDialog } from '@/components/doctor/PatientHistoryDialog';
import { useAuth } from '@/contexts/AuthContext';

const Doctor = () => {
  const { patients, loading, refreshPatients, updatePatientStatus, getPatientsByStatus } = usePatients();
  const { labRequests } = useLabRequests();
  const { role } = useAuth();
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

  const myDoctorKey: 'doctor1' | 'doctor2' | null =
    role === 'doctor1' ? 'doctor1' : role === 'doctor2' ? 'doctor2' : null;

  const baseQueue = getPatientsByStatus(['with_doctor', 'with_nurse']);
  const doctorQueue = myDoctorKey
    ? baseQueue.filter(p => p.assigned_doctor === myDoctorKey)
    : baseQueue;
  const labReturnedPatients = patients.filter(p => p.status === 'with_doctor' && (!myDoctorKey || p.assigned_doctor === myDoctorKey) && labRequests.some(lr => lr.patient_id === p.id && lr.status === 'completed'));
  const selectedPatient = selectedPatientId ? patients.find(p => p.id === selectedPatientId) : null;

  const handlePatientComplete = async (patientId: string, destination: 'billing' | 'lab' | 'admitting') => {
    const statusMap: Record<string, PatientStatus> = {
      billing: 'awaiting_billing',
      lab: 'in_lab',
      admitting: 'admitted',
    };
    
    const success = await updatePatientStatus(patientId, statusMap[destination]);
    const patient = patients.find(p => p.id === patientId);
    
    if (success && patient) {
      const destinationNames = { billing: 'Billing', lab: 'Laboratory', admitting: 'Ward' };
      toast.success(`Patient Sent to ${destinationNames[destination]}`, {
        description: `${patient.first_name} ${patient.last_name} has been sent to ${destinationNames[destination].toLowerCase()}.`,
      });
      setSelectedPatientId(null);
    }
  };

  return (
    <MainLayout title="Doctor's Console" subtitle="Patient consultation and prescriptions">
      {/* Real-time indicator */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center gap-1.5 text-xs text-success">
          <Wifi className="h-3.5 w-3.5 animate-pulse" />
          <span>Real-time updates active</span>
        </div>
        <Button variant="ghost" size="sm" onClick={refreshPatients} className="h-7 px-2">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Badge variant="doctor" className="ml-auto">{doctorQueue.length} patients</Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Patient Queue */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Consultation Queue</h3>
            </div>

            <div className="space-y-2">
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">
                  <RefreshCw className="h-8 w-8 mx-auto mb-2 animate-spin" />
                  <p className="text-sm">Loading...</p>
                </div>
              ) : doctorQueue.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Stethoscope className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No patients in queue</p>
                </div>
              ) : (
                doctorQueue.map((patient) => {
                  const isLabReturn = labReturnedPatients.some(p => p.id === patient.id);
                  return (
                  <div
                    key={patient.id}
                    onClick={() => setSelectedPatientId(patient.id)}
                    className={cn(
                      "p-3 rounded-lg border cursor-pointer transition-all hover-lift animate-fade-in",
                      selectedPatientId === patient.id 
                        ? "border-module-doctor bg-module-doctor/5" 
                        : "border-border hover:border-module-doctor/50"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-medium text-sm">{patient.first_name} {patient.last_name}</p>
                      <div className="flex items-center gap-1">
                        {isLabReturn && (
                          <Badge variant="info" className="text-[10px]">Lab Results</Badge>
                        )}
                        <PatientStatusIndicator 
                          status={patient.status} 
                          size="sm" 
                          showIcon={false}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{patient.card_number}</p>
                  </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Returned from Lab (snap results) */}
          <LabResultInbox />

          {/* Admitted patients - in-ward snaps (bypass billing) */}
          <AdmittedPatientsPanel sourceStation="doctor" title="Admitted Patients (In-Ward)" />

          {/* Lab Request Print Queue */}
          <LabRequestPrintQueue />

          {/* Lab Results Viewer */}
          <LabResultsViewer />

        </div>

        {/* Consultation Area */}
        <div className="lg:col-span-3">
          {selectedPatient ? (
            <div className="space-y-3">
              <UniversalPatientHeader patient={selectedPatient} />
              <div className="flex flex-wrap justify-end gap-2">
                <SnapClinicalOrder
                  patientId={selectedPatient.id}
                  sourceStation="doctor"
                  defaultOrderType="lab"
                  label="Snap Lab Request"
                  variant="outline"
                  size="sm"
                />
                <SnapClinicalOrder
                  patientId={selectedPatient.id}
                  sourceStation="doctor"
                  defaultOrderType="prescription"
                  label="Snap Rx"
                  variant="outline"
                  size="sm"
                />
                <SnapToCard patientId={selectedPatient.id} station="doctor" defaultLabel="Doctor Dx / Rx" />
              </div>
              <ConsultationView
                patient={selectedPatient}
                onComplete={handlePatientComplete}
              />
            </div>
          ) : (
            <div className="bg-card rounded-xl border border-border p-12 text-center animate-fade-in">
              <Stethoscope className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="font-semibold text-lg mb-2">Select a Patient</h3>
              <p className="text-muted-foreground">Choose a patient to begin consultation</p>
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
};

interface ConsultationViewProps {
  patient: Patient;
  onComplete: (patientId: string, destination: 'billing' | 'lab' | 'admitting') => void;
}

function ConsultationView({ patient, onComplete }: ConsultationViewProps) {
  const { updatePatientStatus } = usePatients();
  const { createLabRequest } = useLabRequests();
  const { createPrescription } = usePrescriptions();
  const [prescriptions, setPrescriptions] = useState([
    { id: 1, medication: '', dosage: '', frequency: '', duration: '', quantity: '' }
  ]);
  const [diagnosis, setDiagnosis] = useState('');
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
  const [isVitalsDialogOpen, setIsVitalsDialogOpen] = useState(false);
  const [isLabDialogOpen, setIsLabDialogOpen] = useState(false);
  const [isAdmitDialogOpen, setIsAdmitDialogOpen] = useState(false);
  const [selectedLabTests, setSelectedLabTests] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [labRequestData, setLabRequestData] = useState<{
    open: boolean;
    tests: string[];
    requestNumber: string;
    date: Date;
  } | null>(null);

  const labTestOptions = [
    'Complete Blood Count', 'Urinalysis', 'Blood Glucose', 'Liver Function Test',
    'Kidney Function Test', 'Lipid Profile', 'Thyroid Function Test', 'Malaria Test'
  ];

  const age = new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear();

  const addPrescription = () => {
    setPrescriptions([...prescriptions, { 
      id: prescriptions.length + 1, 
      medication: '', 
      dosage: '', 
      frequency: '', 
      duration: '',
      quantity: '' 
    }]);
    toast.info("Medication Added", {
      description: "New medication line added to prescription.",
    });
  };

  const removePrescription = (id: number) => {
    if (prescriptions.length > 1) {
      setPrescriptions(prescriptions.filter(p => p.id !== id));
      toast.info("Medication Removed", {
        description: "Medication line removed from prescription.",
      });
    }
  };

  const updatePrescription = (id: number, field: string, value: string) => {
    setPrescriptions(prescriptions.map(p => 
      p.id === id ? { ...p, [field]: value } : p
    ));
  };

  const generateRequestNumber = () => {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `LAB-${timestamp}-${random}`;
  };

  const handleRequestLabTests = async () => {
    if (selectedLabTests.length === 0) {
      toast.error("No Tests Selected", {
        description: "Please select at least one lab test.",
      });
      return;
    }
    
    const requestNumber = generateRequestNumber();
    
    // Save prescriptions to database if there are any with medications
    const validPrescriptions = prescriptions.filter(p => p.medication.trim() !== '');
    if (validPrescriptions.length > 0) {
      const items = validPrescriptions.map(p => ({
        medication: p.medication,
        dosage: p.dosage,
        frequency: p.frequency,
        duration: p.duration,
        quantity: parseInt(p.quantity) || 1,
      }));
      
      await createPrescription(patient.id, diagnosis || 'Pending diagnosis', items);
    }
    
    // Save lab request to database
    const labRequest = await createLabRequest({
      patient_id: patient.id,
      request_number: requestNumber,
      tests: [...selectedLabTests],
      diagnosis: diagnosis || undefined,
    });
    
    if (!labRequest) {
      toast.error("Failed to create lab request");
      return;
    }
    
    // Send request immediately
    toast.success("Lab Tests Requested", {
      description: `${selectedLabTests.length} test(s) have been sent to Laboratory for ${patient.first_name} ${patient.last_name}.`,
    });
    
    // Show printable lab request (optional printing)
    setLabRequestData({
      open: true,
      tests: [...selectedLabTests],
      requestNumber: requestNumber,
      date: new Date(),
    });
    setIsLabDialogOpen(false);
    
    // Update patient status and complete
    onComplete(patient.id, 'lab');
    setSelectedLabTests([]);
  };

  const handleLabRequestDialogClose = () => {
    setLabRequestData(null);
  };

  const handleAdmitPatient = async () => {
    const { requestAdmission } = await import('@/hooks/useAdmissions');
    const id = await requestAdmission({ patientId: patient.id, reason: diagnosis || undefined });
    if (!id) return;
    setIsAdmitDialogOpen(false);
    onComplete(patient.id, 'admitting');
  };

  const handleSendToBilling = async () => {
    if (isSubmitting) return;
    if (!diagnosis) {
      toast.error("Missing Diagnosis", {
        description: "Please enter a diagnosis before sending to billing.",
      });
      return;
    }
    
    setIsSubmitting(true);
    try {
      // Save prescriptions to database if there are any with medications
      const validPrescriptions = prescriptions.filter(p => p.medication.trim() !== '');
      if (validPrescriptions.length > 0) {
        const items = validPrescriptions.map(p => ({
          medication: p.medication,
          dosage: p.dosage,
          frequency: p.frequency,
          duration: p.duration,
          quantity: parseInt(p.quantity) || 1,
        }));
        
        await createPrescription(patient.id, diagnosis, items);
      }
      
      toast.success("Sent to Billing", {
        description: `${patient.first_name} ${patient.last_name}'s invoice is being generated.`,
      });
      onComplete(patient.id, 'billing');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCompleteConsultation = async () => {
    if (isSubmitting) return;
    if (!diagnosis) {
      toast.error("Missing Diagnosis", {
        description: "Please enter a diagnosis to complete consultation.",
      });
      return;
    }
    
    setIsSubmitting(true);
    try {
      // Save prescriptions to database if there are any with medications
      const validPrescriptions = prescriptions.filter(p => p.medication.trim() !== '');
      if (validPrescriptions.length > 0) {
        const items = validPrescriptions.map(p => ({
          medication: p.medication,
          dosage: p.dosage,
          frequency: p.frequency,
          duration: p.duration,
          quantity: parseInt(p.quantity) || 1,
        }));
        
        await createPrescription(patient.id, diagnosis, items);
      }
      
      toast.success("Consultation Completed", {
        description: `Consultation for ${patient.first_name} ${patient.last_name} has been completed.`,
      });
      onComplete(patient.id, 'billing');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Patient Header */}
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-module-doctor/10 flex items-center justify-center">
              <User className="h-6 w-6 text-module-doctor" />
            </div>
            <div>
              <h2 className="font-semibold">{patient.first_name} {patient.last_name}</h2>
              <p className="text-sm text-muted-foreground">
                {patient.card_number} • {patient.gender}, {age} years
                {patient.blood_group && ` • Blood: ${patient.blood_group}`}
              </p>
            </div>
            <PatientStatusIndicator status={patient.status} pulse />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setIsHistoryDialogOpen(true)} className="press-effect">
              <FileText className="h-4 w-4 mr-2" />
              View History
            </Button>
            <Button variant="outline" size="sm" onClick={() => setIsVitalsDialogOpen(true)} className="press-effect">
              <ClipboardList className="h-4 w-4 mr-2" />
              View Vitals
            </Button>
          </div>
        </div>

        {patient.allergies && patient.allergies.length > 0 && (
          <div className="mt-4 p-3 bg-destructive/10 rounded-lg border border-destructive/30">
            <span className="text-sm font-medium text-destructive">⚠️ Allergies: </span>
            <span className="text-sm text-destructive">{patient.allergies.join(', ')}</span>
          </div>
        )}
      </div>

      {/* Diagnosis */}
      <div className="bg-card rounded-xl border border-border p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Stethoscope className="h-5 w-5 text-module-doctor" />
          Diagnosis & Notes
        </h3>
        <textarea 
          className="w-full h-32 px-3 py-2 rounded-lg border border-input bg-background text-sm resize-none"
          placeholder="Enter diagnosis and clinical notes..."
          value={diagnosis}
          onChange={(e) => setDiagnosis(e.target.value)}
        />
      </div>

      {/* Prescriptions */}
      <div className="bg-card rounded-xl border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Pill className="h-5 w-5 text-module-pharmacy" />
            Prescriptions
          </h3>
          <Button variant="outline" size="sm" onClick={addPrescription} className="press-effect">
            <Plus className="h-4 w-4 mr-1" />
            Add Medication
          </Button>
        </div>

        <div className="space-y-3">
          {prescriptions.map((rx) => (
            <div key={rx.id} className="grid grid-cols-12 gap-3 items-center p-3 bg-muted/30 rounded-lg animate-fade-in">
              <div className="col-span-3">
                <Input 
                  placeholder="Medication name" 
                  value={rx.medication}
                  onChange={(e) => updatePrescription(rx.id, 'medication', e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <Input 
                  placeholder="Dosage" 
                  value={rx.dosage}
                  onChange={(e) => updatePrescription(rx.id, 'dosage', e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <Input 
                  placeholder="Frequency" 
                  value={rx.frequency}
                  onChange={(e) => updatePrescription(rx.id, 'frequency', e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <Input 
                  placeholder="Duration" 
                  value={rx.duration}
                  onChange={(e) => updatePrescription(rx.id, 'duration', e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <Input 
                  placeholder="Qty" 
                  type="number" 
                  value={rx.quantity}
                  onChange={(e) => updatePrescription(rx.id, 'quantity', e.target.value)}
                />
              </div>
              <div className="col-span-1">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="text-destructive hover:bg-destructive/10 press-effect"
                  onClick={() => removePrescription(rx.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3 justify-end">
        <Button variant="outline" onClick={() => setIsLabDialogOpen(true)} className="press-effect">
          <FlaskConical className="h-4 w-4 mr-2" />
          Request Lab Tests
        </Button>
        <Button variant="outline" onClick={() => setIsAdmitDialogOpen(true)} className="press-effect">
          <BedDouble className="h-4 w-4 mr-2" />
          Admit Patient
        </Button>
        <Button 
          variant="outline" 
          onClick={async () => {
            if (!diagnosis) {
              toast.error("Missing Diagnosis", { description: "Please enter a diagnosis." });
              return;
            }
            if (isSubmitting) return;
            setIsSubmitting(true);
            try {
              // No prescriptions - send to billing for consultation fee only
              toast.success("Discharge Without Medication", {
                description: `${patient.first_name} ${patient.last_name} sent to billing for consultation fee only.`,
              });
              onComplete(patient.id, 'billing');
            } finally {
              setIsSubmitting(false);
            }
          }} 
          disabled={isSubmitting} 
          className="press-effect"
        >
          <CheckCircle className="h-4 w-4 mr-2" />
          Discharge (No Meds)
        </Button>
        <Button variant="module" onClick={handleSendToBilling} disabled={isSubmitting} className="press-effect">
          <Send className="h-4 w-4 mr-2" />
          {isSubmitting ? 'Sending...' : 'Send to Billing'}
        </Button>
        <Button variant="hero" onClick={handleCompleteConsultation} disabled={isSubmitting} className="press-effect">
          <Stethoscope className="h-4 w-4 mr-2" />
          {isSubmitting ? 'Completing...' : 'Complete Consultation'}
        </Button>
      </div>

      {/* View History Dialog */}
      <PatientHistoryDialog 
        open={isHistoryDialogOpen} 
        onOpenChange={setIsHistoryDialogOpen} 
        patient={patient} 
      />

      {/* View Vitals Dialog */}
      <VitalsDialog 
        open={isVitalsDialogOpen} 
        onOpenChange={setIsVitalsDialogOpen} 
        patientId={patient.id} 
        patientName={`${patient.first_name} ${patient.last_name}`}
      />

      {/* Lab Tests Dialog */}
      <Dialog open={isLabDialogOpen} onOpenChange={setIsLabDialogOpen}>
        <DialogContent className="animate-scale-in">
          <DialogHeader>
            <DialogTitle>Request Lab Tests</DialogTitle>
            <DialogDescription>Select tests to request for {patient.first_name} {patient.last_name}</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2 max-h-64 overflow-y-auto">
            {labTestOptions.map((test) => (
              <label key={test} className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={selectedLabTests.includes(test)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedLabTests([...selectedLabTests, test]);
                    } else {
                      setSelectedLabTests(selectedLabTests.filter(t => t !== test));
                    }
                  }}
                  className="w-4 h-4 rounded border-input"
                />
                <span>{test}</span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsLabDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleRequestLabTests} className="press-effect">
              <FlaskConical className="h-4 w-4 mr-1" />
              Request Tests ({selectedLabTests.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admit Patient Dialog */}
      <AlertDialog open={isAdmitDialogOpen} onOpenChange={setIsAdmitDialogOpen}>
        <AlertDialogContent className="animate-scale-in">
          <AlertDialogHeader>
            <AlertDialogTitle>Admit Patient</AlertDialogTitle>
            <AlertDialogDescription>
              Admit {patient.first_name} {patient.last_name} to the ward for inpatient care?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleAdmitPatient}>
              <BedDouble className="h-4 w-4 mr-1" />
              Confirm Admission
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Printable Lab Request Dialog */}
      {labRequestData && (
        <PrintableLabRequestDialog
          open={labRequestData.open}
          onOpenChange={(open) => setLabRequestData(open ? labRequestData : null)}
          patient={patient}
          tests={labRequestData.tests}
          diagnosis={diagnosis}
          requestNumber={labRequestData.requestNumber}
          date={labRequestData.date}
        />
      )}
    </div>
  );
}

function VitalsDialog({ open, onOpenChange, patientId, patientName }: { 
  open: boolean; 
  onOpenChange: (open: boolean) => void; 
  patientId: string; 
  patientName: string;
}) {
  const [vitals, setVitals] = useState<{
    temperature: number | null;
    blood_pressure: string | null;
    pulse: number | null;
    respiratory_rate: number | null;
    weight: number | null;
    height: number | null;
    notes: string | null;
    created_at: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setLoading(true);
      supabase
        .from('vitals')
        .select('*')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(1)
        .then(({ data, error }) => {
          if (error) logError('Error fetching vitals', error);
          setVitals(data && data.length > 0 ? data[0] as any : null);
          setLoading(false);
        });
    }
  }, [open, patientId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="animate-scale-in">
        <DialogHeader>
          <DialogTitle>Current Vitals</DialogTitle>
          <DialogDescription>
            {patientName} {vitals ? `- Recorded ${new Date(vitals.created_at).toLocaleString()}` : ''}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="py-8 text-center text-muted-foreground">Loading vitals...</div>
        ) : vitals ? (
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-sm text-muted-foreground">Temperature</p>
              <p className="text-lg font-semibold">{vitals.temperature ?? 'N/A'}°C</p>
            </div>
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-sm text-muted-foreground">Blood Pressure</p>
              <p className="text-lg font-semibold">{vitals.blood_pressure ?? 'N/A'} mmHg</p>
            </div>
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-sm text-muted-foreground">Pulse</p>
              <p className="text-lg font-semibold">{vitals.pulse ?? 'N/A'} bpm</p>
            </div>
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-sm text-muted-foreground">Respiratory Rate</p>
              <p className="text-lg font-semibold">{vitals.respiratory_rate ?? 'N/A'} /min</p>
            </div>
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-sm text-muted-foreground">Weight</p>
              <p className="text-lg font-semibold">{vitals.weight ?? 'N/A'} kg</p>
            </div>
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-sm text-muted-foreground">Height</p>
              <p className="text-lg font-semibold">{vitals.height ?? 'N/A'} cm</p>
            </div>
            {vitals.notes && (
              <div className="col-span-2 p-3 bg-muted/30 rounded-lg">
                <p className="text-sm text-muted-foreground">Nurse Notes</p>
                <p className="text-sm">{vitals.notes}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            No vitals recorded for this patient yet.
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default Doctor;
