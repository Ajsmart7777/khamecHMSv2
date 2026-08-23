import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { UniversalPatientHeader } from '@/components/patient/UniversalPatientHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  FlaskConical, 
  Play, 
  CheckCircle,
  Clock,
  User,
  FileText,
  Send,
  Wifi,
  WifiOff,
  RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';
import { SnapToCard } from '@/components/visit/SnapToCard';
import { LabSnapQueue } from '@/components/lab/LabSnapQueue';
import { EmergencyLabQueue } from '@/components/lab/EmergencyLabQueue';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePatients } from '@/contexts/PatientContext';
import { useLabRequests, LabRequest } from '@/hooks/useLabRequests';
import { PatientStatusIndicator } from '@/components/patients/PatientStatusIndicator';
import { supabase } from '@/integrations/supabase/client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const statusConfig = {
  pending: { label: 'Pending', color: 'warning', icon: Clock },
  in_progress: { label: 'In Progress', color: 'info', icon: Play },
  completed: { label: 'Completed', color: 'success', icon: CheckCircle },
};

const Laboratory = () => {
  const { patients, loading: patientsLoading, updatePatientStatus } = usePatients();
  const { labRequests, loading: labLoading, updateLabRequest, refreshLabRequests } = useLabRequests();
  const [selectedRequest, setSelectedRequest] = useState<LabRequest | null>(null);
  const [isResultsDialogOpen, setIsResultsDialogOpen] = useState(false);
  const [interpretation, setInterpretation] = useState('Normal');
  const [doctorRoutingRequest, setDoctorRoutingRequest] = useState<LabRequest | null>(null);
  const [routingDoctor, setRoutingDoctor] = useState<'doctor1' | 'doctor2' | ''>('');
  const [searchParams, setSearchParams] = useSearchParams();

  const loading = patientsLoading || labLoading;

  // Deep-link support: auto-select a lab request from ?task= or a patient's
  // active request from ?patient=. Runs whenever lab requests refresh.
  useEffect(() => {
    if (selectedRequest || labLoading) return;
    const taskId = searchParams.get('task');
    const patientId = searchParams.get('patient');
    let match: LabRequest | undefined;
    if (taskId) match = labRequests.find(r => r.id === taskId);
    if (!match && patientId) {
      match = labRequests.find(
        r => r.patient_id === patientId && r.status !== 'completed',
      );
    }
    if (match) setSelectedRequest(match);
  }, [labRequests, labLoading, searchParams, selectedRequest]);

  // Get lab requests that are not completed
  const activeLabRequests = labRequests.filter(req => req.status !== 'completed' || 
    // Show completed ones that haven't been sent back yet
    patients.find(p => p.id === req.patient_id)?.status === 'in_lab'
  );

  const getPatient = (patientId: string) => {
    return patients.find(p => p.id === patientId);
  };

  const handleStart = async (request: LabRequest) => {
    const success = await updateLabRequest(request.id, { status: 'in_progress' });
    if (success) {
      const patient = getPatient(request.patient_id);
      toast.success('Test Started', {
        description: `Lab test for ${patient?.first_name} ${patient?.last_name} is now in progress.`
      });
    }
  };

  const handleComplete = (request: LabRequest) => {
    setSelectedRequest(request);
    setIsResultsDialogOpen(true);
  };

  const handleSaveResults = async () => {
    if (selectedRequest) {
      const success = await updateLabRequest(selectedRequest.id, { 
        status: 'completed',
        results: { value: 'See snapped result', interpretation },
        completed_at: new Date().toISOString(),
      });
      
      if (success) {
        const patient = getPatient(selectedRequest.patient_id);
        toast.success('Results Saved', {
          description: `Result for ${patient?.first_name} ${patient?.last_name} marked complete. Make sure you snapped the paper result.`
        });
      }
      setIsResultsDialogOpen(false);
      setInterpretation('Normal');
      setSelectedRequest(null);
    }
  };

  const handleSendToDoctor = async (request: LabRequest) => {
    const patient = getPatient(request.patient_id);
    if (!patient) return;
    // If the patient has no assigned doctor yet, ask the lab tech which doctor to route to.
    if (!patient.assigned_doctor) {
      setRoutingDoctor('');
      setDoctorRoutingRequest(request);
      return;
    }
    const success = await updatePatientStatus(patient.id, 'with_doctor');
    if (success) {
      toast.success('Results Sent', {
        description: `Lab results for ${patient.first_name} ${patient.last_name} routed to ${
          patient.assigned_doctor === 'doctor1' ? 'Doctor 1' : 'Doctor 2'
        }.`,
      });
    }
  };

  const handleConfirmDoctorRouting = async () => {
    if (!doctorRoutingRequest || !routingDoctor) return;
    const patient = getPatient(doctorRoutingRequest.patient_id);
    if (!patient) return;
    const { error: assignError } = await supabase
      .from('patients')
      .update({ assigned_doctor: routingDoctor })
      .eq('id', patient.id);
    if (assignError) {
      toast.error('Failed to assign doctor');
      return;
    }
    const success = await updatePatientStatus(patient.id, 'with_doctor');
    if (success) {
      toast.success('Results Sent', {
        description: `Lab results for ${patient.first_name} ${patient.last_name} routed to ${
          routingDoctor === 'doctor1' ? 'Doctor 1' : 'Doctor 2'
        }.`,
      });
      setDoctorRoutingRequest(null);
      setRoutingDoctor('');
    }
  };

  const selectedPatientData = selectedRequest ? getPatient(selectedRequest.patient_id) : null;

  return (
    <MainLayout title="Laboratory" subtitle="Test management and results recording">
      {/* Connection Status */}
      <div className="mb-4 flex items-center gap-2">
        {loading ? (
          <Badge variant="outline" className="flex items-center gap-1">
            <WifiOff className="h-3 w-3" />
            Loading...
          </Badge>
        ) : (
          <Badge variant="success" className="flex items-center gap-1">
            <Wifi className="h-3 w-3" />
            Real-time Connected
          </Badge>
        )}
        <span className="text-sm text-muted-foreground">
          {activeLabRequests.length} lab request(s)
        </span>
        <Button variant="ghost" size="sm" onClick={refreshLabRequests} className="h-7 px-2 ml-auto">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <EmergencyLabQueue
        requests={labRequests}
        patients={patients}
        updateLabRequest={updateLabRequest}
        refreshLabRequests={refreshLabRequests}
        updatePatientStatus={updatePatientStatus}
      />

      <div className="mb-6">
        <LabSnapQueue />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          {/* All lab requests now flow through the LabSnapQueue above which handles paid orders */}
          <div className="bg-card rounded-xl border border-border p-8 text-center text-muted-foreground">
            <FlaskConical className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Please use the "Paid Lab Requests" queue above to process orders.</p>
          </div>
        </div>

        {/* Results Entry */}
        <div>

          <div className="bg-card rounded-xl border border-border p-4">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <FileText className="h-5 w-5 text-module-lab" />
              Quick Reference
            </h3>
            
            <div className="space-y-3 text-sm">
              <div className="p-3 bg-muted/30 rounded-lg">
                <p className="font-medium mb-1">Test Workflow</p>
                <ol className="list-decimal list-inside text-muted-foreground space-y-1">
                  <li>Check "Paid Lab Requests" for incoming orders</li>
                  <li>Click on a request to view details and start work</li>
                  <li>Use "Snap & Send Result" to complete the request</li>
                  <li>Mark the order as completed to notify the requester</li>

                </ol>
              </div>
              
              <div className="p-3 bg-warning/10 border border-warning/30 rounded-lg">
                <p className="font-medium text-warning mb-1">⚠️ Critical Values</p>
                <p className="text-muted-foreground text-xs">
                  Flag any critical values immediately and notify the requesting physician.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Results Entry Dialog */}
      <Dialog open={isResultsDialogOpen} onOpenChange={setIsResultsDialogOpen}>
        <DialogContent className="animate-scale-in">
          <DialogHeader>
            <DialogTitle>Enter Test Results</DialogTitle>
            <DialogDescription>
              Lab test for {selectedPatientData?.first_name} {selectedPatientData?.last_name}
              {selectedRequest && (
                <span className="block mt-1 text-xs">
                  Tests: {selectedRequest.tests.join(', ')}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {selectedPatientData && (
            <>
              <UniversalPatientHeader patient={selectedPatientData} />
              <div className="flex justify-end -mt-2">
                <SnapToCard patientId={selectedPatientData.id} station="lab" defaultLabel="Lab result" />
              </div>
            </>
          )}
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Result Capture</label>
              <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                Snap the paper lab result using the button above. The photo is the record — no typing required.
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Interpretation</label>
              <select 
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
                value={interpretation}
                onChange={(e) => setInterpretation(e.target.value)}
              >
                <option>Normal</option>
                <option>Abnormal - Low</option>
                <option>Abnormal - High</option>
                <option>Critical</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsResultsDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveResults} className="press-effect">
              <CheckCircle className="h-4 w-4 mr-1" />
              Save & Complete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Doctor Routing Dialog (when patient has no assigned doctor yet) */}
      <Dialog open={!!doctorRoutingRequest} onOpenChange={(open) => !open && setDoctorRoutingRequest(null)}>
        <DialogContent className="sm:max-w-md animate-scale-in">
          <DialogHeader>
            <DialogTitle>Route to Doctor</DialogTitle>
            <DialogDescription>
              This patient has no assigned doctor yet. Select which doctor should receive the lab results.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <label className="text-sm font-medium">Assign Doctor</label>
            <Select value={routingDoctor} onValueChange={(v) => setRoutingDoctor(v as 'doctor1' | 'doctor2')}>
              <SelectTrigger><SelectValue placeholder="Select Doctor 1 or Doctor 2" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="doctor1">Doctor 1</SelectItem>
                <SelectItem value="doctor2">Doctor 2</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDoctorRoutingRequest(null)}>Cancel</Button>
            <Button onClick={handleConfirmDoctorRouting} disabled={!routingDoctor}>
              <Send className="h-4 w-4 mr-1" />
              Send to Doctor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Laboratory;
