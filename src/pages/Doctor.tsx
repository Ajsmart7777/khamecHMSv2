import { useSelectedPatientParam } from '@/hooks/useSelectedPatientParam';
import { useEffect, useState, useMemo } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { UniversalPatientHeader } from '@/components/patient/UniversalPatientHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Stethoscope, FileText, ClipboardList, Wifi, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SnapClinicalOrder } from '@/components/visit/SnapClinicalOrder';
import { usePatients, Patient } from '@/contexts/PatientContext';
import { toast } from 'sonner';
import { BedDouble } from 'lucide-react';
import { PatientStatusIndicator } from '@/components/patients/PatientStatusIndicator';
import { useLabRequests } from '@/hooks/useLabRequests';
import { LabRequestPrintQueue } from '@/components/doctor/LabRequestPrintQueue';
import { LabResultsViewer } from '@/components/doctor/LabResultsViewer';
import { LabResultInbox } from '@/components/doctor/LabResultInbox';
import { AdmittedPatientsPanel } from '@/components/visit/AdmittedPatientsPanel';
import { AdmissionCaptureDialog } from '@/components/nurse/AdmissionCaptureDialog';
import { useAdmissionPerms } from '@/lib/admissionPermissions';
import { PatientHistoryDialog } from '@/components/doctor/PatientHistoryDialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useSearchParams } from 'react-router-dom';
import { QuickDischargeButton } from '@/components/patient/QuickDischargeButton';

