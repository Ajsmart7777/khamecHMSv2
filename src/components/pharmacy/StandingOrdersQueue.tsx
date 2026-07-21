import { useState } from 'react';
import { useStandingOrders, StandingOrder } from '@/hooks/useStandingOrders';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileImage, CheckCircle2, Loader2, ExternalLink, Stethoscope } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const statusColors: Record<string, string> = {
  pending_fulfillment: 'bg-warning/10 text-warning border-warning/30',
  transcribed: 'bg-info/10 text-info border-info/30',
  fulfilled: 'bg-success/10 text-success border-success/30',
  expired: 'bg-muted text-muted-foreground',
};

export function StandingOrdersQueue({ actorRole = 'pharmacist' }: { actorRole?: 'pharmacist' | 'doctor' | 'admin' | 'receptionist' }) {
  const [statusFilter, setStatusFilter] = useState<string>('pending_fulfillment');
  const { orders, loading, updateOrderStatus, getSignedPhotoUrl } = useStandingOrders(statusFilter === 'all' ? undefined : statusFilter);
  const [viewingUrl, setViewingUrl] = useState<string | null>(null);
  const [viewingOrder, setViewingOrder] = useState<StandingOrder | null>(null);

  const openPhoto = async (order: StandingOrder) => {
    const url = await getSignedPhotoUrl(order.photo_url);
    if (url) {
      setViewingUrl(url);
      setViewingOrder(order);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Stethoscope className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">External Standing Orders</h3>
          <Badge variant="outline">{orders.length}</Badge>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pending_fulfillment">Pending fulfillment</SelectItem>
            <SelectItem value="transcribed">Transcribed</SelectItem>
            <SelectItem value="fulfilled">Fulfilled</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">
          <Loader2 className="h-6 w-6 mx-auto animate-spin" />
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground border rounded-lg">
          <FileImage className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No standing orders in this status</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {orders.map(order => (
            <div key={order.id} className="rounded-lg border p-4 bg-card">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium">
                    {order.patient?.first_name} {order.patient?.last_name}
                    <span className="text-xs text-muted-foreground font-mono ml-2">{order.patient?.card_number}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Prescribed by {order.external_doctor?.name || order.external_doctor_name || 'Unknown'}
                    {order.external_doctor?.specialty ? ` (${order.external_doctor.specialty})` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Captured {formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}
                    {order.expiry_date ? ` · Expires ${order.expiry_date}` : ''}
                  </p>
                  {order.notes && <p className="text-xs mt-1">{order.notes}</p>}
                </div>
                <Badge className={statusColors[order.status] || ''}>{order.status.replace(/_/g, ' ')}</Badge>
              </div>

              <div className="flex flex-wrap gap-2 mt-3">
                <Button size="sm" variant="outline" onClick={() => openPhoto(order)}>
                  <FileImage className="h-4 w-4 mr-1.5" /> View photo
                </Button>
                {order.status === 'pending_fulfillment' && (actorRole === 'doctor' || actorRole === 'admin') && (
                  <Button size="sm" variant="secondary" onClick={() => updateOrderStatus(order.id, 'transcribed')}>
                    Mark transcribed
                  </Button>
                )}
                {order.status !== 'fulfilled' && order.status !== 'expired' && (actorRole === 'pharmacist' || actorRole === 'admin') && (
                  <Button size="sm" onClick={() => updateOrderStatus(order.id, 'fulfilled')}>
                    <CheckCircle2 className="h-4 w-4 mr-1.5" /> Mark fulfilled
                  </Button>
                )}
                {order.status !== 'expired' && actorRole === 'admin' && (
                  <Button size="sm" variant="outline" onClick={() => updateOrderStatus(order.id, 'expired')}>
                    Expire
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!viewingUrl} onOpenChange={(o) => { if (!o) { setViewingUrl(null); setViewingOrder(null); } }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Standing Order Photo
              {viewingUrl && (
                <a href={viewingUrl} target="_blank" rel="noreferrer" className="text-primary text-sm flex items-center gap-1 ml-auto">
                  Open <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </DialogTitle>
          </DialogHeader>
          {viewingOrder && (
            <p className="text-sm text-muted-foreground">
              {viewingOrder.patient?.first_name} {viewingOrder.patient?.last_name} · {viewingOrder.external_doctor?.name || viewingOrder.external_doctor_name}
            </p>
          )}
          {viewingUrl && (
            <div className="bg-muted rounded-lg overflow-hidden">
              <img src={viewingUrl} alt="Prescription" className="w-full max-h-[70vh] object-contain" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}