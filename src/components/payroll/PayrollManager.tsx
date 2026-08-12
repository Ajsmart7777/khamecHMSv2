import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Lock, Unlock, Users, Loader2, Trash2, Columns, Info, RefreshCw } from 'lucide-react';
import { PayrollPeriod, PayrollEntry } from '@/hooks/usePayroll';
import { toast } from '@/hooks/use-toast';
import { MedicalDeductionDetails } from './MedicalDeductionDetails';


const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const DEFAULT_ALLOWANCE_KEYS = [
  { key: 'first_appointment', label: '1st App' },
  { key: 'sl', label: 'SL' },
  { key: 'housing', label: 'House' },
  { key: 'transport', label: 'Transport' },
  { key: 'la', label: 'LA' },
  { key: 'dh', label: 'DH' },
  { key: 'call', label: 'Call' },
  { key: 'responsibility', label: 'Resp' },
  { key: 'ot', label: 'OT' },
  { key: 'leave', label: 'Leave' },
  { key: 'extra', label: 'Extra' },
  { key: 'no', label: 'No.' },
  { key: 'hours', label: 'Hours' },
];

const DEFAULT_DEDUCTION_KEYS = [
  { key: 'paye', label: 'PAYE' },
  { key: 'pension', label: 'Pension' },
  { key: 'loan', label: 'Loan' },
  { key: 'contribution', label: 'Contri.' },
  { key: 'family_medical', label: 'Family Med' },
];

interface Props {
  periods: PayrollPeriod[];
  selectedPeriod: PayrollPeriod | null;
  onSelectPeriod: (p: PayrollPeriod) => void;
  entries: PayrollEntry[];
  entriesLoading: boolean;
  onCreatePeriod: (month: number, year: number) => Promise<PayrollPeriod | null>;
  onLockPeriod: (id: string) => Promise<boolean>;
  onUnlockPeriod: (id: string) => Promise<boolean>;
  onAddAllStaff: () => Promise<void>;
  onUpdateEntry: (id: string, updates: Partial<PayrollEntry>) => Promise<boolean>;
  onRemoveEntry: (id: string) => Promise<boolean>;
  onRecalculate?: () => Promise<void>;
}


interface CustomColumn {
  key: string;
  label: string;
  type: 'allowance' | 'deduction';
}

