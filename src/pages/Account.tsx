import { useState, useCallback, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { LayoutDashboard, Users, FileSpreadsheet, CreditCard, FileText, Building2, UserPlus, RefreshCw, DollarSign, Wallet } from 'lucide-react';
import { ClipboardList } from 'lucide-react';
import { PricelistManager } from '@/components/account/PricelistManager';
import { useStaff } from '@/hooks/useStaff';
import { usePayrollPeriods, usePayrollEntries } from '@/hooks/usePayroll';
import { useCorporateAccounts } from '@/hooks/useCorporateAccounts';
import { PayrollDashboard } from '@/components/payroll/PayrollDashboard';
import { PayrollStaffManagement } from '@/components/payroll/PayrollStaffManagement';
import { PayrollPayments } from '@/components/payroll/PayrollPayments';
import { PayrollReports } from '@/components/payroll/PayrollReports';
import { PaymentHistory } from '@/components/payroll/PaymentHistory';
import { CorporateAccountsManager } from '@/components/payroll/CorporateAccountsManager';
import { StaffRegistrationForm } from '@/components/accounts/StaffRegistrationForm';
import { RetainerClaimsPanel } from '@/components/account/RetainerClaimsPanel';
import { CorporateClaimsPanel } from '@/components/account/CorporateClaimsPanel';
import { SponsorStatementsPanel } from '@/components/account/SponsorStatementsPanel';
import { DailySalesReport } from '@/components/account/DailySalesReport';
import { StaffFamilyDeductions } from '@/components/account/StaffFamilyDeductions';
import { InventoryManagementReport } from '@/components/account/InventoryManagementReport';
import type { PayrollPeriod } from '@/hooks/usePayroll';

function TabHeader({ title, onRefresh }: { title: string; onRefresh: () => void }) {
  const [spinning, setSpinning] = useState(false);
  const handleClick = () => {
    setSpinning(true);
    onRefresh();
    setTimeout(() => setSpinning(false), 800);
  };
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <Button variant="outline" size="sm" onClick={handleClick}>
        <RefreshCw className={`h-4 w-4 mr-1.5 ${spinning ? 'animate-spin' : ''}`} /> Refresh
      </Button>
    </div>
  );
}

