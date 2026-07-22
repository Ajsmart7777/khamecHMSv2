import { usePatients, Patient } from '@/contexts/PatientContext';
import { PatientStatusIndicator } from './PatientStatusIndicator';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { PatientStatus, AccountType } from '@/types/hms';
import { User, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ViewCardButton } from '@/components/visit/PatientCardDialog';

interface RealTimePatientListProps {
  filterStatuses?: PatientStatus[];
  onSelectPatient?: (patient: Patient) => void;
  selectedPatientId?: string | null;
  showBalance?: boolean;
  showAccountType?: boolean;
  emptyMessage?: string;
  emptyIcon?: React.ReactNode;
  maxHeight?: string;
  className?: string;
}

const accountTypeLabels: Record<AccountType, string> = {
  normal: 'Normal',
  katchma: 'Katchma',
  corporate: 'Corporate',
  nhis: 'NHIS',
  hmo: 'HMO',
  retainer: 'Retainer',
  staff: 'Staff',
  staff_family: 'Staff Family'
};

export function RealTimePatientList({
  filterStatuses,
  onSelectPatient,
  selectedPatientId,
  showBalance = false,
  showAccountType = true,
  emptyMessage = 'No patients found',
  emptyIcon,
  maxHeight = '500px',
  className
}: RealTimePatientListProps) {
  const { patients, loading, error, refreshPatients } = usePatients();
  
  const filteredPatients = filterStatuses 
    ? patients.filter(p => filterStatuses.includes(p.status))
    : patients;

  if (loading) {
    return (
      <div className="space-y-2 p-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="p-3 rounded-lg border border-border">
            <div className="flex items-center gap-3">
              <Skeleton className="w-10 h-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center">
        <p className="text-destructive mb-2">{error}</p>
        <Button variant="outline" size="sm" onClick={refreshPatients}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  if (filteredPatients.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        {emptyIcon || <User className="h-12 w-12 mx-auto mb-4 opacity-50" />}
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div 
      className={cn("space-y-2 overflow-y-auto pr-1", className)}
      style={{ maxHeight }}
    >
      {filteredPatients.map((patient, index) => (
        <div
          key={patient.id}
          onClick={() => onSelectPatient?.(patient)}
          className={cn(
            "p-3 rounded-lg border cursor-pointer transition-all duration-200 animate-fade-in hover-lift",
            selectedPatientId === patient.id
              ? "border-primary bg-primary/5 shadow-md"
              : "border-border hover:border-primary/50 hover:bg-muted/50"
          )}
          style={{ animationDelay: `${index * 30}ms` }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">
                  {patient.first_name} {patient.last_name}
                </p>
                <p className="text-xs text-muted-foreground font-mono">
                  {patient.card_number}
                </p>
              </div>
            </div>
            <PatientStatusIndicator status={patient.status} size="sm" />
          </div>
          
          <div className="flex items-center justify-between mt-2 gap-2">
            {showAccountType && (
              <Badge variant="secondary" className="text-[10px]">
                {accountTypeLabels[patient.account_type]}
              </Badge>
            )}
            <div className="flex items-center gap-2 ml-auto">
              {showBalance && (
                <span className="text-sm font-medium">
                  ₦{patient.balance.toLocaleString()}
                </span>
              )}
              <ViewCardButton patient={patient} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
