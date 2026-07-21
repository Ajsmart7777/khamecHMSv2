import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logError } from '@/lib/errorHandler';
import { prescriptionAuditLogger } from '@/lib/auditLogger';

export interface PrescriptionItem {
  id: string;
  prescription_id: string;
  medication: string;
  dosage: string;
  frequency: string;
  duration: string;
  quantity: number;
  dispensed: boolean;
  created_at: string;
}

export interface Prescription {
  id: string;
  patient_id: string;
  diagnosis: string | null;
  notes: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  items?: PrescriptionItem[];
}

export function usePrescriptions() {
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPrescriptions = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch prescriptions
      const { data: prescriptionData, error: prescriptionError } = await supabase
        .from('prescriptions')
        .select('*')
        .order('created_at', { ascending: false });

      if (prescriptionError) {
        logError('Error fetching prescriptions', prescriptionError);
        return;
      }

      // Fetch all prescription items
      const { data: itemsData, error: itemsError } = await supabase
        .from('prescription_items')
        .select('*');

      if (itemsError) {
        logError('Error fetching prescription items', itemsError);
        return;
      }

      // Combine prescriptions with their items
      const prescriptionsWithItems = (prescriptionData || []).map(prescription => ({
        ...prescription,
        items: (itemsData || []).filter(item => item.prescription_id === prescription.id)
      }));

      setPrescriptions(prescriptionsWithItems);
    } catch (error) {
      logError('Error in fetchPrescriptions', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrescriptions();

    // Set up real-time subscription
    const channel = supabase
      .channel('prescriptions-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'prescriptions' },
        () => fetchPrescriptions()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'prescription_items' },
        () => fetchPrescriptions()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchPrescriptions]);

  const createPrescription = async (
    patientId: string,
    diagnosis: string,
    items: Omit<PrescriptionItem, 'id' | 'prescription_id' | 'dispensed' | 'created_at'>[]
  ): Promise<Prescription | null> => {
    try {
      // Create prescription
      const { data: prescription, error: prescriptionError } = await supabase
        .from('prescriptions')
        .insert({
          patient_id: patientId,
          diagnosis: diagnosis || null,
          status: 'pending',
        })
        .select()
        .single();

      if (prescriptionError || !prescription) {
        logError('Error creating prescription', prescriptionError);
        return null;
      }

      // Create prescription items
      if (items.length > 0) {
        const itemsToInsert = items.map(item => ({
          prescription_id: prescription.id,
          medication: item.medication,
          dosage: item.dosage,
          frequency: item.frequency,
          duration: item.duration,
          quantity: item.quantity,
        }));

        const { error: itemsError } = await supabase
          .from('prescription_items')
          .insert(itemsToInsert);

        if (itemsError) {
          logError('Error creating prescription items', itemsError);
        }
      }

      // Log audit event
      await prescriptionAuditLogger(
        'prescription_created',
        prescription.id,
        { 
          patient_id: patientId, 
          diagnosis, 
          items_count: items.length,
          medications: items.map(i => i.medication)
        }
      );

      await fetchPrescriptions();
      return prescription;
    } catch (error) {
      logError('Error in createPrescription', error);
      return null;
    }
  };

  const updatePrescriptionStatus = async (id: string, status: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('prescriptions')
        .update({ status })
        .eq('id', id);

      if (error) {
        logError('Error updating prescription status', error);
        return false;
      }

      // Log audit event
      await prescriptionAuditLogger(
        'prescription_updated',
        id,
        { status, action: 'status_change' }
      );

      await fetchPrescriptions();
      return true;
    } catch (error) {
      logError('Error in updatePrescriptionStatus', error);
      return false;
    }
  };

  const markItemDispensed = async (itemId: string, dispensed: boolean = true): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('prescription_items')
        .update({ dispensed })
        .eq('id', itemId);

      if (error) {
        logError('Error marking item dispensed', error);
        return false;
      }

      // Log audit event for item dispense
      await prescriptionAuditLogger(
        'prescription_dispensed',
        itemId,
        { dispensed, resource_type: 'prescription_item' }
      );

      await fetchPrescriptions();
      return true;
    } catch (error) {
      logError('Error in markItemDispensed', error);
      return false;
    }
  };

  const getPrescriptionsForPatient = (patientId: string): Prescription[] => {
    return prescriptions.filter(p => p.patient_id === patientId);
  };

  const getPendingPrescriptions = (): Prescription[] => {
    return prescriptions.filter(p => p.status === 'pending');
  };

  return {
    prescriptions,
    loading,
    createPrescription,
    updatePrescriptionStatus,
    markItemDispensed,
    getPrescriptionsForPatient,
    getPendingPrescriptions,
    refreshPrescriptions: fetchPrescriptions,
  };
}