const Account = () => {
  const { staff, loading: staffLoading, addStaff, updateStaff, deleteStaff, importStaff, refetch: refetchStaff } = useStaff();
  const { periods, loading: periodsLoading, createPeriod, updatePeriodLabels, lockPeriod, unlockPeriod, markPaid, refetch: refetchPeriods } = usePayrollPeriods();
  const { refetch: refetchCorporate } = useCorporateAccounts();
  const [selectedPeriod, setSelectedPeriod] = useState<PayrollPeriod | null>(null);

  const periodId = selectedPeriod?.id || (periods.length > 0 ? periods[0]?.id : null);
  const { entries, loading: entriesLoading, addEntry, addAllStaff, updateEntry, removeEntry, refetch: refetchEntries } = usePayrollEntries(periodId, periods);

  // Auto-select first period
  if (!selectedPeriod && periods.length > 0) {
    setSelectedPeriod(periods[0]);
  }

  // Keep selectedPeriod in sync with periods array (fixes lock/unlock not reflecting)
  useEffect(() => {
    if (selectedPeriod) {
      const updated = periods.find(p => p.id === selectedPeriod.id);
      if (updated && updated.status !== selectedPeriod.status) {
        setSelectedPeriod(updated);
      }
    }
  }, [periods, selectedPeriod]);

  const handleSelectPeriod = (p: PayrollPeriod) => {
    setSelectedPeriod(p);
  };

  const handleLockPeriod = async (id: string) => {
    const result = await lockPeriod(id);
    if (result) {
      // Immediately update selectedPeriod
      setSelectedPeriod(prev => prev && prev.id === id ? { ...prev, status: 'locked' } : prev);
    }
    return result;
  };

  const handleUnlockPeriod = async (id: string) => {
    const result = await unlockPeriod(id);
    if (result) {
      setSelectedPeriod(prev => prev && prev.id === id ? { ...prev, status: 'draft' } : prev);
    }
    return result;
  };

  const refreshAll = useCallback(() => {
    refetchStaff();
    refetchPeriods();
    refetchEntries();
  }, [refetchStaff, refetchPeriods, refetchEntries]);

  return (
    <MainLayout title="Accounts & Payroll" subtitle="Staff, payroll, corporate & retainer sponsors">
      <Tabs defaultValue="dashboard" className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto flex-nowrap mb-6">
          <TabsTrigger value="dashboard" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <LayoutDashboard className="h-4 w-4" /> Dashboard
          </TabsTrigger>
          <TabsTrigger value="staff" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Users className="h-4 w-4" /> Staff
          </TabsTrigger>
          <a href="/account/payroll" className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:text-sm">
            <FileSpreadsheet className="h-4 w-4" /> Payroll
          </a>
          <TabsTrigger value="payments" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <CreditCard className="h-4 w-4" /> Payments
          </TabsTrigger>
          <TabsTrigger value="corporate" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Building2 className="h-4 w-4" /> Corporate
          </TabsTrigger>
          <TabsTrigger value="retainer" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Building2 className="h-4 w-4" /> Retainer
          </TabsTrigger>
          <TabsTrigger value="sponsor-claims" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <ClipboardList className="h-4 w-4" /> Corporate Month-End
          </TabsTrigger>
          <TabsTrigger value="retainer-claims" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <ClipboardList className="h-4 w-4" /> Retainer Month-End
          </TabsTrigger>
          <TabsTrigger value="statements" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <FileText className="h-4 w-4" /> Issued Reports
          </TabsTrigger>
          <TabsTrigger value="pricelist" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <DollarSign className="h-4 w-4" /> Pricelist
          </TabsTrigger>
          <TabsTrigger value="inventory" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <ClipboardList className="h-4 w-4" /> Pharmacy & Store
          </TabsTrigger>
          <TabsTrigger value="daily-sales" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <FileText className="h-4 w-4" /> Daily Sales Report
          </TabsTrigger>
          <TabsTrigger value="staff-deductions" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Wallet className="h-4 w-4" /> Staff Family Deductions
          </TabsTrigger>
          <TabsTrigger value="register" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <UserPlus className="h-4 w-4" /> Register Staff
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <CreditCard className="h-4 w-4" /> History
          </TabsTrigger>
          <TabsTrigger value="reports" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <FileText className="h-4 w-4" /> Reports
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          <TabHeader title="Dashboard" onRefresh={refreshAll} />
          <PayrollDashboard staff={staff} periods={periods} latestEntries={entries} />
        </TabsContent>

        <TabsContent value="staff">
          <TabHeader title="Staff Management" onRefresh={refetchStaff} />
          <PayrollStaffManagement staff={staff} loading={staffLoading} onRefetch={refetchStaff} />
        </TabsContent>

        <TabsContent value="payments">
          <TabHeader title="Payments" onRefresh={refetchEntries} />
          <PayrollPayments
            periods={periods}
            selectedPeriod={selectedPeriod}
            onSelectPeriod={handleSelectPeriod}
            entries={entries}
            onRefreshEntries={refetchEntries}
          />
        </TabsContent>

        <TabsContent value="corporate">
          <TabHeader title="Corporate Accounts" onRefresh={refetchCorporate} />
          <CorporateAccountsManager accountType="corporate" />
        </TabsContent>

        <TabsContent value="retainer">
          <TabHeader title="Retainer Accounts" onRefresh={refetchCorporate} />
          <CorporateAccountsManager accountType="retainer" />
        </TabsContent>

        <TabsContent value="sponsor-claims">
          <TabHeader title="Corporate Month-End Claims" onRefresh={() => {}} />
          <CorporateClaimsPanel />
        </TabsContent>

        <TabsContent value="retainer-claims">
          <TabHeader title="Retainer Month-End Claims" onRefresh={() => {}} />
          <RetainerClaimsPanel />
        </TabsContent>

        <TabsContent value="statements">
          <div className="space-y-8">
            <div>
              <TabHeader title="Corporate Issued Reports" onRefresh={() => {}} />
              <SponsorStatementsPanel accountType="corporate" />
            </div>
            <div>
              <TabHeader title="Retainer Issued Reports" onRefresh={() => {}} />
              <SponsorStatementsPanel accountType="retainer" />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="pricelist">
          <TabHeader title="Hospital Pricelist" onRefresh={() => {}} />
          <PricelistManager />
        </TabsContent>

        <TabsContent value="inventory">
          <InventoryManagementReport />
        </TabsContent>

        <TabsContent value="daily-sales">
          <DailySalesReport />
        </TabsContent>

        <TabsContent value="staff-deductions">
          <TabHeader title="Staff Family Deductions" onRefresh={() => {}} />
          <StaffFamilyDeductions />
        </TabsContent>



        <TabsContent value="register">
          <TabHeader title="Register Staff" onRefresh={refetchStaff} />
          <StaffRegistrationForm staff={staff} loading={staffLoading} onAddStaff={addStaff} onDeleteStaff={deleteStaff} onRefetch={refetchStaff} />
        </TabsContent>

        <TabsContent value="history">
          <TabHeader title="Payment History" onRefresh={() => {}} />
          <PaymentHistory periods={periods} />
        </TabsContent>

        <TabsContent value="reports">
          <TabHeader title="Reports" onRefresh={() => { refetchPeriods(); refetchEntries(); }} />
          <PayrollReports
            periods={periods}
            selectedPeriod={selectedPeriod}
            onSelectPeriod={handleSelectPeriod}
            entries={entries}
          />
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
};

export default Account;
