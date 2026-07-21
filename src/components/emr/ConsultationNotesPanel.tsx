import { useState } from 'react';
import { format } from 'date-fns';
import { Plus, ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useConsultationNotes } from '@/hooks/useConsultationNotes';
import { useAuth } from '@/contexts/AuthContext';
import { NewConsultationDialog } from './NewConsultationDialog';

const DOCTOR_ROLES = ['doctor', 'doctor1', 'doctor2', 'admin'];

export function ConsultationNotesPanel({ patientId }: { patientId: string }) {
  const { notes, loading, createNote } = useConsultationNotes(patientId);
  const { role } = useAuth();
  const [open, setOpen] = useState(false);
  const canWrite = role && DOCTOR_ROLES.includes(role);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Consultation Notes</h3>
        {canWrite && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> New consultation
          </Button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-6">Loading...</p>
      ) : notes.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <ClipboardList className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No consultation notes yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <Card key={n.id} className="p-4">
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">
                    {format(new Date(n.visit_date), 'MMM dd, yyyy • h:mm a')}
                  </span>
                  {n.icd10_code && <Badge variant="outline" className="text-xs">ICD-10: {n.icd10_code}</Badge>}
                  {n.follow_up_date && (
                    <Badge variant="secondary" className="text-xs">
                      Follow-up: {format(new Date(n.follow_up_date), 'MMM dd')}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                {n.subjective && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Subjective</p>
                    <p className="whitespace-pre-wrap">{n.subjective}</p>
                  </div>
                )}
                {n.objective && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Objective</p>
                    <p className="whitespace-pre-wrap">{n.objective}</p>
                  </div>
                )}
                {n.assessment && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Assessment</p>
                    <p className="whitespace-pre-wrap">{n.assessment}</p>
                  </div>
                )}
                {n.plan && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Plan</p>
                    <p className="whitespace-pre-wrap">{n.plan}</p>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <NewConsultationDialog
        open={open}
        onOpenChange={setOpen}
        patientId={patientId}
        onSubmit={createNote}
      />
    </div>
  );
}
