import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Lock, Unlock, Users, Loader2, Pencil, Trash2 } from 'lucide-react';
import { PayrollPeriod, PayrollEntry } from '@/hooks/usePayroll';
import { toast } from '@/hooks/use-toast';
import {
  calculatePayrollTotals,
  DEFAULT_PAYROLL_LABELS,
  PAYROLL_COLUMNS,
  PAYROLL_ALLOWANCE_KEYS,
  PAYROLL_DEDUCTION_KEYS,
  type PayrollColumnDefinition,
  isPayrollTextField,
} from '@/lib/payroll';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface Props {
  periods: PayrollPeriod[];
  selectedPeriod: PayrollPeriod | null;
  onSelectPeriod: (p: PayrollPeriod) => void;
  entries: PayrollEntry[];
  entriesLoading: boolean;
  onCreatePeriod: (month: number, year: number) => Promise<PayrollPeriod | null>;
  onUpdatePeriodLabels: (id: string, labels: Record<string, string>) => Promise<boolean>;
  onLockPeriod: (id: string) => Promise<boolean>;
  onUnlockPeriod: (id: string) => Promise<boolean>;
  onAddAllStaff: () => Promise<void>;
  onUpdateEntry: (id: string, updates: Partial<PayrollEntry>) => Promise<boolean>;
  onRemoveEntry: (id: string) => Promise<boolean>;
}

const formatAmount = (value: number) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

function PayrollFloatingScrollbar({ containerRef, enabled }: { containerRef: { current: HTMLDivElement | null }; enabled: boolean }) {
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const [needsScroll, setNeedsScroll] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    const scrollbar = scrollbarRef.current;
    if (!container || !scrollbar) return;

    const measure = () => {
      const width = container.scrollWidth;
      setContentWidth(width);
      setNeedsScroll(width > container.clientWidth + 1);
      scrollbar.scrollLeft = container.scrollLeft;
    };
    const syncFromTable = () => {
      if (Math.abs(scrollbar.scrollLeft - container.scrollLeft) > 1) scrollbar.scrollLeft = container.scrollLeft;
    };
    const syncFromScrollbar = () => {
      if (Math.abs(container.scrollLeft - scrollbar.scrollLeft) > 1) container.scrollLeft = scrollbar.scrollLeft;
    };

    measure();
    container.addEventListener('scroll', syncFromTable, { passive: true });
    scrollbar.addEventListener('scroll', syncFromScrollbar, { passive: true });
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(container);
    return () => {
      container.removeEventListener('scroll', syncFromTable);
      scrollbar.removeEventListener('scroll', syncFromScrollbar);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [containerRef, enabled]);

  return <div
    ref={scrollbarRef}
    aria-label="Payroll table horizontal scrolling"
    className="fixed bottom-3 left-[clamp(1rem,19vw,16.5rem)] right-4 z-[60] overflow-x-auto rounded-lg border-2 border-primary/30 bg-white px-1 py-1 shadow-xl print:hidden"
    style={{ visibility: enabled && needsScroll ? 'visible' : 'hidden', pointerEvents: enabled && needsScroll ? 'auto' : 'none' }}
  >
    <div aria-hidden="true" style={{ width: `${contentWidth}px`, height: '12px' }} />
  </div>;
}

