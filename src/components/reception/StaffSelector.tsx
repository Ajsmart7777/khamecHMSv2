import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { Briefcase } from 'lucide-react';
import { logError } from '@/lib/errorHandler';

interface StaffRow {
  id: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  role: string;
  department: string;
  family_deduction_consent: boolean;
}

interface Props {
  value: string;
  onChange: (id: string, staff: StaffRow | null) => void;
  label: string;
  helper?: string;
}

export function StaffSelector({ value, onChange, label, helper }: Props) {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let mounted = true;

    const fetchStaff = async () => {
      setLoading(true);
      setLoadError('');
      try {
        const { data, error } = await supabase.rpc('get_staff_directory');
        if (error) throw error;

        // CockroachDB returns set-returning RPCs as row arrays after the
        // gateway's explicit SELECT * handling. Keep this defensive because
        // older deployments may return JSON text or one row object.
        let rows: unknown = data;
        if (typeof rows === 'string') {
          try { rows = JSON.parse(rows); } catch { rows = []; }
        }
        if (!Array.isArray(rows) && rows && typeof rows === 'object') rows = [rows];
        const activeStaff = (Array.isArray(rows) ? rows : [])
          .filter((row): row is StaffRow & { status?: string } => Boolean(row && typeof row === 'object'))
          .filter((row) => row.status === 'active')
          .sort((a, b) => (a.first_name || '').localeCompare(b.first_name || '')) as StaffRow[];

        if (mounted) setStaff(activeStaff);
      } catch (err) {
        logError('fetchStaffDirectory', err);
        if (mounted) {
          setStaff([]);
          setLoadError('Unable to load staff members. Please refresh and try again.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchStaff();
    return () => { mounted = false; };
  }, []);

  return (
    <div className="mt-4 p-4 rounded-lg bg-success/5 border border-success/20 animate-fade-in">
      <label className="text-sm font-medium mb-1.5 block">
        <Briefcase className="h-4 w-4 inline mr-1" />
        {label} *
      </label>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading staff…</p>
      ) : loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : staff.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active staff registered. Add staff in the Accountant module first.</p>
      ) : (
        <Select
          value={value}
          onValueChange={v => {
            const s = staff.find(x => x.id === v) || null;
            onChange(v, s);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select staff member" />
          </SelectTrigger>
          <SelectContent>
            {staff.map(s => (
              <SelectItem key={s.id} value={s.id}>
                {s.first_name} {s.last_name} — {s.employee_id} ({s.role})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {helper && <p className="text-xs text-muted-foreground mt-2">{helper}</p>}
    </div>
  );
}
