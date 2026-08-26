import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Activity, 
  AlertTriangle, 
  ArrowDownRight, 
  ArrowUpRight, 
  Droplet, 
  MapPin, 
  User, 
  Wallet, 
  ClipboardList, 
  UserCheck,
  FlaskConical
} from 'lucide-react';
import { differenceInYears, format } from 'date-fns';
import { Patient } from '@/contexts/PatientContext';
import { ViewCardButton } from '@/components/visit/PatientCardDialog';
import { createRealtimeChannel, supabase } from '@/integrations/supabase/client';
import { hasWallet, sponsorLabel } from '@/lib/copay';
import { PatientPhotoAvatar } from '@/components/patient/PatientPhotoAvatar';
import { toast } from 'sonner';
import { cn } from "@/lib/utils";
import { PatientLabResultsDialog } from './PatientLabResultsDialog';

const STATUS_OWNER: Record<string, string> = {
  registered: 'Reception',
  waiting: 'Nurse (queue)',
  with_nurse: 'Nurse',
  with_clinical_team: 'Clinical Team',
  in_lab: 'Laboratory',
  awaiting_payment: 'Cashier',
  at_pharmacy: 'Pharmacy',
  admitted: 'Ward',
  discharged: 'Discharged',
};

const STATUS_LABELS: Record<string, string> = {
  registered: 'Registered',
  waiting: 'Waiting',
  with_nurse: 'With Nurse',
  with_clinical_team: 'With Clinical Team',
  in_lab: 'In Lab',
  awaiting_billing: 'Awaiting Billing',
  awaiting_payment: 'Awaiting Cashier',
  at_pharmacy: 'At Pharmacy',
  admitted: 'Admitted',
  discharged: 'Discharged',
  awaiting_room: 'Awaiting Room',
};

type VisitRow = { id: string; visit_number: string; opened_at: string; status: string };
type AdmissionRow = {
  id: string;
  bed_id: string | null;
  beds: {
    bed_label: string | null;
    rooms: { room_number: string | null; wards: { name: string | null } | null } | null;
  } | null;
};

