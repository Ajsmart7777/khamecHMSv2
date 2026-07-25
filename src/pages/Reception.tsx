import { useSelectedPatientParam } from '@/hooks/useSelectedPatientParam';
import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { hasWallet } from '@/lib/copay';
import { TasksPanel } from '@/components/tasks/TasksPanel';
import { UniversalPatientHeader } from '@/components/patient/UniversalPatientHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  UserPlus, 
  Search, 
  CreditCard, 
  Send, 
  FileText,
  Phone,
  MapPin,
  Calendar,
  User,
  X,
  CheckCircle2,
  Building2,
  Shield,
  Heart,
  Briefcase,
  Wallet,
  Edit3,
  History,
  RefreshCw,
  Wifi,
  WifiOff
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { AccountType } from '@/types/hms';
import { usePatients, Patient } from '@/contexts/PatientContext';
import { supabase } from '@/integrations/supabase/client';
import { PatientStatusIndicator } from '@/components/patients/PatientStatusIndicator';
import { PrintableReceiptDialog } from '@/components/receipts/PrintableReceiptDialog';
import { PatientJourneyDialog } from '@/components/patient/PatientJourneyDialog';
import { patientSchema, paymentSchema } from '@/lib/validations';
import { z } from 'zod';
import { paymentAuditLogger } from '@/lib/auditLogger';
import { useInvoices } from '@/hooks/useInvoices';
import { nextStationForInvoice, workflowStationLabel } from '@/lib/workflowRouting';
import { StandingOrderCaptureDialog } from '@/components/reception/StandingOrderCaptureDialog';
import { PatientStandingOrders } from '@/components/reception/PatientStandingOrders';
import { PatientBalanceHistory } from '@/components/reception/PatientBalanceHistory';
import { EditPatientDialog } from '@/components/reception/EditPatientDialog';
import { PatientPhotoAvatar } from '@/components/patient/PatientPhotoAvatar';
import { Stethoscope, ArrowUpCircle, ArrowDownCircle, LogIn } from 'lucide-react';
import { ShieldCheck } from 'lucide-react';
import { BalanceRequestDialog } from '@/components/reception/BalanceRequestDialog';
import { StaffSelector } from '@/components/reception/StaffSelector';
import { CheckInDialog } from '@/components/visit/CheckInDialog';
import { SnapToCard } from '@/components/visit/SnapToCard';
import { useActiveVisit } from '@/hooks/useVisits';
import { EligibilityRequestButton } from '@/components/reception/EligibilityRequestButton';
import { PreRegistrationVerificationPanel } from '@/components/reception/PreRegistrationVerificationPanel';
import { useEligibilityVerifications, type EligibilityVerification } from '@/hooks/useEligibilityVerifications';
import { useInsuranceTemplates, TEMPLATE_LABELS } from '@/hooks/useInsuranceTemplates';
import { DynamicMemberIdForm } from '@/components/insurance/DynamicMemberIdForm';
import {
  derivePrimaryEnrolleeId, validateMemberFields,
  type ProviderField,
} from '@/lib/providerFields';

const accountTypeConfig: Record<AccountType, { label: string; icon: React.ReactNode; color: string; description: string }> = {
  normal: { 
    label: 'Normal', 
    icon: <User className="h-4 w-4" />, 
    color: 'bg-secondary text-secondary-foreground',
    description: 'Standard walk-in patient'
  },
  katchma: {
    label: 'Katchma',
    icon: <Shield className="h-4 w-4" />,
    color: 'bg-info/10 text-info border-info/30',
    description: 'Katchma State Health Insurance'
  },
  corporate: { 
    label: 'Corporate', 
    icon: <Building2 className="h-4 w-4" />, 
    color: 'bg-primary/10 text-primary border-primary/30',
    description: 'Company-sponsored healthcare'
  },
  nhis: { 
    label: 'NHIS', 
    icon: <Heart className="h-4 w-4" />, 
    color: 'bg-success/10 text-success border-success/30',
    description: 'National Health Insurance Scheme'
  },
  hmo: { 
    label: 'HMO', 
    icon: <Briefcase className="h-4 w-4" />, 
    color: 'bg-warning/10 text-warning border-warning/30',
    description: 'Health Maintenance Organization'
  },
  retainer: { 
    label: 'Retainer', 
    icon: <Wallet className="h-4 w-4" />, 
    color: 'bg-accent/10 text-accent border-accent/30',
    description: 'Sponsor referral — billed monthly'
  },
  staff: {
    label: 'Staff',
    icon: <Briefcase className="h-4 w-4" />,
    color: 'bg-success/10 text-success border-success/30',
    description: 'Hospital staff — fully covered'
  },
  staff_family: {
    label: 'Staff Family',
    icon: <Heart className="h-4 w-4" />,
    color: 'bg-primary/10 text-primary border-primary/30',
    description: 'Staff dependent — 50% covered'
  },
};

