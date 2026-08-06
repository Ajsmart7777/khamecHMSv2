import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { PatientStatus, AccountType } from '@/types/hms';
import { logError, logInfo } from '@/lib/errorHandler';
import { patientAuditLogger } from '@/lib/auditLogger';
import { isPermissionError } from '@/lib/permissionError';
import { createNotification } from '@/hooks/useNotifications';

export interface Patient {
  id: string;
  card_number: string;
  mini_card_number: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: 'male' | 'female';
  phone: string;
  address: string;
  emergency_contact: string;
  blood_group?: string;
  allergies?: string[];
  status: PatientStatus;
  account_type: AccountType;
  corporate_id?: string;
  insurance_provider?: string;
  insurance_policy_number?: string;
  insurance_plan?: string;
  staff_link_id?: string | null;
  occupation?: string | null;
  assigned_doctor?: 'doctor1' | 'doctor2' | null;
  balance: number;
  photo_path?: string | null;
  registered_at: string;
  last_visit?: string;
  updated_at: string;
  created_at: string;
}

interface PatientContextType {
  patients: Patient[];
  loading: boolean;
  error: string | null;
  refreshPatients: () => Promise<void>;
  addPatient: (patient: Omit<Patient, 'id' | 'registered_at' | 'updated_at' | 'created_at'>) => Promise<Patient | null>;
  deletePatient: (patientId: string) => Promise<boolean>;
  updatePatientStatus: (patientId: string, status: PatientStatus, opts?: { guardInpatient?: boolean }) => Promise<boolean>;
  updatePatient: (patientId: string, updates: Partial<Patient>) => Promise<boolean>;
  getPatientsByStatus: (statuses: PatientStatus[]) => Patient[];
  getPatientById: (id: string) => Patient | undefined;
}

const PatientContext = createContext<PatientContextType | undefined>(undefined);

