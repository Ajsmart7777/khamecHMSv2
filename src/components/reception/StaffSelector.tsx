import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { Briefcase } from 'lucide-react';

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

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('get_staff_directory');
      if (!error && data) {
        setStaff(
          (data as StaffRow[] & { status?: string }[])
            .filter((s: StaffRow & { status?: string }) => s.status === 'active')
            .sort((a, b) => (a.first_name || '').localeCompare(b.first_name || '')) as StaffRow[],
        );
      }

      setLoading(false);
    })();
  }, []);

  return (
    <div className="mt-4 p-4 rounded-lg bg-success/5 border border-success/20 animate-fade-in">
      <label className="text-sm font-medium mb-1.5 block">
        <Briefcase className="h-4 w-4 inline mr-1" />
        {label} *
      </label>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading staff…</p>
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
