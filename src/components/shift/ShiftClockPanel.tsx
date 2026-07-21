import { useState, useEffect } from 'react';
import { useMyShift } from '@/hooks/useShifts';
import { useShiftEnforcement } from '@/contexts/ShiftEnforcementContext';
import { HandoverDialog } from './HandoverDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock, LogIn, LogOut, AlertTriangle, Timer } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

export function ShiftClockPanel() {
  const { todayAssignment, todayLog, loading, clockIn, handover, isShiftEnded } = useMyShift();
  const { isOvertime, minutesUntilAutoSignout } = useShiftEnforcement();
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [elapsed, setElapsed] = useState('');
  const [shiftEnded, setShiftEnded] = useState(false);
  const [notified, setNotified] = useState(false);

  // Timer for elapsed time
  useEffect(() => {
    if (!todayLog?.clock_in_at || todayLog.status === 'handed_over') return;

    const interval = setInterval(() => {
      const clockInTime = new Date(todayLog.clock_in_at!).getTime();
      const diff = Date.now() - clockInTime;
      const hours = Math.floor(diff / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      setElapsed(`${hours}h ${minutes}m`);

      // Check overtime
      const ended = isShiftEnded();
      setShiftEnded(ended);
      if (ended && !notified) {
        setNotified(true);
        toast({
          title: '⏰ Shift Ended',
          description: 'Your shift has ended. Please complete your handover before leaving.',
          variant: 'destructive',
        });
      }
    }, 30000); // update every 30s

    // Run immediately
    const clockInTime = new Date(todayLog.clock_in_at!).getTime();
    const diff = Date.now() - clockInTime;
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    setElapsed(`${hours}h ${minutes}m`);
    setShiftEnded(isShiftEnded());

    return () => clearInterval(interval);
  }, [todayLog, isShiftEnded, notified]);

  if (loading) return null;

  // No assignment today
  if (!todayAssignment) {
    return (
      <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-muted-foreground px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-muted/50">
        <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        <span className="hidden sm:inline">No shift assigned</span>
        <span className="sm:hidden">No shift</span>
      </div>
    );
  }

  const shiftName = todayAssignment.shift_periods?.name || 'Shift';
  const startTime = todayAssignment.shift_periods?.start_time?.slice(0, 5) || '';
  const endTime = todayAssignment.shift_periods?.end_time?.slice(0, 5) || '';

  // Not clocked in yet
  if (!todayLog) {
    return (
      <div className="flex items-center gap-1.5 sm:gap-2">
        <div className="text-xs sm:text-sm text-muted-foreground px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-muted/50 flex items-center gap-1.5 sm:gap-2">
          <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          <span className="hidden sm:inline">{shiftName} ({startTime}-{endTime})</span>
          <span className="sm:hidden">{shiftName}</span>
        </div>
        <Button size="sm" variant="default" onClick={clockIn} className="h-7 sm:h-8 text-xs sm:text-sm px-2 sm:px-3">
          <LogIn className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-1" />
          <span className="hidden sm:inline">Clock In</span>
          <span className="sm:hidden">In</span>
        </Button>
      </div>
    );
  }

  // Already handed over
  if (todayLog.status === 'handed_over') {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="bg-muted/50 text-muted-foreground gap-1 text-[10px] sm:text-xs">
          <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
          <span className="hidden sm:inline">Shift completed</span>
          <span className="sm:hidden">Done</span>
        </Badge>
      </div>
    );
  }

  // Clocked in - show timer and handover button
  return (
    <>
      <div className="flex items-center gap-1.5 sm:gap-2">
        <div className={`text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg flex items-center gap-1 sm:gap-2 ${
          shiftEnded 
            ? 'bg-destructive/10 text-destructive border border-destructive/30' 
            : 'bg-primary/10 text-primary'
        }`}>
          {shiftEnded && <AlertTriangle className="h-3 w-3 sm:h-3.5 sm:w-3.5" />}
          <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
          <span className="font-medium hidden sm:inline">{shiftName}</span>
          <span className="text-[10px] sm:text-xs opacity-75">({elapsed})</span>
          {shiftEnded && <Badge variant="destructive" className="text-[8px] sm:text-[10px] px-1 sm:px-1.5 py-0 hidden sm:inline-flex">OVERTIME</Badge>}
          {minutesUntilAutoSignout !== null && minutesUntilAutoSignout <= 15 && (
            <Badge variant="destructive" className="text-[8px] sm:text-[10px] px-1 sm:px-1.5 py-0 gap-0.5 animate-pulse">
              <Timer className="h-2.5 w-2.5" />
              <span className="hidden sm:inline">{minutesUntilAutoSignout}m</span>
            </Badge>
          )}
        </div>
        <Button 
          size="sm" 
          variant={shiftEnded ? 'destructive' : 'outline'}
          onClick={() => setHandoverOpen(true)} 
          className="h-7 sm:h-8 text-xs sm:text-sm px-2 sm:px-3"
        >
          <LogOut className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-1" />
          <span className="hidden sm:inline">Handover</span>
          <span className="sm:hidden">End</span>
        </Button>
      </div>
      <HandoverDialog
        open={handoverOpen}
        onOpenChange={setHandoverOpen}
        onSubmit={handover}
      />
    </>
  );
}
