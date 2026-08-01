import { useEffect, useMemo, useState } from 'react';
import { BedDouble, Camera, LogOut, User2, Wallet, Send, ScrollText, Beaker, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAdmissions, forwardSnapToBilling, markReadyForDischarge } from '@/hooks/useAdmissions';
import { usePatients } from '@/contexts/PatientContext';
import { AdmittedSnapDialog } from './AdmittedSnapDialog';
import { DischargeDialog } from '@/components/nurse/DischargeDialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { snapPhotoUrl } from '@/hooks/useSnapOrders';
import { useWardsRoomsBeds } from '@/hooks/useWardsRooms';
import { LabResultsViewer } from '@/components/doctor/LabResultsViewer';
import { useAdmissionPerms } from '@/lib/admissionPermissions';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

interface Props {
  sourceStation: 'nurse' | 'doctor';
  title?: string;
  assignedDoctor?: 'doctor1' | 'doctor2';
}

/**
 * Panel of currently-admitted patients. The patient card stays with Nurse
 * throughout admission — this panel only creates tasks (forward existing
 * snaps to Pharmacy/Lab via Billing, sign a discharge order, or discharge).
 */
export function AdmittedPatientsPanel({ sourceStation, title = 'Admitted Patients', assignedDoctor }: Props) {
  const { admissions } = useAdmissions({ statuses: ['active', 'ready_for_discharge'] });
  const { patients } = usePatients();
  const [snapFor, setSnapFor] = useState<{ id: string; name: string; balance: number } | null>(null);
  const [dischargeFor, setDischargeFor] = useState<{ admissionId: string; patientId: string; name: string; balance: number } | null>(null);
  const [forwardFor, setForwardFor] = useState<{ admissionId: string; patientId: string; name: string; target: 'pharmacy' | 'lab' } | null>(null);
  const [dischargeOrderFor, setDischargeOrderFor] = useState<{ admissionId: string; patientId: string; name: string } | null>(null);
  const [resultsFor, setResultsFor] = useState<{ patientId: string; name: string } | null>(null);
  const { rooms, beds } = useWardsRoomsBeds();
  const can = useAdmissionPerms();
  const { user } = useAuth();
  const userId = user?.id;

  const bedInfo = useMemo(() => {
    const roomOf = new Map(rooms.map((r) => [r.id, r]));
    const m = new Map<string, { label: string; rate: number }>();
    beds.forEach((b) => {
      const r = roomOf.get(b.room_id);
      m.set(b.id, { label: r ? `Room ${r.room_number} · Bed ${b.bed_label}` : `Bed ${b.bed_label}`, rate: Number(r?.daily_rate ?? 0) });
    });
    return m;
  }, [rooms, beds]);

  const patientOf = useMemo(() => {
    const m = new Map<string, any>();
    patients.forEach((p) => m.set(p.id, p));
    return m;
  }, [patients]);

  // Doctor scoping: show admissions for patients assigned to me, admissions I
  // opened myself, and unassigned patients (so nobody falls through a gap).
  const scoped = assignedDoctor
    ? admissions.filter((a) => {
        const doc = patientOf.get(a.patient_id)?.assigned_doctor;
        return doc === assignedDoctor || !doc || a.admitting_doctor === userId;
      })
    : admissions;

  return (
    <div className="bg-card rounded-xl border p-4">
      <div className="flex items-center gap-2 mb-3">
        <BedDouble className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">{title}</h3>
        <Badge variant="outline" className="text-[10px]">{scoped.length}</Badge>
      </div>

      {scoped.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No admitted patients.</p>
      ) : (
        <div className="space-y-2">
          {scoped.map((a) => {
            const p = patientOf.get(a.patient_id);
            const bal = Number(p?.balance ?? 0);
            const low = bal <= 0;
            const isReady = a.status === 'ready_for_discharge';
            const name = `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim();
            const bed = a.bed_id ? bedInfo.get(a.bed_id) : undefined;
            const days = a.admitted_at
              ? Math.max(1, Math.ceil((Date.now() - new Date(a.admitted_at).getTime()) / 86_400_000))
              : 0;
            const accrued = bed ? days * bed.rate : 0;
            return (
              <div key={a.id} className="p-3 rounded-lg border">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate flex items-center gap-1.5">
                      <User2 className="h-3.5 w-3.5" />
                      {p ? `${p.first_name} ${p.last_name}` : 'Unknown'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p?.card_number} · {p?.account_type ?? '—'}
                    </p>
                    {bed && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {bed.label} · {days} day{days === 1 ? '' : 's'} · bed charge ₦{accrued.toLocaleString()}
                      </p>
                    )}
                  </div>
                  {isReady ? (
                    <Badge variant="info" className="text-[10px]">Ready for Discharge</Badge>
                  ) : (
                    <Badge variant={low ? 'warning' : 'success'} className="text-[10px]">
                      <Wallet className="h-3 w-3 mr-1" />
                      ₦{bal.toLocaleString()}
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {can('admittedSnap') && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSnapFor({ id: a.patient_id, name, balance: bal })}
                    >
                      <Camera className="h-3.5 w-3.5 mr-1.5" /> New Snap
                    </Button>
                  )}
                  {can('forwardSnap') && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setForwardFor({ admissionId: a.id, patientId: a.patient_id, name, target: 'pharmacy' })}
                    >
                      <ScrollText className="h-3.5 w-3.5 mr-1.5" /> Send to Pharmacy
                    </Button>
                  )}
                  {can('forwardSnap') && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setForwardFor({ admissionId: a.id, patientId: a.patient_id, name, target: 'lab' })}
                    >
                      <Beaker className="h-3.5 w-3.5 mr-1.5" /> Send to Lab
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setResultsFor({ patientId: a.patient_id, name })}
                  >
                    <FlaskConical className="h-3.5 w-3.5 mr-1.5" /> Lab Results
                  </Button>
                  {sourceStation === 'doctor' && !isReady && can('dischargeOrder') && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setDischargeOrderFor({ admissionId: a.id, patientId: a.patient_id, name })}
                    >
                      <Send className="h-3.5 w-3.5 mr-1.5" /> Discharge Order
                    </Button>
                  )}
                  {can('discharge') && (
                    <Button
                      size="sm"
                      variant={isReady ? 'default' : 'secondary'}
                      onClick={() => setDischargeFor({ admissionId: a.id, patientId: a.patient_id, name, balance: bal })}
                    >
                      <LogOut className="h-3.5 w-3.5 mr-1.5" /> Discharge
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {snapFor && (
        <AdmittedSnapDialog
          open
          onOpenChange={(o) => !o && setSnapFor(null)}
          patientId={snapFor.id}
          patientName={snapFor.name}
          patientBalance={snapFor.balance}
          sourceStation={sourceStation}
        />
      )}

      {dischargeFor && (
        <DischargeDialog
          open
          onOpenChange={(o) => !o && setDischargeFor(null)}
          admissionId={dischargeFor.admissionId}
          patientId={dischargeFor.patientId}
          patientName={dischargeFor.name}
          patientBalance={dischargeFor.balance}
        />
      )}

      {forwardFor && (
        <ForwardSnapDialog
          patientId={forwardFor.patientId}
          patientName={forwardFor.name}
          target={forwardFor.target}
          onClose={() => setForwardFor(null)}
        />
      )}

      {dischargeOrderFor && (
        <DischargeOrderDialog
          patientId={dischargeOrderFor.patientId}
          patientName={dischargeOrderFor.name}
          admissionId={dischargeOrderFor.admissionId}
          onClose={() => setDischargeOrderFor(null)}
        />
      )}

      {resultsFor && (
        <Dialog open onOpenChange={(o) => !o && setResultsFor(null)}>
          <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Lab Results · {resultsFor.name}</DialogTitle>
            </DialogHeader>
            <LabResultsViewer patientId={resultsFor.patientId} />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setResultsFor(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ---- Forward existing snap to Pharmacy/Lab (goes via Billing) ---------------
function ForwardSnapDialog({ patientId, patientName, target, onClose }:
  { patientId: string; patientName: string; target: 'pharmacy' | 'lab'; onClose: () => void }) {
  const [snaps, setSnaps] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    supabase.from('snap_orders').select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        const rows = data ?? [];
        setSnaps(rows);
        rows.forEach((s: any) => {
          if (s.photo_path) snapPhotoUrl(s.photo_path).then((u) => u && setUrls((m) => ({ ...m, [s.id]: u })));
        });
      });
  }, [patientId]);

  const forward = async (id: string) => {
    setBusyId(id);
    const r = await forwardSnapToBilling(id, target);
    setBusyId(null);
    if (r) onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Forward to {target === 'lab' ? 'Lab' : 'Pharmacy'} · {patientName}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Pick an existing snap. It will be sent to Billing as a new task — the original
          image is reused (no rewriting). Card stays in the admission queue.
        </p>
        {snaps.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No snaps found for this patient.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {snaps.map((s) => (
              <div key={s.id} className="border rounded-lg p-2 space-y-2">
                {urls[s.id] ? (
                  <img src={urls[s.id]} alt="snap" className="w-full h-32 object-cover rounded" />
                ) : (
                  <div className="w-full h-32 bg-muted rounded" />
                )}
                <div className="text-xs">
                  <span className="capitalize font-medium">{s.order_type}</span>
                  {s.intent && <> · <span className="text-muted-foreground">{s.intent}</span></>}
                  <div className="text-muted-foreground">{new Date(s.created_at).toLocaleString()}</div>
                </div>
                <Button size="sm" className="w-full" onClick={() => forward(s.id)} disabled={busyId === s.id}>
                  <Send className="h-3.5 w-3.5 mr-1" />
                  {busyId === s.id ? 'Forwarding…' : `Forward to ${target}`}
                </Button>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Doctor discharge-order snap → auto-flips admission to ready ------------
function DischargeOrderDialog({ patientId, patientName, admissionId, onClose }:
  { patientId: string; patientName: string; admissionId: string; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (preview) URL.revokeObjectURL(preview);
    setFile(f); setPreview(URL.createObjectURL(f));
  };

  const submit = async () => {
    if (!file) { toast.error('Snap the discharge order first'); return; }
    setBusy(true);
    try {
      const { data: v } = await supabase.from('visits').select('id').eq('patient_id', patientId).eq('status', 'open')
        .order('opened_at', { ascending: false }).limit(1).maybeSingle();
      const visitId = v?.id ?? crypto.randomUUID();
      const path = `${visitId}/discharge-order-${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage.from('visit-cards').upload(path, file, { contentType: file.type || 'image/jpeg' });
      if (upErr) throw upErr;
      const { data: userRes } = await supabase.auth.getUser();
      const { data: role } = await supabase.from('user_roles').select('role').eq('user_id', userRes.user?.id).limit(1).maybeSingle();
      const { data: snap, error: snapErr } = await supabase.from('snap_orders').insert({
        patient_id: patientId, visit_id: v?.id ?? null,
        order_type: 'treatment', target_station: 'nurse',
        source_role: role?.role ?? 'doctor',
        photo_path: path, note: note.trim() || 'Discharge order',
        status: 'acknowledged', created_by: userRes.user?.id,
        original_sender_role: role?.role ?? 'doctor',
        intent: 'discharge_order',
      } as any).select('id').single();
      if (snapErr) throw snapErr;
      const ok = await markReadyForDischarge(admissionId, snap.id, note.trim() || undefined);
      if (ok) onClose();
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to sign discharge order');
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (busy) return; if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Sign Discharge Order · {patientName}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <input type="file" accept="image/*" capture="environment" onChange={pick} />
          {preview && <img src={preview} alt="discharge order" className="w-full max-h-64 object-contain rounded bg-muted" />}
          <textarea
            className="w-full border rounded p-2 text-sm"
            rows={2}
            placeholder="Discharge instructions (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            The nurse will see this patient under "Ready for Discharge" and complete the discharge.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !file}>
            {busy ? 'Signing…' : 'Sign Discharge Order'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
