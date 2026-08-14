import { useEffect, useMemo, useState } from 'react';
import { FlaskConical, Image as ImageIcon, FileText, Archive, Eye } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { createRealtimeChannel, supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { SnapOrder, snapPhotoUrl } from '@/hooks/useSnapOrders';

/**
 * Photo-based lab results (snap_orders with order_type = 'lab_result')
 * for a single patient — regardless of who requested or who they were
 * returned to. Used inside the "Lab Results" dialog so admitted-patient
 * lab snaps are always visible to nurse / doctor1 / doctor2.
 *
 * Once seen, a result can be archived (status -> 'acknowledged') so it stops
 * showing up as "New" in the Returned from Lab inbox.
 */
export function SnapLabResults({ patientId }: { patientId: string }) {
  const { user } = useAuth();
  const [items, setItems] = useState<SnapOrder[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);


  const refresh = async () => {
    const { data } = await supabase
      .from('snap_orders')
      .select('*')
      .eq('patient_id', patientId)
      .eq('order_type', 'lab_result')
      .order('created_at', { ascending: false });
    setItems(((data ?? []) as unknown) as SnapOrder[]);
    setLoading(false);
  };

  useEffect(() => { setLoading(true); refresh(); }, [patientId]);

  useEffect(() => {
    const ch = createRealtimeChannel(`snap-lab-results-${patientId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'snap_orders',
        filter: `patient_id=eq.${patientId}`,
      }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [patientId]);

  useEffect(() => {
    let active = true;
    Promise.all(items.filter((s) => s.photo_path).map(async (s) => [s.id, await snapPhotoUrl(s.photo_path)] as const))
      .then((pairs) => {
        if (!active) return;
        const next: Record<string, string> = {};
        pairs.forEach(([id, url]) => { if (url) next[id] = url; });
        setUrls(next);
      });
    return () => { active = false; };
  }, [items]);

  const archivedCount = useMemo(
    () => items.filter((s) => s.status === 'acknowledged').length,
    [items],
  );
  const visible = useMemo(
    () => (showArchived ? items : items.filter((s) => s.status !== 'acknowledged')),
    [items, showArchived],
  );

  const archive = async (id: string) => {
    setBusy(id);
    const { error } = await supabase
      .from('snap_orders')
      .update({ status: 'acknowledged', ack_by: user?.id, ack_at: new Date().toISOString() } as any)
      .eq('id', id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Result archived');
    refresh();
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground py-3">Loading lab result photos…</p>;
  }

  if (items.length === 0) return null;

  return (
    <div className="rounded-xl border p-3 space-y-3">
      <div className="flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-module-laboratory" />
        <h4 className="text-sm font-semibold">Results from Lab</h4>
        <Badge variant="outline" className="text-[10px]">{visible.length}</Badge>
        {archivedCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-xs"
            onClick={() => setShowArchived((v) => !v)}
          >
            <Eye className="h-3.5 w-3.5 mr-1" />
            {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
          </Button>
        )}
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">All results archived.</p>
      ) : (
        <div className="space-y-3">
          {visible.map((s) => (
            <div key={s.id} className="rounded-lg border overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/40">
                <p className="text-xs text-muted-foreground">
                  {new Date(s.returned_at ?? s.created_at).toLocaleString()}
                </p>
                <div className="flex items-center gap-2">
                  <Badge variant={s.status === 'returned' ? 'success' : 'outline'} className="text-[10px]">
                    {s.status === 'returned' ? 'New' : s.status === 'acknowledged' ? 'Archived' : s.status}
                  </Badge>
                  {s.status !== 'acknowledged' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={busy === s.id}
                      onClick={() => archive(s.id)}
                    >
                      <Archive className="h-3.5 w-3.5 mr-1" />
                      {busy === s.id ? 'Archiving…' : 'Archive'}
                    </Button>
                  )}
                </div>
              </div>
              {s.result_text ? (
                <div className="p-4 bg-module-laboratory/5 border-y border-module-laboratory/20">
                  <div className="flex items-center gap-2 mb-2 text-module-laboratory">
                    <FileText className="h-4 w-4" />
                    <span className="text-xs font-semibold uppercase tracking-wide">Typed laboratory result</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{s.result_text}</p>
                </div>
              ) : urls[s.id] ? (
                <a href={urls[s.id]} target="_blank" rel="noreferrer">
                  <img src={urls[s.id]} alt="Lab result" className="w-full max-h-[55vh] object-contain bg-muted" />
                </a>
              ) : (
                <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                  <ImageIcon className="h-4 w-4" /> {s.photo_path ? 'Loading result photo…' : 'No result attachment'}
                </div>
              )}
              {s.note && (
                <p className="px-3 py-2 text-sm border-t"><span className="font-medium">Lab note:</span> {s.note}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

