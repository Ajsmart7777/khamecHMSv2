import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowUpRight } from 'lucide-react';
import { StockRequest } from '@/hooks/useInventory';
import { toast } from 'sonner';

interface StockRequestsPanelProps {
  requests: StockRequest[];
  onApprove: (id: string) => Promise<boolean>;
  onReject: (id: string) => Promise<boolean>;
  onFulfill: (id: string) => Promise<boolean>;
}

export function StockRequestsPanel({ requests, onApprove, onReject, onFulfill }: StockRequestsPanelProps) {
  const pendingRequests = requests.filter(r => r.status === 'pending' || r.status === 'approved');
  const completedRequests = requests.filter(r => r.status === 'fulfilled' || r.status === 'rejected');

  return (
    <div className="space-y-6">
      {/* Pending */}
      <div className="bg-card rounded-xl border border-border">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <ArrowUpRight className="h-5 w-5 text-module-store" />
            Pending Requests
          </h3>
          {pendingRequests.length > 0 && <Badge variant="warning">{pendingRequests.length}</Badge>}
        </div>
        <div className="divide-y divide-border">
          {pendingRequests.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No pending requests</div>
          ) : (
            pendingRequests.map((req) => (
              <div key={req.id} className="p-4 animate-fade-in">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="store">{req.requested_by}</Badge>
                  <Badge variant={req.status === 'approved' ? 'success' : 'warning'}>{req.status}</Badge>
                </div>
                <p className="font-medium">{req.item_name} x{req.quantity}</p>
                {req.notes && <p className="text-sm text-muted-foreground mt-1">{req.notes}</p>}
                <p className="text-xs text-muted-foreground mt-1">{new Date(req.created_at).toLocaleDateString()}</p>
                {req.status === 'pending' && (
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" variant="success" className="flex-1 press-effect" onClick={() => onApprove(req.id).then(ok => ok && toast.success('Request Approved'))}>
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 press-effect" onClick={() => onReject(req.id).then(ok => ok && toast.info('Request Rejected'))}>
                      Reject
                    </Button>
                  </div>
                )}
                {req.status === 'approved' && (
                  <Button size="sm" variant="module" className="w-full mt-3 press-effect" onClick={() => onFulfill(req.id).then(ok => ok && toast.success('Request Fulfilled'))}>
                    Mark as Fulfilled
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Completed */}
      {completedRequests.length > 0 && (
        <div className="bg-card rounded-xl border border-border">
          <div className="p-4 border-b border-border">
            <h3 className="font-semibold text-sm text-muted-foreground">Recent Completed ({completedRequests.length})</h3>
          </div>
          <div className="divide-y divide-border max-h-64 overflow-y-auto">
            {completedRequests.slice(0, 10).map((req) => (
              <div key={req.id} className="p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{req.item_name} x{req.quantity}</p>
                  <p className="text-xs text-muted-foreground">{req.requested_by} • {new Date(req.created_at).toLocaleDateString()}</p>
                </div>
                <Badge variant={req.status === 'fulfilled' ? 'success' : 'secondary'}>{req.status}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
