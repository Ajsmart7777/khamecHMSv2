import { useEffect, useMemo, useState } from 'react';
import { BedDouble, ChevronDown, ChevronRight, Wallet, User2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { usePatients } from '@/contexts/PatientContext';
import { formatDistanceToNow } from 'date-fns';
import { useAdmissions, Admission } from '@/hooks/useAdmissions';
import { snapPhotoUrl } from '@/hooks/useSnapOrders';
import { AssignBedDialog } from '@/components/nurse/AssignBedDialog';
import { copayPercent, sponsorLabel } from '@/lib/copay';
import { useAdmissionPerms } from '@/lib/admissionPermissions';

const fmt = (n: number) => `₦${Number(n || 0).toLocaleString()}`;

/**
 * Awaiting Room — admission requests snapped by a doctor or nurse. The card
 * waits here (it never moves) while the patient deposits at Reception/Cashier.
 * The nurse expands the card, checks the balance, then assigns ward & room.
 */
export function AwaitingRoomPanel() {
  const { admissions } = useAdmissions({ statuses: ['waiting_assignment'] });
  const { patients } = usePatients();
  const [openId, setOpenId] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<Admission | null>(null);
  const can = useAdmissionPerms();

  const patientOf = useMemo(() => {
    const m = new Map<string, any>();
    patients.forEach((p) => m.set(p.id, p));
    return m;
  }, [patients]);

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <BedDouble className="h-4 w-4 text-module-nurse" />
          Awaiting Room
        </h3>
        <Badge variant="info">{admissions.length}</Badge>
      </div>

      {admissions.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground">
          <BedDouble className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-xs">No admission requests waiting for a room</p>
        </div>
      ) : (
        <div className="space-y-2">
          {admissions.map((a) => {
            const p = patientOf.get(a.patient_id);
            const name = p ? `${p.first_name} ${p.last_name ?? ''}`.trim() : 'Unknown patient';
            const balance = Number(p?.balance ?? 0);
            const pct = copayPercent({ account_type: p?.account_type, insurance_plan: p?.insurance_plan });
            const expanded = openId === a.id;
            return (
              <div key={a.id} className="rounded-lg border border-border overflow-hidden">
                <button
                  type="button"
                  className="w-full p-3 flex items-start gap-2 text-left hover:bg-muted/50 transition-colors"
                  onClick={() => setOpenId(expanded ? null : a.id)}
                >
                  {expanded ? <ChevronDown className="h-4 w-4 mt-0.5" /> : <ChevronRight className="h-4 w-4 mt-0.5" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate flex items-center gap-1.5">
                      <User2 className="h-3.5 w-3.5" /> {name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {p?.card_number} · requested{' '}
                      {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                    </p>
                  </div>
                  <Badge variant={pct === 0 ? 'success' : balance > 0 ? 'success' : 'warning'} className="text-[10px]">
                    <Wallet className="h-3 w-3 mr-1" />{fmt(balance)}
                  </Badge>
                </button>

                {expanded && (
                  <div className="p-3 pt-0 space-y-3">
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge variant="outline">
                        {sponsorLabel({ account_type: p?.account_type, insurance_plan: p?.insurance_plan })}
                      </Badge>
                      <Badge variant="outline">Copay {pct}%</Badge>
                      {a.reason && <Badge variant="outline">{a.reason}</Badge>}
                    </div>

                    {a.admission_note && (
                      <p className="text-xs bg-muted/50 rounded p-2">{a.admission_note}</p>
                    )}

                    {a.admission_snap_path && <SnapImage path={a.admission_snap_path} />}

                    {pct === 0 ? (
                      <p className="text-xs text-emerald-700 dark:text-emerald-400">
                        ✓ Fully covered by sponsor — proceed to assign ward &amp; room.
                      </p>
                    ) : balance <= 0 ? (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        ⚠ No deposit yet. Send the patient to Reception to request a deposit and pay at the Cashier.
                        The card stays here until the balance shows up.
                      </p>
                    ) : (
                      <p className="text-xs text-emerald-700 dark:text-emerald-400">
                        ✓ Deposit of {fmt(balance)} received — you can assign ward &amp; room.
                      </p>
                    )}

                    {can('assignBed') ? (
                      <Button size="sm" className="w-full" onClick={() => setAssignFor(a)}>
                        <BedDouble className="h-3.5 w-3.5 mr-1.5" /> Assign ward &amp; room
                      </Button>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Only a nurse can assign a ward &amp; room for this patient.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {assignFor && (
        <AssignBedDialog
          admission={assignFor}
          patient={patientOf.get(assignFor.patient_id)}
          onClose={() => setAssignFor(null)}
        />
      )}
    </div>
  );
}

function SnapImage({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    snapPhotoUrl(path).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [path]);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="Admission order snap" className="w-full max-h-56 object-contain rounded bg-muted" />
    </a>
  ) : (
    <div className="w-full h-24 bg-muted rounded animate-pulse" />
  );
}