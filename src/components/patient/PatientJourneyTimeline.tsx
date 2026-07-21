import { forwardRef } from 'react';
import { 
  UserPlus, 
  Activity, 
  Stethoscope, 
  FlaskConical, 
  CreditCard, 
  Pill,
  CheckCircle2,
  Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface JourneyEvent {
  id: string;
  type: 'registration' | 'vitals' | 'consultation' | 'lab_test' | 'billing' | 'pharmacy' | 'payment';
  title: string;
  description: string;
  timestamp: Date;
  status: 'completed' | 'in_progress' | 'pending';
  details?: Record<string, string | number>;
}

interface PatientJourneyTimelineProps {
  patientName: string;
  cardNumber: string;
  events: JourneyEvent[];
}

const eventConfig: Record<JourneyEvent['type'], { icon: React.ReactNode; color: string; bgColor: string }> = {
  registration: { 
    icon: <UserPlus className="h-4 w-4" />, 
    color: 'text-primary',
    bgColor: 'bg-primary/10'
  },
  vitals: { 
    icon: <Activity className="h-4 w-4" />, 
    color: 'text-info',
    bgColor: 'bg-info/10'
  },
  consultation: { 
    icon: <Stethoscope className="h-4 w-4" />, 
    color: 'text-success',
    bgColor: 'bg-success/10'
  },
  lab_test: { 
    icon: <FlaskConical className="h-4 w-4" />, 
    color: 'text-warning',
    bgColor: 'bg-warning/10'
  },
  billing: { 
    icon: <CreditCard className="h-4 w-4" />, 
    color: 'text-accent',
    bgColor: 'bg-accent/10'
  },
  pharmacy: { 
    icon: <Pill className="h-4 w-4" />, 
    color: 'text-destructive',
    bgColor: 'bg-destructive/10'
  },
  payment: { 
    icon: <CreditCard className="h-4 w-4" />, 
    color: 'text-success',
    bgColor: 'bg-success/10'
  },
};

const statusConfig: Record<JourneyEvent['status'], { icon: React.ReactNode; label: string; color: string }> = {
  completed: { 
    icon: <CheckCircle2 className="h-3 w-3" />, 
    label: 'Completed',
    color: 'text-success'
  },
  in_progress: { 
    icon: <Clock className="h-3 w-3 animate-pulse" />, 
    label: 'In Progress',
    color: 'text-warning'
  },
  pending: { 
    icon: <Clock className="h-3 w-3" />, 
    label: 'Pending',
    color: 'text-muted-foreground'
  },
};

export const PatientJourneyTimeline = forwardRef<HTMLDivElement, PatientJourneyTimelineProps>(
  ({ patientName, cardNumber, events }, ref) => {
    const sortedEvents = [...events].sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return (
      <div ref={ref} className="bg-card rounded-xl border border-border p-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Patient Journey Timeline
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {patientName} • {cardNumber}
          </p>
        </div>

        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />

          <div className="space-y-4">
            {sortedEvents.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No journey events recorded yet</p>
              </div>
            ) : (
              sortedEvents.map((event, index) => {
                const config = eventConfig[event.type];
                const status = statusConfig[event.status];

                return (
                  <div 
                    key={event.id} 
                    className="relative pl-10 animate-fade-in"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    {/* Timeline dot */}
                    <div className={cn(
                      "absolute left-0 w-8 h-8 rounded-full flex items-center justify-center border-2 border-background",
                      config.bgColor,
                      config.color
                    )}>
                      {config.icon}
                    </div>

                    {/* Event card */}
                    <div className="bg-muted/50 rounded-lg p-4 border border-border/50 hover:border-border transition-colors">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h4 className="font-medium text-sm">{event.title}</h4>
                          <p className="text-xs text-muted-foreground">{event.description}</p>
                        </div>
                        <div className={cn("flex items-center gap-1 text-xs", status.color)}>
                          {status.icon}
                          <span>{status.label}</span>
                        </div>
                      </div>

                      {event.details && Object.keys(event.details).length > 0 && (
                        <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-border/50">
                          {Object.entries(event.details).map(([key, value]) => (
                            <div key={key} className="text-xs">
                              <span className="text-muted-foreground capitalize">
                                {key.replace(/_/g, ' ')}:
                              </span>
                              <span className="ml-1 font-medium">{value}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="mt-2 text-xs text-muted-foreground">
                        {format(new Date(event.timestamp), 'MMM d, yyyy • h:mm a')}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  }
);

PatientJourneyTimeline.displayName = 'PatientJourneyTimeline';