const Reception = () => {
  const { patients, loading, refreshPatients, updatePatientStatus } = usePatients();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useSelectedPatientParam();
  const [isNewPatientOpen, setIsNewPatientOpen] = useState(false);
  const [standingOrderOpen, setStandingOrderOpen] = useState(false);
  const [prefillVerification, setPrefillVerification] = useState<EligibilityVerification | null>(null);
  const [verificationPanelOpen, setVerificationPanelOpen] = useState(false);

  const filteredPatients = patients.filter(p => 
    p.first_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.last_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.card_number.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedPatient = selectedPatientId ? patients.find(p => p.id === selectedPatientId) : null;

  const handleSendToNurse = async (preferredDoctor?: 'doctor1' | 'doctor2') => {
    if (!selectedPatient) return;
    const isNewVisit = selectedPatient.status === 'discharged';
    // Prevent sending if already mid-visit (not registered and not discharged)
    if (selectedPatient.status !== 'registered' && !isNewVisit) {
      toast.error('Patient already in an active visit', {
        description: `${selectedPatient.first_name} ${selectedPatient.last_name} status: ${selectedPatient.status}.`
      });
      return;
    }

    // Starting a fresh visit for a discharged patient: clear prior doctor assignment.
    if (isNewVisit) {
      const { error: resetError } = await supabase
        .from('patients')
        .update({ assigned_doctor: null })
        .eq('id', selectedPatient.id);
      if (resetError) {
        toast.error('Failed to start new visit');
        return;
      }
    }

    // Optional pre-assignment of a specific doctor from Reception.
    if (preferredDoctor) {
      const { error: assignError } = await supabase
        .from('patients')
        .update({ assigned_doctor: preferredDoctor })
        .eq('id', selectedPatient.id);
      if (assignError) {
        toast.error('Failed to pre-assign doctor');
        return;
      }
    }

    const success = await updatePatientStatus(selectedPatient.id, 'waiting');
    if (success) {
      const label = preferredDoctor === 'doctor1' ? ' (pre-assigned to Doctor 1)'
                    : preferredDoctor === 'doctor2' ? ' (pre-assigned to Doctor 2)'
                    : '';
      toast.success(`${selectedPatient.first_name} ${selectedPatient.last_name} ${isNewVisit ? 'started new visit — sent to Nurse Station' : 'sent to Nurse Station'}${label}`, {
        description: 'Patient is now in the queue',
        icon: <CheckCircle2 className="h-4 w-4 text-success" />
      });
    }
  };

  return (
    <MainLayout title="Reception" subtitle="Patient registration and payment collection">
      <TasksPanel role="receptionist" status={['pending', 'in_progress']} />
      {/* Real-time indicator */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center gap-1.5 text-xs text-success">
          <Wifi className="h-3.5 w-3.5 animate-pulse" />
          <span>Real-time updates active</span>
        </div>
        <Button variant="ghost" size="sm" onClick={refreshPatients} className="h-7 px-2">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 ml-auto"
          onClick={() => setStandingOrderOpen(true)}
        >
          <Stethoscope className="h-3.5 w-3.5 mr-1.5" /> Capture External Prescription
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => setVerificationPanelOpen(true)}
        >
          <ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Insurance Verification
        </Button>
      </div>
      <Dialog open={verificationPanelOpen} onOpenChange={setVerificationPanelOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" /> Insurance Verification
            </DialogTitle>
          </DialogHeader>
          <PreRegistrationVerificationPanel
            onStartRegistration={(v) => {
              setPrefillVerification(v);
              setVerificationPanelOpen(false);
              setIsNewPatientOpen(true);
            }}
          />
        </DialogContent>
      </Dialog>
      <StandingOrderCaptureDialog
        open={standingOrderOpen}
        onOpenChange={setStandingOrderOpen}
        presetPatientId={selectedPatientId || undefined}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Panel - Patient List */}
        <div className="lg:col-span-1">
          <div className="bg-card rounded-xl border border-border p-4 sticky top-24">
            <div className="flex items-center gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Search by name or card..."
                  className="pl-10 transition-all focus:ring-2 focus:ring-primary/20"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <Dialog open={isNewPatientOpen} onOpenChange={setIsNewPatientOpen}>
                <DialogTrigger asChild>
                  <Button 
                    size="icon" 
                    className="shrink-0 transition-transform hover:scale-105 active:scale-95"
                  >
                    <UserPlus className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <UserPlus className="h-5 w-5 text-primary" />
                      Register New Patient
                    </DialogTitle>
                    <DialogDescription>
                      Fill in the patient details below. All fields marked with * are required.
                    </DialogDescription>
                  </DialogHeader>
                  <NewPatientForm
                    initialVerification={prefillVerification}
                    onSuccess={() => { setIsNewPatientOpen(false); setPrefillVerification(null); }}
                  />
                </DialogContent>
              </Dialog>
            </div>
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">
                  <RefreshCw className="h-8 w-8 mx-auto mb-2 animate-spin" />
                  <p className="text-sm">Loading patients...</p>
                </div>
              ) : filteredPatients.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <User className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No patients found</p>
                </div>
              ) : (
                filteredPatients.map((patient, index) => (
                  <div
                    key={patient.id}
                    onClick={() => setSelectedPatientId(patient.id)}
                    className={cn(
                      "p-3 rounded-lg border cursor-pointer transition-all duration-200 animate-fade-in",
                      selectedPatientId === patient.id 
                        ? "border-primary bg-primary/5 shadow-md" 
                        : "border-border hover:border-primary/50 hover:bg-muted/50 hover:shadow-sm"
                    )}
                    style={{ animationDelay: `${index * 30}ms` }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">{patient.first_name} {patient.last_name}</span>
                      <Badge 
                        className={cn(
                          "text-[10px] border transition-transform hover:scale-105",
                          accountTypeConfig[patient.account_type].color
                        )}
                      >
                        {accountTypeConfig[patient.account_type].label}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground font-mono">{patient.card_number}</p>
                      <PatientStatusIndicator status={patient.status} size="sm" showIcon={false} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Panel - Patient Details */}
        <div className="lg:col-span-2">
          {selectedPatient ? (
            <div className="space-y-3">
              <UniversalPatientHeader patient={selectedPatient} />
              <PatientDetailsView
                patient={selectedPatient}
                onClose={() => setSelectedPatientId(null)}
                onSendToNurse={handleSendToNurse}
              />
            </div>
          ) : (
            <EmptyState onNewPatient={() => setIsNewPatientOpen(true)} />
          )}
        </div>
      </div>
    </MainLayout>
  );
};

function EmptyState({ onNewPatient }: { onNewPatient: () => void }) {
  return (
    <div className="bg-card rounded-xl border border-border p-12 text-center animate-fade-in">
      <div className="w-16 h-16 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
        <User className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">No Patient Selected</h3>
      <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
        Select a patient from the list to view their details, or register a new patient.
      </p>
      <Button 
        variant="hero" 
        onClick={onNewPatient}
        className="transition-transform hover:scale-105 active:scale-95"
      >
        <UserPlus className="h-4 w-4 mr-2" />
        Register New Patient
      </Button>
    </div>
  );
}

function PatientDetailsView({ patient, onClose, onSendToNurse }: { patient: Patient; onClose: () => void; onSendToNurse: (preferredDoctor?: 'doctor1' | 'doctor2') => void }) {
  const { updatePatient, updatePatientStatus } = usePatients();
  const { getInvoicesForPatient, recordPayment } = useInvoices();
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isSendDialogOpen, setIsSendDialogOpen] = useState(false);
  const [preferredDoctor, setPreferredDoctor] = useState<'doctor1' | 'doctor2' | 'none'>('none');
  const [isJourneyOpen, setIsJourneyOpen] = useState(false);
  const [isStandingOrderOpen, setIsStandingOrderOpen] = useState(false);
  const [isCheckInOpen, setIsCheckInOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const { visit: activeVisit } = useActiveVisit(patient.id);
  const [balanceDialog, setBalanceDialog] = useState<'topup' | 'refund' | null>(null);
  // Wallet-enabled patients (cash + staff_family) can top-up, refund, and
  // run partial payments on their own balance. Sponsored / insured / staff
  // settle via the sponsor.
  const canUseBalance = hasWallet(patient);
  const [receiptData, setReceiptData] = useState<{
    open: boolean;
    amount: number;
    method: string;
    receiptNumber: string;
    date: Date;
    newBalance: number;
  } | null>(null);

  // Get all invoices for this patient
  const patientInvoices = getInvoicesForPatient(patient.id);
  const pendingInvoices = patientInvoices.filter(i => i.status === 'pending' || i.status === 'partial');
  const paidInvoices = patientInvoices.filter(i => i.status === 'completed');
  const pendingInvoice = pendingInvoices[0]; // First pending invoice for payment

  const generateReceiptNumber = () => {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `RCP-${timestamp}-${random}`;
  };

  const handleRecordPayment = async (amount: number, method: string) => {
    const receiptNumber = generateReceiptNumber();

    // Sponsored / insured patients settle at the Cashier — never at Reception —
    // and their wallet must never be touched.
    if (!canUseBalance) {
      toast.error('Sponsored patients settle at the Cashier, not Reception');
      setIsPaymentOpen(false);
      return;
    }

    // If there's a pending invoice, record payment against it
    let isInvoiceFullyPaid = false;
    if (pendingInvoice) {
      await recordPayment(pendingInvoice.id, amount, method);
      const newPaidAmount = pendingInvoice.paid_amount + amount;
      isInvoiceFullyPaid = newPaidAmount >= pendingInvoice.total_amount;
    }

    // Recording an invoice payment must NOT credit the wallet — payments close
    // invoices, they don't top up. Top-ups go through BalanceRequestDialog.
    {
      setIsPaymentOpen(false);
      // Show receipt dialog
      setReceiptData({
        open: true,
        amount,
        method,
        receiptNumber,
        date: new Date(),
        newBalance: Number(patient.balance || 0),
      });
      
      // Auto-route patient after full payment
      if (isInvoiceFullyPaid) {
        const nextStation = await nextStationForInvoice(pendingInvoice.id, patient.id, 'discharged');
        await updatePatientStatus(patient.id, nextStation);
        toast.info(
          nextStation === 'discharged'
            ? 'Patient discharged — no pending station work'
            : `Patient routed to ${workflowStationLabel(nextStation)}`,
        );
      }
      
      // Log audit event for payment received
      await paymentAuditLogger(
        'payment_received',
        receiptNumber,
        { 
          patient_id: patient.id,
          patient_name: `${patient.first_name} ${patient.last_name}`,
          card_number: patient.card_number,
          amount,
          payment_method: method,
          previous_balance: patient.balance,
          new_balance: patient.balance,
        }
      );
      
      toast.success(`Payment of ₦${amount.toLocaleString()} recorded`, {
        description: `Via ${method} for ${patient.first_name} ${patient.last_name}`,
        icon: <CheckCircle2 className="h-4 w-4 text-success" />
      });
    }
  };

  const handleConfirmSend = () => {
    onSendToNurse(preferredDoctor === 'none' ? undefined : preferredDoctor);
    setIsSendDialogOpen(false);
    setPreferredDoctor('none');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Patient Header */}
      <div className="bg-card rounded-xl border border-border p-6 relative overflow-hidden">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-lg hover:bg-muted transition-colors"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
        
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-4">
            <PatientPhotoAvatar patient={patient} size={64} />
            <div>
              <h2 className="text-xl font-bold">{patient.first_name} {patient.last_name}</h2>
              <p className="text-muted-foreground font-mono">{patient.card_number}</p>
              <div className="flex items-center gap-2 mt-2">
                <PatientStatusIndicator status={patient.status} pulse />
                <Badge 
                  className={cn(
                    "border flex items-center gap-1",
                    accountTypeConfig[patient.account_type].color
                  )}
                >
                  {accountTypeConfig[patient.account_type].icon}
                  {accountTypeConfig[patient.account_type].label}
                </Badge>
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Account Balance</p>
            <p className="text-2xl font-bold text-foreground">₦{patient.balance.toLocaleString()}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="flex items-center gap-2 text-sm p-2 rounded-lg bg-muted/50">
            <Phone className="h-4 w-4 text-primary" />
            <span>{patient.phone}</span>
          </div>
          <div className="flex items-center gap-2 text-sm p-2 rounded-lg bg-muted/50">
            <MapPin className="h-4 w-4 text-primary" />
            <span className="truncate">{patient.address}</span>
          </div>
          <div className="flex items-center gap-2 text-sm p-2 rounded-lg bg-muted/50">
            <Calendar className="h-4 w-4 text-primary" />
            <span>{new Date(patient.date_of_birth).toLocaleDateString()}</span>
          </div>
          <div className="flex items-center gap-2 text-sm p-2 rounded-lg bg-muted/50">
            <FileText className="h-4 w-4 text-primary" />
            <span>Blood: {patient.blood_group || 'N/A'}</span>
          </div>
        </div>

        {/* Insurance / Sponsor Info + Eligibility Verification */}
        {['katchma', 'hmo', 'nhis', 'corporate', 'retainer'].includes(patient.account_type) && (
          <div className="mt-4 p-3 rounded-lg bg-info/5 border border-info/20 space-y-2">
            {patient.insurance_provider && (
              <div className="flex items-center gap-2 text-sm">
                <Shield className="h-4 w-4 text-info" />
                <span className="font-medium">{patient.insurance_provider}</span>
                {patient.insurance_policy_number && (
                  <>
                    <span className="text-muted-foreground">•</span>
                    <span className="font-mono text-xs">{patient.insurance_policy_number}</span>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {pendingInvoice && canUseBalance ? (
          <Dialog open={isPaymentOpen} onOpenChange={setIsPaymentOpen}>
            <DialogTrigger asChild>
              <Button 
                variant="module" 
                className="h-20 flex-col gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] hover:shadow-lg"
              >
                <CreditCard className="h-5 w-5" />
                <span>Record Payment</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-primary" />
                  Record Payment
                </DialogTitle>
                <DialogDescription>
                  Record a payment for {patient.first_name} {patient.last_name}
                </DialogDescription>
              </DialogHeader>
              <PaymentForm onSubmit={handleRecordPayment} onCancel={() => setIsPaymentOpen(false)} defaultAmount={pendingInvoice.total_amount - pendingInvoice.paid_amount} invoiceNumber={pendingInvoice.invoice_number} />
            </DialogContent>
          </Dialog>
        ) : pendingInvoice && !canUseBalance ? (
          <Button
            variant="module"
            className="h-20 flex-col gap-2 opacity-60 cursor-not-allowed"
            disabled
            title="Sponsored patients pay copay at the Cashier"
          >
            <CreditCard className="h-5 w-5" />
            <span>Pay at Cashier</span>
          </Button>
        ) : (
          <Button 
            variant="module" 
            className="h-20 flex-col gap-2 opacity-50 cursor-not-allowed"
            disabled
          >
            <CreditCard className="h-5 w-5" />
            <span>No Pending Bill</span>
          </Button>
        )}

        {(patient.status === 'registered' || patient.status === 'discharged') ? (
        <Dialog open={isSendDialogOpen} onOpenChange={setIsSendDialogOpen}>
          <DialogTrigger asChild>
            <Button 
              variant={patient.status === 'discharged' ? 'hero' : 'module'}
              className="h-20 flex-col gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] hover:shadow-lg"
            >
              {patient.status === 'discharged' ? <RefreshCw className="h-5 w-5" /> : <Send className="h-5 w-5" />}
              <span>{patient.status === 'discharged' ? 'Start New Visit' : 'Send to Nurse'}</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {patient.status === 'discharged' ? <RefreshCw className="h-5 w-5 text-primary" /> : <Send className="h-5 w-5 text-primary" />}
                {patient.status === 'discharged' ? 'Start New Visit' : 'Send to Nurse Station'}
              </DialogTitle>
              <DialogDescription>
                {patient.status === 'discharged'
                  ? `Begin a fresh visit for ${patient.first_name} ${patient.last_name} and send them to the nurse station for vitals?`
                  : `Send ${patient.first_name} ${patient.last_name} to the nurse station for vitals?`}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <div className="p-4 rounded-lg bg-muted/50 border">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{patient.first_name} {patient.last_name}</p>
                    <p className="text-sm text-muted-foreground">{patient.card_number}</p>
                  </div>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <label className="text-sm font-medium">Pre-assign Doctor (optional)</label>
                <Select value={preferredDoctor} onValueChange={(v) => setPreferredDoctor(v as 'doctor1' | 'doctor2' | 'none')}>
                  <SelectTrigger><SelectValue placeholder="Let the nurse decide" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Let the nurse decide</SelectItem>
                    <SelectItem value="doctor1">Doctor 1</SelectItem>
                    <SelectItem value="doctor2">Doctor 2</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  If chosen, the patient will land in the selected doctor's queue after vitals.
                </p>
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button variant="hero" onClick={handleConfirmSend}>
                <Send className="h-4 w-4 mr-2" />
                Confirm Send
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        ) : (
          <Button 
            variant="module" 
            className="h-20 flex-col gap-2 opacity-50 cursor-not-allowed"
            disabled
          >
            <Send className="h-5 w-5" />
            <span>Already Sent</span>
          </Button>
        )}

        <Button 
          variant="module" 
          className="h-20 flex-col gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] hover:shadow-lg"
          onClick={() => setIsJourneyOpen(true)}
        >
          <History className="h-5 w-5" />
          <span>View History</span>
        </Button>
        
        {(patient.status === 'awaiting_payment' || patient.status === 'discharged') ? (
          <Button 
            variant="hero" 
            className="h-20 flex-col gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] hover:shadow-lg"
            onClick={async () => {
              const success = await updatePatientStatus(patient.id, 'discharged');
              if (success) {
                toast.success(`${patient.first_name} ${patient.last_name} discharged`, {
                  description: 'Patient has been discharged successfully.',
                  icon: <CheckCircle2 className="h-4 w-4 text-success" />
                });
              }
            }}
            disabled={patient.status === 'discharged'}
          >
            <CheckCircle2 className="h-5 w-5" />
            <span>{patient.status === 'discharged' ? 'Discharged' : 'Discharge'}</span>
          </Button>
        ) : (
          <Button 
            variant="outline" 
            className="h-20 flex-col gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] hover:shadow-sm"
            onClick={() => setIsEditOpen(true)}
          >
            <Edit3 className="h-5 w-5" />
            <span>Edit Details</span>
          </Button>
        )}

        <Button
          variant="outline"
          className="h-20 flex-col gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] hover:shadow-sm border-primary/30 text-primary"
          onClick={() => setIsStandingOrderOpen(true)}
        >
          <Stethoscope className="h-5 w-5" />
          <span className="text-xs leading-tight text-center">Capture External Rx</span>
        </Button>
      </div>

      {canUseBalance && (
        <div className="grid grid-cols-2 gap-4">
          <Button
            variant="outline"
            className="h-16 flex-col gap-1 border-primary/30 text-primary hover:bg-primary/5"
            onClick={() => setBalanceDialog('topup')}
          >
            <ArrowUpCircle className="h-5 w-5" />
            <span className="text-xs">Top Up Balance</span>
          </Button>
          <Button
            variant="outline"
            className="h-16 flex-col gap-1 border-warning/30 text-warning hover:bg-warning/5"
            onClick={() => setBalanceDialog('refund')}
            disabled={Number(patient.balance) <= 0}
          >
            <ArrowDownCircle className="h-5 w-5" />
            <span className="text-xs">Request Refund</span>
          </Button>
        </div>
      )}

      {balanceDialog && (
        <BalanceRequestDialog
          open={!!balanceDialog}
          onOpenChange={(o) => !o && setBalanceDialog(null)}
          patient={patient}
          type={balanceDialog}
        />
      )}

      <StandingOrderCaptureDialog
        open={isStandingOrderOpen}
        onOpenChange={setIsStandingOrderOpen}
        presetPatientId={patient.id}
      />

      <EditPatientDialog
        patient={patient}
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
      />

      <PatientStandingOrders patientId={patient.id} />

      <PatientBalanceHistory patientId={patient.id} />



      {/* Invoice Summary */}
      {patientInvoices.length > 0 && (
        <div className="space-y-3">
          {/* Summary bar */}
          <div className="flex items-center gap-2 px-1">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{patientInvoices.length} Invoice{patientInvoices.length > 1 ? 's' : ''}:</span>
            {paidInvoices.length > 0 && (
              <Badge variant="success" className="text-xs">{paidInvoices.length} Paid</Badge>
            )}
            {pendingInvoices.length > 0 && (
              <Badge variant="warning" className="text-xs">{pendingInvoices.length} Pending</Badge>
            )}
          </div>

          {/* Pending invoice expanded */}
          {pendingInvoice && (
            <div className="bg-module-billing/5 border border-module-billing/30 rounded-xl p-4 animate-fade-in">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <FileText className="h-4 w-4 text-module-billing" />
                  Invoice: {pendingInvoice.invoice_number}
                </h3>
                <Badge variant={pendingInvoice.status === 'partial' ? 'warning' : 'outline'}>
                  {pendingInvoice.status}
                </Badge>
              </div>
              {pendingInvoice.items && pendingInvoice.items.length > 0 && (
                <div className="space-y-1 mb-3">
                  {pendingInvoice.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span>{item.description} x{item.quantity}</span>
                      <span className="font-medium">₦{item.total.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="border-t border-module-billing/20 pt-2 space-y-1">
                <div className="flex justify-between text-sm font-semibold">
                  <span>Total</span>
                  <span>₦{pendingInvoice.total_amount.toLocaleString()}</span>
                </div>
                {pendingInvoice.paid_amount > 0 && (
                  <div className="flex justify-between text-sm text-success">
                    <span>Paid</span>
                    <span>₦{pendingInvoice.paid_amount.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold">
                  <span>Balance Due</span>
                  <span className="text-destructive">
                    ₦{(pendingInvoice.total_amount - pendingInvoice.paid_amount).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Paid invoices collapsed */}
          {paidInvoices.length > 0 && (
            <div className="space-y-1">
              {paidInvoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between p-2 rounded-lg bg-success/5 border border-success/20 text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                    <span className="font-mono text-xs">{inv.invoice_number}</span>
                  </div>
                  <span className="font-medium text-success">₦{inv.total_amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {patient.allergies && patient.allergies.length > 0 && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 animate-fade-in">
          <h3 className="font-semibold text-destructive mb-2">⚠️ Known Allergies</h3>
          <div className="flex flex-wrap gap-2">
            {patient.allergies.map((allergy) => (
              <Badge 
                key={allergy} 
                variant="destructive"
                className="animate-pulse"
              >
                {allergy}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Payment Receipt Dialog */}
      {receiptData && (
        <PrintableReceiptDialog
          open={receiptData.open}
          onOpenChange={(open) => setReceiptData(open ? receiptData : null)}
          patient={patient}
          amount={receiptData.amount}
          paymentMethod={receiptData.method}
          receiptNumber={receiptData.receiptNumber}
          date={receiptData.date}
          newBalance={receiptData.newBalance}
        />
      )}

      {/* Patient Journey Dialog */}
      <PatientJourneyDialog
        open={isJourneyOpen}
        onOpenChange={setIsJourneyOpen}
        patient={patient}
      />
    </div>
  );
}

function PaymentForm({ onSubmit, onCancel, defaultAmount, invoiceNumber }: { onSubmit: (amount: number, method: string) => void; onCancel: () => void; defaultAmount?: number; invoiceNumber?: string }) {
  const [amount, setAmount] = useState(defaultAmount ? defaultAmount.toString() : '');
  const [method, setMethod] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = () => {
    try {
      const validatedData = paymentSchema.parse({
        amount: Number(amount),
        method: method || undefined,
      });
      setErrors({});
      onSubmit(validatedData.amount, validatedData.method);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          if (err.path[0]) {
            newErrors[err.path[0] as string] = err.message;
          }
        });
        setErrors(newErrors);
        toast.error('Please fix the validation errors');
      }
    }
  };

  return (
    <div className="space-y-4 py-4">
      {defaultAmount !== undefined && invoiceNumber && (
        <div className="bg-muted/50 rounded-lg p-3 border border-border space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Invoice</span>
            <span className="font-mono font-medium">{invoiceNumber}</span>
          </div>
          <div className="flex justify-between text-sm font-semibold">
            <span>Balance Due</span>
            <span className="text-destructive">₦{defaultAmount.toLocaleString()}</span>
          </div>
        </div>
      )}
      <div>
        <label className="text-sm font-medium text-foreground mb-1.5 block">Amount (₦)</label>
        <Input 
          type="number" 
          placeholder="Enter amount" 
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          readOnly={!!defaultAmount}
          className={cn(
            "transition-all focus:ring-2 focus:ring-primary/20",
            errors.amount && "border-destructive",
            defaultAmount && "bg-muted/50 cursor-not-allowed"
          )}
        />
        {errors.amount && <p className="text-xs text-destructive mt-1">{errors.amount}</p>}
      </div>
      <div>
        <label className="text-sm font-medium text-foreground mb-1.5 block">Payment Method</label>
        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger className={cn("w-full", errors.method && "border-destructive")}>
            <SelectValue placeholder="Select payment method" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cash">Cash</SelectItem>
            <SelectItem value="pos">POS</SelectItem>
            <SelectItem value="transfer">Bank Transfer</SelectItem>
            <SelectItem value="insurance">Insurance</SelectItem>
          </SelectContent>
        </Select>
        {errors.method && <p className="text-xs text-destructive mt-1">{errors.method}</p>}
      </div>
      <div className="flex justify-end gap-3 pt-4">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button variant="hero" onClick={handleSubmit}>
          <CheckCircle2 className="h-4 w-4 mr-2" />
          Record Payment
        </Button>
      </div>
    </div>
  );
}

const INSURANCE_PLANS: Record<string, string[]> = {
  katchma: ['Katchma Basic', 'Katchma Standard'],
  hmo: [],
  nhis: ['NHIA Standard'],
};

function NewPatientForm({
  onSuccess,
  initialVerification,
}: {
  onSuccess: () => void;
  initialVerification?: EligibilityVerification | null;
}) {
  const { addPatient } = usePatients();
  const { markConsumed } = useEligibilityVerifications();
  const { getFields } = useInsuranceTemplates();
  const seededName = initialVerification?.prospective_patient_name ?? '';
  const seededPhone = initialVerification?.prospective_patient_phone ?? '';
  const seededType: AccountType | '' = initialVerification
    ? (initialVerification.sponsor_type === 'nhis' ? 'nhis'
      : initialVerification.sponsor_type === 'hmo' ? 'hmo'
      : initialVerification.sponsor_type === 'katchma' ? 'katchma' : '')
    : '';
  const [formData, setFormData] = useState({
    full_name: seededName,
    phone: seededPhone,
    occupation: '',
    gender: '' as 'male' | 'female' | '',
    address: '',
    age: '',
    account_type: (seededType || 'normal') as AccountType,
    corporate_id: '',
    insurance_provider: initialVerification?.verified_provider_name ?? initialVerification?.provider_name ?? '',
    insurance_plan: initialVerification?.verified_plan ?? initialVerification?.plan ?? '',
    enrollee_id: initialVerification?.verified_enrollee_id ?? initialVerification?.enrollee_id ?? '',
    staff_id: '',
  });
  const [memberData, setMemberData] = useState<Record<string, string>>(
    (initialVerification?.member_id_data as Record<string, string>) || {},
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isSponsor = formData.account_type === 'corporate' || formData.account_type === 'retainer';
  const isInsurance = ['nhis', 'hmo', 'katchma'].includes(formData.account_type);
  const isStaff = formData.account_type === 'staff';
  const isStaffFamily = formData.account_type === 'staff_family';

  // Templates saved by Claims Manager drive which fields Reception fills.
  const providerFields: ProviderField[] = isInsurance ? getFields(formData.account_type) : [];
  const isHmoFlow = formData.account_type === 'hmo';
  const schemeLabel = isInsurance ? TEMPLATE_LABELS[formData.account_type as 'nhis' | 'katchma' | 'hmo'] : '';
  const availablePlans = isInsurance ? (INSURANCE_PLANS[formData.account_type] || []) : [];

  // For HMO, the "provider_name" field is the sponsor's provider (Hygeia, Axa etc).
  // For NHIA/KATCHMA, the scheme itself is the provider label.
  useEffect(() => {
    if (!isInsurance) return;
    if (isHmoFlow) {
      const pn = (memberData.provider_name || '').trim();
      if (pn && pn !== formData.insurance_provider) {
        setFormData((prev) => ({ ...prev, insurance_provider: pn }));
      }
    } else if (schemeLabel && formData.insurance_provider !== schemeLabel) {
      setFormData((prev) => ({ ...prev, insurance_provider: schemeLabel }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInsurance, isHmoFlow, schemeLabel, memberData.provider_name]);

  const validate = () => {
    const e: Record<string, string> = {};
    const name = formData.full_name.trim();
    if (!name) e.full_name = 'Name is required';
    else if (!/^[a-zA-Z\s'-]{2,100}$/.test(name)) e.full_name = 'Letters, spaces, hyphens, apostrophes only';
    if (!/^[\d\s+()-]{7,20}$/.test(formData.phone.trim())) e.phone = 'Enter a valid phone number';
    if (!formData.occupation.trim()) e.occupation = 'Occupation is required';
    else if (formData.occupation.trim().length > 100) e.occupation = 'Max 100 characters';
    if (!formData.gender) e.gender = 'Select gender';
    if (!formData.address.trim()) e.address = 'Address is required';
    else if (formData.address.trim().length > 500) e.address = 'Max 500 characters';
    const ageNum = Number(formData.age);
    if (!formData.age || !Number.isInteger(ageNum) || ageNum < 0 || ageNum > 130) {
      e.age = 'Enter age between 0 and 130';
    }
    if (isSponsor && !formData.corporate_id) {
      e.corporate_id = 'Select a sponsor';
    }
    if (isInsurance) {
      const { errors: fErrors } = validateMemberFields(providerFields, memberData);
      Object.entries(fErrors).forEach(([k, v]) => { e[`member_${k}`] = v; });
      // Ensure at least one identifier was captured
      const primary = derivePrimaryEnrolleeId(providerFields, memberData);
      if (!primary) e.enrollee_id = 'Capture at least one member identifier';
      // Resolve provider name from HMO memberData or scheme label.
      const resolvedProvider = isHmoFlow
        ? (memberData.provider_name || '').trim()
        : schemeLabel;
      if (!resolvedProvider) e.insurance_provider = 'Provider name is required';
    }
    if ((isStaff || isStaffFamily) && !formData.staff_id) {
      e.staff_id = 'Select the linked staff member';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) {
      toast.error('Please fix the validation errors');
      return;
    }

    setIsSubmitting(true);

    // Split full name → first + last
    const parts = formData.full_name.trim().split(/\s+/);
    const first_name = parts.shift() || '';
    const last_name = parts.length ? parts.join(' ') : '';

    // Duplicate check by phone
    const { data: existingPatients } = await supabase
      .from('patients')
      .select('id, first_name, last_name, phone, card_number')
      .eq('phone', formData.phone.trim());

    if (existingPatients && existingPatients.length > 0) {
      const match = existingPatients[0];
      toast.error('Patient already exists', {
        description: `${match.first_name} ${match.last_name} (${match.card_number}) is already registered with this phone.`,
        duration: 6000,
      });
      setIsSubmitting(false);
      return;
    }

    // Derive DOB from age (Jan 1 of birth year)
    const birthYear = new Date().getFullYear() - Number(formData.age);
    const date_of_birth = `${birthYear}-01-01`;

    const primaryEnrollee = isInsurance ? derivePrimaryEnrolleeId(providerFields, memberData) : null;
    const cleanMemberData = isInsurance
      ? Object.fromEntries(Object.entries(memberData).filter(([, v]) => (v ?? '').trim() !== ''))
      : null;
    const resolvedProviderName = isInsurance
      ? (isHmoFlow ? (memberData.provider_name || '').trim() : schemeLabel)
      : '';
    const result = await addPatient({
      card_number: '',
      mini_card_number: '',
      first_name,
      last_name,
      date_of_birth,
      gender: formData.gender as 'male' | 'female',
      phone: formData.phone.trim(),
      address: formData.address.trim(),
      emergency_contact: '',
      occupation: formData.occupation.trim(),
      allergies: [],
      status: 'registered',
      account_type: formData.account_type,
      corporate_id: isSponsor ? formData.corporate_id : null,
      insurance_provider: isInsurance ? (resolvedProviderName || formData.insurance_provider.trim()) : null,
      insurance_plan: isInsurance ? (formData.insurance_plan || memberData.plan || memberData.plan_tier || null) : null,
      enrollee_id: isInsurance ? primaryEnrollee : null,
      member_id_data: cleanMemberData,
      balance: 0,
    } as any);

    setIsSubmitting(false);

    if (result) {
      if (isStaffFamily && (result as any).id && formData.staff_id) {
        const { error: linkErr } = await supabase
          .from('staff_family_members')
          .insert({ staff_id: formData.staff_id, patient_id: (result as any).id, salary_deduction_consent: true });
        if (linkErr) {
          toast.error('Patient created but staff link failed', { description: linkErr.message });
        }
      }
      if (initialVerification?.id && (result as any).id) {
        await markConsumed(initialVerification.id, (result as any).id);
      }
      onSuccess();
    }
  };

  return (
    <div className="space-y-6 py-4">
      <div>
        <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Patient Details</h4>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="text-sm font-medium mb-1.5 block">Full Name *</label>
            <Input
              placeholder="e.g. Auwal Musa"
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              className={errors.full_name ? 'border-destructive' : ''}
            />
            {errors.full_name && <p className="text-xs text-destructive mt-1">{errors.full_name}</p>}
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Phone No *</label>
            <Input
              placeholder="Phone number"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className={errors.phone ? 'border-destructive' : ''}
            />
            {errors.phone && <p className="text-xs text-destructive mt-1">{errors.phone}</p>}
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Age *</label>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={130}
              placeholder="e.g. 39"
              value={formData.age}
              onChange={(e) => setFormData({ ...formData, age: e.target.value })}
              className={errors.age ? 'border-destructive' : ''}
            />
            {errors.age && <p className="text-xs text-destructive mt-1">{errors.age}</p>}
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Gender *</label>
            <Select value={formData.gender} onValueChange={(v) => setFormData({ ...formData, gender: v as 'male' | 'female' })}>
              <SelectTrigger className={errors.gender ? 'border-destructive' : ''}>
                <SelectValue placeholder="Select gender" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
              </SelectContent>
            </Select>
            {errors.gender && <p className="text-xs text-destructive mt-1">{errors.gender}</p>}
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Occupation *</label>
            <Input
              placeholder="e.g. Teacher"
              value={formData.occupation}
              onChange={(e) => setFormData({ ...formData, occupation: e.target.value })}
              className={errors.occupation ? 'border-destructive' : ''}
            />
            {errors.occupation && <p className="text-xs text-destructive mt-1">{errors.occupation}</p>}
          </div>

          <div className="col-span-2">
            <label className="text-sm font-medium mb-1.5 block">Address *</label>
            <Input
              placeholder="Full address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className={errors.address ? 'border-destructive' : ''}
            />
            {errors.address && <p className="text-xs text-destructive mt-1">{errors.address}</p>}
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Account Type</h4>
        <Select
          value={formData.account_type}
          onValueChange={(v) => {
            setFormData({ ...formData, account_type: v as AccountType, corporate_id: '', insurance_provider: '', insurance_plan: '', enrollee_id: '', staff_id: '' });
            setMemberData({});
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select account type" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(accountTypeConfig) as AccountType[]).map((k) => (
              <SelectItem key={k} value={k}>{accountTypeConfig[k].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1.5">{accountTypeConfig[formData.account_type].description}</p>

        {isSponsor && (
          <>
            <CorporateSelector
              value={formData.corporate_id}
              onChange={(v) => setFormData({ ...formData, corporate_id: v })}
              accountType={formData.account_type as 'corporate' | 'retainer'}
            />
            {errors.corporate_id && <p className="text-xs text-destructive mt-1">{errors.corporate_id}</p>}
          </>
        )}

        {isInsurance && (
          <div className="mt-4 p-4 rounded-lg bg-primary/5 border border-primary/20 space-y-3 animate-fade-in">
            <div className="text-xs text-muted-foreground">
              Scheme: <span className="font-medium text-foreground">{schemeLabel}</span>
              {isHmoFlow && <span className="ml-1">— enter the HMO name and member details below.</span>}
            </div>

            {availablePlans.length > 0 && (
              <div>
                <label className="text-sm font-medium mb-1.5 block">Plan (optional)</label>
                <Select
                  value={formData.insurance_plan}
                  onValueChange={(v) => setFormData({ ...formData, insurance_plan: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select plan" />
                  </SelectTrigger>
                  <SelectContent>
                    {availablePlans.map((name) => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="border-t border-primary/20 pt-3">
              <p className="text-xs font-medium mb-2 text-muted-foreground uppercase tracking-wide">
                Member Details <span className="normal-case text-foreground">— {schemeLabel}</span>
              </p>
              {providerFields.length === 0 ? (
                <p className="text-xs text-destructive">
                  No fields configured for {schemeLabel}. Ask the Claims Manager to set up the template in <span className="font-medium">Claims → Insurance Providers</span>.
                </p>
              ) : (
                <>
                  <DynamicMemberIdForm
                    fields={providerFields}
                    values={memberData}
                    errors={Object.fromEntries(
                      Object.entries(errors)
                        .filter(([k]) => k.startsWith('member_'))
                        .map(([k, v]) => [k.replace(/^member_/, ''), v]),
                    )}
                    onChange={setMemberData}
                  />
                  {errors.enrollee_id && <p className="text-xs text-destructive mt-1">{errors.enrollee_id}</p>}
                  {errors.insurance_provider && <p className="text-xs text-destructive mt-1">{errors.insurance_provider}</p>}
                </>
              )}
            </div>
          </div>
        )}

        {(isStaff || isStaffFamily) && (
          <>
            <StaffSelector
              value={formData.staff_id}
              onChange={(id) => setFormData({ ...formData, staff_id: id })}
              label={isStaff ? 'Staff Member' : 'Linked Staff (Family Sponsor)'}
              helper={isStaff
                ? 'Select the staff this patient record belongs to (fully covered).'
                : 'Select the staff sponsor. Family member pays 50% out of pocket (hospital covers 50% discount). Max 4 family members per staff.'}
            />
            {errors.staff_id && <p className="text-xs text-destructive mt-1">{errors.staff_id}</p>}
          </>
        )}
      </div>


      <DialogFooter className="gap-2 sm:gap-0">
        <DialogClose asChild>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <Button variant="hero" onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Registering...
            </>
          ) : (
            <>
              <UserPlus className="h-4 w-4 mr-2" />
              Register Patient
            </>
          )}
        </Button>
      </DialogFooter>
    </div>
  );
}


function CorporateSelector({ value, onChange, accountType = 'corporate' }: { value: string; onChange: (v: string) => void; accountType?: 'corporate' | 'retainer' }) {
  const [accounts, setAccounts] = useState<{ id: string; company_name: string; status: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const isRetainer = accountType === 'retainer';
  const label = isRetainer ? 'Retainer Sponsor' : 'Corporate Account';

  useEffect(() => {
    const fetchAccounts = async () => {
      const { data, error } = await supabase
        .from('corporate_accounts')
        .select('id, company_name, status')
        .eq('status', 'active')
        .eq('account_type', accountType)
        .order('company_name');
      if (!error && data) setAccounts(data);
      setLoading(false);
    };
    fetchAccounts();
  }, [accountType]);

  return (
    <div className="mt-4 p-4 rounded-lg bg-primary/5 border border-primary/20 animate-fade-in">
      <label className="text-sm font-medium mb-1.5 block">
        <Building2 className="h-4 w-4 inline mr-1" />
        {label} *
      </label>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading {isRetainer ? 'retainers' : 'companies'}...</p>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active {isRetainer ? 'retainer' : 'corporate'} accounts. Create one in the Accounts module first.</p>
      ) : (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder={`Select ${isRetainer ? 'retainer' : 'company'}`} />
          </SelectTrigger>
          <SelectContent>
            {accounts.map(a => (
              <SelectItem key={a.id} value={a.id}>{a.company_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

export default Reception;
