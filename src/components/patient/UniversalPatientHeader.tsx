import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Droplet, MapPin, User, Wallet, ClipboardList, UserCheck } from 'lucide-react';
import { differenceInYears, format } from 'date-fns';
import { Patient } from '@/contexts/PatientContext';
import { ViewCardButton } from '@/components/visit/PatientCardDialog';
import { supabase } from '@/integrations/supabase/client';

const STATUS_OWNER: Record<string, string> = {
  registered: 'Reception',
  waiting: 'Nurse (queue)',
  with_nurse: 'Nurse',
  with_doctor: 'Doctor',
  in_lab: 'Laboratory',
  awaiting_payment: 'Billing / Cashier',
  at_pharmacy: 'Pharmacy',
  admitted: 'Ward',
  discharged: 'Discharged',
};

type VisitRow = { id: string; visit_number: string; opened_at: string; status: string };
type AdmissionRow = {
  id: string;
  bed_id: string | null;
  beds: { label: string | null; rooms: { name: string | null; wards: { name: string | null } | null } | null } | null;
};

export function UniversalPatientHeader({ patient }: { patient: Patient }) {
  const [visit, setVisit] = useState<VisitRow | null>(null);
  const [admission, setAdmission] = useState<AdmissionRow | null>(null);
  const [creditLimit, setCreditLimit] = useState<number>(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [{ data: v }, { data: a }] = await Promise.all([
        supabase
          .from('visits')
          .select('id, visit_number, opened_at, status')
          .eq('patient_id', patient.id)
          .eq('status', 'open')
          .order('opened_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('admissions')
          .select('id, bed_id, beds(label, rooms(name, wards(name)))')
          .eq('patient_id', patient.id)
          .eq('status', 'active')
          .maybeSingle(),
      ]);
      if (!alive) return;
      setVisit((v as any) ?? null);
      setAdmission((a as any) ?? null);

      if (patient.corporate_id) {
        const { data: c } = await supabase
          .from('corporate_accounts')
          .select('balance')
          .eq('id', patient.corporate_id)
          .maybeSingle();
        if (alive) setCreditLimit(Number((c as any)?.balance ?? 0));
      } else {
        setCreditLimit(0);
      }
    })();
    return () => {
      alive = false;
    };
  }, [patient.id, patient.corporate_id, patient.status]);

  const age = patient.date_of_birth
    ? differenceInYears(new Date(), new Date(patient.date_of_birth))
    : null;
  const owner = STATUS_OWNER[patient.status] ?? patient.status;
  const balance = Number(patient.balance || 0);
  const location = admission?.beds
    ? [admission.beds.rooms?.wards?.name, admission.beds.rooms?.name, admission.beds.label]
        .filter(Boolean)
        .join(' • ')
    : owner;

  return (
    <Card className="p-4 md:p-5 border-l-4 border-l-primary">
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0 text-lg font-semibold uppercase">
          {patient.first_name?.[0]}
          {patient.last_name?.[0]}
          {!patient.first_name && !patient.last_name && <User className="h-6 w-6" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold truncate">
              {patient.first_name} {patient.last_name}
            </h2>
            <Badge variant="outline">{patient.card_number}</Badge>
            <Badge variant="secondary" className="capitalize">
              {patient.account_type?.replace('_', ' ')}
            </Badge>
            <Badge variant="outline" className="capitalize">
              {patient.status?.replace('_', ' ')}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {age !== null ? `${age} yrs` : '—'} • {patient.gender || '—'} •{' '}
            {patient.phone || 'no phone'}
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
          <ViewCardButton patient={patient} label="Open Card" variant="default" />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
        <Stat
          icon={<Wallet className="h-3.5 w-3.5" />}
          label="Balance"
          value={`₦${balance.toLocaleString()}`}
          tone={balance < 0 ? 'danger' : balance > 0 ? 'ok' : 'muted'}
        />
        <Stat
          icon={<Wallet className="h-3.5 w-3.5" />}
          label="Sponsor credit"
          value={patient.corporate_id ? `₦${creditLimit.toLocaleString()}` : '—'}
        />
        <Stat
          icon={<UserCheck className="h-3.5 w-3.5" />}
          label="Current owner"
          value={owner}
        />
        <Stat
          icon={<MapPin className="h-3.5 w-3.5" />}
          label="Location"
          value={location}
        />
        <Stat
          icon={<ClipboardList className="h-3.5 w-3.5" />}
          label="Open visit"
          value={
            visit
              ? `${visit.visit_number} · ${format(new Date(visit.opened_at), 'MMM dd HH:mm')}`
              : 'None'
          }
        />
      </div>

      {patient.allergies && patient.allergies.length > 0 && (
        <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/30">
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

function Stat({
  icon,
  label,
  value,
  tone = 'muted',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'muted' | 'ok' | 'danger';
}) {
  const toneCls =
    tone === 'danger'
      ? 'text-destructive'
      : tone === 'ok'
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-foreground';
  return (
    <div className="rounded-md border bg-muted/30 px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`text-sm font-semibold truncate ${toneCls}`} title={value}>
        {value}
      </div>
    </div>
  );
}