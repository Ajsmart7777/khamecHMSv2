import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type WardGender = 'male' | 'female' | 'any';
export type RoomClass = 'private' | 'semi_private' | 'general' | 'icu' | 'vip';
export type BedStatus = 'available' | 'occupied' | 'maintenance';

export interface Ward {
  id: string;
  name: string;
  ward_type: string;
  gender: WardGender;
  description: string | null;
  active: boolean;
  min_admission_deposit: number;
  created_at: string;
  updated_at: string;
}
export interface Room {
  id: string;
  ward_id: string;
  room_number: string;
  room_class: RoomClass;
  daily_rate: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}
export interface Bed {
  id: string;
  room_id: string;
  bed_label: string;
  status: BedStatus;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export function useWardsRoomsBeds() {
  const [wards, setWards] = useState<Ward[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [w, r, b] = await Promise.all([
      supabase.from('wards').select('*').order('name'),
      supabase.from('rooms').select('*').order('room_number'),
      supabase.from('beds').select('*').order('bed_label'),
    ]);
    setLoading(false);
    if (w.error || r.error || b.error) {
      toast.error('Failed to load wards/rooms/beds');
      return;
    }
    setWards((w.data ?? []) as Ward[]);
    setRooms((r.data ?? []) as Room[]);
    setBeds((b.data ?? []) as Bed[]);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const ch = supabase
      .channel('wards-rooms-beds')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wards' }, () => refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'beds' }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refresh]);

  const saveWard = async (w: Partial<Ward> & { name: string }) => {
    const payload: any = {
      name: w.name.trim(),
      ward_type: w.ward_type ?? 'general',
      gender: w.gender ?? 'any',
      description: w.description ?? null,
      active: w.active ?? true,
    };
    const { error } = w.id
      ? await supabase.from('wards').update(payload).eq('id', w.id)
      : await supabase.from('wards').insert(payload);
    if (error) { toast.error(error.message); return false; }
    toast.success(w.id ? 'Ward updated' : 'Ward added');
    return true;
  };

  const deleteWard = async (id: string) => {
    const { error } = await supabase.from('wards').delete().eq('id', id);
    if (error) { toast.error(error.message); return false; }
    toast.success('Ward removed'); return true;
  };

  const saveRoom = async (r: Partial<Room> & { ward_id: string; room_number: string }) => {
    const payload: any = {
      ward_id: r.ward_id,
      room_number: r.room_number.trim(),
      room_class: r.room_class ?? 'general',
      daily_rate: r.daily_rate ?? 0,
      active: r.active ?? true,
    };
    if (r.id) {
      const { error } = await supabase.from('rooms').update(payload).eq('id', r.id);
      if (error) { toast.error(error.message); return false; }
      toast.success('Room updated');
      return true;
    }
    const { data, error } = await supabase.from('rooms').insert(payload).select('id').single();
    if (error) { toast.error(error.message); return false; }
    // Every room holds exactly one bed — create it automatically so nurses
    // never have to pick a bed when assigning a room.
    const { error: bedErr } = await supabase
      .from('beds')
      .insert({ room_id: data.id, bed_label: '1', status: 'available', active: true });
    if (bedErr) { toast.error(bedErr.message); return false; }
    toast.success('Room added');
    return true;
  };

  const deleteRoom = async (id: string) => {
    const { error } = await supabase.from('rooms').delete().eq('id', id);
    if (error) { toast.error(error.message); return false; }
    toast.success('Room removed'); return true;
  };

  const saveBed = async (b: Partial<Bed> & { room_id: string; bed_label: string }) => {
    const payload: any = {
      room_id: b.room_id,
      bed_label: b.bed_label.trim(),
      status: b.status ?? 'available',
      active: b.active ?? true,
    };
    const { error } = b.id
      ? await supabase.from('beds').update(payload).eq('id', b.id)
      : await supabase.from('beds').insert(payload);
    if (error) { toast.error(error.message); return false; }
    toast.success(b.id ? 'Bed updated' : 'Bed added');
    return true;
  };

  const deleteBed = async (id: string) => {
    const { error } = await supabase.from('beds').delete().eq('id', id);
    if (error) { toast.error(error.message); return false; }
    toast.success('Bed removed'); return true;
  };

  /** Set the daily rate for every room inside wards of a given type (normal | vip). */
  const setRateForWardType = async (wardType: string, rate: number) => {
    const wardIds = wards.filter((w) => w.ward_type === wardType).map((w) => w.id);
    if (wardIds.length === 0) { toast.error('No wards of this type'); return false; }
    const { error } = await supabase
      .from('rooms')
      .update({ daily_rate: rate })
      .in('ward_id', wardIds);
    if (error) { toast.error(error.message); return false; }
    toast.success(`Rate updated to ₦${rate.toLocaleString()}/day`);
    await refresh();
    return true;
  };

  return { wards, rooms, beds, loading, refresh, saveWard, deleteWard, saveRoom, deleteRoom, saveBed, deleteBed, setRateForWardType };
}