export function PatientProvider({ children }: { children: React.ReactNode }) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPatients = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('patients')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      
      // Type assertion since we know the structure matches
      setPatients((data || []) as unknown as Patient[]);
      setError(null);
    } catch (err) {
      logError('Error fetching patients', err);
      setError('Failed to fetch patients');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshPatients = useCallback(async () => {
    await fetchPatients();
  }, [fetchPatients]);

  const addPatient = useCallback(async (patientData: Omit<Patient, 'id' | 'registered_at' | 'updated_at' | 'created_at'>): Promise<Patient | null> => {
    try {
      const { data, error: insertError } = await supabase
        .from('patients')
        .insert([patientData])
        .select()
        .single();

      if (insertError) throw insertError;
      
      // Log successful patient registration
      if (data) {
        const p = data as unknown as Patient;
        patientAuditLogger('patient_registered', p.id, {
          card_number: patientData.card_number,
          name: `${patientData.first_name} ${patientData.last_name}`,
        });

        createNotification({
          title: 'New Patient Registered',
          message: `${patientData.first_name} ${patientData.last_name} (${patientData.card_number})`,
          type: 'patient',
          target_role: 'all',
          link: '/reception',
          resource_id: p.id,
        });
      }
      
      toast.success('Patient registered successfully', {
        description: `${patientData.first_name} ${patientData.last_name} has been added.`
      });
      
      return data as unknown as Patient;
    } catch (err) {
      logError('Error adding patient', err);
      patientAuditLogger('patient_registered', 'unknown', { error: String(err) }, 'failure');
      toast.error('Failed to register patient');
      return null;
    }
  }, []);

  const updatePatientStatus = useCallback(async (
    patientId: string,
    status: PatientStatus,
    opts?: { guardInpatient?: boolean }
  ): Promise<boolean> => {
    try {
      // Read fresh row to guard against stale local cache
      const { data: current, error: readErr } = await supabase
        .from('patients')
        .select('id, status, first_name, last_name, assigned_doctor')
        .eq('id', patientId)
        .single();
      if (readErr || !current) {
        throw readErr || new Error('Patient not found');
      }

      // Inpatient guard: refuse discharge if currently admitted
      if (opts?.guardInpatient && status === 'discharged' && current.status === 'admitted') {
        toast.info('Patient is admitted — discharge must be done from the ward.');
        return false;
      }

      // No-op if already in target state
      if (current.status === status) {
        return true;
      }

      // Inpatient location guard — an admitted patient physically stays in the
      // ward. Station work (lab, pharmacy, billing, doctor review) happens via
      // snaps/orders, so those station statuses must NOT overwrite 'admitted'.
      const inpatientSafeStatuses = ['admitted', 'ready_for_discharge', 'discharged', 'awaiting_room'];
      if (!inpatientSafeStatuses.includes(status)) {
        const { data: activeAdmission } = await supabase
          .from('admissions')
          .select('id, status')
          .eq('patient_id', patientId)
          .in('status', ['active', 'ready_for_discharge', 'waiting_assignment'])
          .maybeSingle();
        if (activeAdmission) {
          // Keep the ward as the source of truth for location.
          return true;
        }
      }


      // Route through the workflow engine (Phase 1). advance_journey
      // mirrors the value into patients.status for backward compatibility.
      // There is no generic "doctor" role any more — work is owned by the
      // patient's assigned doctor workspace (doctor1 / doctor2).
      const doctorRole =
        current.assigned_doctor === 'doctor2' ? 'doctor2' : 'doctor1';
      const ownerRoleMap: Record<string, string> = {
        with_nurse: 'nurse',
        awaiting_room: 'nurse',
        with_doctor: doctorRole,
        in_lab: 'lab_tech',
        lab_results_ready: doctorRole,
        awaiting_billing: 'billing',
        awaiting_payment: 'cashier',
        at_pharmacy: 'pharmacist',
        admitted: 'nurse',
        discharged: 'reception',
      };
      const { error: rpcError } = await supabase.rpc('advance_journey', {
        _patient_id: patientId,
        _to_state: status,
        _owner_role: ownerRoleMap[status] ?? null,
      });
      if (rpcError) throw rpcError;
      // Touch last_visit for the header/timeline (non-fatal if it fails).
      const { error: lvErr } = await supabase
        .from('patients')
        .update({ last_visit: new Date().toISOString() })
        .eq('id', patientId);
      if (lvErr) logError('Failed to update last_visit', lvErr);

      // Log status change
      patientAuditLogger('patient_status_changed', patientId, { from: current.status, new_status: status });

      // Create notifications for key transitions
      const patientName = `${current.first_name} ${current.last_name}`;

      const notifMap: Record<string, { title: string; message: string; type: string; target_role: string; link: string }> = {
        with_nurse: { title: 'Patient Sent to Nurse', message: `${patientName} is ready for vitals`, type: 'patient', target_role: 'nurse', link: '/nurse-station' },
        with_doctor: { title: 'Patient Ready for Doctor', message: `${patientName} is waiting for consultation`, type: 'patient', target_role: doctorRole, link: '/doctor' },
        in_lab: { title: 'Lab Test Requested', message: `${patientName} needs lab work`, type: 'lab', target_role: 'lab_tech', link: '/laboratory' },
        lab_results_ready: { title: 'Lab Results Ready', message: `Results for ${patientName} are available`, type: 'lab', target_role: doctorRole, link: '/doctor' },
        awaiting_billing: { title: 'Patient Awaiting Billing', message: `${patientName} needs billing`, type: 'billing', target_role: 'billing', link: '/billing' },
        at_pharmacy: { title: 'Patient at Pharmacy', message: `${patientName} has medication to collect`, type: 'pharmacy', target_role: 'pharmacist', link: '/pharmacy' },
        discharged: { title: 'Patient Discharged', message: `${patientName} has been discharged`, type: 'success', target_role: 'all', link: '/reception' },
      };

      const notif = notifMap[status];
      if (notif) {
        createNotification({
          title: notif.title,
          message: notif.message,
          type: notif.type,
          target_role: notif.target_role,
          link: notif.link,
          resource_id: patientId,
        });
      }

      // Optimistic local update so acting user sees change instantly
      setPatients(prev => prev.map(p => p.id === patientId ? { ...p, status } : p));

      return true;
    } catch (err) {
      logError('Error updating patient status', err);
      patientAuditLogger('patient_status_changed', patientId, { error: String(err) }, 'failure');
      toast.error(`Failed to update status → ${status}`, { description: String((err as Error)?.message ?? err) });
      return false;
    }
  }, []);

  const deletePatient = useCallback(async (patientId: string): Promise<boolean> => {
    try {
      const { error: deleteError } = await supabase
        .from('patients')
        .delete()
        .eq('id', patientId);

      if (deleteError) throw deleteError;
      
      patientAuditLogger('patient_deleted', patientId, { timestamp: new Date().toISOString() });
      
      toast.success('Patient deleted successfully');
      return true;
    } catch (err) {
      logError('Error deleting patient', err);
      patientAuditLogger('patient_deleted', patientId, { error: String(err) }, 'failure');
      const message = String((err as Error)?.message ?? err);
      if (isPermissionError(err as { code?: string; message?: string })) {
        toast.error('Not permitted', {
          description: 'You do not have permission to delete patients.',
        });
      } else {
        toast.error('Failed to delete patient', { description: message });
      }
      return false;
    }
  }, []);

  const updatePatient = useCallback(async (patientId: string, updates: Partial<Patient>): Promise<boolean> => {
    try {
      const { error: updateError } = await supabase
        .from('patients')
        .update(updates)
        .eq('id', patientId);

      if (updateError) throw updateError;
      
      // Log patient update
      patientAuditLogger('patient_updated', patientId, { updated_fields: Object.keys(updates) });
      
      return true;
    } catch (err) {
      logError('Error updating patient', err);
      patientAuditLogger('patient_updated', patientId, { error: String(err) }, 'failure');
      const message = String((err as Error)?.message ?? err);
      if (isPermissionError(err as { code?: string; message?: string })) {
        toast.error('Not permitted', {
          description: message.replace(/^NOT_PERMITTED:\s*/, ''),
        });
      } else {
        toast.error('Failed to update patient', { description: message });
      }
      return false;
    }
  }, []);

  const getPatientsByStatus = useCallback((statuses: PatientStatus[]): Patient[] => {
    return patients.filter(p => statuses.includes(p.status));
  }, [patients]);

  const getPatientById = useCallback((id: string): Patient | undefined => {
    return patients.find(p => p.id === id);
  }, [patients]);

  // Re-fetch when auth state changes (e.g., after login)
  useEffect(() => {
    fetchPatients();
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        fetchPatients();
      } else if (event === 'SIGNED_OUT') {
        setPatients([]);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [fetchPatients]);

  // Track the authenticated user so the realtime channel is only opened (and
  // re-opened) with a valid token. A channel subscribed while signed out is
  // evaluated as `anon` by RLS and silently receives no rows.
  const [realtimeUserId, setRealtimeUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setRealtimeUserId(data.session?.user?.id ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setRealtimeUserId(session?.user?.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Refetch whenever the tab regains focus — safety net if a realtime event is missed.
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') fetchPatients(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [fetchPatients]);

  // Real-time subscription
  useEffect(() => {
    if (!realtimeUserId) return;
    const channel = supabase
      .channel(`patients-realtime-${realtimeUserId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'patients'
        },
        (payload) => {
          logInfo('Realtime patient update', payload);
          
          if (payload.eventType === 'INSERT') {
            const newPatient = payload.new as unknown as Patient;
            setPatients(prev => {
              // Prevent duplicate: check if already in state
              if (prev.some(p => p.id === newPatient.id)) return prev;
              return [newPatient, ...prev];
            });
            toast.info('New patient registered', {
              description: `${newPatient.first_name} ${newPatient.last_name}`
            });
          } else if (payload.eventType === 'UPDATE') {
            const updatedPatient = payload.new as unknown as Patient;
            setPatients(prev => 
              prev.map(p => p.id === updatedPatient.id ? { ...p, ...updatedPatient } : p)
            );
          } else if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { id: string }).id;
            setPatients(prev => prev.filter(p => p.id !== deletedId));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [realtimeUserId]);


  return (
    <PatientContext.Provider value={{
      patients,
      loading,
      error,
      refreshPatients,
      addPatient,
      deletePatient,
      updatePatientStatus,
      updatePatient,
      getPatientsByStatus,
      getPatientById
    }}>
      {children}
    </PatientContext.Provider>
  );
}

export function usePatients() {
  const context = useContext(PatientContext);
  if (context === undefined) {
    throw new Error('usePatients must be used within a PatientProvider');
  }
  return context;
}