export function UniversalPatientHeader({ patient }: { patient: Patient }) {
  const [visit, setVisit] = useState<VisitRow | null>(null);
  const [admission, setAdmission] = useState<AdmissionRow | null>(null);
  const [creditLimit, setCreditLimit] = useState<number>(0);
  const [latestVitals, setLatestVitals] = useState<any | null>(null);
  const [balanceFlash, setBalanceFlash] = useState<{ delta: number; key: number } | null>(null);
  const prevBalanceRef = useRef<number | null>(null);
  const [labResultsOpen, setLabResultsOpen] = useState(false);
  const [newLabResultsCount, setNewLabResultsCount] = useState(0);

  const loadLatestVitals = useCallback(async () => {
    const { data } = await supabase
      .from('vitals')
      .select('*')
      .eq('patient_id', patient.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setLatestVitals((data as any) ?? null);
  }, [patient.id]);

  useEffect(() => {
    loadLatestVitals();
    const ch = createRealtimeChannel(`uph-vitals-${patient.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vitals', filter: `patient_id=eq.${patient.id}` },
        () => loadLatestVitals(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [patient.id, loadLatestVitals]);

  useEffect(() => {
    let active = true;
    const checkResults = async () => {
      const { data } = await supabase
        .from('snap_orders')
        .select('id')
        .eq('patient_id', patient.id)
        .in('order_type', ['lab', 'lab_result'])
        .eq('status', 'returned');
      if (active) setNewLabResultsCount(data?.length || 0);
    };
    checkResults();
    const ch = createRealtimeChannel(`header-results-${patient.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'snap_orders', filter: `patient_id=eq.${patient.id}` }, checkResults)
      .subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }, [patient.id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [{ data: v, error: visitError }, { data: a, error: admissionError }] = await Promise.all([
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
          .select('id, bed_id')
          .eq('patient_id', patient.id)
          .eq('status', 'active')
          .maybeSingle(),
      ]);
      if (!alive) return;
      if (visitError) console.error('Failed to load patient visit header data', visitError);
      if (admissionError) console.error('Failed to load patient admission header data', admissionError);
      setVisit((v as any) ?? null);
      let admissionWithLocation: AdmissionRow | null = (a as any) ?? null;
      if (admissionWithLocation?.bed_id) {
        const { data: bed } = await supabase.from('beds').select('id, bed_label, room_id').eq('id', admissionWithLocation.bed_id).maybeSingle();
        if (bed?.room_id) {
          const { data: room } = await supabase.from('rooms').select('id, room_number, ward_id').eq('id', bed.room_id).maybeSingle();
          const { data: ward } = room?.ward_id
            ? await supabase.from('wards').select('id, name').eq('id', room.ward_id).maybeSingle()
            : { data: null };
          admissionWithLocation = {
            ...admissionWithLocation,
            beds: {
              bed_label: bed.bed_label ?? null,
              rooms: room ? { room_number: room.room_number ?? null, wards: ward ? { name: ward.name ?? null } : null } : null,
            },
          };
        }
      }
      setAdmission(admissionWithLocation);

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
  const showWallet = hasWallet(patient);

  useEffect(() => {
    const prev = prevBalanceRef.current;
    prevBalanceRef.current = balance;
    if (prev === null || prev === balance) return;
    const delta = balance - prev;
    const key = Date.now();
    setBalanceFlash({ delta, key });
    if (delta > 0) {
      toast.success(`Wallet credited +₦${delta.toLocaleString()}`, {
        description: `New balance: ₦${balance.toLocaleString()}`,
      });
    } else if (delta < 0) {
      toast.info(`Wallet debited −₦${Math.abs(delta).toLocaleString()}`, {
        description: `New balance: ₦${balance.toLocaleString()}`,
      });
    }
    const t = setTimeout(() => {
      setBalanceFlash((cur) => (cur && cur.key === key ? null : cur));
    }, 4000);
    return () => clearTimeout(t);
  }, [balance]);

  const location = admission?.beds
    ? [admission.beds.rooms?.wards?.name, admission.beds.rooms?.room_number, admission.beds.bed_label]
        .filter(Boolean)
        .join(' • ')
    : owner;

  return (
    <div className="space-y-3">
      <Card className="p-4 md:p-5 border-l-4 border-l-primary relative overflow-visible">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <PatientPhotoAvatar patient={patient} size={56} className="rounded-2xl" />

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold truncate">
                {patient.first_name} {patient.last_name}
              </h2>
              <Badge variant="outline">{patient.physical_card_number ? `Physical Card: ${patient.physical_card_number}` : `Patient ID: ${patient.card_number}`}</Badge>
              {patient.physical_card_number && <Badge variant="secondary">Patient ID: {patient.card_number}</Badge>}
              <Badge variant="secondary" className="capitalize">
                {patient.account_type?.replace('_', ' ')}
              </Badge>
              <Badge variant="outline">
                {STATUS_LABELS[patient.status] || patient.status?.replace('_', ' ')}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {age !== null ? `${age} yrs` : '—'} • {patient.gender || '—'} •{' '}
              {patient.phone || 'no phone'}
              {patient.occupation && <> • Occupation: {patient.occupation}</>}
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
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={newLabResultsCount > 0 ? "default" : "outline"}
                className={cn(
                  "gap-2 h-9",
                  newLabResultsCount > 0 && "bg-module-laboratory hover:bg-module-laboratory/90"
                )}
                onClick={() => setLabResultsOpen(true)}
              >
                <FlaskConical className="h-4 w-4" />
                Lab Results
                {newLabResultsCount > 0 && (
                  <Badge variant="success" className="ml-1 px-1.5 h-4 min-w-[1.25rem] flex items-center justify-center text-[10px]">
                    {newLabResultsCount}
                  </Badge>
                )}
              </Button>
              <ViewCardButton patient={patient} label="Open Card" variant="default" />
            </div>
          </div>
        </div>

        <PatientLabResultsDialog
          open={labResultsOpen}
          onOpenChange={setLabResultsOpen}
          patientId={patient.id}
          patientName={`${patient.first_name} ${patient.last_name}`}
        />

        <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
          {showWallet ? (
            <Stat
              icon={<Wallet className="h-3.5 w-3.5" />}
              label="Balance"
              value={`₦${balance.toLocaleString()}`}
              tone={balance < 0 ? 'danger' : balance > 0 ? 'ok' : 'muted'}
              flash={balanceFlash ?? undefined}
            />
          ) : (
            <Stat
              icon={<Wallet className="h-3.5 w-3.5" />}
              label="Sponsor"
              value={sponsorLabel(patient)}
              tone="ok"
            />
          )}
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

        {latestVitals && <LatestVitalsStrip v={latestVitals} />}
      </Card>
    </div>
  );
}

function LatestVitalsStrip({ v }: { v: any }) {
  const items: { label: string; value: string }[] = [];
  if (v.blood_pressure) items.push({ label: 'BP', value: `${v.blood_pressure} mmHg` });
  if (v.pulse != null) items.push({ label: 'Pulse', value: `${v.pulse} bpm` });
  if (v.temperature != null) items.push({ label: 'Temp', value: `${v.temperature} °C` });
  if (v.respiratory_rate != null) items.push({ label: 'RR', value: `${v.respiratory_rate}/min` });
  if (v.weight != null) items.push({ label: 'Wt', value: `${v.weight} kg` });
  if (v.height != null) items.push({ label: 'Ht', value: `${v.height} cm` });
  if (!items.length && v.notes) items.push({ label: 'Notes', value: v.notes });
  if (!items.length) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 p-2.5 rounded-lg bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-900">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-teal-800 dark:text-teal-200">
        <Activity className="h-3.5 w-3.5" />
        Latest Vitals
      </div>
      <span className="text-[10px] font-mono text-muted-foreground">
        {format(new Date(v.created_at), 'dd MMM · HH:mm')}
      </span>
      <div className="flex flex-wrap gap-1.5 ml-1">
        {items.map((it) => (
          <span
            key={it.label}
            className="px-2 py-0.5 rounded border border-teal-300 dark:border-teal-800 bg-background text-xs font-mono"
          >
            <span className="text-muted-foreground font-bold">{it.label}:</span>{' '}
            <span className="font-bold">{it.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  tone = 'muted',
  flash,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'muted' | 'ok' | 'danger';
  flash?: { delta: number; key: number };
}) {
  const toneCls =
    tone === 'danger'
      ? 'text-destructive'
      : tone === 'ok'
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-foreground';
  const flashCls = flash
    ? flash.delta > 0
      ? 'ring-2 ring-emerald-500/70 bg-emerald-50 dark:bg-emerald-950/40 animate-pulse'
      : 'ring-2 ring-amber-500/70 bg-amber-50 dark:bg-amber-950/40 animate-pulse'
    : '';
  return (
    <div className={`relative rounded-md border bg-muted/30 px-2.5 py-1.5 transition-all ${flashCls}`}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`text-sm font-semibold truncate ${toneCls}`} title={value}>
        {value}
      </div>
      {flash && (
        <div
          key={flash.key}
          className={`absolute -top-2 -right-2 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold shadow-md ${
            flash.delta > 0
              ? 'bg-emerald-600 text-white'
              : 'bg-amber-600 text-white'
          }`}
        >
          {flash.delta > 0 ? (
            <ArrowUpRight className="h-3 w-3" />
          ) : (
            <ArrowDownRight className="h-3 w-3" />
          )}
          {flash.delta > 0 ? '+' : '−'}₦{Math.abs(flash.delta).toLocaleString()}
        </div>
      )}
    </div>
  );
}
