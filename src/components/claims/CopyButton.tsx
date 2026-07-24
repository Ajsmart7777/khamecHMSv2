import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Check, Copy } from 'lucide-react';
import { copyToClipboard } from '@/lib/hmoAuth';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function CopyButton({
  value,
  label,
  className,
  size = 'icon',
}: {
  value: string | null | undefined;
  label?: string;
  className?: string;
  size?: 'icon' | 'sm';
}) {
  const [copied, setCopied] = useState(false);
  const disabled = !value;

  async function handle() {
    if (!value) return;
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopied(true);
      toast.success(`${label ?? 'Value'} copied`);
      setTimeout(() => setCopied(false), 1200);
    } else {
      toast.error('Could not copy');
    }
  }

  if (size === 'sm') {
    return (
      <Button type="button" variant="outline" size="sm" onClick={handle} disabled={disabled} className={cn('h-7 gap-1 text-xs', className)}>
        {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={handle}
      disabled={disabled}
      title={label ? `Copy ${label}` : 'Copy'}
      className={cn('h-7 w-7 text-muted-foreground hover:text-foreground', className)}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}