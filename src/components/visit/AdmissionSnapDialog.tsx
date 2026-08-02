import { useEffect, useState } from 'react';
import { Beaker, FileImage, Pill, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { snapPhotoUrl } from '@/hooks/useSnapOrders';
import { forwardSnapToBilling } from '@/hooks/useAdmissions';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  patientName: string;
  /** Fallback photo path stored on the admission row. */
  fallbackPath?: string | null;
  onChanged?: () => void;
}

interface AdmissionSnap {
  id: string;
  photo_path: string;
  note: string | null;
  ack_at: string | null;
  created_at: string;
}

/**
 * Viewer for the FIRST admission snap (the admission-order photo taken at
 * "Snap to Admit"). From here it can be routed once — to Pharmacy or Lab via
 * Billing — or simply left on the patient's card.
 */
export function AdmissionSnapDialog({
  open, onOpenChange, patientId, patientName, fallbackPath, onChanged,
}: Props) {
  const [snap, setSnap] = useState<AdmissionSnap | null>(null);
  const [routedTo, setRoutedTo] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('snap_orders')
      .select('id, photo_path, note, ack_at, created_at')
      .eq('patient_id', patientId)
      .eq('intent', 'admission_order')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const s = (data ?? null) as AdmissionSnap | null;
    setSnap(s);
    if (s) {
      const { data: kids } = await supabase
        .from('snap_orders')
        .select('target_station')
        .eq('parent_snap_id', s.id)
        .limit(1);
      setRoutedTo((kids?.[0] as any)?.target_station ?? null);
    }
    setUrl(await snapPhotoUrl(s?.photo_path ?? fallbackPath ?? ''));
    setLoading(false);
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patientId]);

  const used = !!snap && (!!snap.ack_at || !!routedTo);

  const route = async (target: 'pharmacy' | 'lab') => {
    if (!snap) return;
    setBusy(true);
    const id = await forwardSnapToBilling(snap.id, target, 'Admission order snap');
    setBusy(false);
    if (!id) return;
    onChanged?.();
    onOpenChange(false);
  };

  const keepInCard = async () => {
    if (!snap) return;
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('snap_orders')
      .update({ status: 'acknowledged', ack_by: u.user?.id ?? null, ack_at: new Date().toISOString() })
      .eq('id', snap.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Kept on the patient card — no station routing');
    onChanged?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileImage className="h-4 w-4" /> Admission Snap · {patientName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
          ) : url ? (
            <div className="rounded-lg overflow-hidden bg-muted flex items-center justify-center max-h-[55vh]">
              <img src={url} alt={`Admission order for ${patientName}`} className="max-h-[55vh] object-contain" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-6 text-center">No admission snap on file.</p>
          )}

          {snap?.note && <p className="text-sm text-muted-foreground">Note: {snap.note}</p>}

          {used && (
            <Badge variant="outline" className="text-[10px]">
              {routedTo ? `Already routed → ${routedTo}` : 'Kept on patient card'} · single-use, take a new snap for further orders
            </Badge>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {snap && !used ? (
            <>
              <Button variant="ghost" onClick={keepInCard} disabled={busy}>Leave in card</Button>
              <Button variant="outline" onClick={() => route('lab')} disabled={busy}>
                <Beaker className="h-4 w-4 mr-1.5" /> Send to Lab
              </Button>
              <Button onClick={() => route('pharmacy')} disabled={busy}>
                <Pill className="h-4 w-4 mr-1.5" /> Send to Pharmacy
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
