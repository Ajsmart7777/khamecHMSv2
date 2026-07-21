import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export interface StandingOrder {
  id: string;
  patient_id: string;
  external_doctor_id: string | null;
  external_doctor_name: string | null;
  photo_url: string;
  notes: string | null;
  status: 'pending_fulfillment' | 'transcribed' | 'fulfilled' | 'expired' | string;
  expiry_date: string | null;
  transcribed_prescription_id: string | null;
  captured_by: string | null;
  fulfilled_by: string | null;
  fulfilled_at: string | null;
  created_at: string;
  updated_at: string;
  // joined
  patient?: { first_name: string; last_name: string; card_number: string } | null;
  external_doctor?: { name: string; specialty: string | null } | null;
}

const BUCKET = 'standing-orders';

export function useStandingOrders(filterStatus?: string) {
  const [orders, setOrders] = useState<StandingOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('standing_orders')
      .select('*, patient:patients(first_name,last_name,card_number), external_doctor:external_doctors(name,specialty)')
      .order('created_at', { ascending: false });
    if (filterStatus) q = q.eq('status', filterStatus);
    const { data, error } = await q;
    if (error) {
      console.error('Standing orders fetch error', error);
      setOrders([]);
    } else {
      setOrders((data || []) as unknown as StandingOrder[]);
    }
    setLoading(false);
  }, [filterStatus]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  useEffect(() => {
    const channel = supabase
      .channel('standing_orders_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'standing_orders' }, () => fetchOrders())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchOrders]);

  const getSignedPhotoUrl = useCallback(async (path: string) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
    if (error) return null;
    return data.signedUrl;
  }, []);

  const uploadPhoto = async (file: Blob, patientId: string) => {
    const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const path = `${patientId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });
    if (error) {
      toast({ title: 'Upload failed', description: error.message, variant: 'destructive' });
      return null;
    }
    return path;
  };

  const createOrder = async (input: {
    patient_id: string;
    external_doctor_id: string | null;
    external_doctor_name?: string | null;
    photo: Blob;
    notes?: string | null;
    expiry_date?: string | null;
  }) => {
    const path = await uploadPhoto(input.photo, input.patient_id);
    if (!path) return null;
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('standing_orders')
      .insert({
        patient_id: input.patient_id,
        external_doctor_id: input.external_doctor_id,
        external_doctor_name: input.external_doctor_name || null,
        photo_url: path,
        notes: input.notes || null,
        expiry_date: input.expiry_date || null,
        status: 'pending_fulfillment',
        captured_by: userData.user?.id || null,
      })
      .select()
      .single();
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
      return null;
    }
    toast({ title: 'Standing order captured' });
    await fetchOrders();
    return data;
  };

  const updateOrderStatus = async (id: string, status: string, extra?: Partial<StandingOrder>) => {
    const patch: Record<string, unknown> = { status, ...(extra || {}) };
    if (status === 'fulfilled') {
      const { data: userData } = await supabase.auth.getUser();
      patch.fulfilled_by = userData.user?.id || null;
      patch.fulfilled_at = new Date().toISOString();
    }
    const { error } = await supabase.from('standing_orders').update(patch).eq('id', id);
    if (error) {
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
      return false;
    }
    await fetchOrders();
    return true;
  };

  return { orders, loading, refetch: fetchOrders, createOrder, updateOrderStatus, getSignedPhotoUrl };
}