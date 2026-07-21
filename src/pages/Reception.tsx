import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
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
import { usePrescriptions } from '@/hooks/usePrescriptions';
import { StandingOrderCaptureDialog } from '@/components/reception/StandingOrderCaptureDialog';
import { PatientStandingOrders } from '@/components/reception/PatientStandingOrders';
import { Stethoscope } from 'lucide-react';

const accountTypeConfig: Record<AccountType, { label: string; icon: React.ReactNode; color: string; description: string }> = {
  normal: { 
    label: 'Normal', 
    icon: <User className="h-4 w-4" />, 
    color: 'bg-secondary text-secondary-foreground',
    description: 'Standard walk-in patient'
  },
  insurance: { 
    label: 'Insurance', 
    icon: <Shield className="h-4 w-4" />, 
    color: 'bg-info/10 text-info border-info/30',
    description: 'Private health insurance'
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
    description: 'Pre-paid retainer account'
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
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [isNewPatientOpen, setIsNewPatientOpen] = useState(false);
  const [standingOrderOpen, setStandingOrderOpen] = useState(false);

  const filteredPatients = patients.filter(p => 
    p.first_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.last_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.card_number.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedPatient = selectedPatientId ? patients.find(p => p.id === selectedPatientId) : null;

  const handleSendToNurse = async () => {
    if (!selectedPatient) return;
    // Prevent sending if already beyond 'registered' status
    if (selectedPatient.status !== 'registered') {
      toast.error('Patient already sent', {
        description: `${selectedPatient.first_name} ${selectedPatient.last_name} has already been sent (status: ${selectedPatient.status}).`
      });
      return;
    }
    
    const success = await updatePatientStatus(selectedPatient.id, 'waiting');
    if (success) {
      toast.success(`${selectedPatient.first_name} ${selectedPatient.last_name} sent to Nurse Station`, {
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
          onClick={() => setStandingOrderOpen(true)}
        >
          <Stethoscope className="h-3.5 w-3.5 mr-1.5" /> Capture External Prescription
        </Button>
      </div>
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
                  <NewPatientForm onSuccess={() => setIsNewPatientOpen(false)} />
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
            <PatientDetailsView 
              patient={selectedPatient}
              onClose={() => setSelectedPatientId(null)}
              onSendToNurse={handleSendToNurse}
            />
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

function PatientDetailsView({ patient, onClose, onSendToNurse }: { patient: Patient; onClose: () => void; onSendToNurse: () => void }) {
  const { updatePatient, updatePatientStatus } = usePatients();
  const { getInvoicesForPatient, recordPayment } = useInvoices();
  const { getPrescriptionsForPatient } = usePrescriptions();
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isSendDialogOpen, setIsSendDialogOpen] = useState(false);
  const [isJourneyOpen, setIsJourneyOpen] = useState(false);
  const [isStandingOrderOpen, setIsStandingOrderOpen] = useState(false);
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
    const newBalance = patient.balance + amount;
    const receiptNumber = generateReceiptNumber();
    
    // If there's a pending invoice, record payment against it
    let isInvoiceFullyPaid = false;
    if (pendingInvoice) {
      await recordPayment(pendingInvoice.id, amount, method);
      const newPaidAmount = pendingInvoice.paid_amount + amount;
      isInvoiceFullyPaid = newPaidAmount >= pendingInvoice.total_amount;
    }
    
    const success = await updatePatient(patient.id, { balance: newBalance });
    if (success) {
      setIsPaymentOpen(false);
      // Show receipt dialog
      setReceiptData({
        open: true,
        amount,
        method,
        receiptNumber,
        date: new Date(),
        newBalance,
      });
      
      // Auto-route patient after full payment
      if (isInvoiceFullyPaid) {
        const patientPrescriptions = getPrescriptionsForPatient(patient.id);
        const hasPendingMedications = patientPrescriptions.some(
          p => p.status === 'pending' && p.items && p.items.some(item => !item.dispensed)
        );
        
        if (hasPendingMedications) {
          await updatePatientStatus(patient.id, 'at_pharmacy');
          toast.info('Patient routed to Pharmacy for medication pickup');
        } else {
          await updatePatientStatus(patient.id, 'discharged');
          toast.info('Patient auto-discharged (no pending medications)');
        }
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
          new_balance: newBalance
        }
      );
      
      toast.success(`Payment of ₦${amount.toLocaleString()} recorded`, {
        description: `Via ${method} for ${patient.first_name} ${patient.last_name}`,
        icon: <CheckCircle2 className="h-4 w-4 text-success" />
      });
    }
  };

  const handleConfirmSend = () => {
    onSendToNurse();
    setIsSendDialogOpen(false);
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
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shadow-lg">
              <User className="h-8 w-8 text-primary" />
            </div>
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

        {/* Insurance/Corporate Info */}
        {(patient.account_type === 'insurance' || patient.account_type === 'hmo') && patient.insurance_provider && (
          <div className="mt-4 p-3 rounded-lg bg-info/5 border border-info/20">
            <div className="flex items-center gap-2 text-sm">
              <Shield className="h-4 w-4 text-info" />
              <span className="font-medium">{patient.insurance_provider}</span>
              <span className="text-muted-foreground">•</span>
              <span className="font-mono text-xs">{patient.insurance_policy_number}</span>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {pendingInvoice ? (
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

        {patient.status === 'registered' ? (
        <Dialog open={isSendDialogOpen} onOpenChange={setIsSendDialogOpen}>
          <DialogTrigger asChild>
            <Button 
              variant="module" 
              className="h-20 flex-col gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] hover:shadow-lg"
            >
              <Send className="h-5 w-5" />
              <span>Send to Nurse</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Send className="h-5 w-5 text-primary" />
                Send to Nurse Station
              </DialogTitle>
              <DialogDescription>
                Send {patient.first_name} {patient.last_name} to the nurse station for vitals?
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
            onClick={() => toast.info('Edit patient feature coming soon')}
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

      <StandingOrderCaptureDialog
        open={isStandingOrderOpen}
        onOpenChange={setIsStandingOrderOpen}
        presetPatientId={patient.id}
      />

      <PatientStandingOrders patientId={patient.id} />


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

function NewPatientForm({ onSuccess }: { onSuccess: () => void }) {
  const { addPatient } = usePatients();
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    date_of_birth: '',
    gender: '' as 'male' | 'female' | '',
    phone: '',
    address: '',
    emergency_contact: '',
    blood_group: '',
    account_type: 'normal' as AccountType,
    insurance_provider: '',
    insurance_policy_number: '',
    corporate_id: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const generateCardNumber = () => {
    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 9000) + 1000;
    return `KMC-${year}-${random}`;
  };

  const handleSubmit = async () => {
    // Validate with Zod schema
    try {
      patientSchema.parse({
        first_name: formData.first_name,
        last_name: formData.last_name,
        date_of_birth: formData.date_of_birth,
        gender: formData.gender || undefined,
        phone: formData.phone,
        address: formData.address,
        emergency_contact: formData.emergency_contact,
        blood_group: formData.blood_group || undefined,
        account_type: formData.account_type,
        insurance_provider: formData.insurance_provider || undefined,
        insurance_policy_number: formData.insurance_policy_number || undefined,
        corporate_id: formData.corporate_id || undefined,
      });
      setErrors({});
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
        return;
      }
    }

    setIsSubmitting(true);

    // Check for duplicate patient by phone number or name
    const { data: existingPatients } = await supabase
      .from('patients')
      .select('id, first_name, last_name, phone, card_number')
      .or(`phone.eq.${formData.phone.trim()},and(first_name.ilike.${formData.first_name.trim()},last_name.ilike.${formData.last_name.trim()})`);

    if (existingPatients && existingPatients.length > 0) {
      const match = existingPatients[0];
      toast.error('Patient already exists', {
        description: `${match.first_name} ${match.last_name} (${match.card_number}) is already registered. Please search for the existing patient instead.`,
        duration: 6000,
      });
      setIsSubmitting(false);
      return;
    }
    
    const cardNumber = generateCardNumber();
    const result = await addPatient({
      card_number: cardNumber,
      mini_card_number: cardNumber.split('-').pop() || '',
      first_name: formData.first_name.trim(),
      last_name: formData.last_name.trim(),
      date_of_birth: formData.date_of_birth,
      gender: formData.gender as 'male' | 'female',
      phone: formData.phone.trim(),
      address: formData.address.trim(),
      emergency_contact: formData.emergency_contact.trim(),
      blood_group: formData.blood_group || undefined,
      allergies: [],
      status: 'registered',
      account_type: formData.account_type,
      corporate_id: formData.corporate_id?.trim() || undefined,
      insurance_provider: formData.insurance_provider?.trim() || undefined,
      insurance_policy_number: formData.insurance_policy_number?.trim() || undefined,
      balance: 0
    });

    setIsSubmitting(false);
    
    if (result) {
      onSuccess();
    }
  };

  const showInsuranceFields = ['insurance', 'hmo', 'nhis'].includes(formData.account_type);
  const showCorporateFields = formData.account_type === 'corporate';

  return (
    <div className="space-y-6 py-4">
      {/* Personal Information */}
      <div>
        <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Personal Information</h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">First Name *</label>
            <Input 
              placeholder="First name" 
              value={formData.first_name}
              onChange={(e) => setFormData({...formData, first_name: e.target.value})}
              className={errors.first_name ? 'border-destructive' : ''}
            />
            {errors.first_name && <p className="text-xs text-destructive mt-1">{errors.first_name}</p>}
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Last Name *</label>
            <Input 
              placeholder="Last name" 
              value={formData.last_name}
              onChange={(e) => setFormData({...formData, last_name: e.target.value})}
              className={errors.last_name ? 'border-destructive' : ''}
            />
            {errors.last_name && <p className="text-xs text-destructive mt-1">{errors.last_name}</p>}
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Date of Birth *</label>
            <Input 
              type="date" 
              value={formData.date_of_birth}
              onChange={(e) => setFormData({...formData, date_of_birth: e.target.value})}
              className={errors.date_of_birth ? 'border-destructive' : ''}
            />
            {errors.date_of_birth && <p className="text-xs text-destructive mt-1">{errors.date_of_birth}</p>}
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Gender *</label>
            <Select value={formData.gender} onValueChange={(v) => setFormData({...formData, gender: v as 'male' | 'female'})}>
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
            <label className="text-sm font-medium mb-1.5 block">Phone *</label>
            <Input 
              placeholder="Phone number" 
              value={formData.phone}
              onChange={(e) => setFormData({...formData, phone: e.target.value})}
              className={errors.phone ? 'border-destructive' : ''}
            />
            {errors.phone && <p className="text-xs text-destructive mt-1">{errors.phone}</p>}
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Blood Group</label>
            <Select value={formData.blood_group} onValueChange={(v) => setFormData({...formData, blood_group: v})}>
              <SelectTrigger>
                <SelectValue placeholder="Select blood group" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="A+">A+</SelectItem>
                <SelectItem value="A-">A-</SelectItem>
                <SelectItem value="B+">B+</SelectItem>
                <SelectItem value="B-">B-</SelectItem>
                <SelectItem value="AB+">AB+</SelectItem>
                <SelectItem value="AB-">AB-</SelectItem>
                <SelectItem value="O+">O+</SelectItem>
                <SelectItem value="O-">O-</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-4">
          <label className="text-sm font-medium mb-1.5 block">Address *</label>
          <Input 
            placeholder="Full address" 
            value={formData.address}
            onChange={(e) => setFormData({...formData, address: e.target.value})}
            className={errors.address ? 'border-destructive' : ''}
          />
          {errors.address && <p className="text-xs text-destructive mt-1">{errors.address}</p>}
        </div>
        <div className="mt-4">
          <label className="text-sm font-medium mb-1.5 block">Emergency Contact *</label>
          <Input 
            placeholder="Emergency contact name and phone" 
            value={formData.emergency_contact}
            onChange={(e) => setFormData({...formData, emergency_contact: e.target.value})}
            className={errors.emergency_contact ? 'border-destructive' : ''}
          />
          {errors.emergency_contact && <p className="text-xs text-destructive mt-1">{errors.emergency_contact}</p>}
        </div>
      </div>

      {/* Account Type */}
      <div>
        <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Account Type</h4>
        <div className="grid grid-cols-3 gap-3">
          {(Object.entries(accountTypeConfig) as [AccountType, typeof accountTypeConfig[AccountType]][]).map(([type, config]) => (
            <button
              key={type}
              onClick={() => setFormData({...formData, account_type: type})}
              className={cn(
                "p-3 rounded-lg border text-left transition-all hover:scale-[1.02]",
                formData.account_type === type
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                  : "border-border hover:border-primary/50"
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                {config.icon}
                <span className="font-medium text-sm">{config.label}</span>
              </div>
              <p className="text-xs text-muted-foreground">{config.description}</p>
            </button>
          ))}
        </div>

        {/* Conditional Insurance Fields */}
        {showInsuranceFields && (
          <div className="grid grid-cols-2 gap-4 mt-4 p-4 rounded-lg bg-info/5 border border-info/20 animate-fade-in">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Insurance Provider</label>
              <Input 
                placeholder="Provider name" 
                value={formData.insurance_provider}
                onChange={(e) => setFormData({...formData, insurance_provider: e.target.value})}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Policy Number</label>
              <Input 
                placeholder="Policy number" 
                value={formData.insurance_policy_number}
                onChange={(e) => setFormData({...formData, insurance_policy_number: e.target.value})}
              />
            </div>
          </div>
        )}

        {/* Conditional Corporate Fields */}
        {showCorporateFields && (
          <CorporateSelector
            value={formData.corporate_id}
            onChange={(v) => setFormData({...formData, corporate_id: v})}
          />
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

function CorporateSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [accounts, setAccounts] = useState<{ id: string; company_name: string; status: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAccounts = async () => {
      const { data, error } = await supabase
        .from('corporate_accounts')
        .select('id, company_name, status')
        .eq('status', 'active')
        .order('company_name');
      if (!error && data) setAccounts(data);
      setLoading(false);
    };
    fetchAccounts();
  }, []);

  return (
    <div className="mt-4 p-4 rounded-lg bg-primary/5 border border-primary/20 animate-fade-in">
      <label className="text-sm font-medium mb-1.5 block">
        <Building2 className="h-4 w-4 inline mr-1" />
        Corporate Account *
      </label>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading companies...</p>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active corporate accounts. Create one in the Accounts module first.</p>
      ) : (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select company" />
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
