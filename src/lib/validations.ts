import { z } from 'zod';

// Patient validation schema
export const patientSchema = z.object({
  first_name: z.string()
    .trim()
    .min(1, 'First name is required')
    .max(100, 'First name must be less than 100 characters')
    .regex(/^[a-zA-Z\s'-]+$/, 'First name can only contain letters, spaces, hyphens, and apostrophes'),
  
  last_name: z.string()
    .trim()
    .min(1, 'Last name is required')
    .max(100, 'Last name must be less than 100 characters')
    .regex(/^[a-zA-Z\s'-]+$/, 'Last name can only contain letters, spaces, hyphens, and apostrophes'),
  
  date_of_birth: z.string()
    .min(1, 'Date of birth is required')
    .refine((date) => {
      const dob = new Date(date);
      const now = new Date();
      return dob <= now;
    }, 'Date of birth cannot be in the future')
    .refine((date) => {
      const dob = new Date(date);
      const minDate = new Date('1900-01-01');
      return dob >= minDate;
    }, 'Invalid date of birth'),
  
  gender: z.enum(['male', 'female'], {
    required_error: 'Gender is required',
    invalid_type_error: 'Invalid gender selection',
  }),
  
  phone: z.string()
    .trim()
    .min(1, 'Phone number is required')
    .regex(/^[\d\s+()-]{10,20}$/, 'Please enter a valid phone number'),
  
  address: z.string()
    .trim()
    .min(1, 'Address is required')
    .max(500, 'Address must be less than 500 characters'),
  
  emergency_contact: z.string()
    .trim()
    .min(1, 'Emergency contact is required')
    .max(200, 'Emergency contact must be less than 200 characters'),
  
  blood_group: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional().nullable(),
  
  account_type: z.enum(['normal', 'insurance', 'corporate', 'nhis', 'hmo', 'retainer'], {
    required_error: 'Account type is required',
  }),
  
  insurance_provider: z.string().max(200).optional().nullable(),
  insurance_policy_number: z.string().max(100).optional().nullable(),
  corporate_id: z.string().max(100).optional().nullable(),
});

// Payment validation schema
export const paymentSchema = z.object({
  amount: z.number()
    .positive('Amount must be greater than 0')
    .max(100000000, 'Amount is too large'),
  
  method: z.enum(['cash', 'pos', 'transfer', 'insurance'], {
    required_error: 'Payment method is required',
  }),
});

// Login validation schema
export const loginSchema = z.object({
  email: z.string()
    .trim()
    .min(1, 'Email is required')
    .email('Please enter a valid email address')
    .max(255, 'Email must be less than 255 characters'),
  
  password: z.string()
    .min(1, 'Password is required')
    .min(6, 'Password must be at least 6 characters'),
});

// Signup validation schema
export const signupSchema = loginSchema.extend({
  confirmPassword: z.string().min(1, 'Please confirm your password'),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

// Prescription item validation
export const prescriptionItemSchema = z.object({
  medication: z.string()
    .trim()
    .min(1, 'Medication name is required')
    .max(200, 'Medication name must be less than 200 characters'),
  
  dosage: z.string()
    .trim()
    .min(1, 'Dosage is required')
    .max(100, 'Dosage must be less than 100 characters'),
  
  frequency: z.string()
    .trim()
    .min(1, 'Frequency is required')
    .max(100, 'Frequency must be less than 100 characters'),
  
  duration: z.string()
    .trim()
    .min(1, 'Duration is required')
    .max(100, 'Duration must be less than 100 characters'),
  
  quantity: z.number()
    .int('Quantity must be a whole number')
    .positive('Quantity must be greater than 0')
    .max(9999, 'Quantity is too large'),
});

// Lab request validation
export const labRequestSchema = z.object({
  tests: z.array(z.string().min(1)).min(1, 'At least one test must be selected'),
  diagnosis: z.string().max(1000, 'Diagnosis must be less than 1000 characters').optional(),
});

// Type exports
export type PatientFormData = z.infer<typeof patientSchema>;
export type PaymentFormData = z.infer<typeof paymentSchema>;
export type LoginFormData = z.infer<typeof loginSchema>;
export type SignupFormData = z.infer<typeof signupSchema>;
export type PrescriptionItemFormData = z.infer<typeof prescriptionItemSchema>;
export type LabRequestFormData = z.infer<typeof labRequestSchema>;
