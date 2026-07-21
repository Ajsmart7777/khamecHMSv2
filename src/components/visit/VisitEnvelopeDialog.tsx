import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Visit } from '@/hooks/useVisits';
import { VisitAttachmentGrid } from './VisitAttachmentGrid';
import { VisitTimeline } from './VisitTimeline';
import { Activity, Pill, FlaskConical, Receipt } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  visit: Visit | null;
}

export function VisitEnvelopeDialog({ open, onOpenChange, visit }: Props) {
  const [vitals, setVitals] = useState<any[]>([]);
  const [rx, setRx] = useState<any[]>([]);
  const [labs, setLabs] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);

  useEffect(() => {
    if (!visit || !open) return;
    (async () => {
      const [v, p, l, i] = await Promise.all([
        supabase.from('vitals').select('*').eq('visit_id', visit.id).order('created_at', { ascending: false }),
        supabase.from('prescriptions').select('*, prescription_items(*)').eq('visit_id', visit.id).order('created_at', { ascending: false }),
        supabase.from('lab_requests').select('*').eq('visit_id', visit.id).order('created_at', { ascending: false }),
        supabase.from('invoices').select('*').eq('visit_id', visit.id).order('created_at', { ascending: false }),
      ]);
      setVitals(v.data ?? []);
      setRx(p.data ?? []);
      setLabs(l.data ?? []);
      setInvoices(i.data ?? []);
    })();
  }, [visit, open]);

  if (!visit) return null;

  const outstanding = Number(visit.total_charged) - Number(visit.total_paid);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span className="font-mono">{visit.visit_number}</span>
            <Badge variant={visit.status === 'open' ? 'default' : visit.status === 'settled' ? 'secondary' : 'destructive'}>
              {visit.status}
            </Badge>
            {visit.sponsor_type && visit.sponsor_type !== 'normal' && (
              <Badge variant="outline" className="capitalize">{visit.sponsor_type.replace('_', ' ')}</Badge>
            )}
            {visit.insurance_plan && <Badge variant="outline" className="text-xs">{visit.insurance_plan}</Badge>}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div className="p-3 rounded-lg border border-border">
            <p className="text-xs text-muted-foreground">Opened</p>
            <p className="text-sm font-medium">{format(new Date(visit.opened_at), 'MMM d, HH:mm')}</p>
          </div>
          <div className="p-3 rounded-lg border border-border">
            <p className="text-xs text-muted-foreground">Closed</p>
            <p className="text-sm font-medium">
              {visit.closed_at ? format(new Date(visit.closed_at), 'MMM d, HH:mm') : '—'}
            </p>
          </div>
          <div className="p-3 rounded-lg border border-border">
            <p className="text-xs text-muted-foreground">Total charged</p>
            <p className="text-sm font-semibold">₦{Number(visit.total_charged).toLocaleString()}</p>
          </div>
          <div className="p-3 rounded-lg border border-border">
            <p className="text-xs text-muted-foreground">Outstanding</p>
            <p className={`text-sm font-semibold ${outstanding > 0 ? 'text-destructive' : 'text-emerald-600'}`}>
              ₦{outstanding.toLocaleString()}
            </p>
          </div>
        </div>

        {visit.presenting_complaint && (
          <div className="mb-3 p-3 rounded-lg bg-muted/50 border border-border">
            <p className="text-xs text-muted-foreground mb-1">Presenting complaint</p>
            <p className="text-sm">{visit.presenting_complaint}</p>
          </div>
        )}

        <Tabs defaultValue="photos">
          <TabsList>
            <TabsTrigger value="photos">Photos</TabsTrigger>
            <TabsTrigger value="entries">Structured Entries</TabsTrigger>
          </TabsList>

          <TabsContent value="photos" className="mt-3">
            <VisitAttachmentGrid visitId={visit.id} />
          </TabsContent>

          <TabsContent value="entries" className="mt-3 space-y-3">
            <Section icon={Activity} title="Vitals" empty={vitals.length === 0}>
              {vitals.map((v) => (
                <p key={v.id} className="text-xs">
                  {format(new Date(v.created_at), 'MMM d, HH:mm')} — BP {v.blood_pressure ?? '—'}, T {v.temperature ?? '—'}°C, P {v.pulse ?? '—'}
                </p>
              ))}
            </Section>
            <Section icon={Pill} title="Prescriptions" empty={rx.length === 0}>
              {rx.map((r) => (
                <div key={r.id} className="text-xs">
                  <p className="font-medium">{r.diagnosis || 'Prescription'}</p>
                  {r.prescription_items?.length > 0 && (
                    <p className="text-muted-foreground">{r.prescription_items.map((m: any) => m.medication).join(', ')}</p>
                  )}
                </div>
              ))}
            </Section>
            <Section icon={FlaskConical} title="Lab requests" empty={labs.length === 0}>
              {labs.map((l) => (
                <p key={l.id} className="text-xs">
                  {(l.tests as string[] || []).join(', ')} — <span className="capitalize">{l.status}</span>
                </p>
              ))}
            </Section>
            <Section icon={Receipt} title="Invoices & payments" empty={invoices.length === 0}>
              {invoices.map((i) => (
                <p key={i.id} className="text-xs">
                  {i.invoice_number} — ₦{Number(i.total_amount).toLocaleString()} · paid ₦{Number(i.paid_amount).toLocaleString()} ({i.status})
                </p>
              ))}
            </Section>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function Section({ icon: Icon, title, empty, children }: { icon: any; title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-primary" />
        <h4 className="text-sm font-semibold">{title}</h4>
      </div>
      {empty ? <p className="text-xs text-muted-foreground">None recorded.</p> : <div className="space-y-1">{children}</div>}
    </div>
  );
}
