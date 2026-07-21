import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
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
  const [results, setResults] = useState({ value: '', interpretation: 'Normal' });

  const loading = patientsLoading || labLoading;

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
    if (!results.value) {
      toast.error('Missing Results', {
        description: 'Please enter test results before saving.'
      });
      return;
    }
    if (selectedRequest) {
      const success = await updateLabRequest(selectedRequest.id, { 
        status: 'completed',
        results: { value: results.value, interpretation: results.interpretation },
        completed_at: new Date().toISOString(),
      });
      
      if (success) {
        const patient = getPatient(selectedRequest.patient_id);
        toast.success('Results Saved', {
          description: `Test results for ${patient?.first_name} ${patient?.last_name} have been saved.`
        });
      }
      setIsResultsDialogOpen(false);
      setResults({ value: '', interpretation: 'Normal' });
      setSelectedRequest(null);
    }
  };

  const handleSendToDoctor = async (request: LabRequest) => {
    const patient = getPatient(request.patient_id);
    if (patient) {
      const success = await updatePatientStatus(patient.id, 'with_doctor');
      if (success) {
        toast.success('Results Sent', {
          description: `Lab results for ${patient?.first_name} ${patient?.last_name} have been sent to doctor.`
        });
      }
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Test Queue */}
        <div className="lg:col-span-2">
          <div className="bg-card rounded-xl border border-border">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold">Test Queue</h3>
              <div className="flex gap-2">
                <Badge variant="warning">
                  {activeLabRequests.filter(r => r.status === 'pending').length} Pending
                </Badge>
                <Badge variant="info">
                  {activeLabRequests.filter(r => r.status === 'in_progress').length} In Progress
                </Badge>
                <Badge variant="success">
                  {activeLabRequests.filter(r => r.status === 'completed').length} Completed
                </Badge>
              </div>
            </div>

            <div className="divide-y divide-border">
              {activeLabRequests.map((request) => {
                const patient = getPatient(request.patient_id);
                if (!patient) return null;
                
                const config = statusConfig[request.status as keyof typeof statusConfig];
                const StatusIcon = config.icon;
                
                return (
                  <div key={request.id} className="p-4 hover:bg-muted/30 transition-colors animate-fade-in">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-full bg-module-lab/10 flex items-center justify-center">
                          <User className="h-5 w-5 text-module-lab" />
                        </div>
                        <div>
                          <h4 className="font-medium">{patient.first_name} {patient.last_name}</h4>
                          <p className="text-sm text-muted-foreground">{patient.card_number} • {request.request_number}</p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {request.tests.map((test, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs">
                                {test}
                              </Badge>
                            ))}
                          </div>
                          <div className="mt-1">
                            <PatientStatusIndicator status={patient.status} size="sm" />
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        <Badge variant={config.color as 'warning' | 'info' | 'success'} className="flex items-center gap-1">
                          <StatusIcon className="h-3 w-3" />
                          {config.label}
                        </Badge>
                        
                        {request.status === 'pending' && (
                          <Button 
                            size="sm" 
                            variant="module" 
                            onClick={() => handleStart(request)}
                            className="press-effect"
                          >
                            <Play className="h-4 w-4 mr-1" />
                            Start
                          </Button>
                        )}
                        {request.status === 'in_progress' && (
                          <Button 
                            size="sm" 
                            variant="success" 
                            onClick={() => handleComplete(request)}
                            className="press-effect"
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Complete
                          </Button>
                        )}
                        {request.status === 'completed' && patient.status === 'in_lab' && (
                          <Button 
                            size="sm" 
                            variant="outline" 
                            onClick={() => handleSendToDoctor(request)}
                            className="press-effect"
                          >
                            <Send className="h-4 w-4 mr-1" />
                            Send to Doctor
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {activeLabRequests.length === 0 && (
                <div className="p-8 text-center text-muted-foreground">
                  <FlaskConical className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No pending lab tests</p>
                </div>
              )}
            </div>
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
                  <li>Receive lab request from Doctor</li>
                  <li>Click "Start" to begin processing</li>
                  <li>Complete test and record results</li>
                  <li>Send results back to Doctor</li>
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
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Results</label>
              <textarea 
                className="w-full h-32 px-3 py-2 rounded-lg border border-input bg-background text-sm resize-none"
                placeholder="Enter test results..."
                value={results.value}
                onChange={(e) => setResults({...results, value: e.target.value})}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Interpretation</label>
              <select 
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
                value={results.interpretation}
                onChange={(e) => setResults({...results, interpretation: e.target.value})}
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
    </MainLayout>
  );
};

export default Laboratory;
