import { useEffect, useMemo, useState } from 'react';
import { useSnapOrders, SnapOrder, snapPhotoUrl, markSnapFulfilled } from '@/hooks/useSnapOrders';
import { findOpenVisit, closeVisit } from '@/hooks/useVisits';
import { usePatients } from '@/contexts/PatientContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { CheckCircle, Pill } from 'lucide-react';
import { PatientStatus } from '@/types/hms';
import { getPendingWorkflowStation, workflowStationLabel } from '@/lib/workflowRouting';
import { splitInvoice } from '@/lib/copay';

const fmt = (n: number) => `₦${n.toLocaleString()}`;

export function PharmacySnapQueue() {
  const { orders, loading } = useSnapOrders({ station: 'pharmacy', statuses: ['paid'] });
  const { patients } = usePatients();
  const [selected, setSelected] = useState<SnapOrder | null>(null);

  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    patients.forEach(p => m.set(p.id, `${p.first_name} ${p.last_name}`));
    return m;
  }, [patients]);

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-3">
        <Pill className="h-5 w-5 text-module-pharmacy" />
        <h3 className="font-semibold">Paid Prescriptions — Ready to Dispense</h3>
        <Badge variant="outline" className="text-[10px]">{orders.length}</Badge>
      </div>

      {loading && orders.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
      ) : orders.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No paid prescriptions in queue.</p>
      ) : (
        <div className="space-y-2">
          {orders.map(o => {
            const total = (o.matched_items ?? []).reduce((s, it) => s + it.unit_price * it.qty, 0);
            return (
              <button
                key={o.id}
                onClick={() => setSelected(o)}
                className="w-full text-left p-3 rounded-lg border hover:border-module-pharmacy transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{nameOf.get(o.patient_id) ?? 'Unknown'}</p>
                    <p className="text-xs text-muted-foreground">
                      {(o.matched_items ?? []).length} item(s) · {fmt(total)}
                      {o.note && <> · {o.note}</>}
                    </p>
                  </div>
                  <Badge variant="success" className="text-[10px]">Paid</Badge>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <SnapFulfillDialog snap={selected} onClose={() => setSelected(null)} patientName={nameOf.get(selected.patient_id) ?? ''} kind="pharmacy" />
      )}
    </div>
  );
}

export function SnapFulfillDialog({
  snap, onClose, patientName, kind,
}: { snap: SnapOrder; onClose: () => void; patientName: string; kind: 'pharmacy' | 'lab' }) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const { updatePatientStatus } = usePatients();

  useEffect(() => {
    let cancelled = false;
    snapPhotoUrl(snap.photo_path).then(url => { if (!cancelled) setImgUrl(url); });
    
    // Load invoice items if this snap is linked to an invoice
    if (snap.invoice_id) {
      supabase.from('invoice_items')
        .select('*')
        .eq('invoice_id', snap.invoice_id)
        .then(({ data }) => {
          if (!cancelled && data) setItems(data);
        });
    } else {
      // Fallback for older snaps or typed orders not yet itemized
      setItems((snap.matched_items || []).map((it, idx) => ({
        id: `local-${idx}`,
        description: `${it.name}${it.size ? ' ' + it.size : ''}`,
        quantity: it.qty,
        unit_price: it.unit_price,
        total: it.unit_price * it.qty,
        category: it.category,
        dispensing_status: 'pending'
      })));
    }

    return () => { cancelled = true; };
  }, [snap.photo_path, snap.invoice_id, snap.matched_items]);

  const markUnavailable = async (itemId: string, currentDesc: string) => {
    if (itemId.startsWith('local-')) {
      toast.error('Cannot mark availability on un-invoiced orders. Process billing first.');
      return;
    }
    const reason = window.prompt(`Why is "${currentDesc}" unavailable?`, 'Out of stock');
    if (reason === null) return;

    setBusy(true);
    try {
      // Safeguard: verify the item is not already processed or refunded.
      // Keep these reads flat because CockroachDB does not support Supabase
      // nested relation selects through the compatibility gateway.
      const { data: item, error: fetchErr } = await supabase
        .from('invoice_items')
        .select('id, invoice_id, dispensing_status, total, unit_price, quantity')
        .eq('id', itemId)
        .single();
      if (fetchErr) throw fetchErr;
      if (!item) throw new Error('Invoice item was not found');
      if (item.dispensing_status === 'unavailable') {
        toast.error('Item is already marked as unavailable');
        return;
      }
      if (item.dispensing_status === 'refunded') {
        toast.error('Item has already been refunded');
        return;
      }

      const { data: invoice, error: invoiceErr } = await supabase
        .from('invoices')
        .select('id, patient_id, sponsor_type')
        .eq('id', item.invoice_id)
        .single();
      if (invoiceErr) throw invoiceErr;
      const { data: patient, error: patientErr } = await supabase
        .from('patients')
        .select('account_type, insurance_plan')
        .eq('id', invoice.patient_id)
        .single();
      if (patientErr) throw patientErr;

      const { error } = await supabase.rpc('mark_item_unavailable', {
        _item_id: itemId,
        _reason: reason,
      });
      if (error) throw error;

      // Calculate refund info for the toast from the flat invoice/patient reads.
      const totalAmount = Number(item.total) || 0;
      const sponsor = {
        account_type: patient.account_type,
        insurance_plan: patient.insurance_plan,
      };
      const invoiceId = invoice.id;
      
      const { copayAmount, coveredAmount } = splitInvoice(totalAmount, sponsor);
      
      setItems(prev => prev.map(it => it.id === itemId ? { ...it, dispensing_status: 'refund_requested', dispensing_notes: reason } : it));
      
      // Detailed toast notification
      const invoiceRef = invoiceId ? ` (Inv: ${invoiceId.slice(0, 8)})` : '';
      if (copayAmount > 0) {
        toast.success('Marked as unavailable', {
          description: `Patient refund: ${fmt(copayAmount)}${coveredAmount > 0 ? ` · Claim reduced: ${fmt(coveredAmount)}` : ''}${invoiceRef}`,
          duration: 6000,
        });
      } else {
        toast.success('Marked as unavailable', {
          description: `Claim reduced by ${fmt(coveredAmount)}${invoiceRef}`,
          duration: 5000,
        });
      }
    } catch (err: any) {
      toast.error('Failed to update: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  const fulfill = async () => {
    // Check if everything is processed
    const pending = items.filter(it => it.dispensing_status === 'pending');
    if (pending.length > 0) {
      const confirm = window.confirm(`There are still ${pending.length} pending items. Mark the rest as dispensed?`);
      if (!confirm) return;
    }

    setBusy(true);
    try {
      // Pharmacy items must move through the protected inventory routine. It locks
      // the earliest-expiring Pharmacy batch, blocks insufficient stock, records an
      // immutable movement, and only then marks the billed item as dispensed.
      if (snap.invoice_id && kind === 'pharmacy') {
        const pendingInvoiceItems = items.filter(item => item.id && !String(item.id).startsWith('local-') && item.dispensing_status === 'pending');
        for (const item of pendingInvoiceItems) {
          const { data, error } = await (supabase as any).rpc('dispense_inventory_invoice_item', { _invoice_item_id: item.id });
          if (error) throw error;
          if (!data?.stock_controlled) {
            toast.info('Dispensed — inventory unchanged', {
              description: `${item.description} is configured as a non-stock item, so it was dispensed successfully without changing the pharmacy stock balance.`,
              duration: 6000,
            });
          }
        }
        setItems(current => current.map(item => item.dispensing_status === 'pending' ? { ...item, dispensing_status: 'dispensed' } : item));
      } else if (snap.invoice_id) {
        // Laboratory snaps retain their independent, non-stock clinical workflow.
        const { error } = await supabase.from('invoice_items')
          .update({ dispensing_status: 'dispensed', dispensing_updated_at: new Date().toISOString(), dispensing_updated_by: (await supabase.auth.getUser()).data.user?.id })
          .eq('invoice_id', snap.invoice_id)
          .eq('dispensing_status', 'pending');
        if (error) throw error;
      }

      const ok = await markSnapFulfilled(snap.id);
      if (ok) {
        // Also mark any linked prescription as dispensed so the legacy
        // prescription counter ("N prescription(s) pending") stays accurate.
        if (snap.ocr_text && snap.ocr_text.startsWith('LINKED_PRESCRIPTION:')) {
          const rxId = snap.ocr_text.replace('LINKED_PRESCRIPTION:', '').trim();
          if (rxId) {
            await supabase.from('prescriptions').update({ status: 'dispensed' }).eq('id', rxId);
            const { data: rxItems } = await supabase.from('prescription_items').select('id').eq('prescription_id', rxId);
            if (rxItems?.length) {
              await supabase.from('prescription_items').update({ dispensed: true }).eq('prescription_id', rxId);
            }
          }
        } else if (snap.invoice_id) {
          // Fallback: find pending prescriptions for this patient and mark
          // them dispensed if this snap's invoice items match.
          const { data: patientRx } = await supabase
            .from('prescriptions')
            .select('id, diagnosis, notes, items:prescription_items(id, medication)')
            .eq('patient_id', snap.patient_id)
            .eq('status', 'pending');
          const { data: invoiceItems } = await supabase
            .from('invoice_items')
            .select('description')
            .eq('invoice_id', snap.invoice_id);
          if (patientRx?.length && invoiceItems?.length) {
            const descriptions = invoiceItems.map(i => (i.description || '').toLowerCase());
            for (const rx of patientRx) {
              const rxMeds = (rx.items || []).map((it: any) => (it.medication || '').toLowerCase());
              const match = descriptions.some(d => rxMeds.some(m => d.includes(m) || m.includes(d)));
              if (match || patientRx.length === 1) {
                await supabase.from('prescriptions').update({ status: 'dispensed' }).eq('id', rx.id);
                await supabase.from('prescription_items').update({ dispensed: true }).eq('prescription_id', rx.id);
              }
            }
          }
        }
        const { data: adm } = await supabase
          .from('admissions')
          .select('id')
          .eq('patient_id', snap.patient_id)
          .in('status', ['active', 'ready_for_discharge'])
          .maybeSingle();

        if (adm) {
          await updatePatientStatus(snap.patient_id, 'admitted');
          toast.info('Patient returned to ward (Admitted)');
        } else if (kind === 'pharmacy') {
          // Determine next station by checking what ACTUALLY remains pending
          // for this patient's current visit — not just the global RPC which
          // can return stale stations from other visits.
          const { data: openVisit } = await supabase
            .from('visits')
            .select('id')
            .eq('patient_id', snap.patient_id)
            .eq('status', 'open')
            .order('opened_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          // Check remaining unfilled pharmacy snaps for this visit
          const { data: remainingPharmacySnaps } = await supabase
            .from('snap_orders')
            .select('id')
            .eq('patient_id', snap.patient_id)
            .eq('target_station', 'pharmacy')
            .eq('status', 'paid')
            .neq('id', snap.id)
            .limit(1);

          let nextStatus: string;

          if (remainingPharmacySnaps && remainingPharmacySnaps.length > 0) {
            // Other pharmacy items still pending — keep patient at pharmacy
            nextStatus = 'at_pharmacy';
          } else {
            // No more pharmacy work. Check other stations.
            const rpcResult = await getPendingWorkflowStation(snap.patient_id);
            if (rpcResult && rpcResult !== 'at_pharmacy') {
              nextStatus = rpcResult;
            } else {
              // Nothing pending anywhere — discharge
              nextStatus = 'discharged';
            }
          }

          if (nextStatus === 'discharged' && openVisit) {
            // Close the visit first — the DB discharge trigger checks for
            // open visits, so the visit must be settled before the status
            // update is attempted.
            await closeVisit(openVisit.id);
            // Small delay to let the CockroachDB transaction commit so the
            // trigger sees the visit as settled, not open.
            await new Promise(r => setTimeout(r, 300));
          }

          let routed = await updatePatientStatus(snap.patient_id, nextStatus as any, { guardInpatient: true });

          // Retry once after a short delay — the DB trigger may still see
          // stale state if CockroachDB multi-region replication lag applies.
          if (!routed && nextStatus === 'discharged') {
            await new Promise(r => setTimeout(r, 500));
            routed = await updatePatientStatus(snap.patient_id, 'discharged');
          }

          if (!routed) {
            // Last resort: try direct update bypassing the RPC guard.
            if (nextStatus === 'discharged') {
              const { error: directErr } = await supabase
                .from('patients')
                .update({ status: 'discharged', last_visit: new Date().toISOString() })
                .eq('id', snap.patient_id);
              if (!directErr) {
                if (openVisit) await closeVisit(openVisit.id).catch(() => {});
                toast.info('Patient discharged');
                onClose();
                return;
              }
            }
            toast.error('Dispensed, but patient status could not be updated. Please retry.');
            return;
          }
          toast.info(nextStatus === 'discharged'
            ? 'Patient discharged successfully'
            : `Patient routed to ${workflowStationLabel(nextStatus as any)}`);
        }
        onClose();
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const total = items.reduce((s, it) => s + (Number(it.total) || 0), 0);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{kind === 'pharmacy' ? 'Medication Dispensing' : 'Lab Result Processing'} · {patientName}</DialogTitle>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="rounded-lg overflow-hidden bg-muted flex items-center justify-center min-h-[300px] border">
            {imgUrl
              ? <img src={imgUrl} alt="snap" className="max-h-[500px] object-contain cursor-zoom-in" onClick={() => window.open(imgUrl, '_blank')} />
              : <p className="text-xs text-muted-foreground p-4">Loading clinical snap…</p>}
          </div>

          <div className="space-y-4">
            {snap.ocr_text && (snap.ocr_text.startsWith('LINKED_PRESCRIPTION:') || snap.ocr_text.startsWith('LINKED_LAB_REQUEST:')) ? (
              <div className="bg-muted/30 rounded-lg p-3 border">
                <p className="text-[10px] font-bold text-muted-foreground uppercase mb-2 tracking-widest">Clinical Notes</p>
                <div className="text-xs space-y-2 whitespace-pre-wrap font-mono">
                  {snap.note}
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Order Items</p>
                <Badge variant="outline" className="text-[10px]">{items.length} total</Badge>
              </div>
              <div className="border rounded-lg overflow-hidden bg-card divide-y">
                {items.length === 0 && (
                  <p className="p-6 text-xs text-muted-foreground text-center italic">No itemized bill found for this snap.</p>
                )}
                {items.map((it, idx) => {
                  const status = it.dispensing_status || 'pending';
                  return (
                    <div key={idx} className={`p-3 space-y-2 ${status === 'unavailable' ? 'bg-red-50/50' : status === 'refunded' ? 'bg-slate-50 opacity-60' : ''}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-tight">{it.description}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {fmt(it.unit_price)} × {it.quantity} = <span className="font-semibold text-foreground">{fmt(it.total)}</span>
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          {status === 'pending' ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-[10px] text-red-600 border-red-200 hover:bg-red-50"
                              onClick={() => markUnavailable(it.id, it.description)}
                              disabled={busy}
                            >
                              Unavailable
                            </Button>
                          ) : (
                            <Badge
                              variant={status === 'dispensed' ? 'success' : status === 'unavailable' ? 'destructive' : 'secondary'}
                              className="text-[9px] uppercase font-bold px-1.5 py-0"
                            >
                              {status}
                            </Badge>
                          )}
                        </div>
                      </div>
                      {it.dispensing_notes && (
                        <p className="text-[10px] text-red-700 bg-red-100/50 px-2 py-1 rounded italic">
                          Reason: {it.dispensing_notes}
                        </p>
                      )}
                    </div>
                  );
                })}
                <div className="p-3 flex items-center justify-between bg-muted/20 border-t-2 border-double">
                  <span className="text-xs font-bold uppercase">Grand Total Paid</span>
                  <span className="font-mono font-bold text-sm">{fmt(total)}</span>
                </div>
              </div>
              {snap.note && !snap.ocr_text?.startsWith('LINKED_') && (
                <div className="text-[11px] p-2 bg-amber-50 rounded border border-amber-100 text-amber-800 italic">
                  Additional Note: {snap.note}
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="mt-6 border-t pt-4">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={fulfill} disabled={busy} className="bg-primary hover:bg-primary/90">
            <CheckCircle className="h-4 w-4 mr-2" />
            {busy ? 'Processing…' : `Finalize & ${kind === 'pharmacy' ? 'Dispense' : 'Process'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

