import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { usePayrollPeriods, usePayrollEntries, type PayrollPeriod } from '@/hooks/usePayroll';
import { PayrollManager } from '@/components/payroll/PayrollManager';

export default function AccountPayroll() {
  const {
    periods,
    createPeriod,
    updatePeriodLabels,
    lockPeriod,
    unlockPeriod,
    refetch: refetchPeriods,
  } = usePayrollPeriods();
  const [selectedPeriod, setSelectedPeriod] = useState<PayrollPeriod | null>(null);
  const periodId = selectedPeriod?.id || periods[0]?.id || null;
  const {
    entries,
    loading: entriesLoading,
    addAllStaff,
    updateEntry,
    removeEntry,
    refetch: refetchEntries,
  } = usePayrollEntries(periodId, periods);

  useEffect(() => {
    if (!selectedPeriod && periods.length > 0) {
      setSelectedPeriod(periods[0]);
      return;
    }
    if (selectedPeriod) {
      const current = periods.find(period => period.id === selectedPeriod.id);
      if (current && current.status !== selectedPeriod.status) setSelectedPeriod(current);
    }
  }, [periods, selectedPeriod]);

  const handleLockPeriod = async (id: string) => {
    const result = await lockPeriod(id);
    if (result) setSelectedPeriod(previous => previous && previous.id === id ? { ...previous, status: 'locked' } : previous);
    return result;
  };

  const handleUnlockPeriod = async (id: string) => {
    const result = await unlockPeriod(id);
    if (result) setSelectedPeriod(previous => previous && previous.id === id ? { ...previous, status: 'draft' } : previous);
    return result;
  };

  const refreshPayroll = useCallback(() => {
    void refetchPeriods();
    void refetchEntries();
  }, [refetchPeriods, refetchEntries]);

  return (
    <MainLayout title="Payroll" subtitle="Full payroll workspace">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Dedicated payroll workspace</p>
          <p className="text-xs text-muted-foreground">The full grid has its own page so headings and horizontal scrolling remain easy to use.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/account"><ArrowLeft className="mr-1.5 h-4 w-4" /> Accounts</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/account?tab=reports"><FileText className="mr-1.5 h-4 w-4" /> Reports</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={refreshPayroll}>Refresh</Button>
        </div>
      </div>

      <PayrollManager
        periods={periods}
        selectedPeriod={selectedPeriod}
        onSelectPeriod={setSelectedPeriod}
        entries={entries}
        entriesLoading={entriesLoading}
        onCreatePeriod={async (month, year) => {
          const period = await createPeriod(month, year);
          if (period) {
            await refetchPeriods();
            setSelectedPeriod(period);
          }
          return period;
        }}
        onUpdatePeriodLabels={updatePeriodLabels}
        onLockPeriod={handleLockPeriod}
        onUnlockPeriod={handleUnlockPeriod}
        onAddAllStaff={addAllStaff}
        onUpdateEntry={updateEntry}
        onRemoveEntry={removeEntry}
      />
    </MainLayout>
  );
}
