import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Camera, Trash2, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useVisitAttachments, signedUrl, deleteVisitAttachment, VisitAttachment } from '@/hooks/useVisitAttachments';
import { useAuth } from '@/contexts/AuthContext';

const stationColors: Record<string, string> = {
  reception: 'bg-slate-500',
  nurse: 'bg-rose-500',
  doctor1: 'bg-blue-500',
  doctor2: 'bg-blue-500',
  lab: 'bg-emerald-500',
  pharmacy: 'bg-violet-500',
  billing: 'bg-amber-500',
  cashier: 'bg-orange-500',
  other: 'bg-gray-500',
};

function Thumb({ att, canDelete, onDelete }: { att: VisitAttachment; canDelete: boolean; onDelete: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    signedUrl(att.storage_path).then((u) => {
      if (active) setUrl(u);
    });
    return () => {
      active = false;
    };
  }, [att.storage_path]);

  return (
    <div className="group relative rounded-lg border border-border bg-card overflow-hidden">
      <div className="relative aspect-[3/4] bg-muted">
        {url ? (
          <img src={url} alt={att.label ?? 'attachment'} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <Camera className="h-6 w-6 opacity-40" />
          </div>
        )}
        <div className="absolute top-2 left-2">
          <Badge className={`${stationColors[att.station] ?? 'bg-gray-500'} text-white border-0 text-[10px] capitalize`}>
            {att.station}
          </Badge>
        </div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-black/40 flex items-center justify-center transition-opacity"
          >
            <ExternalLink className="h-6 w-6 text-white" />
          </a>
        )}
      </div>
      <div className="p-2 space-y-0.5">
        <p className="text-xs font-medium truncate">{att.label || 'Unlabeled'}</p>
        <p className="text-[10px] text-muted-foreground">
          {format(new Date(att.captured_at), 'MMM d, HH:mm')}
        </p>
      </div>
      {canDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 bg-background/80 hover:bg-destructive hover:text-destructive-foreground"
          onClick={onDelete}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

export function VisitAttachmentGrid({ visitId }: { visitId: string }) {
  const { attachments, loading, refresh } = useVisitAttachments(visitId);
  const { role } = useAuth();
  const canDelete = role === 'admin';

  if (loading) return <p className="text-sm text-muted-foreground text-center py-6">Loading photos…</p>;
  if (attachments.length === 0) {
    return (
      <div className="text-center py-10 border border-dashed border-border rounded-lg text-muted-foreground">
        <Camera className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No photos yet. Use "Snap to Card" from any station to add one.</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {attachments.map((att) => (
        <Thumb
          key={att.id}
          att={att}
          canDelete={canDelete}
          onDelete={async () => {
            if (!confirm('Delete this attachment?')) return;
            const ok = await deleteVisitAttachment(att);
            if (ok) refresh();
          }}
        />
      ))}
    </div>
  );
}
