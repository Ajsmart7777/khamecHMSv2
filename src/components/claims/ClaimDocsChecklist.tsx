import { CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ClaimRequirement } from '@/lib/claimRequirements';
import { isReadyToSubmit, missingCount } from '@/lib/claimRequirements';

export function ClaimDocsChecklist({ requirements }: { requirements: ClaimRequirement[] }) {
  const ready = isReadyToSubmit(requirements);
  const missing = missingCount(requirements);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Required documents</h3>
        {ready ? (
          <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white gap-1">
            <CheckCircle2 className="h-3 w-3" /> Ready to submit
          </Badge>
        ) : (
          <Badge variant="outline" className="border-amber-500 text-amber-700 gap-1">
            <AlertCircle className="h-3 w-3" /> {missing} required item{missing === 1 ? '' : 's'} missing
          </Badge>
        )}
      </div>

      <ul className="space-y-1.5">
        {requirements.map((r) => (
          <li
            key={r.id}
            className={cn(
              'flex items-start gap-2 p-2 rounded-md border text-sm',
              r.ok
                ? 'border-emerald-200 bg-emerald-50/60'
                : r.required
                ? 'border-amber-200 bg-amber-50/60'
                : 'border-slate-200 bg-slate-50/60'
            )}
          >
            {r.ok ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
            ) : r.required ? (
              <XCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn('font-medium', r.ok && 'text-emerald-800')}>{r.label}</span>
                {!r.required && (
                  <Badge variant="outline" className="text-[10px] uppercase">optional</Badge>
                )}
              </div>
              {!r.ok && r.hint && (
                <p className="text-xs text-muted-foreground mt-0.5">{r.hint}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}