import { useCallback, useEffect, useState } from 'react';
import { createRealtimeChannel, supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { getFileUrl } from '@/lib/storage';
import { toast } from 'sonner';

export type SnapOrderType = 'prescription' | 'lab' | 'treatment' | 'lab_result';
export type SnapTargetStation = 'pharmacy' | 'lab' | 'doctor' | 'nurse' | 'billing';
export type SnapStatus =
  | 'pending_billing' | 'awaiting_payment' | 'paid' | 'fulfilled' | 'rejected' | 'cancelled'
  | 'returned' | 'acknowledged';

export interface MatchedItem {
  pricelist_id: string;
  name: string;
  size: string | null;
  category: string;
  unit_price: number;
  qty: number;
  emergency_episode_item_id?: string;
  source_snap_id?: string | null;
  needs_pricelist_match?: boolean;
}

export interface SnapOrder {
  id: string;
  patient_id: string;
  visit_id: string | null;
  order_type: SnapOrderType;
  target_station: SnapTargetStation;
  source_role: string;
  photo_path: string;
  note: string | null;
  result_text: string | null;
  ocr_text: string | null;
  ocr_confidence: number | null;
  matched_items: MatchedItem[];
  status: SnapStatus;
  invoice_id: string | null;
  emergency_episode_id?: string | null;
  intent?: string | null;
  created_by: string | null;
  billed_by: string | null;
  billed_at: string | null;
  paid_at: string | null;
  fulfilled_by: string | null;
  fulfilled_at: string | null;
  rejection_reason: string | null;
  original_sender_role: string | null;
  parent_snap_id: string | null;
  returned_to: string | null;
  returned_at: string | null;
  ack_by: string | null;
  ack_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function createSnapOrder(input: {
  patientId: string;
  visitId: string | null;
  orderType: SnapOrderType;
  targetStation: SnapTargetStation;
  sourceRole: string;
  photoPath: string;
  note?: string;
}): Promise<SnapOrder | null> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  const { data, error } = await supabase
    .from('snap_orders')
    .insert({
      patient_id: input.patientId,
      visit_id: input.visitId,
      order_type: input.orderType,
      target_station: input.targetStation,
      source_role: input.sourceRole,
      photo_path: input.photoPath,
      note: input.note || null,
      created_by: uid,
      original_sender_role: input.sourceRole,
      status: 'pending_billing',
    })
    .select()
    .single();
  if (error) {
    const isRls = /row-level security|policy/i.test(error.message);
    toast.error(isRls
      ? 'Not allowed: this patient is not currently at your station.'
      : `Snap order failed: ${error.message}`);
    return null;
  }
  // Fire-and-forget OCR: the edge function updates ocr_* fields when done.
  const snap = data as unknown as SnapOrder;
  supabase.functions.invoke('snap-ocr', { body: { snap_id: snap.id } }).catch(() => {});
  return snap;
}

export function useSnapOrders(filter: {
  station?: SnapTargetStation;
  statuses?: SnapStatus[];
  patientId?: string;
} = {}) {
  const [orders, setOrders] = useState<SnapOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const statusKey = filter.statuses?.join(',') ?? '';

  const refresh = useCallback(async () => {
    setLoading(true);
    const statuses = statusKey ? statusKey.split(',') as SnapStatus[] : [];
    let q = supabase.from('snap_orders').select('*').order('created_at', { ascending: false });
    if (filter.station) q = q.eq('target_station', filter.station);
    if (statuses.length) q = q.in('status', statuses);
    if (filter.patientId) q = q.eq('patient_id', filter.patientId);
    const { data, error } = await q;
    setLoading(false);
    if (error) { toast.error('Failed to load snap orders'); return; }
    setOrders(((data ?? []) as unknown) as SnapOrder[]);
  }, [filter.station, statusKey, filter.patientId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const ch = createRealtimeChannel(`snap-orders-${filter.station ?? 'all'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'snap_orders' }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refresh, filter.station]);

  return { orders, loading, refresh };
}

export async function saveSnapMatchedItems(id: string, matched: MatchedItem[]) {
  const { error } = await supabase
    .from('snap_orders')
    .update({ matched_items: matched as unknown as Json })
    .eq('id', id);
  if (error) toast.error(error.message);
}

export async function attachInvoiceToSnap(id: string, invoiceId: string) {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  const { data, error } = await supabase
    .from('snap_orders')
    .update({ invoice_id: invoiceId, status: 'awaiting_payment', billed_by: uid, billed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending_billing')
    .is('invoice_id', null)
    .select('id')
    .maybeSingle();
  if (error) { toast.error(error.message); return false; }
  if (!data) {
    toast.error('This order has already been billed or is no longer waiting for Billing');
    return false;
  }
  return true;
}

export async function markSnapFulfilled(id: string) {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  const { error } = await supabase
    .from('snap_orders')
    .update({ status: 'fulfilled', fulfilled_by: uid, fulfilled_at: new Date().toISOString() })
    .eq('id', id);
  if (error) { toast.error(error.message); return false; }
  toast.success('Marked fulfilled');
  return true;
}

export async function rejectSnap(id: string, reason: string) {
  const { error } = await supabase
    .from('snap_orders')
    .update({ status: 'rejected', rejection_reason: reason })
    .eq('id', id);
  if (error) { toast.error(error.message); return false; }
  return true;
}

/** Readable URL for the snap photo (visit-cards bucket). */
export async function snapPhotoUrl(path: string, expiresIn = 3600): Promise<string | null> {
  return await getFileUrl('visit-cards', path, expiresIn);
}
