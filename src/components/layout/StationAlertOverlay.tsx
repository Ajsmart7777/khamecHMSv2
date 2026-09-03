import { BellRing, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStationAlerts } from '@/hooks/useStationAlerts';

/**
 * Always-on, high-visibility alert banner. Keeps chiming and flashing the tab
 * title until the user acknowledges, so nothing is missed while away.
 */
export function StationAlertOverlay() {
  const { alerts, dismiss, dismissAll } = useStationAlerts();

  if (alerts.length === 0) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 p-2 sm:p-3 pointer-events-none print:hidden">
      {alerts.slice(0, 3).map((a) => (
        <div
          key={a.id}
          className="pointer-events-auto w-full max-w-xl rounded-xl border-2 border-destructive bg-destructive text-destructive-foreground shadow-2xl animate-pulse"
        >
          <div className="flex items-start gap-3 p-3 sm:p-4">
            <BellRing className="h-5 w-5 shrink-0 mt-0.5 animate-bounce" />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm sm:text-base">{a.title}</p>
              <p className="text-xs sm:text-sm opacity-90 break-words">{a.message}</p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="shrink-0 h-8"
              onClick={() => dismiss(a.id)}
            >
              Acknowledge
            </Button>
          </div>
        </div>
      ))}
      {alerts.length > 1 && (
        <button
          onClick={dismissAll}
          className="pointer-events-auto text-xs font-medium bg-background border rounded-full px-3 py-1 shadow flex items-center gap-1"
        >
          <X className="h-3 w-3" /> Acknowledge all ({alerts.length})
        </button>
      )}
    </div>
  );
}
