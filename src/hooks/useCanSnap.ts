import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Client-side mirror of `public.can_add_snap_for_patient`.
 * The database policy is the source of truth; this hook only drives UI affordances.
 */
export function useCanSnap(patientId: string | null | undefined) {
  const { user, role } = useAuth();
  const [allowed, setAllowed] = useState(false);
  const [reason, setReason] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!patientId || !user?.id) { setAllowed(false); setReason('Not signed in'); return; }
    setLoading(true);
    (async () => {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('can_add_snap_for_patient', {
        _patient_id: patientId,
        _user_id: user.id,
      });
      if (cancelled) return;
      if (rpcErr) { setAllowed(false); setReason(rpcErr.message); setLoading(false); return; }

      // For the tooltip: fetch status so we can explain who owns the patient now.
      const { data: p } = await supabase
        .from('patients').select('status').eq('id', patientId).single();
      if (cancelled) return;
      setAllowed(!!rpcRes);
      setReason(rpcRes
        ? ''
        : `Only the current owner (${labelForStatus((p as any)?.status)}) can add to this card. You are ${role ?? 'unauthenticated'}.`);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [patientId, user?.id, role]);

  return { allowed, reason, loading };
}

function labelForStatus(s?: string) {
  switch (s) {
    case 'with_nurse':  return 'nurse';
    case 'with_doctor': return 'doctor';
    case 'in_lab':      return 'lab';
    case 'at_pharmacy': return 'pharmacy';
    case 'admitted':    return 'ward nurse / doctor';
    default:            return `no station (status: ${s ?? 'unknown'})`;
  }
}