import { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface ModuleCardProps {
  name: string;
  icon: LucideIcon;
  path: string;
  patientsToday: number;
  pendingTasks: number;
  status: 'active' | 'busy' | 'idle';
  variant: 'reception' | 'nurse' | 'doctor' | 'lab' | 'billing' | 'pharmacy' | 'store' | 'account' | 'auditing' | 'admin';
}

const statusColors = {
  active: 'bg-success',
  busy: 'bg-warning',
  idle: 'bg-muted-foreground',
};

const variantStyles = {
  reception: 'border-module-reception/30 hover:border-module-reception',
  nurse: 'border-module-nurse/30 hover:border-module-nurse',
  doctor: 'border-module-doctor/30 hover:border-module-doctor',
  lab: 'border-module-lab/30 hover:border-module-lab',
  billing: 'border-module-billing/30 hover:border-module-billing',
  pharmacy: 'border-module-pharmacy/30 hover:border-module-pharmacy',
  store: 'border-module-store/30 hover:border-module-store',
  account: 'border-module-account/30 hover:border-module-account',
  auditing: 'border-module-auditing/30 hover:border-module-auditing',
  admin: 'border-module-admin/30 hover:border-module-admin',
};

const iconBgStyles = {
  reception: 'bg-module-reception/10 text-module-reception',
  nurse: 'bg-module-nurse/10 text-module-nurse',
  doctor: 'bg-module-doctor/10 text-module-doctor',
  lab: 'bg-module-lab/10 text-module-lab',
  billing: 'bg-module-billing/10 text-module-billing',
  pharmacy: 'bg-module-pharmacy/10 text-module-pharmacy',
  store: 'bg-module-store/10 text-module-store',
  account: 'bg-module-account/10 text-module-account',
  auditing: 'bg-module-auditing/10 text-module-auditing',
  admin: 'bg-module-admin/10 text-module-admin',
};

export function ModuleCard({ 
  name, 
  icon: Icon, 
  path, 
  patientsToday, 
  pendingTasks, 
  status,
  variant 
}: ModuleCardProps) {
  return (
    <Link 
      to={path}
      className={cn(
        "block p-3 sm:p-5 rounded-xl bg-card border-2 transition-all duration-300 hover:shadow-lg hover:-translate-y-1 group",
        variantStyles[variant]
      )}
    >
      <div className="flex items-start justify-between mb-2 sm:mb-4">
        <div className={cn("p-2 sm:p-3 rounded-lg sm:rounded-xl transition-transform group-hover:scale-110", iconBgStyles[variant])}>
          <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("status-dot", statusColors[status])} />
          <span className="text-xs text-muted-foreground capitalize">{status}</span>
        </div>
      </div>

      <h3 className="font-semibold text-foreground text-sm sm:text-base mb-1 sm:mb-2">{name}</h3>
      
      <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Patients:</span>
          <span className="font-medium">{patientsToday}</span>
        </div>
        {pendingTasks > 0 && (
          <Badge variant={variant} className="text-xs">
            {pendingTasks} pending
          </Badge>
        )}
      </div>
    </Link>
  );
}
