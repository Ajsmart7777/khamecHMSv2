import { useMemo, useState } from 'react';
import { Search, User } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { usePatients, Patient } from '@/contexts/PatientContext';
import { cn } from '@/lib/utils';

interface Props {
  selectedId?: string;
  onSelect: (patient: Patient) => void;
}

export function PatientSearchBar({ selectedId, onSelect }: Props) {
  const { patients } = usePatients();
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return patients.slice(0, 12);
    return patients
      .filter(
        (p) =>
          p.first_name?.toLowerCase().includes(term) ||
          p.last_name?.toLowerCase().includes(term) ||
          p.card_number?.toLowerCase().includes(term) ||
          p.mini_card_number?.toLowerCase().includes(term) ||
          p.phone?.toLowerCase().includes(term),
      )
      .slice(0, 20);
  }, [patients, q]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, card #, or phone"
          className="pl-9"
        />
      </div>
      <div className="space-y-1 max-h-[70vh] overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No patients found</p>
        ) : (
          filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelect(p)}
              className={cn(
                'w-full text-left p-3 rounded-lg border transition-colors flex items-center gap-3',
                selectedId === p.id
                  ? 'bg-primary/10 border-primary'
                  : 'bg-card border-border hover:bg-muted/50',
              )}
            >
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                <User className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {p.first_name} {p.last_name}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {p.card_number} • {p.phone}
                </p>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
