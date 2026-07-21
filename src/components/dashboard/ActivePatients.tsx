import { usePatients } from '@/contexts/PatientContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronRight, User, Users } from 'lucide-react';
import { PatientStatus, AccountType } from '@/types/hms';

const statusConfig: Record<PatientStatus, { label: string; variant: 'default' | 'secondary' | 'warning' | 'success' | 'info' }> = {
  registered: { label: 'Registered', variant: 'secondary' },
  waiting: { label: 'Waiting', variant: 'warning' },
  with_nurse: { label: 'With Nurse', variant: 'info' },
  with_doctor: { label: 'With Doctor', variant: 'info' },
  in_lab: { label: 'In Lab', variant: 'warning' },
  awaiting_billing: { label: 'Awaiting Billing', variant: 'warning' },
  awaiting_payment: { label: 'Awaiting Payment', variant: 'warning' },
  at_pharmacy: { label: 'At Pharmacy', variant: 'info' },
  admitted: { label: 'Admitted', variant: 'default' },
  discharged: { label: 'Discharged', variant: 'success' },
};

const accountTypeLabels: Record<AccountType, string> = {
  normal: 'Normal',
  insurance: 'Insurance',
  corporate: 'Corporate',
  nhis: 'NHIS',
  hmo: 'HMO',
  retainer: 'Retainer',
  staff: 'Staff',
  staff_family: 'Staff Family',
};

export function ActivePatients() {
  const { patients, loading } = usePatients();
  const activePatients = patients.filter(p => p.status !== 'discharged');

  if (loading) {
    return (
      <div className="bg-card rounded-xl border border-border p-3 sm:p-4 md:p-6">
        <h3 className="text-sm sm:text-base font-semibold text-foreground mb-4">Active Patients</h3>
        <p className="text-muted-foreground text-sm">Loading...</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border p-3 sm:p-4 md:p-6">
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <h3 className="text-sm sm:text-base font-semibold text-foreground">Active Patients</h3>
        <Button variant="ghost" size="sm" className="text-primary text-xs sm:text-sm" asChild>
          <a href="/reception">View all <ChevronRight className="h-3 w-3 sm:h-4 sm:w-4 ml-1" /></a>
        </Button>
      </div>

      {activePatients.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground">
          <Users className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No active patients at the moment</p>
        </div>
      ) : (
        <>
          {/* Mobile Cards View */}
          <div className="md:hidden space-y-3">
            {activePatients.map((patient, index) => (
              <div
                key={patient.id}
                className="bg-muted/30 rounded-lg p-3 border border-border/50 animate-slide-up cursor-pointer hover:bg-muted/50 transition-colors"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <User className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-foreground truncate">
                        {patient.first_name} {patient.last_name}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">{patient.card_number}</p>
                    </div>
                  </div>
                  <Badge variant={statusConfig[patient.status]?.variant ?? 'secondary'} className="text-[10px] shrink-0">
                    {statusConfig[patient.status]?.label ?? patient.status}
                  </Badge>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-border/50">
                  <Badge variant={patient.account_type === 'corporate' ? 'info' : 'secondary'} className="text-[10px]">
                    {accountTypeLabels[patient.account_type] ?? patient.account_type}
                  </Badge>
                  <span className="font-semibold text-sm text-foreground">
                    ₦{patient.balance.toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="text-xs">Card No.</th>
                  <th className="text-xs">Patient Name</th>
                  <th className="text-xs">Status</th>
                  <th className="text-xs">Type</th>
                  <th className="text-xs text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {activePatients.map((patient, index) => (
                  <tr
                    key={patient.id}
                    className="animate-slide-up cursor-pointer hover:bg-muted/50"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <td className="font-mono text-sm py-3">{patient.card_number}</td>
                    <td className="font-medium text-sm py-3">
                      {patient.first_name} {patient.last_name}
                    </td>
                    <td className="py-3">
                      <Badge variant={statusConfig[patient.status]?.variant ?? 'secondary'} className="text-xs">
                        {statusConfig[patient.status]?.label ?? patient.status}
                      </Badge>
                    </td>
                    <td className="py-3">
                      <Badge variant={patient.account_type === 'corporate' ? 'info' : 'secondary'} className="text-xs">
                        {accountTypeLabels[patient.account_type] ?? patient.account_type}
                      </Badge>
                    </td>
                    <td className="text-right font-medium text-sm py-3">
                      ₦{patient.balance.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
