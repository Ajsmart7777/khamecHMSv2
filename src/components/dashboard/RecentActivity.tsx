import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ClipboardList } from 'lucide-react';

interface AuditLog {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  status: string;
  created_at: string;
  user_id: string | null;
}

interface RecentActivityProps {
  logs: AuditLog[];
}

export function RecentActivity({ logs = [] }: RecentActivityProps) {
  if (logs.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-3 sm:p-4 md:p-6">
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <h3 className="text-sm sm:text-base font-semibold text-foreground">Recent Activity</h3>
          <a href="/auditing" className="text-xs sm:text-sm text-primary hover:underline">View all</a>
        </div>
        <div className="py-8 text-center text-muted-foreground">
          <ClipboardList className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No recent activity</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border p-3 sm:p-4 md:p-6">
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <h3 className="text-sm sm:text-base font-semibold text-foreground">Recent Activity</h3>
        <a href="/auditing" className="text-xs sm:text-sm text-primary hover:underline">View all</a>
      </div>

      <div className="space-y-4">
        {logs.map((log, index) => (
          <div
            key={log.id}
            className={cn(
              "flex items-start gap-4 pb-4 animate-slide-up",
              index < logs.length - 1 && "border-b border-border"
            )}
            style={{ animationDelay: `${index * 100}ms` }}
          >
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-sm">{log.action}</span>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {log.resource_type}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {log.resource_id ? `Resource: ${log.resource_id.slice(0, 8)}...` : 'System event'}
              </p>
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {new Date(log.created_at).toLocaleTimeString('en-NG', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
