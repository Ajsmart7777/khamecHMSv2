import { useRef, useState } from 'react';
import { Camera, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { SnapOrder } from '@/hooks/useSnapOrders';
import { useCanSnap } from '@/hooks/useCanSnap';
import { Lock } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  parentSnap: SnapOrder;
  onDone?: () => void;
}

/**
 * Lab tech snaps the result paper. The snap is routed back to the original
 * sender (doctor1 / doctor2 / nurse) as a `lab_result` snap.
 */
export function LabResultReturnButton({ parentSnap, onDone }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { allowed, reason, loading: checking } = useCanSnap(parentSnap.patient_id);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    e.target.value = '';
  };

  const close = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFile(null);
    setNote('');
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const path = `${parentSnap.visit_id ?? parentSnap.patient_id}/lab-result-${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from('visit-cards')
        .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
      if (upErr) throw upErr;

      const senderRole = parentSnap.source_role || 'doctor';
      const targetStation = senderRole.startsWith('doctor') ? 'doctor' : (senderRole === 'nurse' ? 'nurse' : 'doctor');

      const { data: userData } = await supabase.auth.getUser();

      const { error } = await supabase.from('snap_orders').insert({
        patient_id: parentSnap.patient_id,
        visit_id: parentSnap.visit_id,
        order_type: 'lab_result',
        target_station: targetStation as any,
        source_role: 'lab',
        original_sender_role: senderRole,
        parent_snap_id: parentSnap.id,
        photo_path: path,
        note: note.trim() || null,
        status: 'returned',
        returned_to: parentSnap.created_by,
        returned_at: new Date().toISOString(),
        created_by: userData.user?.id ?? null,
      } as any);
      if (error) throw error;

      toast.success('Result sent back', {
        description: `Delivered to ${senderRole}.`,
      });
      close();
      onDone?.();
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to return result');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" capture="environment"
        onChange={onFile} className="hidden" />
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-block">
              <Button
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={!allowed || checking}
                aria-disabled={!allowed}
              >
                {allowed ? <Camera className="h-4 w-4 mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
                Snap & Send Result
              </Button>
            </span>
          </TooltipTrigger>
          {!allowed && reason && (
            <TooltipContent side="top" className="max-w-xs">{reason}</TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>

      <Dialog open={!!previewUrl} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Send Lab Result</DialogTitle></DialogHeader>
          {previewUrl && (
            <div className="space-y-3">
              <div className="rounded-lg overflow-hidden bg-muted flex items-center justify-center max-h-[40vh]">
                <img src={previewUrl} alt="preview" className="max-h-[40vh] object-contain" />
              </div>
              <div>
                <Label>Note (optional)</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200}
                  placeholder="e.g. critical value, see red highlight" />
              </div>
              <p className="text-xs text-muted-foreground">
                This result will be delivered back to the requesting <span className="font-medium">{parentSnap.source_role}</span>.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={close} disabled={busy}>
              <X className="h-4 w-4 mr-1" /> Cancel
            </Button>
            <Button onClick={submit} disabled={busy}>
              <Send className="h-4 w-4 mr-1" /> {busy ? 'Sending…' : 'Send to Sender'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
