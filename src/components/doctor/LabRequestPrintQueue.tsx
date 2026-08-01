import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Printer, 
  FlaskConical, 
  CheckCircle,
  Clock,
  User
} from 'lucide-react';
import { LabRequest, useLabRequests } from '@/hooks/useLabRequests';
import { usePatients, Patient } from '@/contexts/PatientContext';
import { PrintableLabRequestDialog } from '@/components/receipts/PrintableLabRequestDialog';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface LabRequestPrintQueueProps {
  /** Limit the queue to patients assigned to this doctor workspace. */
  assignedDoctor?: string;
}

export function LabRequestPrintQueue({ assignedDoctor }: LabRequestPrintQueueProps = {}) {
  const { labRequests, markAsPrinted, getUnprintedRequests } = useLabRequests();
  const { patients } = usePatients();
  const [selectedRequest, setSelectedRequest] = useState<{
    request: LabRequest;
    patient: Patient;
  } | null>(null);

  const allUnprinted = getUnprintedRequests();
  const unprintedRequests = assignedDoctor
    ? allUnprinted.filter(r => {
        const owner = patients.find(p => p.id === r.patient_id);
        return owner?.assigned_doctor === assignedDoctor;
      })
    : allUnprinted;

  const getPatient = (patientId: string): Patient | undefined => {
    return patients.find(p => p.id === patientId);
  };

  const handlePrint = (request: LabRequest) => {
    const patient = getPatient(request.patient_id);
    if (!patient) {
      toast.error('Patient not found');
      return;
    }
    setSelectedRequest({ request, patient });
  };

  const handlePrintComplete = async () => {
    if (selectedRequest) {
      await markAsPrinted(selectedRequest.request.id);
      toast.success('Request marked as printed');
      setSelectedRequest(null);
    }
  };

  if (unprintedRequests.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Printer className="h-5 w-5 text-module-lab" />
          Print Queue
        </h3>
        <div className="text-center py-6 text-muted-foreground">
          <CheckCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">All lab requests have been printed</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Printer className="h-5 w-5 text-module-lab" />
            Print Queue
          </h3>
          <Badge variant="warning">{unprintedRequests.length} pending</Badge>
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {unprintedRequests.map((request) => {
            const patient = getPatient(request.patient_id);
            if (!patient) return null;

            return (
              <div
                key={request.id}
                className="p-3 rounded-lg border border-border bg-muted/30 hover:bg-muted/50 transition-colors animate-fade-in"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-module-lab/10 flex items-center justify-center">
                      <User className="h-4 w-4 text-module-lab" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">
                        {patient.first_name} {patient.last_name}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <FlaskConical className="h-3 w-3" />
                        <span>{request.tests.length} test(s)</span>
                        <Clock className="h-3 w-3 ml-1" />
                        <span>{format(new Date(request.requested_at), 'HH:mm')}</span>
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handlePrint(request)}
                    className="press-effect"
                  >
                    <Printer className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Print Dialog */}
      {selectedRequest && (
        <PrintableLabRequestDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setSelectedRequest(null);
          }}
          patient={selectedRequest.patient}
          tests={selectedRequest.request.tests}
          diagnosis={selectedRequest.request.diagnosis || ''}
          requestNumber={selectedRequest.request.request_number}
          date={new Date(selectedRequest.request.requested_at)}
          onPrintComplete={handlePrintComplete}
        />
      )}
    </>
  );
}
