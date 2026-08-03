// Khadija Medical Center HMS Types

export type UserRole = 
  | 'reception' 
  | 'nurse' 
  | 'doctor1'
  | 'doctor2'
  | 'lab' 
  | 'billing' 
  | 'pharmacy' 
  | 'account' 
  | 'auditing' 
  | 'admin';

export type PatientStatus = 
  | 'registered'
  | 'waiting'
  | 'with_nurse'
  | 'with_doctor'
  | 'in_lab'
  | 'awaiting_billing'
  | 'awaiting_payment'
  | 'at_pharmacy'
  | 'admitted'
  | 'discharged'
  | 'awaiting_room';

export type PaymentMethod = 'cash' | 'pos' | 'insurance' | 'corporate' | 'individual_balance';

export type PaymentStatus = 'pending' | 'partial' | 'completed' | 'refunded';

export type AccountType = 'normal' | 'corporate' | 'nhis' | 'hmo' | 'katchma' | 'retainer' | 'staff' | 'staff_family';

export interface Patient {
  id: string;
  cardNumber: string;
  miniCardNumber: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: 'male' | 'female';
  phone: string;
  address: string;
  emergencyContact: string;
  bloodGroup?: string;
  allergies?: string[];
  status: PatientStatus;
  accountType: AccountType;
  corporateId?: string;
  insuranceProvider?: string;
  insurancePolicyNumber?: string;
  balance: number;
  registeredAt: string;
  lastVisit?: string;
}

export interface Vitals {
  id: string;
  patientId: string;
  temperature: number;
  bloodPressure: string;
  pulse: number;
  respiratoryRate: number;
  weight: number;
  height: number;
  notes?: string;
  recordedBy: string;
  recordedAt: string;
}

export interface Prescription {
  id: string;
  patientId: string;
  doctorId: string;
  medications: MedicationItem[];
  diagnosis: string;
  notes?: string;
  status: 'pending' | 'billed' | 'dispensed';
  createdAt: string;
}

export interface MedicationItem {
  medicationId: string;
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
  quantity: number;
}

export interface LabTest {
  id: string;
  patientId: string;
  requestedBy: string;
  testType: string;
  status: 'pending' | 'in_progress' | 'completed';
  results?: string;
  performedBy?: string;
  completedAt?: string;
  createdAt: string;
}

export interface Invoice {
  id: string;
  patientId: string;
  items: InvoiceItem[];
  totalAmount: number;
  paidAmount: number;
  status: PaymentStatus;
  paymentMethod?: PaymentMethod;
  createdBy: string;
  createdAt: string;
  paidAt?: string;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}


export interface Staff {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: UserRole;
  department: string;
  salary: number;
  hireDate: string;
  status: 'active' | 'inactive' | 'on_leave';
  bankName?: string | null;
  accountNumber?: string | null;
  paymentMethod?: string;
  designation?: string | null;
  staffIdNumber?: string | null;
  isSystemUser?: boolean;
  familyDeductionConsent?: boolean;
  authUserId?: string | null;
}

export interface CorporateAccount {
  id: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  treatmentLimit: number;
  balance: number;
  status: 'active' | 'suspended';
  employees: string[]; // patient IDs
}

export interface ActivityLog {
  id: string;
  userId: string;
  userName: string;
  role: UserRole;
  action: string;
  module: string;
  details: string;
  timestamp: string;
}

export interface ModuleStats {
  module: string;
  patientsToday: number;
  pendingTasks: number;
  completedTasks: number;
  status: 'active' | 'busy' | 'idle';
}
