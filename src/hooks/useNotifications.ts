import { useState, useEffect, useCallback } from 'react';
import { createRealtimeChannel, supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { logError } from '@/lib/errorHandler';

export interface Notification {
  id: string;
  user_id: string | null;
  target_role: string | null;
  title: string;
  message: string;
  type: string;
  link: string | null;
  resource_id: string | null;
  is_read: boolean;
  created_at: string;
}

export function useNotifications() {
  const { user, role } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      // Fetch notifications for this user or broadcast (user_id IS NULL)
      // Also filter by target_role if set
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      // Client-side filter: admin sees all; others see their role or broadcast (null)
      const filtered = (data || []).filter((n: any) => {
        if (role === 'admin') return true;
        if (n.target_role && n.target_role !== role) return false;
        return true;
      }) as Notification[];


      setNotifications(filtered);
    } catch (err) {
      logError('Error fetching notifications', err);
    } finally {
      setLoading(false);
    }
  }, [user, role]);

  const markAsRead = useCallback(async (notificationId: string) => {
    try {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId);
      
      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
      );
    } catch (err) {
      logError('Error marking notification as read', err);
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    if (!user) return;
    try {
      const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
      if (unreadIds.length === 0) return;

      await supabase
        .from('notifications')
        .update({ is_read: true })
        .in('id', unreadIds);

      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch (err) {
      logError('Error marking all as read', err);
    }
  }, [user, notifications]);

  // Initial fetch
  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;

    const channel = createRealtimeChannel('notifications-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          const newNotif = payload.new as Notification;
          // Client-side filter: admin sees all
          if (role !== 'admin' && newNotif.target_role && newNotif.target_role !== role) return;
          setNotifications(prev => {
            if (prev.some(n => n.id === newNotif.id)) return prev;
            return [newNotif, ...prev];
          });
        }
      );
    
    const subscribe = async () => {
      try {
        await channel.subscribe();
      } catch (err) {
        logError('Notifications subscribe error', err);
      }
    };
    
    const timeout = setTimeout(subscribe, 100);

    return () => {
      clearTimeout(timeout);
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [user, role]);

  return {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    refresh: fetchNotifications,
  };
}

// Helper to create a notification from anywhere in the app
export async function createNotification(params: {
  title: string;
  message: string;
  type?: string;
  link?: string;
  resource_id?: string;
  target_role?: string;
  user_id?: string;
}) {
  try {
    const { error } = await supabase
      .from('notifications')
      .insert([{
        title: params.title,
        message: params.message,
        type: params.type || 'info',
        link: params.link || null,
        resource_id: params.resource_id || null,
        // 'all' means broadcast; target_role is cast to app_role by RLS so
        // only valid roles (or NULL for broadcast) are allowed here.
        target_role:
          !params.target_role || params.target_role === 'all'
            ? null
            : params.target_role,
        user_id: params.user_id || null,
      }]);

    if (error) throw error;
  } catch (err) {
    logError('Error creating notification', err);
  }
}
