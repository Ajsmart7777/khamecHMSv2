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
  | 'notifications'
  | 'audit'
  | 'errors'
  | 'tasks';

// Order matters: dependents first, parents last.
const MODULES: {
  key: ModuleKey;
  label: string;
  description: string;
}[] = [
  { key: 'tasks', label: 'Task claims', description: 'Release all claimed tasks.' },
  { key: 'notifications', label: 'Notifications', description: 'Clear notification inbox for all users.' },
  { key: 'errors', label: 'Error logs', description: 'Delete captured runtime errors.' },
  { key: 'audit', label: 'Audit logs', description: 'Delete audit trail entries.' },
  { key: 'lab', label: 'Lab requests', description: 'Delete lab requests and results.' },
  { key: 'prescriptions', label: 'Prescriptions', description: 'Delete prescriptions and dispense records.' },
  { key: 'billing', label: 'Billing & payments', description: 'Delete invoices, items, balance requests and transactions.' },
  { key: 'snaps', label: 'Snap orders', description: 'Delete snap photos and OCR data.' },
  { key: 'admissions', label: 'Admissions', description: 'Delete admissions and reset all beds to available.' },
  { key: 'visits', label: 'Visits & clinical data', description: 'Delete visits, vitals, journey and attachments.' },
  {
    key: 'patients',
    label: 'Patients',
    description:
      'Delete all registered patients after linked clinical modules are selected. Archive register entries are retained without a patient link.',
  },
];

const CONFIRM_PHRASE = 'RESET';
const PATIENT_DEPENDENCY_MODULES: ModuleKey[] = [
  'lab',
  'prescriptions',
  'billing',
  'snaps',
  'admissions',
  'visits',
];

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

  const missingPatientDependencies = PATIENT_DEPENDENCY_MODULES.filter(
    (module) => !selected.has(module),
  );
  const patientPurgeIsSafe =
    !selected.has('patients') || missingPatientDependencies.length === 0;
  const canSubmit =
    selected.size > 0 &&
    confirmText.trim().toUpperCase() === CONFIRM_PHRASE &&
    patientPurgeIsSafe &&
    !busy;

  const runReset = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc('purge_clinical_data', {
      _modules: Array.from(selected),
    });
    setBusy(false);

    if (error) {
      toast({
        title: 'Purge failed',
        description: error.message,
        variant: 'destructive',
      });
      console.error('Purge error:', error);
      return;
    }

    const summary = (data ?? {}) as Record<string, number>;
    const totalRows = Object.values(summary).reduce((a, b) => a + (b || 0), 0);
    toast({
      title: 'Clinical data purged',
      description: `Deleted ${totalRows} row(s) across ${Object.keys(summary).length} table(s).`,
    });
    console.info('Purge summary:', summary);

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
            Purge clinical data
          </DialogTitle>
          <DialogDescription>
            Irreversible. Select the modules to permanently delete. Staff, roles,
            wards/rooms/beds, pricelist, corporate accounts and insurance providers
            are preserved.
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

        {selected.has('patients') && !patientPurgeIsSafe && (
          <p className="text-xs text-warning">
            Select all patient-linked clinical modules before purging patients: {missingPatientDependencies
              .map((module) => MODULES.find((item) => item.key === module)?.label)
              .filter(Boolean)
              .join(', ')}.
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
                Purging…
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4 mr-2" />
                Purge selected ({selected.size})
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}