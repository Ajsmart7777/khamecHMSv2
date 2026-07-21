import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useMyShift } from '@/hooks/useShifts';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ShiftEnforcementContextType {
  isOnShift: boolean;
  isOvertime: boolean;
  shiftWarning: string | null;
  minutesUntilAutoSignout: number | null;
}

const ShiftEnforcementContext = createContext<ShiftEnforcementContextType>({
  isOnShift: false,
  isOvertime: false,
  shiftWarning: null,
  minutesUntilAutoSignout: null,
});

const AUTO_SIGNOUT_GRACE_MINUTES = 30; // Grace period after shift ends before auto-signout

export function ShiftEnforcementProvider({ children }: { children: React.ReactNode }) {
  const { user, role, signOut, isAuthenticated } = useAuth();
  const { todayAssignment, todayLog, isShiftEnded } = useMyShift();
  const [isOvertime, setIsOvertime] = useState(false);
  const [shiftWarning, setShiftWarning] = useState<string | null>(null);
  const [minutesUntilAutoSignout, setMinutesUntilAutoSignout] = useState<number | null>(null);
  const overtimeMarkedRef = useRef(false);
  const autoSignoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningShownRef = useRef(false);

  // Admin users are exempt from shift enforcement
  const isExempt = role === 'admin';

  // Calculate shift end time
  const getShiftEndTime = useCallback((): Date | null => {
    if (!todayAssignment?.shift_periods) return null;
    const [endH, endM] = todayAssignment.shift_periods.end_time.split(':').map(Number);
    const endDate = new Date();
    endDate.setHours(endH, endM, 0, 0);
    
    // Handle overnight shifts
    const [startH] = todayAssignment.shift_periods.start_time.split(':').map(Number);
    if (endH < startH) {
      endDate.setDate(endDate.getDate() + 1);
    }
    return endDate;
  }, [todayAssignment]);

  // Main enforcement loop
  useEffect(() => {
    if (!isAuthenticated || isExempt || !user) return;

    const checkShiftStatus = async () => {
      const shiftEnd = getShiftEndTime();
      const now = new Date();

      // No shift assigned today
      if (!todayAssignment) {
        if (!warningShownRef.current) {
          warningShownRef.current = true;
          setShiftWarning('You have no shift assigned for today. Contact your administrator.');
        }
        setIsOvertime(false);
        setMinutesUntilAutoSignout(null);
        return;
      }

      warningShownRef.current = false;
      setShiftWarning(null);

      // Check if shift has ended
      if (shiftEnd && now > shiftEnd) {
        setIsOvertime(true);

        // Mark overtime in DB (once)
        if (!overtimeMarkedRef.current && todayLog && todayLog.status === 'clocked_in') {
          overtimeMarkedRef.current = true;
          const { error } = await supabase.from('shift_logs')
            .update({ status: 'overtime' })
            .eq('id', todayLog.id);
          if (error) console.error('Failed to mark overtime:', error);
        }

        // Calculate time until auto-signout
        const graceEnd = new Date(shiftEnd.getTime() + AUTO_SIGNOUT_GRACE_MINUTES * 60000);
        const msUntilSignout = graceEnd.getTime() - now.getTime();
        const minsLeft = Math.max(0, Math.ceil(msUntilSignout / 60000));
        setMinutesUntilAutoSignout(minsLeft);

        // Warn at 10 minutes and 5 minutes
        if (minsLeft === 10 || minsLeft === 5) {
          toast.warning(`Auto sign-out in ${minsLeft} minutes`, {
            description: 'Please complete your handover before being signed out.',
          });
        }

        // Auto-signout when grace period expired and still clocked in (not already handed over)
        if (msUntilSignout <= 0 && todayLog && todayLog.status !== 'handed_over' && todayLog.status !== 'auto_signout') {
          toast.error('Session ended', {
            description: 'Your shift has ended and the grace period has expired. You have been signed out.',
          });
          
          // Force handover with auto-generated notes
          await supabase.from('shift_logs')
            .update({
              clock_out_at: new Date().toISOString(),
              handover_notes: '[AUTO-SIGNOUT] Staff was automatically signed out after shift + grace period expired.',
              status: 'auto_signout',
            })
            .eq('id', todayLog.id);
          
          signOut();
          return;
        }
      } else {
        setIsOvertime(false);
        setMinutesUntilAutoSignout(null);
        overtimeMarkedRef.current = false;
      }
    };

    // Run check immediately and every 30 seconds (faster for better UX)
    checkShiftStatus();
    const interval = setInterval(checkShiftStatus, 30000);

    return () => clearInterval(interval);
  }, [isAuthenticated, isExempt, user, todayAssignment, todayLog, getShiftEndTime, signOut]);

  // Login enforcement: show warning toast when user logs in without shift
  useEffect(() => {
    if (!isAuthenticated || isExempt || !user) return;
    
    // Delay check to let shift data load
    const timer = setTimeout(() => {
      if (!todayAssignment && !shiftWarning) {
        toast.warning('No Shift Assigned', {
          description: 'You don\'t have a shift assigned for today. Some features may be restricted.',
          duration: 8000,
        });
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [isAuthenticated, isExempt, user, todayAssignment]);

  const isOnShift = !!todayAssignment && !!todayLog && todayLog.status === 'clocked_in';

  return (
    <ShiftEnforcementContext.Provider value={{
      isOnShift,
      isOvertime,
      shiftWarning,
      minutesUntilAutoSignout,
    }}>
      {children}
    </ShiftEnforcementContext.Provider>
  );
}

export function useShiftEnforcement() {
  return useContext(ShiftEnforcementContext);
}
