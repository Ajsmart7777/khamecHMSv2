import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Database, RefreshCw, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Emergency Episode billing is a separate billing track: it must never move a
 * patient between stations or block a discharge. The database RPCs that used
 * to move the patient to `awaiting_payment` when an Emergency draft was billed
 * are replaced by an idempotent migration served from the Netlify function
 * `run-migration`. This panel applies that migration (safe to run repeatedly)
 * and gives the admin a visible one-click way to trigger it after a deploy.
 */
const EMERGENCY_FLOW_MIGRATION = 'emergency_billing_patient_flow';

// Avoid hammering the function on every mount within one page session.
let autoAttempted = false;

async function runMigration(migration: string): Promise<{ ok: boolean; message: string }> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('hms_access_token') : null;
  try {
    const res = await fetch('/.netlify/functions/run-migration', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ migration }),
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) detail = body.error;
      } catch {
        // non-JSON error body — keep the status code
      }
      return { ok: false, message: detail };
    }
    return { ok: true, message: `${migration} applied` };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Migration endpoint unavailable' };
  }
}

export function DatabaseMaintenancePanel() {
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<{ ok: boolean; message: string } | null>(null);
  const autoAttemptRef = useRef(false);

  useEffect(() => {
    // Fire-and-forget: if the migration endpoint is reachable and the caller is
    // admin it applies the (idempotent) fix once per session; failures are
    // silent so a missing function or non-admin session never disturbs the page.
    if (autoAttempted || autoAttemptRef.current) return;
    autoAttempted = true;
    autoAttemptRef.current = true;
    void runMigration(EMERGENCY_FLOW_MIGRATION).then((result) => {
      if (result.ok) setLastResult(result);
    });
  }, []);

  const apply = async () => {
    if (busy) return;
    setBusy(true);
    setLastResult(null);
    try {
      const result = await runMigration(EMERGENCY_FLOW_MIGRATION);
      setLastResult(result);
      if (result.ok) {
        toast.success('Emergency billing separation applied', {
          description: 'Emergency Episode drafts/invoices no longer move the patient or block discharge.',
        });
      } else {
        toast.error('Could not apply the database fix', { description: result.message });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <h3 className="font-semibold mb-3 flex items-center gap-2">
        <Database className="h-5 w-5 text-module-admin" />
        Database Maintenance
      </h3>
      <p className="text-xs text-muted-foreground mb-3">
        Emergency Episode billing lives on a separate track: its drafts, invoices and payments must
        never change a patient&apos;s status or journey. This applies that rule to the database.
        Safe to run again — it only re-applies the rule, it does not change any patient data.
      </p>
      <Button
        variant="outline"
        className="w-full justify-start hover-lift"
        onClick={apply}
        disabled={busy}
      >
        {busy ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
        {busy ? 'Applying…' : 'Apply emergency billing fix'}
      </Button>
      {lastResult && (
        <p className={`text-xs mt-2 ${lastResult.ok ? 'text-success' : 'text-destructive'}`}>
          {lastResult.ok ? 'Applied successfully.' : `Failed: ${lastResult.message}`}
        </p>
      )}
    </div>
  );
}