import { Badge } from '@/components/ui/badge';
import { PatientStatus } from '@/types/hms';
import { cn } from '@/lib/utils';
import { 
  UserPlus, 
  Clock, 
  Activity, 
  Stethoscope, 
  FlaskConical, 
  Receipt,
  CreditCard,
  Pill,
  BedDouble,
  CheckCircle
} from 'lucide-react';

const statusConfig: Record<PatientStatus, { 
  label: string; 
  variant: 'default' | 'secondary' | 'warning' | 'success' | 'info' | 'destructive';
  icon: React.ElementType;
  color: string;
}> = {
  registered: { 
    label: 'Registered', 
    variant: 'secondary',
    icon: UserPlus,
    color: 'text-muted-foreground'
  },
  waiting: { 
    label: 'Waiting', 
    variant: 'warning',
    icon: Clock,
    color: 'text-warning'
  },
  with_nurse: { 
    label: 'With Nurse', 
    variant: 'info',
    icon: Activity,
    color: 'text-module-nurse'
  },
  with_doctor: { 
    label: 'With Doctor', 
    variant: 'info',
    icon: Stethoscope,
    color: 'text-module-doctor'
  },
  in_lab: { 
    label: 'In Lab', 
    variant: 'warning',
    icon: FlaskConical,
    color: 'text-module-lab'
  },
  awaiting_billing: { 
    label: 'Awaiting Billing', 
    variant: 'warning',
    icon: Receipt,
    color: 'text-module-billing'
  },
  awaiting_payment: { 
    label: 'Awaiting Payment', 
    variant: 'warning',
    icon: CreditCard,
    color: 'text-warning'
  },
  at_pharmacy: { 
    label: 'At Pharmacy', 
    variant: 'info',
    icon: Pill,
    color: 'text-module-pharmacy'
  },
  admitted: { 
    label: 'Admitted', 
    variant: 'default',
    icon: BedDouble,
    color: 'text-primary'
  },
  discharged: { 
    label: 'Discharged', 
    variant: 'success',
    icon: CheckCircle,
    color: 'text-success'
  },
};

interface PatientStatusIndicatorProps {
  status: PatientStatus;
  showIcon?: boolean;
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
  className?: string;
}

export function PatientStatusIndicator({ 
  status, 
  showIcon = true, 
  size = 'md',
  pulse = false,
  className 
}: PatientStatusIndicatorProps) {
  const config = statusConfig[status];
  const Icon = config.icon;
  
  const sizeClasses = {
    sm: 'text-[10px] px-1.5 py-0.5',
    md: 'text-xs px-2 py-1',
    lg: 'text-sm px-3 py-1.5'
  };
  
  const iconSizes = {
    sm: 'h-3 w-3',
    md: 'h-3.5 w-3.5',
    lg: 'h-4 w-4'
  };

  return (
    <Badge 
      variant={config.variant}
      className={cn(
        'flex items-center gap-1 transition-all',
        sizeClasses[size],
        pulse && 'animate-pulse',
        className
      )}
    >
      {showIcon && <Icon className={cn(iconSizes[size], config.color)} />}
      {config.label}
    </Badge>
  );
}

export { statusConfig };