const Doctor = () => {
  const { patients, loading, refreshPatients, getPatientsByStatus } = usePatients();
  const { updatePatientStatus } = usePatients();
  const { labRequests } = useLabRequests();
  const { role, user } = useAuth();
  const [searchParams] = useSearchParams();
  const asParam = searchParams.get('as');
  const [selectedPatientId, setSelectedPatientId] = useSelectedPatientParam();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [admitOpen, setAdmitOpen] = useState(false);
  const canAct = useAdmissionPerms();
  const [pendingLabReturnPatientIds, setPendingLabReturnPatientIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from('snap_orders')
        .select('patient_id')
        .eq('order_type', 'lab_result')
        .eq('returned_to', user.id)
        .eq('status', 'returned');
      if (cancelled) return;
      setPendingLabReturnPatientIds(new Set((data ?? []).map((r: any) => r.patient_id)));
    };
    load();
    const ch = supabase
      .channel(`doctor-lab-return-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'snap_orders' }, load)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [user?.id]);

  const myDoctorKey: 'doctor1' | 'doctor2' | null =
    role === 'doctor1' ? 'doctor1'
    : role === 'doctor2' ? 'doctor2'
    : role === 'admin' && (asParam === 'doctor1' || asParam === 'doctor2') ? asParam
    : null;

  const baseQueue = getPatientsByStatus(['with_doctor']);
  const scopedQueue = myDoctorKey
    ? baseQueue.filter(p => p.assigned_doctor === myDoctorKey)
    : baseQueue;

  // Lab-returned patients live in the "Returned from Lab" inbox.
  const labReturnedPatients = scopedQueue.filter(p => pendingLabReturnPatientIds.has(p.id));
  
  const labReturnIds = new Set(labReturnedPatients.map(p => p.id));
  const doctorQueue = scopedQueue.filter(p => !labReturnIds.has(p.id));
  const selectedPatient = selectedPatientId ? patients.find(p => p.id === selectedPatientId) : null;

  // Handler for global "Snap to Admit" triggers (e.g. from LabResultInbox)
  useEffect(() => {
    const handleOpenAdm = (e: any) => {
      setSelectedPatientId(e.detail.patientId);
      setAdmitOpen(true);
    };
    window.addEventListener('open-admission-dialog', handleOpenAdm);
    return () => window.removeEventListener('open-admission-dialog', handleOpenAdm);
  }, [setSelectedPatientId]);

  return (
    <MainLayout title="Doctor's Console" subtitle="Snap the paper card and route the patient">
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
        {/* Queue */}
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
                          : "border-border hover:border-module-doctor/50",
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-medium text-sm">
                          {patient.first_name} {patient.last_name}
                        </p>
                        <div className="flex items-center gap-1">
                          {isLabReturn && (
                            <Badge variant="info" className="text-[10px]">Lab Results</Badge>
                          )}
                          <PatientStatusIndicator status={patient.status} size="sm" showIcon={false} />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">{patient.card_number}</p>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <LabResultInbox />
          <AdmittedPatientsPanel
            sourceStation="doctor"
            title="My Admitted Patients"
            assignedDoctor={myDoctorKey ?? undefined}
          />
          <LabRequestPrintQueue assignedDoctor={myDoctorKey ?? undefined} />
          <LabResultsViewer assignedDoctor={myDoctorKey ?? undefined} />
        </div>

        {/* Consultation area */}
        <div className="lg:col-span-3">
          {selectedPatient ? (
            <div className="space-y-4 animate-fade-in">
              <UniversalPatientHeader patient={selectedPatient} />

              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
                  <FileText className="h-4 w-4 mr-2" />
                  View History
                </Button>
              </div>

              <div className="bg-card rounded-xl border border-border p-6 text-center space-y-3">
                <div className="mx-auto w-12 h-12 rounded-full bg-module-doctor/10 flex items-center justify-center">
                  <ClipboardList className="h-6 w-6 text-module-doctor" />
                </div>
                <h3 className="font-semibold">Snap the paper card and route the patient</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Write Dx / Rx / Lab request on the card, then snap and choose where the patient goes next.
                  Lab results always come back to your queue.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <SnapClinicalOrder
                  patientId={selectedPatient.id}
                  sourceStation="doctor"
                  defaultOrderType="prescription"
                  defaultTarget="pharmacy"
                  label="Snap → Pharmacy"
                  variant="default"
                  className="w-full"
                />
                <SnapClinicalOrder
                  patientId={selectedPatient.id}
                  sourceStation="doctor"
                  defaultOrderType="lab"
                  defaultTarget="lab"
                  label="Snap → Lab"
                  variant="default"
                  className="w-full"
                />
                <SnapClinicalOrder
                  patientId={selectedPatient.id}
                  sourceStation="doctor"
                  defaultOrderType="treatment"
                  defaultTarget="nurse"
                  label="Snap → Nurse"
                  variant="outline"
                  className="w-full"
                />
              </div>

              {canAct('admit') && (
                <div className="pt-2">
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => setAdmitOpen(true)}
                  >
                    <BedDouble className="h-4 w-4 mr-2" />
                    Snap to Admit
                  </Button>
                </div>
              )}

              <div className="pt-1">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={async () => {
                    const ok = await updatePatientStatus(selectedPatient.id, 'with_nurse');
                    if (ok) {
                      toast.success('Sent back to Nurse', {
                        description: 'Patient added to the nurse queue.',
                      });
                      setSelectedPatientId(null);
                    } else {
                      toast.error('Failed to send patient to nurse');
                    }
                  }}
                >
                  <ClipboardList className="h-4 w-4 mr-2" />
                  Send to Nurse (no snap)
                </Button>
              </div>

              <div className="pt-1">
                <QuickDischargeButton
                  patientId={selectedPatient.id}
                  patientName={`${selectedPatient.first_name} ${selectedPatient.last_name}`}
                  onDischarged={() => setSelectedPatientId(null)}
                  variant="outline"
                  className="w-full"
                />
              </div>
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

      {selectedPatient && (
        <PatientHistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          patient={selectedPatient}
        />
      )}

      {selectedPatientId && (
        <AdmissionCaptureDialog
          open={admitOpen}
          onOpenChange={setAdmitOpen}
          patientId={selectedPatientId}
          patientName={selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name}` : 'Patient'}
          onAdmitted={() => {
            setAdmitOpen(false);
            setSelectedPatientId(null);
          }}
        />
      )}
    </MainLayout>
  );
};

export default Doctor;
