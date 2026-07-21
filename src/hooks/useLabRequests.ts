import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logError, logInfo } from '@/lib/errorHandler';
import { labRequestAuditLogger } from '@/lib/auditLogger';

export interface LabRequest {
  id: string;
  patient_id: string;
  request_number: string;
  tests: string[];
  diagnosis: string | null;
  status: 'pending' | 'in_progress' | 'completed';
  requested_by: string;
  requested_at: string;
  completed_at: string | null;
  printed: boolean;
  results: unknown;
  created_at: string;
  updated_at: string;
}

interface UseLabRequestsReturn {
  labRequests: LabRequest[];
  loading: boolean;
  error: string | null;
  createLabRequest: (data: {
    patient_id: string;
    request_number: string;
    tests: string[];
    diagnosis?: string;
  }) => Promise<LabRequest | null>;
  updateLabRequest: (id: string, updates: Partial<LabRequest>) => Promise<boolean>;
  markAsPrinted: (id: string) => Promise<boolean>;
  getUnprintedRequests: () => LabRequest[];
  getPendingRequests: () => LabRequest[];
  refreshLabRequests: () => Promise<void>;
}

export function useLabRequests(): UseLabRequestsReturn {
  const [labRequests, setLabRequests] = useState<LabRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLabRequests = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('lab_requests')
        .select('*')
        .order('requested_at', { ascending: false });

      if (fetchError) throw fetchError;
      setLabRequests((data as LabRequest[]) || []);
      setError(null);
    } catch (err) {
      logError('Error fetching lab requests', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch lab requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLabRequests();

    // Set up real-time subscription
    const channel = supabase
      .channel('lab_requests_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'lab_requests',
        },
        (payload) => {
          logInfo('Lab request change', payload);
          if (payload.eventType === 'INSERT') {
            setLabRequests((prev) => [payload.new as LabRequest, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setLabRequests((prev) =>
              prev.map((req) =>
                req.id === payload.new.id ? (payload.new as LabRequest) : req
              )
            );
          } else if (payload.eventType === 'DELETE') {
            setLabRequests((prev) =>
              prev.filter((req) => req.id !== payload.old.id)
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchLabRequests]);

  const createLabRequest = async (data: {
    patient_id: string;
    request_number: string;
    tests: string[];
    diagnosis?: string;
  }): Promise<LabRequest | null> => {
    try {
      const { data: newRequest, error: insertError } = await supabase
        .from('lab_requests')
        .insert({
          patient_id: data.patient_id,
          request_number: data.request_number,
          tests: data.tests,
          diagnosis: data.diagnosis || null,
          status: 'pending',
          printed: false,
        })
        .select()
        .single();

      if (insertError) throw insertError;
      
      // Log audit event
      await labRequestAuditLogger(
        'lab_request_created',
        newRequest.id,
        { 
          patient_id: data.patient_id, 
          tests: data.tests, 
          request_number: data.request_number 
        }
      );
      
      return newRequest as LabRequest;
    } catch (err) {
      logError('Error creating lab request', err);
      toast.error('Failed to create lab request');
      return null;
    }
  };

  const updateLabRequest = async (
    id: string,
    updates: Record<string, unknown>
  ): Promise<boolean> => {
    try {
      const { error: updateError } = await supabase
        .from('lab_requests')
        .update(updates as never)
        .eq('id', id);

      if (updateError) throw updateError;
      
      // Log audit event for updates
      await labRequestAuditLogger(
        'lab_request_updated',
        id,
        { updates: JSON.parse(JSON.stringify(updates)) }
      );
      
      return true;
    } catch (err) {
      logError('Error updating lab request', err);
      toast.error('Failed to update lab request');
      return false;
    }
  };

  const markAsPrinted = async (id: string): Promise<boolean> => {
    return updateLabRequest(id, { printed: true });
  };

  const getUnprintedRequests = (): LabRequest[] => {
    return labRequests.filter((req) => !req.printed);
  };

  const getPendingRequests = (): LabRequest[] => {
    return labRequests.filter((req) => req.status === 'pending');
  };

  return {
    labRequests,
    loading,
    error,
    createLabRequest,
    updateLabRequest,
    markAsPrinted,
    getUnprintedRequests,
    getPendingRequests,
    refreshLabRequests: fetchLabRequests,
  };
}
