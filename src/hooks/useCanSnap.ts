import { useEffect, useState } from 'react';
import { createRealtimeChannel, supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Client-side mirror of `public.can_add_snap_for_patient`.
 * The database policy is the source of truth; this hook only drives UI affordances.
 */
export function useCanSnap(patientId: string | null | undefined) {
  const { user, role } = useAuth();
  const [allowed, setAllowed] = useState(true);
  const [reason, setReason] = useState<string>('');
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!patientId || !user?.id) { 
      setAllowed(false); 
      setReason('Not signed in'); 
      return; 
    }

    const check = async () => {
      setLoading(true);
      const logs: string[] = [`[${new Date().toISOString()}] Checking perms for patient ${patientId}`];
      
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('can_add_snap_for_patient', {
        _patient_id: patientId,
        _user_id: user.id,
      });

      logs.push(`RPC Result: ${JSON.stringify(rpcRes)}`);
      if (rpcErr) logs.push(`RPC Error: ${rpcErr.message}`);

      // Special check: if a lab result is ready for this user, they are allowed to act
      const { data: hasLabResult } = await supabase
        .from('snap_orders')
        .select('id')
        .eq('patient_id', patientId)
        .eq('order_type', 'lab_result')
        .eq('status', 'returned')
        .eq('returned_to', user.id)
        .maybeSingle();

      logs.push(`Has Lab Result check: ${!!hasLabResult}`);
      if (cancelled) return;
      
      if (rpcErr) { 
        setAllowed(false); 
        setReason(rpcErr.message); 
        setLoading(false); 
        return; 
      }

      const isAllowed = !!rpcRes || !!hasLabResult;
      
      const { data: p } = await supabase
        .from('patients')
        .select('status, assigned_doctor')
        .eq('id', patientId)
        .single();
      
      const status = (p as any)?.status;
      const roleLabel = role ?? 'unauthenticated';
      const isClinicalRole = ['nurse', 'doctor1', 'doctor2'].includes(roleLabel);
      
      // Clinical roles can always add snaps if status is awaiting_billing or admitted
      // This allows adding additional items after the first one is sent to billing.
      const finalAllowed = isAllowed || (isClinicalRole && (status === 'awaiting_billing' || status === 'admitted' || status === 'with_nurse' || status === 'with_doctor' || status === 'waiting'));
      
      setAllowed(finalAllowed);
      setDebugLog(logs);
      
      if (!finalAllowed) {
        const { data: p } = await supabase
          .from('patients')
          .select('status, assigned_doctor')
          .eq('id', patientId)
          .single();
        
        const status = (p as any)?.status;
        const assigned = (p as any)?.assigned_doctor;
        const roleLabel = role ?? 'unauthenticated';
        
        let msg = `Only the current owner can add to this card. You are ${roleLabel}.`;
        if (status === 'with_doctor' && assigned && assigned !== role) {
          msg = `This patient is assigned to ${assigned === 'doctor1' ? 'Doctor 1' : 'Doctor 2'}. You are logged in as ${roleLabel}.`;
        }
        
        setReason(msg);
        logs.push(`Reason: ${msg}`);
      } else {
        setReason('');
      }
      
      setLoading(false);
    };

    check();

    const channel = createRealtimeChannel(`snap-perms-${patientId}`)
      .on(
        'postgres_changes',
        { 
          event: 'UPDATE', 
          schema: 'public', 
          table: 'patients', 
          filter: `id=eq.${patientId}` 
        },
        () => check()
      )
      .subscribe();

    return () => { 
      cancelled = true; 
      supabase.removeChannel(channel);
    };
  }, [patientId, user?.id, role]);

  return { allowed, reason, loading, debugLog };
}

function labelForStatus(s?: string) {
  switch (s) {
    case 'waiting':     return 'nurse (waiting)';
    case 'with_nurse':  return 'nurse';
    case 'with_doctor': return 'assigned doctor';
    case 'in_lab':      return 'lab';
    case 'at_pharmacy': return 'pharmacy';
    case 'admitted':    return 'ward nurse / doctor';
    default:            return `no station (status: ${s ?? 'unknown'})`;
  }
}