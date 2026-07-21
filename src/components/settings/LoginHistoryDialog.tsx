import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { Loader2, LogIn, LogOut, AlertCircle, ShieldCheck } from 'lucide-react';

interface LoginEvent {
  id: string;
  action: string;
  status: string;
  created_at: string;
  ip_address: string | null;
  user_agent: string | null;
}

interface LoginHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LoginHistoryDialog({ open, onOpenChange }: LoginHistoryDialogProps) {
  const { user, role } = useAuth();
  const [events, setEvents] = useState<LoginEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && user) {
      fetchLoginHistory();
    }
  }, [open, user]);

  const fetchLoginHistory = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Only admins can read audit_logs due to RLS
      if (role !== 'admin') {
        setError('Only administrators can view login history');
        setEvents([]);
        return;
      }

      const { data, error: fetchError } = await supabase
        .from('audit_logs')
        .select('id, action, status, created_at, ip_address, user_agent')
        .eq('user_id', user?.id)
        .in('action', ['login', 'logout', 'login_attempt', 'password_change', 'session_refresh'])
        .order('created_at', { ascending: false })
        .limit(50);

      if (fetchError) {
        throw fetchError;
      }

      setEvents(data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load login history');
    } finally {
      setIsLoading(false);
    }
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'login':
        return <LogIn className="h-4 w-4 text-green-500" />;
      case 'logout':
        return <LogOut className="h-4 w-4 text-muted-foreground" />;
      case 'login_attempt':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case 'password_change':
        return <ShieldCheck className="h-4 w-4 text-blue-500" />;
      default:
        return <LogIn className="h-4 w-4" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return <Badge variant="default" className="bg-green-500/10 text-green-500 hover:bg-green-500/20">Success</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const formatUserAgent = (ua: string | null) => {
    if (!ua) return 'Unknown device';
    // Simple browser detection
    if (ua.includes('Chrome')) return 'Chrome Browser';
    if (ua.includes('Firefox')) return 'Firefox Browser';
    if (ua.includes('Safari')) return 'Safari Browser';
    if (ua.includes('Edge')) return 'Edge Browser';
    return 'Web Browser';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Login History</DialogTitle>
          <DialogDescription>
            Recent authentication events for your account
          </DialogDescription>
        </DialogHeader>
        
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <ShieldCheck className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No login history available</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-3">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="flex items-start gap-3 p-3 rounded-lg border bg-card"
                >
                  <div className="mt-0.5">{getActionIcon(event.action)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium capitalize">
                        {event.action.replace('_', ' ')}
                      </span>
                      {getStatusBadge(event.status)}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {formatUserAgent(event.user_agent)}
                    </p>
                    {event.ip_address && (
                      <p className="text-xs text-muted-foreground">
                        IP: {event.ip_address}
                      </p>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground text-right shrink-0">
                    <div>{format(new Date(event.created_at), 'MMM d, yyyy')}</div>
                    <div>{format(new Date(event.created_at), 'h:mm a')}</div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
