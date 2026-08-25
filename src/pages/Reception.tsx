 import { useAuth } from '@/contexts/AuthContext';
 import { useSelectedPatientParam } from '@/hooks/useSelectedPatientParam';
import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { MainLayout } from '@/components/layout/MainLayout';
import { hasWallet } from '@/lib/copay';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
  Send, 
  FileText,
  Phone,
  MapPin,
  Calendar,
  User,
  X,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Shield,
  Heart,
  Briefcase,
  Wallet,
  Edit3,
  History,
  RefreshCw,
  Wifi,
  WifiOff,
  Plus
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { AccountType } from '@/types/hms';
import { logError } from '@/lib/errorHandler';
import { usePatients, Patient } from '@/contexts/PatientContext';
import { supabase } from '@/integrations/supabase/client';
import { PatientStatusIndicator } from '@/components/patients/PatientStatusIndicator';

import { PatientJourneyDialog } from '@/components/patient/PatientJourneyDialog';
import { patientSchema } from '@/lib/validations';
import { z } from 'zod';
import { PatientBalanceHistory } from '@/components/reception/PatientBalanceHistory';
import { EditPatientDialog } from '@/components/reception/EditPatientDialog';
import { PatientPhotoAvatar } from '@/components/patient/PatientPhotoAvatar';
import { ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import { ShieldCheck } from 'lucide-react';
import { BalanceRequestDialog } from '@/components/reception/BalanceRequestDialog';
import { StaffSelector } from '@/components/reception/StaffSelector';
import { CheckInDialog } from '@/components/visit/CheckInDialog';
import { SnapToCard } from '@/components/visit/SnapToCard';
import { useActiveVisit } from '@/hooks/useVisits';
import { getPatientFeeStatuses, hasPaidFee, markPatientFeePaid, LIFETIME_REGISTRATION_PERIOD, monthStart, type PatientFeeStatus } from '@/lib/patientFees';
import { EligibilityRequestButton } from '@/components/reception/EligibilityRequestButton';
import { PreRegistrationVerificationPanel } from '@/components/reception/PreRegistrationVerificationPanel';
import { StaffMigrationQueue } from '@/components/reception/StaffMigrationQueue';
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

const getAccountTypeConfig = (t: AccountType | string | null | undefined) =>
  accountTypeConfig[(t as AccountType)] ?? accountTypeConfig.normal;

const Reception = () => {
  const { patients, loading, refreshPatients, updatePatientStatus } = usePatients();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useSelectedPatientParam();
  const [isNewPatientOpen, setIsNewPatientOpen] = useState(false);
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
    
    // Refresh patient data
    await refreshPatients();
 
    const isNewVisit = selectedPatient.status === 'discharged';
    // Prevent sending if already mid-visit
    if (selectedPatient.status !== 'registered' && !isNewVisit && selectedPatient.status !== 'awaiting_payment') {
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
      <StaffMigrationQueue />
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
                          getAccountTypeConfig(patient.account_type).color
                        )}
                      >
                        {getAccountTypeConfig(patient.account_type).label}
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
                refreshData={refreshPatients}
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

function PatientDetailsView({ patient, onClose, onSendToNurse, refreshData }: { patient: Patient; onClose: () => void; onSendToNurse: (preferredDoctor?: 'doctor1' | 'doctor2') => void; refreshData: () => void }) {
  const { updatePatient, updatePatientStatus, deletePatient } = usePatients();
  const { hasRole } = useAuth();
  const [feeStatuses, setFeeStatuses] = useState<PatientFeeStatus[]>([]);
  const [feeBusy, setFeeBusy] = useState(false);
  const [isSendDialogOpen, setIsSendDialogOpen] = useState(false);
  const [isCheckingFee, setIsCheckingFee] = useState(false);

  const [preferredDoctor, setPreferredDoctor] = useState<'doctor1' | 'doctor2' | 'none'>('none');
  const [isJourneyOpen, setIsJourneyOpen] = useState(false);
  const [isCheckInOpen, setIsCheckInOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { visit: activeVisit } = useActiveVisit(patient.id);
  const [balanceDialog, setBalanceDialog] = useState<'topup' | 'refund' | null>(null);
  // Wallet-enabled patients (cash + staff_family) can top-up, refund, and
  // run partial payments on their own balance. Sponsored / insured / staff
  // settle via the sponsor.
  const canUseBalance = hasWallet(patient);
  const isReception = hasRole(['receptionist']);
  const registrationPaid = patient.registration_fee_paid || hasPaidFee(feeStatuses, 'registration');
  const consultationPaid = hasPaidFee(feeStatuses, 'consultation');

  useEffect(() => {
    let active = true;
    getPatientFeeStatuses(patient.id)
      .then((statuses) => { if (active) setFeeStatuses(statuses); })
      .catch((error) => logError('Failed to load patient fee status', error));
    return () => { active = false; };
  }, [patient.id]);

  const markFeePaid = async (feeType: 'registration' | 'consultation') => {
    if (!isReception || feeBusy) return;
    setFeeBusy(true);
    try {
      await markPatientFeePaid(patient.id, feeType);
      setFeeStatuses(await getPatientFeeStatuses(patient.id));
      if (feeType === 'registration') await updatePatient(patient.id, { registration_fee_paid: true });
      await refreshData();
      toast.success(feeType === 'registration' ? 'Registration fee marked as paid' : 'Consultation fee marked as paid');
    } catch (error: any) {
      toast.error('Could not mark fee as paid', { description: error?.message || 'Please try again.' });
    } finally { setFeeBusy(false); }
  };

  const handleConfirmSend = () => {
    onSendToNurse(preferredDoctor === 'none' ? undefined : preferredDoctor);
    setIsSendDialogOpen(false);
    setPreferredDoctor('none');
  };

  const handleOpenSendDialog = async () => {
    setIsSendDialogOpen(true);
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
                    getAccountTypeConfig(patient.account_type).color
                  )}
                >
                  {getAccountTypeConfig(patient.account_type).icon}
                  {getAccountTypeConfig(patient.account_type).label}
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

      {isReception && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Patient Fees</p>
              <p className="text-xs text-muted-foreground">Reception payment acknowledgement</p>
            </div>
            <Badge variant="outline">{format(new Date(), 'MMMM yyyy')}</Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center justify-between gap-2 rounded-md border bg-background p-3">
              <div><p className="text-xs font-medium">Registration Fee</p><p className="text-[11px] text-muted-foreground">Lifetime</p></div>
              {registrationPaid ? <Badge variant="success">Paid</Badge> : <Button size="sm" onClick={() => markFeePaid('registration')} disabled={feeBusy}>Mark as Paid</Button>}
            </div>
            <div className="flex items-center justify-between gap-2 rounded-md border bg-background p-3">
              <div><p className="text-xs font-medium">Consultation Fee</p><p className="text-[11px] text-muted-foreground">This month</p></div>
              {consultationPaid ? <Badge variant="success">Paid</Badge> : <Button size="sm" onClick={() => markFeePaid('consultation')} disabled={feeBusy}>Mark as Paid</Button>}
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">

        {patient.status === 'registered' || patient.status === 'discharged' ? (
          <>
            <Button
              variant={patient.status === 'discharged' ? 'hero' : 'module'}
              className="h-20 flex-col gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] hover:shadow-lg"
              onClick={handleOpenSendDialog}
              disabled={isCheckingFee || (patient.status !== 'registered' && patient.status !== 'discharged')}
            >
              {isCheckingFee ? (
                <RefreshCw className="h-5 w-5 animate-spin" />
              ) : patient.status === 'discharged' ? (
                <RefreshCw className="h-5 w-5" />
              ) : (
                <Send className="h-5 w-5" />
              )}
              <span>{patient.status === 'discharged' ? 'Start New Visit' : 'Send to Nurse'}</span>
            </Button>
            <Dialog open={isSendDialogOpen} onOpenChange={setIsSendDialogOpen}>
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
        </>
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
              // Proactively check for open visits to avoid raw trigger errors
              const { data: openVisit } = await supabase
                .from('visits')
                .select('id, visit_number')
                .eq('patient_id', patient.id)
                .eq('status', 'open')
                .maybeSingle();

              if (openVisit) {
                toast.error('Cannot discharge patient', {
                  description: `Visit ${openVisit.visit_number} is still open. Please settle it from Billing or Cashier first.`
                });
                return;
              }

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

      </div>

      <div className="flex justify-end pt-4 border-t border-border mt-6">
        <Button 
          variant="ghost" 
          size="sm" 
          className="text-destructive hover:bg-destructive/10 gap-2"
          onClick={() => setIsDeleteConfirmOpen(true)}
        >
          <X className="h-4 w-4" />
          Delete Patient Record
        </Button>

          <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete the patient record
                  for {patient.first_name} {patient.last_name} and remove all associated data including invoices, visits, and clinical records.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={isDeleting}
                  onClick={async (e) => {
                    e.preventDefault();
                    setIsDeleting(true);
                    try {
                      const success = await deletePatient(patient.id);
                      if (success) {
                        toast.success("Patient record deleted successfully");
                        onClose();
                      }
                    } catch (error) {
                      console.error("Delete error:", error);
                      toast.error("Just trying to delete a patient but failed, kindly fix please");
                    } finally {
                      setIsDeleting(false);
                      setIsDeleteConfirmOpen(false);
                    }
                  }}
                >
                  {isDeleting ? "Deleting..." : "Delete permanently"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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

      <EditPatientDialog
        patient={patient}
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
      />

      <PatientBalanceHistory patientId={patient.id} />



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


      {/* Patient Journey Dialog */}
      <PatientJourneyDialog
        open={isJourneyOpen}
        onOpenChange={setIsJourneyOpen}
        patient={patient}
      />
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
  const [patientType, setPatientType] = useState<'new' | 'existing'>('new');
  const [openingDebt, setOpeningDebt] = useState('0');
  const [openingCredit, setOpeningCredit] = useState('0');
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
    physical_card_number: '',
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
    if (patientType === 'existing') {
      const physicalCard = formData.physical_card_number.trim();
      if (!physicalCard) e.physical_card_number = 'Enter the number printed on the existing physical card';
      else if (physicalCard.length > 80) e.physical_card_number = 'Maximum 80 characters';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
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

    const physicalCardNumber = patientType === 'existing' ? formData.physical_card_number.trim() : '';
    if (physicalCardNumber) {
      const { data: cardMatches, error: cardLookupError } = await supabase
        .from('patients')
        .select('id, first_name, last_name, card_number')
        .eq('physical_card_number', physicalCardNumber)
        .limit(1);
      if (cardLookupError) {
        toast.error('Could not validate the physical card number');
        setIsSubmitting(false);
        return;
      }
      if (cardMatches?.[0]) {
        const match = cardMatches[0] as any;
        toast.error('Physical card number already exists', {
          description: `${match.first_name} ${match.last_name} (${match.card_number}) already has this physical card number.`,
          duration: 6000,
        });
        setIsSubmitting(false);
        return;
      }
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
      physical_card_number: patientType === 'existing' ? formData.physical_card_number.trim() : null,
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
      staff_link_id: isStaff ? formData.staff_id : null,
      corporate_id: isSponsor ? formData.corporate_id : null,
      insurance_provider: isInsurance ? (resolvedProviderName || formData.insurance_provider.trim()) : null,
      insurance_plan: isInsurance ? (formData.insurance_plan || memberData.plan || memberData.plan_tier || null) : null,
      enrollee_id: isInsurance ? primaryEnrollee : null,
      member_id_data: cleanMemberData,
      balance: 0,
      registration_fee_paid: patientType === 'existing',
    } as any);

    if (result && (result as any).id && parseFloat(openingDebt) > 0) {
      const { error: onboardErr } = await supabase.rpc('adjust_patient_balance', {
        _patient_id: (result as any).id,
        _delta: -parseFloat(openingDebt),
        _transaction_type: 'debt_incurred',
        _notes: 'Opening debt from physical card',
      });

      if (onboardErr) {
        logError('Error in patient opening debt initialization', onboardErr);
        toast.error('Patient created but debt initialization failed');
      }
    }

    if (result && (result as any).id && parseFloat(openingCredit) > 0) {
      const { error: creditErr } = await supabase.rpc('adjust_patient_balance', {
        _patient_id: (result as any).id,
        _delta: parseFloat(openingCredit),
        _transaction_type: 'topup',
        _notes: 'Opening credit from physical card',
      });

      if (creditErr) {
        logError('Error in patient opening credit initialization', creditErr);
        toast.error('Patient created but credit initialization failed');
      }
    }

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
      <div className="bg-muted/30 p-4 rounded-lg border border-border space-y-4">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
            Patient Type
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={patientType === 'new' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPatientType('new')}
              className="w-full"
            >
              New Patient
            </Button>
            <Button
              type="button"
              variant={patientType === 'existing' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPatientType('existing')}
              className="w-full"
            >
              Existing/Old Patient
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            {patientType === 'new' 
              ? "Charge Registration Fee (₦1,000) and Monthly Consultation (₦3,000)."
              : "No Registration Fee. Record any opening debt or credit from the physical card."}
          </p>
        </div>

        {patientType === 'existing' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Existing Physical Card Number <span className="text-destructive">*</span></label>
              <Input
                value={formData.physical_card_number}
                onChange={(e) => setFormData((prev) => ({ ...prev, physical_card_number: e.target.value }))}
                placeholder="Enter the number printed on the old card"
                maxLength={80}
              />
              {errors.physical_card_number && <p className="text-[11px] text-destructive">{errors.physical_card_number}</p>}
              <p className="text-[10px] text-muted-foreground">The system will still generate a separate Patient ID automatically.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Opening Debt (₦)</label>
              <Input
                type="number"
                placeholder="0.00"
                value={openingDebt}
                onChange={(e) => setOpeningDebt(e.target.value)}
                className="h-8 text-sm"
              />
              <p className="text-[10px] text-muted-foreground">Owed from physical card.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Opening Credit (₦)</label>
              <Input
                type="number"
                placeholder="0.00"
                value={openingCredit}
                onChange={(e) => setOpeningCredit(e.target.value)}
                className="h-8 text-sm"
              />
              <p className="text-[10px] text-muted-foreground">Balance in patient's favour.</p>
            </div>
            </div>
          </div>
        )}
      </div>

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
