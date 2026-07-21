import { useEffect, useMemo, useState } from 'react';
import { FlaskConical, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePatients } from '@/contexts/PatientContext';
import { SnapOrder, snapPhotoUrl } from '@/hooks/useSnapOrders';
import { toast } from 'sonner';

/**
 * "Returned from Lab" inbox for the current doctor/nurse.
 * Shows snap_orders where order_type='lab_result' and returned_to = current user.
 */
export function LabResultInbox() {
  const { user } = useAuth();
  const { patients } = usePatients();
  const [items, setItems] = useState<SnapOrder[]>([]);
  const [selected, setSelected] = useState<SnapOrder | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    patients.forEach((p) => m.set(p.id, `${p.first_name} ${p.last_name}`));
    return m;
  }, [patients]);

  const refresh = async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('snap_orders')
      .select('*')
      .eq('order_type', 'lab_result')
      .eq('returned_to', user.id)
      .in('status', ['returned'])
      .order('returned_at', { ascending: false });
    setItems(((data ?? []) as unknown) as SnapOrder[]);
  };

  useEffect(() => { refresh(); }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const ch = supabase
      .channel(`lab-return-${user.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'snap_orders',
      }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id]);

  useEffect(() => {
    if (!selected) { setSignedUrl(null); return; }
    snapPhotoUrl(selected.photo_path).then(setSignedUrl);
  }, [selected]);

  const acknowledge = async (id: string) => {
    const { error } = await supabase
      .from('snap_orders')
      .update({ status: 'acknowledged', ack_by: user?.id, ack_at: new Date().toISOString() } as any)
      .eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Result acknowledged');
    if (selected?.id === id) setSelected(null);
    refresh();
  };

  return (
    <div className="bg-card rounded-xl border p-4">
      <div className="flex items-center gap-2 mb-3">
        <FlaskConical className="h-5 w-5 text-module-laboratory" />
        <h3 className="font-semibold">Returned from Lab</h3>
        <Badge variant="outline" className="text-[10px]">{items.length}</Badge>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No new lab results.</p>
      ) : (
        <div className="space-y-2">
          {items.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelected(s)}
              className="w-full text-left p-3 rounded-lg border hover:border-module-laboratory transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{nameOf.get(s.patient_id) ?? 'Unknown'}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {new Date(s.returned_at ?? s.created_at).toLocaleString()}
                    {s.note && <> · {s.note}</>}
                  </p>
                </div>
                <Badge variant="success" className="text-[10px]">New</Badge>
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Lab Result — {selected && nameOf.get(selected.patient_id)}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              {signedUrl ? (
                <div className="rounded-lg overflow-hidden bg-muted flex items-center justify-center max-h-[60vh]">
                  <img src={signedUrl} alt="lab result" className="max-h-[60vh] object-contain" />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Loading photo…</p>
              )}
              {selected.note && (
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-xs font-medium">Lab note</p>
                  <p className="text-sm">{selected.note}</p>
                </div>
              )}
              <div className="flex justify-end">
                <Button onClick={() => acknowledge(selected.id)}>
                  <Check className="h-4 w-4 mr-1" /> Acknowledge
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
