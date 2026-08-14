import { useSelectedPatientParam } from '@/hooks/useSelectedPatientParam';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { MainLayout } from '@/components/layout/MainLayout';
import { UniversalPatientHeader } from '@/components/patient/UniversalPatientHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Pill, 
  CheckCircle,
  User,
  AlertTriangle,
  Wifi,
  WifiOff,
  RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';
import { SnapToCard } from '@/components/visit/SnapToCard';
import { PharmacySnapQueue } from '@/components/pharmacy/PharmacySnapQueue';
import { PharmacyInventoryPanel } from '@/components/pharmacy/PharmacyInventoryPanel';
import { prescriptionAuditLogger } from '@/lib/auditLogger';
import { findOpenVisit, closeVisit } from '@/hooks/useVisits';
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
import { PrintableDispenseReceiptDialog } from '@/components/receipts/PrintableDispenseReceiptDialog';
import { usePrescriptions, Prescription } from '@/hooks/usePrescriptions';
import { PatientStatus } from '@/types/hms';
import { getPendingWorkflowStation, workflowStationLabel } from '@/lib/workflowRouting';

const Pharmacy = () => {
  const { patients, loading, updatePatientStatus, getPatientsByStatus, refreshPatients } = usePatients();
  const { prescriptions, updatePrescriptionStatus, markItemDispensed, getPendingPrescriptions, refreshPrescriptions } = usePrescriptions();
  const [isDispenseDialogOpen, setIsDispenseDialogOpen] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useSelectedPatientParam();
  const [selectedPrescription, setSelectedPrescription] = useState<Prescription | null>(null);
  const [dispensedPatients, setDispensedPatients] = useState<Set<string>>(new Set());
  const [dispenseReceiptData, setDispenseReceiptData] = useState<{
    open: boolean;
    patient: Patient;
    receiptNumber: string;
    date: Date;
    items: { name: string; dosage: string; quantity: number; instructions: string }[];
  } | null>(null);

  // Get pending prescriptions from database
  const pendingPrescriptions = getPendingPrescriptions();

  const getPatientForPrescription = (patientId: string) => {
    return patients.find(p => p.id === patientId);
  };

  const handleDispense = (prescription: Prescription) => {
    const patient = getPatientForPrescription(prescription.patient_id);
    if (patient) {
      setSelectedPatientId(patient.id);
      setSelectedPrescription(prescription);
      setIsDispenseDialogOpen(true);
    }
  };

  const generateReceiptNumber = () => {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `DSP-${timestamp}-${random}`;
  };

  const confirmDispense = async () => {
    if (!selectedPatientId || !selectedPrescription) return;
    const patient = patients.find(p => p.id === selectedPatientId);

    // Determine inpatient status by checking for an active admission
    // (patient status alone can be transient e.g. 'at_pharmacy' while admitted)
    const { data: activeAdm, error: admErr } = await supabase
      .from('admissions')
      .select('id')
      .eq('patient_id', selectedPatientId)
      .eq('status', 'active')
      .maybeSingle();
    if (admErr) {
      toast.error('Could not verify admission status', { description: admErr.message });
      return;
    }
    const isInpatient = !!activeAdm;

    // Mark all individual items as dispensed
    if (selectedPrescription.items?.length) {
      await Promise.all(
        selectedPrescription.items.map(item => markItemDispensed(item.id, true))
      );
    }

    // Mark prescription as dispensed
    const rxOk = await updatePrescriptionStatus(selectedPrescription.id, 'dispensed');
    if (!rxOk) {
      toast.error('Failed to mark prescription as dispensed');
      return;
    }

    await prescriptionAuditLogger(
      'prescription_dispensed',
      selectedPrescription.id,
      {
        patient_id: selectedPatientId,
        patient_name: patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown',
        items_count: selectedPrescription.items?.length || 0,
        medications: selectedPrescription.items?.map(i => i.medication) || [],
        inpatient: isInpatient,
      }
    );

    setDispensedPatients(prev => new Set([...prev, selectedPatientId]));

    // Only auto-discharge outpatients when no other paid lab/pharmacy work is
    // still open. If lab is pending, route there instead of falsely discharging.
    let nextStatus: PatientStatus = 'discharged';
    if (!isInpatient) {
      try {
        nextStatus = (await getPendingWorkflowStation(selectedPatientId)) ?? 'discharged';
      } catch (err: any) {
        toast.error('Could not verify pending workflow', { description: err?.message });
        return;
      }

      // If patient is heading to discharge, auto-settle the open visit FIRST.
      // The DB blocks discharge while a visit is open, and settling an insured
      // visit auto-flips claim_status → pending so it lands in the Claims queue
      // without a manual Billing step.
      if (nextStatus === 'discharged') {
        try {
          const openVisit = await findOpenVisit(selectedPatientId);
          if (openVisit) {
            await closeVisit(openVisit.id);
          }
        } catch (err: any) {
          toast.error('Could not settle visit', {
            description: err?.message ?? 'Please settle from Billing before discharge.',
          });
          return;
        }
      }

      const routed = await updatePatientStatus(selectedPatientId, nextStatus, { guardInpatient: true });
      if (!routed) {
        // Keep dialog open so pharmacist can retry
        toast.error('Dispensed, but patient could not be routed. Please refresh and retry.');
        return;
      }
    } else {
      toast.success('Dispensed to inpatient', { description: 'Patient remains admitted.' });
    }

    setIsDispenseDialogOpen(false);

    if (patient) {
      const receiptItems = (selectedPrescription.items || []).map(item => ({
        name: item.medication,
        dosage: item.dosage,
        quantity: item.quantity,
        instructions: `${item.frequency} for ${item.duration}`,
      }));

      setDispenseReceiptData({
        open: true,
        patient,
        receiptNumber: generateReceiptNumber(),
        date: new Date(),
        items: receiptItems.length > 0 ? receiptItems : [
          { name: 'Medications dispensed', dosage: '-', quantity: 1, instructions: 'As prescribed' }
        ],
      });
      if (!isInpatient) {
        toast.success('Medication Dispensed', {
          description: `Prescription for ${patient.first_name} ${patient.last_name} has been dispensed. Patient routed to ${workflowStationLabel(nextStatus)}.`
        });
      }
    }
    setSelectedPrescription(null);
    refreshPatients();
  };

  const handlePartialDispense = async (patientId: string) => {
    const patient = patients.find(p => p.id === patientId);
    toast.success('Partial Dispense', {
      description: `Dispensed available items for ${patient?.first_name} ${patient?.last_name}. Remaining items pending.`
    });
  };

  const selectedPatient = patients.find(p => p.id === selectedPatientId);
  const activePrescriptions = pendingPrescriptions.filter(p => !dispensedPatients.has(p.patient_id));

  return (
    <MainLayout title="Pharmacy" subtitle="Medication dispensing">
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
          {activePrescriptions.length} prescription(s) pending
        </span>
        <Button variant="ghost" size="sm" onClick={() => { refreshPatients(); refreshPrescriptions(); }} className="h-7 px-2 ml-auto">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mb-6">
        <PharmacyInventoryPanel />
      </div>
      <div className="mb-6">
        <PharmacySnapQueue />
      </div>
      {selectedPatient && (
        <div className="mb-6">
          <UniversalPatientHeader patient={selectedPatient} />
        </div>
      )}

      <div>
        {/* The legacy prescriptions queue has been removed to maintain the sustainable workflow. 
            All prescriptions (including typed ones) now flow exclusively through the 
            "Paid Prescriptions — Ready to Dispense" queue after billing and payment. */}
      </div>

      {/* Dispense Confirmation Dialog */}
      <AlertDialog open={isDispenseDialogOpen} onOpenChange={setIsDispenseDialogOpen}>
        <AlertDialogContent className="animate-scale-in">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Dispensing</AlertDialogTitle>
            <AlertDialogDescription>
              Dispense medications to {selectedPatient?.first_name} {selectedPatient?.last_name}?
              <div className="mt-3 p-3 bg-muted/30 rounded-lg">
                <p className="text-sm">Card: {selectedPatient?.card_number}</p>
                <p className="text-sm">Account: {selectedPatient?.account_type}</p>
                {selectedPatient?.allergies && selectedPatient.allergies.length > 0 && (
                  <p className="text-sm text-warning mt-1">
                    Allergies: {selectedPatient.allergies.join(', ')}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDispense}>
              <CheckCircle className="h-4 w-4 mr-1" />
              Confirm Dispense
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dispense Receipt Dialog */}
      {dispenseReceiptData && (
        <PrintableDispenseReceiptDialog
          open={dispenseReceiptData.open}
          onOpenChange={(open) => setDispenseReceiptData(open ? dispenseReceiptData : null)}
          patient={dispenseReceiptData.patient}
          items={dispenseReceiptData.items}
          receiptNumber={dispenseReceiptData.receiptNumber}
          date={dispenseReceiptData.date}
        />
      )}
    </MainLayout>
  );
};

export default Pharmacy;
