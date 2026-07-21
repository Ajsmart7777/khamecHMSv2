import { useState } from 'react';
import { format } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FolderOpen, Camera } from 'lucide-react';
import { usePatientVisits, Visit } from '@/hooks/useVisits';
import { VisitEnvelopeDialog } from './VisitEnvelopeDialog';
import { SnapToCard } from './SnapToCard';

export function PatientVisitsPanel({ patientId }: { patientId: string }) {
  const { visits, loading } = usePatientVisits(patientId);
  const [openVisit, setOpenVisit] = useState<Visit | null>(null);

  if (loading) return <p className="text-sm text-muted-foreground text-center py-6">Loading visits…</p>;

  if (visits.length === 0) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        <FolderOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No visits yet. Check the patient in from Reception to open a card.</p>
      </Card>
    );
  }

  const openOne = visits.find((v) => v.status === 'open');

  return (
    <div className="space-y-3">
      {openOne && (
        <div className="flex justify-end">
          <SnapToCard patientId={patientId} station="other" defaultLabel="Card note" />
        </div>
      )}

      {visits.map((v) => {
        const outstanding = Number(v.total_charged) - Number(v.total_paid);
        return (
          <Card key={v.id} className="p-3 hover:border-primary/50 transition-colors cursor-pointer" onClick={() => setOpenVisit(v)}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-semibold">{v.visit_number}</span>
                  <Badge variant={v.status === 'open' ? 'default' : v.status === 'settled' ? 'secondary' : 'destructive'}>
                    {v.status}
                  </Badge>
                  {v.sponsor_type && v.sponsor_type !== 'normal' && (
                    <Badge variant="outline" className="capitalize text-xs">{v.sponsor_type.replace('_', ' ')}</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Opened {format(new Date(v.opened_at), 'MMM d, yyyy · HH:mm')}
                  {v.closed_at && ` · Closed ${format(new Date(v.closed_at), 'MMM d, HH:mm')}`}
                </p>
                {v.presenting_complaint && (
                  <p className="text-xs mt-1 line-clamp-1">{v.presenting_complaint}</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Charged</p>
                <p className="text-sm font-semibold">₦{Number(v.total_charged).toLocaleString()}</p>
                {outstanding > 0 && <p className="text-xs text-destructive">Owing ₦{outstanding.toLocaleString()}</p>}
              </div>
            </div>
          </Card>
        );
      })}

      <VisitEnvelopeDialog open={!!openVisit} onOpenChange={(o) => !o && setOpenVisit(null)} visit={openVisit} />
    </div>
  );
}
