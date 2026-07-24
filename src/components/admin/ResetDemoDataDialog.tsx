import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

type ModuleKey =
  | 'patients'
  | 'visits'
  | 'snaps'
  | 'billing'
  | 'prescriptions'
  | 'lab'
  | 'admissions'
  | 'anc'
  | 'notifications'
  | 'audit'
  | 'errors'
  | 'tasks';

// Order matters: dependents first, parents last.
const MODULES: {
  key: ModuleKey;
  label: string;
  description: string;
  tables: string[];
  postAction?: () => Promise<void>;
}[] = [
  {
    key: 'tasks',
    label: 'Task claims',
    description: 'Release all claimed tasks.',
    tables: ['task_claims'],
  },
  {
    key: 'notifications',
    label: 'Notifications',
    description: 'Clear notification inbox for all users.',
    tables: ['notifications'],
  },
  {
    key: 'errors',
    label: 'Error logs',
    description: 'Delete captured runtime errors.',
    tables: ['error_logs'],
  },
  {
    key: 'audit',
    label: 'Audit logs',
    description: 'Delete audit trail entries.',
    tables: ['audit_logs'],
  },
  {
    key: 'lab',
    label: 'Lab requests',
    description: 'Delete lab requests and results.',
    tables: ['lab_requests'],
  },
  {
    key: 'prescriptions',
    label: 'Prescriptions',
    description: 'Delete prescriptions and dispense records.',
    tables: ['prescription_items', 'prescriptions'],
  },
  {
    key: 'billing',
    label: 'Billing & payments',
    description: 'Delete invoices, items, balance requests and transactions.',
    tables: [
      'invoice_items',
      'sponsor_statement_items',
      'sponsor_statements',
      'insurance_claims',
      'balance_transactions',
      'balance_requests',
      'invoices',
    ],
  },
  {
    key: 'snaps',
    label: 'Snap orders',
    description: 'Delete snap photos and OCR data.',
    tables: ['snap_orders'],
  },
  {
    key: 'admissions',
    label: 'Admissions',
    description: 'Delete admissions and reset all beds to available.',
    tables: ['admissions'],
    postAction: async () => {
      await supabase.from('beds').update({ status: 'available' }).neq('id', '00000000-0000-0000-0000-000000000000');
    },
  },
  {
    key: 'anc',
    label: 'ANC records',
    description: 'Delete ANC programs and visits.',
    tables: ['anc_visits', 'anc_programs'],
  },
  {
    key: 'visits',
    label: 'Visits & clinical data',
    description: 'Delete visits, vitals, journey and attachments.',
    tables: [
      'visit_attachments',
      'emr_attachments',
      'vitals',
      'patient_journey_history',
      'patient_journey',
      'visits',
    ],
  },
  {
    key: 'patients',
    label: 'Patients',
    description: 'Delete all patient records. Requires clearing dependents.',
    tables: ['patients'],
  },
];

const CONFIRM_PHRASE = 'RESET';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ResetDemoDataDialog({ open, onOpenChange }: Props) {
  const [selected, setSelected] = useState<Set<ModuleKey>>(new Set());
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (key: ModuleKey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const reset = () => {
    setSelected(new Set());
    setConfirmText('');
  };

  const canSubmit =
    selected.size > 0 && confirmText.trim().toUpperCase() === CONFIRM_PHRASE && !busy;

  const runReset = async () => {
    setBusy(true);
    const errors: string[] = [];
    let clearedTables = 0;

    for (const mod of MODULES) {
      if (!selected.has(mod.key)) continue;
      for (const table of mod.tables) {
        const { error } = await supabase
          .from(table as any)
          .delete()
          .not('id', 'is', null);
        if (error) {
          errors.push(`${table}: ${error.message}`);
        } else {
          clearedTables++;
        }
      }
      if (mod.postAction) {
        try {
          await mod.postAction();
        } catch (e: any) {
          errors.push(`${mod.key} post-action: ${e?.message ?? e}`);
        }
      }
    }

    setBusy(false);

    if (errors.length) {
      toast({
        title: 'Reset completed with errors',
        description: `${clearedTables} tables cleared. ${errors.length} error(s). Check console.`,
        variant: 'destructive',
      });
      console.error('Reset errors:', errors);
    } else {
      toast({
        title: 'Demo data reset',
        description: `Cleared ${clearedTables} table(s) across ${selected.size} module(s).`,
      });
    }

    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!busy) {
          onOpenChange(o);
          if (!o) reset();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Reset demo data
          </DialogTitle>
          <DialogDescription>
            Select the modules to clear. Staff, roles, wards/rooms/beds, pricelist,
            corporate accounts and insurance providers are preserved.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-72 overflow-y-auto space-y-2 border border-border rounded-md p-3">
          {MODULES.map((mod) => (
            <label
              key={mod.key}
              className="flex items-start gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
            >
              <Checkbox
                checked={selected.has(mod.key)}
                onCheckedChange={() => toggle(mod.key)}
                disabled={busy}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium">{mod.label}</p>
                <p className="text-xs text-muted-foreground">{mod.description}</p>
              </div>
            </label>
          ))}
        </div>

        {selected.has('patients') && !selected.has('visits') && (
          <p className="text-xs text-warning">
            Tip: deleting patients requires clearing visits & related data first, or
            it may fail due to foreign key constraints.
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="confirm-reset">
            Type <span className="font-mono font-bold">{CONFIRM_PHRASE}</span> to confirm
          </Label>
          <Input
            id="confirm-reset"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={CONFIRM_PHRASE}
            disabled={busy}
            autoComplete="off"
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={runReset}
            disabled={!canSubmit}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Resetting…
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4 mr-2" />
                Reset selected ({selected.size})
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}