import { useEffect, useState } from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { computeExpiry, type ExpiryStatus } from '@/lib/hmoAuth';

/** Live 72-hour countdown badge from a visit's opened_at. */
export function ExpiryBadge({
  openedAt,
  className,
  compact = false,
}: {
  openedAt?: string | null;
  className?: string;
  compact?: boolean;
}) {
  const [status, setStatus] = useState<ExpiryStatus>(() => computeExpiry(openedAt));

  useEffect(() => {
    setStatus(computeExpiry(openedAt));
    const id = setInterval(() => setStatus(computeExpiry(openedAt)), 60_000);
    return () => clearInterval(id);
  }, [openedAt]);

  if (!openedAt) return null;

  const tone = status.tone;
  const styles: Record<ExpiryStatus['tone'], string> = {
    ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-800 border-amber-300',
    critical: 'bg-orange-100 text-orange-800 border-orange-400 animate-pulse',
    expired: 'bg-red-100 text-red-800 border-red-500 animate-pulse font-semibold',
  };
  const Icon = tone === 'expired' || tone === 'critical' ? AlertTriangle : Clock;

  return (
    <span
      title={`72-hour claim window (from check-in)`}
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] leading-none whitespace-nowrap',
        styles[tone],
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {compact
        ? (status.expired ? 'EXPIRED' : status.hoursLeft >= 1 ? `${status.hoursLeft}h` : `${status.minutesLeft}m`)
        : (tone === 'expired' ? `⚠️ ${status.label}` : tone === 'critical' ? `⚠️ ${status.label}` : status.label)}
    </span>
  );
}