import { useState, useEffect, useCallback } from 'react';
import { createRealtimeChannel, supabase } from '@/integrations/supabase/client';
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
      // Fetch prescriptions and items in parallel (previously serial: 2 round trips)
      const [prescriptionRes, itemsRes] = await Promise.all([
        supabase.from('prescriptions').select('*').order('created_at', { ascending: false }),
        supabase.from('prescription_items').select('*'),
      ]);

      if (prescriptionRes.error) {
        logError('Error fetching prescriptions', prescriptionRes.error);
        return;
      }

      if (itemsRes.error) {
        logError('Error fetching prescription items', itemsRes.error);
        return;
      }

      // Group items by prescription in one pass (was an O(n²) filter per prescription)
      const itemsByPrescription = new Map<string, PrescriptionItem[]>();
      for (const item of (itemsRes.data || []) as PrescriptionItem[]) {
        const list = itemsByPrescription.get(item.prescription_id);
        if (list) list.push(item);
        else itemsByPrescription.set(item.prescription_id, [item]);
      }

      const prescriptionsWithItems = (prescriptionRes.data || []).map(prescription => ({
        ...prescription,
        items: itemsByPrescription.get(prescription.id) ?? []
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
    const channel = createRealtimeChannel('prescriptions-changes')
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

      // Optimistic update instead of a full blocking refetch
      setPrescriptions(prev =>
        prev.map(p => (p.id === id ? { ...p, status } : p))
      );
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

      // Optimistic update instead of a full blocking refetch
      setPrescriptions(prev =>
        prev.map(p => ({
          ...p,
          items: p.items?.map(item =>
            item.id === itemId ? { ...item, dispensed } : item
          )
        }))
      );
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
    return prescriptions.filter(p => {
      if (p.status !== 'pending') return false;
      // Exclude prescriptions where ALL items are already dispensed
      // (e.g. dispensed via the snap/PharmacySnapQueue path without
      // updating the prescription status field).
      if (p.items && p.items.length > 0 && p.items.every(item => item.dispensed)) return false;
      return true;
    });
  };

  return {
    prescriptions,
    loading,
    updatePrescriptionStatus,
    markItemDispensed,
    getPrescriptionsForPatient,
    getPendingPrescriptions,
    refreshPrescriptions: fetchPrescriptions,
  };
}
