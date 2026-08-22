import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, RefreshCw, Users } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export type StaffMigrationPatient = {
  patient_id: string;
  first_name: string;
  last_name: string;
  card_number: string;
  account_type: 'staff' | 'staff_family' | string;
  patient_status: string;
  balance: number | string | null;
  staff_id: string | null;
  staff_name: string | null;
  staff_deleted_at: string | null;
  marked_at: string | null;
};

function unwrapRpc<T>(data: unknown): T | null {
  if (data && typeof data === 'object' && 'data' in data) return (data as { data: T }).data;
  return (data as T) ?? null;
}

export function StaffMigrationQueue() {
  const [patients, setPatients] = useState<StaffMigrationPatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [migratingId, setMigratingId] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_staff_patient_migration_queue');
    if (error) {
      toast.error('Could not load staff-patient migration queue', { description: error.message });
      setPatients([]);
    } else {
      setPatients((unwrapRpc<StaffMigrationPatient[]>(data) ?? []) as StaffMigrationPatient[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadQueue(); }, [loadQueue]);

  const migrate = async (patient: StaffMigrationPatient) => {
    const name = `${patient.first_name} ${patient.last_name}`.trim();
    if (!window.confirm(`Convert ${name} (${patient.card_number}) to a Normal patient? Their history and balance will be preserved.`)) return;
    setMigratingId(patient.patient_id);
    const { data, error } = await supabase.rpc('convert_staff_linked_patient_to_normal', {
      _patient_id: patient.patient_id,
    });
    if (error) {
      toast.error('Patient migration failed', { description: error.message });
    } else {
      const result = unwrapRpc<{ action?: string }>(data);
      toast.success('Patient converted to Normal successfully', {
        description: result?.action === 'migrated_to_normal'
          ? 'The patient history, ledger, visits, and balance were preserved.'
          : 'The patient record was updated safely.',
      });
      setPatients((current) => current.filter((item) => item.patient_id !== patient.patient_id));
      window.dispatchEvent(new CustomEvent('patient-data-changed'));
    }
    setMigratingId(null);
  };

  if (loading && patients.length === 0) {
    return (
      <Card className="mb-6 border-amber-300/50 bg-amber-50/40 dark:bg-amber-950/10">
        <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" /> Checking for staff-linked patients requiring migration...
        </CardContent>
      </Card>
    );
  }

  if (patients.length === 0) return null;

  return (
    <Card className="mb-6 border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/15">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-5 w-5 text-amber-600" /> Staff-linked patients require migration
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Their linked staff member has been deactivated. Convert each record to Normal before starting a new visit.
              Existing history and balance will remain unchanged.
            </p>
          </div>
          <Badge variant="warning" className="shrink-0">{patients.length} pending</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {patients.map((patient) => (
          <div key={patient.patient_id} className="flex flex-col gap-3 rounded-lg border border-amber-300/50 bg-background/80 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{patient.first_name} {patient.last_name}</span>
                <Badge variant="outline" className="text-[10px]">{patient.account_type === 'staff_family' ? 'Staff Family' : 'Staff'}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Card {patient.card_number} · Linked staff: {patient.staff_name || 'Deleted staff'} · Balance: ₦{Number(patient.balance || 0).toLocaleString()}
              </p>
            </div>
            <Button size="sm" variant="hero" onClick={() => void migrate(patient)} disabled={migratingId === patient.patient_id} className="shrink-0">
              {migratingId === patient.patient_id ? <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-1.5 h-4 w-4" />}
              Convert to Normal
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
