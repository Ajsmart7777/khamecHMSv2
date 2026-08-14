import { useCallback, useEffect, useRef, useState } from 'react';
import { createRealtimeChannel, supabase } from '@/integrations/supabase/client';
import { useAuth, AppRole } from '@/contexts/AuthContext';
import type { PatientStatus } from '@/types/hms';

export interface StationAlert {
  id: string;
  title: string;
  message: string;
  link?: string | null;
  at: string;
}

/** Which patient status means "the patient just arrived at my station". */
const roleIncomingStatus: Partial<Record<AppRole, PatientStatus[]>> = {
  nurse: ['with_nurse', 'awaiting_room'],
  doctor1: ['with_doctor'],
  doctor2: ['with_doctor'],
  lab_tech: ['in_lab'],
  pharmacist: ['at_pharmacy'],
  billing: ['awaiting_billing'],
  cashier: ['awaiting_payment'],
  receptionist: ['registered'],
};

/** Which snap target_station belongs to my role. */
const roleStation: Partial<Record<AppRole, string[]>> = {
  nurse: ['nurse'],
  doctor1: ['doctor'],
  doctor2: ['doctor'],
  lab_tech: ['lab'],
  pharmacist: ['pharmacy'],
  billing: ['billing'],
  cashier: ['billing'],
};

/* ------------------------------------------------------------------ */
/* Sound                                                               */
/* ------------------------------------------------------------------ */

let audioCtx: AudioContext | null = null;
let unlocked = false;

function ensureCtx() {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

/** Unlock audio on the first user gesture so alerts can play later. */
export function primeAlertAudio() {
  if (unlocked) return;
  const ctx = ensureCtx();
  if (!ctx) return;
  unlocked = true;
}

function chime() {
  const ctx = ensureCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  [0, 0.22, 0.44].forEach((offset, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(i === 2 ? 1320 : 880, now + offset);
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.35, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.2);
  });
}

function vibrate() {
  try {
    navigator.vibrate?.([200, 100, 200, 100, 400]);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

export function useStationAlerts() {
  const { user, role } = useAuth();
  const [alerts, setAlerts] = useState<StationAlert[]>([]);
  const alertsRef = useRef<StationAlert[]>([]);
  const repeatTimer = useRef<number | null>(null);
  const titleTimer = useRef<number | null>(null);
  const baseTitle = useRef<string>(typeof document !== 'undefined' ? document.title : '');

  alertsRef.current = alerts;

  const dismiss = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const dismissAll = useCallback(() => setAlerts([]), []);

  const push = useCallback((alert: StationAlert) => {
    setAlerts((prev) => (prev.some((a) => a.id === alert.id) ? prev : [alert, ...prev].slice(0, 20)));
    chime();
    vibrate();
    // Desktop / mobile OS notification when the tab is not focused.
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        const n = new Notification(alert.title, { body: alert.message, tag: alert.id, requireInteraction: true });
        n.onclick = () => {
          window.focus();
          if (alert.link) window.location.href = alert.link;
          n.close();
        };
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Ask for OS notification permission once.
  useEffect(() => {
    if (!user) return;
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, [user]);

  // Unlock audio on first interaction.
  useEffect(() => {
    const handler = () => primeAlertAudio();
    window.addEventListener('pointerdown', handler, { once: true });
    window.addEventListener('keydown', handler, { once: true });
    return () => {
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('keydown', handler);
    };
  }, []);

  // Keep re-alerting every 8s while something is unacknowledged.
  useEffect(() => {
    if (alerts.length === 0) {
      if (repeatTimer.current) window.clearInterval(repeatTimer.current);
      repeatTimer.current = null;
      return;
    }
    repeatTimer.current = window.setInterval(() => {
      chime();
      vibrate();
    }, 8000);
    return () => {
      if (repeatTimer.current) window.clearInterval(repeatTimer.current);
      repeatTimer.current = null;
    };
  }, [alerts.length]);

  // Flash the tab title so it is visible when the user is away.
  useEffect(() => {
    if (alerts.length === 0) {
      if (titleTimer.current) window.clearInterval(titleTimer.current);
      titleTimer.current = null;
      document.title = baseTitle.current;
      return;
    }
    let on = false;
    titleTimer.current = window.setInterval(() => {
      on = !on;
      document.title = on ? `🔔 (${alerts.length}) NEW — action needed` : baseTitle.current;
    }, 900);
    return () => {
      if (titleTimer.current) window.clearInterval(titleTimer.current);
      titleTimer.current = null;
      document.title = baseTitle.current;
    };
  }, [alerts.length]);

  // Realtime sources
  useEffect(() => {
    if (!user || !role) return;

    const statuses = roleIncomingStatus[role] ?? [];
    const stations = roleStation[role] ?? [];

    const channel = createRealtimeChannel(`station-alerts-${role}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
        const n: any = payload.new;
        if (role !== 'admin' && n.target_role && n.target_role !== role) return;
        if (n.user_id && n.user_id !== user.id) return;
        push({ id: `notif-${n.id}`, title: n.title, message: n.message, link: n.link, at: n.created_at });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'snap_orders' }, (payload) => {
        const s: any = payload.new;
        if (!stations.includes(s.target_station)) return;
        push({
          id: `snap-${s.id}`,
          title: 'New snap order received',
          message: `A ${s.order_type} order was sent to your station.`,
          link: null,
          at: s.created_at,
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'patients' }, (payload) => {
        const nw: any = payload.new;
        const old: any = payload.old;
        if (!statuses.includes(nw.status)) return;
        if (old?.status === nw.status) return;
        push({
          id: `patient-${nw.id}-${nw.status}-${nw.updated_at ?? Date.now()}`,
          title: 'Patient sent to your module',
          message: `${nw.first_name ?? ''} ${nw.last_name ?? ''} is now ${String(nw.status).replace(/_/g, ' ')}.`.trim(),
          link: null,
          at: new Date().toISOString(),
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, role, push]);

  return { alerts, dismiss, dismissAll };
}