export function PayrollManager({
  periods, selectedPeriod, onSelectPeriod, entries, entriesLoading,
  onCreatePeriod, onLockPeriod, onUnlockPeriod, onAddAllStaff, onUpdateEntry, onRemoveEntry, onRecalculate
}: Props) {

  const [newPeriodDialog, setNewPeriodDialog] = useState(false);
  const [newMonth, setNewMonth] = useState(new Date().getMonth() + 1);
  const [newYear, setNewYear] = useState(new Date().getFullYear());
  const [creating, setCreating] = useState(false);
  const [addingAll, setAddingAll] = useState(false);
  const [locking, setLocking] = useState(false);
  const [addColumnDialog, setAddColumnDialog] = useState(false);
  const [newColLabel, setNewColLabel] = useState('');
  const [newColType, setNewColType] = useState<'allowance' | 'deduction'>('allowance');
  const [recalculating, setRecalculating] = useState(false);
  const [customColumns, setCustomColumns] = useState<CustomColumn[]>([]);

  const [editingCell, setEditingCell] = useState<{ entryId: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [medicalDetailsOpen, setMedicalDetailsOpen] = useState(false);
  const [selectedMedicalEntry, setSelectedMedicalEntry] = useState<{ staffId: string; staffName: string } | null>(null);


  const isDraft = selectedPeriod?.status === 'draft';

  const allAllowanceKeys = [...DEFAULT_ALLOWANCE_KEYS, ...customColumns.filter(c => c.type === 'allowance')];
  const allDeductionKeys = [...DEFAULT_DEDUCTION_KEYS, ...customColumns.filter(c => c.type === 'deduction')];

  const totalGross = entries.reduce((s, e) => s + e.gross_pay, 0);
  const totalDeductions = entries.reduce((s, e) => s + e.total_deductions, 0);
  const totalNet = entries.reduce((s, e) => s + e.net_pay, 0);

  const handleCreate = async () => {
    setCreating(true);
    const p = await onCreatePeriod(newMonth, newYear);
    setCreating(false);
    if (p) {
      onSelectPeriod(p);
      setNewPeriodDialog(false);
    }
  };

  const handleLock = async () => {
    if (!selectedPeriod) return;
    if (entries.length === 0) {
      toast({ title: 'Error', description: 'Add staff before locking.', variant: 'destructive' });
      return;
    }
    if (!confirm(`Are you sure you want to lock ${MONTHS[selectedPeriod.month - 1]} ${selectedPeriod.year} payroll? Entries will no longer be editable.`)) return;
    setLocking(true);
    await onLockPeriod(selectedPeriod.id);
    setLocking(false);
  };

  const handleUnlock = async () => {
    if (!selectedPeriod) return;
    if (!confirm(`Are you sure you want to unlock ${MONTHS[selectedPeriod.month - 1]} ${selectedPeriod.year} payroll? This will allow editing again.`)) return;
    setLocking(true);
    await onUnlockPeriod(selectedPeriod.id);
    setLocking(false);
  };

  const handleAddAll = async () => {
    setAddingAll(true);
    await onAddAllStaff();
    setAddingAll(false);
  };

  const handleRecalculate = async () => {
    if (!onRecalculate) return;
    setRecalculating(true);
    await onRecalculate();
    setRecalculating(false);
  };

  const handleAddColumn = () => {

    if (!newColLabel.trim()) return;
    const key = newColLabel.trim().toLowerCase().replace(/\s+/g, '_');
    if ([...allAllowanceKeys, ...allDeductionKeys].some(c => c.key === key)) {
      toast({ title: 'Error', description: 'Column already exists.', variant: 'destructive' });
      return;
    }
    setCustomColumns(prev => [...prev, { key, label: newColLabel.trim(), type: newColType }]);
    setNewColLabel('');
    setAddColumnDialog(false);
  };

  const startEdit = (entryId: string, field: string, currentValue: number) => {
    if (!isDraft) return;
    setEditingCell({ entryId, field });
    setEditValue(String(currentValue));
  };

  const commitEdit = async (entry: PayrollEntry) => {
    if (!editingCell) return;
    const val = Number(editValue) || 0;
    const { field } = editingCell;

    let newAllowances = { ...entry.allowances };
    let newDeductions = { ...entry.deductions };
    let newBasic = entry.basic_salary;

    if (field === 'basic_salary') {
      newBasic = val;
    } else if (allAllowanceKeys.some(a => a.key === field)) {
      newAllowances = { ...newAllowances, [field]: val };
    } else if (allDeductionKeys.some(d => d.key === field)) {
      newDeductions = { ...newDeductions, [field]: val };
    }

    setEditingCell(null);
    await onUpdateEntry(entry.id, {
      basic_salary: newBasic,
      allowances: newAllowances,
      deductions: newDeductions,
    });
  };

  const renderEditableCell = (entry: PayrollEntry, field: string, value: number) => {
    const isEditing = editingCell?.entryId === entry.id && editingCell?.field === field;
    if (isEditing) {
      return (
        <Input
          type="number"
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={() => commitEdit(entry)}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(entry); if (e.key === 'Escape') setEditingCell(null); }}
          className="h-7 w-20 text-xs p-1"
          autoFocus
        />
      );
    }
    if (field === 'family_medical') {
      return (
        <div className="flex items-center justify-center gap-1 group">
          <span
            className={isDraft ? 'cursor-pointer hover:bg-accent/50 px-1 py-0.5 rounded text-xs' : 'text-xs'}
            onClick={() => startEdit(entry.id, field, value)}
          >
            {value.toLocaleString()}
          </span>
          {value > 0 && (
            <button
              onClick={() => {
                setSelectedMedicalEntry({ staffId: entry.staff_id, staffName: entry.staff_name || 'Staff' });
                setMedicalDetailsOpen(true);
              }}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-muted rounded"
              title="View bill details"
            >
              <Info className="h-3 w-3 text-primary" />
            </button>
          )}
        </div>
      );
    }

    return (
      <span
        className={isDraft ? 'cursor-pointer hover:bg-accent/50 px-1 py-0.5 rounded text-xs' : 'text-xs'}
        onClick={() => startEdit(entry.id, field, value)}
      >
        {value.toLocaleString()}
      </span>
    );

  };

  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'paid': return 'success' as const;
      case 'processing': return 'warning' as const;
      default: return 'outline' as const;
    }
  };

  return (
    <div className="space-y-4">
      {/* Period Selector */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <Select
          value={selectedPeriod?.id || ''}
          onValueChange={v => {
            const p = periods.find(pp => pp.id === v);
            if (p) onSelectPeriod(p);
          }}
        >
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue placeholder="Select payroll period" />
          </SelectTrigger>
          <SelectContent>
            {periods.map(p => (
              <SelectItem key={p.id} value={p.id}>
                {MONTHS[p.month - 1]} {p.year} ({p.status})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedPeriod && (
          <Badge variant={selectedPeriod.status === 'draft' ? 'outline' : selectedPeriod.status === 'locked' ? 'warning' : 'success'}>
            {selectedPeriod.status.toUpperCase()}
          </Badge>
        )}

        <div className="flex gap-2 ml-auto flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setNewPeriodDialog(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Period
          </Button>
          {isDraft && (
            <>
              <Button variant="outline" size="sm" onClick={handleAddAll} disabled={addingAll}>
                {addingAll ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Users className="h-4 w-4 mr-1" />}
                Add All Staff
              </Button>
              <Button variant="outline" size="sm" onClick={handleRecalculate} disabled={recalculating || !onRecalculate}>
                {recalculating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                Recalculate
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAddColumnDialog(true)}>

                <Columns className="h-4 w-4 mr-1" /> Add Column
              </Button>
              <Button variant="destructive" size="sm" onClick={handleLock} disabled={locking}>
                {locking ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Lock className="h-4 w-4 mr-1" />}
                Lock Payroll
              </Button>
            </>
          )}
          {selectedPeriod?.status === 'locked' && (
            <Button variant="outline" size="sm" onClick={handleUnlock} disabled={locking}>
              {locking ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Unlock className="h-4 w-4 mr-1" />}
              Unlock Payroll
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      {selectedPeriod && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-sm text-muted-foreground">Total Gross</p>
            <p className="text-2xl font-bold">₦{totalGross.toLocaleString()}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-sm text-muted-foreground">Total Deductions</p>
            <p className="text-2xl font-bold text-destructive">₦{totalDeductions.toLocaleString()}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-sm text-muted-foreground">Total Net Pay</p>
            <p className="text-2xl font-bold text-success">₦{totalNet.toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* Payroll Table */}
      {selectedPeriod && (
        entriesLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-[10px] font-bold whitespace-nowrap sticky left-0 bg-muted/50 z-10">STAFF ID#</TableHead>
                    <TableHead className="text-[10px] font-bold whitespace-nowrap sticky left-[80px] bg-muted/50 z-10">STAFF NAME</TableHead>
                    <TableHead className="text-[10px] font-bold whitespace-nowrap">DESIGNATION</TableHead>
                    {/* Allowance columns */}
                    {allAllowanceKeys.map(col => (
                      <TableHead key={col.key} className="text-[10px] font-bold whitespace-nowrap text-center">
                        {col.label.toUpperCase()} ↕
                      </TableHead>
                    ))}
                    <TableHead className="text-[10px] font-bold whitespace-nowrap">BASIC ↕</TableHead>
                    <TableHead className="text-[10px] font-bold whitespace-nowrap bg-primary/10">GROSS PAY</TableHead>
                    {/* Deduction columns */}
                    {allDeductionKeys.map(col => (
                      <TableHead key={col.key} className="text-[10px] font-bold whitespace-nowrap text-center text-destructive">
                        {col.label.toUpperCase()} ↕
                      </TableHead>
                    ))}
                    <TableHead className="text-[10px] font-bold whitespace-nowrap text-destructive">TOTAL DEDUCTIONS</TableHead>
                    <TableHead className="text-[10px] font-bold whitespace-nowrap">ADVICE</TableHead>
                    <TableHead className="text-[10px] font-bold whitespace-nowrap bg-primary/10">NET PAY</TableHead>
                    <TableHead className="text-[10px] font-bold whitespace-nowrap">STATUS</TableHead>
                    {isDraft && <TableHead className="text-[10px] font-bold whitespace-nowrap">ACTIONS</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => {
                    const totalAllowances = allAllowanceKeys.reduce((s, col) => s + (Number(entry.allowances[col.key]) || 0), 0);
                    return (
                      <TableRow key={entry.id} className="hover:bg-muted/30">
                        <TableCell className="font-mono text-[11px] whitespace-nowrap sticky left-0 bg-background z-10">
                          {entry.staff_employee_id}
                        </TableCell>
                        <TableCell className="font-medium text-[11px] whitespace-nowrap sticky left-[80px] bg-background z-10">
                          {entry.staff_name}
                        </TableCell>
                        <TableCell className="text-[11px] whitespace-nowrap text-muted-foreground">
                          {entry.staff_designation || '-'}
                        </TableCell>
                        {/* Allowance values */}
                        {allAllowanceKeys.map(col => (
                          <TableCell key={col.key} className="text-center">
                            {renderEditableCell(entry, col.key, Number(entry.allowances[col.key]) || 0)}
                          </TableCell>
                        ))}
                        {/* Basic */}
                        <TableCell>
                          {renderEditableCell(entry, 'basic_salary', entry.basic_salary)}
                        </TableCell>
                        {/* Gross */}
                        <TableCell className="font-semibold bg-primary/5 text-[11px]">
                          {entry.gross_pay.toLocaleString()}
                        </TableCell>
                        {/* Deduction values */}
                        {allDeductionKeys.map(col => (
                          <TableCell key={col.key} className="text-center">
                            {renderEditableCell(entry, col.key, Number(entry.deductions[col.key]) || 0)}
                          </TableCell>
                        ))}
                        {/* Total Deductions */}
                        <TableCell className="text-destructive text-[11px] font-medium">
                          {entry.total_deductions.toLocaleString()}
                        </TableCell>
                        {/* Advice (placeholder) */}
                        <TableCell className="text-[11px]">0</TableCell>
                        {/* Net Pay */}
                        <TableCell className="font-bold bg-primary/5 text-[11px]">
                          {entry.net_pay.toLocaleString()}
                        </TableCell>
                        {/* Status */}
                        <TableCell>
                          <Badge variant={getStatusVariant(entry.status)} className="text-[10px]">
                            {entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
                          </Badge>
                        </TableCell>
                        {isDraft && (
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onRemoveEntry(entry.id)}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                  {entries.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6 + allAllowanceKeys.length + allDeductionKeys.length + 5} className="text-center text-muted-foreground py-8">
                        No entries. Click "Add All Staff" to populate.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )
      )}

      <MedicalDeductionDetails
        open={medicalDetailsOpen}
        onOpenChange={setMedicalDetailsOpen}
        staffId={selectedMedicalEntry?.staffId || null}
        staffName={selectedMedicalEntry?.staffName || ''}
        month={selectedPeriod?.month || null}
        year={selectedPeriod?.year || null}
      />

      {!selectedPeriod && (

        <div className="text-center py-12 text-muted-foreground">
          Select or create a payroll period to get started.
        </div>
      )}

      {/* New Period Dialog */}
      <Dialog open={newPeriodDialog} onOpenChange={setNewPeriodDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create New Payroll Period</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Month</label>
              <Select value={String(newMonth)} onValueChange={v => setNewMonth(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Year</label>
              <Input type="number" value={newYear} onChange={e => setNewYear(Number(e.target.value))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewPeriodDialog(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Column Dialog */}
      <Dialog open={addColumnDialog} onOpenChange={setAddColumnDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Custom Column</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Column Name</label>
              <Input value={newColLabel} onChange={e => setNewColLabel(e.target.value)} placeholder="e.g. Hazard Pay" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Type</label>
              <Select value={newColType} onValueChange={v => setNewColType(v as 'allowance' | 'deduction')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="allowance">Allowance (adds to gross)</SelectItem>
                  <SelectItem value="deduction">Deduction (subtracts from gross)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddColumnDialog(false)}>Cancel</Button>
            <Button onClick={handleAddColumn}>Add Column</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
