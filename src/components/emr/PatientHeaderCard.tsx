import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { AlertTriangle, Droplet, User, Wallet } from 'lucide-react';
import { Patient } from '@/contexts/PatientContext';
import { format, differenceInYears } from 'date-fns';
import { ViewCardButton } from '@/components/visit/PatientCardDialog';

export function PatientHeaderCard({ patient }: { patient: Patient }) {
  const age = patient.date_of_birth
    ? differenceInYears(new Date(), new Date(patient.date_of_birth))
    : null;

  return (
    <Card className="p-4 md:p-5">
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <User className="h-7 w-7" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold truncate">
              {patient.first_name} {patient.last_name}
            </h2>
            <Badge variant="outline">{patient.card_number}</Badge>
            <Badge variant="secondary" className="capitalize">
              {patient.account_type?.replace('_', ' ')}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {age !== null ? `${age} yrs` : '—'} • {patient.gender} • {patient.phone || 'no phone'}
            {patient.date_of_birth && (
              <> • DOB {format(new Date(patient.date_of_birth), 'MMM dd, yyyy')}</>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 md:gap-4">
          {patient.blood_group && (
            <div className="flex items-center gap-1.5 text-sm">
              <Droplet className="h-4 w-4 text-destructive" />
              <span className="font-medium">{patient.blood_group}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-sm">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">₦{Number(patient.balance || 0).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {patient.allergies && patient.allergies.length > 0 && (
        <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs font-medium text-destructive mr-1">Allergies:</span>
            {patient.allergies.map((a) => (
              <Badge key={a} variant="destructive" className="text-xs">
                {a}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
