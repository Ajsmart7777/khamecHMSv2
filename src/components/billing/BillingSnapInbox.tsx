import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useSnapOrders, SnapOrder, snapPhotoUrl, saveSnapMatchedItems, attachInvoiceToSnap, rejectSnap, MatchedItem } from '@/hooks/useSnapOrders';
import { fuzzyMatchPricelist, PricelistItem } from '@/hooks/usePricelist';
import { usePatients } from '@/contexts/PatientContext';
import { useInvoices } from '@/hooks/useInvoices';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Camera, Plus, Trash2, Send, FileText, Beaker, Pill } from 'lucide-react';
import { SnapOcrPanel } from './SnapOcrPanel';
import { highlightMatch } from '@/lib/highlightMatch';

const fmt = (n: number) => `₦${n.toLocaleString()}`;

export function BillingSnapInbox() {
  const { orders, loading, refresh } = useSnapOrders({ statuses: ['pending_billing'] });
  const { patients } = usePatients();
  const [selected, setSelected] = useState<SnapOrder | null>(null);

  const patientById = useMemo(() => {
    const m = new Map<string, string>();
    patients.forEach(p => m.set(p.id, `${p.first_name} ${p.last_name}`));
    return m;
  }, [patients]);

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Camera className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Incoming Snaps</h3>
          <Badge variant="outline" className="text-[10px]">{orders.length}</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={refresh}>Refresh</Button>
      </div>

      {loading && orders.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
      ) : orders.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No snaps waiting.</p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {orders.map(o => (
            <button
              key={o.id}
              onClick={() => setSelected(o)}
              className="w-full text-left p-3 rounded-lg border hover:border-primary transition-colors flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {patientById.get(o.patient_id) ?? 'Unknown patient'}
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="capitalize">{o.order_type}</span> → <span className="capitalize">{o.target_station}</span>
                  {o.note && <> · {o.note}</>}
                </p>
              </div>
              <Badge
                variant={o.status === 'awaiting_payment' ? 'warning' : 'secondary'}
                className="text-[10px] capitalize"
              >
                {o.status.replace('_', ' ')}
              </Badge>
            </button>
          ))}
        </div>
      )}

      {selected && selected.intent === 'emergency_billing_draft' ? (
        <EmergencyBillingDraftDialog
          snap={selected}
          onClose={() => setSelected(null)}
          onBilled={refresh}
          patientName={patientById.get(selected.patient_id) ?? 'Unknown'}
        />
      ) : selected ? (
        <SnapReviewDialog
          snap={selected}
          onClose={() => setSelected(null)}
          onBilled={refresh}
          patientName={patientById.get(selected.patient_id) ?? 'Unknown'}
        />
      ) : null}
    </div>
  );
}

