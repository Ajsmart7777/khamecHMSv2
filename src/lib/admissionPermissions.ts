import { useAuth, type AppRole } from '@/contexts/AuthContext';

/**
 * Single source of truth (client mirror) for who may act on an admission.
 * The database RPCs enforce the same lists — this only drives UI affordances.
 */
export const ADMISSION_PERMS = {
  /** Snap to Admit — create an admission request */
  admit: ['nurse', 'doctor', 'doctor1', 'doctor2', 'admin'],
  /** Awaiting Room — assign ward / room / bed */
  assignBed: ['nurse', 'admin'],
  /** Forward an admitted patient's snap to Pharmacy / Lab (creates billing) */
  forwardSnap: ['nurse', 'doctor', 'doctor1', 'doctor2', 'admin'],
  /** Create a new admitted snap (deducts from patient balance) */
  admittedSnap: ['nurse', 'doctor', 'doctor1', 'doctor2', 'admin'],
  /** Sign a discharge order */
  dischargeOrder: ['doctor', 'doctor1', 'doctor2', 'admin'],
  /** Complete the discharge (bills bed-days, settles debt) */
  discharge: ['nurse', 'doctor', 'doctor1', 'doctor2', 'billing', 'accountant', 'admin'],
  /** Waive outstanding debt at discharge */
  waiveDebt: ['accountant', 'admin'],
} satisfies Record<string, AppRole[]>;

export type AdmissionAction = keyof typeof ADMISSION_PERMS;

export function roleCan(role: AppRole | null | undefined, action: AdmissionAction) {
  return !!role && (ADMISSION_PERMS[action] as readonly string[]).includes(role);
}

/** Hook form: `const can = useAdmissionPerms(); can('discharge')` */
export function useAdmissionPerms() {
  const { role } = useAuth();
  return (action: AdmissionAction) => roleCan(role, action);
}