export function PayrollManager({
  periods, selectedPeriod, onSelectPeriod, entries, entriesLoading,
  onCreatePeriod, onUpdatePeriodLabels, onLockPeriod, onUnlockPeriod,
  onAddAllStaff, onUpdateEntry, onRemoveEntry,
}: Props) {
  const [newPeriodDialog, setNewPeriodDialog] = useState(false);
  const [newMonth, setNewMonth] = useState(new Date().getMonth() + 1);
  const [newYear, setNewYear] = useState(new Date().getFullYear());
  const [creating, setCreating] = useState(false);
  const [addingAll, setAddingAll] = useState(false);
  const [locking, setLocking] = useState(false);
  const [renaming, setRenaming] = useState<PayrollColumnDefinition | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [savingRename, setSavingRename] = useState(false);
  const [editingCell, setEditingCell] = useState<{ entryId: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const longPressTimer = useRef<number | null>(null);
  const [columnLabels, setColumnLabels] = useState<Record<string, string>>({ ...DEFAULT_PAYROLL_LABELS });
  const payrollScrollRef = useRef<HTMLDivElement>(null);

  const isDraft = selectedPeriod?.status === 'draft';

  useEffect(() => {
    setColumnLabels({ ...DEFAULT_PAYROLL_LABELS, ...(selectedPeriod?.column_labels || {}) });
  }, [selectedPeriod]);

  const totalGross = entries.reduce((sum, entry) => sum + entry.gross_pay, 0);
  const totalDeductions = entries.reduce((sum, entry) => sum + entry.total_deductions, 0);
  const totalNet = entries.reduce((sum, entry) => sum + entry.net_pay, 0);

  const getColumnTotal = (column: PayrollColumnDefinition): number | null => {
    if (column.key === 'basic_salary') return entries.reduce((sum, entry) => sum + entry.basic_salary, 0);
    if (column.key === 'gross_pay') return totalGross;
    if (column.key === 'total_deductions') return totalDeductions;
    if (column.key === 'net_pay') return totalNet;
    if (isPayrollTextField(column.key)) return null;
    if (column.kind === 'earning' || column.kind === 'input' || column.kind === 'deduction') {
      return entries.reduce((sum, entry) => {
        const values = column.kind === 'deduction' ? entry.deductions : entry.allowances;
        return sum + (Number(values[column.key]) || 0);
      }, 0);
    }
    return null;
  };

  const handleCreate = async () => {
    setCreating(true);
    const period = await onCreatePeriod(newMonth, newYear);
    setCreating(false);
    if (period) {
      onSelectPeriod(period);
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

  const beginRename = (column: PayrollColumnDefinition) => {
    if (!isDraft || !selectedPeriod) return;
    setRenaming(column);
    setRenameValue(columnLabels[column.key] || column.label);
  };

  const saveRename = async () => {
    if (!renaming || !selectedPeriod || !renameValue.trim()) return;
    const nextLabels = { ...columnLabels, [renaming.key]: renameValue.trim() };
    setSavingRename(true);
    const saved = await onUpdatePeriodLabels(selectedPeriod.id, nextLabels);
    setSavingRename(false);
    if (saved) {
      setColumnLabels(nextLabels);
      setRenaming(null);
    }
  };

  const handleHeaderPointerDown = (column: PayrollColumnDefinition) => {
    if (!isDraft) return;
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => beginRename(column), 550);
  };

  const clearLongPress = () => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  const startEdit = (entryId: string, field: string, currentValue: number | string) => {
    if (!isDraft) return;
    setEditingCell({ entryId, field });
    setEditValue(String(currentValue ?? (isPayrollTextField(field) ? '' : 0)));
  };

  const commitEdit = async (entry: PayrollEntry) => {
    if (!editingCell) return;
    const { field } = editingCell;
    if (isPayrollTextField(field)) {
      const nextAllowances = { ...entry.allowances, [field]: editValue };
      setEditingCell(null);
      await onUpdateEntry(entry.id, { allowances: nextAllowances });
      return;
    }
    const value = Number(editValue.replace(/,/g, ''));
    const amount = Number.isFinite(value) && value >= 0 ? value : 0;
    const nextAllowances = { ...entry.allowances };
    const nextDeductions = { ...entry.deductions };
    let nextBasic = entry.basic_salary;

    if (field === 'basic_salary') nextBasic = amount;
    else if (PAYROLL_ALLOWANCE_KEYS.includes(field)) nextAllowances[field] = amount;
    else if (PAYROLL_DEDUCTION_KEYS.includes(field)) nextDeductions[field] = amount;

    setEditingCell(null);
    await onUpdateEntry(entry.id, {
      basic_salary: nextBasic,
      allowances: nextAllowances,
      deductions: nextDeductions,
    });
  };

  const renderEditableCell = (entry: PayrollEntry, field: string, value: number) => {
    const isEditing = editingCell?.entryId === entry.id && editingCell.field === field;
    if (isEditing) {
      return (
        <Input
          type="number"
          min={0}
          value={editValue}
          onChange={event => setEditValue(event.target.value)}
          onBlur={() => void commitEdit(entry)}
          onKeyDown={event => {
            if (event.key === 'Enter') void commitEdit(entry);
            if (event.key === 'Escape') setEditingCell(null);
          }}
          className="h-9 w-28 px-2 text-sm text-right"
          autoFocus
        />
      );
    }
    return (
      <button
        type="button"
        className={isDraft ? 'min-w-24 cursor-pointer rounded px-2 py-1 text-right text-sm hover:bg-accent/60' : 'min-w-24 px-2 py-1 text-right text-sm'}
        onClick={() => startEdit(entry.id, field, value)}
        disabled={!isDraft}
        title={isDraft ? 'Click to edit' : 'Locked payroll'}
      >
        {formatAmount(value)}
      </button>
    );
  };

  const renderEditableTextCell = (entry: PayrollEntry, field: string, value: string) => {
    const isEditing = editingCell?.entryId === entry.id && editingCell.field === field;
    if (isEditing) {
      return <Input type="text" value={editValue} onChange={event => setEditValue(event.target.value)} onBlur={() => void commitEdit(entry)} onKeyDown={event => { if (event.key === 'Enter') void commitEdit(entry); if (event.key === 'Escape') setEditingCell(null); }} className="h-9 w-32 px-2 text-sm" autoFocus />;
    }
    return <button type="button" className={isDraft ? 'min-w-28 cursor-pointer rounded px-2 py-1 text-left text-sm hover:bg-accent/60' : 'min-w-28 px-2 py-1 text-left text-sm'} onClick={() => startEdit(entry.id, field, value)} disabled={!isDraft} title={isDraft ? 'Click to edit text' : 'Locked payroll'}>{value || '—'}</button>;
  };

  const renderColumnCell = (entry: PayrollEntry, column: PayrollColumnDefinition) => {
    if (column.key === 'id') return entry.staff_employee_id || '—';
    if (column.key === 'staff_name') return entry.staff_name || 'Unknown Staff';
    if (column.key === 'designation') return entry.staff_designation || '—';
    if (isPayrollTextField(column.key)) return renderEditableTextCell(entry, column.key, String(entry.allowances[column.key] ?? ''));
    if (column.key === 'basic_salary') return renderEditableCell(entry, column.key, entry.basic_salary);
    if (column.key === 'gross_pay') return <span className="font-semibold">{formatAmount(entry.gross_pay)}</span>;
    if (column.key === 'total_deductions') return <span className="font-semibold text-destructive">{formatAmount(entry.total_deductions)}</span>;
    if (column.key === 'net_pay') return <span className="font-bold">{formatAmount(entry.net_pay)}</span>;
    const value = column.kind === 'deduction'
      ? Number(entry.deductions[column.key]) || 0
      : Number(entry.allowances[column.key]) || 0;
    return renderEditableCell(entry, column.key, value);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <Select
          value={selectedPeriod?.id || ''}
          onValueChange={value => {
            const period = periods.find(candidate => candidate.id === value);
            if (period) onSelectPeriod(period);
          }}
        >
          <SelectTrigger className="w-full sm:w-64"><SelectValue placeholder="Select payroll period" /></SelectTrigger>
          <SelectContent>
            {periods.map(period => (
              <SelectItem key={period.id} value={period.id}>
                {MONTHS[period.month - 1]} {period.year} ({period.status})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedPeriod && (
          <Badge variant={selectedPeriod.status === 'draft' ? 'outline' : selectedPeriod.status === 'locked' ? 'warning' : 'success'}>
            {selectedPeriod.status.toUpperCase()}
          </Badge>
        )}

        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setNewPeriodDialog(true)}>
            <Plus className="mr-1 h-4 w-4" /> New Period
          </Button>
          {isDraft && (
            <Button variant="outline" size="sm" onClick={() => void handleAddAll()} disabled={addingAll}>
              {addingAll ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Users className="mr-1 h-4 w-4" />}
              Add All Staff
            </Button>
          )}
          {isDraft && (
            <Button variant="destructive" size="sm" onClick={() => void handleLock()} disabled={locking}>
              {locking ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Lock className="mr-1 h-4 w-4" />}
              Lock Payroll
            </Button>
          )}
          {selectedPeriod?.status === 'locked' && (
            <Button variant="outline" size="sm" onClick={() => void handleUnlock()} disabled={locking}>
              {locking ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Unlock className="mr-1 h-4 w-4" />}
              Unlock Payroll
            </Button>
          )}
        </div>
      </div>

      {selectedPeriod && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          <Pencil className="mr-1 inline h-3 w-3" /> Click any amount to edit. Right-click a column heading on computer, or hold it briefly on a tablet, to rename it.
        </div>
      )}

      {selectedPeriod && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">Total Gross Pay</p>
            <p className="text-2xl font-bold">₦{formatAmount(totalGross)}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">Total Deductions</p>
            <p className="text-2xl font-bold text-destructive">₦{formatAmount(totalDeductions)}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">Total Net Pay</p>
            <p className="text-2xl font-bold text-success">₦{formatAmount(totalNet)}</p>
          </div>
        </div>
      )}

      {selectedPeriod && (
        entriesLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
          <div className="rounded-xl border border-border">
            <div ref={payrollScrollRef} className="overflow-x-auto">
              <Table className="min-w-[2480px] table-fixed text-sm">
                <TableHeader className="sticky top-16 z-30 bg-white shadow-sm md:top-20 print:static print:shadow-none">
                  <TableRow className="bg-muted/50">
                    {PAYROLL_COLUMNS.map(column => (
                      <TableHead
                        key={column.key}
                        className={`whitespace-normal break-words px-3 py-3 text-center text-xs leading-tight font-bold ${column.kind === 'deduction' || column.kind === 'computed-deduction' ? 'text-destructive' : ''} ${['id', 'staff_name'].includes(column.key) ? 'sticky z-10 bg-muted/50' : ''} ${column.key === 'id' ? 'left-0 w-28' : column.key === 'staff_name' ? 'left-[112px] w-56' : column.key === 'designation' ? 'w-48' : column.kind === 'computed-earning' || column.kind === 'computed-deduction' || column.kind === 'computed-net' ? 'w-36' : column.kind === 'identity' ? 'w-40' : 'w-28'}`}
                        onContextMenu={event => { event.preventDefault(); beginRename(column); }}
                        onPointerDown={() => handleHeaderPointerDown(column)}
                        onPointerUp={clearLongPress}
                        onPointerLeave={clearLongPress}
                        onPointerCancel={clearLongPress}
                        title={isDraft ? 'Right-click or hold to rename' : undefined}
                      >
                        {columnLabels[column.key] || column.label}
                      </TableHead>
                    ))}
                    <TableHead className="w-20 px-3 py-3 text-center text-xs font-bold">REMOVE</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map(entry => (
                    <TableRow key={entry.id} className="hover:bg-muted/30">
                      {PAYROLL_COLUMNS.map(column => (
                      <TableCell
                        key={column.key}
                        className={`px-3 py-3 ${['id', 'staff_name'].includes(column.key) ? 'sticky z-10 bg-background' : ''} ${column.key === 'id' ? 'left-0 w-28 whitespace-nowrap font-mono text-xs' : column.key === 'staff_name' ? 'left-[112px] w-56 whitespace-normal break-words font-medium text-sm' : column.key === 'designation' ? 'w-48 whitespace-normal break-words text-sm text-muted-foreground' : column.kind === 'identity' ? 'w-40 text-sm' : 'w-28 text-sm'} ${['gross_pay', 'total_deductions', 'net_pay'].includes(column.key) ? 'bg-primary/5' : ''}`}
                        >
                          {renderColumnCell(entry, column)}
                        </TableCell>
                      ))}
                      <TableCell className="w-20 px-3 py-3">
                        {isDraft && <Button variant="ghost" size="icon" className="h-9 w-9" title="Remove from this payroll only" onClick={() => { if (confirm(`Remove ${entry.staff_name} from this payroll period? The staff record will remain unchanged.`)) void onRemoveEntry(entry.id); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {entries.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={PAYROLL_COLUMNS.length} className="py-8 text-center text-muted-foreground">
                        No entries. Click “Add All Staff” to populate this period.
                      </TableCell>
                    </TableRow>
                  )}
                  {entries.length > 0 && (
                    <TableRow className="border-t-2 border-primary/30 bg-primary/10 font-bold">
                      {PAYROLL_COLUMNS.map(column => {
                        const total = getColumnTotal(column);
                        return (
                          <TableCell
                            key={column.key}
                            className={`px-3 py-4 text-right text-sm ${['id', 'staff_name'].includes(column.key) ? 'sticky z-10 bg-primary/10' : ''} ${column.key === 'id' ? 'left-0 w-28 text-left text-xs' : column.key === 'staff_name' ? 'left-[112px] w-56 text-left' : column.key === 'designation' ? 'w-48 text-left text-xs text-muted-foreground' : column.kind === 'identity' ? 'w-40' : column.kind === 'computed-earning' || column.kind === 'computed-deduction' || column.kind === 'computed-net' ? 'w-36' : 'w-28'} ${['total_deductions'].includes(column.key) ? 'text-destructive' : ''}`}
                          >
                            {column.key === 'id' ? 'TOTAL' : column.key === 'staff_name' ? '' : column.key === 'designation' ? '' : total === null ? '' : formatAmount(total)}
                          </TableCell>
                        );
                      })}
                      <TableCell className="w-20 px-3 py-4 text-center text-sm">—</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
          <PayrollFloatingScrollbar containerRef={payrollScrollRef} enabled={Boolean(selectedPeriod && !entriesLoading && entries.length > 0)} />
          </>
        )
      )}

      {!selectedPeriod && <div className="py-12 text-center text-muted-foreground">Select or create a payroll period to get started.</div>}

      <Dialog open={newPeriodDialog} onOpenChange={setNewPeriodDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create New Payroll Period</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Month</label>
              <Select value={String(newMonth)} onValueChange={value => setNewMonth(Number(value))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{MONTHS.map((month, index) => <SelectItem key={month} value={String(index + 1)}>{month}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Year</label>
              <Input type="number" value={newYear} onChange={event => setNewYear(Number(event.target.value))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewPeriodDialog(false)}>Cancel</Button>
            <Button onClick={() => void handleCreate()} disabled={creating}>{creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(renaming)} onOpenChange={open => { if (!open) setRenaming(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Rename payroll column</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This name is saved for this payroll period and copied to the next month.</p>
          <Input value={renameValue} onChange={event => setRenameValue(event.target.value)} autoFocus onKeyDown={event => { if (event.key === 'Enter') void saveRename(); }} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>Cancel</Button>
            <Button onClick={() => void saveRename()} disabled={savingRename || !renameValue.trim()}>{savingRename && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save name</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