function SnapReviewDialog({ snap, onClose, onBilled, patientName }: {
  snap: SnapOrder;
  onClose: () => void;
  onBilled: () => Promise<void>;
  patientName: string;
}) {
  const { createInvoice } = useInvoices();
  const { updatePatientStatus } = usePatients();
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [items, setItems] = useState<MatchedItem[]>(snap.matched_items ?? []);
  const [linkedPrescription, setLinkedPrescription] = useState<any>(null);
  const [linkedLabRequest, setLinkedLabRequest] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [manualMatches, setManualMatches] = useState<PricelistItem[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    snapPhotoUrl(snap.photo_path).then(url => { if (!cancelled) setImgUrl(url); });
    return () => { cancelled = true; };
  }, [snap.photo_path]);

  // Resolve canonical typed-order rows with flat Cockroach-compatible reads.
  // The Snap itself already carries the clinician's original typed text in note,
  // so the Billing card can show it immediately even while linked details load.
  useEffect(() => {
    if (!snap.ocr_text) return;
    let cancelled = false;

    const fetchLinked = async () => {
      if (snap.ocr_text?.startsWith('LINKED_PRESCRIPTION:')) {
        const id = snap.ocr_text.slice('LINKED_PRESCRIPTION:'.length).trim();
        const [prescriptionResult, itemsResult] = await Promise.all([
          supabase.from('prescriptions').select('*').eq('id', id).maybeSingle(),
          supabase.from('prescription_items').select('*').eq('prescription_id', id).order('created_at', { ascending: true }),
        ]);
        if (!cancelled && prescriptionResult.data) {
          setLinkedPrescription({
            ...prescriptionResult.data,
            prescription_items: itemsResult.data ?? [],
          });
        }
      } else if (snap.ocr_text?.startsWith('LINKED_LAB_REQUEST:')) {
        const id = snap.ocr_text.slice('LINKED_LAB_REQUEST:'.length).trim();
        const { data } = await supabase.from('lab_requests').select('*').eq('id', id).maybeSingle();
        if (!cancelled && data) setLinkedLabRequest(data);
      }
    };

    fetchLinked();
    return () => { cancelled = true; };
  }, [snap.ocr_text]);

  useEffect(() => {
    const q = manualQuery.trim();
    if (q.length === 0) { setManualMatches([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const m = await fuzzyMatchPricelist(q);
      if (!cancelled) { setManualMatches(m); setActiveIdx(0); }
    }, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [manualQuery]);

  const doManualSearch = async () => {
    const m = await fuzzyMatchPricelist(manualQuery);
    setManualMatches(m);
    if (m.length === 0) toast.error('No matches — add via Pricelist Manager');
  };
  const addManual = (it: PricelistItem) => {
    setItems(prev => [...prev, {
      pricelist_id: it.id, name: it.name, size: it.size, category: it.category, unit_price: it.price, qty: 1,
    }]);
    setManualQuery('');
    setManualMatches([]);
    setActiveIdx(0);
  };

  const setQty = (idx: number, qty: number) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, qty: Math.max(1, qty) } : it));

  const removeItem = (idx: number) =>
    setItems(prev => prev.filter((_, i) => i !== idx));

  const total = items.reduce((s, i) => s + i.unit_price * i.qty, 0);


  const createInvoiceAndSend = async () => {
    if (items.length === 0) { toast.error('Add at least one item'); return; }
    setBusy(true);
    let createdInvoiceId: string | null = null;
    try {
      // Re-read the snap immediately before creating an invoice. This prevents
      // two Billing workspaces or a retry after a network timeout from creating
      // separate invoices for the same clinical request.
      const { data: currentSnap, error: currentSnapError } = await supabase
        .from('snap_orders')
        .select('status, invoice_id')
        .eq('id', snap.id)
        .maybeSingle();
      if (currentSnapError) throw currentSnapError;
      if (!currentSnap || currentSnap.status !== 'pending_billing' || currentSnap.invoice_id) {
        toast.info('This request was already billed or is no longer waiting for Billing.');
        await onBilled();
        onClose();
        return;
      }

      const invoice = await createInvoice(
        snap.patient_id,
        items.map(it => ({
          description: `${it.name}${it.size ? ' ' + it.size : ''}`,
          quantity: it.qty,
          unitPrice: it.unit_price,
          category: it.category,
        })),
        `From snap ${snap.id.slice(0, 8)} · ${snap.order_type} → ${snap.target_station}`,
      );
      if (!invoice) throw new Error('Invoice creation failed');
      createdInvoiceId = invoice.id;
      await saveSnapMatchedItems(snap.id, items);
      let ok = await attachInvoiceToSnap(snap.id, invoice.id);
      if (!ok) {
        // A lost response does not mean the conditional update failed. Re-read
        // before cleaning up so a successfully linked invoice is never voided.
        const { data: linkedSnap, error: linkedSnapError } = await supabase
          .from('snap_orders')
          .select('status, invoice_id')
          .eq('id', snap.id)
          .maybeSingle();
        if (linkedSnapError) throw linkedSnapError;
        ok = linkedSnap?.invoice_id === invoice.id;
        if (!ok && linkedSnap?.invoice_id) {
          await supabase.from('invoices').update({
            status: 'voided',
            notes: `Duplicate billing attempt prevented; request linked to invoice ${linkedSnap.invoice_id}.`,
          }).eq('id', invoice.id);
        }
      }
      if (!ok) throw new Error('This request was claimed by another Billing session; duplicate billing was prevented.');

      // Billing is complete at this point. Move the patient to the canonical
      // Cashier state immediately so Reception and all station queues update
      // through the workflow engine instead of waiting for payment settlement.
      const statusUpdated = await updatePatientStatus(snap.patient_id, 'awaiting_payment');
      if (!statusUpdated) throw new Error('Invoice created, but the patient could not be moved to Cashier');

      // Remove the billed snap from this inbox immediately; realtime remains a
      // second safety net for other open Billing workspaces.
      await onBilled();
      toast.success('Invoice created · waiting for cashier payment');
      onClose();
    } catch (e: any) {
      // If invoice creation succeeded but snap linking failed before another
      // invoice claimed the request, keep the orphan out of all payment queues.
      if (createdInvoiceId) {
        const { data: linkedSnap } = await supabase
          .from('snap_orders')
          .select('invoice_id')
          .eq('id', snap.id)
          .maybeSingle();
        if (linkedSnap?.invoice_id !== createdInvoiceId) {
          await supabase.from('invoices').update({
            status: 'voided',
            notes: 'Voided after failed or duplicate snap-link attempt; no clinical request was attached.',
          }).eq('id', createdInvoiceId);
        }
      }
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };


  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Snap Review · {patientName} · <span className="capitalize text-primary">{snap.order_type}</span> → <span className="capitalize">{snap.target_station}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-4">
          {/* Left: Photo + OCR */}
          <div className="space-y-3">
            <div className="rounded-lg overflow-hidden bg-muted flex items-center justify-center min-h-[240px]">
              {imgUrl
                ? (
                  <button
                    type="button"
                    onClick={() => setLightboxOpen(true)}
                    className="group relative w-full flex items-center justify-center cursor-zoom-in"
                    title="Click to view full size"
                  >
                    <img src={imgUrl} alt="snap" className="max-h-[400px] object-contain transition-opacity group-hover:opacity-90" />
                    <span className="absolute bottom-2 right-2 text-[10px] bg-background/80 px-2 py-1 rounded shadow">
                      Click to enlarge
                    </span>
                  </button>
                )
                : <p className="text-xs text-muted-foreground p-4">Loading image…</p>}
            </div>

            <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
              <DialogContent className="max-w-[95vw] max-h-[95vh] p-2 bg-background/95">
                <div className="w-full h-full overflow-auto flex items-center justify-center">
                  {imgUrl && (
                    <img
                      src={imgUrl}
                      alt="snap full"
                      className="max-w-none cursor-zoom-out"
                      style={{ maxHeight: '90vh' }}
                      onClick={() => setLightboxOpen(false)}
                    />
                  )}
                </div>
              </DialogContent>
            </Dialog>



            {(snap.ocr_text?.startsWith('LINKED_PRESCRIPTION:') || snap.ocr_text?.startsWith('LINKED_LAB_REQUEST:')) && (
              <div className="p-3 border-2 border-primary/20 rounded-lg bg-primary/5 space-y-2">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <p className="text-xs font-bold text-primary uppercase tracking-wider">
                    Original Typed Order
                  </p>
                  <Badge variant="outline" className="text-[10px]">{snap.order_type === 'lab' ? 'Lab test' : 'Prescription'}</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  This is the exact text entered by the {snap.source_role || snap.original_sender_role || 'clinical'} staff member.
                </p>
                <div className="bg-background rounded border border-primary/20 p-3 text-sm whitespace-pre-wrap break-words font-mono">
                  {snap.note?.trim()
                    || linkedPrescription?.notes?.trim()
                    || linkedLabRequest?.tests?.join('\n')
                    || 'The typed order text is not present on this Snap.'}
                </div>
              </div>
            )}

            {linkedPrescription && (
              <div className="p-3 border rounded-lg bg-module-pharmacy/5 space-y-2">
                <p className="text-xs font-bold text-module-pharmacy uppercase tracking-wider">Typed Prescription Details</p>
                {linkedPrescription.diagnosis && (
                  <p className="text-xs"><strong>Diagnosis:</strong> {linkedPrescription.diagnosis}</p>
                )}
                <div className="space-y-2">
                  {linkedPrescription.notes && (
                    <div className="text-xs p-2 bg-background rounded border border-module-pharmacy/20 whitespace-pre-wrap font-mono">
                      {linkedPrescription.notes}
                    </div>
                  )}
                  {linkedPrescription.prescription_items?.some((it: any) => it.medication !== 'Typed Prescription (See Notes)') && (
                    <div className="space-y-1">
                      {linkedPrescription.prescription_items?.map((it: any, i: number) => (
                        <div key={i} className="text-[10px] p-1 bg-background/50 rounded border border-dashed">
                          {it.medication} · {it.dosage}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {linkedLabRequest && (
              <div className="p-3 border rounded-lg bg-module-laboratory/5 space-y-2">
                <p className="text-xs font-bold text-module-laboratory uppercase tracking-wider">Typed Lab Order Details</p>
                {linkedLabRequest.diagnosis && (
                  <p className="text-xs"><strong>Diagnosis:</strong> {linkedLabRequest.diagnosis}</p>
                )}
                <div className="bg-background rounded border border-module-laboratory/20 p-2 text-xs whitespace-pre-wrap font-mono">
                  {linkedLabRequest.tests?.join('\n')}
                </div>
              </div>
            )}

            <SnapOcrPanel
              snapId={snap.id}
              onAddItem={(it) => setItems(prev => [...prev, it])}
            />
          </div>

          {/* Right: Invoice items */}
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Type to search pricelist… (e.g. 'pan' finds Panadol)"
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (manualMatches.length > 0) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setActiveIdx(i => Math.min(manualMatches.length - 1, i + 1));
                      return;
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setActiveIdx(i => Math.max(0, i - 1));
                      return;
                    }
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const pick = manualMatches[activeIdx] ?? manualMatches[0];
                      if (pick) addManual(pick);
                      return;
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setManualMatches([]);
                      return;
                    }
                  } else if (e.key === 'Enter') {
                    doManualSearch();
                  }
                }}
              />
              <Button size="sm" onClick={doManualSearch}>Search</Button>
            </div>

            {manualMatches.length > 0 && (
              <div className="border rounded-lg p-2 space-y-1 max-h-40 overflow-y-auto">
                {manualMatches.map((m, i) => (
                  <button
                    key={m.id}
                    onClick={() => addManual(m)}
                    onMouseEnter={() => setActiveIdx(i)}
                    ref={(el) => { if (el && i === activeIdx) el.scrollIntoView({ block: 'nearest' }); }}
                    className={`w-full text-left text-xs px-2 py-1 rounded flex items-center justify-between ${
                      i === activeIdx ? 'bg-primary/15 ring-1 ring-primary/40' : 'hover:bg-primary/10'
                    }`}
                  >
                    <span>
                      {highlightMatch(m.name, manualQuery)}
                      {m.size ? <> ({highlightMatch(m.size, manualQuery)})</> : null}
                    </span>
                    <span className="font-mono">{fmt(m.price)}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="border rounded-lg">
              <div className="p-2 text-xs font-medium border-b flex items-center justify-between">
                <span>Invoice Items</span>
                <span className="text-muted-foreground">{items.length} line{items.length === 1 ? '' : 's'}</span>
              </div>
              <div className="divide-y">
                {items.length === 0 && (
                  <p className="p-3 text-xs text-muted-foreground text-center">
                    Run OCR or search manually to add items.
                  </p>
                )}
                {items.map((it, idx) => (
                  <div key={idx} className="p-2 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{it.name}{it.size ? ` ${it.size}` : ''}</p>
                      <p className="text-[10px] text-muted-foreground">{it.category} · {fmt(it.unit_price)}/unit</p>
                    </div>
                    <Input
                      type="number"
                      min={1}
                      value={it.qty}
                      onChange={(e) => setQty(idx, parseInt(e.target.value) || 1)}
                      className="w-16 h-8 text-xs"
                    />
                    <span className="text-xs font-mono w-20 text-right">{fmt(it.unit_price * it.qty)}</span>
                    <Button size="sm" variant="ghost" onClick={() => removeItem(idx)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="p-2 border-t flex items-center justify-between">
                <span className="text-sm font-medium">Total</span>
                <span className="text-lg font-mono font-bold">{fmt(total)}</span>
              </div>
            </div>

          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>
          <Button
            onClick={createInvoiceAndSend}
            disabled={busy || items.length === 0 || snap.status !== 'pending_billing'}
          >
            <Send className="h-4 w-4 mr-2" />
            {snap.status === 'awaiting_payment'
              ? 'Awaiting Cashier'
              : busy ? 'Creating…'
              : 'Create Invoice → Send to Cashier'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function EmergencyBillingDraftDialog({ snap, onClose, onBilled, patientName }: {
  snap: SnapOrder;
  onClose: () => void;
  onBilled: () => Promise<void>;
  patientName: string;
}) {
  const referenceLines = useMemo(() => (snap.matched_items ?? []).map(line => ({
    ...line,
    source_text: line.source_text ?? line.name,
    service_category: line.service_category ?? (line.category === 'lab' ? 'lab_test' : 'medication'),
  })), [snap.matched_items]);
  const referenceMedCount = referenceLines.filter(line => line.service_category === 'medication').length;
  const referenceLabCount = referenceLines.filter(line => line.service_category === 'lab_test').length;
  // Original emergency lines are reference-only. Billing starts with an empty
  // invoice list and decides how many billable lines to add.
  const [items, setItems] = useState<MatchedItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [manualMatches, setManualMatches] = useState<PricelistItem[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [activeCategory, setActiveCategory] = useState<'medication' | 'lab_test'>('medication');

  const nextEmergencyItemId = (category: 'medication' | 'lab_test', used: Set<string>) => {
    const matching = referenceLines.find(line => line.service_category === category && line.emergency_episode_item_id && !used.has(line.emergency_episode_item_id));
    return matching?.emergency_episode_item_id;
  };

  const updateLine = (index: number, patch: Partial<MatchedItem>) => {
    setItems(prev => prev.map((line, i) => i === index ? { ...line, ...patch } : line));
  };
  const setQty = (index: number, qty: number) => updateLine(index, { qty: Math.max(1, qty) });
  const removeItem = (index: number) => setItems(prev => prev.filter((_, i) => i !== index));
  const total = items.reduce((sum, item) => sum + Number(item.unit_price || 0) * Math.max(1, Number(item.qty || 1)), 0);
  const medicationTotal = items
    .filter(item => item.service_category === 'medication')
    .reduce((sum, item) => sum + Number(item.unit_price || 0) * Math.max(1, Number(item.qty || 1)), 0);
  const labTestTotal = total - medicationTotal;

  useEffect(() => {
    const q = manualQuery.trim();
    if (!q) { setManualMatches([]); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const matches = await fuzzyMatchPricelist(q);
      if (!cancelled) { setManualMatches(matches); setActiveIdx(0); }
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [manualQuery]);

  const doManualSearch = async () => {
    const matches = await fuzzyMatchPricelist(manualQuery);
    setManualMatches(matches);
    if (matches.length === 0) toast.error('No matches — you may edit the emergency line manually or add it via Pricelist Manager');
  };

  const addManual = (it: PricelistItem) => {
    setItems(prev => {
      const used = new Set(prev.map(line => line.emergency_episode_item_id).filter(Boolean) as string[]);
      return [...prev, {
        pricelist_id: it.id,
        name: it.name,
        description: it.name,
        size: it.size,
        category: it.category,
        service_category: activeCategory,
        emergency_episode_item_id: nextEmergencyItemId(activeCategory, used),
        unit_price: it.price,
        qty: 1,
      }];
    });
    setManualQuery('');
    setManualMatches([]);
    setActiveIdx(0);
  };

  const addBlankLine = () => setItems(prev => {
    const used = new Set(prev.map(line => line.emergency_episode_item_id).filter(Boolean) as string[]);
    return [...prev, {
      pricelist_id: '',
      name: '',
      description: '',
      size: null,
      category: 'emergency',
      service_category: activeCategory,
      emergency_episode_item_id: nextEmergencyItemId(activeCategory, used),
      unit_price: 0,
      qty: 1,
    }];
  });

  const finish = async () => {
    const validItems = items.filter(item => item.name?.trim() && item.description?.trim());
    if (validItems.length !== items.length) { toast.error('Complete every emergency billing line before generating the invoice'); return; }
    if (items.length === 0) { toast.error('This Emergency Episode draft has no lines'); return; }
    setBusy(true);
    try {
      const { error } = await (supabase.rpc as any)('complete_emergency_billing_draft', {
        _draft_snap_id: snap.id,
        _matched_items: items,
        _billing_note: snap.note || 'Emergency Episode billing draft',
      });
      if (error) throw error;
      toast.success('Invoice generated · waiting for cashier payment', {
        description: 'One combined invoice for this Emergency Episode was created for Cashier. Medication and Lab Test lines stay categorized for claims and sponsor reports.',
      });
      await onBilled();
      onClose();
    } catch (error: any) {
      toast.error(error?.message || 'Could not generate Emergency Episode invoice');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Snap Review · {patientName} · <span className="capitalize text-primary">{snap.order_type}</span> → <span className="capitalize">{snap.target_station}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="p-3 border-2 border-amber-300 rounded-lg bg-amber-50/60 dark:bg-amber-950/20 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <FileText className="h-4 w-4 text-amber-700" />
                <p className="text-xs font-bold text-amber-900 dark:text-amber-200 uppercase tracking-wider">Original Emergency Order</p>
                <Badge variant="outline" className="text-[10px]">Manual billing</Badge>
                {referenceMedCount > 0 && (
                  <Badge variant="outline" className="text-[10px] text-module-pharmacy">
                    <Pill className="h-2.5 w-2.5 mr-1" />
                    {referenceMedCount} medication{referenceMedCount === 1 ? '' : 's'}
                  </Badge>
                )}
                {referenceLabCount > 0 && (
                  <Badge variant="outline" className="text-[10px] text-module-laboratory">
                    <Beaker className="h-2.5 w-2.5 mr-1" />
                    {referenceLabCount} lab test{referenceLabCount === 1 ? '' : 's'}
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-amber-800/80 dark:text-amber-200/80">This is the exact plain-text record entered by the clinical team for reference. It does not pre-fill invoice lines. Search the Pricelist to add as many billable lines as needed, or add a manual line — each line is categorized Medication or Lab Test.</p>
              <div className="bg-background rounded border border-amber-300/60 p-3 text-sm whitespace-pre-wrap break-words font-mono">
                {referenceLines.map((line, index) => (
                  <div key={line.emergency_episode_item_id || index} className="mb-2 last:mb-0 flex items-start gap-2">
                    {line.service_category === 'lab_test'
                      ? <Beaker className="h-3.5 w-3.5 mt-0.5 text-module-laboratory shrink-0" />
                      : <Pill className="h-3.5 w-3.5 mt-0.5 text-module-pharmacy shrink-0" />}
                    <span className="text-muted-foreground mr-1 shrink-0">{index + 1}.</span>
                    <span>{line.source_text ?? line.name}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-3 border rounded-lg bg-muted/20 space-y-2">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Emergency Billing Rule</p>
              <p className="text-xs text-muted-foreground">Emergency care is recorded before payment. This draft stays separate from normal pharmacy/lab orders: the officer bills the lines he deems appropriate and ONE combined invoice is created for Cashier — it never moves the patient's station.</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex gap-2" role="group" aria-label="Emergency service category">
              <Button type="button" size="sm" variant={activeCategory === 'medication' ? 'default' : 'outline'} onClick={() => setActiveCategory('medication')} disabled={busy}><Pill className="h-3.5 w-3.5 mr-1" /> Medication</Button>
              <Button type="button" size="sm" variant={activeCategory === 'lab_test' ? 'default' : 'outline'} onClick={() => setActiveCategory('lab_test')} disabled={busy}><Beaker className="h-3.5 w-3.5 mr-1" /> Lab Test</Button>
            </div>
            <p className="text-xs text-muted-foreground">New lines are billed under the selected category and retained for corporate/retainer claims.</p>
            <div className="flex gap-2">
              <Input
                placeholder="Type to search pricelist… (e.g. 'pan' finds Panadol)"
                value={manualQuery}
                onChange={e => setManualQuery(e.target.value)}
                onKeyDown={e => {
                  if (manualMatches.length > 0) {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(manualMatches.length - 1, i + 1)); return; }
                    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(0, i - 1)); return; }
                    if (e.key === 'Enter') { e.preventDefault(); const pick = manualMatches[activeIdx] ?? manualMatches[0]; if (pick) addManual(pick); return; }
                    if (e.key === 'Escape') { e.preventDefault(); setManualMatches([]); return; }
                  } else if (e.key === 'Enter') doManualSearch();
                }}
                disabled={busy}
              />
              <Button size="sm" onClick={doManualSearch} disabled={busy}>Search</Button><Button size="sm" variant="outline" onClick={addBlankLine} disabled={busy}><Plus className="h-3.5 w-3.5 mr-1" /> Add manual line</Button>
            </div>

            {manualMatches.length > 0 && (
              <div className="border rounded-lg p-2 space-y-1 max-h-40 overflow-y-auto">
                {manualMatches.map((m, i) => (
                  <button key={m.id} onClick={() => addManual(m)} onMouseEnter={() => setActiveIdx(i)} className={'w-full text-left text-xs px-2 py-1 rounded flex items-center justify-between ' + (i === activeIdx ? 'bg-primary/15 ring-1 ring-primary/40' : 'hover:bg-primary/10')}>
                    <span>{highlightMatch(m.name, manualQuery)}{m.size ? <> ({highlightMatch(m.size, manualQuery)})</> : null}</span>
                    <span className="font-mono">{fmt(m.price)}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="border rounded-lg">
              <div className="p-2 text-xs font-medium border-b flex items-center justify-between">
                <span>Invoice Items</span>
                <span className="text-muted-foreground">{items.length} line{items.length === 1 ? '' : 's'}</span>
              </div>
              <div className="divide-y">
                {items.length === 0 && <p className="p-3 text-xs text-muted-foreground text-center">Search the Pricelist or add a manual line to start the invoice.</p>}
                {items.map((it, idx) => (
                  <div key={it.emergency_episode_item_id || idx} className="p-2 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <Input value={it.name} onChange={e => updateLine(idx, { name: e.target.value, description: e.target.value, pricelist_id: '' })} disabled={busy} className="h-8 text-xs" placeholder="Billable description" />
                      <p className="text-[10px] text-muted-foreground mt-1">{it.service_category === 'lab_test' ? 'Lab Test' : it.service_category === 'medication' ? 'Medication' : (it.service_category || it.category || 'emergency')} · {it.pricelist_id ? 'Pricelist item' : 'Manual line'}</p>
                    </div>
                    <Input type="number" min={1} value={it.qty} onChange={e => setQty(idx, Number(e.target.value) || 1)} disabled={busy} className="w-16 h-8 text-xs" />
                    <Input type="number" min={0} value={it.unit_price} onChange={e => updateLine(idx, { unit_price: Math.max(0, Number(e.target.value) || 0), pricelist_id: '' })} disabled={busy} className="w-24 h-8 text-xs" />
                    <span className="text-xs font-mono w-20 text-right">{fmt(Number(it.unit_price || 0) * Math.max(1, Number(it.qty || 1)))}</span>
                    <Button size="sm" variant="ghost" onClick={() => removeItem(idx)} disabled={busy}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                  </div>
                ))}
              </div>
              <div className="p-2 border-t space-y-1.5">
                {(medicationTotal > 0 || labTestTotal > 0) && (
                  <>
                    {medicationTotal > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-muted-foreground"><Pill className="h-3 w-3 text-module-pharmacy" /> Medications</span>
                        <span className="font-mono font-semibold">{fmt(medicationTotal)}</span>
                      </div>
                    )}
                    {labTestTotal > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-muted-foreground"><Beaker className="h-3 w-3 text-module-laboratory" /> Lab Tests</span>
                        <span className="font-mono font-semibold">{fmt(labTestTotal)}</span>
                      </div>
                    )}
                  </>
                )}
                <div className="flex items-center justify-between border-t pt-1.5">
                  <span className="text-sm font-medium">Total (one invoice)</span>
                  <span className="text-lg font-mono font-bold">{fmt(total)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>
          <Button onClick={finish} disabled={busy || items.length === 0}>
            <Send className="h-4 w-4 mr-2" />
            {busy ? 'Creating…' : 'Create Invoice → Send to Cashier'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
